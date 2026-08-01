import { createHash } from 'crypto'
import { resolveBookTarget } from './path'

const DEFAULT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxLines: 50_000,
  maxNodes: 20_000,
  maxDepth: 64,
  maxOperations: 10_000
} as const

interface NormalizedSummaryDocumentLimits {
  maxBytes: number
  maxLines: number
  maxNodes: number
  maxDepth: number
  maxOperations: number
}

export interface SummaryDocumentLimits {
  maxBytes?: number
  maxLines?: number
  maxNodes?: number
  maxDepth?: number
  maxOperations?: number
}

export type SummaryDocumentErrorCode =
  | 'invalid-encoding'
  | 'limit-exceeded'
  | 'unsafe-document'
  | 'node-not-found'
  | 'invalid-operation'
  | 'opaque-barrier'
  | 'indentation-conflict'

export interface SummaryDocumentError {
  code: SummaryDocumentErrorCode
  message: string
}

export type SummaryDocumentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SummaryDocumentError }

export type SummaryArrangementOperation =
  | { type: 'move-before'; nodeId: string; targetId: string }
  | { type: 'move-after'; nodeId: string; targetId: string }
  | { type: 'indent'; nodeId: string }
  | { type: 'outdent'; nodeId: string }

export interface SummaryArrangementNode {
  id: string
  kind: 'heading' | 'list'
  title: string
  depth: number
  children: SummaryArrangementNode[]
  canIndent: boolean
  canOutdent: boolean
}

interface SourceLine {
  id: number
  content: string
  eol: '' | '\n' | '\r\n'
  rawStart: number
  rawEnd: number
}

interface ParsedListNode {
  id: string
  kind: 'list'
  lineIndex: number
  leadingStart: number
  subtreeEnd: number
  indent: string
  indentWidth: number
  depth: number
  title: string
  parentId: string | null
  section: string
  canIndent: boolean
  children: ParsedListNode[]
}

interface ParsedHeadingNode {
  id: string
  kind: 'heading'
  title: string
  depth: number
  level: number
  children: ParsedDisplayNode[]
}

type ParsedDisplayNode = ParsedListNode | ParsedHeadingNode

interface ParsedStructure {
  nodes: ParsedDisplayNode[]
  listRoots: ParsedListNode[]
  byId: Map<string, ParsedListNode>
  opaqueLines: Set<number>
  safe: boolean
  error: SummaryDocumentError | null
}

export interface SummaryDocument {
  readonly bom: boolean
  readonly revision: string
  readonly editable: boolean
  readonly nodes: readonly SummaryArrangementNode[]
  readonly operationCount: number
  /** Internal lossless source representation. Never expose this object over IPC. */
  readonly source: readonly SourceLine[]
  readonly limits: Readonly<NormalizedSummaryDocumentLimits>
}

const failure = <T>(code: SummaryDocumentErrorCode, message: string): SummaryDocumentResult<T> => ({
  ok: false,
  error: { code, message }
})

const finiteLimit = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number =>
  Number.isInteger(value) && (value as number) >= minimum
    ? Math.min(value as number, maximum)
    : fallback

const normalizeLimits = (limits?: SummaryDocumentLimits) => ({
  maxBytes: finiteLimit(limits?.maxBytes, DEFAULT_LIMITS.maxBytes, 1, 16 * 1024 * 1024),
  maxLines: finiteLimit(limits?.maxLines, DEFAULT_LIMITS.maxLines, 1, 200_000),
  maxNodes: finiteLimit(limits?.maxNodes, DEFAULT_LIMITS.maxNodes, 1, 100_000),
  maxDepth: finiteLimit(limits?.maxDepth, DEFAULT_LIMITS.maxDepth, 0, 128),
  maxOperations: finiteLimit(limits?.maxOperations, DEFAULT_LIMITS.maxOperations, 1, 100_000)
})

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const encode = (document: Pick<SummaryDocument, 'bom' | 'source'>): Buffer => {
  const body = document.source.map((line) => `${line.content}${line.eol}`).join('')
  return Buffer.from(`${document.bom ? '\uFEFF' : ''}${body}`, 'utf8')
}

