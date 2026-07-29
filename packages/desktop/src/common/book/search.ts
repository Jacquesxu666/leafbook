/* eslint-disable @stylistic/generator-star-spacing, @stylistic/space-before-function-paren, @stylistic/yield-star-spacing */

import type {
  BookSearchHighlightDto,
  BookSearchMatchDto,
  BookSearchMatchKind,
  BookSearchResultDto
} from '../../shared/types/bookReader'

const MAX_QUERY_LENGTH = 256
const MAX_QUERY_TOKENS = 8
const MAX_SOURCE_CHARACTERS = 256 * 1024
const MAX_SOURCE_LINES = 20_000
const MAX_UNITS = 8_000
const MAX_UNIT_LENGTH = 4_096
const MAX_ALIASES = 128
const MAX_TAGS = 128
const DEFAULT_DOCUMENT_BUDGET = 4 * 1024 * 1024
const MAX_SNIPPET_LENGTH = 240
const MAX_MATCHES_PER_DOCUMENT = 3
const CHECKPOINT_UNITS = 64
const CHECKPOINT_BYTES = 64 * 1024

export interface ParsedBookSearchQuery {
  raw: string
  normalized: string
  tokens: string[]
}

export interface BookSearchDocumentInput {
  nodeId: string
  title: string
  breadcrumbs: string[]
  filename: string
  aliases: string[]
  aliasesTruncated?: boolean
  markdown: string
  order: number
}

interface SearchUnit {
  kind: BookSearchMatchKind
  text: string
  normalized: string
  normalizedStarts?: number[]
  normalizedEnds?: number[]
  fragment: string | null
  primaryTitle: boolean
}

export interface BookSearchDocument {
  nodeId: string
  title: string
  breadcrumbs: string[]
  order: number
  units: SearchUnit[]
  estimatedBytes: number
  partial: boolean
}

export interface BookSearchDocumentMatch {
  result: BookSearchResultDto
  score: number
  order: number
  firstOffset: number
}

export interface BookSearchWorkOptions {
  maxBytes?: number
  signal?: AbortSignal
  checkpoint?: () => Promise<void>
}

interface DocumentBudget {
  bytes: number
  maxBytes: number
}

interface NormalizationCluster {
  text: string
  start: number
  end: number
}

interface GraphemeSegmenterLike {
  segment(value: string): Iterable<{ segment: string; index: number }>
}

const graphemeSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('und', { granularity: 'grapheme' })
    : null
const combiningMark = /^\p{Mark}$/u
const variationSelector = /^[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u
const emojiModifier = /^[\u{1F3FB}-\u{1F3FF}]$/u
const regionalIndicator = /^[\u{1F1E6}-\u{1F1FF}]$/u
const controlCharacter = (value: string): boolean => {
  const codePoint = value.codePointAt(0)
  return (
    codePoint !== undefined &&
    ((codePoint >= 0x00 && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      [0x00ad, 0x061c, 0x180e, 0x200b, 0x2060, 0xfeff].includes(codePoint) ||
      (codePoint >= 0x200e && codePoint <= 0x200f) ||
      (codePoint >= 0x2028 && codePoint <= 0x2029) ||
      (codePoint >= 0x2066 && codePoint <= 0x206f))
  )
}
const prependCharacter =
  /^[\u0600-\u0605\u06DD\u070F\u0890-\u0891\u08E2\u0D4E\u{110BD}\u{110CD}\u{111C2}-\u{111C3}\u{1193F}\u{11941}\u{11A3A}\u{11A84}-\u{11A89}\u{11D46}\u{11F02}]$/u
const viramaCharacter =
  /^[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D\u0DCA\u0E3A\u0F84\u1039\u103A\u1714\u1734\u17D2\u1A60\u1B44\u1BAA\u1BAB\uA806\uA8C4\uA953\uA9C0\uAAF6\uABED\u{10A3F}\u{11046}\u{11070}\u{11133}\u{111C0}\u{11235}\u{112EA}\u{1134D}\u{11442}\u{114C2}\u{115BF}\u{1163F}\u{116B6}\u{1172B}\u{11839}\u{1193D}\u{119E0}\u{11A34}\u{11A47}\u{11A99}\u{11C3F}\u{11D44}-\u{11D45}\u{11D97}\u{11F41}]$/u

const hangulClass = (value: string): 'l' | 'v' | 't' | 'lv' | 'lvt' | null => {
  const codePoint = value.codePointAt(0)
  if (codePoint === undefined) return null
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c)
  ) {
    return 'l'
  }
  if (
    (codePoint >= 0x1160 && codePoint <= 0x11a7) ||
    (codePoint >= 0xd7b0 && codePoint <= 0xd7c6)
  ) {
    return 'v'
  }
  if (
    (codePoint >= 0x11a8 && codePoint <= 0x11ff) ||
    (codePoint >= 0xd7cb && codePoint <= 0xd7fb)
  ) {
    return 't'
  }
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
    return (codePoint - 0xac00) % 28 === 0 ? 'lv' : 'lvt'
  }
  return null
}

