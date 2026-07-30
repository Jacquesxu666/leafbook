#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RECEIPT_SCHEMA = 'leafbook-macos-content-tree-receipt/v2'
export const AUDIT_CONFIG_VERSION = 2
const MAX_TREE_ENTRIES = 100_000
const MAX_TREE_DEPTH = 128
const MAX_RELATIVE_PATH_BYTES = 4096
const MAX_TOTAL_REGULAR_BYTES = 650 * 1024 * 1024
const CRITICAL_FILES = [
  'Contents/MacOS/LeafBook',
  'Contents/Resources/app.asar',
  'Contents/Info.plist',
  'Contents/Resources/licenses/LICENSE',
  'Contents/Resources/licenses/NOTICE',
  'Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt'
]

const sha256Regular = async (filePath, expectedStat) => {
  const hash = createHash('sha256')
  const descriptor = await fsPromises.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const stat = await descriptor.stat()
    if (
      !stat.isFile() ||
      stat.dev !== expectedStat.dev ||
      stat.ino !== expectedStat.ino ||
      stat.size !== expectedStat.size
    ) {
      throw new Error(`regular file changed during receipt hashing: ${filePath}`)
    }
    const stream = descriptor.createReadStream({ autoClose: false })
    for await (const chunk of stream) hash.update(chunk)
    return hash.digest('hex')
  } finally {
    await descriptor.close()
  }
}

const canonicalDirectory = async (directory, label) => {
  const linkStat = await fsPromises.lstat(directory)
  if (!linkStat.isDirectory() || linkStat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink`)
  }
  const resolved = await fsPromises.realpath(directory)
  if (resolved !== path.resolve(directory)) {
    throw new Error(`${label} must already be canonical`)
  }
  return resolved
}

const assertContained = (root, target, label) => {
  const relative = path.relative(root, target)
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes fixed dist containment`)
  }
}

const receiptName = (architecture) => {
  if (!['arm64', 'x64'].includes(architecture)) throw new Error('Unsupported receipt architecture')
  return `leafbook-mac-${architecture}-audit-receipt.json`
}

const safeRelativePath = (segments) => {
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        typeof segment !== 'string' ||
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\0')
    )
  ) {
    throw new Error('bundle tree contains an unsafe relative path')
  }
  if (segments.length > MAX_TREE_DEPTH) {
    throw new Error('bundle tree exceeds maximum depth')
  }
  const relative = segments.join('/')
  if (Buffer.byteLength(relative, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    throw new Error('bundle tree path exceeds maximum byte length')
  }
  return relative
}

const collectBundleTree = async (canonicalApp) => {
  const entries = []
  let totalRegularBytes = 0
  const addEntry = (entry) => {
    entries.push(entry)
    if (entries.length > MAX_TREE_ENTRIES) {
      throw new Error('bundle tree exceeds maximum entry count')
    }
  }
  const visit = async (segments) => {
    const relative = safeRelativePath(segments)
    const absolute = path.join(canonicalApp, ...segments)
    const stat = await fsPromises.lstat(absolute)
    const mode = stat.mode & 0o7777
    if (stat.isDirectory()) {
      addEntry({ path: relative, type: 'directory', mode })
      // readdir returns discrete names rather than parsing newline-delimited
      // shell output, so every legal non-NUL filename is collected exactly.
      const names = await fsPromises.readdir(absolute)
      for (const name of names) await visit([...segments, name])
      return
    }
    if (stat.isFile()) {
      totalRegularBytes += stat.size
      if (totalRegularBytes > MAX_TOTAL_REGULAR_BYTES) {
        throw new Error('bundle tree exceeds maximum regular-file byte budget')
      }
      addEntry({
        path: relative,
        type: 'file',
        mode,
        size: stat.size,
        sha256: await sha256Regular(absolute, stat)
      })
      return
    }
    if (stat.isSymbolicLink()) {
      const target = await fsPromises.readlink(absolute)
      if (Buffer.byteLength(target, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
        throw new Error(`bundle symlink target is too long: ${relative}`)
      }
      const logicalTarget = path.resolve(path.dirname(absolute), target)
      if (
        path.isAbsolute(target) ||
        (logicalTarget !== canonicalApp && !logicalTarget.startsWith(`${canonicalApp}${path.sep}`))
      ) {
        throw new Error(`bundle symlink escapes app tree: ${relative} -> ${target}`)
      }
      const resolvedTarget = await fsPromises.realpath(absolute)
      if (
        resolvedTarget !== canonicalApp &&
        !resolvedTarget.startsWith(`${canonicalApp}${path.sep}`)
      ) {
        throw new Error(`bundle symlink resolves outside app tree: ${relative} -> ${target}`)
      }
      addEntry({ path: relative, type: 'symlink', mode, target })
      return
    }
    throw new Error(`unsupported FIFO/device/socket in app tree: ${relative}`)
  }

  const rootNames = await fsPromises.readdir(canonicalApp)
  for (const name of rootNames) await visit([name])
  entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'))
  )
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1].path === entries[index].path) {
      throw new Error(`duplicate app tree path: ${entries[index].path}`)
    }
  }
  return entries
}

