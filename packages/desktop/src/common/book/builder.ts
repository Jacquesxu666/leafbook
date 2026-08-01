/* eslint-disable @stylistic/indent */
import path from 'path'
import type {
  BookBuildInput,
  BookBuildLimits,
  BookBuildResult,
  BookChapter,
  BookDiagnostic,
  BookDiagnosticCode,
  BookFile,
  BookGroup,
  BookNavigationNode
} from './model'
import {
  bookPathIdentity,
  isMarkdownBookPath,
  normalizeBookFilePath,
  normalizeBookRootName
} from './path'
import { parseBookSummary } from './summary'

const SUMMARY_NAMES = ['SUMMARY.md', 'SUMMARY.markdown'] as const
const DIAGNOSTIC_CODES = new Set<BookDiagnosticCode>([
  'invalid-summary',
  'invalid-summary-item',
  'invalid-path',
  'unsafe-path',
  'unsafe-external-url',
  'non-markdown-target',
  'duplicate-chapter',
  'missing-chapter',
  'orphaned-chapters',
  'path-identity-collision',
  'build-file-limit',
  'build-node-limit',
  'build-depth-limit',
  'build-content-limit',
  'diagnostic-limit',
  'summary-character-limit',
  'summary-line-limit',
  'summary-list-item-limit',
  'summary-link-limit',
  'scan-depth-limit',
  'scan-file-limit',
  'scan-directory-limit',
  'scan-entry-limit',
  'scan-file-bytes-limit',
  'scan-total-bytes-limit',
  'scan-summary-bytes-limit',
  'scan-directory-entry-limit',
  'scan-exclude-limit',
  'scan-root-error',
  'scan-read-error',
  'scan-file-changed',
  'scan-identity-mismatch',
  'symlink-escape',
  'symlink-directory'
])
const DEFAULT_LIMITS = {
  maxFiles: 10_000,
  maxNodes: 20_000,
  maxDepth: 64,
  maxContentBytes: 100 * 1024 * 1024,
  maxContentCharacters: 100 * 1024 * 1024,
  maxDiagnostics: 1_000
} as const

const finiteLimit = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number =>
  Number.isFinite(value) && Number.isInteger(value) && (value as number) >= minimum
    ? Math.min(value as number, maximum)
    : fallback

const limitsFrom = (limits: BookBuildLimits | undefined) => ({
  maxFiles: finiteLimit(limits?.maxFiles, DEFAULT_LIMITS.maxFiles, 1, 100_000),
  maxNodes: finiteLimit(limits?.maxNodes, DEFAULT_LIMITS.maxNodes, 1, 100_000),
  maxDepth: finiteLimit(limits?.maxDepth, DEFAULT_LIMITS.maxDepth, 0, 128),
  maxContentBytes: finiteLimit(
    limits?.maxContentBytes,
    DEFAULT_LIMITS.maxContentBytes,
    1,
    512 * 1024 * 1024
  ),
  maxContentCharacters: finiteLimit(
    limits?.maxContentCharacters,
    DEFAULT_LIMITS.maxContentCharacters,
    1,
    512 * 1024 * 1024
  ),
  maxDiagnostics: finiteLimit(limits?.maxDiagnostics, DEFAULT_LIMITS.maxDiagnostics, 1, 10_000)
})

const stableCompare = (left: string, right: string): number => {
  const lowerComparison = left.toLowerCase().localeCompare(right.toLowerCase(), 'en', {
    numeric: true
  })
  return lowerComparison || left.localeCompare(right, 'en', { numeric: true })
}

const fenceMarker = (line: string): { marker: string; length: number } | null => {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
  return match ? { marker: match[1][0], length: match[1].length } : null
}

