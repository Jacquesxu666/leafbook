/* eslint-disable @stylistic/space-before-function-paren */
import path from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import fsPromises from 'node:fs/promises'
import fs from 'fs-extra'
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { isImageFile } from 'common/filesystem/paths'
import { isTrustedEditorSender } from './books'
import type { UploaderPreferences } from '.'

const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const SAFE_IMAGE_SUFFIX = /^\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i

const buildPreferredPathEnv = (): string => {
  const extras =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
      : process.platform === 'linux'
        ? ['/usr/local/bin', '/usr/bin', '/bin']
        : []
  const cur = (process.env.PATH || '').split(path.delimiter)
  const merged = [...cur]
  for (const candidate of extras) {
    if (candidate && !merged.includes(candidate)) merged.push(candidate)
  }
  return merged.filter(Boolean).join(path.delimiter)
}

const resolvePicgoBinary = (): string | null => {
  const names = process.platform === 'win32' ? ['picgo', 'picgo.exe'] : ['picgo']
  const candidates = [
    ...buildPreferredPathEnv()
      .split(path.delimiter)
      .flatMap((directory) => names.map((name) => path.join(directory, name))),
    '/opt/homebrew/bin/picgo',
    '/usr/local/bin/picgo',
    '/usr/bin/picgo',
    `${process.env.HOME}/.npm-global/bin/picgo`,
    `${process.env.HOME}/.npm/bin/picgo`,
    '/usr/local/lib/node_modules/.bin/picgo'
  ]
  for (const candidate of candidates) {
    try {
      if (fs.pathExistsSync(candidate)) return fs.realpathSync(candidate)
    } catch {
      // Not found.
    }
  }
  return null
}

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g // eslint-disable-line no-control-regex

export const parsePicgoOutput = (text: unknown): string | null => {
  const raw = String(text || '')
  const cleaned = raw.replace(ANSI_SGR_RE, '')
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of lines) {
    if (
      (line.startsWith('{') && line.endsWith('}')) ||
      (line.startsWith('[') && line.endsWith(']'))
    ) {
      try {
        const result = JSON.parse(line)
        if (result?.success === true && typeof result.imgUrl === 'string') return result.imgUrl
        if (result?.success === true && Array.isArray(result.result) && result.result.length > 0) {
          return String(result.result[result.result.length - 1])
        }
        if (result?.success === true && typeof result.url === 'string') return result.url
      } catch {
        // Continue with text formats.
      }
    }
    const match = line.match(/(?:success|succeeded|uploaded)\s*:?\s*(https?:\/\/\S+)/i)
    if (match?.[1]) return match[1]
  }
  const marker = cleaned.split('[PicGo SUCCESS]:')
  const candidate = marker.length >= 2 ? marker[marker.length - 1].trim() : ''
  return /^https?:\/\//i.test(candidate) ? candidate : null
}

export interface UploaderCommandRunner {
  (
    executable: string,
    args: readonly string[],
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ): void
}

const defaultRun: UploaderCommandRunner = (executable, args, callback) => {
  execFile(
    executable,
    [...args],
    { shell: false, env: { ...process.env, PATH: buildPreferredPathEnv() } },
    callback
  )
}

const runUploader = (
  executable: string,
  args: readonly string[],
  runner: UploaderCommandRunner = defaultRun
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    runner(executable, args, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })

interface FileIdentity {
  device: string
  inode: string
  size: number
  mode: number
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.device === right.device &&
  left.inode === right.inode &&
  left.size === right.size &&
  left.mode === right.mode

const inspectLocalImage = async (
  imagePath: unknown
): Promise<{ path: string; identity: FileIdentity }> => {
  if (
    typeof imagePath !== 'string' ||
    imagePath.length === 0 ||
    imagePath.length > 4096 ||
    !path.isAbsolute(imagePath) ||
    !isImageFile(imagePath)
  ) {
    throw new Error('Invalid local image path')
  }
  const descriptor = await fsPromises.open(
    imagePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
  )
  try {
    const stat = await descriptor.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
      throw new Error('Image must be a bounded regular file')
    }
    if ((await fsPromises.realpath(imagePath)) !== path.resolve(imagePath)) {
      throw new Error('Image path must be canonical and contain no symlink component')
    }
    return {
      path: imagePath,
      identity: {
        device: String(stat.dev),
        inode: String(stat.ino),
        size: stat.size,
        mode: stat.mode
      }
    }
  } finally {
    await descriptor.close()
  }
}

