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
import type { BookNavigationNode } from 'common/book/model'
import type {
  BookChapterDto,
  BookLinkNavigationDto,
  BookReadingProgressDto,
  BookReaderNodeDto,
  BookReaderResult,
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
    | 'link-not-found',
  message: string
) => ({ code, message })

const validOpaqueId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 16 &&
  value.length <= MAX_ID_LENGTH &&
  /^[a-zA-Z0-9-]+$/.test(value)

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
      if (invalidate) this.sessions.delete(sessionId)
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
      if (session.ownerId === ownerId) this.sessions.delete(sessionId)
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
    const mapNode = (node: BookNavigationNode): BookReaderNodeDto => {
      const children = node.children.map(mapNode)
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
      if (node.type === 'chapter') {
        targets.set(nodeId, target as Extract<SessionTarget, { kind: 'chapter' }>)
        if (!chapterNodeByPath.has(node.path)) chapterNodeByPath.set(node.path, nodeId)
      } else if (node.type === 'external') {
        targets.set(nodeId, target as Extract<SessionTarget, { kind: 'external' }>)
      }
      return {
        nodeId,
        type: node.type,
        title: node.title,
        children,
        ...(node.type === 'group'
          ? {
              landingNodeId: addLanding(node.landingPath, node.title, `group-landing:${node.id}`)
            }
          : {})
      }
    }
    const nodes = result.book.navigation.nodes.map(mapNode)
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
      readableNodeIds
    }
  }

  private registerSession(session: BookSession): BookSessionDto {
    this.sessions.set(session.dto.sessionId, session)
    const ownerId = session.ownerId
    const owned = [...this.sessions].filter(([, session]) => session.ownerId === ownerId)
    while (owned.length > MAX_SESSIONS) {
      const oldest = owned.shift()
      if (!oldest) break
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
    this.sessions.set(sessionId, replacement)
    return {
      ok: true,
      value: replacement.dto
    }
  }

  closeSession(sessionId: unknown, ownerId: number = 0): BookReaderResult<true> {
    if (!validOpaqueId(sessionId)) return error('invalid-request', 'Invalid session identifier.')
    if (!this.ownedSession(sessionId, ownerId) || !this.sessions.delete(sessionId)) {
      return error('session-not-found', 'This book session has expired.')
    }
    return { ok: true, value: true }
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
        if (session.libraryId === libraryId) this.sessions.delete(sessionId)
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