export const extractFirstH1 = (markdown: string): string | null => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let fence: { marker: string; length: number } | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const marker = fenceMarker(line)
    if (fence) {
      const fenceMarkerCharacter = fence.marker
      const trimmed = line.trim()
      if (
        marker?.marker === fenceMarkerCharacter &&
        marker.length >= fence.length &&
        [...trimmed].every((character) => character === fenceMarkerCharacter)
      ) {
        fence = null
      }
      continue
    }
    if (marker) {
      fence = marker
      continue
    }
    const atx = line.match(/^#\s+(.+?)\s*#*\s*$/)
    if (atx) return atx[1].trim()
    if (index + 1 < lines.length && /^=+\s*$/.test(lines[index + 1]) && line.trim()) {
      return line.trim()
    }
  }
  return null
}

const fallbackFileTitle = (pathname: string): string =>
  path.posix.basename(pathname).replace(/\.(?:md|markdown)$/i, '')

const landingRank = (pathname: string): number => {
  const filename = path.posix.basename(pathname)
  const exact = ['README.md', 'README.markdown', 'index.md', 'index.markdown']
  const exactRank = exact.indexOf(filename)
  if (exactRank !== -1) return exactRank
  const insensitiveRank = exact.map((name) => name.toLowerCase()).indexOf(filename.toLowerCase())
  return insensitiveRank === -1 ? Number.POSITIVE_INFINITY : exact.length + insensitiveRank
}

const selectLanding = (paths: readonly string[]): string | null =>
  [...paths]
    .filter((pathname) => Number.isFinite(landingRank(pathname)))
    .sort(
      (left, right) => landingRank(left) - landingRank(right) || stableCompare(left, right)
    )[0] ?? null

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength

const INCOMING_DIAGNOSTICS = new Map<
  BookDiagnosticCode,
  { severity: BookDiagnostic['severity']; message: string }
>([
  ['invalid-summary', { severity: 'warning', message: 'SUMMARY could not be parsed safely.' }],
  ['invalid-summary-item', { severity: 'warning', message: 'A SUMMARY item was ignored.' }],
  ['invalid-path', { severity: 'warning', message: 'An invalid relative path was ignored.' }],
  ['unsafe-path', { severity: 'error', message: 'An unsafe relative path was rejected.' }],
  ['unsafe-external-url', { severity: 'warning', message: 'An unsafe external URL was rejected.' }],
  ['non-markdown-target', { severity: 'warning', message: 'A non-Markdown target was ignored.' }],
  ['duplicate-chapter', { severity: 'warning', message: 'A duplicate chapter target was found.' }],
  ['missing-chapter', { severity: 'warning', message: 'A listed chapter is missing.' }],
  ['orphaned-chapters', { severity: 'info', message: 'Unlisted Markdown files were found.' }],
  [
    'path-identity-collision',
    { severity: 'warning', message: 'A path identity collision was found.' }
  ],
  ['build-file-limit', { severity: 'warning', message: 'The book file limit was reached.' }],
  ['build-node-limit', { severity: 'warning', message: 'The navigation node limit was reached.' }],
  [
    'build-depth-limit',
    { severity: 'warning', message: 'The navigation depth limit was reached.' }
  ],
  ['build-content-limit', { severity: 'warning', message: 'The book content limit was reached.' }],
  ['diagnostic-limit', { severity: 'warning', message: 'The diagnostic limit was reached.' }],
  [
    'summary-character-limit',
    { severity: 'warning', message: 'The SUMMARY character limit was reached.' }
  ],
  ['summary-line-limit', { severity: 'warning', message: 'The SUMMARY line limit was reached.' }],
  [
    'summary-list-item-limit',
    { severity: 'warning', message: 'The SUMMARY item limit was reached.' }
  ],
  ['summary-link-limit', { severity: 'warning', message: 'A SUMMARY link limit was reached.' }],
  ['scan-depth-limit', { severity: 'warning', message: 'The scan depth limit was reached.' }],
  ['scan-file-limit', { severity: 'warning', message: 'The scan file limit was reached.' }],
  [
    'scan-directory-limit',
    { severity: 'warning', message: 'The scan directory limit was reached.' }
  ],
  ['scan-entry-limit', { severity: 'warning', message: 'The scan entry limit was reached.' }],
  [
    'scan-file-bytes-limit',
    { severity: 'warning', message: 'A Markdown file exceeded its byte limit.' }
  ],
  [
    'scan-total-bytes-limit',
    { severity: 'warning', message: 'The total scan byte limit was reached.' }
  ],
  [
    'scan-summary-bytes-limit',
    { severity: 'warning', message: 'SUMMARY exceeded its byte limit.' }
  ],
  [
    'scan-directory-entry-limit',
    { severity: 'warning', message: 'A directory exceeded its entry limit.' }
  ],
  [
    'scan-exclude-limit',
    { severity: 'warning', message: 'Exclude patterns exceeded a safety limit.' }
  ],
  ['scan-root-error', { severity: 'error', message: 'The book root could not be opened safely.' }],
  [
    'scan-read-error',
    { severity: 'warning', message: 'A filesystem item could not be read safely.' }
  ],
  [
    'scan-file-changed',
    { severity: 'warning', message: 'A file changed while it was being read.' }
  ],
  ['scan-identity-mismatch', { severity: 'error', message: 'A filesystem identity check failed.' }],
  ['symlink-escape', { severity: 'error', message: 'A symbolic link escaped the book root.' }],
  ['symlink-directory', { severity: 'warning', message: 'A directory symbolic link was skipped.' }]
])

