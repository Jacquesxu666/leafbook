/* eslint-disable @stylistic/space-before-function-paren */
import { test, expect, type Page } from '@playwright/test'
import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clickMenuById,
  getRendererErrors,
  launchElectron,
  setSourceMarkdown,
  waitForEditor
} from './helpers'

const sourceRootFromEnvironment = process.env.LEAFBOOK_RC_BOOK_ROOT
const mainMarkdownFromEnvironment = process.env.LEAFBOOK_RC_MAIN_MD
const runnerRootFromEnvironment = process.env.LEAFBOOK_RC_RUNNER_ROOT
const runnerNonceFromEnvironment = process.env.LEAFBOOK_RC_RUNNER_NONCE

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const LIMITS = {
  depth: 32,
  files: 10_000,
  directories: 5_000,
  entries: 100_000,
  entriesPerDirectory: 10_000,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024
} as const
const ignoredDirectories = new Set(['.git', 'node_modules'])
const markerName = '.leafbook-real-book-rc'
const runnerMarkerName = '.leafbook-real-book-rc-runner'
const tempPrefixName = 'leafbook-real-book-rc-'

interface Manifest {
  digest: Buffer
  bytes: number
  entries: number
}

interface CompleteManifestEntry {
  type: 'directory' | 'file'
  size: number
  digest: Buffer | null
}

interface CopyEvidence {
  files: number
  directories: number
  bytes: number
}

interface DirectoryIdentity {
  realpath: string
  dev: bigint
  ino: bigint
  uid: bigint
}

interface CopyHooks {
  beforeOpenFile?: (sourceEntry: string) => Promise<void>
}

interface CleanupMarkerHooks {
  beforePostReadIdentity?: () => Promise<void>
}

const hashFile = async (filePath: string): Promise<Buffer> => {
  const noFollow = fs.constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error('RC scan requires nofollow support.')
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    const expected = await fs.lstat(filePath)
    if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1) {
      throw new Error('RC scan rejected a non-regular file.')
    }
    if (expected.size > LIMITS.fileBytes) throw new Error('RC scan exceeded a file limit.')
    handle = await fs.open(filePath, fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK)
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size
    ) {
      throw new Error('RC scan detected a changed file.')
    }
    const digest = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < before.size) {
      const length = Math.min(buffer.length, before.size - position)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      if (bytesRead <= 0) throw new Error('RC scan detected a truncated file.')
      digest.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    const after = await handle.stat()
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size
    ) {
      throw new Error('RC scan detected a changed file.')
    }
    return digest.digest()
  } catch {
    throw new Error('RC bounded file scan failed.')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const scanManifest = async (
  root: string
): Promise<{ manifest: Manifest; complete: Map<string, CompleteManifestEntry> }> => {
  const digest = createHash('sha256')
  let bytes = 0
  let entries = 0
  let files = 0
  let directories = 1
  const complete = new Map<string, CompleteManifestEntry>()
  const walk = async (
    directory: string,
    relativeDirectory: string,
    depth: number
  ): Promise<void> => {
    if (depth > LIMITS.depth) throw new Error('RC scan exceeded the directory depth limit.')
    const names = (await fs.readdir(directory)).sort()
    if (names.length > LIMITS.entriesPerDirectory) {
      throw new Error('RC scan exceeded the per-directory entry limit.')
    }
    for (const name of names) {
      if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error('RC scan rejected an unsafe entry name.')
      }
      if (ignoredDirectories.has(name) || name.startsWith('.')) continue
      if (++entries > LIMITS.entries) throw new Error('RC scan exceeded the entry limit.')
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      const absolute = path.join(directory, name)
      const stat = await fs.lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error('RC scan rejected a non-regular entry.')
      }
      if (stat.isDirectory()) {
        if (++directories > LIMITS.directories) {
          throw new Error('RC scan exceeded the directory limit.')
        }
        complete.set(relative, { type: 'directory', size: stat.size, digest: null })
        digest.update('directory').update('\0').update(relative).update('\0')
        await walk(absolute, relative, depth + 1)
      } else {
        if (++files > LIMITS.files || stat.size > LIMITS.fileBytes || stat.nlink !== 1) {
          throw new Error('RC scan rejected a file limit or hard link.')
        }
        if (bytes + stat.size > LIMITS.totalBytes) {
          throw new Error('RC scan exceeded the aggregate byte limit.')
        }
        bytes += stat.size
        const fileDigest = await hashFile(absolute)
        complete.set(relative, { type: 'file', size: stat.size, digest: fileDigest })
        digest
          .update('file')
          .update('\0')
          .update(relative)
          .update('\0')
          .update(String(stat.size))
          .update(fileDigest)
      }
    }
  }
  try {
    await walk(root, '', 0)
  } catch {
    throw new Error('RC bounded tree scan failed.')
  }
  return { manifest: { digest: digest.digest(), bytes, entries }, complete }
}

const manifest = async (root: string): Promise<Manifest> => (await scanManifest(root)).manifest

const sameManifest = (left: Manifest, right: Manifest): boolean =>
  left.bytes === right.bytes && left.entries === right.entries && left.digest.equals(right.digest)

const completeManifest = async (root: string): Promise<Map<string, CompleteManifestEntry>> => {
  return (await scanManifest(root)).complete
}