const joinsFallbackCluster = (
  cluster: string,
  previous: string,
  next: string,
  regionalCount: number
): boolean => {
  if (cluster === '\r' && next === '\n') return true
  if (controlCharacter(previous) || controlCharacter(next)) return false
  if (
    combiningMark.test(next) ||
    variationSelector.test(next) ||
    emojiModifier.test(next) ||
    next === '\u200D' ||
    cluster.endsWith('\u200D')
  ) {
    return true
  }
  if (prependCharacter.test(previous) || viramaCharacter.test(previous)) return true
  if (regionalIndicator.test(next)) return regionalCount % 2 === 1
  const previousHangul = hangulClass(previous)
  const nextHangul = hangulClass(next)
  return (
    (previousHangul === 'l' && ['l', 'v', 'lv', 'lvt'].includes(nextHangul ?? '')) ||
    (['lv', 'v'].includes(previousHangul ?? '') && ['v', 't'].includes(nextHangul ?? '')) ||
    (['lvt', 't'].includes(previousHangul ?? '') && nextHangul === 't')
  )
}

function* fallbackNormalizationClusters(value: string): Generator<NormalizationCluster> {
  let cluster = ''
  let start = 0
  let offset = 0
  let regionalCount = 0
  let previous = ''
  for (const codePoint of value) {
    const join = cluster && joinsFallbackCluster(cluster, previous, codePoint, regionalCount)
    if (!join && cluster) {
      yield { text: cluster, start, end: offset }
      cluster = ''
      start = offset
      regionalCount = 0
    }
    cluster += codePoint
    regionalCount = regionalIndicator.test(codePoint) ? regionalCount + 1 : 0
    previous = codePoint
    offset += codePoint.length
  }
  if (cluster) yield { text: cluster, start, end: offset }
}

function* normalizationClusters(
  value: string,
  segmenter: GraphemeSegmenterLike | null = graphemeSegmenter
): Generator<NormalizationCluster> {
  if (!segmenter) {
    yield* fallbackNormalizationClusters(value)
    return
  }
  for (const item of segmenter.segment(value)) {
    yield {
      text: item.segment,
      start: item.index,
      end: item.index + item.segment.length
    }
  }
}

export const segmentBookSearchTextForTests = (
  value: string,
  segmenter: GraphemeSegmenterLike | null
): NormalizationCluster[] => [...normalizationClusters(value, segmenter)]

const normalizeCluster = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replaceAll('\u00DF', 'ss').replaceAll('\u03C2', '\u03C3')
const normalizeSearchText = (value: string): string =>
  [...normalizationClusters(value)].map((cluster) => normalizeCluster(cluster.text)).join('')

interface PreparedUnit {
  text: string
  normalizedLength: number
  identityMap: boolean
  estimatedBytes: number
  complete: boolean
}