const safeIncomingDiagnostic = (value: BookDiagnostic): BookDiagnostic | null => {
  if (!value || typeof value !== 'object') return null
  if (!DIAGNOSTIC_CODES.has(value.code)) return null
  const stable = INCOMING_DIAGNOSTICS.get(value.code)
  if (!stable) return null
  const sourcePath = value.source?.path
  const sourceLine = value.source?.line
  const relatedPath = value.relatedPath
  const safeSource = typeof sourcePath === 'string' ? normalizeBookFilePath(sourcePath) : null
  const safeRelated = typeof relatedPath === 'string' ? normalizeBookFilePath(relatedPath) : null
  return {
    code: value.code,
    severity: stable.severity,
    message: stable.message,
    ...(safeSource
      ? {
          source: {
            path: safeSource,
            ...(Number.isInteger(sourceLine) && (sourceLine as number) > 0
              ? { line: sourceLine }
              : {})
          }
        }
      : {}),
    ...(safeRelated ? { relatedPath: safeRelated } : {}),
    ...(Number.isFinite(value.count)
      ? { count: Math.max(0, Math.floor(value.count as number)) }
      : {})
  }
}

class DiagnosticSink {
  readonly values: BookDiagnostic[] = []
  private limited = false

  constructor(private readonly maximum: number) {}

  add(diagnostic: BookDiagnostic): void {
    if (this.values.length < this.maximum) {
      this.values.push(diagnostic)
    } else if (!this.limited && this.maximum > 0) {
      this.values[this.maximum - 1] = {
        code: 'diagnostic-limit',
        severity: 'warning',
        message: `Diagnostics were capped at ${this.maximum}.`,
        count: this.maximum
      }
      this.limited = true
    }
  }

  code(code: BookDiagnosticCode, message: string, count?: number): void {
    this.add({ code, severity: 'warning', message, ...(count === undefined ? {} : { count }) })
  }
}

