/* eslint-disable @stylistic/indent, @stylistic/space-before-function-paren */
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import {
  BrowserWindow,
  dialog,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import Store from 'electron-store'
import { loadBookFromDirectory, safelyReadBookChapter } from './filesystem'
import { resolveBookTarget } from 'common/book/path'
import {
  createBookSearchDocumentAsync,
  matchBookSearchDocumentAsync,
  parseBookSearchQuery,
  type BookSearchDocument
} from 'common/book/search'
import type { BookNavigationNode } from 'common/book/model'
import type {
  BookChapterDto,
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
  dto: BookSessionDto
  targets: Map<string, SessionTarget>
  chapterNodeByPath: Map<string, string>
  opaqueNodeIds: Map<string, string>
  readableNodeIds: string[]
  searchSources: SearchSource[]
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

const error = <T>(
  code: Parameters<typeof structuredError>[0],
  message: string
): BookReaderResult<T> => ({ ok: false, error: structuredError(code, message) })

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
    | 'search-unavailable',
  message: string
) => ({ code, message })

const validOpaqueId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 16 &&
  value.length <= MAX_ID_LENGTH &&
  /^[a-zA-Z0-9-]+$/.test(value)

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
  private searchCacheBytes = 0
  private searchBuildReservationBytes = 0

  constructor(
    userDataPath: string,
    private readonly loadBook: typeof loadBookFromDirectory = loadBookFromDirectory,
    private readonly readBookChapter: typeof safelyReadBookChapter = safelyReadBookChapter,
    private readonly openExternal: typeof shell.openExternal = shell.openExternal
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
        this.revokeSessionSearch(session)
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
        this.revokeSessionSearch(session)
        this.sessions.delete(sessionId)
      }
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
      dto,
      targets,
      chapterNodeByPath,
      opaqueNodeIds,
      readableNodeIds,
      searchSources
    }
  }

  private registerSession(session: BookSession): BookSessionDto {
    this.sessions.set(session.dto.sessionId, session)
    const ownerId = session.ownerId
    const owned = [...this.sessions].filter(([, session]) => session.ownerId === ownerId)
    while (owned.length > MAX_SESSIONS) {
      const oldest = owned.shift()
      if (!oldest) break
      this.revokeSessionSearch(oldest[1])
      this.sessions.delete(oldest[0])
    }
    return session.dto
  }

  async refresh(
    sessionId: unknown,
    ownerId: number = 0
  ): Promise<BookReaderResult<BookSessionDto>> {
    if (!validOpaqueId(sessionId)) return error('invalid-request', 'Invalid session identifier.')
    if (!this.ownedSession(sessionId, ownerId)) {
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
    const operation = this.refreshSession(sessionId, ownerId)
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
    ownerId: number
  ): Promise<BookReaderResult<BookSessionDto>> {
    const session = this.ownedSession(sessionId, ownerId)
    if (!session) return error('session-not-found', 'This book session has expired.')
    const initialRoot = await this.validateSessionRoot(sessionId, session)
    if (initialRoot === 'revoked') {
      return error('session-not-found', 'This book session has expired.')
    }
    if (initialRoot === 'invalid') {
      return error('book-unavailable', 'This book folder changed and the session was invalidated.')
    }
    this.revokeSessionSearch(session)
    const result = await this.loadBook(session.rootPath)
    if (this.ownedSession(sessionId, ownerId) !== session) {
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
    if (this.ownedSession(sessionId, ownerId) !== session) {
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
    this.revokeSessionSearch(session)
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
          this.revokeSessionSearch(session)
          this.sessions.delete(sessionId)
        }
      }
      return { ok: true, value: true }
    })
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
        await this.openExternal(target.url)
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
        await this.openExternal(revalidated.url)
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
