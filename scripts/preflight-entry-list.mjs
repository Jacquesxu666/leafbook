#!/usr/bin/env node

import fs from 'node:fs'

const MAX_ENTRIES = 100_000
const MAX_DEPTH = 128
const MAX_PATH_BYTES = 4096
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

const safePath = (value) => {
  const name = value.replaceAll('\\', '/').replace(/^\.?\//, '')
  if (
    !name ||
    name.startsWith('/') ||
    name.includes('\0') ||
    Buffer.byteLength(name) > MAX_PATH_BYTES
  ) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(value)}`)
  }
  const components = name.split('/')
  if (
    components.length > MAX_DEPTH ||
    components.some((component) => !component || component === '.' || component === '..')
  ) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(value)}`)
  }
  return name
}

const recordsFromRpm = (body) =>
  body
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t')
      if (fields.length !== 4) throw new Error('Malformed RPM metadata listing')
      const [size, mode, name, target] = fields
      return { size: Number(size), mode, name, target }
    })

const recordsFromSquashfs = (body) => {
  const records = []
  for (const line of body.split('\n')) {
    if (!line.includes('squashfs-root')) continue
    const match = /^(\S+)\s+\S+\s+(\d+)\s+\d{4}-\d\d-\d\d\s+\d\d:\d\d\s+squashfs-root\/?(.*)$/.exec(
      line
    )
    if (!match) throw new Error(`Malformed SquashFS listing line: ${line}`)
    const [, mode, size, remainder] = match
    if (!remainder) continue
    const arrow = remainder.indexOf(' -> ')
    records.push({
      size: Number(size),
      mode,
      name: arrow === -1 ? remainder : remainder.slice(0, arrow),
      target: arrow === -1 ? '' : remainder.slice(arrow + 4)
    })
  }
  if (records.length === 0) throw new Error('SquashFS metadata listing contains no entries')
  return records
}

const main = () => {
  const [mode, filename] = process.argv.slice(2)
  if (!['rpm', 'squashfs'].includes(mode) || !filename) {
    throw new Error('Usage: preflight-entry-list.mjs {rpm|squashfs} LISTING')
  }
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) {
    throw new Error('Archive metadata listing is unsafe or exceeds 64 MiB')
  }
  const body = fs.readFileSync(filename, 'utf8')
  if (/[\0\r]/.test(body)) throw new Error('Archive metadata listing contains control bytes')
  const records = mode === 'rpm' ? recordsFromRpm(body) : recordsFromSquashfs(body)
  if (records.length > MAX_ENTRIES) throw new Error('Archive exceeds entry-count budget')
  let total = 0
  const names = new Set()
  for (const record of records) {
    const name = safePath(record.name)
    if (names.has(name)) throw new Error(`Duplicate archive path: ${name}`)
    names.add(name)
    if (!Number.isSafeInteger(record.size) || record.size < 0 || record.size > MAX_ENTRY_BYTES) {
      throw new Error(`Archive entry exceeds size budget: ${name}`)
    }
    const kind = record.mode[0]
    if (!['-', 'd', 'l'].includes(kind)) throw new Error(`Unsupported archive entry type: ${name}`)
    if (kind === '-') {
      total += record.size
      if (total > MAX_TOTAL_BYTES) throw new Error('Archive exceeds total uncompressed-size budget')
    }
    if (kind === 'l') {
      const target = record.target.replaceAll('\\', '/')
      if (!target || target.startsWith('/') || target.includes('\0')) {
        throw new Error(`Unsafe archive symlink: ${name}`)
      }
      const base = name.split('/').slice(0, -1)
      for (const component of target.split('/')) {
        if (!component || component === '.') continue
        if (component === '..') {
          if (base.length === 0) throw new Error(`Archive symlink escapes extraction root: ${name}`)
          base.pop()
        } else {
          base.push(component)
        }
      }
    }
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
