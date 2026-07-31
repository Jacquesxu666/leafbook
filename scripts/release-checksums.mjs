#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

const mode = process.argv[2]
const directory = path.resolve(process.argv[3] ?? '')
const manifestName = process.argv[4] ?? 'SHA256SUMS.txt'
if (
  !['write', 'verify'].includes(mode) ||
  !process.argv[3] ||
  path.basename(manifestName) !== manifestName ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifestName)
) {
  console.error('Usage: release-checksums.mjs {write|verify} DIRECTORY [MANIFEST_NAME]')
  process.exit(2)
}

const directoryStat = await lstat(directory)
if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
  throw new Error('Checksum root must be a real directory')
}

const manifestPath = path.join(directory, manifestName)
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino
const sameSnapshot = (left, right) =>
  sameIdentity(left, right) &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs
const manifestStat = async (required) => {
  try {
    const stat = await lstat(manifestPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Checksum manifest must be a regular non-symlink file: ${manifestPath}`)
    }
    return stat
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return null
    throw error
  }
}
const listSubjects = async () => {
  const names = []
  const handle = await opendir(directory)
  for await (const entry of handle) {
    if (entry.name === manifestName) continue
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.name.includes('\n') ||
      entry.name.includes('\r')
    ) {
      throw new Error(`Unsafe non-regular checksum subject: ${entry.name}`)
    }
    names.push(entry.name)
  }
  names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  if (names.length === 0) throw new Error('Checksum root contains no release subjects')
  return names
}

const buffer = Buffer.allocUnsafe(1024 * 1024)
const stableHash = async (name) => {
  const absolute = path.join(directory, name)
  const before = await lstat(absolute)
  if (!before.isFile() || before.isSymbolicLink() || before.size === 0 || before.size > 1024 ** 3) {
    throw new Error(`Unsafe checksum subject: ${name}`)
  }
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameSnapshot(before, opened)) {
      throw new Error(`Checksum subject changed before hashing: ${name}`)
    }
    const hash = createHash('sha256')
    let total = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > opened.size || total > 1024 ** 3) {
        throw new Error(`Checksum subject exceeded its audited size: ${name}`)
      }
      hash.update(buffer.subarray(0, bytesRead))
    }
    const after = await handle.stat()
    const finalPath = await lstat(absolute)
    if (total !== opened.size || !sameSnapshot(opened, after) || !sameSnapshot(opened, finalPath)) {
      throw new Error(`Checksum subject changed while hashing: ${name}`)
    }
    return { digest: hash.digest('hex'), snapshot: opened }
  } finally {
    await handle.close()
  }
}

const stableReadManifest = async (initial) => {
  const handle = await open(manifestPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameSnapshot(initial, opened) || opened.size > 16 * 1024 * 1024) {
      throw new Error('Checksum manifest changed before verification or exceeds 16 MiB')
    }
    const chunks = []
    let total = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > opened.size || total > 16 * 1024 * 1024) {
        throw new Error('Checksum manifest exceeded its audited size')
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    const after = await handle.stat()
    const finalPath = await manifestStat(true)
    if (total !== opened.size || !sameSnapshot(opened, after) || !sameSnapshot(opened, finalPath)) {
      throw new Error('Checksum manifest changed while it was read')
    }
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    await handle.close()
  }
}

const initialManifest = await manifestStat(mode === 'verify')
const names = await listSubjects()
const hashed = new Map()
for (const name of names) hashed.set(name, await stableHash(name))
const expected = `${names.map((name) => `${hashed.get(name).digest}  ${name}`).join('\n')}\n`

if (mode === 'write') {
  const temporaryPath = path.join(
    directory,
    `.${manifestName}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
  )
  let temporaryHandle
  try {
    temporaryHandle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600
    )
    await temporaryHandle.writeFile(expected, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = undefined
    const currentManifest = await manifestStat(initialManifest !== null)
    if (
      (initialManifest === null && currentManifest !== null) ||
      (initialManifest !== null &&
        (currentManifest === null || !sameIdentity(initialManifest, currentManifest)))
    ) {
      throw new Error('Checksum manifest identity changed before atomic replacement')
    }
    await rename(temporaryPath, manifestPath)
    const written = await manifestStat(true)
    if (written.size !== Buffer.byteLength(expected, 'utf8')) {
      throw new Error('Checksum manifest size changed after atomic replacement')
    }
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {})
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
} else {
  const actual = await stableReadManifest(initialManifest)
  if (actual !== expected) throw new Error(`Checksum manifest mismatch: ${manifestPath}`)
}

const finalNames = await listSubjects()
if (JSON.stringify(finalNames) !== JSON.stringify(names)) {
  throw new Error('Checksum subject set changed during verification')
}
for (const name of names) {
  const final = await lstat(path.join(directory, name))
  if (
    !final.isFile() ||
    final.isSymbolicLink() ||
    !sameSnapshot(hashed.get(name).snapshot, final)
  ) {
    throw new Error(`Checksum subject identity changed after hashing: ${name}`)
  }
}
const finalDirectory = await lstat(directory)
if (
  !finalDirectory.isDirectory() ||
  finalDirectory.isSymbolicLink() ||
  !sameIdentity(directoryStat, finalDirectory)
) {
  throw new Error('Checksum root identity changed')
}
console.log(`${mode === 'write' ? 'Wrote' : 'Verified'} ${names.length} checksums: ${manifestPath}`)
