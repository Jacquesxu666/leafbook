#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildReceipt, collectStableBundleSnapshotOnce } from './mac-audit-receipt.mjs'

const sameStat = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const statRecord = (stat) => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  mode: String(stat.mode),
  nlink: String(stat.nlink),
  size: String(stat.size),
  mtimeNs: String(stat.mtimeNs),
  ctimeNs: String(stat.ctimeNs),
  uid: String(stat.uid),
  gid: String(stat.gid)
})

const matchesRecord = (stat, record) =>
  Object.entries(statRecord(stat)).every(([key, value]) => record[key] === value)

const hashStable = async (filePath, retainBytes = false) => {
  const handle = await fsPromises.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n) throw new Error('snapshot file policy')
    const hash = createHash('sha256')
    const chunks = []
    const stream = handle.createReadStream({ autoClose: false, start: 0 })
    for await (const chunk of stream) {
      hash.update(chunk)
      if (retainBytes) chunks.push(chunk)
    }
    const [after, pathname] = await Promise.all([
      handle.stat({ bigint: true }),
      fsPromises.lstat(filePath, { bigint: true })
    ])
    if (
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      pathname.nlink !== 1n ||
      !sameStat(before, after) ||
      !sameStat(before, pathname)
    ) {
      throw new Error('snapshot file changed')
    }
    return {
      sha256: hash.digest('hex'),
      stat: before,
      bytes: retainBytes ? Buffer.concat(chunks) : null
    }
  } finally {
    await handle.close()
  }
}

const writeState = async (statePath, state) => {
  await fsPromises.writeFile(statePath, `${JSON.stringify(state)}\n`, {
    flag: 'wx',
    mode: 0o600
  })
  return (await hashStable(statePath)).sha256
}

const readState = async (statePath, expectedHash) => {
  const stable = await hashStable(statePath, true)
  if (
    !/^[0-9a-f]{64}$/u.test(expectedHash) ||
    stable.sha256 !== expectedHash ||
    !stable.bytes ||
    stable.bytes.byteLength > 64 * 1024 * 1024
  ) {
    throw new Error('snapshot state exceeds policy')
  }
  return JSON.parse(stable.bytes.toString('utf8'))
}

const copyArchive = async (
  source,
  destination,
  expectedName,
  expectedHash,
  version,
  architecture
) => {
  if (
    !path.isAbsolute(source) ||
    !path.isAbsolute(destination) ||
    path.basename(source) !== expectedName ||
    !/^[0-9a-f]{64}$/u.test(expectedHash) ||
    !expectedName.includes(`electron-v${version}-darwin-${architecture}.zip`)
  ) {
    throw new Error('Electron archive identity mismatch')
  }
  const sourceHandle = await fsPromises.open(
    source,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  const destinationHandle = await fsPromises.open(
    destination,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    0o600
  )
  let before
  try {
    before = await sourceHandle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n) throw new Error('Electron archive source policy')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < before.size) {
      const remaining = before.size - BigInt(position)
      const length = Number(
        remaining > BigInt(buffer.byteLength) ? BigInt(buffer.byteLength) : remaining
      )
      const { bytesRead } = await sourceHandle.read(buffer, 0, length, position)
      if (bytesRead === 0) throw new Error('Electron archive truncated during private copy')
      let written = 0
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        )
        written += result.bytesWritten
      }
      position += bytesRead
    }
    await destinationHandle.sync()
    const [sourceAfter, sourcePathname] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      fsPromises.lstat(source, { bigint: true })
    ])
    if (!sameStat(before, sourceAfter) || !sameStat(before, sourcePathname)) {
      throw new Error('Electron archive changed during private copy')
    }
  } finally {
    await Promise.allSettled([sourceHandle.close(), destinationHandle.close()])
  }
  const copied = await hashStable(destination)
  if (
    copied.sha256 !== expectedHash ||
    copied.stat.size !== before.size ||
    Number(copied.stat.mode & 0o777n) !== 0o600
  ) {
    throw new Error('private Electron archive verification failed')
  }
  return { path: destination, sha256: copied.sha256, stat: statRecord(copied.stat) }
}

const verifyArchive = async (state) => {
  const copied = await hashStable(state.path)
  if (copied.sha256 !== state.sha256 || !matchesRecord(copied.stat, state.stat)) {
    throw new Error('private Electron archive changed')
  }
}

const comparableReceipt = (receipt) => ({
  schema: receipt.schema,
  auditConfigVersion: receipt.auditConfigVersion,
  architecture: receipt.architecture,
  identity: receipt.identity,
  tree: receipt.tree
})

const identityTree = async (root) => {
  const first = await collectStableBundleSnapshotOnce(root)
  const second = await collectStableBundleSnapshotOnce(root)
  const terminal = await collectStableBundleSnapshotOnce(root)
  if (
    JSON.stringify(first) !== JSON.stringify(second) ||
    JSON.stringify(second) !== JSON.stringify(terminal)
  ) {
    throw new Error('private app changed across complete tree snapshots')
  }
  return terminal.identity
}