const rebaseRawSpans = (source: readonly SourceLine[]): SourceLine[] => {
  let rawStart = 0
  return source.map((line) => {
    const rawEnd = rawStart + Buffer.byteLength(`${line.content}${line.eol}`, 'utf8')
    const rebased = { ...line, rawStart, rawEnd }
    rawStart = rawEnd
    return rebased
  })
}

const splitLines = (text: string): SourceLine[] => {
  if (text.length === 0) return []
  const lines: SourceLine[] = []
  let start = 0
  let rawStart = 0
  let id = 1
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\n') continue
    const crlf = index > start && text[index - 1] === '\r'
    const content = text.slice(start, crlf ? index - 1 : index)
    const eol = crlf ? '\r\n' : '\n'
    const rawEnd = rawStart + Buffer.byteLength(`${content}${eol}`, 'utf8')
    lines.push({
      id: id++,
      content,
      eol,
      rawStart,
      rawEnd
    })
    rawStart = rawEnd
    start = index + 1
  }
  if (start < text.length) {
    const content = text.slice(start)
    lines.push({
      id,
      content,
      eol: '',
      rawStart,
      rawEnd: rawStart + Buffer.byteLength(content, 'utf8')
    })
  }
  return lines
}

const indentWidth = (indent: string): number => {
  let width = 0
  for (const character of indent) width += character === '\t' ? 4 : 1
  return width
}

const indentationStyle = (indent: string): 'empty' | 'spaces' | 'tabs' | 'mixed' => {
  if (!indent) return 'empty'
  if (/^ +$/.test(indent)) return 'spaces'
  if (/^\t+$/.test(indent)) return 'tabs'
  return 'mixed'
}

