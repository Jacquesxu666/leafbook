#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_NOTES_BYTES = 128 * 1024
const requiredSections = [
  'Highlights',
  'Security and privacy',
  'Dependency and license evidence',
  'Known limitations',
  'Verification'
]
const requiredFields = new Map([
  [
    'Security and privacy',
    new Map([
      ['Renderer network policy', 'denied by default'],
      ['Recovery draft sensitivity', 'may contain manuscript text']
    ])
  ],
  [
    'Dependency and license evidence',
    new Map([
      ['SBOM format', 'SPDX-2.3'],
      ['Checksum manifest', 'SHA256SUMS.txt']
    ])
  ],
  [
    'Known limitations',
    new Map([
      ['macOS signing', 'required before draft'],
      ['macOS notarization', 'required before draft'],
      ['Windows native evidence', 'required before draft'],
      ['Linux native evidence', 'required before draft'],
      ['Hosted evidence review', 'required before publication'],
      ['Public release approval', 'blocked']
    ])
  ]
])

const meaningful = (lines) =>
  lines.some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !/^<!--|-->$/.test(trimmed)
  })

export const validateReleaseNotes = ({ notes, version }) => {
  if (typeof notes !== 'string' || Buffer.byteLength(notes, 'utf8') > MAX_NOTES_BYTES) {
    throw new Error(`Release notes exceed the ${MAX_NOTES_BYTES}-byte bound`)
  }
  if (notes.includes('\0') || notes.includes('\r')) {
    throw new Error('Release notes contain forbidden control or non-canonical line endings')
  }

  const sections = new Map()
  let currentSection = null
  let inComment = false
  let fence = null
  let titleCount = 0
  let lastSectionIndex = -1

  for (const rawLine of notes.split('\n')) {
    let line = rawLine
    if (inComment) {
      const end = line.indexOf('-->')
      if (end === -1) continue
      line = line.slice(end + 3)
      inComment = false
    }
    while (line.includes('<!--')) {
      const start = line.indexOf('<!--')
      const end = line.indexOf('-->', start + 4)
      if (end === -1) {
        line = line.slice(0, start)
        inComment = true
        break
      }
      line = `${line.slice(0, start)}${line.slice(end + 3)}`
    }

    if (fence) {
      const closingFence = new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`)
      if (closingFence.test(line)) fence = null
      continue
    }
    const openingFence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (openingFence) {
      const marker = openingFence[2]
      fence = { character: marker[0], length: marker.length }
      continue
    }

    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = heading[2].trim()
      if (level === 1 && text === `LeafBook ${version}`) titleCount += 1
      if (level <= 2) currentSection = null
      if (level === 2 && requiredSections.includes(text)) {
        if (sections.has(text)) throw new Error(`Duplicate release-note section: ${text}`)
        const sectionIndex = requiredSections.indexOf(text)
        if (sectionIndex !== lastSectionIndex + 1) {
          throw new Error(`Release-note section is out of order: ${text}`)
        }
        lastSectionIndex = sectionIndex
        sections.set(text, [])
        currentSection = text
      }
      continue
    }
    if (currentSection) sections.get(currentSection).push(line)
  }
  if (inComment || fence) throw new Error('Release notes contain an unclosed comment or code fence')
  if (titleCount !== 1) throw new Error(`Release notes require one exact LeafBook ${version} title`)
  if (/\b(?:TODO|TBD|FIXME)\b/i.test(notes)) {
    throw new Error('Release notes contain an unresolved placeholder')
  }

  for (const section of requiredSections) {
    const lines = sections.get(section)
    if (!lines || !meaningful(lines)) {
      throw new Error(`Missing or empty release-note section: ${section}`)
    }
    const expected = requiredFields.get(section)
    if (!expected) continue
    const actual = new Map()
    for (const line of lines) {
      const field = /^- ([A-Za-z][A-Za-z ]+): (\S(?:.*\S)?)$/.exec(line)
      if (field) {
        if (actual.has(field[1])) throw new Error(`Duplicate release-note field: ${field[1]}`)
        actual.set(field[1], field[2])
      }
    }
    for (const [name, value] of expected) {
      if (actual.get(name) !== value) {
        throw new Error(`Release-note field ${name} must equal: ${value}`)
      }
    }
  }
  return {
    sections: requiredSections.length,
    fields: [...requiredFields.values()].flatMap((fields) => [...fields]).length
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const desktop = JSON.parse(
    await readFile(path.join(root, 'packages/desktop/package.json'), 'utf8')
  )
  const notesPath = path.resolve(process.argv[2] ?? path.join(root, 'docs/RELEASE_NOTES.md'))
  const notesStat = await stat(notesPath)
  if (!notesStat.isFile() || notesStat.size > MAX_NOTES_BYTES) {
    throw new Error(`Release notes must be a regular file within ${MAX_NOTES_BYTES} bytes`)
  }
  const notes = await readFile(notesPath, 'utf8')
  const result = validateReleaseNotes({ notes, version: desktop.version })
  console.log(
    `Release notes gate passed with ${result.sections} sections and ${result.fields} disclosures: ${notesPath}`
  )
}
