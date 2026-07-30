/* eslint-disable @stylistic/indent, @stylistic/space-before-function-paren */
import path from 'path'
import fs from 'fs/promises'
import fsSync, { constants as fsConstants, type BigIntStats } from 'fs'
import { createHash, randomUUID } from 'crypto'
import {
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import Store from 'electron-store'
import { loadBookFromDirectory, safelyReadBookChapter } from './filesystem'
import { BookArrangementManager } from './arrangementManager'
import { resolveBookTarget } from 'common/book/path'
import { validateBookExportHtml } from 'common/book/exportPolicy'
import {
  BOOK_WEBSITE_FILES,
  BOOK_WEBSITE_INDEX,
  BOOK_WEBSITE_MANIFEST,
  createBookWebsiteManifest,
  parseBookWebsiteManifest,
  serializeBookWebsiteManifest,
  sha256Bytes
} from 'common/book/websitePolicy'
import {
  createBookSearchDocumentAsync,
  matchBookSearchDocumentAsync,
  parseBookSearchQuery,
  type BookSearchDocument
} from 'common/book/search'
import type { BookNavigationNode } from 'common/book/model'
import type {
  BookChapterDto,
  BookArrangementApplyRequestDto,
  BookArrangementDto,
  BookArrangementSaveDto,
  BookArrangementSaveRequestDto,
  BookEditDto,
  BookEditFormatDto,
  BookEditSaveDto,
  BookEditSaveRequestDto,
  BookExportCommitRequestDto,
  BookExportDocumentDto,
  BookExportSaveDto,
  BookExportSnapshotDto,
  BookWebsiteCommitRequestDto,
  BookWebsiteSaveDto,
  BookWebsiteSnapshotDto,
  BookLinkNavigationDto,
  BookReadingProgressDto,
  BookReaderNodeDto,
  BookReaderResult,
  BookSearchIndexStatusDto,
  BookSearchProgressDto,
  BookSearchRequestDto,
  BookSearchResponseDto,
  BookshelfEntryDto,
  BookSessionDto
} from '@shared/types/bookReader'

const MAX_BOOKS = 50
const MAX_SESSIONS = 20
const MAX_ID_LENGTH = 128
const MAX_HREF_LENGTH = 8_192
const MAX_READING_POSITIONS = 500
const MAX_STABLE_KEY_LENGTH = 16_384
const MAX_CHAPTER_TITLE_LENGTH = 512
const READING_PROGRESS_EPSILON = 0.001
const MAX_SEARCH_INDEX_BYTES = 32 * 1024 * 1024
const MAX_SEARCH_CACHE_BYTES = 64 * 1024 * 1024
const SEARCH_YIELD_DOCUMENTS = 32
const SEARCH_YIELD_BYTES = 256 * 1024
const MAX_ACTIVE_SEARCH_OWNERS = 8
const SEARCH_INDEX_RESERVATION_BYTES = MAX_SEARCH_INDEX_BYTES
const SEARCH_ROOT_CHECKPOINT_INTERVAL = 8
const MAX_EDIT_BYTES = 8 * 1024 * 1024
const MAX_EXPORT_DOCUMENTS = 2_000
const MAX_EXPORT_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_EXPORT_HTML_BYTES = 64 * 1024 * 1024
const MAX_ACTIVE_EXPORT_OWNERS = 4
const MAX_EXPORT_LINKS = 16_384
const MAX_EXPORT_LINKS_PER_DOCUMENT = 1_024
const EXPORT_HASH_CHUNK_BYTES = 64 * 1024

interface PersistedChapterPosition {
  targetKey: string
  ratio: number
  updatedAt: string
}

interface PersistedReadingState {
  lastTargetKey: string
  lastChapterTitle: string
  overallProgress: number
  updatedAt: string
  positions: PersistedChapterPosition[]
}

interface PersistedLibrary {
  libraryId: string
  rootPath: string
  title: string
  lastOpenedAt: string
  reading?: PersistedReadingState
}

interface BookshelfSchema {
  libraries: PersistedLibrary[]
}

type SessionTarget =
  | {
      kind: 'chapter'
      path: string
      fragment: string | null
      title: string
      stableKey: string
    }
  | { kind: 'external'; url: string; title: string; stableKey: string }

interface BookSession {
  libraryId: string
  rootPath: string
  rootIdentity: RootIdentity
  ownerId: number
  generation: number
  dto: BookSessionDto
  targets: Map<string, SessionTarget>
  chapterNodeByPath: Map<string, string>
  opaqueNodeIds: Map<string, string>
  readableNodeIds: string[]
  searchSources: SearchSource[]
  summaryPath: 'SUMMARY.md' | 'SUMMARY.markdown' | null
}

interface SearchSource {
  nodeId: string
  path: string
  title: string
  breadcrumbs: string[]
  aliases: string[]
  aliasesTruncated: boolean
  filename: string
  order: number
}

interface SearchIndex {
  documents: BookSearchDocument[]
  status: BookSearchIndexStatusDto
  estimatedBytes: number
}

interface SearchBuild {
  controller: AbortController
  ownerGeneration: number
  checkpointCount: number
  waiters: Map<string, (progress: BookSearchProgressDto) => void>
  promise: Promise<SearchIndex>
}

class SearchBusyError extends Error {
  override name = 'SearchBusyError'
}

interface ActiveSearch {
  searchId: string
  session: BookSession
  controller: AbortController
  ownerGeneration: number
}

interface RootIdentity {
  realPath: string
  dev: bigint
  ino: bigint
}

interface FileIdentity {
  dev: bigint
  ino: bigint
  mode: number
}

interface PathComponentIdentity extends FileIdentity {
  path: string
}

interface OverwriteGrant {
  token: string
  ownerId: number
  leaseGeneration: number
  rootIdentity: RootIdentity
  targetIdentity: FileIdentity
  baseRevision: string
  externalRevision: string
  candidateRevision: string
}

interface BookEditLease {
  editId: string
  ownerId: number
  sessionId: string
  session: BookSession
  sessionGeneration: number
  libraryId: string
  nodeId: string
  stableKey: string
  title: string
  rootPath: string
  rootIdentity: RootIdentity
  targetPath: string
  parentPath: string
  parentIdentity: FileIdentity
  ancestry: PathComponentIdentity[]
  targetIdentity: FileIdentity
  revision: string
  format: BookEditFormatDto
  generation: number
  controller: AbortController
  operation: Promise<BookReaderResult<BookEditDto | BookEditSaveDto>> | null
  operationKey: string | null
  operationGeneration: number
  overwriteGrant: OverwriteGrant | null
  criticalCommit: boolean
  revokeAfterCommit: boolean
}

interface ExportSourceRevision {
  path: string
  revision: string | null
  byteLength: number
}

interface BookExportLease {
  exportId: string
  ownerId: number
  ownerGeneration: number
  session: BookSession
  sessionGeneration: number
  rootIdentity: RootIdentity
  targetPath: string
  parentPath: string
  parentIdentity: FileIdentity
  targetIdentity: FileIdentity | null
  targetLinkCount: bigint | null
  kind: 'html' | 'website'
  websiteTargetState: 'absent' | 'empty' | 'owned' | null
  websiteTargetFiles: WebsiteFileIdentities | null
  sources: ExportSourceRevision[]
  controller: AbortController
  parentFd: number | null
  generation: number
  operationGeneration: number
  operation:
    | Promise<BookReaderResult<BookExportSaveDto>>
    | Promise<BookReaderResult<BookWebsiteSaveDto>>
    | null
  state: 'ready' | 'validating' | 'writing' | 'committing'
  criticalCommit: boolean
  revokeAfterCommit: boolean
}

interface WebsiteDirectoryInspection {
  state: 'absent' | 'empty' | 'owned'
  identity: FileIdentity | null
  linkCount: bigint | null
  files: WebsiteFileIdentities | null
}

interface WebsiteFileIdentities {
  index: FileIdentity
  manifest: FileIdentity
  indexSha256: string
  manifestSha256: string
}

export interface BookSessionManagerTestHooks {
  afterEditRead?: (operation: 'begin' | 'reload') => void | Promise<void>
  afterEditTempSync?: () => void | Promise<void>
  beforeEditCommitCritical?: () => void | Promise<void>
  editCommitCriticalStarted?: () => void
  afterArrangementSave?: () => void | Promise<void>
  beforeExportParentPin?: () => void | Promise<void>
  afterExportSourcePass?: (pass: 1 | 2) => void | Promise<void>
  afterExportTempOpen?: (tempPath?: string) => void | Promise<void>
  afterExportTempSync?: (tempPath?: string) => void | Promise<void>
  beforeExportCommitCritical?: () => void | Promise<void>
  exportCommitCriticalStarted?: () => void
  afterExportRename?: () => void
  beforeWebsiteFirstRename?: (stagePath?: string, targetPath?: string) => void
  beforeWebsiteStageRename?: (stagePath?: string, targetPath?: string) => void
  afterWebsiteStageRename?: (targetPath?: string) => void
  beforeWebsiteRollback?: (backupPath?: string, targetPath?: string) => void
  beforeWebsiteBackupCleanup?: (backupPath?: string) => void
  duringWebsiteBackupCleanup?: (backupPath?: string) => void
  beforeWebsiteIndexFinalInspection?: (backupPath?: string) => void
  afterWebsiteIndexFinalInspection?: (backupPath?: string) => void
  beforeWebsiteManifestFinalInspection?: (backupPath?: string) => void
  afterWebsiteManifestFinalInspection?: (backupPath?: string) => void
}

const error = <T>(
  code: Parameters<typeof structuredError>[0],
  message: string,
  overwriteToken?: string,
  committed?: boolean
): BookReaderResult<T> => ({
  ok: false,
  error: structuredError(code, message, overwriteToken, committed)
})

const structuredError = (
  code:
    | 'invalid-request'
    | 'cancelled'
    | 'library-not-found'
    | 'book-unavailable'
    | 'session-not-found'
    | 'node-not-found'
    | 'node-not-readable'
    | 'chapter-read-failed'
    | 'unsafe-link'
    | 'link-not-found'
    | 'search-cancelled'
    | 'search-busy'
    | 'search-unavailable'
    | 'edit-not-found'
    | 'edit-read-only'
    | 'edit-conflict'
    | 'edit-encoding'
    | 'edit-too-large'
    | 'edit-mixed-line-endings'
    | 'edit-commit-uncertain'
    | 'edit-write-failed'
    | 'arrangement-not-found'
    | 'arrangement-read-only'
    | 'arrangement-conflict'
    | 'arrangement-encoding'
    | 'arrangement-too-large'
    | 'arrangement-commit-uncertain'
    | 'arrangement-write-failed'
    | 'export-busy'
    | 'export-too-large'
    | 'export-source-changed'
    | 'export-invalid-output'
    | 'export-write-failed'
    | 'website-busy'
    | 'website-too-large'
    | 'website-source-changed'
    | 'website-invalid-output'
    | 'website-unsafe-target'
    | 'website-commit-uncertain'
    | 'website-write-failed',
  message: string,
  overwriteToken?: string,
  committed?: boolean
) => ({
  code,
  message,
  ...(overwriteToken ? { overwriteToken } : {}),
  ...(committed === undefined ? {} : { committed })
})

const validOpaqueId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 16 &&
  value.length <= MAX_ID_LENGTH &&
  /^[a-zA-Z0-9-]+$/.test(value)

const hashBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')

const markdownLinkHrefs = (markdown: string): string[] => {
  const values = new Set<string>()
  const inline = /!?\[[^\]\n]{0,4096}\]\(\s*(?:<([^>\n]{1,8192})>|([^\s)\n]{1,8192}))/g
  for (const match of markdown.matchAll(inline)) {
    if (match[0].startsWith('!')) continue
    const href = match[1] ?? match[2]
    if (href) values.add(href)
    if (values.size >= MAX_EXPORT_LINKS_PER_DOCUMENT) break
  }
  const autolink = /<((?:https?|mailto):[^>\n]{1,8192})>/gi
  for (const match of markdown.matchAll(autolink)) {
    if (match[1]) values.add(match[1])
    if (values.size >= MAX_EXPORT_LINKS_PER_DOCUMENT) break
  }
  return [...values]
}

const sameFileIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino

const sameRootIdentity = (left: RootIdentity, right: RootIdentity): boolean =>
  left.realPath === right.realPath && left.dev === right.dev && left.ino === right.ino

const fileIdentity = async (
  targetPath: string,
  requireDirectory = false
): Promise<FileIdentity | null> => {
  try {
    const stat = await fs.lstat(targetPath, { bigint: true })
    if (stat.isSymbolicLink() || (requireDirectory ? !stat.isDirectory() : !stat.isFile())) {
      return null
    }
    return { dev: stat.dev, ino: stat.ino, mode: Number(stat.mode) }
  } catch {
    return null
  }
}

const fileIdentitySync = (targetPath: string, requireDirectory = false): FileIdentity | null => {
  try {
    const stat = fsSync.lstatSync(targetPath, { bigint: true })
    if (stat.isSymbolicLink() || (requireDirectory ? !stat.isDirectory() : !stat.isFile())) {
      return null
    }
    return { dev: stat.dev, ino: stat.ino, mode: Number(stat.mode) }
  } catch {
    return null
  }
}

const readPinnedRegularFileSync = (
  targetPath: string,
  maxBytes: number
): { bytes: Buffer; identity: FileIdentity } | null => {
  let fd: number | null = null
  try {
    const pathname = fsSync.lstatSync(targetPath, { bigint: true })
    if (
      pathname.isSymbolicLink() ||
      !pathname.isFile() ||
      pathname.nlink !== 1n ||
      pathname.size < 0n ||
      pathname.size > BigInt(maxBytes)
    ) {
      return null
    }
    fd = fsSync.openSync(
      targetPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    )
    const pinned = fsSync.fstatSync(fd, { bigint: true })
    if (
      !pinned.isFile() ||
      pinned.nlink !== 1n ||
      pinned.dev !== pathname.dev ||
      pinned.ino !== pathname.ino ||
      pinned.size !== pathname.size
    ) {
      return null
    }
    const bytes = Buffer.alloc(Number(pinned.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = fsSync.readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) return null
      offset += count
    }
    const after = fsSync.fstatSync(fd, { bigint: true })
    const current = fsSync.lstatSync(targetPath, { bigint: true })
    if (
      after.dev !== pinned.dev ||
      after.ino !== pinned.ino ||
      after.size !== pinned.size ||
      current.isSymbolicLink() ||
      current.dev !== pinned.dev ||
      current.ino !== pinned.ino ||
      current.size !== pinned.size ||
      current.nlink !== 1n
    ) {
      return null
    }
    return {
      bytes,
      identity: { dev: pinned.dev, ino: pinned.ino, mode: Number(pinned.mode) }
    }
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd)
      } catch {
        // Inspection is already failing closed.
      }
    }
  }
}

const inspectWebsiteDirectorySync = (targetPath: string): WebsiteDirectoryInspection | null => {
  try {
    const stat = fsSync.lstatSync(targetPath, { bigint: true })
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null
    const identity = { dev: stat.dev, ino: stat.ino, mode: Number(stat.mode) }
    const entries = fsSync.readdirSync(targetPath)
    if (entries.length === 0) {
      return { state: 'empty', identity, linkCount: stat.nlink, files: null }
    }
    if (
      entries.length !== BOOK_WEBSITE_FILES.length ||
      !BOOK_WEBSITE_FILES.every((name) => entries.includes(name))
    ) {
      return null
    }
    const manifestRead = readPinnedRegularFileSync(
      path.join(targetPath, BOOK_WEBSITE_MANIFEST),
      16 * 1024
    )
    const indexRead = readPinnedRegularFileSync(
      path.join(targetPath, BOOK_WEBSITE_INDEX),
      MAX_EXPORT_HTML_BYTES
    )
    if (!manifestRead || !indexRead) return null
    const manifest = parseBookWebsiteManifest(manifestRead.bytes)
    const file = manifest?.files[0]
    if (
      !file ||
      file.path !== BOOK_WEBSITE_INDEX ||
      file.size !== indexRead.bytes.byteLength ||
      file.sha256 !== sha256Bytes(indexRead.bytes) ||
      !validateBookExportHtml(indexRead.bytes.toString('utf8'))
    ) {
      return null
    }
    const after = fsSync.lstatSync(targetPath, { bigint: true })
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.nlink !== stat.nlink
    ) {
      return null
    }
    return {
      state: 'owned',
      identity,
      linkCount: stat.nlink,
      files: {
        index: indexRead.identity,
        manifest: manifestRead.identity,
        indexSha256: sha256Bytes(indexRead.bytes),
        manifestSha256: sha256Bytes(manifestRead.bytes)
      }
    }
  } catch (inspectionError) {
    if ((inspectionError as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'absent', identity: null, linkCount: null, files: null }
    }
    return null
  }
}

const sameWebsiteFiles = (
  left: WebsiteFileIdentities | null,
  right: WebsiteFileIdentities | null
): boolean =>
  left === null
    ? right === null
    : Boolean(
        right &&
        sameFileIdentity(left.index, right.index) &&
        sameFileIdentity(left.manifest, right.manifest) &&
        left.indexSha256 === right.indexSha256 &&
        left.manifestSha256 === right.manifestSha256
      )

const sameWebsiteInspection = (
  inspection: WebsiteDirectoryInspection | null,
  state: 'absent' | 'empty' | 'owned',
  identity: FileIdentity | null,
  linkCount: bigint | null,
  files: WebsiteFileIdentities | null
): boolean =>
  Boolean(
    inspection &&
    inspection.state === state &&
    (identity === null
      ? inspection.identity === null
      : inspection.identity !== null && sameFileIdentity(inspection.identity, identity)) &&
    inspection.linkCount === linkCount &&
    sameWebsiteFiles(inspection.files, files)
  )

const rootIdentitySync = (rootPath: string): RootIdentity | null => {
  try {
    const realPath = fsSync.realpathSync(rootPath)
    const stat = fsSync.statSync(realPath, { bigint: true })
    if (!stat.isDirectory()) return null
    return { realPath, dev: stat.dev, ino: stat.ino }
  } catch {
    return null
  }
}

