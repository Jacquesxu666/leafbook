#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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
  'Contents/Resources/app.asar',
  'Contents/Info.plist',
  'Contents/Resources/licenses/LICENSE',
  'Contents/Resources/licenses/NOTICE',
  'Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt'
]

const parsePlist = (bytes) => {
  const output = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
    input: bytes,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const plist = JSON.parse(output.toString('utf8'))
  const identity = {
    bundleIdentifier: plist.CFBundleIdentifier,
    displayName: plist.CFBundleDisplayName,
    executable: plist.CFBundleExecutable,
    version: plist.CFBundleShortVersionString
  }
  if (
    Object.values(identity).some((value) => typeof value !== 'string' || value.length === 0) ||
    identity.executable.includes('/') ||
    identity.executable.includes('\0')
  ) {
    throw new Error('Info.plist does not contain a complete safe bundle identity')
  }
  return identity
}

const cpuArchitecture = (cpuType) => {
  if (cpuType === 0x0100000c) return 'arm64'
  if (cpuType === 0x01000007) return 'x64'
  throw new Error(`unsupported Mach-O CPU type: ${cpuType}`)
}

const machoArchitectures = (bytes) => {
  if (bytes.byteLength < 8) throw new Error('Mach-O executable header is truncated')
  const magic = bytes.readUInt32BE(0)
  if ([0xfeedface, 0xfeedfacf].includes(magic)) {
    return [cpuArchitecture(bytes.readUInt32BE(4))]
  }
  if ([0xcefaedfe, 0xcffaedfe].includes(magic)) {
    return [cpuArchitecture(bytes.readUInt32LE(4))]
  }
  const formats = new Map([
    [0xcafebabe, { little: false, width: 20 }],
    [0xbebafeca, { little: true, width: 20 }],
    [0xcafebabf, { little: false, width: 32 }],
    [0xbfbafeca, { little: true, width: 32 }]
  ])
  const format = formats.get(magic)
  if (!format) throw new Error('bundle executable is not a recognized Mach-O binary')
  const read32 = format.little
    ? (offset) => bytes.readUInt32LE(offset)
    : (offset) => bytes.readUInt32BE(offset)
  const count = read32(4)
  if (count === 0 || count > 16 || 8 + count * format.width > bytes.byteLength) {
    throw new Error('Mach-O universal header is malformed')
  }
  const architectures = new Set()
  for (let index = 0; index < count; index++) {
    architectures.add(cpuArchitecture(read32(8 + index * format.width)))
  }
  return [...architectures].sort()
}

const sameStableStat = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const stableStatRecord = (stat) => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  mode: String(stat.mode),
  nlink: String(stat.nlink),
  size: String(stat.size),
  mtimeNs: String(stat.mtimeNs),
  ctimeNs: String(stat.ctimeNs)
})

const stableRegular = async (
  filePath,
  maximumBytes = MAX_TOTAL_REGULAR_BYTES,
  { passIndex = 0, relativePath = '', onStableReadChunk } = {}
) => {
  const hash = createHash('sha256')
  const descriptor = await fsPromises.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const before = await descriptor.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumBytes)) {
      throw new Error(`regular file violates receipt policy: ${filePath}`)
    }
    const bytes = []
    const prefixChunks = []
    let prefixBytes = 0
    let bytesRead = 0
    const retainBytes = before.size <= 64n * 1024n * 1024n
    const stream = descriptor.createReadStream({ autoClose: false, start: 0 })
    for await (const chunk of stream) {
      hash.update(chunk)
      bytesRead += chunk.byteLength
      if (retainBytes) bytes.push(chunk)
      if (prefixBytes < 16 * 1024) {
        const part = chunk.subarray(0, 16 * 1024 - prefixBytes)
        prefixChunks.push(part)
        prefixBytes += part.byteLength
      }
      if (onStableReadChunk) {
        await onStableReadChunk(passIndex, relativePath, bytesRead)
      }
    }
    const [after, pathname] = await Promise.all([
      descriptor.stat({ bigint: true }),
      fsPromises.lstat(filePath, { bigint: true })
    ])
    if (
      !after.isFile() ||
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      after.nlink !== 1n ||
      pathname.nlink !== 1n ||
      !sameStableStat(before, after) ||
      !sameStableStat(before, pathname)
    ) {
      throw new Error(`regular file changed during receipt hashing: ${filePath}`)
    }
    return {
      sha256: hash.digest('hex'),
      stat: before,
      bytes: retainBytes ? Buffer.concat(bytes) : null,
      prefix: Buffer.concat(prefixChunks)
    }
  } finally {
    await descriptor.close()
  }
}

