/* eslint-disable @stylistic/space-before-function-paren */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BookChapterDto,
  BookReaderError,
  BookReaderNodeDto,
  BookSearchIndexStatusDto,
  BookSearchProgressDto,
  BookSearchResultDto,
  BookshelfEntryDto,
  BookSessionDto
} from '@shared/types/bookReader'
import { adjacentChapter, flattenReadableNodeIds } from '@/book/readerModel'
import bus from '@/bus'

const SAVE_DEBOUNCE_MS = 2_000
const SAVE_EPSILON = 0.002
const SEARCH_DEBOUNCE_MS = 200

interface PendingReadingPosition {
  sessionId: string
  nodeId: string
  ratio: number
  origin: 'user' | 'programmatic'
}

type NavigationIntent = 'explicit' | 'restore'

const unexpectedError = (): BookReaderError => ({
  code: 'invalid-request',
  message: 'LeafBook could not complete this request. Please try again.'
})

export const useBooksStore = defineStore('books', () => {
  const mode = ref<'editor' | 'bookshelf' | 'reader'>('editor')
  const libraries = ref<BookshelfEntryDto[]>([])
  const session = ref<BookSessionDto | null>(null)
  const chapter = ref<BookChapterDto | null>(null)
  const error = ref<BookReaderError | null>(null)
  const pending = ref(new Set<number>())
  const loading = computed(() => pending.value.size > 0)
  let generation = 0
  let operation = 0
  let refreshInFlight: Promise<void> | null = null
  let readingPositionProvider: (() => number | null) | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave: PendingReadingPosition | null = null
  let inFlightSave: PendingReadingPosition | null = null
  let saveInFlight: Promise<void> | null = null
  let lastPersisted: PendingReadingPosition | null = null
  const restoringReadingPosition = ref(false)
  let restorationInFlight: Promise<void> | null = null
  let resolveRestoration: (() => void) | null = null
  let restorationGeneration = 0
  const readingPositionReady = computed(
    () =>
      mode.value === 'reader' &&
      !loading.value &&
      !restoringReadingPosition.value &&
      Boolean(session.value && chapter.value)
  )
  const searchQuery = ref('')
  const searchResults = ref<BookSearchResultDto[]>([])
  const searchLoading = ref(false)
  const searchProgress = ref<BookSearchProgressDto | null>(null)
  const searchIndexStatus = ref<BookSearchIndexStatusDto | null>(null)
  const searchTotalResults = ref(0)
  const searchTruncated = ref(false)
  const searchError = ref<BookReaderError | null>(null)
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchGeneration = 0
  let activeSearch: { sessionId: string; searchId: string } | null = null

  const clearSearchTimer = (): void => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = null
  }

  const cancelSearch = async (clear = false): Promise<void> => {
    clearSearchTimer()
    searchGeneration += 1
    const active = activeSearch
    activeSearch = null
    searchLoading.value = false
    searchProgress.value = null
    if (clear) {
      searchQuery.value = ''
      searchResults.value = []
      searchIndexStatus.value = null
      searchTotalResults.value = 0
      searchTruncated.value = false
      searchError.value = null
    }
    if (active) {
      try {
        await window.electron.books.cancelSearch(active.sessionId, active.searchId)
      } catch {
        // Cancellation is best-effort; generation checks still reject stale results.
      }
    }
  }

  const runSearch = async (query: string, token: number): Promise<void> => {
    const sessionSnapshot = session.value
    if (!sessionSnapshot || mode.value !== 'reader' || token !== searchGeneration) return
    const searchId = crypto.randomUUID()
    const prior = activeSearch
    activeSearch = { sessionId: sessionSnapshot.sessionId, searchId }
    searchLoading.value = true
    searchProgress.value = null
    searchError.value = null
    const request = window.electron.books.search(sessionSnapshot.sessionId, { searchId, query })
    if (prior) {
      window.electron.books.cancelSearch(prior.sessionId, prior.searchId).catch(() => undefined)
    }
    try {
      const result = await request
      if (
        token !== searchGeneration ||
        activeSearch?.searchId !== searchId ||
        session.value?.sessionId !== sessionSnapshot.sessionId
      ) {
        return
      }
      if (!result.ok) {
        if (result.error.code !== 'search-cancelled') searchError.value = result.error
        return
      }
      searchResults.value = result.value.results
      searchIndexStatus.value = result.value.index
      searchTotalResults.value = result.value.totalResults
      searchTruncated.value = result.value.truncated
    } catch {
      if (token === searchGeneration) searchError.value = unexpectedError()
    } finally {
      if (token === searchGeneration) {
        searchLoading.value = false
        searchProgress.value = null
        activeSearch = null
      }
    }
  }

  const scheduleSearch = (query: string): void => {
    searchQuery.value = query
    clearSearchTimer()
    const token = ++searchGeneration
    const prior = activeSearch
    activeSearch = null
    searchLoading.value = false
    searchProgress.value = null
    searchResults.value = []
    searchIndexStatus.value = null
    searchTotalResults.value = 0
    searchTruncated.value = false
    searchError.value = null
    if (prior) {
      window.electron.books.cancelSearch(prior.sessionId, prior.searchId).catch(() => undefined)
    }
    if (!query.trim()) {
      return
    }
    searchTimer = setTimeout(() => {
      searchTimer = null
      runSearch(query, token)
    }, SEARCH_DEBOUNCE_MS)
  }

  const handleSearchProgress = (progress: BookSearchProgressDto): void => {
    if (
      activeSearch?.searchId === progress.searchId &&
      activeSearch.sessionId === session.value?.sessionId
    ) {
      searchProgress.value = progress
    }
  }

  const start = (): { token: number; operationId: number } => {
    const value = { token: ++generation, operationId: ++operation }
    pending.value = new Set(pending.value).add(value.operationId)
    error.value = null
    return value
  }
  const finish = (operationId: number): void => {
    const next = new Set(pending.value)
    next.delete(operationId)
    pending.value = next
  }
  const current = (token: number): boolean => token === generation
  const setUnexpected = (token: number): void => {
    if (current(token)) error.value = unexpectedError()
  }

  const previousNodeId = computed(() => {
    const currentSession = session.value
    if (!currentSession) return null
    return adjacentChapter(
      currentSession.nodes,
      chapter.value?.nodeId ?? null,
      -1,
      currentSession.landingNodeId
    )
  })
  const nextNodeId = computed(() => {
    const currentSession = session.value
    if (!currentSession) return null
    return adjacentChapter(
      currentSession.nodes,
      chapter.value?.nodeId ?? null,
      1,
      currentSession.landingNodeId
    )
  })

  const samePosition = (
    left: PendingReadingPosition | null,
    right: PendingReadingPosition
  ): boolean =>
    left?.sessionId === right.sessionId &&
    left.nodeId === right.nodeId &&
    Math.abs(left.ratio - right.ratio) < SAVE_EPSILON

  const clearSaveTimer = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
  }

  const applyLiveProgress = (ratio: number): void => {
    const currentSession = session.value
    const currentChapter = chapter.value
    if (!currentSession || !currentChapter) return
    const readable = flattenReadableNodeIds(currentSession.nodes, currentSession.landingNodeId)
    const index = readable.indexOf(currentChapter.nodeId)
    const overallProgress =
      index < 0 || !readable.length
        ? currentSession.readingProgress
        : (index + ratio) / readable.length
    session.value = {
      ...currentSession,
      resumeNodeId: currentChapter.nodeId,
      readingProgress: Math.min(1, Math.max(0, overallProgress))
    }
    chapter.value = { ...currentChapter, readingPosition: ratio, hasReadingPosition: true }
  }

  const startPersisting = (): void => {
    if (saveInFlight || !pendingSave) return
    const request = pendingSave
    pendingSave = null
    inFlightSave = request
    const work = (async () => {
      try {
        const result = await window.electron.books.saveReadingPosition(
          request.sessionId,
          request.nodeId,
          request.ratio
        )
        if (!result.ok) return
        lastPersisted = {
          sessionId: request.sessionId,
          nodeId: request.nodeId,
          ratio: result.value.chapterProgress,
          origin: request.origin
        }
        const latestPending = pendingSave as PendingReadingPosition | null
        const superseded =
          latestPending?.sessionId === request.sessionId &&
          latestPending.nodeId === request.nodeId &&
          !samePosition(latestPending, request)
        if (
          !superseded &&
          session.value?.sessionId === request.sessionId &&
          chapter.value?.nodeId === request.nodeId
        ) {
          session.value = {
            ...session.value,
            resumeNodeId: request.nodeId,
            readingProgress: result.value.overallProgress
          }
          chapter.value = {
            ...chapter.value,
            readingPosition: result.value.chapterProgress,
            hasReadingPosition: true
          }
        }
      } catch {
        // Reading-position persistence is best-effort and must not interrupt reading.
      } finally {
        saveInFlight = null
        inFlightSave = null
        if (pendingSave && !saveTimer) startPersisting()
      }
    })()
    saveInFlight = work
  }

  const queueReadingPosition = (
    ratio: number,
    debounce: boolean,
    origin: PendingReadingPosition['origin'] = 'user'
  ): void => {
    const currentSession = session.value
    const currentChapter = chapter.value
    if (!currentSession || !currentChapter || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      return
    }
    const request = {
      sessionId: currentSession.sessionId,
      nodeId: currentChapter.nodeId,
      ratio,
      origin
    }
    if (
      samePosition(pendingSave, request) ||
      (!pendingSave && samePosition(inFlightSave, request)) ||
      (!pendingSave && !inFlightSave && samePosition(lastPersisted, request))
    ) {
      return
    }
    pendingSave = request
    clearSaveTimer()
    if (debounce) {
      saveTimer = setTimeout(() => {
        saveTimer = null
        startPersisting()
      }, SAVE_DEBOUNCE_MS)
    } else {
      startPersisting()
    }
  }

  const reportReadingPosition = (ratio: number): void => {
    if (
      mode.value !== 'reader' ||
      loading.value ||
      restoringReadingPosition.value ||
      !session.value ||
      !chapter.value ||
      !Number.isFinite(ratio) ||
      ratio < 0 ||
      ratio > 1
    ) {
      return
    }
    applyLiveProgress(ratio)
    queueReadingPosition(ratio, true)
  }

  const beginReadingPositionRestore = (): number => {
    resolveRestoration?.()
    const generation = ++restorationGeneration
    restoringReadingPosition.value = true
    restorationInFlight = new Promise<void>((resolve) => {
      resolveRestoration = resolve
    })
    if (pendingSave?.origin === 'programmatic') {
      clearSaveTimer()
      pendingSave = null
    }
    return generation
  }

  const completeReadingPositionRestore = (
    generation: number,
    ratio: number,
    persist: boolean
  ): void => {
    if (generation !== restorationGeneration) return
    restoringReadingPosition.value = false
    if (
      mode.value !== 'reader' ||
      !session.value ||
      !chapter.value ||
      !Number.isFinite(ratio) ||
      ratio < 0 ||
      ratio > 1
    ) {
      resolveRestoration?.()
      resolveRestoration = null
      restorationInFlight = null
      return
    }
    applyLiveProgress(ratio)
    if (persist) queueReadingPosition(ratio, true, 'programmatic')
    resolveRestoration?.()
    resolveRestoration = null
    restorationInFlight = null
  }

  const cancelReadingPositionRestore = (generation: number): void => {
    if (generation !== restorationGeneration) return
    restoringReadingPosition.value = false
    resolveRestoration?.()
    resolveRestoration = null
    restorationInFlight = null
  }

  const flushReadingPosition = async (): Promise<void> => {
    const activeRestoration = restorationInFlight
    if (activeRestoration) await activeRestoration
    // A scroll event is the authoritative latest user intent. Only sample the
    // DOM provider when no reported position is already waiting; this avoids a
    // late layout/fragment scroll replacing a newer explicit user scroll.
    if (!pendingSave) {
      const provided = readingPositionProvider?.()
      if (provided !== null && provided !== undefined) {
        if (Number.isFinite(provided) && provided >= 0 && provided <= 1) {
          applyLiveProgress(provided)
          queueReadingPosition(provided, false)
        }
      }
    }
    clearSaveTimer()
    startPersisting()
    for (;;) {
      const activeSave = saveInFlight
      if (activeSave) await activeSave
      else if (pendingSave) startPersisting()
      else break
    }
  }

  const registerReadingPositionProvider = (provider: () => number | null): (() => void) => {
    readingPositionProvider = provider
    return () => {
      if (readingPositionProvider === provider) readingPositionProvider = null
    }
  }

  const readNode = async (
    sessionSnapshot: BookSessionDto,
    nodeId: string,
    token: number,
    intent: NavigationIntent,
    fragmentOverride?: string | null
  ): Promise<void> => {
    try {
      const result = await window.electron.books.readChapter(sessionSnapshot.sessionId, nodeId)
      if (!current(token) || session.value?.sessionId !== sessionSnapshot.sessionId) return
      if (!result.ok) {
        error.value = result.error
        return
      }
      const explicitFragment =
        fragmentOverride === undefined ? result.value.fragment : fragmentOverride
      if (intent === 'restore' && result.value.hasReadingPosition) {
        chapter.value = { ...result.value, fragment: null }
      } else {
        chapter.value = {
          ...result.value,
          fragment: explicitFragment,
          readingPosition: intent === 'explicit' ? 0 : result.value.readingPosition
        }
      }
      if (intent === 'explicit') {
        applyLiveProgress(0)
      }
    } catch {
      setUnexpected(token)
    }
  }

  const loadBookshelf = async (): Promise<void> => {
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.list()
      if (current(token)) libraries.value = result
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const showBookshelf = async (): Promise<void> => {
    cancelSearch(true)
    await flushReadingPosition()
    const { token, operationId } = start()
    const oldSession = session.value
    mode.value = 'bookshelf'
    session.value = null
    chapter.value = null
    try {
      if (oldSession) await window.electron.books.closeSession(oldSession.sessionId)
      const result = await window.electron.books.list()
      if (current(token)) libraries.value = result
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const enterSession = async (
    value: BookSessionDto,
    token: number,
    oldSession: BookSessionDto | null
  ): Promise<void> => {
    if (!current(token)) return
    if (oldSession && oldSession.sessionId !== value.sessionId) {
      await window.electron.books.closeSession(oldSession.sessionId)
      if (!current(token)) {
        await window.electron.books.closeSession(value.sessionId)
        return
      }
    }
    session.value = value
    chapter.value = null
    mode.value = 'reader'
    lastPersisted = null
    const target = value.resumeNodeId ?? value.entryNodeId
    if (target) await readNode(value, target, token, 'restore')
  }

  const openPicker = async (): Promise<void> => {
    cancelSearch(true)
    const oldSession = session.value
    const { token, operationId } = start()
    try {
      await flushReadingPosition()
      const result = await window.electron.books.openPicker()
      if (!current(token)) {
        if (result.ok) await window.electron.books.closeSession(result.value.sessionId)
        return
      }
      if (!result.ok) {
        if (result.error.code !== 'cancelled') error.value = result.error
        return
      }
      await enterSession(result.value, token, oldSession)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const openLibrary = async (libraryId: string): Promise<void> => {
    cancelSearch(true)
    const oldSession = session.value
    const { token, operationId } = start()
    try {
      await flushReadingPosition()
      const result = await window.electron.books.openLibrary(libraryId)
      if (!current(token)) {
        if (result.ok) await window.electron.books.closeSession(result.value.sessionId)
        return
      }
      if (!result.ok) {
        error.value = result.error
        return
      }
      await enterSession(result.value, token, oldSession)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const openNode = async (nodeId: string, fragmentOverride?: string | null): Promise<void> => {
    if (refreshInFlight) await refreshInFlight
    await flushReadingPosition()
    const sessionSnapshot = session.value
    if (!sessionSnapshot) return
    const { token, operationId } = start()
    try {
      await readNode(sessionSnapshot, nodeId, token, 'explicit', fragmentOverride)
    } finally {
      finish(operationId)
    }
  }

  const activateNode = async (node: BookReaderNodeDto): Promise<void> => {
    if (node.type === 'chapter') return openNode(node.nodeId)
    if (node.type === 'group' && node.landingNodeId) return openNode(node.landingNodeId)
    if (node.type !== 'external' || !session.value) return
    await flushReadingPosition()
    const sessionSnapshot = session.value
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.followLink(
        sessionSnapshot.sessionId,
        node.nodeId,
        '#'
      )
      if (current(token) && !result.ok) error.value = result.error
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const followLink = async (href: string): Promise<void> => {
    await flushReadingPosition()
    const sessionSnapshot = session.value
    const chapterSnapshot = chapter.value
    if (!sessionSnapshot || !chapterSnapshot) return
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.followLink(
        sessionSnapshot.sessionId,
        chapterSnapshot.nodeId,
        href
      )
      if (!current(token) || session.value?.sessionId !== sessionSnapshot.sessionId) return
      if (!result.ok) {
        error.value = result.error
        return
      }
      if (result.value) {
        await readNode(
          sessionSnapshot,
          result.value.nodeId,
          token,
          'explicit',
          result.value.fragment
        )
      }
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const saveReadingPosition = async (chapterProgress: number): Promise<void> => {
    reportReadingPosition(chapterProgress)
    await flushReadingPosition()
  }

  const performRefresh = async (): Promise<void> => {
    cancelSearch(true)
    await flushReadingPosition()
    const sessionSnapshot = session.value
    if (!sessionSnapshot) return
    const priorNodeId = chapter.value?.nodeId ?? null
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.refresh(sessionSnapshot.sessionId)
      if (!current(token) || session.value?.sessionId !== sessionSnapshot.sessionId) return
      if (!result.ok) {
        error.value = result.error
        return
      }
      session.value = result.value
      chapter.value = null
      const readable = new Set(
        flattenReadableNodeIds(result.value.nodes, result.value.landingNodeId)
      )
      const target =
        priorNodeId && readable.has(priorNodeId)
          ? priorNodeId
          : (result.value.resumeNodeId ?? result.value.entryNodeId)
      if (target) await readNode(result.value, target, token, 'restore')
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }
  const refresh = async (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight
    const refreshOperation = performRefresh()
    refreshInFlight = refreshOperation
    try {
      await refreshOperation
    } finally {
      if (refreshInFlight === refreshOperation) refreshInFlight = null
    }
  }

  const removeLibrary = async (libraryId: string): Promise<void> => {
    const modeSnapshot = mode.value
    const sessionIdSnapshot = session.value?.sessionId ?? null
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.remove(libraryId)
      if (!current(token)) return
      if (!result.ok) error.value = result.error
      const listed = await window.electron.books.list()
      if (
        current(token) &&
        mode.value === modeSnapshot &&
        (session.value?.sessionId ?? null) === sessionIdSnapshot
      ) {
        libraries.value = listed
      }
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const previous = async (): Promise<void> => {
    if (previousNodeId.value) await openNode(previousNodeId.value)
  }
  const next = async (): Promise<void> => {
    if (nextNodeId.value) await openNode(nextNodeId.value)
  }
  const editCurrentChapter = async (): Promise<void> => {
    await cancelSearch(true)
    await flushReadingPosition()
    const sessionSnapshot = session.value
    const chapterSnapshot = chapter.value
    if (!sessionSnapshot || !chapterSnapshot) return
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.beginEdit(
        sessionSnapshot.sessionId,
        chapterSnapshot.nodeId
      )
      if (!current(token) || session.value?.sessionId !== sessionSnapshot.sessionId) {
        if (result.ok) await window.electron.books.closeEdit(result.value.editId)
        return
      }
      if (!result.ok) {
        error.value = result.error
        return
      }
      mode.value = 'editor'
      bus.emit('lb::open-book-edit', result.value)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }
  const returnToBook = async (): Promise<void> => {
    if (!session.value) return
    const canReturn = await new Promise<boolean>((resolve) => {
      bus.emit('lb::prepare-return-to-book', resolve)
    })
    if (!canReturn || !session.value) return
    await refresh()
    if (!error.value && session.value) mode.value = 'reader'
  }
  const showEditor = async (): Promise<void> => {
    cancelSearch(true)
    await flushReadingPosition()
    const { token, operationId } = start()
    const oldSession = session.value
    mode.value = 'editor'
    session.value = null
    chapter.value = null
    try {
      if (oldSession) await window.electron.books.closeSession(oldSession.sessionId)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const openSearchResult = async (
    result: BookSearchResultDto,
    fragment: string | null
  ): Promise<void> => {
    await flushReadingPosition()
    await cancelSearch(false)
    await openNode(result.nodeId, fragment)
  }

  return {
    mode,
    libraries,
    session,
    chapter,
    loading,
    error,
    searchQuery,
    searchResults,
    searchLoading,
    searchProgress,
    searchIndexStatus,
    searchTotalResults,
    searchTruncated,
    searchError,
    readingPositionReady,
    previousNodeId,
    nextNodeId,
    loadBookshelf,
    showBookshelf,
    openPicker,
    openLibrary,
    openNode,
    activateNode,
    followLink,
    reportReadingPosition,
    beginReadingPositionRestore,
    completeReadingPositionRestore,
    cancelReadingPositionRestore,
    flushReadingPosition,
    registerReadingPositionProvider,
    scheduleSearch,
    cancelSearch,
    handleSearchProgress,
    openSearchResult,
    saveReadingPosition,
    refresh,
    removeLibrary,
    previous,
    next,
    editCurrentChapter,
    returnToBook,
    showEditor
  }
})
