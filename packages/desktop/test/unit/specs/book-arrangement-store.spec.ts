/* eslint-disable @stylistic/space-before-function-paren */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  BookArrangementDto,
  BookExportSaveDto,
  BookExportSnapshotDto,
  BookWebsiteSaveDto,
  BookWebsiteSnapshotDto,
  BookReaderResult,
  BookSessionDto
} from '@shared/types/bookReader'
import { useBooksStore } from '@/store/books'
import bus from '@/bus'
import {
  bookEditDecision,
  disposeAllBookEditDecisions,
  resolveBookEditDecision
} from '@/services/bookEditDecision'

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let complete!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}

const session = (title = 'Book'): BookSessionDto => ({
  libraryId: 'library-id-0001',
  sessionId: 'session-id-00001',
  title,
  navigationSource: 'summary',
  nodes: [
    { nodeId: 'chapter-node-0001', type: 'chapter', title: 'One', children: [] },
    { nodeId: 'chapter-node-0002', type: 'chapter', title: 'Two', children: [] }
  ],
  entryNodeId: 'chapter-node-0001',
  landingNodeId: null,
  resumeNodeId: 'chapter-node-0001',
  readingProgress: 0,
  diagnostics: []
})

const arrangement = (dirty = false): BookArrangementDto => ({
  arrangementId: 'arrangement-id-0001',
  sessionId: 'session-id-00001',
  revision: 'a'.repeat(64),
  candidateRevision: dirty ? 'b'.repeat(64) : 'a'.repeat(64),
  nodes: [
    {
      nodeId: 'summary-node-0001',
      kind: 'heading',
      title: 'Part',
      depth: 0,
      canIndent: false,
      canOutdent: false,
      children: [
        {
          nodeId: 'summary-node-0002',
          kind: 'list',
          title: 'One',
          depth: 1,
          canIndent: false,
          canOutdent: false,
          children: []
        },
        {
          nodeId: 'summary-node-0003',
          kind: 'list',
          title: 'Two',
          depth: 1,
          canIndent: true,
          canOutdent: false,
          children: []
        }
      ]
    }
  ],
  dirty,
  canUndo: dirty,
  preview: { operationCount: dirty ? 1 : 0, byteLength: 64 }
})

const exportSnapshot = (): BookExportSnapshotDto => ({
  exportId: 'export-id-00000001',
  title: 'Book',
  nodes: [],
  landingNodeId: null,
  navigationTargets: {},
  documents: []
})

const websiteSnapshot = (): BookWebsiteSnapshotDto => {
  const { exportId: _exportId, ...value } = exportSnapshot()
  return { websiteId: 'website-id-000001', ...value }
}

const allowBookGuard = (payload: unknown): void => {
  ;(payload as (allowed: boolean) => void)(true)
}

beforeEach(() => {
  setActivePinia(createPinia())
  bus.on('lb::prepare-return-to-book', allowBookGuard)
})

afterEach(() => {
  bus.off('lb::prepare-return-to-book', allowBookGuard)
  disposeAllBookEditDecisions()
})