const exportSourceRevisionSync = (
  root: RootIdentity,
  source: ExportSourceRevision,
  aggregateBytes: number
): { revision: string | null; aggregateBytes: number } | undefined => {
  let handle: number | null = null
  try {
    const candidate = path.resolve(root.realPath, source.path)
    const relative = path.relative(root.realPath, candidate)
    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      fsSync.realpathSync(candidate) !== candidate
    ) {
      return undefined
    }
    const pathnameBefore = fsSync.lstatSync(candidate, { bigint: true })
    if (
      pathnameBefore.isSymbolicLink() ||
      !pathnameBefore.isFile() ||
      pathnameBefore.size < 0n ||
      pathnameBefore.size > BigInt(MAX_EXPORT_SOURCE_BYTES)
    ) {
      return undefined
    }
    handle = fsSync.openSync(
      candidate,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    )
    const before = fsSync.fstatSync(handle, { bigint: true })
    if (
      !before.isFile() ||
      before.dev !== pathnameBefore.dev ||
      before.ino !== pathnameBefore.ino ||
      before.size < 0n ||
      before.size > BigInt(MAX_EXPORT_SOURCE_BYTES) ||
      (before.size !== BigInt(source.byteLength) && before.size !== BigInt(source.byteLength + 3))
    ) {
      return undefined
    }
    const byteLength = Number(before.size)
    const nextAggregate = aggregateBytes + byteLength
    if (
      !Number.isSafeInteger(byteLength) ||
      nextAggregate > MAX_EXPORT_SOURCE_BYTES ||
      nextAggregate < aggregateBytes
    ) {
      return undefined
    }
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(Math.min(EXPORT_HASH_CHUNK_BYTES, Math.max(1, byteLength)))
    let offset = 0
    let bomChecked = false
    while (offset < byteLength) {
      const requested = Math.min(chunk.length, byteLength - offset)
      const read = fsSync.readSync(handle, chunk, 0, requested, offset)
      if (read !== requested) return undefined
      const bomBytes =
        !bomChecked && read >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf
          ? 3
          : 0
      bomChecked = true
      hash.update(chunk.subarray(bomBytes, read))
      offset += read
    }
    if (fsSync.readSync(handle, chunk, 0, 1, byteLength) !== 0) return undefined
    const after = fsSync.fstatSync(handle, { bigint: true })
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mode !== before.mode ||
      after.nlink !== before.nlink ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      return undefined
    }
    return { revision: hash.digest('hex'), aggregateBytes: nextAggregate }
  } catch (sourceError) {
    return (sourceError as NodeJS.ErrnoException).code === 'ENOENT' &&
      source.revision === null &&
      source.byteLength === 0
      ? { revision: null, aggregateBytes }
      : undefined
  } finally {
    if (handle !== null) fsSync.closeSync(handle)
  }
}

const decodeBookEdit = (
  bytes: Buffer
): { markdown: string; revision: string; format: BookEditFormatDto } | null => {
  try {
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    const body = bom ? bytes.subarray(3) : bytes
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(body)
    const crlf = decoded.match(/\r\n/g)?.length ?? 0
    const bareLf = decoded.match(/(?<!\r)\n/g)?.length ?? 0
    if (/\r(?!\n)/.test(decoded)) return null
    const lineEnding = crlf >= bareLf ? 'crlf' : 'lf'
    return {
      markdown: decoded.replace(/\r\n/g, '\n'),
      revision: hashBytes(bytes),
      format: { bom, lineEnding, mixedLineEndings: crlf > 0 && bareLf > 0 }
    }
  } catch {
    return null
  }
}

const encodeBookEdit = (markdown: string, format: BookEditFormatDto): Buffer => {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const body = format.lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
  return Buffer.from(`${format.bom ? '\uFEFF' : ''}${body}`, 'utf8')
}

const safeMarkdownInput = (markdown: string): boolean =>
  markdown.length <= MAX_EDIT_BYTES &&
  !/\r(?!\n)/.test(markdown) &&
  Buffer.byteLength(markdown, 'utf8') <= MAX_EDIT_BYTES

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

const validTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value))

const validProgress = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const validStableKey = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_STABLE_KEY_LENGTH &&
  !value.includes('\0')

const normalizeChapterTitle = (value: string): string => {
  const normalized = value.normalize('NFC').trim()
  if (normalized.length <= MAX_CHAPTER_TITLE_LENGTH) return normalized || 'Untitled chapter'
  let truncated = normalized.slice(0, MAX_CHAPTER_TITLE_LENGTH)
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1)
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) truncated = truncated.slice(0, -1)
  return truncated || 'Untitled chapter'
}

const normalizeReadingState = (value: unknown): PersistedReadingState | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Partial<PersistedReadingState>
  if (
    !validStableKey(item.lastTargetKey) ||
    typeof item.lastChapterTitle !== 'string' ||
    !item.lastChapterTitle ||
    item.lastChapterTitle.length > 512 ||
    !validProgress(item.overallProgress) ||
    !validTimestamp(item.updatedAt)
  ) {
    return undefined
  }
  const positions: PersistedChapterPosition[] = []
  const seen = new Set<string>()
  if (Array.isArray(item.positions)) {
    for (const candidate of item.positions.slice(0, MAX_READING_POSITIONS * 2)) {
      if (!candidate || typeof candidate !== 'object') continue
      const position = candidate as Partial<PersistedChapterPosition>
      if (
        !validStableKey(position.targetKey) ||
        !validProgress(position.ratio) ||
        !validTimestamp(position.updatedAt) ||
        seen.has(position.targetKey)
      ) {
        continue
      }
      seen.add(position.targetKey)
      positions.push({
        targetKey: position.targetKey,
        ratio: position.ratio,
        updatedAt: position.updatedAt
      })
      if (positions.length >= MAX_READING_POSITIONS) break
    }
  }
  return {
    lastTargetKey: item.lastTargetKey,
    lastChapterTitle: item.lastChapterTitle,
    overallProgress: item.overallProgress,
    updatedAt: item.updatedAt,
    positions
  }
}

const validPersistedLibrary = (value: unknown): value is PersistedLibrary => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PersistedLibrary>
  return (
    validOpaqueId(item.libraryId) &&
    typeof item.rootPath === 'string' &&
    path.isAbsolute(item.rootPath) &&
    item.rootPath.length <= 32_768 &&
    !item.rootPath.includes('\0') &&
    typeof item.title === 'string' &&
    item.title.length > 0 &&
    item.title.length <= 512 &&
    validTimestamp(item.lastOpenedAt)
  )
}

const decodedAbsolutePath = (value: string): boolean =>
  value.startsWith('/') ||
  value.startsWith('\\') ||
  /^[a-zA-Z]:/.test(value) ||
  path.posix.isAbsolute(value) ||
  path.win32.isAbsolute(value)

const localHrefTarget = (
  currentPath: string,
  href: string
): ReturnType<typeof resolveBookTarget> => {
  const unsafe = (): ReturnType<typeof resolveBookTarget> => ({
    kind: 'invalid',
    reason: 'unsafe-path',
    message: 'The link path is unsafe.'
  })
  const validateCombined = (
    combined: string,
    fragment: string | null
  ): ReturnType<typeof resolveBookTarget> => {
    const encodedPath = combined.split('/').map(encodeURIComponent).join('/')
    return resolveBookTarget(
      `${encodedPath}${fragment === null ? '' : `#${encodeURIComponent(fragment)}`}`
    )
  }
  const direct = resolveBookTarget(href)
  if (direct.kind === 'external') return direct
  if (href.startsWith('#')) {
    try {
      return validateCombined(currentPath, decodeURIComponent(href.slice(1)))
    } catch {
      return unsafe()
    }
  }
  const [rawPath] = href.split('#', 1)
  let decodedPath: string
  try {
    // resolveBookTarget trims the complete target before decoding it. Apply
    // the same whitespace semantics after decoding so absolute-path checks
    // and the document-relative fallback operate on one canonical value.
    decodedPath = decodeURIComponent(rawPath || '').trim()
    if (decodedAbsolutePath(decodedPath)) return unsafe()
  } catch {
    return unsafe()
  }
  if (direct.kind === 'invalid') {
    // A document-relative `../` is permitted only after resolving it against
    // the current model-owned chapter and proving the result stays in-root.
    if (!href.includes('..')) return direct
    const [, rawFragment = ''] = href.split('#', 2)
    let decodedFragment: string | null = null
    try {
      decodedFragment = rawFragment ? decodeURIComponent(rawFragment) : null
    } catch {
      return unsafe()
    }
    const combined = path.posix.normalize(
      path.posix.join(path.posix.dirname(currentPath), decodedPath)
    )
    if (
      !combined ||
      combined === '..' ||
      combined.startsWith('../') ||
      path.posix.isAbsolute(combined)
    ) {
      return unsafe()
    }
    return validateCombined(combined, decodedFragment)
  }
  const combined = path.posix.normalize(
    path.posix.join(path.posix.dirname(currentPath), direct.path)
  )
  if (
    !combined ||
    combined === '..' ||
    combined.startsWith('../') ||
    path.posix.isAbsolute(combined)
  ) {
    return unsafe()
  }
  return validateCombined(combined, direct.fragment)
}

export class BookSessionManager {
  private readonly store: Store<BookshelfSchema>
  private readonly sessions = new Map<string, BookSession>()
  private shelfMutation = Promise.resolve()
  private readonly refreshes = new Map<string, Promise<BookReaderResult<BookSessionDto>>>()
  private readonly ownerGenerations = new Map<number, number>()
  private readonly searchIndexes = new Map<BookSession, SearchIndex>()
  private readonly searchBuilds = new Map<BookSession, SearchBuild>()
  private readonly activeSearches = new Map<number, ActiveSearch>()
  private readonly editLeases = new Map<string, BookEditLease>()
  private readonly arrangements = new BookArrangementManager()
  private readonly exportLeases = new Map<string, BookExportLease>()
  private readonly exportPreparations = new Set<number>()
  private searchCacheBytes = 0
  private searchBuildReservationBytes = 0

  constructor(
    userDataPath: string,
    private readonly loadBook: typeof loadBookFromDirectory = loadBookFromDirectory,
    private readonly readBookChapter: typeof safelyReadBookChapter = safelyReadBookChapter,
    private readonly openExternal: (
      ownerId: number,
      target: string
    ) => Promise<boolean> = async () => false,
    private readonly testHooks: BookSessionManagerTestHooks = {}
  ) {
    this.store = new Store<BookshelfSchema>({
      name: 'bookshelf',
      cwd: userDataPath,
      defaults: { libraries: [] }
    })
    this.writeLibraries(this.readLibraries())
  }

  private readLibraries(): PersistedLibrary[] {
    const raw = this.store.get('libraries')
    if (!Array.isArray(raw)) return []
    const seenIds = new Set<string>()
    const seenRoots = new Set<string>()
    return raw
      .filter(validPersistedLibrary)
      .map((item) => {
        const reading = normalizeReadingState(item.reading)
        return {
          libraryId: item.libraryId,
          rootPath: item.rootPath,
          title: item.title,
          lastOpenedAt: item.lastOpenedAt,
          ...(reading ? { reading } : {})
        }
      })
      .filter((item) => {
        const rootKey =
          process.platform === 'win32' || process.platform === 'darwin'
            ? item.rootPath.toLocaleLowerCase('en')
            : item.rootPath
        if (seenIds.has(item.libraryId) || seenRoots.has(rootKey)) return false
        seenIds.add(item.libraryId)
        seenRoots.add(rootKey)
        return true
      })
      .slice(0, MAX_BOOKS)
  }

  private writeLibraries(libraries: PersistedLibrary[]): void {
    this.store.set('libraries', libraries.slice(0, MAX_BOOKS))
  }