const validateSourceRoot = async (candidate: string): Promise<string> => {
  if (!path.isAbsolute(candidate)) throw new Error('RC source must be an absolute directory.')
  const resolved = await fs.realpath(candidate)
  const forbidden = new Set([
    path.parse(resolved).root,
    await fs.realpath(os.homedir()),
    await fs.realpath(path.resolve(__dirname, '../..'))
  ])
  if (forbidden.has(resolved)) throw new Error('RC source rejected a broad root.')
  const stat = await fs.lstat(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('RC source must resolve to a regular directory.')
  }
  return resolved
}

const readAuthorizationMarker = async (markerPath: string): Promise<Buffer> => {
  const noFollow = fs.constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error('RC runner authorization is unavailable.')
  const handle = await fs.open(
    markerPath,
    fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK
  )
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size !== 32) {
      throw new Error('RC runner authorization is invalid.')
    }
    const marker = Buffer.alloc(32)
    const { bytesRead } = await handle.read(marker, 0, marker.length, 0)
    const [after, pathAfter] = await Promise.all([handle.stat(), fs.lstat(markerPath)])
    if (
      bytesRead !== marker.length ||
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 ||
      pathAfter.dev !== before.dev ||
      pathAfter.ino !== before.ino ||
      pathAfter.size !== before.size
    ) {
      throw new Error('RC runner authorization is invalid.')
    }
    return marker
  } finally {
    await handle.close()
  }
}

const validateRunnerAuthorization = async (): Promise<string> => {
  if (!runnerRootFromEnvironment || !runnerNonceFromEnvironment) {
    throw new Error('RC runner authorization is required.')
  }
  if (
    !/^[0-9a-f]{64}$/.test(runnerNonceFromEnvironment) ||
    !path.isAbsolute(runnerRootFromEnvironment)
  ) {
    throw new Error('RC runner authorization is invalid.')
  }
  const [real, canonicalTemp, stat, marker] = await Promise.all([
    fs.realpath(runnerRootFromEnvironment),
    fs.realpath(os.tmpdir()),
    fs.lstat(runnerRootFromEnvironment),
    readAuthorizationMarker(path.join(runnerRootFromEnvironment, runnerMarkerName))
  ])
  if (
    real !== runnerRootFromEnvironment ||
    !real.startsWith(path.join(canonicalTemp, 'leafbook-real-book-rc-runner-')) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    marker.toString('hex') !== runnerNonceFromEnvironment ||
    ('uid' in stat && typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('RC runner authorization is invalid.')
  }
  return real
}

const createValidatedTempRoot = async (
  runnerRoot: string
): Promise<{ root: string; marker: Buffer }> => {
  const created = await fs.mkdtemp(path.join(runnerRoot, tempPrefixName))
  const real = await fs.realpath(created)
  const canonicalPrefix = path.join(runnerRoot, tempPrefixName)
  const stat = await fs.lstat(real)
  const marker = randomBytes(32)
  if (
    !real.startsWith(canonicalPrefix) ||
    !stat.isDirectory() ||
    ('uid' in stat && typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('RC temporary root validation failed.')
  }
  await fs.writeFile(path.join(real, markerName), marker, { flag: 'wx', mode: 0o600 })
  return { root: real, marker }
}

const readCleanupMarker = async (
  markerPath: string,
  expectedMarker: Buffer,
  hooks: CleanupMarkerHooks = {}
): Promise<boolean> => {
  const noFollow = fs.constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error('RC_CLEANUP_NOFOLLOW')
  if (expectedMarker.length !== 32) throw new Error('RC_CLEANUP_MARKER_SIZE')
  const handle = await fs.open(
    markerPath,
    fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK
  )
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size !== expectedMarker.length) {
      throw new Error('RC_CLEANUP_MARKER_SHAPE')
    }
    const actualMarker = Buffer.alloc(expectedMarker.length)
    const { bytesRead } = await handle.read(actualMarker, 0, actualMarker.length, 0)
    await hooks.beforePostReadIdentity?.()
    const [after, pathAfter] = await Promise.all([handle.stat(), fs.lstat(markerPath)])
    if (
      bytesRead !== expectedMarker.length ||
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 ||
      pathAfter.dev !== before.dev ||
      pathAfter.ino !== before.ino ||
      pathAfter.size !== before.size
    ) {
      throw new Error('RC_CLEANUP_MARKER_CHANGED')
    }
    return actualMarker.equals(expectedMarker)
  } finally {
    await handle.close()
  }
}

const sameDirectoryIdentity = (left: DirectoryIdentity, right: DirectoryIdentity): boolean =>
  left.realpath === right.realpath &&
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.uid === right.uid

const safelyRemoveTempRoot = async (
  root: string,
  marker: Buffer,
  hooks: CleanupMarkerHooks = {}
): Promise<boolean> => {
  try {
    const runnerRoot = await validateRunnerAuthorization()
    const parent = path.dirname(root)
    const canonicalPrefix = path.join(runnerRoot, tempPrefixName)
    const [parentBefore, rootBefore, rootStat] = await Promise.all([
      directoryIdentity(parent),
      directoryIdentity(root),
      fs.lstat(root)
    ])
    if (
      parent !== runnerRoot ||
      parentBefore.realpath !== runnerRoot ||
      rootBefore.realpath !== root ||
      !root.startsWith(canonicalPrefix) ||
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      ('uid' in rootStat &&
        typeof process.getuid === 'function' &&
        rootStat.uid !== process.getuid()) ||
      !(await readCleanupMarker(path.join(root, markerName), marker, hooks))
    ) {
      return false
    }
    const [parentAfter, rootAfter] = await Promise.all([
      directoryIdentity(parent),
      directoryIdentity(root)
    ])
    if (
      !sameDirectoryIdentity(parentBefore, parentAfter) ||
      !sameDirectoryIdentity(rootBefore, rootAfter)
    ) {
      return false
    }
    await fs.rm(root, { recursive: true })
    return true
  } catch {
    return false
  }
}