export const validateLocalImage = async (imagePath: unknown): Promise<string> =>
  (await inspectLocalImage(imagePath)).path

const inspectUploaderExecutable = async (
  executable: unknown,
  label: string
): Promise<{ path: string; identity: FileIdentity }> => {
  if (
    typeof executable !== 'string' ||
    executable.length === 0 ||
    executable.length > 4096 ||
    !path.isAbsolute(executable)
  ) {
    throw new Error(`${label} must be an absolute executable path`)
  }
  const linkStat = await fs.lstat(executable)
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    throw new Error(`${label} must be an existing regular non-symlink file`)
  }
  const descriptor = await fsPromises.open(
    executable,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
  )
  try {
    const stat = await descriptor.stat()
    if (!stat.isFile()) throw new Error(`${label} changed during validation`)
    if ((await fsPromises.realpath(executable)) !== path.resolve(executable)) {
      throw new Error(`${label} path must be canonical and contain no symlink component`)
    }
    if (process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
      throw new Error(`${label} is not executable`)
    }
    return {
      path: executable,
      identity: {
        device: String(stat.dev),
        inode: String(stat.ino),
        size: stat.size,
        mode: stat.mode
      }
    }
  } finally {
    await descriptor.close()
  }
}

export const validateCustomUploader = async (executable: unknown): Promise<string> =>
  (await inspectUploaderExecutable(executable, 'Custom uploader')).path

export const confirmUploader = async (
  sender: WebContents,
  executable: string,
  imagePath: string
): Promise<boolean> => {
  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner) return false
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: ['Cancel', 'Run uploader'],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
    message: 'Upload this image outside LeafBook?',
    detail: `Uploader: ${executable}\nImage: ${imagePath}\nDestination: configured uploader service`
  })
  return result.response === 1
}

interface BufferImagePayload {
  data: Uint8Array | number[]
  name: string
}

interface UploadRequest {
  pathname: unknown
  image: unknown
  isPath: unknown
}

interface UploadDependencies {
  trusted: (event: { sender: WebContents }) => boolean
  resolvePicgo: () => string | null
  run: UploaderCommandRunner
  confirmUploader: (sender: WebContents, executable: string, imagePath: string) => Promise<boolean>
}

const defaultDependencies: UploadDependencies = {
  trusted: isTrustedEditorSender,
  resolvePicgo: resolvePicgoBinary,
  run: defaultRun,
  confirmUploader
}

const normalizePreferences = (
  value: UploaderPreferences
): { currentUploader: 'picgo' | 'cliScript'; cliScript: string } => {
  if (value.currentUploader === 'picgo') return { currentUploader: 'picgo', cliScript: '' }
  if (value.currentUploader === 'cliScript' && typeof value.cliScript === 'string') {
    return { currentUploader: 'cliScript', cliScript: value.cliScript }
  }
  throw new Error('Persisted uploader setting is not allowlisted')
}