  private async mutateShelf<T>(mutation: () => Promise<T> | T): Promise<T> {
    const previous = this.shelfMutation
    let release!: () => void
    this.shelfMutation = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await mutation()
    } finally {
      release()
    }
  }

  private async identifyRoot(rootPath: string): Promise<RootIdentity | null> {
    try {
      const realPath = await fs.realpath(rootPath)
      const stat = await fs.stat(realPath, { bigint: true })
      if (!stat.isDirectory()) return null
      return { realPath, dev: stat.dev, ino: stat.ino }
    } catch {
      return null
    }
  }

  private async validateSessionRoot(
    sessionId: string,
    session: BookSession,
    invalidate: boolean = true
  ): Promise<'valid' | 'invalid' | 'revoked'> {
    const current = await this.identifyRoot(session.rootPath)
    if (this.ownedSession(sessionId, session.ownerId) !== session) return 'revoked'
    const valid =
      current !== null &&
      current.realPath === session.rootIdentity.realPath &&
      current.dev === session.rootIdentity.dev &&
      current.ino === session.rootIdentity.ino
    if (!valid) {
      if (invalidate) {
        session.generation += 1
        this.revokeSessionSearch(session)
        this.revokeSessionEdits(sessionId)
        this.arrangements.revokeSession(sessionId)
        this.revokeSessionExports(sessionId)
        this.sessions.delete(sessionId)
      }
      return 'invalid'
    }
    return 'valid'
  }

  private ownedSession(sessionId: string, ownerId: number): BookSession | null {
    const session = this.sessions.get(sessionId)
    return session?.ownerId === ownerId ? session : null
  }

  private ownerGeneration(ownerId: number): number {
    return this.ownerGenerations.get(ownerId) ?? 0
  }

  private ownerIsCurrent(ownerId: number, generation: number): boolean {
    return this.ownerGeneration(ownerId) === generation
  }

  cleanupOwner(ownerId: number): void {
    this.ownerGenerations.set(ownerId, this.ownerGeneration(ownerId) + 1)
    for (const [sessionId, session] of this.sessions) {
      if (session.ownerId === ownerId) {
        session.generation += 1
        this.revokeSessionSearch(session)
        this.revokeSessionEdits(sessionId)
        this.sessions.delete(sessionId)
      }
    }
    for (const lease of this.editLeases.values()) {
      if (lease.ownerId === ownerId) this.revokeEditLease(lease)
    }
    this.arrangements.cleanupOwner(ownerId)
    for (const lease of this.exportLeases.values()) {
      if (lease.ownerId === ownerId) this.revokeExport(lease)
    }
  }

  async listLibraries(): Promise<BookshelfEntryDto[]> {
    return Promise.all(
      this.readLibraries().map(async (library) => {
        let available = false
        try {
          available = (await fs.stat(library.rootPath)).isDirectory()
        } catch {
          available = false
        }
        return {
          libraryId: library.libraryId,
          title: library.title,
          lastOpenedAt: library.lastOpenedAt,
          available,
          readingProgress: library.reading?.overallProgress ?? 0,
          ...(library.reading
            ? {
                lastChapterTitle: library.reading.lastChapterTitle,
                readingUpdatedAt: library.reading.updatedAt
              }
            : {}),
          ...(available
            ? {}
            : {
                error: structuredError(
                  'book-unavailable',
                  'This book folder is unavailable or unreadable.'
                )
              })
        }
      })
    )
  }

  async openPicker(event: IpcMainInvokeEvent): Promise<BookReaderResult<BookSessionDto>> {
    const ownerId = event.sender.id ?? 0
    const ownerGeneration = this.ownerGeneration(ownerId)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'Open Markdown Book',
      properties: ['openDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
      return error('session-not-found', 'The requesting window is no longer available.')
    }
    if (result.canceled || result.filePaths.length !== 1) {
      return error('cancelled', 'No book folder was selected.')
    }
    const selectedRoot = result.filePaths[0]
    return selectedRoot
      ? this.openRoot(selectedRoot, undefined, ownerId, ownerGeneration)
      : error('cancelled', 'No book folder was selected.')
  }

  async openLibrary(
    libraryId: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookSessionDto>> {
    if (!validOpaqueId(libraryId)) return error('invalid-request', 'Invalid library identifier.')
    const library = this.readLibraries().find((item) => item.libraryId === libraryId)
    if (!library) return error('library-not-found', 'The bookshelf entry no longer exists.')
    return this.openRoot(
      library.rootPath,
      library.libraryId,
      ownerId,
      this.ownerGeneration(ownerId)
    )
  }

  private async openRoot(
    selectedRoot: string,
    existingLibraryId: string | undefined,
    ownerId: number,
    ownerGeneration: number
  ): Promise<BookReaderResult<BookSessionDto>> {
    const rootIdentity = await this.identifyRoot(selectedRoot)
    if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
      return error('session-not-found', 'The requesting window is no longer available.')
    }
    if (!rootIdentity) {
      return error('book-unavailable', 'This book folder is unavailable or unreadable.')
    }
    const rootPath = rootIdentity.realPath
    const result = await this.loadBook(rootPath)
    if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
      return error('session-not-found', 'The requesting window is no longer available.')
    }
    if (result.diagnostics.some((item) => item.code === 'scan-root-error')) {
      return error('book-unavailable', 'LeafBook could not safely scan this book folder.')
    }

    const currentIdentity = await this.identifyRoot(rootPath)
    if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
      return error('session-not-found', 'The requesting window is no longer available.')
    }
    if (
      !currentIdentity ||
      currentIdentity.realPath !== rootIdentity.realPath ||
      currentIdentity.dev !== rootIdentity.dev ||
      currentIdentity.ino !== rootIdentity.ino
    ) {
      return error('book-unavailable', 'The selected book folder changed while it was opening.')
    }
    const opened = await this.mutateShelf(async () => {
      if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
        return error<BookSessionDto>(
          'session-not-found',
          'The requesting window is no longer available.'
        )
      }
      const libraries = this.readLibraries()
      const sameRoot = (candidate: string): boolean =>
        process.platform === 'win32' || process.platform === 'darwin'
          ? candidate.toLocaleLowerCase('en') === rootPath.toLocaleLowerCase('en')
          : candidate === rootPath
      const prior = libraries.find(
        (item) => item.libraryId === existingLibraryId || sameRoot(item.rootPath)
      )
      const libraryId = prior?.libraryId ?? randomUUID()
      const persisted: PersistedLibrary = {
        libraryId,
        rootPath,
        title: result.book.metadata.title,
        lastOpenedAt: new Date().toISOString(),
        ...(prior?.reading ? { reading: prior.reading } : {})
      }
      this.writeLibraries([persisted, ...libraries.filter((item) => item.libraryId !== libraryId)])
      return {
        ok: true,
        value: this.registerSession(this.createSession(libraryId, rootIdentity, ownerId, result))
      } satisfies BookReaderResult<BookSessionDto>
    })
    if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
      return error('session-not-found', 'The requesting window is no longer available.')
    }
    return opened
  }

  private createSession(
    libraryId: string,
    rootIdentity: RootIdentity,
    ownerId: number,
    result: Awaited<ReturnType<typeof loadBookFromDirectory>>,
    previous?: BookSession,
    existingSessionId?: string
  ): BookSession {
    const sessionId = existingSessionId ?? randomUUID()
    const targets = new Map<string, SessionTarget>()
    const chapterNodeByPath = new Map<string, string>()
    const opaqueNodeIds = new Map<string, string>()
    const allocateNodeId = (stableId: string): string => {
      const nodeId = previous?.opaqueNodeIds.get(stableId) ?? randomUUID()
      opaqueNodeIds.set(stableId, nodeId)
      return nodeId
    }

    const addLanding = (
      landingPath: string | null,
      title: string,
      stableId: string
    ): string | undefined => {
      if (!landingPath) return undefined
      const target: SessionTarget = {
        kind: 'chapter',
        path: landingPath,
        fragment: null,
        title,
        stableKey: stableId
      }
      const nodeId = allocateNodeId(stableId)
      targets.set(nodeId, target)
      if (!chapterNodeByPath.has(landingPath)) chapterNodeByPath.set(landingPath, nodeId)
      return nodeId
    }
    const breadcrumbsByNodeId = new Map<string, string[]>()
    const mapNode = (node: BookNavigationNode, parents: string[] = []): BookReaderNodeDto => {
      const breadcrumbs = [...parents, node.title]
      const children = node.children.map((child) => mapNode(child, breadcrumbs))
      const stableKey = `navigation:${node.id}`
      const target: SessionTarget | null =
        node.type === 'chapter'
          ? {
              kind: 'chapter',
              path: node.path,
              fragment: node.fragment,
              title: node.title,
              stableKey
            }
          : node.type === 'external'
            ? { kind: 'external', url: node.url, title: node.title, stableKey }
            : null
      const nodeId = allocateNodeId(stableKey)
      breadcrumbsByNodeId.set(nodeId, breadcrumbs)
      if (node.type === 'chapter') {
        targets.set(nodeId, target as Extract<SessionTarget, { kind: 'chapter' }>)
        if (!chapterNodeByPath.has(node.path)) chapterNodeByPath.set(node.path, nodeId)
      } else if (node.type === 'external') {
        targets.set(nodeId, target as Extract<SessionTarget, { kind: 'external' }>)
      }
      const groupLandingNodeId =
        node.type === 'group'
          ? addLanding(node.landingPath, node.title, `group-landing:${node.id}`)
          : undefined
      if (groupLandingNodeId) breadcrumbsByNodeId.set(groupLandingNodeId, breadcrumbs)
      return {
        nodeId,
        type: node.type,
        title: node.title,
        children,
        ...(groupLandingNodeId ? { landingNodeId: groupLandingNodeId } : {})
      }
    }
    const nodes = result.book.navigation.nodes.map((node) => mapNode(node))
    const landingAlreadyInContents = result.book.navigation.landingPath
      ? chapterNodeByPath.has(result.book.navigation.landingPath)
      : false
    const landingNodeId = addLanding(
      result.book.navigation.landingPath,
      result.book.metadata.title,
      'book-landing'
    )
    const entryNodeId = result.book.navigation.entryPath
      ? (chapterNodeByPath.get(result.book.navigation.entryPath) ?? null)
      : (landingNodeId ?? null)
    const readableNodeIds: string[] = []
    const appendReadable = (node: BookReaderNodeDto): void => {
      if (node.type === 'chapter') readableNodeIds.push(node.nodeId)
      if (node.type === 'group' && node.landingNodeId) readableNodeIds.push(node.landingNodeId)
      node.children.forEach(appendReadable)
    }
    nodes.forEach(appendReadable)
    if (landingNodeId && !landingAlreadyInContents) readableNodeIds.unshift(landingNodeId)
    if (landingNodeId && !breadcrumbsByNodeId.has(landingNodeId)) {
      breadcrumbsByNodeId.set(landingNodeId, [result.book.metadata.title])
    }
    const sourcesByPath = new Map<string, SearchSource>()
    const aliasesByPath = new Map<string, Set<string>>()
    readableNodeIds.forEach((nodeId) => {
      const target = targets.get(nodeId)
      if (!target || target.kind !== 'chapter') return
      const existing = sourcesByPath.get(target.path)
      if (existing) {
        const aliases = aliasesByPath.get(target.path)
        if (target.title !== existing.title && aliases && !aliases.has(target.title)) {
          if (existing.aliases.length >= 128) existing.aliasesTruncated = true
          else {
            aliases.add(target.title)
            existing.aliases.push(target.title)
          }
        }
        return
      }
      sourcesByPath.set(target.path, {
        nodeId,
        path: target.path,
        title: target.title,
        breadcrumbs: breadcrumbsByNodeId.get(nodeId) ?? [target.title],
        aliases: [],
        aliasesTruncated: false,
        filename: path.posix.basename(target.path),
        order: sourcesByPath.size
      })
      aliasesByPath.set(target.path, new Set([target.title]))
    })
    const searchSources = [...sourcesByPath.values()]
    const reading = this.readLibraries().find((item) => item.libraryId === libraryId)?.reading
    const savedNodeId = reading ? opaqueNodeIds.get(reading.lastTargetKey) : undefined
    const savedIndex = savedNodeId ? readableNodeIds.indexOf(savedNodeId) : -1
    const savedPosition =
      reading?.positions.find((item) => item.targetKey === reading.lastTargetKey)?.ratio ?? 0
    const resumeNodeId = savedIndex >= 0 && savedNodeId ? savedNodeId : entryNodeId
    const readingProgress =
      savedIndex >= 0 && readableNodeIds.length
        ? Math.min(1, Math.max(0, (savedIndex + savedPosition) / readableNodeIds.length))
        : 0
    const dto: BookSessionDto = {
      libraryId,
      sessionId,
      title: result.book.metadata.title,
      navigationSource: result.book.navigation.source,
      nodes,
      entryNodeId,
      landingNodeId: landingAlreadyInContents ? null : (landingNodeId ?? null),
      resumeNodeId,
      readingProgress,
      diagnostics: result.diagnostics
    }
    return {
      libraryId,
      rootPath: rootIdentity.realPath,
      rootIdentity,
      ownerId,
      generation: previous?.generation ?? 1,
      dto,
      targets,
      chapterNodeByPath,
      opaqueNodeIds,
      readableNodeIds,
      searchSources,
      summaryPath:
        result.book.navigation.summaryPath === 'SUMMARY.md' ||
        result.book.navigation.summaryPath === 'SUMMARY.markdown'
          ? result.book.navigation.summaryPath
          : null
    }
  }

  private registerSession(session: BookSession): BookSessionDto {
    this.sessions.set(session.dto.sessionId, session)
    const ownerId = session.ownerId
    const owned = [...this.sessions].filter(([, session]) => session.ownerId === ownerId)
    while (owned.length > MAX_SESSIONS) {
      const oldest = owned.shift()
      if (!oldest) break
      oldest[1].generation += 1
      this.revokeSessionSearch(oldest[1])
      this.revokeSessionEdits(oldest[0])
      this.arrangements.revokeSession(oldest[0])
      this.revokeSessionExports(oldest[0])
      this.sessions.delete(oldest[0])
    }
    return session.dto
  }

  async refresh(
    sessionId: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookSessionDto>> {
    if (!validOpaqueId(sessionId)) return error('invalid-request', 'Invalid session identifier.')
    const initial = this.ownedSession(sessionId, ownerId)
    if (!initial) {
      return error('session-not-found', 'This book session has expired.')
    }
    const ownerGeneration = this.ownerGeneration(ownerId)
    const inFlight = this.refreshes.get(sessionId)
    if (inFlight) {
      const result = await inFlight
      if (
        !this.ownerIsCurrent(ownerId, ownerGeneration) ||
        (!this.ownedSession(sessionId, ownerId) &&
          (result.ok || result.error.code !== 'book-unavailable'))
      ) {
        return error('session-not-found', 'This book session has expired.')
      }
      return result
    }
    // A public refresh is an explicit revocation boundary. It must never share
    // the save-owned refresh capability below: starting it invalidates every
    // edit lease before any scan await can race a pending save.
    initial.generation += 1
    const sessionGeneration = initial.generation
    this.revokeSessionEdits(sessionId)
    this.arrangements.revokeSession(sessionId)
    this.revokeSessionExports(sessionId)
    const operation = this.refreshSession(sessionId, ownerId, initial, sessionGeneration)
    this.refreshes.set(sessionId, operation)
    try {
      const result = await operation
      if (
        !this.ownerIsCurrent(ownerId, ownerGeneration) ||
        (!this.ownedSession(sessionId, ownerId) &&
          (result.ok || result.error.code !== 'book-unavailable'))
      ) {
        return error('session-not-found', 'This book session has expired.')
      }
      return result
    } finally {
      if (this.refreshes.get(sessionId) === operation) this.refreshes.delete(sessionId)
    }
  }

  private async refreshSession(
    sessionId: string,
    ownerId: number,
    session: BookSession,
    sessionGeneration: number
  ): Promise<BookReaderResult<BookSessionDto>> {
    if (
      this.ownedSession(sessionId, ownerId) !== session ||
      session.generation !== sessionGeneration
    ) {
      return error('session-not-found', 'This book session has expired.')
    }
    const initialRoot = await this.validateSessionRoot(sessionId, session)
    if (initialRoot === 'revoked') {
      return error('session-not-found', 'This book session has expired.')
    }
    if (initialRoot === 'invalid') {
      return error('book-unavailable', 'This book folder changed and the session was invalidated.')
    }
    this.revokeSessionSearch(session)
    const result = await this.loadBook(session.rootPath)
    if (
      this.ownedSession(sessionId, ownerId) !== session ||
      session.generation !== sessionGeneration
    ) {
      return error('session-not-found', 'This book session has expired.')
    }
    const refreshedRoot = await this.validateSessionRoot(sessionId, session)
    if (refreshedRoot === 'revoked') {
      return error('session-not-found', 'This book session has expired.')
    }
    if (refreshedRoot === 'invalid') {
      return error('book-unavailable', 'This book folder changed and the session was invalidated.')
    }
    if (result.diagnostics.some((item) => item.code === 'scan-root-error')) {
      return error('book-unavailable', 'LeafBook could not safely refresh this book.')
    }
    if (
      this.ownedSession(sessionId, ownerId) !== session ||
      session.generation !== sessionGeneration
    ) {
      return error('session-not-found', 'This book session has expired.')
    }
    const replacement = this.createSession(
      session.libraryId,
      session.rootIdentity,
      ownerId,
      result,
      session,
      sessionId
    )
    replacement.generation = sessionGeneration
    this.revokeSessionSearch(session)
    this.sessions.set(sessionId, replacement)
    return {
      ok: true,
      value: replacement.dto
    }
  }

  closeSession(sessionId: unknown, ownerId: number = 0): BookReaderResult<true> {
    if (!validOpaqueId(sessionId)) return error('invalid-request', 'Invalid session identifier.')
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) {
      return error('session-not-found', 'This book session has expired.')
    }
    session.generation += 1
    this.revokeSessionSearch(session)
    this.revokeSessionEdits(sessionId)
    this.arrangements.revokeSession(sessionId)
    this.revokeSessionExports(sessionId)
    this.sessions.delete(sessionId)
    return { ok: true, value: true }
  }

  private revokeSessionSearch(session: BookSession): void {
    const build = this.searchBuilds.get(session)
    if (build) {
      build.controller.abort()
      this.searchBuilds.delete(session)
    }
    const cached = this.searchIndexes.get(session)
    if (cached) {
      this.searchCacheBytes = Math.max(0, this.searchCacheBytes - cached.estimatedBytes)
      this.searchIndexes.delete(session)
    }
    for (const [key, active] of this.activeSearches) {
      if (active.session === session) {
        active.controller.abort()
        this.activeSearches.delete(key)
      }
    }
  }

  private evictSearchCacheFor(requiredBytes: number): void {
    while (
      this.searchCacheBytes + this.searchBuildReservationBytes + requiredBytes >
      MAX_SEARCH_CACHE_BYTES
    ) {
      const oldest = this.searchIndexes.entries().next().value as
        | [BookSession, SearchIndex]
        | undefined
      if (!oldest) break
      this.searchIndexes.delete(oldest[0])
      this.searchCacheBytes -= oldest[1].estimatedBytes
    }
  }

  private cacheSearchIndex(session: BookSession, index: SearchIndex): void {
    if (![...this.sessions.values()].includes(session)) return
    const previous = this.searchIndexes.get(session)
    if (previous) this.searchCacheBytes -= previous.estimatedBytes
    this.searchIndexes.delete(session)
    this.evictSearchCacheFor(index.estimatedBytes)
    this.searchIndexes.set(session, index)
    this.searchCacheBytes += index.estimatedBytes
  }

  private touchSearchIndex(session: BookSession): SearchIndex | null {
    const cached = this.searchIndexes.get(session)
    if (!cached) return null
    this.searchIndexes.delete(session)
    this.searchIndexes.set(session, cached)
    return cached
  }

  private assertSearchCurrent(
    session: BookSession,
    controller: AbortController,
    ownerGeneration: number,
    kind: 'build' | 'query'
  ): void {
    const exactOperation =
      kind === 'build'
        ? this.searchBuilds.get(session)?.controller === controller
        : this.activeSearches.get(session.ownerId)?.controller === controller
    if (
      controller.signal.aborted ||
      this.sessions.get(session.dto.sessionId) !== session ||
      !this.ownerIsCurrent(session.ownerId, ownerGeneration) ||
      !exactOperation
    ) {
      throw new DOMException('Search cancelled', 'AbortError')
    }
  }

  private async verifySearchRoot(
    session: BookSession,
    controller: AbortController,
    ownerGeneration: number,
    kind: 'build' | 'query'
  ): Promise<void> {
    this.assertSearchCurrent(session, controller, ownerGeneration, kind)
    const root = await this.identifyRoot(session.rootPath)
    this.assertSearchCurrent(session, controller, ownerGeneration, kind)
    if (
      !root ||
      root.realPath !== session.rootIdentity.realPath ||
      root.dev !== session.rootIdentity.dev ||
      root.ino !== session.rootIdentity.ino
    ) {
      throw new Error('The authorized book root changed during search.')
    }
  }

  private async searchCheckpoint(
    session: BookSession,
    controller: AbortController,
    ownerGeneration: number,
    kind: 'build' | 'query',
    state: { checkpointCount: number }
  ): Promise<void> {
    await yieldToEventLoop()
    this.assertSearchCurrent(session, controller, ownerGeneration, kind)
    state.checkpointCount += 1
    if (state.checkpointCount % SEARCH_ROOT_CHECKPOINT_INTERVAL === 0) {
      await this.verifySearchRoot(session, controller, ownerGeneration, kind)
    }
  }

  private reportBuildProgress(build: SearchBuild, completed: number, total: number): void {
    for (const [searchId, progress] of build.waiters) {
      try {
        progress({ searchId, phase: 'indexing', completed, total })
      } catch {
        // A renderer callback is advisory. Disable a broken waiter callback
        // without rejecting the index build shared by other searches.
        build.waiters.delete(searchId)
      }
    }
  }

  private async buildSearchIndex(session: BookSession, build: SearchBuild): Promise<SearchIndex> {
    const documents: BookSearchDocument[] = []
    let estimatedBytes = 0
    let omittedDocuments = 0
    let partial = false
    let yieldedBytes = 0
    for (let index = 0; index < session.searchSources.length; index += 1) {
      if (build.controller.signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
      const source = session.searchSources[index]
      if (!source) continue
      const chapter = await this.readBookChapter(session.rootPath, source.path)
      if (build.controller.signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
      if (!chapter) {
        omittedDocuments += 1
      } else {
        const remainingBytes = MAX_SEARCH_INDEX_BYTES - estimatedBytes
        if (remainingBytes < 1_024) {
          omittedDocuments += session.searchSources.length - index
          partial = true
          break
        }
        const document = await createBookSearchDocumentAsync(
          { ...source, markdown: chapter.content },
          {
            maxBytes: remainingBytes,
            signal: build.controller.signal,
            checkpoint: () =>
              this.searchCheckpoint(
                session,
                build.controller,
                build.ownerGeneration,
                'build',
                build
              )
          }
        )
        if (estimatedBytes + document.estimatedBytes > MAX_SEARCH_INDEX_BYTES) {
          omittedDocuments += session.searchSources.length - index
          partial = true
          this.reportBuildProgress(
            build,
            session.searchSources.length,
            session.searchSources.length
          )
          break
        }
        documents.push(document)
        estimatedBytes += document.estimatedBytes
        yieldedBytes += document.estimatedBytes
        partial = partial || document.partial
      }
      await this.verifySearchRoot(session, build.controller, build.ownerGeneration, 'build')
      if (
        index === 0 ||
        (index + 1) % SEARCH_YIELD_DOCUMENTS === 0 ||
        index + 1 === session.searchSources.length
      ) {
        this.reportBuildProgress(build, index + 1, session.searchSources.length)
      }
      if ((index + 1) % SEARCH_YIELD_DOCUMENTS === 0 || yieldedBytes >= SEARCH_YIELD_BYTES) {
        yieldedBytes = 0
        await yieldToEventLoop()
      }
    }
    return {
      documents,
      estimatedBytes,
      status: {
        eligibleDocuments: session.searchSources.length,
        indexedDocuments: documents.length,
        omittedDocuments,
        partial: partial || omittedDocuments > 0
      }
    }
  }

  private async acquireSearchIndex(
    session: BookSession,
    waiterId: string,
    signal: AbortSignal,
    onProgress: (progress: BookSearchProgressDto) => void
  ): Promise<SearchIndex> {
    const cached = this.touchSearchIndex(session)
    if (cached) return cached
    let build = this.searchBuilds.get(session)
    if (!build || build.controller.signal.aborted) {
      if (this.searchBuilds.size >= 1 || this.searchBuildReservationBytes > 0) {
        throw new SearchBusyError('Another book index is currently being built.')
      }
      this.evictSearchCacheFor(SEARCH_INDEX_RESERVATION_BYTES)
      if (
        this.searchCacheBytes + this.searchBuildReservationBytes + SEARCH_INDEX_RESERVATION_BYTES >
        MAX_SEARCH_CACHE_BYTES
      ) {
        throw new SearchBusyError('There is not enough bounded search memory available.')
      }
      this.searchBuildReservationBytes = SEARCH_INDEX_RESERVATION_BYTES
      const next: SearchBuild = {
        controller: new AbortController(),
        ownerGeneration: this.ownerGeneration(session.ownerId),
        checkpointCount: 0,
        waiters: new Map(),
        promise: Promise.resolve(null as never)
      }
      next.promise = this.buildSearchIndex(session, next)
        .then((index) => {
          this.searchBuildReservationBytes = 0
          if (!next.controller.signal.aborted) this.cacheSearchIndex(session, index)
          return index
        })
        .finally(() => {
          this.searchBuildReservationBytes = 0
          if (this.searchBuilds.get(session) === next) this.searchBuilds.delete(session)
        })
      // A cancelled last waiter is expected to reject this shared operation.
      next.promise.catch(() => undefined)
      this.searchBuilds.set(session, next)
      build = next
    }
    build.waiters.set(waiterId, onProgress)
    const detach = (): void => {
      build?.waiters.delete(waiterId)
      const pendingSearch = [...this.activeSearches.values()].some(
        (active) => active.session === session && !active.controller.signal.aborted
      )
      if (
        build &&
        !build.waiters.size &&
        !pendingSearch &&
        this.searchBuilds.get(session) === build
      ) {
        build.controller.abort()
      }
    }
    if (signal.aborted) {
      detach()
      throw new DOMException('Search cancelled', 'AbortError')
    }
    return new Promise<SearchIndex>((resolve, reject) => {
      const abort = (): void => {
        detach()
        reject(new DOMException('Search cancelled', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
      build?.promise.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', abort)
        detach()
      })
    })
  }

  async search(
    sessionId: unknown,
    request: unknown,
    ownerId: number = 0,
    onProgress: (progress: BookSearchProgressDto) => void = () => undefined
  ): Promise<BookReaderResult<BookSearchResponseDto>> {
    const candidate = request as Partial<BookSearchRequestDto> | null
    const parsed =
      candidate && typeof candidate.query === 'string'
        ? parseBookSearchQuery(candidate.query)
        : null
    const limit =
      candidate?.limit === undefined
        ? 50
        : typeof candidate.limit === 'number' &&
            Number.isInteger(candidate.limit) &&
            candidate.limit >= 1 &&
            candidate.limit <= 100
          ? candidate.limit
          : null
    if (
      !validOpaqueId(sessionId) ||
      !candidate ||
      !validOpaqueId(candidate.searchId) ||
      !parsed ||
      limit === null
    ) {
      return error('invalid-request', 'Invalid book search request.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const priorSearch = this.activeSearches.get(ownerId)
    if (!priorSearch && this.activeSearches.size >= MAX_ACTIVE_SEARCH_OWNERS) {
      return error('search-busy', 'LeafBook is already serving the maximum number of searches.')
    }
    const controller = new AbortController()
    const searchOwnerGeneration = this.ownerGeneration(ownerId)
    this.activeSearches.set(ownerId, {
      searchId: candidate.searchId,
      session,
      controller,
      ownerGeneration: searchOwnerGeneration
    })
    priorSearch?.controller.abort()
    try {
      const initialRoot = await this.validateSessionRoot(sessionId, session)
      if (initialRoot === 'revoked') {
        return error('session-not-found', 'This book session has expired.')
      }
      if (initialRoot === 'invalid') {
        return error(
          'book-unavailable',
          'This book folder changed and the session was invalidated.'
        )
      }
      const index = await this.acquireSearchIndex(
        session,
        candidate.searchId,
        controller.signal,
        onProgress
      )
      const matches = []
      const queryCheckpoint = { checkpointCount: 0 }
      for (let position = 0; position < index.documents.length; position += 1) {
        if (controller.signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
        const document = index.documents[position]
        if (document) {
          const match = await matchBookSearchDocumentAsync(document, parsed, {
            signal: controller.signal,
            checkpoint: () =>
              this.searchCheckpoint(
                session,
                controller,
                searchOwnerGeneration,
                'query',
                queryCheckpoint
              )
          })
          if (match) matches.push(match)
        }
        await this.verifySearchRoot(session, controller, searchOwnerGeneration, 'query')
        if (
          position === 0 ||
          (position + 1) % SEARCH_YIELD_DOCUMENTS === 0 ||
          position + 1 === index.documents.length
        ) {
          try {
            onProgress({
              searchId: candidate.searchId,
              phase: 'matching',
              completed: position + 1,
              total: index.documents.length
            })
          } catch {
            // Progress delivery is advisory and must not fail a completed search.
          }
        }
        if ((position + 1) % SEARCH_YIELD_DOCUMENTS === 0) await yieldToEventLoop()
      }
      matches.sort(
        (left, right) =>
          right.score - left.score ||
          left.order - right.order ||
          left.firstOffset - right.firstOffset ||
          left.result.nodeId.localeCompare(right.result.nodeId)
      )
      const finalRoot = await this.validateSessionRoot(sessionId, session)
      if (finalRoot === 'revoked') {
        return error('session-not-found', 'This book session has expired.')
      }
      if (finalRoot === 'invalid') {
        return error(
          'book-unavailable',
          'This book folder changed and the session was invalidated.'
        )
      }
      return {
        ok: true,
        value: {
          searchId: candidate.searchId,
          query: parsed.raw,
          results: matches.slice(0, limit).map((match) => match.result),
          totalResults: matches.length,
          truncated: matches.length > limit,
          index: index.status
        }
      }
    } catch (searchError) {
      if (
        controller.signal.aborted ||
        (searchError instanceof DOMException && searchError.name === 'AbortError')
      ) {
        return error('search-cancelled', 'The book search was cancelled.')
      }
      if (searchError instanceof SearchBusyError) {
        return error('search-busy', 'LeafBook is busy building another bounded book index.')
      }
      return error('search-unavailable', 'LeafBook could not build the book search index.')
    } finally {
      if (this.activeSearches.get(ownerId)?.controller === controller) {
        this.activeSearches.delete(ownerId)
      }
    }
  }

  cancelSearch(sessionId: unknown, searchId: unknown, ownerId: number = 0): BookReaderResult<true> {
    if (!validOpaqueId(sessionId) || !validOpaqueId(searchId)) {
      return error('invalid-request', 'Invalid book search cancellation request.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const active = this.activeSearches.get(ownerId)
    if (active?.session === session && active.searchId === searchId) active.controller.abort()
    return { ok: true, value: true }
  }

  searchDebugStateForTests(): {
    activeOwners: number
    builds: number
    waiters: number
    cacheBytes: number
    reservationBytes: number
  } {
    return {
      activeOwners: this.activeSearches.size,
      builds: this.searchBuilds.size,
      waiters: [...this.searchBuilds.values()].reduce(
        (total, build) => total + build.waiters.size,
        0
      ),
      cacheBytes: this.searchCacheBytes,
      reservationBytes: this.searchBuildReservationBytes
    }
  }

  async removeLibrary(libraryId: unknown): Promise<BookReaderResult<true>> {
    if (!validOpaqueId(libraryId)) return error('invalid-request', 'Invalid library identifier.')
    return this.mutateShelf(() => {
      const libraries = this.readLibraries()
      if (!libraries.some((item) => item.libraryId === libraryId)) {
        return error('library-not-found', 'The bookshelf entry no longer exists.')
      }
      this.writeLibraries(libraries.filter((item) => item.libraryId !== libraryId))
      for (const [sessionId, session] of this.sessions) {
        if (session.libraryId === libraryId) {
          session.generation += 1
          this.revokeSessionSearch(session)
          this.revokeSessionEdits(sessionId)
          this.arrangements.revokeSession(sessionId)
          this.revokeSessionExports(sessionId)
          this.sessions.delete(sessionId)
        }
      }
      return { ok: true, value: true }
    })
  }

  private editLease(editId: unknown, ownerId: number): BookEditLease | null {
    if (!validOpaqueId(editId)) return null
    const lease = this.editLeases.get(editId)
    return lease?.ownerId === ownerId ? lease : null
  }

  private leaseIsCurrent(
    lease: BookEditLease,
    generation = lease.generation,
    operationGeneration?: number
  ): boolean {
    return (
      this.editLeases.get(lease.editId) === lease &&
      lease.generation === generation &&
      lease.sessionGeneration === lease.session.generation &&
      this.sessions.get(lease.sessionId) === lease.session &&
      (operationGeneration === undefined || lease.operationGeneration === operationGeneration) &&
      !lease.controller.signal.aborted
    )
  }

  private revokeEditLease(lease: BookEditLease): void {
    if (lease.criticalCommit) {
      lease.revokeAfterCommit = true
      return
    }
    this.finalizeEditLeaseRevocation(lease)
  }

  private finalizeEditLeaseRevocation(lease: BookEditLease): void {
    lease.generation += 1
    lease.operationGeneration += 1
    lease.controller.abort()
    lease.overwriteGrant = null
    this.editLeases.delete(lease.editId)
  }

  private revokeSessionEdits(sessionId: string): void {
    for (const lease of this.editLeases.values()) {
      if (lease.sessionId === sessionId) this.revokeEditLease(lease)
    }
  }

  async beginArrangement(
    sessionId: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookArrangementDto>> {
    if (!validOpaqueId(sessionId)) {
      return error('invalid-request', 'Invalid book arrangement request.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    if (session.dto.navigationSource !== 'summary' || !session.summaryPath) {
      return error('arrangement-read-only', 'Only a book with an existing SUMMARY can be arranged.')
    }
    if ((await this.validateSessionRoot(sessionId, session, false)) !== 'valid') {
      return error('book-unavailable', 'This book folder changed and cannot be arranged.')
    }
    const generation = session.generation
    return this.arrangements.begin({
      ownerId,
      sessionId,
      sessionGeneration: generation,
      rootPath: session.rootPath,
      rootIdentity: session.rootIdentity,
      summaryPath: session.summaryPath,
      isCurrent: () =>
        this.ownedSession(sessionId, ownerId) === session && session.generation === generation
    })
  }

  applyArrangement(
    request: BookArrangementApplyRequestDto,
    ownerId: number = 0
  ): BookReaderResult<BookArrangementDto> {
    return this.arrangements.apply(request, ownerId)
  }

  undoArrangement(
    arrangementId: unknown,
    ownerId: number = 0
  ): BookReaderResult<BookArrangementDto> {
    return this.arrangements.undo(arrangementId, ownerId)
  }

  async saveArrangement(
    request: BookArrangementSaveRequestDto,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookArrangementSaveDto>> {
    const sessionId = this.arrangements.sessionIdFor(request.arrangementId, ownerId)
    if (!sessionId) {
      return error('arrangement-not-found', 'This arrangement draft has expired.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const generation = session.generation
    let held = false
    try {
      const saved = await this.arrangements.save(request, ownerId, true)
      if (!saved.ok) return saved
      held = true
      await this.testHooks.afterArrangementSave?.()
      if (this.ownedSession(sessionId, ownerId) !== session) return saved
      try {
        const result = await this.loadBook(session.rootPath)
        if (
          this.ownedSession(sessionId, ownerId) !== session ||
          session.generation !== generation ||
          result.diagnostics.some((item) => item.code === 'scan-root-error')
        ) {
          return saved
        }
        const rootStatus = await this.validateSessionRoot(sessionId, session, false)
        if (
          rootStatus !== 'valid' ||
          this.ownedSession(sessionId, ownerId) !== session ||
          session.generation !== generation
        ) {
          return saved
        }
        const replacement = this.createSession(
          session.libraryId,
          session.rootIdentity,
          ownerId,
          result,
          session,
          sessionId
        )
        replacement.generation = generation + 1
        session.generation = replacement.generation
        this.revokeSessionSearch(session)
        this.revokeSessionEdits(sessionId)
        this.arrangements.revokeSession(sessionId)
        this.revokeSessionExports(sessionId)
        this.sessions.set(sessionId, replacement)
        saved.value.session = replacement.dto
        return saved
      } catch {
        return saved
      }
    } finally {
      if (held) {
        this.arrangements.close(request.arrangementId, ownerId)
        this.arrangements.finishSave(request.arrangementId, ownerId)
      }
    }
  }

  closeArrangement(arrangementId: unknown, ownerId: number = 0): BookReaderResult<true> {
    return this.arrangements.close(arrangementId, ownerId)
  }

  private async pathAncestry(
    rootPath: string,
    parentPath: string
  ): Promise<PathComponentIdentity[] | null> {
    const relative = path.relative(rootPath, parentPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    const componentPaths = [rootPath]
    let current = rootPath
    for (const component of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, component)
      componentPaths.push(current)
    }
    const ancestry: PathComponentIdentity[] = []
    for (const componentPath of componentPaths) {
      const identity = await fileIdentity(componentPath, true)
      if (!identity) return null
      ancestry.push({ path: componentPath, ...identity })
    }
    return ancestry
  }

  private async validateLeasePath(
    lease: Pick<
      BookEditLease,
      | 'rootPath'
      | 'rootIdentity'
      | 'ancestry'
      | 'parentPath'
      | 'parentIdentity'
      | 'targetPath'
      | 'targetIdentity'
    >,
    requireWritable: boolean
  ): Promise<boolean> {
    const root = await this.identifyRoot(lease.rootPath)
    if (!root || !sameRootIdentity(root, lease.rootIdentity)) return false
    for (const expected of lease.ancestry) {
      const current = await fileIdentity(expected.path, true)
      if (!current || !sameFileIdentity(current, expected)) return false
    }
    const parent = await fileIdentity(lease.parentPath, true)
    const target = await fileIdentity(lease.targetPath)
    if (
      !parent ||
      !target ||
      !sameFileIdentity(parent, lease.parentIdentity) ||
      !sameFileIdentity(target, lease.targetIdentity)
    ) {
      return false
    }
    if (requireWritable) {
      if ((parent.mode & 0o222) === 0 || (target.mode & 0o222) === 0) return false
      try {
        await Promise.all([
          fs.access(lease.parentPath, fsConstants.W_OK),
          fs.access(lease.targetPath, fsConstants.W_OK)
        ])
      } catch {
        return false
      }
    }
    return true
  }

  private async readLeaseBytes(
    lease: Pick<BookEditLease, 'targetPath' | 'targetIdentity'>
  ): Promise<Buffer | null> {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      handle = await fs.open(lease.targetPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      const stat = await handle.stat({ bigint: true })
      if (
        !stat.isFile() ||
        stat.size > BigInt(MAX_EDIT_BYTES) ||
        stat.dev !== lease.targetIdentity.dev ||
        stat.ino !== lease.targetIdentity.ino
      ) {
        return null
      }
      const bytes = await handle.readFile()
      if (bytes.byteLength > MAX_EDIT_BYTES) return null
      const finalStat = await handle.stat({ bigint: true })
      if (
        finalStat.dev !== stat.dev ||
        finalStat.ino !== stat.ino ||
        finalStat.size !== stat.size
      ) {
        return null
      }
      return bytes
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async beginEdit(
    sessionId: unknown,
    nodeId: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookEditDto>> {
    if (!validOpaqueId(sessionId) || !validOpaqueId(nodeId)) {
      return error('invalid-request', 'Invalid book edit request.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    if ((await this.validateSessionRoot(sessionId, session, false)) !== 'valid') {
      return error('book-unavailable', 'This book folder changed and cannot be edited.')
    }
    if (this.ownedSession(sessionId, ownerId) !== session) {
      return error('session-not-found', 'This book session has expired.')
    }
    const target = session.targets.get(nodeId)
    if (!target || target.kind !== 'chapter') {
      return error('node-not-readable', 'Only a current local chapter can be edited.')
    }
    const targetPath = path.join(session.rootPath, ...target.path.split('/'))
    const parentPath = path.dirname(targetPath)
    const parentIdentity = await fileIdentity(parentPath, true)
    if (this.ownedSession(sessionId, ownerId) !== session) {
      return error('session-not-found', 'This book session has expired.')
    }
    const targetIdentity = await fileIdentity(targetPath)
    if (this.ownedSession(sessionId, ownerId) !== session) {
      return error('session-not-found', 'This book session has expired.')
    }
    const ancestry = await this.pathAncestry(session.rootIdentity.realPath, parentPath)
    if (!parentIdentity || !targetIdentity || !ancestry) {
      return error('edit-read-only', 'This chapter is no longer a stable regular file.')
    }
    const leaseSeed = {
      rootPath: session.rootPath,
      rootIdentity: session.rootIdentity,
      ancestry,
      parentPath,
      parentIdentity,
      targetPath,
      targetIdentity
    }
    if (!(await this.validateLeasePath(leaseSeed, true))) {
      return error('edit-read-only', 'This chapter or one of its parent folders is read-only.')
    }
    if (this.ownedSession(sessionId, ownerId) !== session) {
      return error('session-not-found', 'This book session has expired.')
    }
    const bytes = await this.readLeaseBytes(leaseSeed)
    if (!bytes) return error('edit-too-large', 'This chapter cannot be safely opened for editing.')
    const decoded = decodeBookEdit(bytes)
    if (!decoded) {
      return error('edit-encoding', 'Book editing supports strict UTF-8 Markdown only.')
    }
    await this.testHooks.afterEditRead?.('begin')
    const finallyValid = await this.validateLeasePath(leaseSeed, true)
    if (
      !finallyValid ||
      this.ownedSession(sessionId, ownerId) !== session ||
      session.targets.get(nodeId) !== target
    ) {
      return error('session-not-found', 'This book session has expired.')
    }
    const editId = randomUUID()
    const lease: BookEditLease = {
      editId,
      ownerId,
      sessionId,
      session,
      sessionGeneration: session.generation,
      libraryId: session.libraryId,
      nodeId,
      stableKey: target.stableKey,
      title: target.title,
      rootPath: session.rootPath,
      rootIdentity: session.rootIdentity,
      targetPath,
      parentPath,
      parentIdentity,
      ancestry,
      targetIdentity,
      revision: decoded.revision,
      format: decoded.format,
      generation: 1,
      controller: new AbortController(),
      operation: null,
      operationKey: null,
      operationGeneration: 0,
      overwriteGrant: null,
      criticalCommit: false,
      revokeAfterCommit: false
    }
    this.editLeases.set(editId, lease)
    return {
      ok: true,
      value: {
        editId,
        sessionId,
        nodeId,
        title: target.title,
        markdown: decoded.markdown,
        revision: decoded.revision,
        format: decoded.format
      }
    }
  }

  async reloadEdit(editId: unknown, ownerId: number = 0): Promise<BookReaderResult<BookEditDto>> {
    const lease = this.editLease(editId, ownerId)
    if (!lease) return error('edit-not-found', 'This book edit is no longer available.')
    if (lease.operation) {
      if (lease.operationKey === 'reload') {
        return lease.operation as Promise<BookReaderResult<BookEditDto>>
      }
      return error('edit-conflict', 'Another operation is already using this edit.')
    }
    const generation = lease.generation
    const operationGeneration = ++lease.operationGeneration
    const operation = this.reloadEditLease(lease, generation, operationGeneration)
    lease.operation = operation
    lease.operationKey = 'reload'
    try {
      return await operation
    } finally {
      if (
        this.leaseIsCurrent(lease, generation, operationGeneration) &&
        lease.operation === operation
      ) {
        lease.operation = null
        lease.operationKey = null
      }
    }
  }

  private async reloadEditLease(
    lease: BookEditLease,
    generation: number,
    operationGeneration: number
  ): Promise<BookReaderResult<BookEditDto>> {
    if (
      !(await this.validateLeasePath(lease, false)) ||
      !this.leaseIsCurrent(lease, generation, operationGeneration)
    ) {
      if (this.leaseIsCurrent(lease, generation, operationGeneration)) this.revokeEditLease(lease)
      return error('edit-read-only', 'The chapter or one of its parent folders changed.')
    }
    const identity = await fileIdentity(lease.targetPath)
    if (
      !this.leaseIsCurrent(lease, generation, operationGeneration) ||
      !identity ||
      !sameFileIdentity(identity, lease.targetIdentity)
    ) {
      if (this.leaseIsCurrent(lease, generation, operationGeneration)) this.revokeEditLease(lease)
      return error('edit-read-only', 'The chapter was replaced or removed.')
    }
    const bytes = await this.readLeaseBytes(lease)
    if (!this.leaseIsCurrent(lease, generation, operationGeneration)) {
      return error('edit-not-found', 'This book edit is no longer available.')
    }
    const decoded = bytes ? decodeBookEdit(bytes) : null
    if (!decoded) return error('edit-encoding', 'The chapter is not valid bounded UTF-8.')
    await this.testHooks.afterEditRead?.('reload')
    if (!this.leaseIsCurrent(lease, generation, operationGeneration)) {
      return error('edit-not-found', 'This book edit is no longer available.')
    }
    const finalPathValid = await this.validateLeasePath(lease, false)
    if (!finalPathValid || !this.leaseIsCurrent(lease, generation, operationGeneration)) {
      if (this.leaseIsCurrent(lease, generation, operationGeneration)) this.revokeEditLease(lease)
      return error('edit-read-only', 'The chapter changed while it was being reloaded.')
    }
    lease.revision = decoded.revision
    lease.format = decoded.format
    lease.overwriteGrant = null
    return {
      ok: true,
      value: {
        editId: lease.editId,
        sessionId: lease.sessionId,
        nodeId: lease.nodeId,
        title: lease.title,
        markdown: decoded.markdown,
        revision: decoded.revision,
        format: decoded.format
      }
    }
  }

  closeEdit(editId: unknown, ownerId: number = 0): BookReaderResult<true> {
    const lease = this.editLease(editId, ownerId)
    if (!lease) return error('edit-not-found', 'This book edit is no longer available.')
    this.revokeEditLease(lease)
    return { ok: true, value: true }
  }

  private async writeLeaseBytes(
    lease: BookEditLease,
    bytes: Buffer,
    expectedRevision: string,
    generation: number,
    operationGeneration: number
  ): Promise<{
    identity: FileIdentity
    durabilityUncertain: boolean
    verified: boolean
    committed: boolean
  } | null> {
    const initiallyValid = await this.validateLeasePath(lease, true)
    if (!initiallyValid || !this.leaseIsCurrent(lease, generation, operationGeneration)) {
      return null
    }
    const tempPath = path.join(lease.parentPath, `.leafbook-${randomUUID()}.tmp`)
    let temp: Awaited<ReturnType<typeof fs.open>> | null = null
    let committed = false
    try {
      temp = await fs.open(
        tempPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0) |
          (fsConstants.O_NONBLOCK ?? 0),
        lease.targetIdentity.mode & 0o777
      )
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null
      await temp.writeFile(bytes)
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null
      await temp.chmod(lease.targetIdentity.mode & 0o777)
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null
      await temp.sync()
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null
      const committedIdentity = await temp.stat({ bigint: true })
      if (
        !committedIdentity.isFile() ||
        !this.leaseIsCurrent(lease, generation, operationGeneration)
      ) {
        return null
      }
      await temp.close()
      temp = null
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null
      await this.testHooks.afterEditTempSync?.()
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null

      const pathStillValid = await this.validateLeasePath(lease, true)
      if (!pathStillValid || !this.leaseIsCurrent(lease, generation, operationGeneration)) {
        return null
      }
      const current = await this.readLeaseBytes(lease)
      if (
        !current ||
        hashBytes(current) !== expectedRevision ||
        !this.leaseIsCurrent(lease, generation, operationGeneration)
      ) {
        return null
      }
      await this.testHooks.beforeEditCommitCritical?.()
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) {
        return null
      }

      // Node does not expose renameat(2). Keep the final authority check and
      // rename in one synchronous event-loop turn so close/refresh/revoke cannot
      // interleave the validate→commit boundary. Component-wise lstat checks
      // reject local symlink/root/target swaps immediately before renameSync.
      if (!this.validateLeasePathSync(lease, expectedRevision, generation, operationGeneration)) {
        return null
      }
      lease.criticalCommit = true
      this.testHooks.editCommitCriticalStarted?.()
      fsSync.renameSync(tempPath, lease.targetPath)
      committed = true

      let durabilityUncertain = false
      try {
        const directory = fsSync.openSync(lease.parentPath, fsConstants.O_RDONLY)
        try {
          this.syncBookEditDirectorySync(directory)
        } finally {
          fsSync.closeSync(directory)
        }
      } catch {
        durabilityUncertain = true
      }
      const committedFileIdentity = {
        dev: committedIdentity.dev,
        ino: committedIdentity.ino,
        mode: Number(committedIdentity.mode)
      }
      const verified = this.verifyCommittedBookEditSync(
        lease.targetPath,
        committedFileIdentity,
        bytes
      )
      if (!verified) {
        durabilityUncertain = true
      }
      return {
        identity: committedFileIdentity,
        durabilityUncertain,
        verified,
        committed: true
      }
    } catch {
      if (committed) {
        return {
          identity: lease.targetIdentity,
          durabilityUncertain: true,
          verified: false,
          committed: true
        }
      }
      return null
    } finally {
      lease.criticalCommit = false
      if (lease.revokeAfterCommit) this.finalizeEditLeaseRevocation(lease)
      await temp?.close().catch(() => undefined)
      await fs.unlink(tempPath).catch(() => undefined)
    }
  }

  private validateLeasePathSync(
    lease: BookEditLease,
    expectedRevision: string,
    generation: number,
    operationGeneration: number
  ): boolean {
    try {
      if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return false
      const rootRealPath = fsSync.realpathSync(lease.rootPath)
      if (rootRealPath !== lease.rootIdentity.realPath) return false
      for (const expected of lease.ancestry) {
        const current = fsSync.lstatSync(expected.path, { bigint: true })
        if (
          current.isSymbolicLink() ||
          !current.isDirectory() ||
          current.dev !== expected.dev ||
          current.ino !== expected.ino ||
          Number(current.mode) !== expected.mode
        ) {
          return false
        }
      }
      const parent = fsSync.lstatSync(lease.parentPath, { bigint: true })
      const target = fsSync.lstatSync(lease.targetPath, { bigint: true })
      if (
        !parent.isDirectory() ||
        target.isSymbolicLink() ||
        !target.isFile() ||
        parent.dev !== lease.parentIdentity.dev ||
        parent.ino !== lease.parentIdentity.ino ||
        Number(parent.mode) !== lease.parentIdentity.mode ||
        target.dev !== lease.targetIdentity.dev ||
        target.ino !== lease.targetIdentity.ino ||
        Number(target.mode) !== lease.targetIdentity.mode
      ) {
        return false
      }
      fsSync.accessSync(lease.parentPath, fsConstants.W_OK)
      fsSync.accessSync(lease.targetPath, fsConstants.W_OK)
      const descriptor = fsSync.openSync(
        lease.targetPath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
      )
      try {
        const opened = fsSync.fstatSync(descriptor, { bigint: true })
        if (
          !opened.isFile() ||
          opened.size > BigInt(MAX_EDIT_BYTES) ||
          opened.dev !== lease.targetIdentity.dev ||
          opened.ino !== lease.targetIdentity.ino ||
          Number(opened.mode) !== lease.targetIdentity.mode
        ) {
          return false
        }
        return hashBytes(fsSync.readFileSync(descriptor)) === expectedRevision
      } finally {
        fsSync.closeSync(descriptor)
      }
    } catch {
      return false
    }
  }

  private syncBookEditDirectorySync(directory: number): void {
    fsSync.fsyncSync(directory)
  }

  private verifyCommittedBookEditSync(
    targetPath: string,
    targetIdentity: FileIdentity,
    expected: Buffer
  ): boolean {
    let descriptor: number | null = null
    try {
      descriptor = fsSync.openSync(targetPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      const stat = fsSync.fstatSync(descriptor, { bigint: true })
      if (
        !stat.isFile() ||
        stat.size > BigInt(MAX_EDIT_BYTES) ||
        stat.dev !== targetIdentity.dev ||
        stat.ino !== targetIdentity.ino
      ) {
        return false
      }
      return hashBytes(fsSync.readFileSync(descriptor)) === hashBytes(expected)
    } catch {
      return false
    } finally {
      if (descriptor !== null) fsSync.closeSync(descriptor)
    }
  }

  private async refreshAfterSave(
    lease: BookEditLease,
    generation: number,
    operationGeneration: number
  ): Promise<{ session: BookSessionDto; nodeId: string } | null> {
    const session = lease.session
    const sessionGeneration = lease.sessionGeneration
    if (!this.leaseIsCurrent(lease, generation, operationGeneration)) return null
    const result = await this.loadBook(session.rootPath)
    if (
      !this.leaseIsCurrent(lease, generation, operationGeneration) ||
      this.sessions.get(lease.sessionId) !== session ||
      session.generation !== sessionGeneration
    ) {
      return null
    }
    const rootStatus = await this.validateSessionRoot(lease.sessionId, session)
    if (
      rootStatus !== 'valid' ||
      !this.leaseIsCurrent(lease, generation, operationGeneration) ||
      result.diagnostics.some((item) => item.code === 'scan-root-error')
    ) {
      return null
    }
    const replacement = this.createSession(
      session.libraryId,
      session.rootIdentity,
      session.ownerId,
      result,
      session,
      lease.sessionId
    )
    replacement.generation = sessionGeneration + 1
    const reboundNodeId = replacement.opaqueNodeIds.get(lease.stableKey)
    if (
      !reboundNodeId ||
      !this.leaseIsCurrent(lease, generation, operationGeneration) ||
      this.sessions.get(lease.sessionId) !== session ||
      session.generation !== sessionGeneration
    ) {
      return null
    }

    // Consume only this save operation's private scan. Other leases are tied
    // to the replaced session object and are revoked; the saving lease is
    // rebound atomically with the replacement.
    session.generation = replacement.generation
    for (const candidate of [...this.editLeases.values()]) {
      if (candidate.sessionId === lease.sessionId && candidate !== lease) {
        this.revokeEditLease(candidate)
      }
    }
    this.revokeSessionSearch(session)
    this.arrangements.revokeSession(lease.sessionId)
    this.revokeSessionExports(lease.sessionId)
    this.sessions.set(lease.sessionId, replacement)
    lease.session = replacement
    lease.sessionGeneration = replacement.generation
    lease.nodeId = reboundNodeId
    lease.rootIdentity = replacement.rootIdentity
    return { session: replacement.dto, nodeId: reboundNodeId }
  }

  async saveEdit(
    request: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookEditSaveDto>> {
    const candidate = request as Partial<BookEditSaveRequestDto> | null
    if (
      !candidate ||
      !validOpaqueId(candidate.editId) ||
      typeof candidate.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(candidate.revision) ||
      typeof candidate.markdown !== 'string' ||
      !safeMarkdownInput(candidate.markdown) ||
      (candidate.overwriteToken !== undefined && !validOpaqueId(candidate.overwriteToken))
    ) {
      return error('invalid-request', 'Invalid book edit save request.')
    }
    const lease = this.editLease(candidate.editId, ownerId)
    if (!lease) return error('edit-not-found', 'This book edit is no longer available.')
    const operationKey = hashBytes(
      Buffer.from(
        JSON.stringify({
          revision: candidate.revision,
          markdown: candidate.markdown,
          overwriteToken: candidate.overwriteToken ?? null,
          confirmMixedLineEndings: candidate.confirmMixedLineEndings === true
        })
      )
    )
    if (lease.operation) {
      if (lease.operationKey === operationKey) {
        return lease.operation as Promise<BookReaderResult<BookEditSaveDto>>
      }
      return error('edit-conflict', 'Another operation is already using this edit.')
    }
    const generation = lease.generation
    const operationGeneration = ++lease.operationGeneration
    const operation = this.saveEditLease(
      candidate as BookEditSaveRequestDto,
      lease,
      generation,
      operationGeneration
    )
    lease.operation = operation
    lease.operationKey = operationKey
    try {
      return await operation
    } finally {
      if (
        this.leaseIsCurrent(lease, generation, operationGeneration) &&
        lease.operation === operation
      ) {
        lease.operation = null
        lease.operationKey = null
      }
    }
  }

  private async saveEditLease(
    candidate: BookEditSaveRequestDto,
    lease: BookEditLease,
    generation: number,
    operationGeneration: number
  ): Promise<BookReaderResult<BookEditSaveDto>> {
    if (candidate.revision !== lease.revision) {
      return error('edit-conflict', 'This edit revision is stale.')
    }
    if (lease.format.mixedLineEndings && candidate.confirmMixedLineEndings !== true) {
      return error(
        'edit-mixed-line-endings',
        'This file mixes line endings. Confirm normalization before saving.'
      )
    }
    const bytes = encodeBookEdit(candidate.markdown, lease.format)
    if (bytes.byteLength > MAX_EDIT_BYTES) {
      return error('edit-too-large', 'The edited chapter exceeds the safe editing limit.')
    }
    const current = await this.readLeaseBytes(lease)
    if (!this.leaseIsCurrent(lease, generation, operationGeneration)) {
      return error('edit-not-found', 'This book edit is no longer available.')
    }
    if (!current) {
      this.revokeEditLease(lease)
      return error('edit-read-only', 'The chapter was replaced, removed, or became unreadable.')
    }
    const currentRevision = hashBytes(current)
    const candidateRevision = hashBytes(bytes)
    let expectedRevision = lease.revision
    if (currentRevision !== lease.revision) {
      const grant = lease.overwriteGrant
      const validOverwrite =
        typeof candidate.overwriteToken === 'string' &&
        grant !== null &&
        candidate.overwriteToken === grant.token &&
        grant.ownerId === lease.ownerId &&
        grant.leaseGeneration === generation &&
        sameRootIdentity(grant.rootIdentity, lease.rootIdentity) &&
        sameFileIdentity(grant.targetIdentity, lease.targetIdentity) &&
        grant.baseRevision === lease.revision &&
        grant.externalRevision === currentRevision &&
        grant.candidateRevision === candidateRevision
      if (!validOverwrite) {
        const token = randomUUID()
        lease.overwriteGrant = {
          token,
          ownerId: lease.ownerId,
          leaseGeneration: generation,
          rootIdentity: { ...lease.rootIdentity },
          targetIdentity: { ...lease.targetIdentity },
          baseRevision: lease.revision,
          externalRevision: currentRevision,
          candidateRevision
        }
        return error(
          'edit-conflict',
          'The chapter changed outside LeafBook. Reload it or explicitly overwrite it.',
          token
        )
      }
      expectedRevision = currentRevision
      // Consume before the first write await. Concurrent replays cannot pass
      // because the lease itself is single-flight and the grant is now gone.
      lease.overwriteGrant = null
    }
    const write = await this.writeLeaseBytes(
      lease,
      bytes,
      expectedRevision,
      generation,
      operationGeneration
    )
    if (!write) {
      return error('edit-write-failed', 'The chapter changed while LeafBook was saving it.')
    }
    if (!write.verified) {
      this.revokeEditLease(lease)
      return error(
        'edit-commit-uncertain',
        'The new content may be visible, but LeafBook could not verify the committed chapter. Reopen the book before editing again.',
        undefined,
        true
      )
    }
    lease.targetIdentity = write.identity
    lease.revision = candidateRevision
    lease.format = { ...lease.format, mixedLineEndings: false }

    let refreshed: BookSessionDto | null = null
    let reboundNodeId: string | null = null
    if (this.leaseIsCurrent(lease, generation, operationGeneration)) {
      const refresh = await this.refreshAfterSave(lease, generation, operationGeneration)
      if (refresh) {
        refreshed = refresh.session
        reboundNodeId = refresh.nodeId
      }
    }
    const stillEditable = this.leaseIsCurrent(lease, generation, operationGeneration)
    return {
      ok: true,
      value: {
        editId: lease.editId,
        revision: lease.revision,
        markdown: candidate.markdown,
        format: lease.format,
        session: refreshed,
        nodeId: reboundNodeId,
        readOnly: !stillEditable || !refreshed || !reboundNodeId,
        durabilityUncertain: write.durabilityUncertain
      }
    }
  }

  async readChapter(
    sessionId: unknown,
    nodeId: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookChapterDto>> {
    if (!validOpaqueId(sessionId) || !validOpaqueId(nodeId)) {
      return error('invalid-request', 'Invalid book request.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const initialRoot = await this.validateSessionRoot(sessionId, session)
    if (initialRoot === 'revoked') {
      return error('session-not-found', 'This book session has expired.')
    }
    if (initialRoot === 'invalid') {
      return error('book-unavailable', 'This book folder changed and the session was invalidated.')
    }
    const target = session.targets.get(nodeId)
    if (!target) return error('node-not-found', 'This chapter is not part of the current book.')
    if (target.kind !== 'chapter') {
      return error('node-not-readable', 'This navigation item is not a local chapter.')
    }
    const result = await this.readBookChapter(session.rootPath, target.path)
    if (this.ownedSession(sessionId, ownerId) !== session) {
      return error('session-not-found', 'This book session has expired.')
    }
    const finalRoot = await this.validateSessionRoot(sessionId, session)
    if (finalRoot === 'revoked') {
      return error('session-not-found', 'This book session has expired.')
    }
    if (finalRoot === 'invalid') {
      return error('book-unavailable', 'This book folder changed and the session was invalidated.')
    }
    if (!result) return error('chapter-read-failed', 'LeafBook could not safely read this chapter.')
    const savedPosition = this.readLibraries()
      .find((item) => item.libraryId === session.libraryId)
      ?.reading?.positions.find((item) => item.targetKey === target.stableKey)
    return {
      ok: true,
      value: {
        nodeId,
        title: target.title,
        markdown: result.content,
        fragment: target.fragment,
        readingPosition: savedPosition?.ratio ?? 0,
        hasReadingPosition: Boolean(savedPosition)
      }
    }
  }

  async saveReadingPosition(
    sessionId: unknown,
    nodeId: unknown,
    chapterProgress: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookReadingProgressDto>> {
    if (!validOpaqueId(sessionId) || !validOpaqueId(nodeId) || !validProgress(chapterProgress)) {
      return error('invalid-request', 'Invalid reading position.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const target = session.targets.get(nodeId)
    if (!target) return error('node-not-found', 'This chapter is not part of the current book.')
    if (target.kind !== 'chapter') {
      return error('node-not-readable', 'This navigation item is not a local chapter.')
    }
    const orderIndex = session.readableNodeIds.indexOf(nodeId)
    if (orderIndex < 0 || !session.readableNodeIds.length) {
      return error('node-not-readable', 'This chapter is not in the readable book order.')
    }

    return this.mutateShelf(async () => {
      if (this.ownedSession(sessionId, ownerId) !== session) {
        return error('session-not-found', 'This book session has expired.')
      }
      const rootState = await this.validateSessionRoot(sessionId, session, false)
      if (rootState === 'revoked') {
        return error('session-not-found', 'This book session has expired.')
      }
      if (rootState === 'invalid') {
        return error('book-unavailable', 'This book folder changed and the position was not saved.')
      }
      if (this.ownedSession(sessionId, ownerId) !== session) {
        return error('session-not-found', 'This book session has expired.')
      }
      const libraries = this.readLibraries()
      const library = libraries.find((item) => item.libraryId === session.libraryId)
      if (!library) {
        return error('library-not-found', 'The bookshelf entry no longer exists.')
      }
      const updatedAt = new Date().toISOString()
      const overallProgress = Math.min(
        1,
        Math.max(0, (orderIndex + chapterProgress) / session.readableNodeIds.length)
      )
      const lastChapterTitle = normalizeChapterTitle(target.title)
      const previousPosition = library.reading?.positions.find(
        (item) => item.targetKey === target.stableKey
      )
      const previousReading = library.reading
      const unchanged =
        previousReading?.lastTargetKey === target.stableKey &&
        previousReading.lastChapterTitle === lastChapterTitle &&
        previousPosition !== undefined &&
        Math.abs(previousPosition.ratio - chapterProgress) < READING_PROGRESS_EPSILON &&
        Math.abs(previousReading.overallProgress - overallProgress) < READING_PROGRESS_EPSILON
      if (unchanged && previousReading) {
        session.dto.resumeNodeId = nodeId
        session.dto.readingProgress = previousReading.overallProgress
        return {
          ok: true,
          value: {
            chapterProgress: previousPosition.ratio,
            overallProgress: previousReading.overallProgress,
            updatedAt: previousReading.updatedAt
          }
        }
      }
      const positions = [
        { targetKey: target.stableKey, ratio: chapterProgress, updatedAt },
        ...(library.reading?.positions ?? []).filter((item) => item.targetKey !== target.stableKey)
      ].slice(0, MAX_READING_POSITIONS)
      const reading: PersistedReadingState = {
        lastTargetKey: target.stableKey,
        lastChapterTitle,
        overallProgress,
        updatedAt,
        positions
      }
      const updatedLibrary: PersistedLibrary = {
        ...library,
        lastOpenedAt: updatedAt,
        reading
      }
      this.writeLibraries([
        updatedLibrary,
        ...libraries.filter((item) => item.libraryId !== session.libraryId)
      ])
      if (this.ownedSession(sessionId, ownerId) !== session) {
        return error('session-not-found', 'This book session has expired.')
      }
      session.dto.resumeNodeId = nodeId
      session.dto.readingProgress = overallProgress
      return {
        ok: true,
        value: { chapterProgress, overallProgress, updatedAt }
      }
    })
  }

  private revokeExport(lease: BookExportLease): void {
    lease.generation += 1
    lease.controller.abort()
    if (lease.operation || lease.criticalCommit) {
      lease.revokeAfterCommit = true
      if (this.exportLeases.get(lease.exportId) === lease) {
        this.exportLeases.delete(lease.exportId)
      }
      return
    }
    if (this.exportLeases.get(lease.exportId) === lease) {
      this.exportLeases.delete(lease.exportId)
    }
    if (lease.parentFd !== null) {
      try {
        fsSync.closeSync(lease.parentFd)
      } catch {
        // A prior revocation may already have closed this pinned descriptor.
      }
      lease.parentFd = null
    }
  }

  private revokeSessionExports(sessionId: string): void {
    for (const lease of this.exportLeases.values()) {
      if (lease.session.dto.sessionId === sessionId) this.revokeExport(lease)
    }
  }

  private exportLease(exportId: unknown, ownerId: number): BookExportLease | null {
    if (!validOpaqueId(exportId)) return null
    const lease = this.exportLeases.get(exportId)
    return lease?.ownerId === ownerId ? lease : null
  }

  private exportLeaseCurrent(
    lease: BookExportLease,
    generation: number = lease.generation,
    operationGeneration: number = lease.operationGeneration
  ): boolean {
    return (
      !lease.controller.signal.aborted &&
      lease.generation === generation &&
      lease.operationGeneration === operationGeneration &&
      this.exportLeases.get(lease.exportId) === lease &&
      this.ownerIsCurrent(lease.ownerId, lease.ownerGeneration) &&
      this.ownedSession(lease.session.dto.sessionId, lease.ownerId) === lease.session &&
      lease.session.generation === lease.sessionGeneration
    )
  }

  private exportParentCurrentSync(lease: BookExportLease): boolean {
    if (lease.parentFd === null) return false
    try {
      const pinned = fsSync.fstatSync(lease.parentFd, { bigint: true })
      const pathname = fileIdentitySync(lease.parentPath, true)
      return (
        pinned.isDirectory() &&
        pinned.dev === lease.parentIdentity.dev &&
        pinned.ino === lease.parentIdentity.ino &&
        pathname !== null &&
        sameFileIdentity(pathname, lease.parentIdentity) &&
        fsSync.realpathSync(lease.parentPath) === lease.parentPath
      )
    } catch {
      return false
    }
  }

  private exportRootCurrentSync(lease: BookExportLease): boolean {
    const root = rootIdentitySync(lease.session.rootPath)
    return root !== null && sameRootIdentity(root, lease.rootIdentity)
  }

  private exportTargetCurrentSync(lease: BookExportLease): boolean {
    if (lease.kind === 'website') {
      const inspected = inspectWebsiteDirectorySync(lease.targetPath)
      return Boolean(
        lease.websiteTargetState &&
        sameWebsiteInspection(
          inspected,
          lease.websiteTargetState,
          lease.targetIdentity,
          lease.targetLinkCount,
          lease.websiteTargetFiles
        )
      )
    }
    const targetIdentity = fileIdentitySync(lease.targetPath)
    let targetStat: BigIntStats | null = null
    try {
      targetStat = fsSync.lstatSync(lease.targetPath, { bigint: true })
    } catch {
      targetStat = null
    }
    return lease.targetIdentity
      ? targetIdentity !== null &&
          sameFileIdentity(targetIdentity, lease.targetIdentity) &&
          targetStat !== null &&
          !targetStat.isSymbolicLink() &&
          targetStat.nlink === lease.targetLinkCount
      : targetIdentity === null && targetStat === null
  }

  private exportSourcesCurrentSync(lease: BookExportLease): boolean {
    let aggregateBytes = 0
    for (const source of lease.sources) {
      const verified = exportSourceRevisionSync(lease.rootIdentity, source, aggregateBytes)
      if (!verified || verified.revision !== source.revision) return false
      aggregateBytes = verified.aggregateBytes
    }
    return true
  }

  private safeExportHtml(html: string): boolean {
    return (
      typeof html === 'string' &&
      Buffer.byteLength(html, 'utf8') <= MAX_EXPORT_HTML_BYTES &&
      validateBookExportHtml(html)
    )
  }

  async beginExport(
    sessionId: unknown,
    event: IpcMainInvokeEvent,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookExportSnapshotDto>> {
    return this.beginExportMode('html', sessionId, event, ownerId)
  }

  async beginWebsite(
    sessionId: unknown,
    event: IpcMainInvokeEvent,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookWebsiteSnapshotDto>> {
    const result = await this.beginExportMode('website', sessionId, event, ownerId)
    if (!result.ok) return result
    const { exportId, ...snapshot } = result.value
    return { ok: true, value: { websiteId: exportId, ...snapshot } }
  }

  private async beginExportMode(
    kind: 'html' | 'website',
    sessionId: unknown,
    event: IpcMainInvokeEvent,
    ownerId: number
  ): Promise<BookReaderResult<BookExportSnapshotDto>> {
    if (this.exportPreparations.has(ownerId)) {
      return error(
        kind === 'website' ? 'website-busy' : 'export-busy',
        'An export is already being prepared for this window.'
      )
    }
    const activeOwners = new Set([
      ...this.exportPreparations,
      ...[...this.exportLeases.values()].map((lease) => lease.ownerId)
    ])
    if (!activeOwners.has(ownerId) && activeOwners.size >= MAX_ACTIVE_EXPORT_OWNERS) {
      return error(
        kind === 'website' ? 'website-busy' : 'export-busy',
        'LeafBook is already preparing the maximum number of exports.'
      )
    }
    for (const lease of this.exportLeases.values()) {
      if (lease.ownerId === ownerId) {
        return error(
          kind === 'website' ? 'website-busy' : 'export-busy',
          'Finish or cancel the active export before starting another.'
        )
      }
    }
    this.exportPreparations.add(ownerId)
    try {
      return await this.prepareExport(sessionId, event, ownerId, kind)
    } finally {
      this.exportPreparations.delete(ownerId)
    }
  }

  private async prepareExport(
    sessionId: unknown,
    event: IpcMainInvokeEvent,
    ownerId: number = 0,
    kind: 'html' | 'website' = 'html'
  ): Promise<BookReaderResult<BookExportSnapshotDto>> {
    if (!validOpaqueId(sessionId)) return error('invalid-request', 'Invalid export request.')
    const writeCode = kind === 'website' ? 'website-write-failed' : 'export-write-failed'
    const sourceCode = kind === 'website' ? 'website-source-changed' : 'export-source-changed'
    const tooLargeCode = kind === 'website' ? 'website-too-large' : 'export-too-large'
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const ownerGeneration = this.ownerGeneration(ownerId)
    const sessionGeneration = session.generation
    const window = BrowserWindow.fromWebContents(event.sender)
    const safeName =
      [...session.dto.title]
        .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
        .join('')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/[.\s]+$/g, '')
        .slice(0, 120) || 'LeafBook'
    const dialogOptions: SaveDialogOptions =
      kind === 'website'
        ? {
            title: 'Generate Local Website',
            defaultPath: 'LeafBook-site',
            properties: ['createDirectory']
          }
        : {
            title: 'Export Markdown Book',
            defaultPath: `${safeName}.html`,
            filters: [{ name: 'Self-contained HTML', extensions: ['html'] }],
            properties: ['showOverwriteConfirmation']
          }
    const save = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (!this.ownerIsCurrent(ownerId, ownerGeneration)) {
      return error('session-not-found', 'The requesting window is no longer available.')
    }
    if (save.canceled || !save.filePath) return error('cancelled', 'The export was cancelled.')
    const selectedTargetPath = path.resolve(save.filePath)
    if (
      kind === 'html' &&
      path.extname(selectedTargetPath).toLocaleLowerCase('en-US') !== '.html'
    ) {
      return error('invalid-request', 'The export target must use the .html extension.')
    }
    const parentPath = path.dirname(selectedTargetPath)
    let parentRealPath: string
    try {
      parentRealPath = await fs.realpath(parentPath)
    } catch {
      return error(writeCode, 'The export destination folder is unavailable.')
    }
    const targetPath = path.join(parentRealPath, path.basename(selectedTargetPath))
    const relativeToRoot = path.relative(session.rootIdentity.realPath, targetPath)
    if (
      relativeToRoot === '' ||
      (!relativeToRoot.startsWith(`..${path.sep}`) &&
        relativeToRoot !== '..' &&
        !path.isAbsolute(relativeToRoot))
    ) {
      return error('invalid-request', 'Choose an export destination outside the source book.')
    }
    const parentIdentity = await fileIdentity(parentRealPath, true)
    if (!parentIdentity) {
      return error(writeCode, 'The export destination folder is unsafe.')
    }
    let targetIdentity = kind === 'website' ? null : await fileIdentity(targetPath)
    let targetLinkCount: bigint | null = null
    let websiteTargetState: 'absent' | 'empty' | 'owned' | null = null
    let websiteTargetFiles: WebsiteFileIdentities | null = null
    if (kind === 'website') {
      const inspected = inspectWebsiteDirectorySync(targetPath)
      if (!inspected) {
        return error(
          'website-unsafe-target',
          'LeafBook only replaces an empty folder or an exact, valid LeafBook website.'
        )
      }
      websiteTargetState = inspected.state
      targetIdentity = inspected.identity
      targetLinkCount = inspected.linkCount
      websiteTargetFiles = inspected.files
      if (inspected.state !== 'absent') {
        const confirmation = window
          ? await dialog.showMessageBox(window, {
              type: 'warning',
              buttons: ['Cancel', 'Replace'],
              defaultId: 0,
              cancelId: 0,
              title: 'Replace local website?',
              message: `Replace “${path.basename(targetPath)}”?`,
              detail:
                inspected.state === 'empty'
                  ? 'The selected empty folder will be replaced.'
                  : 'Only the validated LeafBook website files will be replaced.'
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['Cancel', 'Replace'],
              defaultId: 0,
              cancelId: 0,
              title: 'Replace local website?',
              message: `Replace “${path.basename(targetPath)}”?`,
              detail:
                inspected.state === 'empty'
                  ? 'The selected empty folder will be replaced.'
                  : 'Only the validated LeafBook website files will be replaced.'
            })
        if (confirmation.response !== 1) return error('cancelled', 'The website was cancelled.')
        const confirmed = inspectWebsiteDirectorySync(targetPath)
        if (
          !confirmed ||
          confirmed.state !== inspected.state ||
          !confirmed.identity ||
          !inspected.identity ||
          !sameFileIdentity(confirmed.identity, inspected.identity) ||
          !sameWebsiteFiles(confirmed.files, inspected.files)
        ) {
          return error('website-unsafe-target', 'The website destination changed.')
        }
      }
    } else {
      try {
        const existing = await fs.lstat(targetPath, { bigint: true })
        if (
          existing.isSymbolicLink() ||
          !existing.isFile() ||
          existing.nlink !== 1n ||
          !targetIdentity
        ) {
          return error(writeCode, 'LeafBook will not replace this unsafe destination.')
        }
        targetLinkCount = existing.nlink
        const confirmation = window
          ? await dialog.showMessageBox(window, {
              type: 'warning',
              buttons: ['Cancel', 'Replace'],
              defaultId: 0,
              cancelId: 0,
              title: 'Replace existing export?',
              message: `Replace “${path.basename(targetPath)}”?`,
              detail: 'This explicitly replaces the existing HTML export.'
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['Cancel', 'Replace'],
              defaultId: 0,
              cancelId: 0,
              title: 'Replace existing export?',
              message: `Replace “${path.basename(targetPath)}”?`,
              detail: 'This explicitly replaces the existing HTML export.'
            })
        if (confirmation.response !== 1) return error('cancelled', 'The export was cancelled.')
      } catch (targetError) {
        if ((targetError as NodeJS.ErrnoException).code !== 'ENOENT') {
          return error(writeCode, 'LeafBook could not inspect the export destination.')
        }
        targetIdentity = null
        targetLinkCount = null
      }
    }
    if (
      this.ownedSession(sessionId, ownerId) !== session ||
      session.generation !== sessionGeneration ||
      (await this.validateSessionRoot(sessionId, session, false)) !== 'valid'
    ) {
      return error(sourceCode, 'The book changed while the export was starting.')
    }

    const sources = session.searchSources.slice(0, MAX_EXPORT_DOCUMENTS)
    if (session.searchSources.length > sources.length) {
      return error(tooLargeCode, 'This book has too many documents for one HTML export.')
    }
    const documentIdByPath = new Map<string, string>()
    sources.forEach((source, index) => documentIdByPath.set(source.path, `${index + 1}`))
    const documents: BookExportDocumentDto[] = []
    const revisions: ExportSourceRevision[] = []
    let sourceBytes = 0
    let linkCount = 0
    for (let index = 0; index < sources.length; index++) {
      if (
        !this.ownerIsCurrent(ownerId, ownerGeneration) ||
        this.ownedSession(sessionId, ownerId) !== session ||
        session.generation !== sessionGeneration
      ) {
        return error('cancelled', 'The export was cancelled.')
      }
      const source = sources[index]
      if (!source) continue
      const read = await this.readBookChapter(session.rootPath, source.path)
      const markdown = read?.content ?? null
      if (markdown !== null) {
        sourceBytes += Buffer.byteLength(markdown, 'utf8')
        if (sourceBytes > MAX_EXPORT_SOURCE_BYTES) {
          return error(tooLargeCode, 'This book is too large for one HTML export.')
        }
      }
      const documentId = documentIdByPath.get(source.path) as string
      const linkTargets: Record<string, { documentId: string; fragment: string | null }> = {}
      if (markdown !== null) {
        for (const href of markdownLinkHrefs(markdown)) {
          const target = localHrefTarget(source.path, href)
          if (target.kind !== 'local') continue
          const targetDocumentId = documentIdByPath.get(target.path)
          if (!targetDocumentId) continue
          linkTargets[href] = { documentId: targetDocumentId, fragment: target.fragment }
          linkCount++
          if (linkCount > MAX_EXPORT_LINKS) {
            return error(tooLargeCode, 'This book has too many links for one HTML export.')
          }
        }
      }
      const nodeIds = [...session.targets]
        .filter(([, target]) => target.kind === 'chapter' && target.path === source.path)
        .map(([nodeId]) => nodeId)
      documents.push({
        documentId,
        nodeIds,
        title: source.title,
        markdown,
        linkTargets
      })
      revisions.push({
        path: source.path,
        revision: markdown === null ? null : hashBytes(Buffer.from(markdown, 'utf8')),
        byteLength: markdown === null ? 0 : Buffer.byteLength(markdown, 'utf8')
      })
      if (
        (index + 1) % 8 === 0 &&
        (await this.validateSessionRoot(sessionId, session, false)) !== 'valid'
      ) {
        return error(sourceCode, 'The book changed while the export was prepared.')
      }
    }
    if (session.summaryPath) {
      const summary = await this.readBookChapter(session.rootPath, session.summaryPath)
      if (!summary) {
        return error(sourceCode, 'SUMMARY became unavailable during export.')
      }
      revisions.push({
        path: session.summaryPath,
        revision: hashBytes(Buffer.from(summary.content, 'utf8')),
        byteLength: Buffer.byteLength(summary.content, 'utf8')
      })
    }
    const finalRoot = await this.validateSessionRoot(sessionId, session, false)
    if (finalRoot !== 'valid' || session.generation !== sessionGeneration) {
      return error(sourceCode, 'The book changed while the export was prepared.')
    }
    await this.testHooks.beforeExportParentPin?.()
    if (
      !this.ownerIsCurrent(ownerId, ownerGeneration) ||
      this.ownedSession(sessionId, ownerId) !== session ||
      session.generation !== sessionGeneration
    ) {
      return error('cancelled', 'The export was cancelled.')
    }
    let parentFd: number | null = null
    try {
      const pathname = fsSync.lstatSync(parentRealPath, { bigint: true })
      if (
        pathname.isSymbolicLink() ||
        !pathname.isDirectory() ||
        pathname.dev !== parentIdentity.dev ||
        pathname.ino !== parentIdentity.ino
      ) {
        return error(writeCode, 'The export destination folder changed.')
      }
      parentFd = fsSync.openSync(
        parentRealPath,
        fsConstants.O_RDONLY |
          (fsConstants.O_DIRECTORY ?? 0) |
          (fsConstants.O_NOFOLLOW ?? 0) |
          (fsConstants.O_NONBLOCK ?? 0)
      )
      const pinned = fsSync.fstatSync(parentFd, { bigint: true })
      const pathnameIdentity = fileIdentitySync(parentRealPath, true)
      if (
        !pinned.isDirectory() ||
        pinned.dev !== parentIdentity.dev ||
        pinned.ino !== parentIdentity.ino ||
        !pathnameIdentity ||
        !sameFileIdentity(pathnameIdentity, parentIdentity) ||
        fsSync.realpathSync(parentRealPath) !== parentRealPath
      ) {
        fsSync.closeSync(parentFd)
        return error(writeCode, 'The export destination folder changed.')
      }
    } catch {
      if (parentFd !== null) {
        try {
          fsSync.closeSync(parentFd)
        } catch {
          // Ignore a close failure while rejecting the destination.
        }
      }
      return error(writeCode, 'The export destination folder is unavailable.')
    }
    const exportId = randomUUID()
    const lease: BookExportLease = {
      exportId,
      ownerId,
      ownerGeneration,
      session,
      sessionGeneration,
      rootIdentity: session.rootIdentity,
      targetPath,
      parentPath: parentRealPath,
      parentIdentity,
      targetIdentity,
      targetLinkCount,
      kind,
      websiteTargetState,
      websiteTargetFiles,
      sources: revisions,
      controller: new AbortController(),
      parentFd,
      generation: 0,
      operationGeneration: 0,
      operation: null,
      state: 'ready',
      criticalCommit: false,
      revokeAfterCommit: false
    }
    this.exportLeases.set(exportId, lease)
    const navigationTargets: Record<string, { documentId: string; fragment: string | null }> = {}
    for (const [nodeId, target] of session.targets) {
      if (target.kind !== 'chapter') continue
      const documentId = documentIdByPath.get(target.path)
      if (documentId) navigationTargets[nodeId] = { documentId, fragment: target.fragment }
    }
    return {
      ok: true,
      value: {
        exportId,
        title: session.dto.title,
        nodes: session.dto.nodes,
        landingNodeId: session.dto.landingNodeId,
        navigationTargets,
        documents
      }
    }
  }

  async commitExport(
    request: BookExportCommitRequestDto,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookExportSaveDto>> {
    const lease = this.exportLease(request?.exportId, ownerId)
    if (!lease || lease.kind !== 'html' || !this.exportLeaseCurrent(lease)) {
      return error('cancelled', 'This export has expired.')
    }
    if (lease.operation) {
      return error('export-busy', 'This export is already being saved.')
    }
    if (!this.safeExportHtml(request.html)) {
      this.revokeExport(lease)
      return error('export-invalid-output', 'LeafBook rejected unsafe generated HTML.')
    }
    const bytes = Buffer.from(request.html, 'utf8')
    const generation = lease.generation
    const operationGeneration = ++lease.operationGeneration
    lease.state = 'validating'
    const operation = (async () => {
      await Promise.resolve()
      return this.performExportCommit(lease, bytes, generation, operationGeneration)
    })()
    lease.operation = operation
    try {
      return await operation
    } finally {
      if (lease.operation === operation) lease.operation = null
      lease.criticalCommit = false
      lease.state = 'ready'
      this.revokeExport(lease)
    }
  }

  async commitWebsite(
    request: BookWebsiteCommitRequestDto,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookWebsiteSaveDto>> {
    const lease = this.exportLease(request?.websiteId, ownerId)
    if (!lease || lease.kind !== 'website' || !this.exportLeaseCurrent(lease)) {
      return error('cancelled', 'This website generation has expired.')
    }
    if (lease.operation) {
      return error('website-busy', 'This website is already being saved.')
    }
    if (!this.safeExportHtml(request.html)) {
      this.revokeExport(lease)
      return error('website-invalid-output', 'LeafBook rejected unsafe generated HTML.')
    }
    const bytes = Buffer.from(request.html, 'utf8')
    const generation = lease.generation
    const operationGeneration = ++lease.operationGeneration
    lease.state = 'validating'
    const operation = (async () => {
      await Promise.resolve()
      return this.performWebsiteCommit(lease, bytes, generation, operationGeneration)
    })()
    lease.operation = operation
    try {
      return await operation
    } finally {
      if (lease.operation === operation) lease.operation = null
      lease.criticalCommit = false
      lease.state = 'ready'
      this.revokeExport(lease)
    }
  }

  private syncExportParent(lease: BookExportLease): void {
    if (lease.parentFd === null) throw new Error('Export parent descriptor was revoked.')
    fsSync.fsyncSync(lease.parentFd)
  }

  private websiteCommonBoundaryCurrentSync(lease: BookExportLease): boolean {
    return (
      this.ownerIsCurrent(lease.ownerId, lease.ownerGeneration) &&
      this.ownedSession(lease.session.dto.sessionId, lease.ownerId) === lease.session &&
      lease.session.generation === lease.sessionGeneration &&
      this.exportParentCurrentSync(lease) &&
      this.exportRootCurrentSync(lease) &&
      this.exportSourcesCurrentSync(lease)
    )
  }

  private websiteDirectoryIdentityCurrentSync(
    directoryPath: string,
    identity: FileIdentity
  ): boolean {
    const current = fileIdentitySync(directoryPath, true)
    return current !== null && sameFileIdentity(current, identity)
  }

  private cleanupRecordedWebsiteDirectorySync(
    lease: BookExportLease,
    directoryPath: string,
    state: 'empty' | 'owned',
    identity: FileIdentity,
    linkCount: bigint,
    files: WebsiteFileIdentities | null,
    targetExpectation: {
      state: 'absent' | 'empty' | 'owned'
      identity: FileIdentity | null
      linkCount: bigint | null
      files: WebsiteFileIdentities | null
    },
    allowCleanupHook = false
  ): boolean {
    const targetCurrent = (): boolean =>
      sameWebsiteInspection(
        inspectWebsiteDirectorySync(lease.targetPath),
        targetExpectation.state,
        targetExpectation.identity,
        targetExpectation.linkCount,
        targetExpectation.files
      )
    const minimalParentAndDirectoryCurrent = (expectedLinkCount: bigint): boolean => {
      if (!this.exportParentCurrentSync(lease)) return false
      try {
        const pathname = fsSync.lstatSync(directoryPath, { bigint: true })
        return (
          !pathname.isSymbolicLink() &&
          pathname.isDirectory() &&
          pathname.dev === identity.dev &&
          pathname.ino === identity.ino &&
          pathname.nlink === expectedLinkCount
        )
      } catch {
        return false
      }
    }
    try {
      if (state === 'empty') {
        if (
          !this.websiteCommonBoundaryCurrentSync(lease) ||
          !targetCurrent() ||
          !minimalParentAndDirectoryCurrent(linkCount)
        ) {
          return false
        }
        if (
          !this.websiteDirectoryIdentityCurrentSync(directoryPath, identity) ||
          fsSync.readdirSync(directoryPath).length !== 0
        ) {
          return false
        }
        fsSync.rmdirSync(directoryPath)
        return true
      }
      if (!files) return false
      if (!this.websiteCommonBoundaryCurrentSync(lease) || !targetCurrent()) {
        return false
      }
      if (allowCleanupHook) this.testHooks.beforeWebsiteIndexFinalInspection?.(directoryPath)
      const finalIndexInspection = inspectWebsiteDirectorySync(directoryPath)
      if (
        !sameWebsiteInspection(finalIndexInspection, 'owned', identity, linkCount, files) ||
        !minimalParentAndDirectoryCurrent(linkCount)
      ) {
        return false
      }
      if (allowCleanupHook) this.testHooks.afterWebsiteIndexFinalInspection?.(directoryPath)
      fsSync.unlinkSync(path.join(directoryPath, BOOK_WEBSITE_INDEX))
      const afterIndexLinkCount = fsSync.lstatSync(directoryPath, { bigint: true }).nlink
      if (allowCleanupHook) this.testHooks.duringWebsiteBackupCleanup?.(directoryPath)
      if (!this.websiteCommonBoundaryCurrentSync(lease) || !targetCurrent()) {
        return false
      }
      if (allowCleanupHook) this.testHooks.beforeWebsiteManifestFinalInspection?.(directoryPath)
      const remaining = fsSync.readdirSync(directoryPath)
      const manifest = readPinnedRegularFileSync(
        path.join(directoryPath, BOOK_WEBSITE_MANIFEST),
        16 * 1024
      )
      if (
        remaining.length !== 1 ||
        remaining[0] !== BOOK_WEBSITE_MANIFEST ||
        !manifest ||
        !sameFileIdentity(manifest.identity, files.manifest) ||
        sha256Bytes(manifest.bytes) !== files.manifestSha256 ||
        !minimalParentAndDirectoryCurrent(afterIndexLinkCount)
      ) {
        return false
      }
      if (allowCleanupHook) this.testHooks.afterWebsiteManifestFinalInspection?.(directoryPath)
      fsSync.unlinkSync(path.join(directoryPath, BOOK_WEBSITE_MANIFEST))
      const afterManifestLinkCount = fsSync.lstatSync(directoryPath, { bigint: true }).nlink
      if (
        !this.websiteCommonBoundaryCurrentSync(lease) ||
        !targetCurrent() ||
        !minimalParentAndDirectoryCurrent(afterManifestLinkCount)
      ) {
        return false
      }
      if (
        !this.websiteDirectoryIdentityCurrentSync(directoryPath, identity) ||
        fsSync.readdirSync(directoryPath).length !== 0
      ) {
        return false
      }
      fsSync.rmdirSync(directoryPath)
      return true
    } catch {
      return false
    }
  }

  private async performWebsiteCommit(
    lease: BookExportLease,
    html: Buffer,
    generation: number,
    operationGeneration: number
  ): Promise<BookReaderResult<BookWebsiteSaveDto>> {
    const current = (): boolean => this.exportLeaseCurrent(lease, generation, operationGeneration)
    if (
      (await this.validateSessionRoot(lease.session.dto.sessionId, lease.session, false)) !==
        'valid' ||
      !current()
    ) {
      return current()
        ? error('website-source-changed', 'The source book changed before generation.')
        : error('cancelled', 'Website generation was cancelled.')
    }
    if (!(await this.validateExportSources(lease, generation, operationGeneration))) {
      return current()
        ? error('website-source-changed', 'A source chapter changed before generation.')
        : error('cancelled', 'Website generation was cancelled.')
    }
    await this.testHooks.afterExportSourcePass?.(1)
    if (!current()) return error('cancelled', 'Website generation was cancelled.')
    if (
      !this.exportParentCurrentSync(lease) ||
      !this.exportRootCurrentSync(lease) ||
      !this.exportTargetCurrentSync(lease)
    ) {
      return error('website-unsafe-target', 'The website boundary changed before writing.')
    }

    const token = randomUUID()
    const stagePath = path.join(lease.parentPath, `.leafbook-site-stage-${token}`)
    const backupPath = path.join(lease.parentPath, `.leafbook-site-backup-${token}`)
    let stageIdentity: FileIdentity | null = null
    let stageLinkCount: bigint | null = null
    let stageFiles: WebsiteFileIdentities | null = null
    let stagePresent = false
    let backupPresent = false
    let targetCommitted = false
    let durabilityUncertain = false
    try {
      await fs.mkdir(stagePath, { mode: 0o700 })
      stagePresent = true
      stageIdentity = fileIdentitySync(stagePath, true)
      if (!stageIdentity) throw new Error('Could not pin the staging directory.')
      await this.testHooks.afterExportTempOpen?.(stagePath)
      const writeKnownFile = async (name: string, bytes: Buffer): Promise<FileIdentity> => {
        const pathname = path.join(stagePath, name)
        const handle = await fs.open(
          pathname,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            (fsConstants.O_NOFOLLOW ?? 0) |
            (fsConstants.O_NONBLOCK ?? 0),
          0o600
        )
        try {
          const before = await handle.stat({ bigint: true })
          if (!before.isFile() || before.nlink !== 1n) throw new Error('Unsafe staging file.')
          await handle.writeFile(bytes)
          await handle.sync()
          const after = await handle.stat({ bigint: true })
          const pathnameAfter = fsSync.lstatSync(pathname, { bigint: true })
          if (
            !after.isFile() ||
            after.nlink !== 1n ||
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== BigInt(bytes.byteLength) ||
            pathnameAfter.isSymbolicLink() ||
            pathnameAfter.dev !== before.dev ||
            pathnameAfter.ino !== before.ino ||
            pathnameAfter.nlink !== 1n
          ) {
            throw new Error('The staging file identity changed.')
          }
          return { dev: after.dev, ino: after.ino, mode: Number(after.mode) }
        } finally {
          await handle.close()
        }
      }
      const stageIndexIdentity = await writeKnownFile(BOOK_WEBSITE_INDEX, html)
      const manifest = Buffer.from(
        serializeBookWebsiteManifest(createBookWebsiteManifest(html)),
        'utf8'
      )
      const stageManifestIdentity = await writeKnownFile(BOOK_WEBSITE_MANIFEST, manifest)
      stageFiles = {
        index: stageIndexIdentity,
        manifest: stageManifestIdentity,
        indexSha256: sha256Bytes(html),
        manifestSha256: sha256Bytes(manifest)
      }
      stageLinkCount = fsSync.lstatSync(stagePath, { bigint: true }).nlink
      const stageFd = fsSync.openSync(
        stagePath,
        fsConstants.O_RDONLY |
          (fsConstants.O_DIRECTORY ?? 0) |
          (fsConstants.O_NOFOLLOW ?? 0) |
          (fsConstants.O_NONBLOCK ?? 0)
      )
      try {
        fsSync.fsyncSync(stageFd)
      } finally {
        fsSync.closeSync(stageFd)
      }
      await this.testHooks.afterExportTempSync?.(stagePath)
      const staged = inspectWebsiteDirectorySync(stagePath)
      const stageNow = fileIdentitySync(stagePath, true)
      if (
        !staged ||
        staged.state !== 'owned' ||
        !stageNow ||
        !sameFileIdentity(stageNow, stageIdentity) ||
        !sameWebsiteFiles(staged.files, stageFiles)
      ) {
        throw new Error('The staging directory changed.')
      }
      if (
        !current() ||
        !this.exportParentCurrentSync(lease) ||
        !this.exportRootCurrentSync(lease) ||
        !this.exportTargetCurrentSync(lease) ||
        !(await this.validateExportSources(lease, generation, operationGeneration))
      ) {
        return current()
          ? error('website-source-changed', 'The source or destination changed before commit.')
          : error('cancelled', 'Website generation was cancelled.')
      }

      await this.testHooks.beforeExportCommitCritical?.()
      if (!current()) return error('cancelled', 'Website generation was cancelled.')
      lease.criticalCommit = true
      lease.state = 'committing'
      this.testHooks.exportCommitCriticalStarted?.()
      const stageCurrent = (): boolean =>
        Boolean(
          stageIdentity &&
          stageLinkCount !== null &&
          stageFiles &&
          sameWebsiteInspection(
            inspectWebsiteDirectorySync(stagePath),
            'owned',
            stageIdentity,
            stageLinkCount,
            stageFiles
          )
        )
      const originalTargetCurrent = (): boolean =>
        Boolean(
          lease.websiteTargetState &&
          sameWebsiteInspection(
            inspectWebsiteDirectorySync(lease.targetPath),
            lease.websiteTargetState,
            lease.targetIdentity,
            lease.targetLinkCount,
            lease.websiteTargetFiles
          )
        )
      const targetAbsent = (): boolean =>
        sameWebsiteInspection(
          inspectWebsiteDirectorySync(lease.targetPath),
          'absent',
          null,
          null,
          null
        )
      const backupOriginalCurrent = (): boolean =>
        Boolean(
          lease.websiteTargetState &&
          lease.websiteTargetState !== 'absent' &&
          sameWebsiteInspection(
            inspectWebsiteDirectorySync(backupPath),
            lease.websiteTargetState,
            lease.targetIdentity,
            lease.targetLinkCount,
            lease.websiteTargetFiles
          )
        )
      const stageAtTargetCurrent = (): boolean =>
        Boolean(
          stageIdentity &&
          stageLinkCount !== null &&
          stageFiles &&
          sameWebsiteInspection(
            inspectWebsiteDirectorySync(lease.targetPath),
            'owned',
            stageIdentity,
            stageLinkCount,
            stageFiles
          )
        )
      const preRenameBoundaryCurrent = (): boolean =>
        this.websiteCommonBoundaryCurrentSync(lease) && stageCurrent()
      if (lease.websiteTargetState === 'absent') {
        this.testHooks.beforeWebsiteStageRename?.(stagePath, lease.targetPath)
        if (!preRenameBoundaryCurrent() || !originalTargetCurrent()) {
          throw new Error('The website boundary changed before rename.')
        }
        fsSync.renameSync(stagePath, lease.targetPath)
        stagePresent = false
        targetCommitted = true
      } else {
        this.testHooks.beforeWebsiteFirstRename?.(stagePath, lease.targetPath)
        if (!preRenameBoundaryCurrent() || !originalTargetCurrent()) {
          throw new Error('The website boundary changed before backup rename.')
        }
        fsSync.renameSync(lease.targetPath, backupPath)
        backupPresent = true
        try {
          if (
            !this.websiteCommonBoundaryCurrentSync(lease) ||
            !stageCurrent() ||
            !targetAbsent() ||
            !backupOriginalCurrent()
          ) {
            throw new Error('The backup directory identity changed.')
          }
          this.syncExportParent(lease)
          this.testHooks.beforeWebsiteStageRename?.(stagePath, lease.targetPath)
          if (
            !this.websiteCommonBoundaryCurrentSync(lease) ||
            !stageCurrent() ||
            !targetAbsent() ||
            !backupOriginalCurrent()
          ) {
            throw new Error('The website boundary changed before stage rename.')
          }
          fsSync.renameSync(stagePath, lease.targetPath)
          stagePresent = false
          targetCommitted = true
        } catch (commitError) {
          try {
            this.testHooks.beforeWebsiteRollback?.(backupPath, lease.targetPath)
            if (
              !this.websiteCommonBoundaryCurrentSync(lease) ||
              !stageCurrent() ||
              !targetAbsent() ||
              !backupOriginalCurrent()
            ) {
              throw new Error('The rollback boundary changed.')
            }
            fsSync.renameSync(backupPath, lease.targetPath)
            backupPresent = false
            if (!originalTargetCurrent()) throw new Error('The rollback identity is uncertain.')
            this.syncExportParent(lease)
          } catch {
            return error(
              'website-commit-uncertain',
              'LeafBook could not confirm whether the previous website was restored.',
              undefined,
              true
            )
          }
          throw commitError
        }
      }
      this.testHooks.afterWebsiteStageRename?.(lease.targetPath)
      if (
        !this.websiteCommonBoundaryCurrentSync(lease) ||
        !stageAtTargetCurrent() ||
        (backupPresent && !backupOriginalCurrent())
      ) {
        return error(
          'website-commit-uncertain',
          'The website was moved into place, but its identity could not be verified.',
          undefined,
          true
        )
      }
      this.testHooks.afterExportRename?.()

      const committed = inspectWebsiteDirectorySync(lease.targetPath)
      if (
        !stageIdentity ||
        stageLinkCount === null ||
        !stageFiles ||
        !sameWebsiteInspection(committed, 'owned', stageIdentity, stageLinkCount, stageFiles)
      ) {
        return error(
          'website-commit-uncertain',
          'The website was moved into place, but its identity could not be verified.',
          undefined,
          true
        )
      }
      try {
        this.syncExportParent(lease)
      } catch {
        durabilityUncertain = true
      }
      const replacedState = lease.websiteTargetState
      if (
        !durabilityUncertain &&
        backupPresent &&
        (replacedState === 'empty' || replacedState === 'owned') &&
        lease.targetIdentity &&
        lease.targetLinkCount !== null &&
        stageIdentity &&
        stageLinkCount !== null &&
        stageFiles
      ) {
        this.testHooks.beforeWebsiteBackupCleanup?.(backupPath)
        if (
          !this.cleanupRecordedWebsiteDirectorySync(
            lease,
            backupPath,
            replacedState,
            lease.targetIdentity,
            lease.targetLinkCount,
            lease.websiteTargetFiles,
            {
              state: 'owned',
              identity: stageIdentity,
              linkCount: stageLinkCount,
              files: stageFiles
            },
            true
          )
        ) {
          durabilityUncertain = true
        } else {
          backupPresent = false
          try {
            this.syncExportParent(lease)
          } catch {
            durabilityUncertain = true
          }
        }
      }
      return {
        ok: true,
        value: {
          directoryName: path.basename(lease.targetPath),
          files: [BOOK_WEBSITE_INDEX, BOOK_WEBSITE_MANIFEST],
          byteLength: html.byteLength + manifest.byteLength,
          durabilityUncertain
        }
      }
    } catch {
      return error(
        targetCommitted ? 'website-commit-uncertain' : 'website-write-failed',
        targetCommitted
          ? 'The website may have committed, but LeafBook could not verify durability.'
          : 'LeafBook could not generate the local website.',
        undefined,
        targetCommitted
      )
    } finally {
      if (
        stagePresent &&
        stageIdentity &&
        stageLinkCount !== null &&
        stageFiles &&
        this.websiteCommonBoundaryCurrentSync(lease)
      ) {
        const currentStage = fileIdentitySync(stagePath, true)
        if (currentStage && sameFileIdentity(currentStage, stageIdentity)) {
          const targetState = lease.websiteTargetState
          if (targetState) {
            this.cleanupRecordedWebsiteDirectorySync(
              lease,
              stagePath,
              'owned',
              stageIdentity,
              stageLinkCount,
              stageFiles,
              {
                state: targetState,
                identity: lease.targetIdentity,
                linkCount: lease.targetLinkCount,
                files: lease.websiteTargetFiles
              }
            )
          }
        }
      }
      // Unknown or changed backups are deliberately left untouched. Phase 8C
      // does not scan for or recover orphaned transaction directories.
      lease.criticalCommit = false
    }
  }

  private async validateExportSources(
    lease: BookExportLease,
    generation: number,
    operationGeneration: number
  ): Promise<boolean> {
    for (let index = 0; index < lease.sources.length; index++) {
      if (!this.exportLeaseCurrent(lease, generation, operationGeneration)) return false
      const source = lease.sources[index]
      if (!source) continue
      const read = await this.readBookChapter(lease.session.rootPath, source.path)
      const revision = read ? hashBytes(Buffer.from(read.content, 'utf8')) : null
      if (
        !this.exportLeaseCurrent(lease, generation, operationGeneration) ||
        revision !== source.revision
      ) {
        return false
      }
    }
    return true
  }

  private async performExportCommit(
    lease: BookExportLease,
    bytes: Buffer,
    generation: number,
    operationGeneration: number
  ): Promise<BookReaderResult<BookExportSaveDto>> {
    const current = (): boolean => this.exportLeaseCurrent(lease, generation, operationGeneration)
    if (
      (await this.validateSessionRoot(lease.session.dto.sessionId, lease.session, false)) !==
        'valid' ||
      !current()
    ) {
      return current()
        ? error('export-source-changed', 'The source book changed before export.')
        : error('cancelled', 'This export was cancelled.')
    }
    if (!(await this.validateExportSources(lease, generation, operationGeneration))) {
      return current()
        ? error('export-source-changed', 'A source chapter changed before the export was saved.')
        : error('cancelled', 'This export was cancelled.')
    }
    await this.testHooks.afterExportSourcePass?.(1)
    if (!current()) return error('cancelled', 'This export was cancelled.')
    if (
      (await this.validateSessionRoot(lease.session.dto.sessionId, lease.session, false)) !==
        'valid' ||
      !current()
    ) {
      return current()
        ? error('export-source-changed', 'The source book changed before export.')
        : error('cancelled', 'This export was cancelled.')
    }
    if (
      !this.exportParentCurrentSync(lease) ||
      !this.exportRootCurrentSync(lease) ||
      !this.exportTargetCurrentSync(lease)
    ) {
      return error('export-write-failed', 'The export boundary changed before writing.')
    }

    const tempPath = path.join(lease.parentPath, `.leafbook-export-${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    let tempIdentity: FileIdentity | null = null
    let committed = false
    let durabilityUncertain = false
    try {
      lease.state = 'writing'
      handle = await fs.open(
        tempPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0) |
          (fsConstants.O_NONBLOCK ?? 0),
        0o600
      )
      await this.testHooks.afterExportTempOpen?.()
      if (
        !current() ||
        !this.exportParentCurrentSync(lease) ||
        !this.exportRootCurrentSync(lease)
      ) {
        return current()
          ? error('export-write-failed', 'The export boundary changed while opening its temp file.')
          : error('cancelled', 'This export was cancelled.')
      }
      const tempStat = await handle.stat({ bigint: true })
      if (!current() || !tempStat.isFile() || tempStat.nlink !== 1n) {
        return current()
          ? error('export-write-failed', 'LeafBook could not pin the export temp file.')
          : error('cancelled', 'This export was cancelled.')
      }
      tempIdentity = { dev: tempStat.dev, ino: tempStat.ino, mode: Number(tempStat.mode) }
      await handle.writeFile(bytes)
      if (!current()) return error('cancelled', 'This export was cancelled.')
      await handle.sync()
      if (!current()) return error('cancelled', 'This export was cancelled.')
      await handle.close()
      handle = null
      await this.testHooks.afterExportTempSync?.()
      if (!current()) return error('cancelled', 'This export was cancelled.')

      lease.state = 'validating'
      if (!(await this.validateExportSources(lease, generation, operationGeneration))) {
        return current()
          ? error(
              'export-source-changed',
              'A source chapter changed before the export was committed.'
            )
          : error('cancelled', 'This export was cancelled.')
      }
      await this.testHooks.afterExportSourcePass?.(2)
      if (!current()) return error('cancelled', 'This export was cancelled.')
      if (
        (await this.validateSessionRoot(lease.session.dto.sessionId, lease.session, false)) !==
          'valid' ||
        !current()
      ) {
        return current()
          ? error('export-source-changed', 'The source book changed before export commit.')
          : error('cancelled', 'This export was cancelled.')
      }
      await this.testHooks.beforeExportCommitCritical?.()
      if (!current()) return error('cancelled', 'This export was cancelled.')

      // Node has no portable fd-relative rename. Keep every final pathname,
      // pinned-directory, root, target, source and temp-inode check in the same
      // synchronous event-loop turn as renameSync. This prevents renderer
      // cancellation/cleanup from interleaving and fails closed on observed
      // parent/root/source swaps.
      if (
        !this.exportParentCurrentSync(lease) ||
        !this.exportRootCurrentSync(lease) ||
        !this.exportTargetCurrentSync(lease) ||
        !tempIdentity ||
        !sameFileIdentity(
          fileIdentitySync(tempPath) ?? { dev: -1n, ino: -1n, mode: 0 },
          tempIdentity
        )
      ) {
        return error('export-write-failed', 'The export boundary changed before commit.')
      }
      if (!this.exportSourcesCurrentSync(lease)) {
        return error('export-source-changed', 'A source chapter changed at export commit.')
      }

      lease.state = 'committing'
      this.testHooks.exportCommitCriticalStarted?.()
      if (!current()) return error('cancelled', 'This export was cancelled.')
      lease.criticalCommit = true
      fsSync.renameSync(tempPath, lease.targetPath)
      committed = true
      this.testHooks.afterExportRename?.()

      const committedTarget = fileIdentitySync(lease.targetPath)
      const committedTargetStat = fsSync.lstatSync(lease.targetPath, {
        bigint: true,
        throwIfNoEntry: false
      })
      if (
        !this.exportParentCurrentSync(lease) ||
        !this.exportRootCurrentSync(lease) ||
        !committedTarget ||
        !sameFileIdentity(committedTarget, tempIdentity) ||
        !committedTargetStat ||
        committedTargetStat.isSymbolicLink() ||
        committedTargetStat.nlink !== 1n ||
        lease.controller.signal.aborted ||
        lease.revokeAfterCommit
      ) {
        return error(
          'export-write-failed',
          'The export was written, but its destination identity became uncertain.',
          undefined,
          true
        )
      }
      try {
        if (lease.parentFd === null) throw new Error('Export parent descriptor was revoked.')
        fsSync.fsyncSync(lease.parentFd)
      } catch {
        durabilityUncertain = true
      }
      return {
        ok: true,
        value: {
          fileName: path.basename(lease.targetPath),
          byteLength: bytes.length,
          durabilityUncertain
        }
      }
    } catch {
      return error(
        'export-write-failed',
        committed
          ? 'The export was written, but LeafBook could not verify its durability.'
          : 'LeafBook could not write the export.',
        undefined,
        committed
      )
    } finally {
      await handle?.close().catch(() => undefined)
      if (
        !committed &&
        tempIdentity &&
        this.exportParentCurrentSync(lease) &&
        sameFileIdentity(
          fileIdentitySync(tempPath) ?? { dev: -1n, ino: -1n, mode: 0 },
          tempIdentity
        )
      ) {
        try {
          fsSync.unlinkSync(tempPath)
        } catch {
          // A random temp is harmless if safe pathname cleanup cannot be proven.
        }
      }
    }
  }

  cancelExport(exportId: unknown, ownerId: number = 0): BookReaderResult<true> {
    const lease = this.exportLease(exportId, ownerId)
    if (!lease || lease.kind !== 'html') return error('cancelled', 'This export has expired.')
    this.revokeExport(lease)
    return { ok: true, value: true }
  }

  cancelWebsite(websiteId: unknown, ownerId: number = 0): BookReaderResult<true> {
    const lease = this.exportLease(websiteId, ownerId)
    if (!lease || lease.kind !== 'website') {
      return error('cancelled', 'This website generation has expired.')
    }
    this.revokeExport(lease)
    return { ok: true, value: true }
  }

  async followLink(
    sessionId: unknown,
    nodeId: unknown,
    href: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookLinkNavigationDto | null>> {
    if (
      !validOpaqueId(sessionId) ||
      !validOpaqueId(nodeId) ||
      typeof href !== 'string' ||
      !href ||
      href.length > MAX_HREF_LENGTH ||
      href.includes('\0')
    ) {
      return error('invalid-request', 'Invalid book link request.')
    }
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const initialRoot = await this.validateSessionRoot(sessionId, session)
    if (initialRoot === 'revoked') {
      return error('session-not-found', 'This book session has expired.')
    }
    if (initialRoot === 'invalid') {
      return error('book-unavailable', 'This book folder changed and the session was invalidated.')
    }
    const current = session.targets.get(nodeId)
    if (!current) return error('node-not-found', 'This chapter is not part of the current book.')

    if (current.kind === 'external') {
      const target = resolveBookTarget(current.url)
      if (target.kind !== 'external') return error('unsafe-link', 'The external link is unsafe.')
      if (this.ownedSession(sessionId, ownerId) !== session) {
        return error('session-not-found', 'This book session has expired.')
      }
      try {
        if (!(await this.openExternal(ownerId, target.url))) {
          return error('unsafe-link', 'LeafBook did not open the external link.')
        }
        if (this.ownedSession(sessionId, ownerId) !== session) {
          return error('session-not-found', 'This book session has expired.')
        }
        return { ok: true, value: null }
      } catch {
        if (this.ownedSession(sessionId, ownerId) !== session) {
          return error('session-not-found', 'This book session has expired.')
        }
        return error('unsafe-link', 'LeafBook could not open the external link.')
      }
    }
    const target = localHrefTarget(current.path, href)
    if (target.kind === 'external') {
      const revalidated = resolveBookTarget(target.url)
      if (revalidated.kind !== 'external') {
        return error('unsafe-link', 'The external link is unsafe.')
      }
      if (this.ownedSession(sessionId, ownerId) !== session) {
        return error('session-not-found', 'This book session has expired.')
      }
      try {
        if (!(await this.openExternal(ownerId, revalidated.url))) {
          return error('unsafe-link', 'LeafBook did not open the external link.')
        }
        if (this.ownedSession(sessionId, ownerId) !== session) {
          return error('session-not-found', 'This book session has expired.')
        }
        return { ok: true, value: null }
      } catch {
        if (this.ownedSession(sessionId, ownerId) !== session) {
          return error('session-not-found', 'This book session has expired.')
        }
        return error('unsafe-link', 'LeafBook could not open the external link.')
      }
    }
    if (target.kind !== 'local') return error('unsafe-link', 'This link is not allowed.')
    const targetNodeId = session.chapterNodeByPath.get(target.path)
    if (!targetNodeId) {
      return error('link-not-found', 'This link does not point to a chapter in the book.')
    }
    return { ok: true, value: { nodeId: targetNodeId, fragment: target.fragment } }
  }
}