const runCleanupMarkerFixtures = async (
  runnerRoot: string
): Promise<{ rejected: number; retained: number }> => {
  let rejected = 0
  let retained = 0
  const runFixture = async (
    setup: (root: string, marker: Buffer) => Promise<CleanupMarkerHooks | undefined>
  ): Promise<void> => {
    const root = await fs.mkdtemp(path.join(runnerRoot, tempPrefixName))
    const marker = randomBytes(32)
    try {
      const hooks = (await setup(root, marker)) ?? {}
      const removed = await safelyRemoveTempRoot(root, marker, hooks)
      if (!removed) rejected++
      const stillExists = await fs
        .lstat(root)
        .then(() => true)
        .catch((error) => {
          if (error?.code === 'ENOENT') return false
          throw new Error('RC_CLEANUP_FIXTURE_STAT')
        })
      if (stillExists) retained++
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }

  await runFixture(async (root, marker) => {
    const target = path.join(root, 'marker-target')
    await fs.writeFile(target, marker, { flag: 'wx', mode: 0o600 })
    await fs.symlink(target, path.join(root, markerName))
  })
  await runFixture(async (root, marker) => {
    await fs.writeFile(path.join(root, markerName), Buffer.concat([marker, Buffer.from([0])]), {
      flag: 'wx',
      mode: 0o600
    })
  })
  await runFixture(async (root) => {
    await fs.mkdir(path.join(root, markerName))
  })
  await runFixture(async (root, marker) => {
    const markerPath = path.join(root, markerName)
    const movedMarkerPath = path.join(root, `${markerName}-moved`)
    await fs.writeFile(markerPath, marker, { flag: 'wx', mode: 0o600 })
    return {
      beforePostReadIdentity: async () => {
        await fs.rename(markerPath, movedMarkerPath)
        await fs.writeFile(markerPath, marker, { flag: 'wx', mode: 0o600 })
      }
    }
  })
  return { rejected, retained }
}

const directoryIdentity = async (directory: string): Promise<DirectoryIdentity> => {
  const [realpath, stat] = await Promise.all([
    fs.realpath(directory),
    fs.lstat(directory, { bigint: true })
  ])
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('RC copy rejected a changed directory.')
  }
  return { realpath, dev: stat.dev, ino: stat.ino, uid: stat.uid }
}

const assertDirectoryIdentity = async (
  directory: string,
  expected: DirectoryIdentity
): Promise<void> => {
  const actual = await directoryIdentity(directory)
  if (
    actual.realpath !== expected.realpath ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.uid !== expected.uid
  ) {
    throw new Error('RC copy detected a changed directory.')
  }
}

const copyRegularFile = async (
  source: string,
  destination: string,
  expected: Awaited<ReturnType<typeof fs.lstat>>,
  hooks: CopyHooks
): Promise<number> => {
  await hooks.beforeOpenFile?.(source)
  const noFollow = fs.constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error('RC copy requires nofollow support.')
  const sourceHandle = await fs.open(
    source,
    fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK
  )
  let destinationHandle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    const before = await sourceHandle.stat()
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size
    ) {
      throw new Error('RC copy detected a changed source file.')
    }
    if (before.size > LIMITS.fileBytes) throw new Error('RC copy exceeded a file limit.')
    destinationHandle = await fs.open(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600
    )
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < before.size) {
      const length = Math.min(buffer.length, before.size - position)
      const { bytesRead } = await sourceHandle.read(buffer, 0, length, position)
      if (bytesRead <= 0) throw new Error('RC copy detected a truncated source file.')
      let written = 0
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        )
        if (result.bytesWritten <= 0) throw new Error('RC copy could not write a bounded file.')
        written += result.bytesWritten
      }
      position += bytesRead
    }
    const [after, destinationStat] = await Promise.all([
      sourceHandle.stat(),
      destinationHandle.stat()
    ])
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      !destinationStat.isFile() ||
      destinationStat.size !== before.size
    ) {
      throw new Error('RC copy detected a changed file identity or size.')
    }
    return before.size
  } finally {
    await destinationHandle?.close().catch(() => undefined)
    await sourceHandle.close().catch(() => undefined)
  }
}