const plainText = (value: string): string =>
  value
    .replace(/\\([\\[\]_*`])/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()

const listTitle = (value: string): string => {
  const link = value.match(/^\[([^\]]+)\]\(/)
  return plainText(link?.[1] ?? value)
}

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

const validListItem = (value: string): boolean => {
  const item = value.trim()
  const link = parseMarkdownLink(item)
  if (link) {
    if (link.target.length > 8_192) return false
    const resolution = resolveBookTarget(link.target)
    if (resolution.kind === 'invalid') return false
    return resolution.kind === 'external' || (resolution.fragment?.length ?? 0) <= 2_048
  }
  return Boolean(plainText(item)) && !item.includes('](') && !item.startsWith('[')
}

const fenceMarker = (line: string): { marker: '`' | '~'; length: number } | null => {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
  return match ? { marker: match[1][0] as '`' | '~', length: match[1].length } : null
}

const isComment = (line: string): boolean => /^\s*<!--(?:[\s\S]*?)-->\s*$/.test(line)

const parseStructure = (
  lines: readonly SourceLine[],
  limits: Readonly<NormalizedSummaryDocumentLimits>
): ParsedStructure => {
  const roots: ParsedListNode[] = []
  const displayRoots: ParsedDisplayNode[] = []
  const byId = new Map<string, ParsedListNode>()
  const opaqueLines = new Set<number>()
  const stack: ParsedListNode[] = []
  const headingStack: ParsedHeadingNode[] = []
  let displayContainer = displayRoots
  let section = 'root'
  let sectionSerial = 0
  let pendingTriviaStart = 0
  let fence: { marker: '`' | '~'; length: number } | null = null
  let title: string | null = null
  let nodeCount = 0
  let safe = true
  let error: SummaryDocumentError | null = null

  const reject = (message: string): void => {
    safe = false
    error ??= { code: 'unsafe-document', message }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].content
    const marker = fenceMarker(line)
    if (fence) {
      opaqueLines.add(index)
      const trimmed = line.trim()
      if (
        marker?.marker === fence.marker &&
        marker.length >= fence.length &&
        [...trimmed].every((character) => character === fence?.marker)
      ) {
        fence = null
      }
      stack.length = 0
      section = `opaque:${++sectionSerial}`
      continue
    }
    if (marker) {
      fence = marker
      opaqueLines.add(index)
      stack.length = 0
      section = `opaque:${++sectionSerial}`
      continue
    }
    if (!line.trim() || isComment(line)) continue

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1].length
      const headingTitle = plainText(heading[2])
      if (!headingTitle) continue
      stack.length = 0
      pendingTriviaStart = index + 1
      if (title === null && level === 1) {
        title = headingTitle
        displayContainer = displayRoots
        section = `title:${++sectionSerial}`
        continue
      }
      if (nodeCount >= limits.maxNodes) {
        reject(`SUMMARY contains more than ${limits.maxNodes} navigation nodes.`)
        break
      }
      while (
        headingStack.length > 0 &&
        (headingStack.at(-1)?.level ?? Number.NEGATIVE_INFINITY) >= level
      ) {
        headingStack.pop()
      }
      if (headingStack.length > limits.maxDepth) {
        reject(`SUMMARY nesting exceeds the safe depth of ${limits.maxDepth}.`)
        break
      }
      const headingNode: ParsedHeadingNode = {
        id: `summary-heading-${lines[index].id}`,
        kind: 'heading',
        title: headingTitle,
        depth: headingStack.length,
        level,
        children: []
      }
      ;(headingStack.at(-1)?.children ?? displayRoots).push(headingNode)
      headingStack.push(headingNode)
      displayContainer = headingNode.children
      section = headingNode.id
      nodeCount++
      continue
    }

    const list = line.match(/^([ \t]*)[-+*]\s+(.+?)\s*$/)
    if (!list) {
      opaqueLines.add(index)
      stack.length = 0
      pendingTriviaStart = index + 1
      section = `opaque:${++sectionSerial}`
      continue
    }
    if (!validListItem(list[2])) {
      opaqueLines.add(index)
      stack.length = 0
      pendingTriviaStart = index + 1
      section = `opaque:${++sectionSerial}`
      continue
    }
    if (nodeCount >= limits.maxNodes) {
      reject(`SUMMARY contains more than ${limits.maxNodes} navigation nodes.`)
      break
    }
    const width = indentWidth(list[1])
    while (stack.length > 0 && width <= stack[stack.length - 1].indentWidth) stack.pop()
    if (stack.length > limits.maxDepth) {
      reject(`SUMMARY nesting exceeds the safe depth of ${limits.maxDepth}.`)
      break
    }
    const parent = stack.at(-1) ?? null
    const hasPreviousSibling = parent
      ? parent.children.length > 0
      : roots.some((candidate) => candidate.section === section)
    const node: ParsedListNode = {
      id: `summary-list-${lines[index].id}`,
      kind: 'list',
      lineIndex: index,
      leadingStart: Math.max(
        parent ? parent.lineIndex + 1 : pendingTriviaStart,
        pendingTriviaStart
      ),
      subtreeEnd: index + 1,
      indent: list[1],
      indentWidth: width,
      depth: stack.length,
      title: listTitle(list[2]),
      parentId: parent?.id ?? null,
      section,
      canIndent: hasPreviousSibling,
      children: []
    }
    if (parent) parent.children.push(node)
    else {
      roots.push(node)
      displayContainer.push(node)
    }
    byId.set(node.id, node)
    nodeCount++
    stack.push(node)
    pendingTriviaStart = index + 1
  }
  if (fence) reject('SUMMARY contains an unterminated fenced block.')

  const finalizeSubtree = (node: ParsedListNode): number => {
    node.subtreeEnd = node.children.reduce(
      (end, child) => Math.max(end, finalizeSubtree(child)),
      node.lineIndex + 1
    )
    return node.subtreeEnd
  }
  roots.forEach(finalizeSubtree)
  return { nodes: displayRoots, listRoots: roots, byId, opaqueLines, safe, error }
}

const publicNodes = (nodes: readonly ParsedDisplayNode[]): SummaryArrangementNode[] =>
  nodes.map((node) => ({
    id: node.id,
    kind: node.kind === 'heading' ? 'heading' : 'list',
    title: node.title,
    depth: node.depth,
    children: publicNodes(node.children),
    canIndent: node.kind === 'heading' ? false : node.canIndent,
    canOutdent: node.kind === 'heading' ? false : node.parentId !== null
  }))