const normalizeInputFiles = (
  files: readonly BookFile[],
  sink: DiagnosticSink,
  limits: ReturnType<typeof limitsFrom>
): { files: Map<string, BookFile>; totalBytes: number; totalCharacters: number } => {
  const result = new Map<string, BookFile>()
  const identities = new Map<string, string>()
  let totalBytes = 0
  let totalCharacters = 0
  let candidateCount = 0
  for (const file of files) {
    if (++candidateCount > limits.maxFiles) {
      sink.code(
        'build-file-limit',
        `Book files were capped at ${limits.maxFiles}.`,
        limits.maxFiles
      )
      break
    }
    const rawPath = typeof file?.path === 'string' ? file.path : ''
    if (rawPath.length > 4_096) {
      sink.add({
        code: 'invalid-path',
        severity: 'warning',
        message: 'Ignored a book file with an invalid relative Markdown path.'
      })
      continue
    }
    const normalized = normalizeBookFilePath(rawPath)
    if (!normalized || !isMarkdownBookPath(normalized)) {
      sink.add({
        code: 'invalid-path',
        severity: 'warning',
        message: 'Ignored a book file with an invalid relative Markdown path.'
      })
      continue
    }
    const content = typeof file.content === 'string' ? file.content : ''
    if (totalCharacters + content.length > limits.maxContentCharacters) {
      sink.code(
        'build-content-limit',
        `Book content was capped at ${limits.maxContentCharacters} characters.`,
        limits.maxContentCharacters
      )
      break
    }
    const contentBytes = bytes(content)
    if (totalBytes + contentBytes > limits.maxContentBytes) {
      sink.code(
        'build-content-limit',
        `Book content was capped at ${limits.maxContentBytes} bytes.`,
        limits.maxContentBytes
      )
      break
    }
    totalCharacters += content.length
    totalBytes += contentBytes
    const identity = bookPathIdentity(normalized)
    const collision = identities.get(identity)
    if (collision && collision !== normalized) {
      sink.add({
        code: 'path-identity-collision',
        severity: 'warning',
        message: 'Two files have the same Unicode/case-folded path identity.',
        source: { path: normalized },
        relatedPath: collision
      })
    } else {
      identities.set(identity, normalized)
    }
    if (!result.has(normalized)) result.set(normalized, { path: normalized, content })
  }
  return { files: result, totalBytes, totalCharacters }
}

interface DirectoryTrie {
  path: string
  directories: Map<string, DirectoryTrie>
  files: string[]
}

interface InferenceResult {
  nodes: BookNavigationNode[]
  chapterPaths: string[]
  landingPath: string | null
}

const inferNavigation = (
  files: ReadonlyMap<string, BookFile>,
  sink: DiagnosticSink,
  limits: ReturnType<typeof limitsFrom>
): InferenceResult => {
  const root: DirectoryTrie = { path: '', directories: new Map(), files: [] }
  for (const pathname of files.keys()) {
    if (SUMMARY_NAMES.includes(pathname as (typeof SUMMARY_NAMES)[number])) continue
    const parts = pathname.split('/')
    let directory = root
    let exceeded = false
    for (let index = 0; index < parts.length - 1; index++) {
      if (index + 1 > limits.maxDepth) {
        sink.code('build-depth-limit', `Navigation depth was capped at ${limits.maxDepth}.`)
        exceeded = true
        break
      }
      const name = parts[index]
      let child = directory.directories.get(name)
      if (!child) {
        const childPath = directory.path ? `${directory.path}/${name}` : name
        child = { path: childPath, directories: new Map(), files: [] }
        directory.directories.set(name, child)
      }
      directory = child
    }
    if (!exceeded) directory.files.push(pathname)
  }

  let order = 0
  let nodeCount = 0
  let truncated = false
  const buildDirectory = (directory: DirectoryTrie, isRoot: boolean): InferenceResult => {
    const landingPath = selectLanding(directory.files)
    const nodes: BookNavigationNode[] = []
    const chapterPaths: string[] = []
    for (const [name, childTrie] of [...directory.directories.entries()].sort(([a], [b]) =>
      stableCompare(a, b)
    )) {
      if (nodeCount >= limits.maxNodes) {
        truncated = true
        break
      }
      nodeCount++
      const groupOrder = order++
      const child = buildDirectory(childTrie, false)
      const landingContent = child.landingPath ? files.get(child.landingPath)?.content : null
      const group: BookGroup = {
        type: 'group',
        id: `group:${childTrie.path}`,
        title: (landingContent && extractFirstH1(landingContent)) || name,
        order: groupOrder,
        source: { path: childTrie.path },
        landingPath: child.landingPath,
        children: child.nodes
      }
      nodes.push(group)
      chapterPaths.push(...child.chapterPaths)
    }
    for (const pathname of directory.files
      .filter((candidate) => candidate !== landingPath)
      .sort(stableCompare)) {
      if (nodeCount >= limits.maxNodes) {
        truncated = true
        break
      }
      const file = files.get(pathname)
      if (!file) continue
      nodeCount++
      nodes.push({
        type: 'chapter',
        id: `chapter:${JSON.stringify([pathname, null, 0])}`,
        title: extractFirstH1(file.content) || fallbackFileTitle(pathname),
        order: order++,
        source: { path: pathname },
        path: pathname,
        fragment: null,
        children: []
      })
      chapterPaths.push(pathname)
    }
    if (!isRoot && landingPath) chapterPaths.unshift(landingPath)
    return { nodes, chapterPaths, landingPath }
  }
  const result = buildDirectory(root, true)
  if (truncated) {
    sink.code('build-node-limit', `Navigation nodes were capped at ${limits.maxNodes}.`)
  }
  return result
}