const canonicalDirectory = async (directory, label) => {
  const linkStat = await fsPromises.lstat(directory, { bigint: true })
  if (!linkStat.isDirectory() || linkStat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink`)
  }
  const resolved = await fsPromises.realpath(directory)
  if (resolved !== path.resolve(directory)) {
    throw new Error(`${label} must already be canonical`)
  }
  const after = await fsPromises.lstat(directory, { bigint: true })
  if (!sameStableStat(linkStat, after)) throw new Error(`${label} changed during canonicalization`)
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

export const collectStableBundleSnapshotOnce = async (
  canonicalApp,
  { passIndex = 0, onSnapshotFile, onStableReadChunk } = {}
) => {
  const entries = []
  const identity = []
  let totalRegularBytes = 0n
  const addEntry = (entry) => {
    entries.push(entry)
    if (entries.length > MAX_TREE_ENTRIES) {
      throw new Error('bundle tree exceeds maximum entry count')
    }
  }
  const sortedNames = async (absolute) =>
    (await fsPromises.readdir(absolute)).sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    )
  const visitDirectory = async (segments, includeEntry) => {
    const absolute = path.join(canonicalApp, ...segments)
    const before = await fsPromises.lstat(absolute, { bigint: true })
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error('bundle directory changed or became a symlink')
    }
    if (includeEntry) {
      addEntry({
        path: safeRelativePath(segments),
        type: 'directory',
        mode: Number(before.mode & 0o7777n)
      })
    }
    const names = await sortedNames(absolute)
    identity.push({
      path: segments.length ? safeRelativePath(segments) : '.',
      type: 'directory',
      stat: stableStatRecord(before),
      names
    })
    for (const name of names) await visit([...segments, name])
    const [afterNames, after] = await Promise.all([
      sortedNames(absolute),
      fsPromises.lstat(absolute, { bigint: true })
    ])
    if (
      !sameStableStat(before, after) ||
      names.length !== afterNames.length ||
      names.some((name, index) => name !== afterNames[index])
    ) {
      throw new Error(`bundle directory changed during receipt snapshot: ${absolute}`)
    }
  }
  const visit = async (segments) => {
    const relative = safeRelativePath(segments)
    const absolute = path.join(canonicalApp, ...segments)
    const stat = await fsPromises.lstat(absolute, { bigint: true })
    const mode = Number(stat.mode & 0o7777n)
    if (stat.isDirectory()) {
      await visitDirectory(segments, true)
      return
    }
    if (stat.isFile()) {
      totalRegularBytes += stat.size
      if (totalRegularBytes > BigInt(MAX_TOTAL_REGULAR_BYTES)) {
        throw new Error('bundle tree exceeds maximum regular-file byte budget')
      }
      const stable = await stableRegular(absolute, MAX_TOTAL_REGULAR_BYTES, {
        passIndex,
        relativePath: relative,
        onStableReadChunk
      })
      if (!sameStableStat(stat, stable.stat)) {
        throw new Error(`regular file changed before receipt hashing: ${relative}`)
      }
      addEntry({
        path: relative,
        type: 'file',
        mode,
        size: Number(stat.size),
        sha256: stable.sha256
      })
      identity.push({ path: relative, type: 'file', stat: stableStatRecord(stable.stat) })
      if (onSnapshotFile) await onSnapshotFile(passIndex, relative)
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
      const after = await fsPromises.lstat(absolute, { bigint: true })
      if (!sameStableStat(stat, after) || (await fsPromises.readlink(absolute)) !== target) {
        throw new Error(`bundle symlink changed during receipt snapshot: ${relative}`)
      }
      addEntry({ path: relative, type: 'symlink', mode, target })
      identity.push({ path: relative, type: 'symlink', stat: stableStatRecord(stat), target })
      return
    }
    throw new Error(`unsupported FIFO/device/socket in app tree: ${relative}`)
  }

  await visitDirectory([], false)
  entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'))
  )
  identity.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'))
  )
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1].path === entries[index].path) {
      throw new Error(`duplicate app tree path: ${entries[index].path}`)
    }
  }
  return { entries, identity }
}

export const collectBundleTree = async (
  canonicalApp,
  { onSnapshotFile, onStableReadChunk } = {}
) => {
  const first = await collectStableBundleSnapshotOnce(canonicalApp, {
    passIndex: 1,
    onSnapshotFile,
    onStableReadChunk
  })
  const second = await collectStableBundleSnapshotOnce(canonicalApp, {
    passIndex: 2,
    onSnapshotFile,
    onStableReadChunk
  })
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('bundle changed between complete receipt snapshots')
  }
  const terminal = await collectStableBundleSnapshotOnce(canonicalApp, {
    passIndex: 3,
    onSnapshotFile,
    onStableReadChunk
  })
  if (JSON.stringify(second.identity) !== JSON.stringify(terminal.identity)) {
    throw new Error('bundle identity changed during terminal full-tree scan')
  }
  if (JSON.stringify(second.entries) !== JSON.stringify(terminal.entries)) {
    throw new Error('bundle content changed during terminal full-tree scan')
  }
  return terminal.entries
}

export const buildReceipt = async (
  { distRoot, appRelative, architecture, version },
  { onSnapshotFile, onStableReadChunk } = {}
) => {
  if (!['arm64', 'x64'].includes(architecture)) throw new Error('Unsupported receipt architecture')
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Missing receipt version')
  }
  const canonicalDist = await canonicalDirectory(distRoot, 'dist root')
  const textualApp = path.resolve(canonicalDist, appRelative)
  assertContained(canonicalDist, textualApp, 'app bundle')
  const appLinkStat = await fsPromises.lstat(textualApp, { bigint: true })
  if (!appLinkStat.isDirectory() || appLinkStat.isSymbolicLink()) {
    throw new Error('app bundle must be a real directory, not a symlink')
  }
  const canonicalApp = await fsPromises.realpath(textualApp)
  if (canonicalApp !== textualApp) throw new Error('app bundle must already be canonical')
  const appStat = await fsPromises.lstat(canonicalApp, { bigint: true })

  const tree = await collectBundleTree(canonicalApp, {
    onSnapshotFile,
    onStableReadChunk
  })
  const infoFile = await stableRegular(path.join(canonicalApp, 'Contents', 'Info.plist'))
  if (!infoFile.bytes) throw new Error('Info.plist exceeds stable parsing budget')
  const identity = parsePlist(infoFile.bytes)
  if (
    identity.bundleIdentifier !== 'com.jacquesxu.leafbook' ||
    identity.displayName !== 'LeafBook' ||
    identity.version !== version
  ) {
    throw new Error('Info.plist identity/version does not match release configuration')
  }
  const executableRelative = `Contents/MacOS/${identity.executable}`
  const executableFile = await stableRegular(path.join(canonicalApp, executableRelative))
  const detectedArchitectures = machoArchitectures(executableFile.prefix)
  if (detectedArchitectures.length !== 1 || detectedArchitectures[0] !== architecture) {
    throw new Error(
      `Mach-O architecture ${detectedArchitectures.join(',')} does not match ${architecture}`
    )
  }
  for (const relative of CRITICAL_FILES) {
    if (!tree.some((entry) => entry.path === relative && entry.type === 'file')) {
      throw new Error(`critical identity/runtime file is missing from app tree: ${relative}`)
    }
  }
  if (!tree.some((entry) => entry.path === executableRelative && entry.type === 'file')) {
    throw new Error(`bundle executable is missing from app tree: ${executableRelative}`)
  }
  const appAfter = await fsPromises.lstat(canonicalApp, { bigint: true })
  if (!sameStableStat(appStat, appAfter)) throw new Error('app bundle changed during receipt build')

  return {
    schema: RECEIPT_SCHEMA,
    auditConfigVersion: AUDIT_CONFIG_VERSION,
    architecture,
    identity,
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
    const stat = await fsPromises.lstat(receiptPath, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
      throw new Error('receipt target is not a regular file')
    }
  }
  const temporary = path.join(
    auditDirectory,
    `.${receiptName(options.architecture)}.${randomBytes(12).toString('hex')}.tmp`
  )
  const serialized = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
  await fsPromises.writeFile(temporary, serialized, {
    flag: 'wx',
    mode: 0o600
  })
  const temporaryFile = await stableRegular(temporary, 64 * 1024 * 1024)
  if (
    !temporaryFile.bytes?.equals(serialized) ||
    temporaryFile.stat.nlink !== 1n ||
    Number(temporaryFile.stat.mode & 0o777n) !== 0o600
  ) {
    throw new Error('temporary receipt changed before publication')
  }
  await fsPromises.rename(temporary, receiptPath)
  const published = await stableRegular(receiptPath, 64 * 1024 * 1024)
  if (!published.bytes?.equals(serialized)) throw new Error('published receipt changed')
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
  const receiptStat = await fsPromises.lstat(receiptPath, { bigint: true })
  if (
    !receiptStat.isFile() ||
    receiptStat.isSymbolicLink() ||
    receiptStat.nlink !== 1n ||
    receiptStat.size > 64n * 1024n * 1024n
  ) {
    throw new Error('receipt must be a bounded regular non-symlink file')
  }
  const receiptFile = await stableRegular(receiptPath, 64 * 1024 * 1024)
  if (!sameStableStat(receiptStat, receiptFile.stat) || !receiptFile.bytes) {
    throw new Error('receipt changed before stable verification')
  }
  const actual = JSON.parse(receiptFile.bytes.toString('utf8'))
  const expected = await buildReceipt(options)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('audit receipt is stale or does not bind the exact app content tree')
  }
  return receiptPath
}

const modulePath = fileURLToPath(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(modulePath), '..')

export const runCli = async (argv = process.argv.slice(2)) => {
  const [mode, architecture, version] = argv
  const appDirectory = architecture === 'arm64' ? 'mac-arm64' : architecture === 'x64' ? 'mac' : ''
  if (argv.length !== 3 || !['create', 'verify'].includes(mode) || !appDirectory || !version) {
    console.error('Usage: mac-audit-receipt.mjs {create|verify} {arm64|x64} VERSION')
    return 1
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
    return 1
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  process.exitCode = await runCli()
}