const buildDocument = (
  bom: boolean,
  source: readonly SourceLine[],
  limits: Readonly<NormalizedSummaryDocumentLimits>,
  operationCount: number
): SummaryDocumentResult<SummaryDocument> => {
  const rebasedSource = rebaseRawSpans(source)
  const bytes = encode({ bom, source: rebasedSource })
  if (bytes.byteLength > limits.maxBytes) {
    return failure('limit-exceeded', `SUMMARY exceeds the ${limits.maxBytes} byte safety limit.`)
  }
  if (rebasedSource.length > limits.maxLines) {
    return failure('limit-exceeded', `SUMMARY exceeds the ${limits.maxLines} line safety limit.`)
  }
  const structure = parseStructure(rebasedSource, limits)
  return {
    ok: true,
    value: {
      bom,
      source: rebasedSource,
      revision: hash(bytes),
      editable: structure.safe,
      nodes: publicNodes(structure.nodes),
      operationCount,
      limits
    }
  }
}

const parseSummaryDocumentSource = (
  input: Uint8Array,
  requestedLimits?: SummaryDocumentLimits,
  retainedLineIds?: Uint32Array
): SummaryDocumentResult<SummaryDocument> => {
  const limits = normalizeLimits(requestedLimits)
  if (!ArrayBuffer.isView(input) || input.byteLength > limits.maxBytes) {
    return failure('limit-exceeded', `SUMMARY exceeds the ${limits.maxBytes} byte safety limit.`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input)
  } catch {
    return failure('invalid-encoding', 'SUMMARY must be strict UTF-8.')
  }
  const bom = text.startsWith('\uFEFF')
  if (bom) text = text.slice(1)
  if (text.includes('\uFEFF') || /\r(?!\n)/.test(text)) {
    return failure('invalid-encoding', 'SUMMARY contains an unsupported BOM or bare CR.')
  }
  let source = splitLines(text)
  if (retainedLineIds) {
    if (
      retainedLineIds.length !== source.length ||
      new Set(retainedLineIds).size !== retainedLineIds.length ||
      retainedLineIds.some((id) => !Number.isInteger(id) || id === 0)
    ) {
      return failure('unsafe-document', 'The retained SUMMARY line identities are invalid.')
    }
    source = source.map((line, index) => ({ ...line, id: retainedLineIds[index] }))
  }
  return buildDocument(bom, source, limits, 0)
}

export const parseSummaryDocument = (
  input: Uint8Array,
  requestedLimits?: SummaryDocumentLimits
): SummaryDocumentResult<SummaryDocument> => parseSummaryDocumentSource(input, requestedLimits)

/**
 * Restore a main-owned undo snapshot without deriving opaque node identities
 * from its current physical line order.
 */
export const restoreSummaryDocument = (
  input: Uint8Array,
  retainedLineIds: Uint32Array,
  requestedLimits?: SummaryDocumentLimits
): SummaryDocumentResult<SummaryDocument> =>
  parseSummaryDocumentSource(input, requestedLimits, retainedLineIds)

export const serializeSummaryDocument = (document: SummaryDocument): Buffer => encode(document)

const subtreeStyle = (
  node: ParsedListNode,
  lines: readonly SourceLine[]
): 'empty' | 'spaces' | 'tabs' | 'mixed' => {
  let style: 'empty' | 'spaces' | 'tabs' | 'mixed' = 'empty'
  for (let index = node.lineIndex; index < node.subtreeEnd; index++) {
    const match = lines[index].content.match(/^([ \t]*)[-+*]\s+/)
    if (!match) continue
    const current = indentationStyle(match[1])
    if (current === 'mixed') return 'mixed'
    if (current !== 'empty' && style !== 'empty' && style !== current) return 'mixed'
    if (current !== 'empty') style = current
  }
  return style
}

const shiftedSubtree = (
  source: readonly SourceLine[],
  node: ParsedListNode,
  remove: string,
  add: string
): SourceLine[] | null => {
  const result = source.map((line) => ({ ...line }))
  for (let index = node.lineIndex; index < node.subtreeEnd; index++) {
    const match = result[index].content.match(/^([ \t]*)([-+*]\s+.*)$/)
    if (!match) continue
    if (!match[1].startsWith(remove)) return null
    result[index].content = `${add}${match[1].slice(remove.length)}${match[2]}`
  }
  return result
}