const copyBook = async (
  source: string,
  destination: string,
  hooks: CopyHooks = {}
): Promise<CopyEvidence> => {
  const evidence: CopyEvidence = { files: 0, directories: 1, bytes: 0 }
  await fs.mkdir(destination, { recursive: false })
  const sourceRootIdentity = await directoryIdentity(source)
  const destinationRootIdentity = await directoryIdentity(destination)
  const walk = async (
    from: string,
    to: string,
    depth: number,
    fromIdentity: DirectoryIdentity,
    toIdentity: DirectoryIdentity
  ): Promise<void> => {
    if (depth > LIMITS.depth) throw new Error('RC copy exceeded the directory depth limit.')
    await assertDirectoryIdentity(source, sourceRootIdentity)
    await assertDirectoryIdentity(destination, destinationRootIdentity)
    await assertDirectoryIdentity(from, fromIdentity)
    await assertDirectoryIdentity(to, toIdentity)
    const names = (await fs.readdir(from)).sort()
    if (names.length > LIMITS.entriesPerDirectory) {
      throw new Error('RC copy exceeded the per-directory entry limit.')
    }
    for (const name of names) {
      if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error('RC copy rejected an unsafe entry name.')
      }
      if (ignoredDirectories.has(name) || name.startsWith('.')) continue
      const sourceEntry = path.join(from, name)
      const destinationEntry = path.join(to, name)
      const stat = await fs.lstat(sourceEntry)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error('RC copy rejected a non-regular entry.')
      }
      if (++evidence.files + evidence.directories > LIMITS.entries) {
        throw new Error('RC copy exceeded the entry limit.')
      }
      if (stat.isDirectory()) {
        evidence.files--
        if (++evidence.directories > LIMITS.directories) {
          throw new Error('RC copy exceeded the directory limit.')
        }
        await fs.mkdir(destinationEntry)
        const [sourceChildIdentity, destinationChildIdentity] = await Promise.all([
          directoryIdentity(sourceEntry),
          directoryIdentity(destinationEntry)
        ])
        await walk(
          sourceEntry,
          destinationEntry,
          depth + 1,
          sourceChildIdentity,
          destinationChildIdentity
        )
      } else {
        if (stat.nlink !== 1) throw new Error('RC copy rejected a hard-linked file.')
        if (evidence.files > LIMITS.files || stat.size > LIMITS.fileBytes) {
          throw new Error('RC copy exceeded a file limit.')
        }
        if (evidence.bytes + stat.size > LIMITS.totalBytes) {
          throw new Error('RC copy exceeded the aggregate byte limit.')
        }
        evidence.bytes += await copyRegularFile(sourceEntry, destinationEntry, stat, hooks)
      }
      await assertDirectoryIdentity(from, fromIdentity)
      await assertDirectoryIdentity(to, toIdentity)
    }
    await assertDirectoryIdentity(source, sourceRootIdentity)
    await assertDirectoryIdentity(destination, destinationRootIdentity)
  }
  await walk(source, destination, 0, sourceRootIdentity, destinationRootIdentity)
  return evidence
}

const rootMarkdownFiles = async (root: string): Promise<Array<{ name: string; size: number }>> => {
  const result: Array<{ name: string; size: number }> = []
  for (const name of await fs.readdir(root)) {
    if (!/\.(?:md|markdown)$/i.test(name) || /^summary\.(?:md|markdown)$/i.test(name)) continue
    const stat = await fs.lstat(path.join(root, name))
    if (stat.isFile()) result.push({ name, size: stat.size })
  }
  return result
}

const markdownFiles = async (root: string): Promise<string[]> => {
  const result: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await fs.readdir(directory)).sort()) {
      if (ignoredDirectories.has(name) || name.startsWith('.')) continue
      const absolute = path.join(directory, name)
      const stat = await fs.lstat(absolute)
      if (stat.isDirectory()) await walk(absolute)
      else if (stat.isFile() && /\.(?:md|markdown)$/i.test(name)) result.push(absolute)
    }
  }
  await walk(root)
  return result
}

const selectMainMarkdown = async (root: string): Promise<string> => {
  const candidates = await rootMarkdownFiles(root)
  if (mainMarkdownFromEnvironment) {
    if (
      path.basename(mainMarkdownFromEnvironment) !== mainMarkdownFromEnvironment ||
      mainMarkdownFromEnvironment.includes('/') ||
      mainMarkdownFromEnvironment.includes('\\')
    ) {
      throw new Error('LEAFBOOK_RC_MAIN_MD must be a root-relative basename.')
    }
    const selected = candidates.find((candidate) => candidate.name === mainMarkdownFromEnvironment)
    if (!selected) {
      throw new Error('LEAFBOOK_RC_MAIN_MD did not select a regular root Markdown file.')
    }
    return selected.name
  }
  const selected = candidates.sort(
    (left, right) => right.size - left.size || left.name.localeCompare(right.name)
  )[0]
  if (!selected) throw new Error('RC copy has no root Markdown manuscript.')
  return selected.name
}

const h1Headings = (markdown: string): string[] => {
  const headings: string[] = []
  let fenced = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    const match = !fenced ? /^#(?!#)\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (match?.[1]) headings.push(match[1])
  }
  return headings
}

const fragmentKey = (value: string): string =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

const summaryDestination = (fileName: string, heading: string): string =>
  `${encodeURIComponent(fileName)}#${encodeURIComponent(fragmentKey(heading))}`

const openBook = async (
  app: Awaited<ReturnType<typeof launchElectron>>['app'],
  root: string,
  htmlOutput: string,
  websiteOutput: string
): Promise<void> => {
  await app.evaluate(
    ({ dialog, session }, values) => {
      const state = global as unknown as { __leafbook_rc_requests__?: number }
      state.__leafbook_rc_requests__ = 0
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/i.test(details.url)) {
          state.__leafbook_rc_requests__ = (state.__leafbook_rc_requests__ ?? 0) + 1
        }
        callback({})
      })
      dialog.showOpenDialog = async () =>
        ({
          canceled: false,
          filePaths: [values.root],
          bookmarks: []
        }) as Electron.OpenDialogReturnValue
      let saveCount = 0
      dialog.showSaveDialog = async () =>
        ({
          canceled: false,
          filePath: saveCount++ === 0 ? values.htmlOutput : values.websiteOutput
        }) as Electron.SaveDialogReturnValue
      dialog.showMessageBox = async () =>
        ({ response: 1, checkboxChecked: false }) as Electron.MessageBoxReturnValue
    },
    { root, htmlOutput, websiteOutput }
  )
  await clickMenuById(app, 'leafbookOpenBook')
}