const copyApp = async (distRoot, appRelative, architecture, version, destination) => {
  const sourceReceipt = await buildReceipt({ distRoot, appRelative, architecture, version })
  await fsPromises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await fsPromises.cp(path.join(distRoot, appRelative), destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
    verbatimSymlinks: true,
    preserveTimestamps: true
  })
  const snapshotRoot = path.dirname(path.dirname(destination))
  const snapshotRelative = path.relative(snapshotRoot, destination)
  const snapshotReceipt = await buildReceipt({
    distRoot: snapshotRoot,
    appRelative: snapshotRelative,
    architecture,
    version
  })
  const sourceAfter = await buildReceipt({ distRoot, appRelative, architecture, version })
  if (
    JSON.stringify(sourceReceipt) !== JSON.stringify(sourceAfter) ||
    JSON.stringify(comparableReceipt(sourceReceipt)) !==
      JSON.stringify(comparableReceipt(snapshotReceipt))
  ) {
    throw new Error('app changed during private snapshot')
  }
  return {
    snapshotRoot,
    snapshotRelative,
    architecture,
    version,
    receipt: snapshotReceipt,
    identity: await identityTree(destination)
  }
}

const verifyApp = async (state) => {
  const actual = await buildReceipt({
    distRoot: state.snapshotRoot,
    appRelative: state.snapshotRelative,
    architecture: state.architecture,
    version: state.version
  })
  const identity = await identityTree(path.join(state.snapshotRoot, state.snapshotRelative))
  if (
    JSON.stringify(actual) !== JSON.stringify(state.receipt) ||
    JSON.stringify(identity) !== JSON.stringify(state.identity)
  ) {
    throw new Error('private app snapshot changed')
  }
}

const snapshotPublishedArtifacts = async (
  distRoot,
  appRelative,
  architecture,
  version,
  zipPath,
  dmgPath
) => {
  const appPath = path.join(distRoot, appRelative)
  const [receipt, identity, zip, dmg] = await Promise.all([
    buildReceipt({ distRoot, appRelative, architecture, version }),
    identityTree(appPath),
    hashStable(zipPath),
    hashStable(dmgPath)
  ])
  return {
    distRoot,
    appRelative,
    architecture,
    version,
    zipPath,
    dmgPath,
    receipt,
    identity,
    zip: { sha256: zip.sha256, stat: statRecord(zip.stat) },
    dmg: { sha256: dmg.sha256, stat: statRecord(dmg.stat) }
  }
}

const verifyPublishedArtifacts = async (state) => {
  const actual = await snapshotPublishedArtifacts(
    state.distRoot,
    state.appRelative,
    state.architecture,
    state.version,
    state.zipPath,
    state.dmgPath
  )
  if (JSON.stringify(actual) !== JSON.stringify(state)) {
    throw new Error('published app/ZIP/DMG changed across artifact audit')
  }
}

const copyStableRegular = async (source, destination) => {
  const before = await hashStable(source)
  await fsPromises.copyFile(source, destination, fs.constants.COPYFILE_EXCL)
  await fsPromises.chmod(destination, Number(before.stat.mode & 0o777n))
  const [sourceAfter, copied] = await Promise.all([hashStable(source), hashStable(destination)])
  if (
    sourceAfter.sha256 !== before.sha256 ||
    !sameStat(sourceAfter.stat, before.stat) ||
    copied.sha256 !== before.sha256 ||
    copied.stat.size !== before.stat.size
  ) {
    throw new Error('published carrier changed during private audit copy')
  }
}

const copyPublishedForAudit = async (
  distRoot,
  appRelative,
  architecture,
  version,
  zipPath,
  dmgPath,
  auditRoot
) => {
  const before = await snapshotPublishedArtifacts(
    distRoot,
    appRelative,
    architecture,
    version,
    zipPath,
    dmgPath
  )
  const auditApp = path.join(auditRoot, appRelative)
  await fsPromises.mkdir(path.dirname(auditApp), { recursive: true, mode: 0o700 })
  await fsPromises.cp(path.join(distRoot, appRelative), auditApp, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
    verbatimSymlinks: true,
    preserveTimestamps: true
  })
  const auditZip = path.join(auditRoot, path.basename(zipPath))
  const auditDmg = path.join(auditRoot, path.basename(dmgPath))
  await Promise.all([copyStableRegular(zipPath, auditZip), copyStableRegular(dmgPath, auditDmg)])
  const after = await snapshotPublishedArtifacts(
    distRoot,
    appRelative,
    architecture,
    version,
    zipPath,
    dmgPath
  )
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('published artifacts changed during private audit copy')
  }
  return { public: before, auditRoot, auditZip, auditDmg }
}