export const applySummaryArrangement = (
  document: SummaryDocument,
  operation: SummaryArrangementOperation,
  lifetimeOperationCount: number = document.operationCount
): SummaryDocumentResult<SummaryDocument> => {
  if (!document.editable) return failure('unsafe-document', 'This SUMMARY is not safely editable.')
  if (lifetimeOperationCount >= document.limits.maxOperations) {
    return failure('limit-exceeded', 'The arrangement operation limit was reached.')
  }
  const structure = parseStructure(document.source, document.limits)
  const node = structure.byId.get(operation.nodeId)
  if (!node) return failure('node-not-found', 'The SUMMARY node no longer exists.')
  let next: SourceLine[] | null = null

  if (operation.type === 'move-before' || operation.type === 'move-after') {
    const target = structure.byId.get(operation.targetId)
    if (!target) return failure('node-not-found', 'The target SUMMARY node no longer exists.')
    if (node.id === target.id) {
      return failure('invalid-operation', 'A node cannot move onto itself.')
    }
    if (node.parentId !== target.parentId || node.section !== target.section) {
      return failure('opaque-barrier', 'Nodes can only reorder among siblings in one safe section.')
    }
    const nodeStart = node.leadingStart
    const nodeEnd = node.subtreeEnd
    const targetStart = target.leadingStart
    const targetEnd = target.subtreeEnd
    if (!(nodeEnd <= targetStart || targetEnd <= nodeStart)) {
      return failure('invalid-operation', 'Overlapping SUMMARY subtrees cannot be reordered.')
    }
    const moving = document.source.slice(nodeStart, nodeEnd)
    const remaining = [...document.source.slice(0, nodeStart), ...document.source.slice(nodeEnd)]
    let insertion = operation.type === 'move-before' ? targetStart : targetEnd
    if (nodeStart < insertion) insertion -= nodeEnd - nodeStart
    next = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
    const originalLast = document.source.at(-1)
    if (originalLast?.eol === '' && next.at(-1)?.id !== originalLast.id) {
      return failure(
        'invalid-operation',
        'The final line has no line ending and cannot be moved away from EOF safely.'
      )
    }
  } else if (operation.type === 'indent') {
    const siblings = node.parentId
      ? (structure.byId.get(node.parentId)?.children ?? [])
      : structure.listRoots.filter((candidate) => candidate.section === node.section)
    const index = siblings.findIndex((candidate) => candidate.id === node.id)
    const previous = index > 0 ? siblings[index - 1] : null
    if (!previous) return failure('invalid-operation', 'The first sibling cannot be indented.')
    const nodeStyle = subtreeStyle(node, document.source)
    const targetStyle = subtreeStyle(previous, document.source)
    if (nodeStyle === 'mixed' || targetStyle === 'mixed') {
      return failure(
        'indentation-conflict',
        'Mixed tab and space indentation cannot be reparented.'
      )
    }
    const unit = targetStyle === 'tabs' ? '\t' : '  '
    next = shiftedSubtree(document.source, node, '', unit)
  } else {
    if (!node.parentId) return failure('invalid-operation', 'A top-level node cannot be outdented.')
    const parent = structure.byId.get(node.parentId)
    if (!parent) return failure('invalid-operation', 'The parent SUMMARY node no longer exists.')
    const delta = node.indent.slice(parent.indent.length)
    if (
      !node.indent.startsWith(parent.indent) ||
      !delta ||
      indentationStyle(delta) === 'mixed' ||
      subtreeStyle(node, document.source) === 'mixed'
    ) {
      return failure('indentation-conflict', 'This subtree has ambiguous indentation.')
    }
    next = shiftedSubtree(document.source, node, delta, '')
  }
  if (!next) {
    return failure('indentation-conflict', 'The subtree indentation could not be preserved.')
  }
  const built = buildDocument(document.bom, next, document.limits, lifetimeOperationCount + 1)
  if (!built.ok) return built
  if (!built.value.editable) {
    return failure(
      'unsafe-document',
      'The operation would exceed SUMMARY limits or create an ambiguous document.'
    )
  }
  return built
}