const prepareUnit = (text: string, availableBytes: number): PreparedUnit | null => {
  const candidate = text.trim()
  if (!candidate || availableBytes < 64) return null
  let acceptedEnd = 0
  let normalizedLength = 0
  let identityMap = true
  for (const cluster of normalizationClusters(candidate)) {
    if (cluster.end > MAX_UNIT_LENGTH) break
    const segment = normalizeCluster(cluster.text)
    const nextNormalizedLength = normalizedLength + segment.length
    let nextIdentityMap: boolean = identityMap
    for (let index = 0; index < segment.length; index += 1) {
      if (
        cluster.start !== normalizedLength + index ||
        cluster.end !== normalizedLength + index + 1
      ) {
        nextIdentityMap = false
      }
    }
    const nextEnd = cluster.end
    const estimatedBytes =
      (nextEnd + nextNormalizedLength) * 2 + (nextIdentityMap ? 0 : nextNormalizedLength * 16) + 64
    if (estimatedBytes > availableBytes) break
    acceptedEnd = nextEnd
    normalizedLength = nextNormalizedLength
    identityMap = nextIdentityMap
  }
  if (!acceptedEnd) return null
  const accepted = candidate.slice(0, acceptedEnd)
  return {
    text: accepted,
    normalizedLength,
    identityMap,
    estimatedBytes:
      (accepted.length + normalizedLength) * 2 + (identityMap ? 0 : normalizedLength * 16) + 64,
    complete: acceptedEnd === candidate.length && text.length <= MAX_UNIT_LENGTH
  }
}

const materializeUnit = (
  prepared: PreparedUnit
): { normalized: string; starts?: number[]; ends?: number[] } => {
  const normalizedParts: string[] = []
  const starts = prepared.identityMap ? undefined : new Array<number>(prepared.normalizedLength)
  const ends = prepared.identityMap ? undefined : new Array<number>(prepared.normalizedLength)
  let normalizedOffset = 0
  for (const cluster of normalizationClusters(prepared.text)) {
    const segment = normalizeCluster(cluster.text)
    normalizedParts.push(segment)
    if (starts && ends) {
      for (let index = 0; index < segment.length; index += 1) {
        starts[normalizedOffset + index] = cluster.start
        ends[normalizedOffset + index] = cluster.end
      }
    }
    normalizedOffset += segment.length
  }
  return {
    normalized: normalizedParts.join(''),
    ...(starts && ends ? { starts, ends } : {})
  }
}

export const parseBookSearchQuery = (value: string): ParsedBookSearchQuery | null => {
  const raw = value.trim()
  if (!raw || raw.length > MAX_QUERY_LENGTH) return null
  const normalized = normalizeSearchText(raw)
  const tokens = normalized.split(/\s+/u).filter(Boolean)
  if (!tokens.length || tokens.length > MAX_QUERY_TOKENS) return null
  return { raw, normalized, tokens }
}