describe('book arrangement renderer store', () => {
  it('rejects website generation at the dirty guard without dispatching begin', async () => {
    bus.off('lb::prepare-return-to-book', allowBookGuard)
    const rejectGuard = (payload: unknown): void => {
      ;(payload as (allowed: boolean) => void)(false)
    }
    bus.on('lb::prepare-return-to-book', rejectGuard)
    const beginWebsite = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginWebsite } }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    await store.generateWebsite()
    expect(beginWebsite).not.toHaveBeenCalled()
    expect(store.websitePending).toBe(false)
    bus.off('lb::prepare-return-to-book', rejectGuard)
  })

  it('cancels website generation and disposes a late native-dialog lease', async () => {
    const pending = deferred<BookReaderResult<BookWebsiteSnapshotDto>>()
    const beginWebsite = vi.fn(() => pending.promise)
    const cancelWebsite = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginWebsite, cancelWebsite } }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    const generating = store.generateWebsite()
    await vi.waitFor(() => expect(beginWebsite).toHaveBeenCalledTimes(1))
    await store.cancelWebsite()
    expect(store.websitePending).toBe(true)
    pending.resolve({ ok: true, value: websiteSnapshot() })
    await generating
    expect(cancelWebsite).toHaveBeenCalledWith('website-id-000001')
    expect(store.websitePending).toBe(false)
    expect(store.websiteSuccess).toBeNull()
  })

  it('reports a late committed website accurately and excludes 8B while 8C is pending', async () => {
    const pendingCommit = deferred<BookReaderResult<BookWebsiteSaveDto>>()
    const beginExport = vi.fn()
    const cancelWebsite = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginWebsite: vi.fn().mockResolvedValue({ ok: true, value: websiteSnapshot() }),
          commitWebsite: vi.fn(() => pendingCommit.promise),
          cancelWebsite,
          beginExport
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    const generating = store.generateWebsite()
    await vi.waitFor(() => expect(window.electron.books.commitWebsite).toHaveBeenCalledTimes(1))
    await store.exportBook()
    expect(beginExport).not.toHaveBeenCalled()
    await store.cancelWebsite()
    pendingCommit.resolve({
      ok: false,
      error: {
        code: 'website-commit-uncertain',
        message: 'The directory may be committed.',
        committed: true
      }
    })
    await generating
    expect(cancelWebsite).toHaveBeenCalledWith('website-id-000001')
    expect(store.websiteSuccess).toContain('may have committed before cancellation')
    expect(store.websitePending).toBe(false)
  })

  it('rejects export at the dirty guard and never dispatches begin', async () => {
    bus.off('lb::prepare-return-to-book', allowBookGuard)
    const rejectGuard = (payload: unknown): void => {
      ;(payload as (allowed: boolean) => void)(false)
    }
    bus.on('lb::prepare-return-to-book', rejectGuard)
    const beginExport = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginExport } }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    await store.exportBook()
    expect(beginExport).not.toHaveBeenCalled()
    expect(store.exportPending).toBe(false)
    bus.off('lb::prepare-return-to-book', rejectGuard)
  })

  it('cancels a pending export generation and disposes a late begin lease', async () => {
    const pending = deferred<BookReaderResult<BookExportSnapshotDto>>()
    const beginExport = vi.fn(() => pending.promise)
    const cancelExport = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginExport, cancelExport } }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    const exporting = store.exportBook()
    await vi.waitFor(() => expect(beginExport).toHaveBeenCalledTimes(1))
    expect(store.exportPending).toBe(true)
    await store.cancelExport()
    expect(store.exportPending).toBe(true)
    expect(store.exportCancelRequested).toBe(true)
    pending.resolve({ ok: true, value: exportSnapshot() })
    await exporting
    expect(cancelExport).toHaveBeenCalledTimes(1)
    expect(cancelExport).toHaveBeenCalledWith('export-id-00000001')
    expect(store.exportPending).toBe(false)
    expect(store.exportCancelRequested).toBe(false)
    expect(store.exportSuccess).toBeNull()
  })

  it('cancels an admitted commit, ignores its late result and qualifies uncertain durability', async () => {
    const pendingCommit = deferred<BookReaderResult<BookExportSaveDto>>()
    const commitExport = vi.fn(() => pendingCommit.promise)
    const cancelExport = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginExport: vi.fn().mockResolvedValue({ ok: true, value: exportSnapshot() }),
          commitExport,
          cancelExport
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    const exporting = store.exportBook()
    await vi.waitFor(() => expect(commitExport).toHaveBeenCalledTimes(1))
    await store.cancelExport()
    expect(cancelExport).toHaveBeenCalledWith('export-id-00000001')
    expect(store.exportPending).toBe(true)
    pendingCommit.resolve({
      ok: true,
      value: { fileName: 'book.html', byteLength: 10, durabilityUncertain: true }
    })
    await exporting
    expect(store.exportPending).toBe(false)
    expect(store.exportSuccess).toContain('Export completed before cancellation: book.html')
    expect(store.exportSuccess).toContain('storage durability could not be confirmed')

    commitExport.mockResolvedValueOnce({
      ok: true,
      value: { fileName: 'book.html', byteLength: 10, durabilityUncertain: true }
    })
    await store.exportBook()
    expect(store.exportSuccess).toContain('durability could not be confirmed')
  })

  it('reports committed uncertainty that races with cancellation', async () => {
    const pendingCommit = deferred<BookReaderResult<BookExportSaveDto>>()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginExport: vi.fn().mockResolvedValue({ ok: true, value: exportSnapshot() }),
          commitExport: vi.fn(() => pendingCommit.promise),
          cancelExport: vi.fn().mockResolvedValue({ ok: true, value: true })
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    const exporting = store.exportBook()
    await vi.waitFor(() => expect(store.exportPending).toBe(true))
    await vi.waitFor(() => expect(window.electron.books.commitExport).toHaveBeenCalledTimes(1))
    await store.cancelExport()
    pendingCommit.resolve({
      ok: false,
      error: {
        code: 'export-write-failed',
        message: 'Commit identity became uncertain.',
        committed: true
      }
    })
    await exporting
    expect(store.exportSuccess).toContain('may have committed before cancellation')
    expect(store.exportPending).toBe(false)
  })

  it('begins, applies, undoes and cancels through only the arrangement DTO APIs', async () => {
    const beginArrangement = vi.fn().mockResolvedValue({ ok: true, value: arrangement() })
    const applyArrangement = vi.fn().mockResolvedValue({ ok: true, value: arrangement(true) })
    const undoArrangement = vi.fn().mockResolvedValue({ ok: true, value: arrangement() })
    const closeArrangement = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: { beginArrangement, applyArrangement, undoArrangement, closeArrangement }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'

    await store.beginArrangement()
    expect(beginArrangement).toHaveBeenCalledWith('session-id-00001')
    await store.applyArrangement({
      type: 'move-before',
      nodeId: 'summary-node-0003',
      targetNodeId: 'summary-node-0002'
    })
    expect(store.arrangement?.dirty).toBe(true)
    await store.undoArrangement()
    expect(store.arrangement?.dirty).toBe(false)
    await store.closeArrangement()

    expect(closeArrangement).toHaveBeenCalledWith('arrangement-id-0001')
    expect(store.arrangement).toBeNull()
  })

  it('closes a late begin lease and never revives a cancelled generation', async () => {
    const pending = deferred<BookReaderResult<BookArrangementDto>>()
    const beginArrangement = vi.fn(() => pending.promise)
    const closeArrangement = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginArrangement,
          closeArrangement
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'
    const beginning = store.beginArrangement()
    await vi.waitFor(() => expect(beginArrangement).toHaveBeenCalledTimes(1))
    await store.closeArrangement()
    pending.resolve({ ok: true, value: arrangement() })
    await beginning

    expect(store.arrangement).toBeNull()
    expect(store.arrangementPending).toBe(false)
    expect(closeArrangement).toHaveBeenCalledWith('arrangement-id-0001')
  })

  it('lets Edit invalidate a deferred begin and closes its late successful lease', async () => {
    const pending = deferred<BookReaderResult<BookArrangementDto>>()
    const beginArrangement = vi.fn(() => pending.promise)
    const closeArrangement = vi.fn().mockResolvedValue({ ok: true, value: true })
    const beginEdit = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        editId: 'edit-id-00000001',
        sessionId: 'session-id-00001',
        nodeId: 'chapter-node-0001',
        title: 'One',
        markdown: '# One',
        revision: 'c'.repeat(64),
        format: { bom: false, lineEnding: 'lf', mixedLineEndings: false }
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginArrangement,
          closeArrangement,
          beginEdit
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.chapter = {
      nodeId: 'chapter-node-0001',
      title: 'One',
      markdown: '# One',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    store.mode = 'reader'

    const beginning = store.beginArrangement()
    await vi.waitFor(() => expect(beginArrangement).toHaveBeenCalledTimes(1))
    await store.editCurrentChapter()
    expect(store.mode).toBe('editor')
    expect(beginEdit).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, value: arrangement() })
    await beginning

    expect(store.arrangement).toBeNull()
    expect(store.arrangementPending).toBe(false)
    expect(closeArrangement).toHaveBeenCalledWith('arrangement-id-0001')
  })

  it('cancels while the dirty guard is pending without dispatching begin', async () => {
    bus.off('lb::prepare-return-to-book', allowBookGuard)
    let resolveGuard!: (allowed: boolean) => void
    const deferredGuard = (payload: unknown): void => {
      resolveGuard = payload as (allowed: boolean) => void
    }
    bus.on('lb::prepare-return-to-book', deferredGuard)
    const beginArrangement = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginArrangement } }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'

    const beginning = store.beginArrangement()
    await vi.waitFor(() => expect(store.arrangementPending).toBe(true))
    await store.closeArrangement()
    resolveGuard(true)
    await beginning

    expect(beginArrangement).not.toHaveBeenCalled()
    expect(store.arrangement).toBeNull()
    expect(store.arrangementPending).toBe(false)
    bus.off('lb::prepare-return-to-book', deferredGuard)
  })

  it.each(['apply', 'undo', 'save'] as const)(
    'drops a late %s response after the draft generation closes',
    async (operation) => {
      const lateArrangement = deferred<BookReaderResult<BookArrangementDto>>()
      const lateSave = deferred<
        BookReaderResult<{
          arrangementId: string
          revision: string
          session: BookSessionDto | null
          durabilityUncertain: boolean
        }>
      >()
      const applyArrangement = vi.fn(() => lateArrangement.promise)
      const undoArrangement = vi.fn(() => lateArrangement.promise)
      const saveArrangement = vi.fn(() => lateSave.promise)
      const closeArrangement = vi.fn().mockResolvedValue({ ok: true, value: true })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            beginArrangement: vi.fn().mockResolvedValue({ ok: true, value: arrangement(true) }),
            applyArrangement,
            undoArrangement,
            saveArrangement,
            closeArrangement
          }
        }
      })
      const store = useBooksStore()
      store.session = session()
      store.mode = 'reader'
      await store.beginArrangement()
      const pending =
        operation === 'apply'
          ? store.applyArrangement({ type: 'indent', nodeId: 'summary-node-0003' })
          : operation === 'undo'
            ? store.undoArrangement()
            : store.saveArrangement()
      const method =
        operation === 'apply'
          ? applyArrangement
          : operation === 'undo'
            ? undoArrangement
            : saveArrangement
      await vi.waitFor(() => expect(method).toHaveBeenCalledTimes(1))
      await store.closeArrangement()
      if (operation === 'save') {
        lateSave.resolve({
          ok: true,
          value: {
            arrangementId: 'arrangement-id-0001',
            revision: 'b'.repeat(64),
            session: session('Late'),
            durabilityUncertain: false
          }
        })
      } else {
        lateArrangement.resolve({ ok: true, value: arrangement() })
      }
      await pending

      expect(store.arrangement).toBeNull()
      expect(store.arrangementPending).toBe(false)
      expect(store.session?.title).toBe('Book')
    }
  )

  it('uses the one-use conflict token and consumes the refreshed session on save', async () => {
    const refreshed = session('Reordered')
    const saveArrangement = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'arrangement-conflict',
          message: 'SUMMARY changed.',
          overwriteToken: 'overwrite-token-0001'
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          arrangementId: 'arrangement-id-0001',
          revision: 'b'.repeat(64),
          session: refreshed,
          durabilityUncertain: false
        }
      })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginArrangement: vi.fn().mockResolvedValue({ ok: true, value: arrangement(true) }),
          saveArrangement,
          readChapter: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              nodeId: 'chapter-node-0001',
              title: 'One',
              markdown: '# One',
              fragment: null,
              readingPosition: 0.4,
              hasReadingPosition: true
            }
          })
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.chapter = {
      nodeId: 'chapter-node-0001',
      title: 'One',
      markdown: '# One',
      fragment: null,
      readingPosition: 0.4,
      hasReadingPosition: true
    }
    store.mode = 'reader'

    await store.beginArrangement()
    const saving = store.saveArrangement()
    await vi.waitFor(() => expect(bookEditDecision.open).toBe(true))
    resolveBookEditDecision(bookEditDecision.requestId, 'overwrite')
    await saving

    expect(saveArrangement).toHaveBeenNthCalledWith(2, {
      arrangementId: 'arrangement-id-0001',
      revision: 'a'.repeat(64),
      overwriteToken: 'overwrite-token-0001'
    })
    expect(store.arrangement).toBeNull()
    expect(store.arrangementPending).toBe(false)
    expect(store.session?.title).toBe('Reordered')
    expect(store.chapter?.nodeId).toBe('chapter-node-0001')
  })

  it('best-effort closes every fatal save lease before dropping renderer state', async () => {
    const closeArrangement = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'arrangement-not-found', message: 'Already revoked.' }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          beginArrangement: vi.fn().mockResolvedValue({ ok: true, value: arrangement(true) }),
          saveArrangement: vi.fn().mockResolvedValue({
            ok: false,
            error: { code: 'arrangement-read-only', message: 'No longer writable.' }
          }),
          closeArrangement
        }
      }
    })
    const store = useBooksStore()
    store.session = session()
    store.mode = 'reader'

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await store.beginArrangement()
      await store.saveArrangement()
      expect(store.arrangement).toBeNull()
      expect(store.arrangementPending).toBe(false)
      expect(closeArrangement).toHaveBeenCalledTimes(attempt)
      expect(closeArrangement).toHaveBeenLastCalledWith('arrangement-id-0001')
    }
  })

  it('does not dispatch begin for inferred navigation or a rejected dirty guard', async () => {
    bus.off('lb::prepare-return-to-book', allowBookGuard)
    const reject = (payload: unknown): void => {
      ;(payload as (allowed: boolean) => void)(false)
    }
    bus.on('lb::prepare-return-to-book', reject)
    const beginArrangement = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { beginArrangement } }
    })
    const store = useBooksStore()
    store.session = { ...session(), navigationSource: 'inferred' }
    store.mode = 'reader'
    await store.beginArrangement()
    expect(beginArrangement).not.toHaveBeenCalled()

    store.session = session()
    await store.beginArrangement()
    expect(beginArrangement).not.toHaveBeenCalled()
    bus.off('lb::prepare-return-to-book', reject)
  })
})
