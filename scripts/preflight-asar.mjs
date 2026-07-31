#!/usr/bin/env node

import asar from '@electron/asar'
import fs from 'node:fs'
import path from 'node:path'

const MAX_ENTRIES = 100_000
const MAX_DEPTH = 128
const MAX_PATH_BYTES = 4096
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const MAX_HEADER_BYTES = 64 * 1024 * 1024

const fail = (message) => {
  throw new Error(message)
}

const main = () => {
  const [filename] = process.argv.slice(2)
  if (!filename) fail('Usage: preflight-asar.mjs ASAR')
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES) {
    fail('ASAR must be a regular file within the compressed-byte budget')
  }
  const descriptor = fs.openSync(filename, 'r')
  const prefix = Buffer.alloc(8)
  try {
    if (fs.readSync(descriptor, prefix, 0, prefix.length, 0) !== prefix.length) {
      fail('ASAR pickle header prefix is truncated')
    }
  } finally {
    fs.closeSync(descriptor)
  }
  const sizePicklePayload = prefix.readUInt32LE(0)
  const declaredHeaderBytes = prefix.readUInt32LE(4)
  if (
    sizePicklePayload !== 4 ||
    declaredHeaderBytes < 8 ||
    declaredHeaderBytes > MAX_HEADER_BYTES ||
    8 + declaredHeaderBytes > stat.size
  ) {
    fail('ASAR pickle header exceeds its metadata budget or carrier')
  }
  const { header, headerSize } = asar.getRawHeader(filename)
  if (
    !header ||
    typeof header !== 'object' ||
    !header.files ||
    headerSize !== declaredHeaderBytes
  ) {
    fail('ASAR header is missing or exceeds its metadata budget')
  }
  let count = 0
  let total = 0
  const names = new Set()
  const visit = (files, parents) => {
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      fail('ASAR header is malformed')
    }
    for (const [name, entry] of Object.entries(files)) {
      if (
        !name ||
        name === '.' ||
        name === '..' ||
        name.includes('/') ||
        name.includes('\\') ||
        name.includes('\0')
      ) {
        fail('ASAR header contains an unsafe path component')
      }
      const components = [...parents, name]
      const relative = components.join('/')
      if (components.length > MAX_DEPTH || Buffer.byteLength(relative) > MAX_PATH_BYTES) {
        fail(`ASAR path exceeds budget: ${relative}`)
      }
      if (names.has(relative)) {
        fail(`ASAR contains a duplicate path: ${relative}`)
      }
      names.add(relative)
      count += 1
      if (count > MAX_ENTRIES) {
        fail('ASAR exceeds entry-count budget')
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        fail(`ASAR entry is malformed: ${relative}`)
      }
      if (entry.files !== undefined) {
        const extra = Object.keys(entry).filter((key) => key !== 'files' && key !== 'unpacked')
        if (entry.unpacked !== undefined && entry.unpacked !== true) {
          fail(`ASAR directory has invalid unpacked metadata: ${relative}`)
        }
        if (extra.length) fail(`ASAR directory contains unexpected metadata: ${relative}`)
        visit(entry.files, components)
        continue
      }
      if (entry.link !== undefined) {
        if (
          typeof entry.link !== 'string' ||
          path.posix.isAbsolute(entry.link) ||
          entry.link.includes('\0') ||
          Buffer.byteLength(entry.link) > MAX_PATH_BYTES
        ) {
          fail(`ASAR link is unsafe: ${relative}`)
        }
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(relative), entry.link)
        )
        if (resolved === '..' || resolved.startsWith('../')) {
          fail(`ASAR link escapes root: ${relative}`)
        }
        continue
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_ENTRY_BYTES) {
        fail(`ASAR entry exceeds size budget: ${relative}`)
      }
      const unexpected = Object.keys(entry).filter(
        (key) => !['size', 'offset', 'unpacked', 'integrity', 'executable'].includes(key)
      )
      if (
        unexpected.length ||
        (entry.unpacked !== undefined && entry.unpacked !== true) ||
        (entry.executable !== undefined && entry.executable !== true)
      ) {
        fail(`ASAR file contains unexpected metadata: ${relative}`)
      }
      total += entry.size
      if (total > MAX_TOTAL_BYTES) {
        fail('ASAR exceeds total uncompressed-size budget')
      }
      if (!entry.unpacked) {
        if (!/^(0|[1-9]\d*)$/.test(entry.offset ?? '')) {
          fail(`ASAR entry has an invalid offset: ${relative}`)
        }
        const end = headerSize + Number(entry.offset) + entry.size
        if (!Number.isSafeInteger(end) || end > stat.size) {
          fail(`ASAR entry exceeds carrier: ${relative}`)
        }
      }
    }
  }
  visit(header.files, [])
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