const plainMarkdown = (value: string): string =>
  value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]*>/gu, '')
    .replace(/[`*_~]/gu, '')
    .replace(/^\s*(?:>|[-+*]|\d+[.)])\s+/u, '')
    .trim()

const tagValues = (markdown: string): { values: string[]; partial: boolean } => {
  const lines = markdown.split(/\r?\n/u, 400)
  if (lines[0]?.trim() !== '---') return { values: [], partial: false }
  const end = lines.slice(1, 200).findIndex((line) => line.trim() === '---')
  if (end < 0) return { values: [], partial: lines.length >= 200 }
  const tags: string[] = []
  let partial = false
  let collecting = false
  for (const rawLine of lines.slice(1, end + 1)) {
    if (rawLine.length > MAX_UNIT_LENGTH) partial = true
    const line = rawLine.slice(0, MAX_UNIT_LENGTH + 1)
    const key = line.match(/^\s*tags?\s*:\s*(.*)$/iu)
    if (key) {
      collecting = true
      const value = key[1]?.replace(/^\[|\]$/gu, '') ?? ''
      const candidates = value
        .split(',', MAX_TAGS + 1)
        .map((tag) => tag.trim().replace(/^['"]|['"]$/gu, ''))
      for (const candidate of candidates) {
        if (tags.length >= MAX_TAGS) {
          partial = true
          break
        }
        tags.push(candidate)
      }
      continue
    }
    const item = collecting ? line.match(/^\s*-\s+(.+)$/u) : null
    if (item?.[1]) {
      if (tags.length >= MAX_TAGS) partial = true
      else tags.push(item[1].trim().replace(/^['"]|['"]$/gu, ''))
    } else if (line.trim()) collecting = false
  }
  return { values: tags.filter(Boolean), partial }
}

const addUnit = (
  units: SearchUnit[],
  kind: BookSearchMatchKind,
  text: string,
  fragment: string | null,
  budget: DocumentBudget,
  primaryTitle = false
): boolean => {
  if (units.length >= MAX_UNITS) return false
  if (!text.trim()) return text.length <= MAX_UNIT_LENGTH
  const prepared = prepareUnit(text, budget.maxBytes - budget.bytes)
  if (!prepared) return false
  const mapped = materializeUnit(prepared)
  units.push({
    kind,
    text: prepared.text,
    normalized: mapped.normalized,
    ...(mapped.starts && mapped.ends
      ? { normalizedStarts: mapped.starts, normalizedEnds: mapped.ends }
      : {}),
    fragment,
    primaryTitle
  })
  budget.bytes += prepared.estimatedBytes
  return prepared.complete
}

export const createBookSearchDocument = (
  input: BookSearchDocumentInput,
  options: BookSearchWorkOptions = {}
): BookSearchDocument => {
  const units: SearchUnit[] = []
  const baseBytes = (input.title.length + input.breadcrumbs.join('').length) * 2
  const maxBytes = Math.max(1_024, Math.min(DEFAULT_DOCUMENT_BUDGET, options.maxBytes ?? Infinity))
  const budget = {
    bytes: Math.min(baseBytes, maxBytes),
    maxBytes
  }
  let partial =
    baseBytes > maxBytes ||
    input.markdown.length > MAX_SOURCE_CHARACTERS ||
    Boolean(input.aliasesTruncated)
  partial = !addUnit(units, 'title', input.title, null, budget, true) || partial
  partial = !addUnit(units, 'filename', input.filename, null, budget) || partial
  if (input.aliases.length > MAX_ALIASES) partial = true
  for (const alias of input.aliases.slice(0, MAX_ALIASES)) {
    partial = !addUnit(units, 'title', alias, null, budget) || partial
  }

  const boundedMarkdown = input.markdown.slice(0, MAX_SOURCE_CHARACTERS)
  const tags = tagValues(boundedMarkdown)
  partial = partial || tags.partial
  for (const tag of tags.values) {
    partial = !addUnit(units, 'tag', plainMarkdown(tag), null, budget) || partial
  }

  const lines = boundedMarkdown.split(/\r?\n/u)
  if (lines.length > MAX_SOURCE_LINES) partial = true
  const frontmatterEnd =
    lines[0]?.trim() === '---'
      ? lines.slice(1, 200).findIndex((line) => line.trim() === '---') + 1
      : 0
  let fence: { marker: string; length: number } | null = null
  let fragment: string | null = null
  const boundedLines = lines.slice(0, MAX_SOURCE_LINES)
  for (
    let index = frontmatterEnd > 0 ? frontmatterEnd + 1 : 0;
    index < boundedLines.length;
    index += 1
  ) {
    const rawLine = boundedLines[index] ?? ''
    if (rawLine.length > MAX_UNIT_LENGTH) partial = true
    const line = rawLine.slice(0, MAX_UNIT_LENGTH + 1)
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u)
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] ?? '`'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (marker === fence.marker && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fence) {
      partial = !addUnit(units, 'code', line, fragment, budget) || partial
      continue
    }

    const atx = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)
    const next = (boundedLines[index + 1] ?? '').slice(0, MAX_UNIT_LENGTH + 1)
    const setext = !atx && line.trim() && /^\s{0,3}(?:=+|-+)\s*$/u.test(next)
    if (atx?.[1] || setext) {
      const heading = plainMarkdown(atx?.[1] ?? line)
      fragment = heading || fragment
      partial = !addUnit(units, 'heading', heading, fragment, budget) || partial
      if (setext) index += 1
      continue
    }
    partial = !addUnit(units, 'body', plainMarkdown(line), fragment, budget) || partial
    if (units.length >= MAX_UNITS || budget.bytes >= budget.maxBytes) {
      partial = index + 1 < boundedLines.length || partial
      break
    }
  }

  return {
    nodeId: input.nodeId,
    title: input.title,
    breadcrumbs: [...input.breadcrumbs],
    order: input.order,
    units,
    estimatedBytes: budget.bytes,
    partial
  }
}

const abortIfRequested = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
}

class AsyncSearchWork {
  private bytes = 0
  private units = 0

  constructor(
    private readonly signal: AbortSignal | undefined,
    private readonly checkpoint: () => Promise<void>
  ) {}

  async account(bytes: number, units = 0): Promise<void> {
    abortIfRequested(this.signal)
    this.bytes += bytes
    this.units += units
    if (this.bytes < CHECKPOINT_BYTES && this.units < CHECKPOINT_UNITS) return
    this.bytes = 0
    this.units = 0
    await this.checkpoint()
    abortIfRequested(this.signal)
  }
}