const summaryFromInput = (
  input: BookBuildInput,
  files: ReadonlyMap<string, BookFile>,
  sink: DiagnosticSink,
  limits: ReturnType<typeof limitsFrom>,
  catalogBytes: number,
  catalogCharacters: number
): BookFile | null => {
  if (input.summary) {
    const summaryPath = normalizeBookFilePath(input.summary.path)
    if (!summaryPath || !SUMMARY_NAMES.includes(summaryPath as (typeof SUMMARY_NAMES)[number])) {
      sink.add({
        code: 'invalid-path',
        severity: 'warning',
        message: 'Ignored a SUMMARY with an invalid root-relative path.'
      })
      return null
    }
    const content = typeof input.summary.content === 'string' ? input.summary.content : ''
    if (catalogCharacters + content.length > limits.maxContentCharacters) {
      sink.code(
        'build-content-limit',
        `Book content was capped at ${limits.maxContentCharacters} characters.`,
        limits.maxContentCharacters
      )
      return null
    }
    const contentBytes = bytes(content)
    if (catalogBytes + contentBytes > limits.maxContentBytes) {
      sink.code(
        'build-content-limit',
        `Book content was capped at ${limits.maxContentBytes} bytes.`,
        limits.maxContentBytes
      )
      return null
    }
    return { path: summaryPath, content }
  }
  for (const name of SUMMARY_NAMES) {
    const summary = files.get(name)
    if (summary) return summary
  }
  return null
}

const flattenChapters = (nodes: readonly BookNavigationNode[]): BookChapter[] => {
  const chapters: BookChapter[] = []
  const stack = [...nodes].reverse()
  while (stack.length) {
    const node = stack.pop() as BookNavigationNode
    if (node.type === 'chapter') chapters.push(node)
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index])
  }
  return chapters
}

const trimSummaryNodes = (
  nodes: BookNavigationNode[],
  limits: ReturnType<typeof limitsFrom>,
  sink: DiagnosticSink
): BookNavigationNode[] => {
  let count = 0
  let truncated = false
  const visit = (items: BookNavigationNode[], depth: number): BookNavigationNode[] => {
    if (depth > limits.maxDepth) {
      sink.code('build-depth-limit', `Navigation depth was capped at ${limits.maxDepth}.`)
      return []
    }
    const kept: BookNavigationNode[] = []
    for (const node of items) {
      if (count >= limits.maxNodes) {
        truncated = true
        break
      }
      count++
      node.children = visit(node.children, depth + 1)
      kept.push(node)
    }
    return kept
  }
  const result = visit(nodes, 0)
  if (truncated) {
    sink.code('build-node-limit', `Navigation nodes were capped at ${limits.maxNodes}.`)
  }
  return result
}