const uploadFile = async (
  sender: WebContents,
  imagePath: string,
  preferences: ReturnType<typeof normalizePreferences>,
  dependencies: UploadDependencies
): Promise<string> => {
  const initialImage = await inspectLocalImage(imagePath)
  let executable: string
  let initialExecutable: { path: string; identity: FileIdentity }
  if (preferences.currentUploader === 'picgo') {
    executable = dependencies.resolvePicgo() || ''
    if (!executable) throw new Error('PicGo command not found in PATH')
    initialExecutable = await inspectUploaderExecutable(executable, 'PicGo uploader')
  } else {
    initialExecutable = await inspectUploaderExecutable(preferences.cliScript, 'Custom uploader')
    executable = initialExecutable.path
  }
  if (!(await dependencies.confirmUploader(sender, executable, initialImage.path))) {
    throw new Error('Uploader invocation was not approved')
  }
  // Re-open and re-fstat both inputs immediately before execFile. Confirmation
  // never authorizes a replacement executable or a swapped known image.
  const finalImage = await inspectLocalImage(imagePath)
  const finalExecutable = await inspectUploaderExecutable(
    executable,
    preferences.currentUploader === 'picgo' ? 'PicGo uploader' : 'Custom uploader'
  )
  if (
    !sameIdentity(initialImage.identity, finalImage.identity) ||
    !sameIdentity(initialExecutable.identity, finalExecutable.identity)
  ) {
    throw new Error('Uploader executable or image changed after confirmation')
  }
  if (preferences.currentUploader === 'picgo') {
    const result = await runUploader(executable, ['u', imagePath], dependencies.run)
    const url = parsePicgoOutput(`${result.stdout}\n${result.stderr}`)
    if (!url) throw new Error('PicGo upload error: cannot parse output')
    return url
  }
  const result = await runUploader(executable, [imagePath], dependencies.run)
  const uploadedUrl = result.stdout.trim()
  try {
    const parsed = new URL(uploadedUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error()
    }
    return parsed.href
  } catch {
    throw new Error('Custom uploader did not return an allowlisted HTTP(S) URL')
  }
}

export const handleUpload = async (
  event: { sender: WebContents },
  request: UploadRequest,
  getPreferences: () => UploaderPreferences,
  dependencies: UploadDependencies = defaultDependencies
): Promise<unknown> => {
  if (!dependencies.trusted(event)) throw new Error('Untrusted uploader IPC sender')
  if (!request || typeof request !== 'object') throw new Error('Invalid uploader request')
  const preferences = normalizePreferences(getPreferences())
  if (request.isPath === true) {
    if (
      typeof request.pathname !== 'string' ||
      !path.isAbsolute(request.pathname) ||
      typeof request.image !== 'string' ||
      path.isAbsolute(request.image) ||
      request.image.length > 4096
    ) {
      throw new Error('Invalid image descriptor')
    }
    const imagePath = path.resolve(path.dirname(request.pathname), request.image)
    return uploadFile(event.sender, imagePath, preferences, dependencies)
  }
  const payload = request.image as Partial<BufferImagePayload> | null
  const data = payload?.data
  const buffer =
    data instanceof Uint8Array
      ? Buffer.from(data)
      : Array.isArray(data) &&
          data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        ? Buffer.from(data)
        : null
  const suffix = typeof payload?.name === 'string' ? path.extname(payload.name) : ''
  if (
    !buffer ||
    buffer.length === 0 ||
    buffer.length > MAX_IMAGE_BYTES ||
    !SAFE_IMAGE_SUFFIX.test(suffix)
  ) {
    throw new Error('Invalid buffered image descriptor')
  }
  const temporaryDirectory = await fs.mkdtemp(path.join(tmpdir(), 'leafbook-upload-'))
  const imagePath = path.join(temporaryDirectory, `image${suffix.toLowerCase()}`)
  try {
    await fs.writeFile(imagePath, buffer, { flag: 'wx', mode: 0o600 })
    return await uploadFile(event.sender, imagePath, preferences, dependencies)
  } finally {
    await fs.remove(temporaryDirectory)
  }
}

export const registerUploaderHandlers = (getPreferences: () => UploaderPreferences): void => {
  ipcMain.handle('mt::uploader::upload', (event, request: UploadRequest) =>
    handleUpload(event, request, getPreferences)
  )
}
