#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { binaryIdentity } from './audit-application-layout.mjs'

const MAX_ENTRIES = 100_000
const MAX_DEPTH = 128

export const auditNativeTree = async ({ tree, platform, architecture, allowUniversal = false }) => {
  if (!['macos', 'linux', 'windows'].includes(platform)) throw new Error('Unsupported platform')
  if (!['arm64', 'x64'].includes(architecture)) throw new Error('Unsupported architecture')
  const root = await fs.realpath(tree)
  if (!(await fs.lstat(tree)).isDirectory() || (await fs.lstat(tree)).isSymbolicLink()) {
    throw new Error('Native scan root must be a real directory')
  }
  const expectedFormat = platform === 'macos' ? 'macho' : platform === 'linux' ? 'elf' : 'pe'
  let entries = 0
  const nativeFiles = []
  const visit = async (absolute, relative, depth) => {
    if (depth > MAX_DEPTH) throw new Error('Native scan exceeds depth budget')
    entries += 1
    if (entries > MAX_ENTRIES) throw new Error('Native scan exceeds entry budget')
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(absolute)) {
        await visit(path.join(absolute, name), relative ? `${relative}/${name}` : name, depth + 1)
      }
      return
    }
    if (!stat.isFile()) throw new Error(`Unsupported native scan entry: ${relative}`)
    const identity = await binaryIdentity(absolute)
    if (!identity) {
      if (/\.(node|dylib|dll|exe|so(?:\.\d+)*)$/i.test(relative)) {
        throw new Error(`Native-looking file has no recognized binary header: ${relative}`)
      }
      return
    }
    if (identity.format !== expectedFormat) throw new Error(`Foreign native binary: ${relative}`)
    if (!identity.architectures.includes(architecture)) {
      throw new Error(`Native binary does not match ${architecture}: ${relative}`)
    }
    if (
      identity.architectures.length > 1 &&
      (!allowUniversal ||
        identity.architectures.some((candidate) => !['arm64', 'x64'].includes(candidate)))
    ) {
      throw new Error(`Unexpected universal native binary: ${relative}`)
    }
    nativeFiles.push(relative)
  }
  await visit(root, '', 0)
  if (nativeFiles.length === 0) throw new Error('Application tree contains no native binaries')
  return nativeFiles.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const [platform, architecture, tree, universal = 'false'] = process.argv.slice(2)
    const nativeFiles = await auditNativeTree({
      tree,
      platform,
      architecture,
      allowUniversal: universal === 'true'
    })
    process.stdout.write(`${JSON.stringify({ nativeFiles })}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