const selectMainChapter = async (page: Page, firstHeading: string): Promise<void> => {
  const selected = await page.locator('.book-tree').evaluate((tree, target) => {
    const button = [...tree.querySelectorAll<HTMLButtonElement>('button.tree-label')].find(
      (candidate) => candidate.textContent?.trim() === target.trim()
    )
    button?.click()
    return Boolean(button)
  }, firstHeading)
  if (!selected) throw new Error('RC could not select the expected manuscript.')
  await expect(page.locator('.leafbook-markdown h1')).toHaveCount(34)
}

const assertFragmentAliasResolution = async (
  page: Page,
  ordinal: number,
  total: number
): Promise<number> => {
  const alias = page.locator('.book-tree .tree-label').nth(ordinal)
  await alias.click()
  await expect(alias).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.book-content')).toHaveAttribute('data-reading-ready', 'true')
  await expect(page.locator('.leafbook-markdown h1')).toHaveCount(total)
  const evidence = await page
    .locator('.leafbook-markdown h1')
    .nth(ordinal)
    .evaluate((target, expectedOrdinal) => {
      const article = target.closest('.leafbook-markdown')
      const container = target.closest<HTMLElement>('.book-content')
      if (!article || !container) return null
      const headings = [...article.querySelectorAll('h1')]
      const targetBounds = target.getBoundingClientRect()
      const containerBounds = container.getBoundingClientRect()
      const scrollable = Math.max(0, container.scrollHeight - container.clientHeight)
      return {
        ordinalMatches: headings.findIndex((heading) => heading === target) === expectedOrdinal,
        visible:
          targetBounds.bottom > containerBounds.top && targetBounds.top < containerBounds.bottom,
        ratio: scrollable > 0 ? container.scrollTop / scrollable : 0
      }
    }, ordinal)
  const evidencePresent = evidence !== null
  expect(evidencePresent).toBe(true)
  if (!evidence) throw new Error('RC_FRAGMENT_EVIDENCE')
  expect(evidence.ordinalMatches).toBe(true)
  expect(evidence.visible).toBe(true)
  if (ordinal === 0) expect(evidence.ratio).toBeLessThan(0.05)
  if (ordinal > 0) expect(evidence.ratio).toBeGreaterThan(0)
  return evidence.ratio
}

