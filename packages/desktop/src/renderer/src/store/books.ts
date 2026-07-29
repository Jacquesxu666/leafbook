/* eslint-disable @stylistic/space-before-function-paren */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BookChapterDto,
  BookReaderError,
  BookReaderNodeDto,
  BookshelfEntryDto,
  BookSessionDto
} from '@shared/types/bookReader'
import { adjacentChapter, flattenReadableNodeIds } from '@/book/readerModel'

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

  const previousNodeId = computed(() =>
    session.value ? adjacentChapter(session.value.nodes, chapter.value?.nodeId ?? null, -1) : null
  )
  const nextNodeId = computed(() =>
    session.value ? adjacentChapter(session.value.nodes, chapter.value?.nodeId ?? null, 1) : null
  )

  const readNode = async (
    sessionSnapshot: BookSessionDto,
    nodeId: string,
    token: number,
    fragmentOverride?: string | null
  ): Promise<void> => {
    try {
      const result = await window.electron.books.readChapter(sessionSnapshot.sessionId, nodeId)
      if (!current(token) || session.value?.sessionId !== sessionSnapshot.sessionId) return
      if (!result.ok) {
        error.value = result.error
        return
      }
      chapter.value =
        fragmentOverride === undefined
          ? result.value
          : { ...result.value, fragment: fragmentOverride }
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

  const enterSession = async (value: BookSessionDto, token: number): Promise<void> => {
    if (!current(token)) return
    session.value = value
    chapter.value = null
    mode.value = 'reader'
    if (value.entryNodeId) await readNode(value, value.entryNodeId, token)
  }

  const openPicker = async (): Promise<void> => {
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.openPicker()
      if (!current(token)) {
        if (result.ok) await window.electron.books.closeSession(result.value.sessionId)
        return
      }
      if (!result.ok) {
        if (result.error.code !== 'cancelled') error.value = result.error
        return
      }
      await enterSession(result.value, token)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const openLibrary = async (libraryId: string): Promise<void> => {
    const { token, operationId } = start()
    try {
      const result = await window.electron.books.openLibrary(libraryId)
      if (!current(token)) {
        if (result.ok) await window.electron.books.closeSession(result.value.sessionId)
        return
      }
      if (!result.ok) {
        error.value = result.error
        return
      }
      await enterSession(result.value, token)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const openNode = async (nodeId: string, fragmentOverride?: string | null): Promise<void> => {
    if (refreshInFlight) await refreshInFlight
    const sessionSnapshot = session.value
    if (!sessionSnapshot) return
    const { token, operationId } = start()
    try {
      await readNode(sessionSnapshot, nodeId, token, fragmentOverride)
    } finally {
      finish(operationId)
    }
  }

  const activateNode = async (node: BookReaderNodeDto): Promise<void> => {
    if (node.type === 'chapter') return openNode(node.nodeId)
    if (node.type === 'group' && node.landingNodeId) return openNode(node.landingNodeId)
    if (node.type !== 'external' || !session.value) return
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
        await readNode(sessionSnapshot, result.value.nodeId, token, result.value.fragment)
      }
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }

  const performRefresh = async (): Promise<void> => {
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
      const readable = new Set(flattenReadableNodeIds(result.value.nodes))
      if (result.value.landingNodeId) readable.add(result.value.landingNodeId)
      const target =
        priorNodeId && readable.has(priorNodeId) ? priorNodeId : result.value.entryNodeId
      if (target) await readNode(result.value, target, token)
    } catch {
      setUnexpected(token)
    } finally {
      finish(operationId)
    }
  }
  const refresh = async (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight
    const operation = performRefresh()
    refreshInFlight = operation
    try {
      await operation
    } finally {
      if (refreshInFlight === operation) refreshInFlight = null
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
  const showEditor = async (): Promise<void> => {
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

  return {
    mode,
    libraries,
    session,
    chapter,
    loading,
    error,
    previousNodeId,
    nextNodeId,
    loadBookshelf,
    showBookshelf,
    openPicker,
    openLibrary,
    openNode,
    activateNode,
    followLink,
    refresh,
    removeLibrary,
    previous,
    next,
    showEditor
  }
})
