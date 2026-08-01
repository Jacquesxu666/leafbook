import type {
  BookChapter,
  BookDiagnostic,
  BookDiagnosticCode,
  BookGroup,
  BookNavigationNode,
  BookSourceLocation,
  BookSummaryLimits
} from './model'
import { resolveBookTarget } from './path'

export interface SummaryParseResult {
  title: string | null
  nodes: BookNavigationNode[]
  /** Unique physical file identities, in first-navigation order. */
  chapterPaths: string[]
  diagnostics: BookDiagnostic[]
}

interface NodeContainer {
  children: BookNavigationNode[]
}

interface ListLevel {
  indent: number
  node: BookNavigationNode | null
}

const DEFAULT_LIMITS = {
  maxCharacters: 2 * 1024 * 1024,
  maxLines: 50_000,
  maxNodes: 20_000,
  maxDepth: 64,
  maxDiagnostics: 1_000,
  maxListItems: 30_000,
  maxLinkDestinationLength: 8_192,
  maxFragmentLength: 2_048
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

const limitsFrom = (limits: BookSummaryLimits | undefined) => ({
  maxCharacters: finiteLimit(
    limits?.maxCharacters,
    DEFAULT_LIMITS.maxCharacters,
    1,
    16 * 1024 * 1024
  ),
  maxLines: finiteLimit(limits?.maxLines, DEFAULT_LIMITS.maxLines, 1, 200_000),
  maxNodes: finiteLimit(limits?.maxNodes, DEFAULT_LIMITS.maxNodes, 1, 100_000),
  maxDepth: finiteLimit(limits?.maxDepth, DEFAULT_LIMITS.maxDepth, 0, 128),
  maxDiagnostics: finiteLimit(limits?.maxDiagnostics, DEFAULT_LIMITS.maxDiagnostics, 1, 10_000),
  maxListItems: finiteLimit(limits?.maxListItems, DEFAULT_LIMITS.maxListItems, 1, 100_000),
  maxLinkDestinationLength: finiteLimit(
    limits?.maxLinkDestinationLength,
    DEFAULT_LIMITS.maxLinkDestinationLength,
    1,
    65_536
  ),
  maxFragmentLength: finiteLimit(
    limits?.maxFragmentLength,
    DEFAULT_LIMITS.maxFragmentLength,
    0,
    16_384
  )
})

class SummaryDiagnosticSink {
  readonly values: BookDiagnostic[] = []
  private limited = false

  constructor(private readonly maximum: number) {}

  add(diagnostic: BookDiagnostic): void {
    if (this.values.length < this.maximum) {
      this.values.push(diagnostic)
    } else if (!this.limited) {
      this.values[this.maximum - 1] = {
        code: 'diagnostic-limit',
        severity: 'warning',
        message: `Diagnostics were capped at ${this.maximum}.`,
        count: this.maximum
      }
      this.limited = true
    }
  }

  limit(code: BookDiagnosticCode, message: string, count: number): void {
    this.add({ code, severity: 'warning', message, count })
  }
}

const plainText = (value: string): string =>
  value
    .replace(/\\([\\[\]_*`])/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()

const parseMarkdownLink = (value: string): { title: string; target: string } | null => {
  if (!value.startsWith('[')) return null
  let closeBracket = -1
  for (let index = 1; index < value.length; index++) {
    if (value[index] === ']' && value[index - 1] !== '\\') {
      closeBracket = index
      break
    }
  }
  if (closeBracket === -1 || value[closeBracket + 1] !== '(' || !value.endsWith(')')) return null
  const title = plainText(value.slice(1, closeBracket))
  const destination = value.slice(closeBracket + 2, -1).trim()
  if (!title || !destination) return null
  if (destination.startsWith('<')) {
    const closeAngle = destination.indexOf('>')
    if (closeAngle === -1) return null
    return { title, target: destination.slice(1, closeAngle) }
  }
  const target = destination.match(/^(?:\\.|[^\s])+/)?.[0]
  return target ? { title, target } : null
}

const createGroup = (
  title: string,
  order: number,
  source: BookSourceLocation,
  idSuffix: string
): BookGroup => ({
  type: 'group',
  id: `group:${idSuffix}`,
  title,
  order,
  source,
  landingPath: null,
  children: []
})

/** JSON tuple encoding prevents path/fragment delimiter collisions. */
const navigationIdentity = (pathname: string, fragment: string | null): string =>
  JSON.stringify([pathname, fragment])

const chapterId = (pathname: string, fragment: string | null, occurrence: number): string =>
  `chapter:${JSON.stringify([pathname, fragment, occurrence])}`

const fenceMarker = (line: string): { marker: '`' | '~'; length: number } | null => {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
  return match ? { marker: match[1][0] as '`' | '~', length: match[1].length } : null
}

const emptyResult = (diagnostics: BookDiagnostic[]): SummaryParseResult => ({
  title: null,
  nodes: [],
  chapterPaths: [],
  diagnostics
})

/**
 * Parse the intentionally small GitBook SUMMARY subset under independent,
 * sanitized work limits. Fenced code is ignored. An invalid list item becomes
 * a sentinel parent so nested items cannot attach to a previous valid sibling.
 */
export const parseBookSummary = (
  markdown: string,
  rawSummaryPath: string = 'SUMMARY.md',
  rawLimits?: BookSummaryLimits
): SummaryParseResult => {
  const limits = limitsFrom(rawLimits)
  const sink = new SummaryDiagnosticSink(limits.maxDiagnostics)
  const summaryPath =
    rawSummaryPath === 'SUMMARY.markdown' || rawSummaryPath === 'SUMMARY.md'
      ? rawSummaryPath
      : 'SUMMARY.md'
  if (typeof markdown !== 'string') {
    sink.add({
      code: 'invalid-summary',
      severity: 'error',
      message: 'SUMMARY content must be a string.',
      source: { path: summaryPath }
    })
    return emptyResult(sink.values)
  }
  if (markdown.length > limits.maxCharacters) {
    sink.limit(
      'summary-character-limit',
      `SUMMARY was rejected above ${limits.maxCharacters} characters.`,
      limits.maxCharacters
    )
    return emptyResult(sink.values)
  }

  const nodes: BookNavigationNode[] = []
  const chapterPaths: string[] = []
  const seenNavigation = new Map<string, number>()
  const seenFiles = new Set<string>()
  const headingStack: Array<{ level: number; group: BookGroup }> = []
  let currentContainer: NodeContainer = { children: nodes }
  let listStack: ListLevel[] = []
  let title: string | null = null
  let order = 0
  let nodeCount = 0
  let listItemCount = 0
  let sawRecognizedContent = false
  let fence: { marker: '`' | '~'; length: number } | null = null
  let lineStart = 0
  let lineNumber = 0
  while (lineStart < markdown.length) {
    if (++lineNumber > limits.maxLines) {
      sink.limit(
        'summary-line-limit',
        `SUMMARY parsing stopped at ${limits.maxLines} lines.`,
        limits.maxLines
      )
      break
    }
    const newline = markdown.indexOf('\n', lineStart)
    const rawLine = markdown.slice(lineStart, newline === -1 ? markdown.length : newline)
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    lineStart = newline === -1 ? markdown.length + 1 : newline + 1
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
    if (!line.trim()) continue

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const headingTitle = plainText(heading[2])
      if (!headingTitle) continue
      sawRecognizedContent = true
      listStack = []
      if (title === null && heading[1].length === 1) {
        title = headingTitle
        currentContainer = { children: nodes }
        continue
      }
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= heading[1].length
      ) {
        headingStack.pop()
      }
      const depth = headingStack.length
      if (depth > limits.maxDepth) {
        sink.limit(
          'build-depth-limit',
          `SUMMARY navigation depth was capped at ${limits.maxDepth}.`,
          limits.maxDepth
        )
        currentContainer = { children: nodes }
        continue
      }
      if (nodeCount >= limits.maxNodes) {
        sink.limit(
          'build-node-limit',
          `SUMMARY nodes were capped at ${limits.maxNodes}.`,
          limits.maxNodes
        )
        break
      }
      const group = createGroup(
        headingTitle,
        order++,
        { path: summaryPath, line: lineNumber },
        `heading:${lineNumber}`
      )
      nodeCount++
      const parent = headingStack[headingStack.length - 1]?.group
      ;(parent?.children ?? nodes).push(group)
      headingStack.push({ level: heading[1].length, group })
      currentContainer = group
      continue
    }

    const listItem = line.match(/^([ \t]*)[-+*]\s+(.+?)\s*$/)
    if (!listItem) {
      if (!/^\s*<!--.*-->\s*$/.test(line)) {
        sink.add({
          code: 'invalid-summary',
          severity: 'warning',
          message: 'Only headings and unordered list items are supported in SUMMARY.',
          source: { path: summaryPath, line: lineNumber }
        })
      }
      continue
    }
    if (++listItemCount > limits.maxListItems) {
      sink.limit(
        'summary-list-item-limit',
        `SUMMARY list items were capped at ${limits.maxListItems}.`,
        limits.maxListItems
      )
      break
    }

    sawRecognizedContent = true
    const indent = listItem[1].replaceAll('\t', '    ').length
    while (listStack.length > 0 && indent <= listStack[listStack.length - 1].indent) {
      listStack.pop()
    }
    const depth = listStack.length
    if (depth > limits.maxDepth) {
      sink.limit(
        'build-depth-limit',
        `SUMMARY navigation depth was capped at ${limits.maxDepth}.`,
        limits.maxDepth
      )
      listStack.push({ indent, node: null })
      continue
    }
    if (nodeCount >= limits.maxNodes) {
      sink.limit(
        'build-node-limit',
        `SUMMARY nodes were capped at ${limits.maxNodes}.`,
        limits.maxNodes
      )
      break
    }
    const parent = listStack[listStack.length - 1]?.node
    const targetChildren = parent ? parent.children : currentContainer.children
    const itemText = listItem[2].trim()
    const link = parseMarkdownLink(itemText)
    let node: BookNavigationNode | null = null

    if (!link) {
      const groupTitle = plainText(itemText)
      if (!groupTitle || itemText.includes('](') || itemText.startsWith('[')) {
        sink.add({
          code: 'invalid-summary-item',
          severity: 'warning',
          message: 'The SUMMARY list item is empty or contains a malformed link.',
          source: { path: summaryPath, line: lineNumber }
        })
      } else {
        node = createGroup(
          groupTitle,
          order++,
          { path: summaryPath, line: lineNumber },
          `list:${lineNumber}`
        )
      }
    } else if (link.target.length > limits.maxLinkDestinationLength) {
      sink.limit(
        'summary-link-limit',
        `A SUMMARY link destination exceeded ${limits.maxLinkDestinationLength} characters.`,
        limits.maxLinkDestinationLength
      )
    } else {
      const resolution = resolveBookTarget(link.target)
      if (resolution.kind === 'invalid') {
        sink.add({
          code: resolution.reason,
          severity: resolution.reason === 'unsafe-path' ? 'error' : 'warning',
          message: resolution.message,
          source: { path: summaryPath, line: lineNumber }
        })
      } else if (resolution.kind === 'external') {
        node = {
          type: 'external',
          id: `external:${lineNumber}`,
          title: link.title,
          url: resolution.url,
          order: order++,
          source: { path: summaryPath, line: lineNumber },
          children: []
        }
      } else if ((resolution.fragment?.length ?? 0) > limits.maxFragmentLength) {
        sink.limit(
          'summary-link-limit',
          `A SUMMARY fragment exceeded ${limits.maxFragmentLength} characters.`,
          limits.maxFragmentLength
        )
      } else {
        const identity = navigationIdentity(resolution.path, resolution.fragment)
        const occurrence = seenNavigation.get(identity) ?? 0
        seenNavigation.set(identity, occurrence + 1)
        if (occurrence === 1) {
          sink.add({
            code: 'duplicate-chapter',
            severity: 'warning',
            message: 'The same chapter target is listed more than once.',
            source: { path: summaryPath, line: lineNumber },
            relatedPath: resolution.path
          })
        }
        if (!seenFiles.has(resolution.path)) {
          seenFiles.add(resolution.path)
          chapterPaths.push(resolution.path)
        }
        node = {
          type: 'chapter',
          id: chapterId(resolution.path, resolution.fragment, occurrence),
          title: link.title,
          path: resolution.path,
          fragment: resolution.fragment,
          order: order++,
          source: { path: summaryPath, line: lineNumber },
          children: []
        } satisfies BookChapter
      }
    }

    if (node) {
      targetChildren.push(node)
      nodeCount++
    }
    listStack.push({ indent, node })
  }

  if (!sawRecognizedContent && markdown.trim()) {
    sink.add({
      code: 'invalid-summary',
      severity: 'error',
      message: 'SUMMARY does not contain a heading or unordered list.',
      source: { path: summaryPath }
    })
  }
  return { title, nodes, chapterPaths, diagnostics: sink.values }
}