test.describe('opt-in real-book release candidate', () => {
  test.skip(
    !sourceRootFromEnvironment || !runnerRootFromEnvironment || !runnerNonceFromEnvironment,
    'Use the marker-authorized privacy wrapper to run the real-book RC suite.'
  )

  test('validates inferred and SUMMARY alias workflows without modifying the source', async () => {
    test.setTimeout(180_000)
    try {
      if (!sourceRootFromEnvironment) throw new Error('RC source authorization is required.')
      const runnerRoot = await validateRunnerAuthorization()
      const sourceRoot = await validateSourceRoot(sourceRootFromEnvironment)
      const before = await manifest(sourceRoot)
      const temporary = await createValidatedTempRoot(runnerRoot)
      const copiedRoot = path.join(temporary.root, 'source-copy')
      const outputRoot = path.join(temporary.root, 'output')
      const userDataRoot = path.join(temporary.root, 'userData')
      let sourceUnchanged = false
      let cleanupSucceeded = false
      let activeApp: Awaited<ReturnType<typeof launchElectron>>['app'] | null = null
      try {
        const cleanupFixtureEvidence = await runCleanupMarkerFixtures(runnerRoot)
        expect(cleanupFixtureEvidence.rejected).toBe(4)
        expect(cleanupFixtureEvidence.retained).toBe(4)

        const raceSource = path.join(temporary.root, 'copier-race-source')
        const raceDestination = path.join(temporary.root, 'copier-race-destination')
        const raceLeaf = path.join(raceSource, 'leaf.md')
        const raceMovedLeaf = path.join(raceSource, 'leaf-moved.md')
        const raceTarget = path.join(temporary.root, 'copier-race-target.md')
        await fs.mkdir(raceSource)
        await fs.writeFile(raceLeaf, '# synthetic\n', { flag: 'wx' })
        await fs.writeFile(raceTarget, '# target\n', { flag: 'wx' })
        let raceHookCalled = false
        let raceRejected = false
        try {
          await copyBook(raceSource, raceDestination, {
            beforeOpenFile: async (sourceEntry) => {
              if (raceHookCalled) return
              raceHookCalled = true
              await fs.rename(sourceEntry, raceMovedLeaf)
              await fs.symlink(raceTarget, sourceEntry)
            }
          })
        } catch {
          raceRejected = true
        }
        expect(raceRejected).toBe(true)
        expect(raceHookCalled).toBe(true)
        await fs.rm(raceSource, { recursive: true })
        await fs.rm(raceDestination, { recursive: true })
        await fs.rm(raceTarget)

        const copied = await copyBook(sourceRoot, copiedRoot)
        expect(copied.files).toBeGreaterThan(0)
        await fs.mkdir(outputRoot)
        await fs.mkdir(userDataRoot)
        const mainMarkdown = await selectMainMarkdown(copiedRoot)
        const mainPath = path.join(copiedRoot, mainMarkdown)
        const manuscriptBefore = await hashFile(mainPath)
        const markdown = await fs.readFile(mainPath, 'utf8')
        const headings = h1Headings(markdown)
        expect(headings.length).toBe(34)
        const sourceSvgTagCount = (
          await Promise.all(
            (await markdownFiles(copiedRoot)).map(async (file) => {
              const content = await fs.readFile(file, 'utf8')
              return (content.match(/<\/?svg\b/gi) ?? []).length
            })
          )
        ).reduce((total, count) => total + count, 0)
        expect(sourceSvgTagCount).toBe(10)
        const token = headings.find((heading) => [...heading].length >= 4)?.slice(0, 4)
        if (!token) throw new Error('RC manuscript did not provide a safe in-memory search token.')

        const asIsHtml = path.join(outputRoot, 'as-is.html')
        const asIsWebsite = path.join(outputRoot, 'as-is-site')
        const launched = await launchElectron([], {
          suppressErrorDialog: true,
          userDataDir: userDataRoot,
          stripEnvironmentPrefixes: ['LEAFBOOK_RC_']
        })
        activeApp = launched.app
        await openBook(launched.app, copiedRoot, asIsHtml, asIsWebsite)
        await expect(launched.page.locator('.book-navigation > .panel-label')).toContainText(
          'inferred'
        )
        const inferredNavigationCount = await launched.page
          .locator('.book-tree')
          .evaluate((tree) => {
            const nodes = [...tree.querySelectorAll('.book-tree-node')]
            const groupLandingNodes = nodes.filter(
              (node) =>
                node.querySelector(':scope > .book-tree-row > button.tree-label') &&
                node.querySelector(':scope > .book-tree-children')
            )
            return nodes.length + groupLandingNodes.length
          })
        expect(inferredNavigationCount).toBe(4)
        await expect(launched.page.getByRole('button', { name: 'Arrange' })).toHaveCount(0)
        await expect(launched.page.locator('.book-content')).toHaveAttribute(
          'data-reading-ready',
          'true'
        )
        const inferredLandingIsMain =
          (await launched.page.locator('.leafbook-markdown h1').count()) === headings.length
        expect(inferredLandingIsMain).toBe(false)
        await selectMainChapter(launched.page, headings[0] ?? '')
        await expect(launched.page.locator('.leafbook-markdown h1')).toHaveCount(34)
        const renderedDocuments = new Set<string>()
        let renderedSvgCount = 0
        const navigationButtons = launched.page.locator('.book-tree .tree-label')
        for (let index = 0; index < (await navigationButtons.count()); index++) {
          await navigationButtons.nth(index).click()
          const inspected = await launched.page
            .locator('.leafbook-markdown')
            .evaluate((article) => {
              const svgs = [...article.querySelectorAll('svg')]
              return {
                identity: article.innerHTML,
                svgCount: svgs.length,
                svgPolicy: svgs.every((node) => {
                  const bounds = node.getBoundingClientRect()
                  return (
                    getComputedStyle(node).display !== 'none' &&
                    bounds.width >= 0 &&
                    bounds.height >= 0 &&
                    !node.querySelector('script, foreignObject') &&
                    ![...node.attributes].some(
                      (attribute) =>
                        /^on/i.test(attribute.name) ||
                        (/^(?:href|xlink:href)$/i.test(attribute.name) &&
                          /^(?:https?:|file:|\/)/i.test(attribute.value))
                    )
                  )
                })
              }
            })
          expect(inspected.svgPolicy).toBe(true)
          if (!renderedDocuments.has(inspected.identity)) {
            renderedDocuments.add(inspected.identity)
            renderedSvgCount += inspected.svgCount
          }
        }
        // Current reader policy strips raw inline SVG elements. This is safe but
        // is a known visual-fidelity adaptation gap for this fixture.
        expect(renderedSvgCount).toBe(0)
        await selectMainChapter(launched.page, headings[0] ?? '')

        await launched.page.getByRole('button', { name: 'Search' }).click()
        await launched.page.getByRole('searchbox').fill(token)
        await expect
          .poll(() => launched.page.locator('[role="option"]').count(), { timeout: 15_000 })
          .toBeGreaterThan(0)
        await launched.page.getByRole('button', { name: 'Close search' }).click()

        const surface = launched.page.locator('.book-content')
        await surface.evaluate((element) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.55
          element.dispatchEvent(new Event('scroll'))
        })
        await launched.page.getByRole('button', { name: 'Edit', exact: true }).click()
        await waitForEditor(launched.page)
        await setSourceMarkdown(launched.page, launched.app, `${markdown}\n`)
        await launched.page.getByRole('button', { name: 'Back to Book' }).click()
        const dirtyDialog = launched.page.getByRole('dialog', { name: 'Unsaved chapter changes' })
        await expect(dirtyDialog).toBeVisible()
        await dirtyDialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(launched.page.locator('.editor-component')).toBeVisible()
        await launched.page.getByRole('button', { name: 'Back to Book' }).click()
        await dirtyDialog.getByRole('button', { name: 'Discard' }).click()
        await expect(surface).toHaveAttribute('data-reading-ready', 'true')
        await expect
          .poll(() =>
            surface.evaluate((element) => {
              const scrollable = element.scrollHeight - element.clientHeight
              return scrollable > 0 ? element.scrollTop / scrollable : 0
            })
          )
          .toBeGreaterThan(0.35)

        await launched.page.getByRole('button', { name: 'Export…' }).click()
        await expect(
          launched.page.locator('.export-status').filter({ hasText: 'Exported' })
        ).toBeVisible()
        await launched.page.getByRole('button', { name: 'Generate Website…' }).click()
        await expect(
          launched.page.locator('.export-status').filter({ hasText: 'Generated' })
        ).toBeVisible()
        const asIsHtmlIsOffline = !/\s(?:href|src)=["'](?:https?:|file:|\/)/i.test(
          await fs.readFile(asIsHtml, 'utf8')
        )
        expect(asIsHtmlIsOffline).toBe(true)
        const asIsWebsiteShapeIsValid =
          (await fs.readdir(asIsWebsite)).sort().join('\0') === 'index.html\0leafbook-manifest.json'
        expect(asIsWebsiteShapeIsValid).toBe(true)
        const remoteRequests = await launched.app.evaluate(() => {
          const state = global as unknown as { __leafbook_rc_requests__?: number }
          return state.__leafbook_rc_requests__ ?? -1
        })
        expect(remoteRequests).toBe(0)
        const rcEnvironmentKeyCount = await launched.app.evaluate(
          () => Object.keys(process.env).filter((name) => name.startsWith('LEAFBOOK_RC_')).length
        )
        expect(rcEnvironmentKeyCount).toBe(0)
        expect((await getRendererErrors(launched.app)).length).toBe(0)
        await launched.app.close()
        activeApp = null

        // Expected adaptation gap: without SUMMARY, inferred navigation picks a
        // nested README as the landing page rather than the root manuscript.
        const manuscriptUnchangedAfterInferredTrack = (await hashFile(mainPath)).equals(
          manuscriptBefore
        )
        expect(manuscriptUnchangedAfterInferredTrack).toBe(true)

        const summary = `${headings
          .map(
            (heading, index) =>
              `- [RC chapter ${String(index + 1).padStart(2, '0')}](${summaryDestination(
                mainMarkdown,
                heading
              )})`
          )
          .join('\n')}\n`
        const summaryPath = path.join(copiedRoot, 'SUMMARY.md')
        await fs.writeFile(summaryPath, summary, { flag: 'wx' })
        const summaryInitial = await fs.readFile(summaryPath)
        const structuredHtml = path.join(outputRoot, 'structured.html')
        const structuredWebsite = path.join(outputRoot, 'structured-site')
        const secondProfile = path.join(temporary.root, 'userData-structured')
        await fs.mkdir(secondProfile)
        expect((await fs.readdir(secondProfile)).length).toBe(0)
        let structured = await launchElectron([], {
          suppressErrorDialog: true,
          userDataDir: secondProfile,
          stripEnvironmentPrefixes: ['LEAFBOOK_RC_']
        })
        activeApp = structured.app
        await openBook(structured.app, copiedRoot, structuredHtml, structuredWebsite)
        await expect(structured.page.locator('.book-navigation > .panel-label')).toContainText(
          'summary'
        )
        await expect(structured.page.locator('.book-tree-node')).toHaveCount(34)

        let previousFragmentRatio = -1
        for (const index of [0, Math.floor(headings.length / 2), headings.length - 1]) {
          const ratio = await assertFragmentAliasResolution(structured.page, index, headings.length)
          expect(ratio).toBeGreaterThan(previousFragmentRatio)
          previousFragmentRatio = ratio
        }

        await structured.page.getByRole('button', { name: 'Search' }).click()
        await structured.page.getByRole('searchbox').fill(token)
        await expect
          .poll(() => structured.page.locator('[role="option"]').count(), { timeout: 15_000 })
          .toBeGreaterThan(0)
        await structured.page.getByRole('button', { name: 'Close search' }).click()

        const structuredSurface = structured.page.locator('.book-content')
        await structuredSurface.evaluate((element) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.47
          element.dispatchEvent(new Event('scroll'))
        })
        await expect
          .poll(() =>
            structuredSurface.evaluate((element) => {
              const scrollable = element.scrollHeight - element.clientHeight
              return scrollable > 0 ? element.scrollTop / scrollable : 0
            })
          )
          .toBeGreaterThan(0.4)
        const actualRatioBeforeClose = await structuredSurface.evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
        expect(Math.abs(actualRatioBeforeClose - 0.47)).toBeLessThanOrEqual(0.01)
        await structured.page.waitForTimeout(800)
        await structured.app.close()
        activeApp = null
        structured = await launchElectron([], {
          suppressErrorDialog: true,
          userDataDir: secondProfile,
          stripEnvironmentPrefixes: ['LEAFBOOK_RC_']
        })
        activeApp = structured.app
        await openBook(structured.app, copiedRoot, structuredHtml, structuredWebsite)
        await expect(structured.page.locator('.book-content')).toHaveAttribute(
          'data-reading-ready',
          'true'
        )
        await expect(
          structured.page.locator('.book-tree .tree-label[aria-current="page"]')
        ).toHaveCount(1)
        await expect
          .poll(async () => {
            const restored = await structured.page.locator('.book-content').evaluate((element) => {
              const scrollable = element.scrollHeight - element.clientHeight
              return scrollable > 0 ? element.scrollTop / scrollable : 0
            })
            return Math.abs(restored - actualRatioBeforeClose)
          })
          .toBeLessThanOrEqual(0.05)
        const restoredRatio = await structured.page.locator('.book-content').evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
        expect(Math.abs(restoredRatio - 0.47)).toBeLessThanOrEqual(0.05)

        await structured.page.getByRole('button', { name: 'Arrange' }).click()
        const treeItems = structured.page.locator('[role="treeitem"]')
        await treeItems.first().focus()
        await structured.page.keyboard.press('Alt+ArrowDown')
        await expect(structured.page.getByText('Unsaved changes')).toBeVisible()
        await structured.page.getByRole('button', { name: 'Undo' }).click()
        await structured.page.getByRole('button', { name: 'Cancel' }).click()
        const summaryUnchangedAfterCancel = (await fs.readFile(summaryPath)).equals(summaryInitial)
        expect(summaryUnchangedAfterCancel).toBe(true)

        const copiedManifestBeforeSave = await completeManifest(copiedRoot)
        const summaryDigestBeforeSave = await hashFile(summaryPath)
        await structured.page.getByRole('button', { name: 'Arrange' }).click()
        await structured.page.locator('[role="treeitem"]').first().focus()
        await structured.page
          .locator('[role="treeitem"]')
          .first()
          .locator('.arrangement-node-actions button')
          .nth(1)
          .click()
        await expect(structured.page.getByText('Unsaved changes')).toBeVisible()
        await structured.page.getByRole('button', { name: 'Save contents' }).click()
        await expect(structured.page.locator('.arrangement-panel')).toHaveCount(0)
        await expect
          .poll(async () => (await fs.readFile(summaryPath)).equals(summaryInitial))
          .toBe(false)
        const summaryAfterSave = await fs.readFile(summaryPath)
        const summaryDigestAfterSave = await hashFile(summaryPath)
        const summaryBytesChanged = !summaryAfterSave.equals(summaryInitial)
        const summaryDigestChanged = !summaryDigestAfterSave.equals(summaryDigestBeforeSave)
        expect(summaryBytesChanged).toBe(true)
        expect(summaryDigestChanged).toBe(true)
        const copiedManifestAfterSave = await completeManifest(copiedRoot)
        const manifestKeysUnchanged =
          [...copiedManifestAfterSave.keys()].join('\0') ===
          [...copiedManifestBeforeSave.keys()].join('\0')
        expect(manifestKeysUnchanged).toBe(true)
        let nonSummaryEntriesUnchanged = true
        for (const [relative, beforeEntry] of copiedManifestBeforeSave) {
          const afterEntry = copiedManifestAfterSave.get(relative)
          if (relative === 'SUMMARY.md') continue
          nonSummaryEntriesUnchanged &&=
            afterEntry?.type === beforeEntry.type &&
            afterEntry.size === beforeEntry.size &&
            (beforeEntry.digest === null
              ? afterEntry.digest === null
              : Boolean(afterEntry.digest?.equals(beforeEntry.digest)))
        }
        expect(nonSummaryEntriesUnchanged).toBe(true)

        await structured.page.getByRole('button', { name: 'Export…' }).click()
        await expect(
          structured.page.locator('.export-status').filter({ hasText: 'Exported' })
        ).toBeVisible()
        await structured.page.getByRole('button', { name: 'Generate Website…' }).click()
        await expect(
          structured.page.locator('.export-status').filter({ hasText: 'Generated' })
        ).toBeVisible()
        const structuredOutput = await fs.readFile(structuredHtml, 'utf8')
        const structuredChapterCount = (structuredOutput.match(/class="leafbook-chapter"/g) ?? [])
          .length
        const structuredAliasCount = new Set(structuredOutput.match(/RC chapter \d{2}/g) ?? []).size
        expect(structuredChapterCount).toBe(1)
        expect(structuredAliasCount).toBe(34)
        const structuredSiteHtml = await fs.readFile(
          path.join(structuredWebsite, 'index.html'),
          'utf8'
        )
        const structuredSiteChapterCount = (
          structuredSiteHtml.match(/class="leafbook-chapter"/g) ?? []
        ).length
        const structuredSiteAliasCount = new Set(
          structuredSiteHtml.match(/RC chapter \d{2}/g) ?? []
        ).size
        expect(structuredSiteChapterCount).toBe(1)
        expect(structuredSiteAliasCount).toBe(34)
        expect((await getRendererErrors(structured.app)).length).toBe(0)
        await structured.app.close()
        activeApp = null
        const manuscriptUnchangedAfterStructuredTrack = (await hashFile(mainPath)).equals(
          manuscriptBefore
        )
        expect(manuscriptUnchangedAfterStructuredTrack).toBe(true)
      } finally {
        if (activeApp) await activeApp.close().catch(() => undefined)
        let sourceVerificationCompleted = false
        try {
          sourceUnchanged = sameManifest(before, await manifest(sourceRoot))
          sourceVerificationCompleted = true
        } finally {
          cleanupSucceeded = await safelyRemoveTempRoot(temporary.root, temporary.marker)
        }
        expect(sourceVerificationCompleted).toBe(true)
        expect(sourceUnchanged).toBe(true)
        expect(cleanupSucceeded).toBe(true)
      }
      console.log('RC_AUTHORIZED_SPEC_PASS')
    } catch {
      throw new Error('RC_HARNESS_PRIVATE_TEST_FAILURE')
    }
  })
})