const verifyPublishedAuditCopy = async (state) => {
  await verifyPublishedArtifacts(state.public)
  const auditReceipt = await buildReceipt({
    distRoot: state.auditRoot,
    appRelative: state.public.appRelative,
    architecture: state.public.architecture,
    version: state.public.version
  })
  const [auditZip, auditDmg] = await Promise.all([
    hashStable(state.auditZip),
    hashStable(state.auditDmg)
  ])
  if (
    JSON.stringify(comparableReceipt(auditReceipt)) !==
      JSON.stringify(comparableReceipt(state.public.receipt)) ||
    auditZip.sha256 !== state.public.zip.sha256 ||
    auditDmg.sha256 !== state.public.dmg.sha256
  ) {
    throw new Error('audited private copy differs from published artifacts')
  }
}

const createRootState = async (directory, token, statePath) => {
  const canonicalTemporary = await fsPromises.realpath(os.tmpdir())
  const canonical = await fsPromises.realpath(directory)
  const stat = await fsPromises.lstat(directory, { bigint: true })
  if (
    canonical !== directory ||
    !canonical.startsWith(path.join(canonicalTemporary, 'leafbook-package-')) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    Number(stat.mode & 0o777n) !== 0o700 ||
    (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))
  ) {
    throw new Error('private package root creation validation failed')
  }
  const state = { directory, token, stat: statRecord(stat) }
  const stateHash = await writeState(statePath, state)
  process.stdout.write(
    `${stateHash}\t${state.stat.dev}\t${state.stat.ino}\t${state.stat.uid ?? String(stat.uid)}\t${state.stat.mode}\n`
  )
}

const cleanup = async (
  directory,
  token,
  expectedDev,
  expectedIno,
  expectedUid,
  expectedMode,
  statePath,
  stateHash
) => {
  const state = await readState(statePath, stateHash)
  const canonicalTemporary = await fsPromises.realpath(os.tmpdir())
  const canonical = await fsPromises.realpath(directory)
  const stat = await fsPromises.lstat(directory, { bigint: true })
  const markerPath = path.join(directory, '.leafbook-package-owner')
  const marker = await hashStable(markerPath, true)
  const markerBytes = marker.bytes?.toString('utf8')
  if (
    canonical !== directory ||
    !canonical.startsWith(path.join(canonicalTemporary, 'leafbook-package-')) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    Number(stat.mode & 0o777n) !== 0o700 ||
    (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) ||
    markerBytes !== token ||
    marker.stat.nlink !== 1n ||
    String(stat.dev) !== expectedDev ||
    String(stat.ino) !== expectedIno ||
    String(stat.uid) !== expectedUid ||
    String(stat.mode) !== expectedMode ||
    state.directory !== directory ||
    state.token !== token ||
    state.stat.dev !== expectedDev ||
    state.stat.ino !== expectedIno ||
    state.stat.uid !== expectedUid ||
    state.stat.mode !== expectedMode
  ) {
    throw new Error('private package cleanup validation failed')
  }
  await fsPromises.rm(directory, { recursive: true })
  try {
    await fsPromises.lstat(directory)
    throw new Error('private package cleanup did not remove directory')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await fsPromises.unlink(statePath)
}

const [command, ...args] = process.argv.slice(2)
if (command === 'archive-copy' && args.length === 7) {
  const [source, destination, expectedName, expectedHash, version, architecture, statePath] = args
  process.stdout.write(
    `${await writeState(
      statePath,
      await copyArchive(source, destination, expectedName, expectedHash, version, architecture)
    )}\n`
  )
} else if (command === 'archive-verify' && args.length === 2) {
  await verifyArchive(await readState(args[0], args[1]))
} else if (command === 'app-copy' && args.length === 6) {
  const [distRoot, appRelative, architecture, version, destination, statePath] = args
  process.stdout.write(
    `${await writeState(
      statePath,
      await copyApp(distRoot, appRelative, architecture, version, destination)
    )}\n`
  )
} else if (command === 'app-verify' && args.length === 2) {
  await verifyApp(await readState(args[0], args[1]))
} else if (command === 'dist-snapshot' && args.length === 7) {
  const [distRoot, appRelative, architecture, version, zipPath, dmgPath, statePath] = args
  process.stdout.write(
    `${await writeState(
      statePath,
      await snapshotPublishedArtifacts(
        distRoot,
        appRelative,
        architecture,
        version,
        zipPath,
        dmgPath
      )
    )}\n`
  )
} else if (command === 'dist-verify' && args.length === 2) {
  await verifyPublishedArtifacts(await readState(args[0], args[1]))
} else if (command === 'audit-copy' && args.length === 8) {
  const [distRoot, appRelative, architecture, version, zipPath, dmgPath, auditRoot, statePath] =
    args
  process.stdout.write(
    `${await writeState(
      statePath,
      await copyPublishedForAudit(
        distRoot,
        appRelative,
        architecture,
        version,
        zipPath,
        dmgPath,
        auditRoot
      )
    )}\n`
  )
} else if (command === 'audit-verify' && args.length === 2) {
  await verifyPublishedAuditCopy(await readState(args[0], args[1]))
} else if (command === 'root-state-create' && args.length === 3) {
  await createRootState(args[0], args[1], args[2])
} else if (command === 'cleanup' && args.length === 8) {
  await cleanup(...args)
} else {
  throw new Error('invalid package-private-snapshot command')
}