const prepareUnitAsync = async (
  text: string,
  availableBytes: number,
  work: AsyncSearchWork
): Promise<PreparedUnit | null> => {
  const candidate = text.trim()
  if (!candidate || availableBytes < 64) return null
  let acceptedEnd = 0
  let normalizedLength = 0
  let identityMap = true
  for (const cluster of normalizationClusters(candidate)) {
    if (cluster.end > MAX_UNIT_LENGTH) break
    const segment = normalizeCluster(cluster.text)
    const nextNormalizedLength = normalizedLength + segment.length
    let nextIdentityMap: boolean = identityMap
    for (let index = 0; index < segment.length; index += 1) {
      if (
        cluster.start !== normalizedLength + index ||
        cluster.end !== normalizedLength + index + 1
      ) {
        nextIdentityMap = false
      }
    }
    const nextEnd = cluster.end
    const estimatedBytes =
      (nextEnd + nextNormalizedLength) * 2 + (nextIdentityMap ? 0 : nextNormalizedLength * 16) + 64
    await work.account((cluster.text.length + segment.length) * 2)
    if (estimatedBytes > availableBytes) break
    acceptedEnd = nextEnd
    normalizedLength = nextNormalizedLength
    identityMap = nextIdentityMap
  }
  if (!acceptedEnd) return null
  const accepted = candidate.slice(0, acceptedEnd)
  return {
    text: accepted,
    normalizedLength,
    identityMap,
    estimatedBytes:
      (accepted.length + normalizedLength) * 2 + (identityMap ? 0 : normalizedLength * 16) + 64,
    complete: acceptedEnd === candidate.length && text.length <= MAX_UNIT_LENGTH
  }
}

const materializeUnitAsync = async (
  prepared: PreparedUnit,
  work: AsyncSearchWork
): Promise<{ normalized: string; starts?: number[]; ends?: number[] }> => {
  const normalizedParts: string[] = []
  const starts = prepared.identityMap ? undefined : new Array<number>(prepared.normalizedLength)
  const ends = prepared.identityMap ? undefined : new Array<number>(prepared.normalizedLength)
  let normalizedOffset = 0
  for (const cluster of normalizationClusters(prepared.text)) {
    const segment = normalizeCluster(cluster.text)
    normalizedParts.push(segment)
    if (starts && ends) {
      for (let index = 0; index < segment.length; index += 1) {
        starts[normalizedOffset + index] = cluster.start
        ends[normalizedOffset + index] = cluster.end
      }
    }
    normalizedOffset += segment.length
    await work.account(segment.length * (starts ? 18 : 2))
  }
  return {
    normalized: normalizedParts.join(''),
    ...(starts && ends ? { starts, ends } : {})
  }
}

const addUnitAsync = async (
  units: SearchUnit[],
  kind: BookSearchMatchKind,
  text: string,
  fragment: string | null,
  budget: DocumentBudget,
  work: AsyncSearchWork,
  primaryTitle = false
): Promise<boolean> => {
  if (units.length >= MAX_UNITS) return false
  await work.account(text.length * 2, 1)
  if (!text.trim()) return text.length <= MAX_UNIT_LENGTH
  const prepared = await prepareUnitAsync(text, budget.maxBytes - budget.bytes, work)
  if (!prepared) return false
  const mapped = await materializeUnitAsync(prepared, work)
  units.push({
    kind,
    text: prepared.text,
    normalized: mapped.normalized,
    ...(mapped.starts && mapped.ends
      ? { normalizedStarts: mapped.starts, normalizedEnds: mapped.ends }
      : {}),
    fragment,
    primaryTitle
  })
  budget.bytes += prepared.estimatedBytes
  return prepared.complete
}

