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
  BookReaderNodeDto,
  BookReaderResult,
  BookshelfEntryDto,
  BookSessionDto
} from '@shared/types/bookReader'

const MAX_BOOKS = 50
const MAX_SESSIONS = 20
const MAX_ID_LENGTH = 128
const MAX_HREF_LENGTH = 8_192

interface PersistedLibrary {
  libraryId: string
  rootPath: string
  title: string
  lastOpenedAt: string
}

interface BookshelfSchema {
  libraries: PersistedLibrary[]
}

type SessionTarget =
  | { kind: 'chapter'; path: string; fragment: string | null; title: string }
  | { kind: 'external'; url: string; title: string }

interface BookSession {
  libraryId: string
  rootPath: string
  rootIdentity: RootIdentity
  ownerId: number
  dto: BookSessionDto
  targets: Map<string, SessionTarget>
  chapterNodeByPath: Map<string, string>
  opaqueNodeIds: Map<string, string>
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
    typeof item.lastOpenedAt === 'string' &&
    !Number.isNaN(Date.parse(item.lastOpenedAt))
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
    session: BookSession
  ): Promise<'valid' | 'invalid' | 'revoked'> {
    const current = await this.identifyRoot(session.rootPath)
    if (this.ownedSession(sessionId, session.ownerId) !== session) return 'revoked'
    const valid =
      current !== null &&
      current.realPath === session.rootIdentity.realPath &&
      current.dev === session.rootIdentity.dev &&
      current.ino === session.rootIdentity.ino
    if (!valid) {
      this.sessions.delete(sessionId)
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
        lastOpenedAt: new Date().toISOString()
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
        title
      }
      const nodeId = allocateNodeId(stableId)
      targets.set(nodeId, target)
      if (!chapterNodeByPath.has(landingPath)) chapterNodeByPath.set(landingPath, nodeId)
      return nodeId
    }
    const mapNode = (node: BookNavigationNode): BookReaderNodeDto => {
      const children = node.children.map(mapNode)
      const target: SessionTarget | null =
        node.type === 'chapter'
          ? {
              kind: 'chapter',
              path: node.path,
              fragment: node.fragment,
              title: node.title
            }
          : node.type === 'external'
            ? { kind: 'external', url: node.url, title: node.title }
            : null
      const nodeId = allocateNodeId(`navigation:${node.id}`)
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
    const dto: BookSessionDto = {
      libraryId,
      sessionId,
      title: result.book.metadata.title,
      navigationSource: result.book.navigation.source,
      nodes,
      entryNodeId,
      landingNodeId: landingAlreadyInContents ? null : (landingNodeId ?? null),
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
      opaqueNodeIds
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
    return {
      ok: true,
      value: {
        nodeId,
        title: target.title,
        markdown: result.content,
        fragment: target.fragment
      }
    }
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