export const buildReceipt = async ({ distRoot, appRelative, architecture, version }) => {
  const canonicalDist = await canonicalDirectory(distRoot, 'dist root')
  const textualApp = path.resolve(canonicalDist, appRelative)
  assertContained(canonicalDist, textualApp, 'app bundle')
  const appLinkStat = await fsPromises.lstat(textualApp)
  if (!appLinkStat.isDirectory() || appLinkStat.isSymbolicLink()) {
    throw new Error('app bundle must be a real directory, not a symlink')
  }
  const canonicalApp = await fsPromises.realpath(textualApp)
  if (canonicalApp !== textualApp) throw new Error('app bundle must already be canonical')
  const appStat = await fsPromises.stat(canonicalApp)

  const tree = await collectBundleTree(canonicalApp)
  for (const relative of CRITICAL_FILES) {
    if (!tree.some((entry) => entry.path === relative && entry.type === 'file')) {
      throw new Error(`critical identity/runtime file is missing from app tree: ${relative}`)
    }
  }

  return {
    schema: RECEIPT_SCHEMA,
    auditConfigVersion: AUDIT_CONFIG_VERSION,
    architecture,
    identity: {
      bundleIdentifier: 'com.jacquesxu.leafbook',
      displayName: 'LeafBook',
      executable: 'LeafBook',
      version
    },
    bundle: {
      relativePath: appRelative.split(path.sep).join('/'),
      realPath: canonicalApp,
      device: String(appStat.dev),
      inode: String(appStat.ino)
    },
    tree
  }
}

export const writeReceipt = async (options) => {
  const receipt = await buildReceipt(options)
  const auditDirectory = path.join(path.resolve(options.distRoot), 'audit')
  if (fs.existsSync(auditDirectory)) {
    await canonicalDirectory(auditDirectory, 'receipt directory')
  } else {
    await fsPromises.mkdir(auditDirectory, { mode: 0o700 })
  }
  const receiptPath = path.join(auditDirectory, receiptName(options.architecture))
  if (fs.existsSync(receiptPath)) {
    const stat = await fsPromises.lstat(receiptPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('receipt target is not a regular file')
    }
  }
  const temporary = path.join(
    auditDirectory,
    `.${receiptName(options.architecture)}.${process.pid}.tmp`
  )
  await fsPromises.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600
  })
  await fsPromises.rename(temporary, receiptPath)
  return receiptPath
}

export const verifyReceipt = async (options) => {
  const canonicalDist = await canonicalDirectory(options.distRoot, 'dist root')
  const auditDirectory = await canonicalDirectory(
    path.join(canonicalDist, 'audit'),
    'receipt directory'
  )
  assertContained(canonicalDist, auditDirectory, 'receipt directory')
  const receiptPath = path.join(auditDirectory, receiptName(options.architecture))
  const receiptStat = await fsPromises.lstat(receiptPath)
  if (
    !receiptStat.isFile() ||
    receiptStat.isSymbolicLink() ||
    receiptStat.size > 64 * 1024 * 1024
  ) {
    throw new Error('receipt must be a bounded regular non-symlink file')
  }
  const actual = JSON.parse(await fsPromises.readFile(receiptPath, 'utf8'))
  const expected = await buildReceipt(options)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('audit receipt is stale or does not bind the exact app content tree')
  }
  return receiptPath
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, architecture, version] = process.argv.slice(2)
  const appDirectory = architecture === 'arm64' ? 'mac-arm64' : architecture === 'x64' ? 'mac' : ''
  if (!['create', 'verify'].includes(mode) || !appDirectory || !version) {
    console.error('Usage: mac-audit-receipt.mjs {create|verify} {arm64|x64} VERSION')
    process.exit(1)
  }
  const options = {
    distRoot: path.join(repositoryRoot, 'dist'),
    appRelative: path.join(appDirectory, 'LeafBook.app'),
    architecture,
    version
  }
  try {
    const receiptPath =
      mode === 'create' ? await writeReceipt(options) : await verifyReceipt(options)
    console.log(`${mode === 'create' ? 'Wrote' : 'Verified'} audit receipt: ${receiptPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