const tagValuesAsync = async (
  markdown: string,
  work: AsyncSearchWork
): Promise<{ values: string[]; partial: boolean }> => {
  const lines = markdown.split(/\r?\n/u, 400)
  if (lines[0]?.trim() !== '---') return { values: [], partial: false }
  let end = -1
  for (let index = 1; index < Math.min(lines.length, 200); index += 1) {
    const line = lines[index] ?? ''
    await work.account(line.length * 2, 1)
    if (line.trim() === '---') {
      end = index - 1
      break
    }
  }
  if (end < 0) return { values: [], partial: lines.length >= 200 }
  const tags: string[] = []
  let partial = false
  let collecting = false
  for (let index = 1; index <= end + 1; index += 1) {
    const rawLine = lines[index] ?? ''
    await work.account(rawLine.length * 2, 1)
    if (rawLine.length > MAX_UNIT_LENGTH) partial = true
    const line = rawLine.slice(0, MAX_UNIT_LENGTH + 1)
    const key = line.match(/^\s*tags?\s*:\s*(.*)$/iu)
    if (key) {
      collecting = true
      const value = key[1]?.replace(/^\[|\]$/gu, '') ?? ''
      const candidates = value
        .split(',', MAX_TAGS + 1)
        .map((tag) => tag.trim().replace(/^['"]|['"]$/gu, ''))
      for (const candidate of candidates) {
        await work.account(candidate.length * 2, 1)
        if (tags.length >= MAX_TAGS) {
          partial = true
          break
        }
        tags.push(candidate)
      }
      continue
    }
    const item = collecting ? line.match(/^\s*-\s+(.+)$/u) : null
    if (item?.[1]) {
      if (tags.length >= MAX_TAGS) partial = true
      else tags.push(item[1].trim().replace(/^['"]|['"]$/gu, ''))
    } else if (line.trim()) collecting = false
  }
  return { values: tags.filter(Boolean), partial }
}

export const createBookSearchDocumentAsync = async (
  input: BookSearchDocumentInput,
  options: BookSearchWorkOptions = {}
): Promise<BookSearchDocument> => {
  const work = new AsyncSearchWork(options.signal, options.checkpoint ?? (() => Promise.resolve()))
  const units: SearchUnit[] = []
  const baseBytes = (input.title.length + input.breadcrumbs.join('').length) * 2
  const maxBytes = Math.max(1_024, Math.min(DEFAULT_DOCUMENT_BUDGET, options.maxBytes ?? Infinity))
  const budget = { bytes: Math.min(baseBytes, maxBytes), maxBytes }
  let partial =
    baseBytes > maxBytes ||
    input.markdown.length > MAX_SOURCE_CHARACTERS ||
    Boolean(input.aliasesTruncated)
  partial = !(await addUnitAsync(units, 'title', input.title, null, budget, work, true)) || partial
  partial = !(await addUnitAsync(units, 'filename', input.filename, null, budget, work)) || partial
  if (input.aliases.length > MAX_ALIASES) partial = true
  for (const alias of input.aliases.slice(0, MAX_ALIASES)) {
    partial = !(await addUnitAsync(units, 'title', alias, null, budget, work)) || partial
  }

  const boundedMarkdown = input.markdown.slice(0, MAX_SOURCE_CHARACTERS)
  const tags = await tagValuesAsync(boundedMarkdown, work)
  partial = partial || tags.partial
  for (const tag of tags.values) {
    partial = !(await addUnitAsync(units, 'tag', plainMarkdown(tag), null, budget, work)) || partial
  }

  const lines = boundedMarkdown.split(/\r?\n/u)
  if (lines.length > MAX_SOURCE_LINES) partial = true
  let frontmatterEnd = 0
  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < Math.min(lines.length, 200); index += 1) {
      const line = lines[index] ?? ''
      await work.account(line.length * 2, 1)
      if (line.trim() === '---') {
        frontmatterEnd = index
        break
      }
    }
  }
  let fence: { marker: string; length: number } | null = null
  let fragment: string | null = null
  const boundedLines = lines.slice(0, MAX_SOURCE_LINES)
  for (
    let index = frontmatterEnd > 0 ? frontmatterEnd + 1 : 0;
    index < boundedLines.length;
    index += 1
  ) {
    const rawLine = boundedLines[index] ?? ''
    await work.account(rawLine.length * 2, 1)
    if (rawLine.length > MAX_UNIT_LENGTH) partial = true
    const line = rawLine.slice(0, MAX_UNIT_LENGTH + 1)
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u)
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] ?? '`'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (marker === fence.marker && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fence) {
      partial = !(await addUnitAsync(units, 'code', line, fragment, budget, work)) || partial
      continue
    }

    const atx = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)
    const next = (boundedLines[index + 1] ?? '').slice(0, MAX_UNIT_LENGTH + 1)
    const setext = !atx && line.trim() && /^\s{0,3}(?:=+|-+)\s*$/u.test(next)
    if (atx?.[1] || setext) {
      const heading = plainMarkdown(atx?.[1] ?? line)
      fragment = heading || fragment
      partial = !(await addUnitAsync(units, 'heading', heading, fragment, budget, work)) || partial
      if (setext) index += 1
      continue
    }
    partial =
      !(await addUnitAsync(units, 'body', plainMarkdown(line), fragment, budget, work)) || partial
    if (units.length >= MAX_UNITS || budget.bytes >= budget.maxBytes) {
      partial = index + 1 < boundedLines.length || partial
      break
    }
  }
  abortIfRequested(options.signal)
  return {
    nodeId: input.nodeId,
    title: input.title,
    breadcrumbs: [...input.breadcrumbs],
    order: input.order,
    units,
    estimatedBytes: budget.bytes,
    partial
  }
}

const rank: Record<BookSearchMatchKind, number> = {
  title: 800,
  filename: 700,
  tag: 700,
  heading: 600,
  body: 400,
  code: 300
}

const safeStart = (text: string, index: number): number => {
  if (index > 0 && /[\uDC00-\uDFFF]/u.test(text[index] ?? '')) return index - 1
  return index
}

const safeEnd = (text: string, index: number): number => {
  if (index < text.length && /[\uDC00-\uDFFF]/u.test(text[index] ?? '')) return index + 1
  return index
}

const makeSnippet = (
  unit: SearchUnit,
  query: ParsedBookSearchQuery
): { snippet: string; highlights: BookSearchHighlightDto[]; offset: number } | null => {
  const offsets = query.tokens.map((token) => unit.normalized.indexOf(token))
  if (offsets.some((offset) => offset < 0)) return null
  const originalRanges = offsets.map((offset, index) => ({
    start: unit.normalizedStarts?.[offset] ?? offset,
    end:
      unit.normalizedEnds?.[offset + (query.tokens[index]?.length ?? 1) - 1] ??
      offset + (query.tokens[index]?.length ?? 0)
  }))
  const first = Math.min(...originalRanges.map((range) => range.start))
  let start = safeStart(unit.text, Math.max(0, first - Math.floor(MAX_SNIPPET_LENGTH / 3)))
  const end = safeEnd(unit.text, Math.min(unit.text.length, start + MAX_SNIPPET_LENGTH))
  if (end - start < MAX_SNIPPET_LENGTH) {
    start = safeStart(unit.text, Math.max(0, end - MAX_SNIPPET_LENGTH))
  }
  const prefix = start > 0 ? '…' : ''
  const suffix = end < unit.text.length ? '…' : ''
  const snippet = `${prefix}${unit.text.slice(start, end)}${suffix}`
  const highlights = originalRanges
    .map((range) => ({
      start: range.start - start + prefix.length,
      end: range.end - start + prefix.length
    }))
    .filter((range) => range.start >= prefix.length && range.end <= snippet.length - suffix.length)
    .sort((left, right) => left.start - right.start)
  return { snippet, highlights, offset: first }
}

export const matchBookSearchDocument = (
  document: BookSearchDocument,
  query: ParsedBookSearchQuery
): BookSearchDocumentMatch | null => {
  const matching = document.units
    .map((unit) => ({ unit, snippet: makeSnippet(unit, query) }))
    .filter(
      (
        item
      ): item is {
        unit: SearchUnit
        snippet: { snippet: string; highlights: BookSearchHighlightDto[]; offset: number }
      } => Boolean(item.snippet)
    )
  if (!matching.length) return null
  matching.sort((left, right) => {
    const leftExact = left.unit.primaryTitle && left.unit.normalized === query.normalized ? 200 : 0
    const rightExact =
      right.unit.primaryTitle && right.unit.normalized === query.normalized ? 200 : 0
    const leftPrefix =
      left.unit.primaryTitle && left.unit.normalized.startsWith(query.normalized) ? 100 : 0
    const rightPrefix =
      right.unit.primaryTitle && right.unit.normalized.startsWith(query.normalized) ? 100 : 0
    return (
      rank[right.unit.kind] +
        rightExact +
        rightPrefix -
        (rank[left.unit.kind] + leftExact + leftPrefix) ||
      (left.snippet?.offset ?? 0) - (right.snippet?.offset ?? 0)
    )
  })
  const first = matching[0]
  if (!first?.snippet) return null
  const matches: BookSearchMatchDto[] = matching
    .slice(0, MAX_MATCHES_PER_DOCUMENT)
    .map(({ unit, snippet }) => ({
      kind: unit.kind,
      snippet: snippet?.snippet ?? '',
      highlights: snippet?.highlights ?? [],
      fragment: unit.fragment
    }))
  const exact = first.unit.primaryTitle && first.unit.normalized === query.normalized ? 200 : 0
  const prefix =
    first.unit.primaryTitle && first.unit.normalized.startsWith(query.normalized) ? 100 : 0
  return {
    result: {
      nodeId: document.nodeId,
      title: document.title,
      breadcrumbs: [...document.breadcrumbs],
      matches
    },
    score: rank[first.unit.kind] + exact + prefix,
    order: document.order,
    firstOffset: first.snippet.offset
  }
}

export const matchBookSearchDocumentAsync = async (
  document: BookSearchDocument,
  query: ParsedBookSearchQuery,
  options: BookSearchWorkOptions = {}
): Promise<BookSearchDocumentMatch | null> => {
  const matching: Array<{
    unit: SearchUnit
    snippet: { snippet: string; highlights: BookSearchHighlightDto[]; offset: number }
  }> = []
  const checkpoint = options.checkpoint ?? (() => Promise.resolve())
  const compareMatches = (
    left: (typeof matching)[number],
    right: (typeof matching)[number]
  ): number => {
    const leftExact = left.unit.primaryTitle && left.unit.normalized === query.normalized ? 200 : 0
    const rightExact =
      right.unit.primaryTitle && right.unit.normalized === query.normalized ? 200 : 0
    const leftPrefix =
      left.unit.primaryTitle && left.unit.normalized.startsWith(query.normalized) ? 100 : 0
    const rightPrefix =
      right.unit.primaryTitle && right.unit.normalized.startsWith(query.normalized) ? 100 : 0
    return (
      rank[right.unit.kind] +
        rightExact +
        rightPrefix -
        (rank[left.unit.kind] + leftExact + leftPrefix) ||
      left.snippet.offset - right.snippet.offset
    )
  }
  for (let index = 0; index < document.units.length; index += 1) {
    abortIfRequested(options.signal)
    const unit = document.units[index]
    if (unit) {
      const snippet = makeSnippet(unit, query)
      if (snippet) {
        matching.push({ unit, snippet })
        matching.sort(compareMatches)
        if (matching.length > MAX_MATCHES_PER_DOCUMENT) matching.pop()
      }
    }
    if ((index + 1) % CHECKPOINT_UNITS === 0) {
      await checkpoint()
      abortIfRequested(options.signal)
    }
  }
  abortIfRequested(options.signal)
  if (!matching.length) return null
  const first = matching[0]
  if (!first) return null
  const exact = first.unit.primaryTitle && first.unit.normalized === query.normalized ? 200 : 0
  const prefix =
    first.unit.primaryTitle && first.unit.normalized.startsWith(query.normalized) ? 100 : 0
  return {
    result: {
      nodeId: document.nodeId,
      title: document.title,
      breadcrumbs: [...document.breadcrumbs],
      matches: matching.slice(0, MAX_MATCHES_PER_DOCUMENT).map(({ unit, snippet }) => ({
        kind: unit.kind,
        snippet: snippet.snippet,
        highlights: snippet.highlights,
        fragment: unit.fragment
      }))
    },
    score: rank[first.unit.kind] + exact + prefix,
    order: document.order,
    firstOffset: first.snippet.offset
  }
}

export const searchBookDocuments = (
  documents: BookSearchDocument[],
  rawQuery: string,
  limit: number
): BookSearchResultDto[] => {
  const query = parseBookSearchQuery(rawQuery)
  if (!query) return []
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 50))
  return documents
    .map((document) => matchBookSearchDocument(document, query))
    .filter((match): match is BookSearchDocumentMatch => Boolean(match))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.order - right.order ||
        left.firstOffset - right.firstOffset ||
        left.result.nodeId.localeCompare(right.result.nodeId)
    )
    .slice(0, boundedLimit)
    .map((match) => match.result)
}
