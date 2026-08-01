/* eslint-disable @stylistic/indent, @stylistic/space-before-function-paren */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BookPreparationDto, BookReaderResult, BookSessionDto } from '@shared/types/bookReader'
import { useBooksStore } from '@/store/books'
import bus from '@/bus'

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

const inferredSession = (): BookSessionDto => ({
  libraryId: 'library-id-0001',
  sessionId: 'session-id-00001',
  resourceToken: 'resource-token-0001',
  title: 'Book',
  navigationSource: 'inferred',
  nodes: [{ nodeId: 'old-source-node-01', type: 'chapter', title: 'Manuscript', children: [] }],
  entryNodeId: 'old-source-node-01',
  landingNodeId: null,
  resumeNodeId: 'old-source-node-01',
  readingProgress: 0,
  diagnostics: []
})

const alternateSession = (): BookSessionDto => ({
  ...inferredSession(),
  libraryId: 'library-id-0002',
  sessionId: 'session-id-00002',
  title: 'Other book',
  nodes: [{ nodeId: 'other-source-node-1', type: 'chapter', title: 'Other', children: [] }],
  entryNodeId: 'other-source-node-1',
  resumeNodeId: 'other-source-node-1'
})

const prepared = (requiresSelection = false): BookPreparationDto => ({
  preparationId: 'preparation-id-0001',
  sessionId: 'session-id-00001',
  revision: requiresSelection ? null : 'a'.repeat(64),
  sourceNodeId: requiresSelection ? null : 'old-source-node-01',
  sourceTitle: requiresSelection ? null : 'Manuscript',
  candidates: [{ nodeId: 'old-source-node-01', title: 'Manuscript', displayLabel: 'Document 1' }],
  chapters: requiresSelection
    ? []
    : [
        { chapterId: 'chapter-1', ordinal: 1, line: 1, title: 'First', fragment: 'first' },
        { chapterId: 'chapter-2', ordinal: 2, line: 10, title: 'Second', fragment: 'second' }
      ],
  removedChapters: [],
  summaryPreview: requiresSelection ? null : '# Contents\n\n- First\n- Second\n',
  requiresSelection,
  recovery: null,
  draftPersisted: false,
  draftDurabilityUncertain: false,
  draftId: null,
  draftNonce: 0
})

const allow = (payload: unknown): void => (payload as (value: boolean) => void)(true)

beforeEach(() => {
  setActivePinia(createPinia())
  bus.on('lb::prepare-return-to-book', allow)
})

afterEach(() => {
  vi.useRealTimers()
  bus.off('lb::prepare-return-to-book', allow)
})

