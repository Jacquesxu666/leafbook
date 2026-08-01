#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { binaryIdentity } from './audit-application-layout.mjs'

const MAX_ENTRIES = 100_000
const MAX_DEPTH = 128
const MAX_PATH_BYTES = 4096
const MAX_PRESENTATION_FILE_BYTES = 16 * 1024 * 1024
const MAX_PRESENTATION_TOTAL_BYTES = 32 * 1024 * 1024
const allowedDmgRoots = new Set([
  'LeafBook.app',
  'Applications',
  '.background',
  '.background.tiff',
  '.DS_Store',
  '.VolumeIcon.icns'
])

export const auditMacCarrier = async ({ tree, kind }) => {
  if (!['zip', 'dmg'].includes(kind)) throw new Error('Unsupported macOS carrier kind')
  const root = await fs.realpath(tree)
  const textual = await fs.lstat(tree)
  if (!textual.isDirectory() || textual.isSymbolicLink()) throw new Error('Carrier root is unsafe')
  const entries = new Map()
  let count = 0
  let presentationBytes = 0
  const visit = async (absolute, relative, depth) => {
    if (depth > MAX_DEPTH) throw new Error('macOS carrier exceeds depth budget')
    if (Buffer.byteLength(relative) > MAX_PATH_BYTES) {
      throw new Error('macOS carrier path exceeds budget')
    }
    count += 1
    if (count > MAX_ENTRIES) throw new Error('macOS carrier exceeds entry budget')
    const stat = await fs.lstat(absolute)
    if (stat.isDirectory()) {
      entries.set(relative, { type: 'directory' })
      for (const name of await fs.readdir(absolute)) {
        await visit(path.join(absolute, name), `${relative}/${name}`, depth + 1)
      }
    } else if (stat.isFile()) {
      entries.set(relative, { type: 'file' })
      if (!relative.startsWith('LeafBook.app/')) {
        if (
          relative === '.DS_Store' ||
          relative === '.VolumeIcon.icns' ||
          relative === '.background.tiff' ||
          relative.startsWith('.background/')
        ) {
          if (stat.size < 8 || stat.size > MAX_PRESENTATION_FILE_BYTES) {
            throw new Error(`DMG presentation metadata has an invalid size: ${relative}`)
          }
          presentationBytes += stat.size
          if (presentationBytes > MAX_PRESENTATION_TOTAL_BYTES) {
            throw new Error('DMG presentation metadata exceeds its total byte budget')
          }
          const handle = await fs.open(absolute, 'r')
          const header = Buffer.alloc(8)
          try {
            await handle.read(header, 0, header.length, 0)
          } finally {
            await handle.close()
          }
          const isTiff =
            header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
            header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
          const isPng = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
          if (
            (relative === '.DS_Store' &&
              !header.equals(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]))) ||
            (relative === '.VolumeIcon.icns' &&
              header.subarray(0, 4).toString('ascii') !== 'icns') ||
            ((relative === '.background.tiff' || relative.endsWith('.tiff')) && !isTiff) ||
            (relative.endsWith('.png') && !isPng)
          ) {
            throw new Error(`DMG presentation metadata has invalid magic: ${relative}`)
          }
        }
        const identity = await binaryIdentity(absolute)
        if (identity) {
          throw new Error(`macOS carrier contains native payload outside LeafBook.app: ${relative}`)
        }
        if ((stat.mode & 0o111) !== 0) {
          throw new Error(
            `macOS carrier contains executable payload outside LeafBook.app: ${relative}`
          )
        }
      }
    } else if (stat.isSymbolicLink()) {
      entries.set(relative, { type: 'symlink', target: await fs.readlink(absolute) })
    } else {
      throw new Error(`Unsupported macOS carrier entry: ${relative}`)
    }
  }
  const roots = await fs.readdir(root)
  if (kind === 'zip') {
    if (roots.length !== 1 || roots[0] !== 'LeafBook.app') {
      throw new Error('macOS ZIP must contain only LeafBook.app at its root')
    }
  } else {
    for (const name of roots) {
      if (!allowedDmgRoots.has(name)) throw new Error(`DMG contains unexpected root entry: ${name}`)
    }
    if (!roots.includes('LeafBook.app')) throw new Error('DMG is missing LeafBook.app')
    if (!roots.includes('Applications')) throw new Error('DMG is missing Applications symlink')
  }
  for (const name of roots) await visit(path.join(root, name), name, 1)
  const app = entries.get('LeafBook.app')
  if (!app || app.type !== 'directory') throw new Error('LeafBook.app must be a real directory')
  if (kind === 'dmg') {
    const applications = entries.get('Applications')
    if (
      !applications ||
      applications.type !== 'symlink' ||
      applications.target !== '/Applications'
    ) {
      throw new Error('DMG Applications must be the exact /Applications symlink')
    }
    const rootTypes = new Map([
      ['LeafBook.app', 'directory'],
      ['Applications', 'symlink'],
      ['.background', 'directory'],
      ['.background.tiff', 'file'],
      ['.DS_Store', 'file'],
      ['.VolumeIcon.icns', 'file']
    ])
    for (const name of roots) {
      if (entries.get(name)?.type !== rootTypes.get(name)) {
        throw new Error(`DMG root metadata has unexpected type: ${name}`)
      }
    }
    const approvedBackground = new Set([
      '.background/background.tiff',
      '.background/background.png'
    ])
    for (const [relative, entry] of entries) {
      if (!relative.startsWith('.background/')) continue
      if (!approvedBackground.has(relative) || entry.type !== 'file') {
        throw new Error(`DMG .background contains an unapproved entry or type: ${relative}`)
      }
    }
  }
  for (const [relative, entry] of entries) {
    if (entry.type !== 'symlink') continue
    if (relative === 'Applications' && kind === 'dmg') continue
    if (!relative.startsWith('LeafBook.app/')) {
      throw new Error(`macOS carrier contains an unapproved symlink: ${relative}`)
    }
    if (path.isAbsolute(entry.target)) {
      throw new Error(`Application symlink is absolute: ${relative}`)
    }
    const resolvedAbsolute = await fs.realpath(path.join(root, ...relative.split('/')))
    const appRoot = path.join(root, 'LeafBook.app')
    const resolved = path.relative(root, resolvedAbsolute).split(path.sep).join('/')
    if (
      (resolvedAbsolute !== appRoot && !resolvedAbsolute.startsWith(`${appRoot}${path.sep}`)) ||
      !entries.has(resolved)
    ) {
      throw new Error(`Application symlink escapes or targets an unmanifested entry: ${relative}`)
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    const [kind, tree] = process.argv.slice(2)
    await auditMacCarrier({ tree, kind })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