export const buildBook = (rawInput: BookBuildInput): BookBuildResult => {
  const validInput = Boolean(rawInput) && typeof rawInput === 'object' && !Array.isArray(rawInput)
  const input = validInput ? rawInput : { rootName: 'Untitled Book', files: [] }
  const limits = limitsFrom(input?.limits)
  const sink = new DiagnosticSink(limits.maxDiagnostics)
  if (!validInput) {
    sink.add({
      code: 'invalid-path',
      severity: 'warning',
      message: 'Ignored an invalid book build input.'
    })
  }
  let incomingDiagnosticCount = 0
  for (const diagnostic of input?.diagnostics ?? []) {
    if (++incomingDiagnosticCount > limits.maxDiagnostics) {
      sink.code(
        'diagnostic-limit',
        `Diagnostics were capped at ${limits.maxDiagnostics}.`,
        limits.maxDiagnostics
      )
      break
    }
    const safe = safeIncomingDiagnostic(diagnostic)
    if (safe) sink.add(safe)
  }
  const normalized = normalizeInputFiles(input?.files ?? [], sink, limits)
  const files = normalized.files
  const summary = summaryFromInput(
    input,
    files,
    sink,
    limits,
    normalized.totalBytes,
    normalized.totalCharacters
  )
  const rootLandingPath = selectLanding(
    [...files.keys()].filter((pathname) => !pathname.includes('/'))
  )

  let source: 'summary' | 'inferred'
  let summaryPath: string | null
  let nodes: BookNavigationNode[]
  let chapterPaths: string[]
  let entryPath: string | null

  if (summary) {
    source = 'summary'
    summaryPath = summary.path
    const parsed = parseBookSummary(summary.content, summary.path, {
      maxCharacters: limits.maxContentCharacters,
      maxNodes: limits.maxNodes,
      maxDepth: limits.maxDepth,
      maxDiagnostics: limits.maxDiagnostics,
      maxListItems: limits.maxNodes
    })
    for (const diagnostic of parsed.diagnostics) sink.add(diagnostic)
    nodes = trimSummaryNodes(parsed.nodes, limits, sink)
    const chapters = flattenChapters(nodes)
    chapterPaths = [...new Set(chapters.map((chapter) => chapter.path))]
    for (const chapter of chapters) {
      if (!files.has(chapter.path)) {
        sink.add({
          code: 'missing-chapter',
          severity: 'warning',
          message: 'A chapter listed in SUMMARY does not exist in the book.',
          source: chapter.source,
          relatedPath: chapter.path
        })
      }
    }
    const listed = new Set(chapterPaths)
    const specialRootFiles = new Set<string>([
      ...SUMMARY_NAMES,
      ...(rootLandingPath ? [rootLandingPath] : [])
    ])
    const orphanedCount = [...files.keys()].filter(
      (pathname) =>
        isMarkdownBookPath(pathname) && !specialRootFiles.has(pathname) && !listed.has(pathname)
    ).length
    if (orphanedCount > 0) {
      sink.add({
        code: 'orphaned-chapters',
        severity: 'info',
        message: `${orphanedCount} Markdown file(s) are not listed in SUMMARY.`,
        source: { path: summary.path },
        count: orphanedCount
      })
    }
    entryPath = chapters.find((chapter) => files.has(chapter.path))?.path ?? rootLandingPath
  } else {
    source = 'inferred'
    summaryPath = null
    const inferred = inferNavigation(files, sink, limits)
    nodes = inferred.nodes
    chapterPaths = inferred.chapterPaths
    entryPath = inferred.landingPath ?? chapterPaths[0] ?? null
  }

  const titleDocumentPath = rootLandingPath ?? entryPath
  const titleDocument = titleDocumentPath ? files.get(titleDocumentPath) : null
  const h1Title = titleDocument ? extractFirstH1(titleDocument.content) : null
  return {
    book: {
      metadata: {
        title: h1Title || normalizeBookRootName(input.rootName),
        titleSource: h1Title ? 'document-h1' : 'directory-name'
      },
      navigation: {
        source,
        summaryPath,
        nodes,
        entryPath,
        landingPath: rootLandingPath,
        chapterPaths
      }
    },
    diagnostics: sink.values
  }
}