describe('book preparation renderer store', () => {
  it('flushes every chapter rename in order before moves, Create, and Close', async () => {
    let current = prepared()
    const applyPreparationDraft = vi.fn(
      async (request: {
        nonce: number
        operation: { type: string; chapterId: string; title?: string }
      }) => {
        const chapters = current.chapters.map((chapter) => ({ ...chapter }))
        if (request.operation.type === 'rename') {
          const chapter = chapters.find((item) => item.chapterId === request.operation.chapterId)
          if (chapter) chapter.title = request.operation.title ?? chapter.title
        }
        current = {
          ...current,
          chapters,
          draftPersisted: true,
          draftId: 'draft-id-00000001',
          draftNonce: request.nonce,
          revision: request.nonce.toString(16).padStart(64, '0')
        }
        return { ok: true as const, value: current }
      }
    )
    const commitPreparation = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'preparation-conflict', message: 'Synthetic stop.' }
    })
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { applyPreparationDraft, commitPreparation, closePreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = current

    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-1',
      title: 'First A'
    })
    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-2',
      title: 'Second B'
    })
    await store.flushPreparationDraft()
    expect(applyPreparationDraft.mock.calls.slice(0, 2).map(([request]) => request)).toMatchObject([
      { nonce: 1, operation: { type: 'rename', chapterId: 'chapter-1', title: 'First A' } },
      { nonce: 2, operation: { type: 'rename', chapterId: 'chapter-2', title: 'Second B' } }
    ])

    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-1',
      title: 'First moved'
    })
    await store.schedulePreparationDraft({ type: 'move-down', chapterId: 'chapter-1' })
    expect(applyPreparationDraft.mock.calls.slice(2, 4).map(([request]) => request)).toMatchObject([
      { nonce: 3, operation: { type: 'rename', chapterId: 'chapter-1' } },
      { nonce: 4, operation: { type: 'move-down', chapterId: 'chapter-1' } }
    ])

    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-2',
      title: 'Before create'
    })
    await store.commitPreparation()
    expect(applyPreparationDraft).toHaveBeenCalledTimes(5)
    expect(applyPreparationDraft.mock.invocationCallOrder[4]).toBeLessThan(
      commitPreparation.mock.invocationCallOrder[0]
    )

    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-1',
      title: 'Before close'
    })
    await store.closePreparation()
    expect(applyPreparationDraft).toHaveBeenCalledTimes(6)
    expect(applyPreparationDraft.mock.invocationCallOrder[5]).toBeLessThan(
      closePreparation.mock.invocationCallOrder[0]
    )
  })

  it('stops a rename drain on its first failure, preserves the error, and retries the queue', async () => {
    let current = prepared()
    const draftError = { code: 'preparation-draft-write-failed' as const, message: 'Disk failed.' }
    const applyPreparationDraft = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: draftError })
      .mockImplementation(async (request: { nonce: number }) => {
        current = {
          ...current,
          draftPersisted: true,
          draftId: 'draft-id-00000001',
          draftNonce: request.nonce,
          revision: request.nonce.toString(16).padStart(64, '0')
        }
        return { ok: true as const, value: current }
      })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { applyPreparationDraft } }
    })
    const store = useBooksStore()
    store.preparation = current
    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-1',
      title: 'First queued'
    })
    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-2',
      title: 'Second queued'
    })

    expect(await store.flushPreparationDraft()).toBe(false)
    expect(applyPreparationDraft).toHaveBeenCalledTimes(1)
    expect(store.preparationError).toEqual(draftError)

    expect(await store.flushPreparationDraft()).toBe(true)
    expect(applyPreparationDraft.mock.calls.map(([request]) => request)).toMatchObject([
      { nonce: 1, operation: { chapterId: 'chapter-1' } },
      { nonce: 1, operation: { chapterId: 'chapter-1' } },
      { nonce: 2, operation: { chapterId: 'chapter-2' } }
    ])
  })

  it.each([
    { type: 'move-down' as const, chapterId: 'chapter-1' },
    { type: 'remove' as const, chapterId: 'chapter-2' }
  ])('does not dispatch $type after a queued rename fails', async (operation) => {
    const draftError = { code: 'preparation-draft-write-failed' as const, message: 'Disk failed.' }
    const applyPreparationDraft = vi.fn().mockResolvedValue({ ok: false, error: draftError })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { applyPreparationDraft } }
    })
    const store = useBooksStore()
    store.preparation = prepared()
    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-1',
      title: 'Must persist first'
    })
    expect(await store.schedulePreparationDraft(operation)).toBe(false)
    expect(applyPreparationDraft).toHaveBeenCalledTimes(1)
    expect(applyPreparationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ operation: expect.objectContaining({ type: 'rename' }) })
    )
    expect(store.preparationError).toEqual(draftError)
  })

  it.each(['Create', 'Close'] as const)(
    'keeps preparation open and does not dispatch %s when rename flush fails',
    async (journey) => {
      const draftError = {
        code: 'preparation-draft-write-failed' as const,
        message: 'Disk failed.'
      }
      const applyPreparationDraft = vi.fn().mockResolvedValue({ ok: false, error: draftError })
      const commitPreparation = vi.fn()
      const closePreparation = vi.fn()
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { books: { applyPreparationDraft, commitPreparation, closePreparation } }
      })
      const store = useBooksStore()
      store.session = inferredSession()
      store.mode = 'reader'
      store.preparation = prepared()
      await store.schedulePreparationDraft({
        type: 'rename',
        chapterId: 'chapter-1',
        title: `Before ${journey}`
      })
      if (journey === 'Create') await store.commitPreparation()
      else await store.closePreparation()
      expect(commitPreparation).not.toHaveBeenCalled()
      expect(closePreparation).not.toHaveBeenCalled()
      expect(store.preparation).not.toBeNull()
      expect(store.preparationError).toEqual(draftError)
    }
  )

  it('retains a timer-fired rename while busy and persists it on the next flush', async () => {
    vi.useFakeTimers()
    let current = prepared()
    const applyPreparationDraft = vi.fn(async (request: { nonce: number }) => {
      current = {
        ...current,
        draftPersisted: true,
        draftId: 'draft-id-00000001',
        draftNonce: request.nonce,
        revision: request.nonce.toString(16).padStart(64, '0')
      }
      return { ok: true as const, value: current }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { applyPreparationDraft } }
    })
    const store = useBooksStore()
    store.preparation = current
    store.preparationPending = true
    store.preparationError = { code: 'preparation-conflict', message: 'Keep this error.' }
    await store.schedulePreparationDraft({
      type: 'rename',
      chapterId: 'chapter-1',
      title: 'Queued while busy'
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(applyPreparationDraft).not.toHaveBeenCalled()
    expect(store.preparationError?.message).toBe('Keep this error.')

    store.preparationPending = false
    expect(await store.flushPreparationDraft()).toBe(true)
    expect(applyPreparationDraft).toHaveBeenCalledTimes(1)
  })

  it('stops at the dirty guard without dispatching begin', async () => {
    bus.off('lb::prepare-return-to-book', allow)
    const reject = (payload: unknown): void => (payload as (value: boolean) => void)(false)
    bus.on('lb::prepare-return-to-book', reject)
    const beginPreparation = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginPreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    await store.beginPreparation()
    expect(beginPreparation).not.toHaveBeenCalled()
    expect(store.preparationPending).toBe(false)
    bus.off('lb::prepare-return-to-book', reject)
  })

  it('closes a late successful begin lease after cancel', async () => {
    const late = deferred<BookReaderResult<BookPreparationDto>>()
    const beginPreparation = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginPreparation, closePreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    const beginning = store.beginPreparation()
    await vi.waitFor(() => expect(beginPreparation).toHaveBeenCalledTimes(1))
    await store.closePreparation()
    late.resolve({ ok: true, value: prepared() })
    await beginning
    expect(store.preparation).toBeNull()
    expect(store.preparationPending).toBe(false)
    expect(closePreparation).toHaveBeenCalledWith('preparation-id-0001')
  })

  it('surfaces unexpected begin throws and rejections through the panel-less workspace owner', async () => {
    const beginPreparation = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('synthetic throw')
      })
      .mockRejectedValueOnce(new Error('synthetic rejection'))
      .mockResolvedValueOnce({ ok: true, value: prepared(true) })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginPreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.exportSuccess = 'Old export success.'
    store.websiteSuccess = 'Old website success.'

    await store.beginPreparation()
    expect(store.preparation).toBeNull()
    expect(store.preparationError?.code).toBe('invalid-request')
    expect(store.error?.code).toBe('invalid-request')
    expect(store.exportSuccess).toBeNull()
    expect(store.websiteSuccess).toBeNull()

    await store.beginPreparation()
    expect(store.preparation).toBeNull()
    expect(store.preparationError?.code).toBe('invalid-request')
    expect(store.error?.code).toBe('invalid-request')

    await store.beginPreparation()
    expect(store.preparation).not.toBeNull()
    expect(store.preparationError).toBeNull()
    expect(store.error).toBeNull()
  })

  it('suppresses a begin rejection after the owning reader session changes', async () => {
    const late = deferred<BookReaderResult<BookPreparationDto>>()
    const beginPreparation = vi.fn(() => late.promise)
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginPreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    const beginning = store.beginPreparation()
    await vi.waitFor(() => expect(beginPreparation).toHaveBeenCalledTimes(1))
    store.session = alternateSession()
    late.resolve(Promise.reject(new Error('late synthetic rejection')) as never)
    await beginning
    expect(store.preparation).toBeNull()
    expect(store.preparationError).toBeNull()
    expect(store.error).toBeNull()
  })

  it('selects an opaque candidate and blocks export while preview is open', async () => {
    const beginExport = vi.fn()
    const selectPreparationSource = vi.fn().mockResolvedValue({ ok: true, value: prepared() })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { selectPreparationSource, beginExport } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared(true)
    await store.selectPreparationSource('old-source-node-01')
    expect(selectPreparationSource).toHaveBeenCalledWith(
      'preparation-id-0001',
      'old-source-node-01'
    )
    expect(store.preparation?.chapters).toHaveLength(2)
    await store.exportBook()
    expect(beginExport).not.toHaveBeenCalled()
  })

  it('scopes away stale reader errors when a new preparation operation starts', async () => {
    const beginPreparation = vi.fn().mockResolvedValue({ ok: true, value: prepared(true) })
    const selectPreparationSource = vi.fn().mockResolvedValue({ ok: true, value: prepared() })
    const commitPreparation = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        preparationId: 'preparation-id-0001',
        sourceNodeId: 'old-source-node-01',
        session: null,
        committed: true,
        durabilityUncertain: false
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: { beginPreparation, selectPreparationSource, commitPreparation }
      }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'

    store.error = { code: 'book-unavailable', message: 'Stale reader error.' }
    await store.beginPreparation()
    expect(store.error).toBeNull()

    store.error = { code: 'book-unavailable', message: 'Another stale reader error.' }
    store.exportSuccess = 'Stale export success.'
    store.websiteSuccess = 'Stale website success.'
    await store.selectPreparationSource('old-source-node-01')
    expect(store.error).toBeNull()
    expect(store.exportSuccess).toBeNull()
    expect(store.websiteSuccess).toBeNull()

    store.error = { code: 'book-unavailable', message: 'Third stale reader error.' }
    store.exportSuccess = 'Another stale export success.'
    store.websiteSuccess = 'Another stale website success.'
    await store.commitPreparation()
    expect(store.error).toBeNull()
    expect(store.exportSuccess).toBeNull()
    expect(store.websiteSuccess).toBeNull()
    expect(store.preparation).toBeNull()
    expect(store.preparationStatus).toContain('Arrange mode is now available')
  })

  it('gives export and website starts exclusive ownership of ordinary live success state', async () => {
    const beginExport = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'cancelled', message: 'Cancelled.' }
    })
    const beginWebsite = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'cancelled', message: 'Cancelled.' }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginExport, beginWebsite } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'

    store.preparationStatus = 'Old preparation success.'
    store.websiteSuccess = 'Old website success.'
    await store.exportBook()
    expect(store.preparationStatus).toBeNull()
    expect(store.websiteSuccess).toBeNull()
    expect(store.exportSuccess).toBeNull()

    store.preparationStatus = 'Another preparation success.'
    store.exportSuccess = 'Old export success.'
    await store.generateWebsite()
    expect(store.preparationStatus).toBeNull()
    expect(store.exportSuccess).toBeNull()
    expect(store.websiteSuccess).toBeNull()
  })

  it('closes a select lease again when its response arrives after cancellation', async () => {
    const late = deferred<BookReaderResult<BookPreparationDto>>()
    const selectPreparationSource = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { selectPreparationSource, closePreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared(true)
    const selecting = store.selectPreparationSource('old-source-node-01')
    await vi.waitFor(() => expect(selectPreparationSource).toHaveBeenCalledTimes(1))
    await store.closePreparation()
    late.resolve({ ok: true, value: prepared() })
    await selecting
    expect(store.preparation).toBeNull()
    expect(store.preparationPending).toBe(false)
    expect(closePreparation).toHaveBeenCalledTimes(2)
    expect(closePreparation).toHaveBeenLastCalledWith('preparation-id-0001')
  })

  it('closes a commit lease again and truthfully reports a late durable commit', async () => {
    const late = deferred<
      BookReaderResult<{
        preparationId: string
        sourceNodeId: string | null
        session: BookSessionDto | null
        committed: true
        durabilityUncertain: boolean
      }>
    >()
    const commitPreparation = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { commitPreparation, closePreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    const committing = store.commitPreparation()
    await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))
    await store.closePreparation()
    late.resolve({
      ok: true,
      value: {
        preparationId: 'preparation-id-0001',
        sourceNodeId: null,
        session: null,
        committed: true,
        durabilityUncertain: false
      }
    })
    await committing
    expect(store.preparation).toBeNull()
    expect(store.preparationPending).toBe(false)
    expect(closePreparation).toHaveBeenCalledTimes(2)
    expect(store.preparationStatus).toBe('SUMMARY was created after preparation closed.')
  })

  it('truthfully reports a late committed error only in its original reader session', async () => {
    const late = deferred<
      BookReaderResult<{
        preparationId: string
        sourceNodeId: string | null
        session: BookSessionDto | null
        committed: true
        durabilityUncertain: boolean
      }>
    >()
    const commitPreparation = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { commitPreparation, closePreparation } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    const committing = store.commitPreparation()
    await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))
    await store.closePreparation()
    late.resolve({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'The original book may contain SUMMARY.',
        committed: true
      }
    })
    await committing
    expect(commitPreparation).toHaveBeenCalledTimes(1)
    expect(store.error).toMatchObject({
      code: 'preparation-commit-uncertain',
      committed: true
    })
    expect(store.preparationStatus).toContain('refresh before preparing again')
    expect(store.preparationRetryBlocked).toBe(true)
  })

  it.each([
    ['chapter navigation', 'success'],
    ['chapter navigation', 'committed-error'],
    ['search-result navigation', 'committed-error'],
    ['refresh', 'committed-error']
  ] as const)(
    'does not let an old commit overwrite reader state after %s with %s',
    async (journey, outcome) => {
      const late = deferred<
        BookReaderResult<{
          preparationId: string
          sourceNodeId: string | null
          session: BookSessionDto | null
          committed: true
          durabilityUncertain: boolean
        }>
      >()
      const commitPreparation = vi.fn(() => late.promise)
      const beginPreparation = vi.fn()
      const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
      const readChapter = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          nodeId: 'old-source-node-01',
          title: 'Manuscript',
          markdown: '# Current reader state',
          fragment: null,
          readingPosition: 0,
          hasReadingPosition: false
        }
      })
      const refresh = vi.fn().mockResolvedValue({ ok: true, value: inferredSession() })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            commitPreparation,
            beginPreparation,
            closePreparation,
            readChapter,
            refresh
          }
        }
      })
      const store = useBooksStore()
      store.session = inferredSession()
      store.mode = 'reader'
      store.preparation = prepared()
      const committing = store.commitPreparation()
      await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))
      await store.closePreparation()

      if (journey === 'chapter navigation') {
        await store.openNode('old-source-node-01')
      } else if (journey === 'search-result navigation') {
        await store.openSearchResult(
          {
            nodeId: 'old-source-node-01',
            title: 'Manuscript',
            breadcrumbs: [],
            matches: []
          },
          null
        )
      } else {
        await store.refresh()
      }
      expect(store.chapter?.markdown).toBe('# Current reader state')

      late.resolve(
        outcome === 'success'
          ? {
              ok: true,
              value: {
                preparationId: 'preparation-id-0001',
                sourceNodeId: null,
                session: null,
                committed: true,
                durabilityUncertain: false
              }
            }
          : {
              ok: false,
              error: {
                code: 'preparation-commit-uncertain',
                message: 'An old reader request may contain SUMMARY.',
                committed: true
              }
            }
      )
      await committing
      expect(store.chapter?.markdown).toBe('# Current reader state')
      expect(store.error).toBeNull()
      expect(store.preparationStatus).toBeNull()
      expect(store.preparationError).toBeNull()
      const retryMustRemainBlocked = outcome === 'committed-error' && journey !== 'refresh'
      expect(store.preparationRetryBlocked).toBe(retryMustRemainBlocked)
      await store.beginPreparation()
      expect(beginPreparation).toHaveBeenCalledTimes(retryMustRemainBlocked ? 0 : 1)
    }
  )

  it('blocks Arrange and both output paths while preparation is open', async () => {
    const beginArrangement = vi.fn()
    const beginExport = vi.fn()
    const beginWebsite = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginArrangement, beginExport, beginWebsite } }
    })
    const store = useBooksStore()
    store.session = { ...inferredSession(), navigationSource: 'summary' }
    store.mode = 'reader'
    store.preparation = prepared()
    await store.beginArrangement()
    await store.exportBook()
    await store.generateWebsite()
    expect(beginArrangement).not.toHaveBeenCalled()
    expect(beginExport).not.toHaveBeenCalled()
    expect(beginWebsite).not.toHaveBeenCalled()
  })

  it('consumes the returned summary session, clears search, and opens the source fragment', async () => {
    const summarySession: BookSessionDto = {
      ...inferredSession(),
      navigationSource: 'summary',
      nodes: [
        { nodeId: 'new-first-node-001', type: 'chapter', title: 'First', children: [] },
        { nodeId: 'new-second-node-01', type: 'chapter', title: 'Second', children: [] }
      ],
      entryNodeId: 'new-first-node-001',
      resumeNodeId: 'new-first-node-001'
    }
    const commitPreparation = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        preparationId: 'preparation-id-0001',
        sourceNodeId: 'new-first-node-001',
        session: summarySession,
        committed: true,
        durabilityUncertain: true
      }
    })
    const readChapter = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        nodeId: 'new-first-node-001',
        title: 'First',
        markdown: '# First\n# Second',
        fragment: 'first',
        readingPosition: 0,
        hasReadingPosition: false
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { commitPreparation, readChapter } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    store.searchQuery = 'old query'
    await store.commitPreparation()
    expect(store.session?.navigationSource).toBe('summary')
    expect(store.preparation).toBeNull()
    expect(store.preparationPending).toBe(false)
    expect(store.searchQuery).toBe('')
    expect(readChapter).toHaveBeenCalledWith('session-id-00001', 'new-first-node-001')
    expect(store.chapter?.fragment).toBe('first')
    expect(store.preparationStatus).toContain('durable storage')
  })

  it('does not retry or revive a committed-uncertain response', async () => {
    const beginPreparation = vi.fn()
    const beginArrangement = vi.fn()
    const beginExport = vi.fn()
    const beginWebsite = vi.fn()
    const search = vi.fn()
    const beginEdit = vi.fn()
    const readChapter = vi.fn()
    const followLink = vi.fn()
    const saveReadingPosition = vi.fn()
    const commitPreparation = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'Committed uncertain.',
        committed: true
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          commitPreparation,
          beginPreparation,
          beginArrangement,
          beginExport,
          beginWebsite,
          search,
          beginEdit,
          readChapter,
          followLink,
          saveReadingPosition
        }
      }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    await store.commitPreparation()
    expect(commitPreparation).toHaveBeenCalledTimes(1)
    expect(store.preparation).toBeNull()
    expect(store.preparationPending).toBe(false)
    expect(store.error?.committed).toBe(true)
    expect(store.preparationRetryBlocked).toBe(true)
    expect(store.preparationStatus).toContain('refresh before preparing again')
    await store.beginPreparation()
    expect(beginPreparation).not.toHaveBeenCalled()
    await store.exportBook()
    await store.generateWebsite()
    store.scheduleSearch('chapter')
    await store.editCurrentChapter()
    await store.openNode('old-source-node-01')
    await store.openSearchResult(
      {
        nodeId: 'old-source-node-01',
        title: 'Manuscript',
        breadcrumbs: [],
        matches: []
      },
      null
    )
    await store.followLink('#first')
    await store.saveReadingPosition(0.5)
    await store.activateNode({
      nodeId: 'external-node-0001',
      type: 'external',
      title: 'External',
      children: []
    })
    store.session = {
      ...inferredSession(),
      navigationSource: 'summary',
      nodes: [
        { nodeId: 'first-source-node-1', type: 'chapter', title: 'First', children: [] },
        { nodeId: 'second-source-node1', type: 'chapter', title: 'Second', children: [] }
      ],
      entryNodeId: 'first-source-node-1',
      resumeNodeId: 'first-source-node-1'
    }
    store.chapter = {
      nodeId: 'first-source-node-1',
      title: 'First',
      markdown: '# First',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    await store.beginArrangement()
    await store.previous()
    await store.next()
    expect(beginExport).not.toHaveBeenCalled()
    expect(beginWebsite).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
    expect(beginEdit).not.toHaveBeenCalled()
    expect(readChapter).not.toHaveBeenCalled()
    expect(followLink).not.toHaveBeenCalled()
    expect(saveReadingPosition).not.toHaveBeenCalled()
    expect(beginArrangement).not.toHaveBeenCalled()
    expect(store.error?.committed).toBe(true)
    expect(store.preparationStatus).toContain('refresh before preparing again')
    expect(store.preparationRetryBlocked).toBe(true)
    expect(store.error?.committed).toBe(true)
    expect(store.preparationStatus).toContain('refresh before preparing again')
  })

  it('clears preparation messages when leaving for the bookshelf or opening another book', async () => {
    const nextSession = alternateSession()
    const list = vi.fn().mockResolvedValue([])
    const openLibrary = vi.fn().mockResolvedValue({ ok: true, value: nextSession })
    const openPicker = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'cancelled', message: 'Cancelled.' }
    })
    const closeSession = vi.fn().mockResolvedValue({ ok: true, value: true })
    const readChapter = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        nodeId: 'other-source-node-1',
        title: 'Other',
        markdown: '# Other',
        fragment: null,
        readingPosition: 0,
        hasReadingPosition: false
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { list, openLibrary, openPicker, closeSession, readChapter } }
    })
    const store = useBooksStore()
    store.mode = 'reader'
    store.preparationStatus = 'Old book succeeded.'
    store.preparationError = {
      code: 'preparation-source-changed',
      message: 'Old book failed.'
    }

    await store.showBookshelf()
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()

    store.preparationStatus = 'Another old status.'
    store.preparationError = {
      code: 'preparation-conflict',
      message: 'Another old error.'
    }
    await store.openLibrary(nextSession.libraryId)
    expect(store.session?.sessionId).toBe(nextSession.sessionId)
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()

    store.preparationStatus = 'Reader status.'
    store.preparationError = { code: 'preparation-conflict', message: 'Reader error.' }
    await store.showEditor()
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()

    store.preparationStatus = 'Status before picker.'
    store.preparationError = { code: 'preparation-conflict', message: 'Error before picker.' }
    await store.openPicker()
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()
  })

  it('keeps committed-uncertain retry blocking and guidance after a cancelled picker', async () => {
    const beginPreparation = vi.fn()
    const commitPreparation = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'Committed uncertain.',
        committed: true
      }
    })
    const openPicker = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'cancelled', message: 'Cancelled.' }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginPreparation, commitPreparation, openPicker } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    await store.commitPreparation()
    await store.openPicker()
    expect(store.session?.sessionId).toBe('session-id-00001')
    expect(store.preparationRetryBlocked).toBe(true)
    expect(store.preparationStatus).toContain('refresh before preparing again')
    await store.beginPreparation()
    expect(beginPreparation).not.toHaveBeenCalled()
  })

  it.each(['inferred', 'summary'] as const)(
    'clears committed-uncertain blocking after refresh recomputes an %s session',
    async (navigationSource) => {
      const refreshed = { ...inferredSession(), navigationSource }
      const commitPreparation = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'preparation-commit-uncertain',
          message: 'Committed uncertain.',
          committed: true
        }
      })
      const refresh = vi.fn().mockResolvedValue({ ok: true, value: refreshed })
      const readChapter = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          nodeId: 'old-source-node-01',
          title: 'Manuscript',
          markdown: '# Refreshed',
          fragment: null,
          readingPosition: 0,
          hasReadingPosition: false
        }
      })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { books: { commitPreparation, refresh, readChapter } }
      })
      const store = useBooksStore()
      store.session = inferredSession()
      store.mode = 'reader'
      store.preparation = prepared()
      await store.commitPreparation()
      expect(store.preparationRetryBlocked).toBe(true)
      await store.refresh()
      expect(store.session?.navigationSource).toBe(navigationSource)
      expect(store.preparationRetryBlocked).toBe(false)
      expect(store.preparationStatus).toBeNull()
      expect(store.preparationError).toBeNull()
    }
  )

  it('retains committed-uncertain blocking when authoritative refresh fails', async () => {
    const commitPreparation = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'Committed uncertain.',
        committed: true
      }
    })
    const refresh = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'book-unavailable', message: 'Refresh failed.' }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { commitPreparation, refresh } }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    await store.commitPreparation()
    expect(store.preparationRetryBlocked).toBe(true)
    await store.refresh()
    expect(store.preparationRetryBlocked).toBe(true)
    expect(store.preparationStatus).toContain('refresh before preparing again')
    expect(store.error?.code).toBe('book-unavailable')
  })

  it('does not repopulate preparation messages when an old commit resolves after a book switch', async () => {
    const late = deferred<
      BookReaderResult<{
        preparationId: string
        sourceNodeId: string | null
        session: BookSessionDto | null
        committed: true
        durabilityUncertain: boolean
      }>
    >()
    const nextSession = alternateSession()
    const commitPreparation = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    const closeSession = vi.fn().mockResolvedValue({ ok: true, value: true })
    const openLibrary = vi.fn().mockResolvedValue({ ok: true, value: nextSession })
    const readChapter = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        nodeId: 'other-source-node-1',
        title: 'Other',
        markdown: '# Other',
        fragment: null,
        readingPosition: 0,
        hasReadingPosition: false
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          commitPreparation,
          closePreparation,
          closeSession,
          openLibrary,
          readChapter
        }
      }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    const committing = store.commitPreparation()
    await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))

    await store.openLibrary(nextSession.libraryId)
    expect(store.session?.sessionId).toBe(nextSession.sessionId)
    late.resolve({
      ok: true,
      value: {
        preparationId: 'preparation-id-0001',
        sourceNodeId: null,
        session: null,
        committed: true,
        durabilityUncertain: false
      }
    })
    await committing
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()
    expect(store.session?.sessionId).toBe(nextSession.sessionId)
  })

  it('does not show a delayed committed error after opening another book', async () => {
    const late = deferred<
      BookReaderResult<{
        preparationId: string
        sourceNodeId: string | null
        session: BookSessionDto | null
        committed: true
        durabilityUncertain: boolean
      }>
    >()
    const nextSession = {
      ...alternateSession(),
      entryNodeId: null,
      resumeNodeId: null
    }
    const commitPreparation = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    const closeSession = vi.fn().mockResolvedValue({ ok: true, value: true })
    const openLibrary = vi.fn().mockResolvedValue({ ok: true, value: nextSession })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: { commitPreparation, closePreparation, closeSession, openLibrary }
      }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    const committing = store.commitPreparation()
    await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))
    await store.openLibrary(nextSession.libraryId)
    late.resolve({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'The old book may contain SUMMARY.',
        committed: true
      }
    })
    await committing
    expect(store.session?.sessionId).toBe(nextSession.sessionId)
    expect(store.error).toBeNull()
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()
    expect(store.preparationRetryBlocked).toBe(false)
  })

  it('does not show a delayed committed error after returning to the bookshelf', async () => {
    const late = deferred<
      BookReaderResult<{
        preparationId: string
        sourceNodeId: string | null
        session: BookSessionDto | null
        committed: true
        durabilityUncertain: boolean
      }>
    >()
    const commitPreparation = vi.fn(() => late.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    const closeSession = vi.fn().mockResolvedValue({ ok: true, value: true })
    const list = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: { commitPreparation, closePreparation, closeSession, list }
      }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    const committing = store.commitPreparation()
    await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))
    await store.showBookshelf()
    late.resolve({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'The shelved book may contain SUMMARY.',
        committed: true
      }
    })
    await committing
    expect(store.mode).toBe('bookshelf')
    expect(store.error).toBeNull()
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()
    expect(store.preparationRetryBlocked).toBe(false)
  })

  it('does not show an older committed error over a newer preparation generation', async () => {
    const lateCommit = deferred<
      BookReaderResult<{
        preparationId: string
        sourceNodeId: string | null
        session: BookSessionDto | null
        committed: true
        durabilityUncertain: boolean
      }>
    >()
    const lateBegin = deferred<BookReaderResult<BookPreparationDto>>()
    const commitPreparation = vi.fn(() => lateCommit.promise)
    const beginPreparation = vi.fn(() => lateBegin.promise)
    const closePreparation = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          commitPreparation,
          beginPreparation,
          closePreparation
        }
      }
    })
    const store = useBooksStore()
    store.session = inferredSession()
    store.mode = 'reader'
    store.preparation = prepared()
    const committing = store.commitPreparation()
    await vi.waitFor(() => expect(commitPreparation).toHaveBeenCalledTimes(1))
    await store.closePreparation()
    const beginning = store.beginPreparation()
    await vi.waitFor(() => expect(beginPreparation).toHaveBeenCalledTimes(1))
    lateCommit.resolve({
      ok: false,
      error: {
        code: 'preparation-commit-uncertain',
        message: 'An older generation may contain SUMMARY.',
        committed: true
      }
    })
    await committing
    expect(store.error).toBeNull()
    expect(store.preparationStatus).toBeNull()

    await store.closePreparation()
    lateBegin.resolve({ ok: true, value: prepared() })
    await beginning
    expect(store.mode).toBe('reader')
    expect(store.error).toBeNull()
    expect(store.preparationStatus).toBeNull()
    expect(store.preparationError).toBeNull()
  })
})
