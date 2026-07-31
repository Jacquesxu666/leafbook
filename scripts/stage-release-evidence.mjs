#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino
const sameSnapshot = (left, right) =>
  sameIdentity(left, right) &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs
const sameDirectorySnapshot = (left, right) =>
  sameIdentity(left, right) && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs

const listExact = async (directory, expected) => {
  const actual = []
  const handle = await opendir(directory)
  for await (const entry of handle) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Unsafe staged evidence entry: ${entry.name}`)
    }
    actual.push(entry.name)
  }
  actual.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Staged evidence set does not match its exact allowlist')
  }
}

const stableHash = async (absolute, name, buffer) => {
  const before = await lstat(absolute)
  if (!before.isFile() || before.isSymbolicLink() || before.size === 0 || before.size > 1024 ** 3) {
    throw new Error(`Unsafe staged evidence subject: ${name}`)
  }
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameSnapshot(before, opened)) {
      throw new Error(`Staged evidence changed before hashing: ${name}`)
    }
    const hash = createHash('sha256')
    let total = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > opened.size || total > 1024 ** 3) {
        throw new Error(`Staged evidence exceeded its audited size: ${name}`)
      }
      hash.update(buffer.subarray(0, bytesRead))
    }
    const after = await handle.stat()
    const finalPath = await lstat(absolute)
    if (total !== opened.size || !sameSnapshot(opened, after) || !sameSnapshot(opened, finalPath)) {
      throw new Error(`Staged evidence changed while hashing: ${name}`)
    }
    return { digest: hash.digest('hex'), snapshot: opened }
  } finally {
    await handle.close()
  }
}

export const stageReleaseEvidence = async ({
  platform,
  architecture,
  sourceArgument,
  destinationArgument,
  afterDestinationHash
}) => {
  if (!['x64', 'arm64'].includes(architecture)) {
    throw new Error('Unsupported evidence architecture')
  }
  const metadata = JSON.parse(
    await readFile(path.join(root, 'packages/desktop/package.json'), 'utf8')
  )
  const version = metadata.version
  const expectedByPlatform = {
    macos: [
      `leafbook-mac-${architecture}-${version}.dmg`,
      `leafbook-mac-${architecture}-${version}.zip`
    ],
    linux: [
      `leafbook-linux-${architecture}-${version}.AppImage`,
      `leafbook-linux-${architecture}-${version}.deb`,
      `leafbook-linux-${architecture}-${version}.rpm`,
      `leafbook-linux-${architecture}-${version}.tar.gz`
    ],
    windows: [
      `leafbook-win-${architecture}-${version}-setup.exe`,
      `leafbook-win-${architecture}-${version}.zip`
    ]
  }
  const expected = expectedByPlatform[platform]
  if (!expected) throw new Error('Unsupported evidence platform')
  expected.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))

  const source = path.resolve(sourceArgument)
  const destination = path.resolve(destinationArgument)
  const sourceRoot = await lstat(source)
  if (!sourceRoot.isDirectory() || sourceRoot.isSymbolicLink()) {
    throw new Error('Evidence source must be a real directory')
  }
  if (destination === source || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error('Evidence destination must not be inside its source')
  }
  await mkdir(destination, { mode: 0o700 })

  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const transferHashes = new Map()
  for (const name of expected) {
    const sourceFile = path.join(source, name)
    const destinationFile = path.join(destination, name)
    const before = await lstat(sourceFile)
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size === 0 ||
      before.size > 1024 ** 3
    ) {
      throw new Error(`Unsafe evidence source: ${name}`)
    }
    const sourceHandle = await open(sourceFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let destinationHandle
    try {
      const opened = await sourceHandle.stat()
      if (!opened.isFile() || !sameSnapshot(before, opened)) {
        throw new Error(`Evidence source changed before copy: ${name}`)
      }
      destinationHandle = await open(
        destinationFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600
      )
      const transferHash = createHash('sha256')
      let total = 0
      while (true) {
        const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        total += bytesRead
        if (total > opened.size || total > 1024 ** 3) {
          throw new Error(`Evidence source exceeded its audited size: ${name}`)
        }
        transferHash.update(buffer.subarray(0, bytesRead))
        let offset = 0
        while (offset < bytesRead) {
          const { bytesWritten } = await destinationHandle.write(
            buffer,
            offset,
            bytesRead - offset,
            null
          )
          if (bytesWritten <= 0) throw new Error(`Evidence copy made no progress: ${name}`)
          offset += bytesWritten
        }
      }
      const after = await sourceHandle.stat()
      const finalSource = await lstat(sourceFile)
      if (
        total !== opened.size ||
        !sameSnapshot(opened, after) ||
        !sameSnapshot(opened, finalSource)
      ) {
        throw new Error(`Evidence source changed during copy: ${name}`)
      }
      await destinationHandle.sync()
      const copied = await destinationHandle.stat()
      if (!copied.isFile() || copied.size !== total) {
        throw new Error(`Evidence copy mismatch: ${name}`)
      }
      transferHashes.set(name, transferHash.digest('hex'))
    } finally {
      if (destinationHandle) await destinationHandle.close().catch(() => {})
      await sourceHandle.close()
    }
  }

  await listExact(destination, expected)
  const directoryBeforeHash = await lstat(destination)
  const hashed = new Map()
  for (const name of expected) {
    const destinationHash = await stableHash(path.join(destination, name), name, buffer)
    if (destinationHash.digest !== transferHashes.get(name)) {
      throw new Error(`Evidence destination hash differs from audited source: ${name}`)
    }
    hashed.set(name, destinationHash)
  }
  if (afterDestinationHash) await afterDestinationHash({ destination, expected: [...expected] })
  for (const name of expected) {
    const final = await lstat(path.join(destination, name))
    if (!sameSnapshot(hashed.get(name).snapshot, final)) {
      throw new Error(`Staged evidence changed after hashing: ${name}`)
    }
  }
  await listExact(destination, expected)
  const directoryAfterHash = await lstat(destination)
  if (!sameDirectorySnapshot(directoryBeforeHash, directoryAfterHash)) {
    throw new Error('Staged evidence directory changed while hashing')
  }

  const manifestPath = path.join(destination, 'SHA256SUMS.txt')
  const manifestHandle = await open(
    manifestPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600
  )
  try {
    const manifest = `${expected.map((name) => `${hashed.get(name).digest}  ${name}`).join('\n')}\n`
    await manifestHandle.writeFile(manifest, 'utf8')
    await manifestHandle.sync()
  } finally {
    await manifestHandle.close()
  }
  const withManifest = [...expected, 'SHA256SUMS.txt'].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right))
  )
  await listExact(destination, withManifest)
  for (const name of expected) {
    const final = await lstat(path.join(destination, name))
    if (!sameSnapshot(hashed.get(name).snapshot, final)) {
      throw new Error(`Staged evidence changed before manifest completion: ${name}`)
    }
  }
  const manifest = await lstat(manifestPath)
  if (!manifest.isFile() || manifest.isSymbolicLink()) throw new Error('Unsafe staged manifest')
  const finalDirectory = await lstat(destination)
  await listExact(destination, withManifest)
  const terminalDirectory = await lstat(destination)
  if (!sameDirectorySnapshot(finalDirectory, terminalDirectory)) {
    throw new Error('Staged evidence directory changed during final enumeration')
  }
  return { count: expected.length, platform, architecture }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [platform, architecture, sourceArgument, destinationArgument] = process.argv.slice(2)
  if (!platform || !architecture || !sourceArgument || !destinationArgument) {
    console.error(
      'Usage: stage-release-evidence.mjs {macos|linux|windows} {x64|arm64} SOURCE DESTINATION'
    )
    process.exit(2)
  }
  const result = await stageReleaseEvidence({
    platform,
    architecture,
    sourceArgument,
    destinationArgument
  })
  console.log(
    `Staged and hashed ${result.count} exact ${result.platform} ${result.architecture} subjects.`
  )
}
