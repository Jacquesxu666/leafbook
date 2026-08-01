/* eslint-disable @stylistic/space-before-function-paren */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BookEditDto, BookEditSaveDto, BookReaderResult } from '@shared/types/bookReader'

const closeMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

// `@/store/editor` reads `window.path` at module load and `window.electron`
// at runtime; stub those surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          invoke: (...a: unknown[]) => Promise<unknown>
        }
        books?: {
          saveEdit: (request: unknown) => Promise<unknown>
          reloadEdit: (editId: string) => Promise<unknown>
          closeEdit: (editId: string) => Promise<unknown>
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: {
      send: () => {},
      on: (...args: unknown[]) => {
        const [channel, handler] = args
        if (typeof channel === 'string' && typeof handler === 'function') {
          closeMocks.handlers.set(channel, handler as (...values: unknown[]) => unknown)
        }
      },
      invoke: async () => true
    },
    books: {
      saveEdit: vi.fn(async () => ({
        ok: true,
        value: {
          editId: 'edit-id-00000001',
          revision: 'b'.repeat(64),
          markdown: 'hello world!',
          format: { bom: false, lineEnding: 'lf', mixedLineEndings: false },
          session: null,
          nodeId: 'node-id-00000001',
          readOnly: false
        }
      })),
      reloadEdit: vi.fn(),
      closeEdit: vi.fn(async () => ({ ok: true, value: true }))
    }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/services/bookEditDecision', () => ({
  requestBookEditDecision: vi.fn(async () => 'save'),
  disposeBookEditDecisions: vi.fn()
}))

import { useEditorStore } from '@/store/editor'
import bus from '@/bus'
import notice from '@/services/notification'
import { requestBookEditDecision } from '@/services/bookEditDecision'

// #3803: the store snapshots `currentFile.markdown` (refreshed only on the
// engine's deferred rAF `json-change`) to send to the main process. A keystroke
// typed in the same frame as Cmd+S was therefore dropped from the saved file.
// The save/move/rename paths now emit `flush-active-editor` first, which the
// editor synchronously commits into `currentFile.markdown` before it is read.
//
// The bug lives at the `const { …, markdown } = this.currentFile` READ, which
// sits between the flush and the send — so an emit-order assertion (flush < send)
// alone would still pass if a regression moved the flush past the read. These
// tests instead wire a real `flush-active-editor` listener that commits the
// pending keystroke (mirroring editor.vue → `editor.flush()` → `json-change` →
// LISTEN_FOR_CONTENT_CHANGE) and assert the SENT PAYLOAD carries it: a flush
// moved after the read would send the stale snapshot and fail here.

const STALE = 'hello' // what the pre-flush snapshot holds
const FLUSHED = 'hello world!' // the last keystroke the editor commits on flush
const MARKDOWN_ARG = 4 // send(channel, id, filename, pathname, markdown, …)

function seedCurrentFile(
  store: ReturnType<typeof useEditorStore>,
  overrides: Record<string, unknown> = {}
) {
  store.currentFile = {
    id: 'tab-1',
    filename: 'note.md',
    pathname: '/tmp/note.md',
    markdown: STALE,
    isSaved: false,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2,
    ...overrides
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Mirror editor.vue's listener: commit the pending keystroke into the store on
// flush. Returns a detach fn (the bus is a module singleton — listeners leak
// across tests otherwise).
function onFlushCommit(store: ReturnType<typeof useEditorStore>) {
  const handler = () => {
    if (store.currentFile) store.currentFile.markdown = FLUSHED
  }
  bus.on('flush-active-editor', handler)
  return () => bus.off('flush-active-editor', handler)
}

// Global invocation order of a given emitted event, located by event name (not
// array position) so an unrelated earlier emit can't mask a moved flush.
function emitOrderOf(emitSpy: ReturnType<typeof vi.spyOn>, event: string): number | undefined {
  const i = emitSpy.mock.calls.findIndex((c: unknown[]) => c[0] === event)
  return i === -1 ? undefined : emitSpy.mock.invocationCallOrder[i]
}

describe('editor store — flush pending edits before saving (#3803)', () => {
  let detach: (() => void) | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    closeMocks.handlers.clear()
    vi.mocked(notice.notify).mockResolvedValue()
  })

  afterEach(() => {
    detach?.()
    detach = undefined
  })

  it('FILE_SAVE sends the flushed markdown, not the stale pre-flush snapshot', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('routes book-backed Cmd/Ctrl+S through saveEdit without the ordinary file channel', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-00000001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')
    const saveEdit = vi.spyOn(window.electron.books, 'saveEdit')

    store.FILE_SAVE()
    await vi.waitFor(() => expect(saveEdit).toHaveBeenCalledOnce())

    expect(saveEdit).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: FLUSHED, editId: 'edit-id-00000001' })
    )
    expect(sendSpy).not.toHaveBeenCalledWith('mt::response-file-save', expect.anything())
  })

  it('rebinds an existing book tab to the newly authorized lease after public refresh', () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-old-0001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: true
      }
    })
    const tab = store.currentFile
    if (!tab) return
    store.tabs = [tab]

    store.OPEN_BOOK_EDIT({
      editId: 'edit-id-new-0001',
      sessionId: 'session-id-0001',
      nodeId: 'node-id-00000001',
      title: 'Chapter',
      markdown: '# Fresh authorization\n',
      revision: 'b'.repeat(64),
      format: { bom: false, lineEnding: 'lf', mixedLineEndings: false }
    })

    expect(store.currentFile).toBe(tab)
    expect(tab.markdown).toBe('# Fresh authorization\n')
    expect(tab.bookEdit).toMatchObject({
      editId: 'edit-id-new-0001',
      revision: 'b'.repeat(64),
      readOnly: false
    })
    expect(window.electron.books.closeEdit).toHaveBeenCalledWith('edit-id-old-0001')
    expect(window.electron.books.closeEdit).not.toHaveBeenCalledWith('edit-id-new-0001')
  })

  it('does not route Save As for a book-backed tab', () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-00000001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      }
    })
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE_AS()

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('resolves a dirty book tab before window close and never sends it to path-based save', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-00000001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const file = store.currentFile
    expect(file).not.toBeNull()
    if (!file) return
    store.tabs = [file]
    store.LISTEN_FOR_CLOSE()
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    await closeMocks.handlers.get('mt::ask-for-close')?.()

    expect(sendSpy).toHaveBeenCalledWith('mt::close-window')
    expect(sendSpy.mock.calls.map((call) => call[0])).not.toContain('mt::close-window-confirm')
    expect(sendSpy.mock.calls.map((call) => call[0])).not.toContain('mt::save-tabs')
    expect(sendSpy.mock.calls.map((call) => call[0])).not.toContain('mt::save-and-close-tabs')
  })

  it('keeps a dirty book tab open when its requested save fails', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-00000001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const file = store.currentFile
    expect(file).not.toBeNull()
    if (!file) return
    store.tabs = [file]
    vi.mocked(window.electron.books.saveEdit).mockResolvedValueOnce({
      ok: false,
      error: { code: 'edit-write-failed', message: 'failed safely' }
    })

    store.CLOSE_UNSAVED_TAB(file)
    await vi.waitFor(() => expect(window.electron.books.saveEdit).toHaveBeenCalled())

    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile?.isSaved).toBe(false)
    expect(window.electron.books.closeEdit).not.toHaveBeenCalled()
  })

  it('FILE_SAVE_AS sends the flushed markdown, not the stale pre-flush snapshot', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE_AS()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save-as')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  // MOVE_FILE_TO / RESPONSE_FOR_RENAME only transmit `markdown` in their untitled
  // (no-pathname) branch, which reuses `mt::response-file-save` — that is where
  // the flush actually matters, so assert the payload there too.
  it('MOVE_FILE_TO (untitled) sends the flushed markdown', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '' })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.MOVE_FILE_TO()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('RESPONSE_FOR_RENAME (untitled) sends the flushed markdown', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '' })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.RESPONSE_FOR_RENAME()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  // The existing-file rename branch emits 'rename' (no markdown payload); guard
  // that the flush still precedes it so it can't be silently dropped later.
  it('RESPONSE_FOR_RENAME (existing file) flushes before emitting rename', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '/tmp/note.md' })
    const emitSpy = vi.spyOn(bus, 'emit')

    store.RESPONSE_FOR_RENAME()

    const flushOrder = emitOrderOf(emitSpy, 'flush-active-editor')
    const renameOrder = emitOrderOf(emitSpy, 'rename')
    expect(flushOrder).toBeDefined()
    expect(renameOrder).toBeDefined()
    expect(flushOrder as number).toBeLessThan(renameOrder as number)
  })

  it('single-flights book saves and keeps input typed while the save is pending dirty', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-race-0001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const tab = store.currentFile
    if (!tab?.bookEdit) return
    const edit = tab.bookEdit
    store.tabs = [tab]
    store.updateTabIdToIndex()
    let resolveSave!: (value: BookReaderResult<BookEditSaveDto>) => void
    vi.mocked(window.electron.books.saveEdit).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSave = resolve))
    )

    const first = store.SAVE_BOOK_EDIT(tab)
    const duplicate = store.SAVE_BOOK_EDIT(tab)
    expect(window.electron.books.saveEdit).toHaveBeenCalledOnce()
    store.LISTEN_FOR_CONTENT_CHANGE({
      id: tab.id,
      markdown: 'typed during save',
      history: tab.history
    })
    resolveSave({
      ok: true,
      value: {
        editId: edit.editId,
        revision: 'b'.repeat(64),
        markdown: STALE,
        format: { bom: false, lineEnding: 'lf', mixedLineEndings: false },
        session: null,
        nodeId: edit.nodeId,
        readOnly: false,
        durabilityUncertain: false
      }
    })
    await Promise.all([first, duplicate])

    expect(tab.markdown).toBe('typed during save')
    expect(edit.revision).toBe('b'.repeat(64))
    expect(tab.isSaved).toBe(false)
  })

  it('does not let a pending reload overwrite newer editor input', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-race-0002',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const tab = store.currentFile
    if (!tab?.bookEdit) return
    const edit = tab.bookEdit
    store.tabs = [tab]
    store.updateTabIdToIndex()
    let resolveReload!: (value: BookReaderResult<BookEditDto>) => void
    vi.mocked(window.electron.books.reloadEdit).mockImplementationOnce(
      () => new Promise((resolve) => (resolveReload = resolve))
    )

    const reload = store.RELOAD_BOOK_EDIT(tab)
    store.LISTEN_FOR_CONTENT_CHANGE({
      id: tab.id,
      markdown: 'typed during reload',
      history: tab.history
    })
    resolveReload({
      ok: true,
      value: {
        editId: edit.editId,
        sessionId: edit.sessionId,
        nodeId: edit.nodeId,
        title: 'Chapter',
        markdown: 'external content',
        revision: 'c'.repeat(64),
        format: { bom: false, lineEnding: 'lf', mixedLineEndings: false }
      }
    })

    await expect(reload).resolves.toBe(false)
    expect(tab.markdown).toBe('typed during reload')
    expect(edit.revision).toBe('a'.repeat(64))
  })

  it('waits for an in-flight book save without issuing a duplicate save', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-guard-0001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const tab = store.currentFile
    if (!tab?.bookEdit) return
    store.tabs = [tab]
    let resolveSave!: (value: BookReaderResult<BookEditSaveDto>) => void
    vi.mocked(window.electron.books.saveEdit).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSave = resolve))
    )

    const pending = store.SAVE_BOOK_EDIT(tab)
    const guard = store.PREPARE_RETURN_TO_BOOK()
    expect(window.electron.books.saveEdit).toHaveBeenCalledOnce()
    resolveSave({
      ok: true,
      value: {
        editId: tab.bookEdit.editId,
        revision: 'b'.repeat(64),
        markdown: tab.markdown,
        format: { bom: false, lineEnding: 'lf', mixedLineEndings: false },
        session: null,
        nodeId: tab.bookEdit.nodeId,
        readOnly: false,
        durabilityUncertain: false
      }
    })

    await pending
    await expect(guard).resolves.toBe(true)
    expect(window.electron.books.saveEdit).toHaveBeenCalledOnce()
    expect(requestBookEditDecision).not.toHaveBeenCalled()
  })

  it('treats a post-commit durability warning as saved and surfaces it', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-uncertain-0001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const tab = store.currentFile
    if (!tab?.bookEdit) return
    store.tabs = [tab]
    vi.mocked(window.electron.books.saveEdit).mockResolvedValueOnce({
      ok: true,
      value: {
        editId: tab.bookEdit.editId,
        revision: 'b'.repeat(64),
        markdown: tab.markdown,
        format: { bom: false, lineEnding: 'lf', mixedLineEndings: false },
        session: null,
        nodeId: tab.bookEdit.nodeId,
        readOnly: false,
        durabilityUncertain: true
      }
    })

    await store.SAVE_BOOK_EDIT(tab)

    expect(tab.isSaved).toBe(true)
    expect(notice.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Chapter saved with uncertain durability', type: 'warning' })
    )
  })

  it('keeps an unverified committed save dirty and revokes further editing', async () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'edit-id-unverified-0001',
        sessionId: 'session-id-0001',
        nodeId: 'node-id-00000001',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      },
      history: { stack: [], index: -1, lastEditIndex: -1, lastInitIndex: -1 }
    })
    const tab = store.currentFile
    if (!tab?.bookEdit) return
    store.tabs = [tab]
    vi.mocked(window.electron.books.saveEdit).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'edit-commit-uncertain',
        message: 'Committed bytes could not be verified.',
        committed: true
      }
    })

    await store.SAVE_BOOK_EDIT(tab)
    await store.SAVE_BOOK_EDIT(tab)

    expect(tab.isSaved).toBe(false)
    expect(tab.bookEdit.readOnly).toBe(true)
    expect(window.electron.books.saveEdit).toHaveBeenCalledOnce()
  })

  it('excludes book edit tabs and their opaque lease metadata from buffered state', () => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      id: 'book-tab',
      pathname: '',
      tabKind: 'book',
      bookEdit: {
        editId: 'secret-edit-id',
        sessionId: 'secret-session-id',
        nodeId: 'secret-node-id',
        revision: 'a'.repeat(64),
        mixedLineEndings: false,
        readOnly: false
      }
    })
    const book = store.currentFile
    if (!book) return
    const file = { ...book, id: 'file-tab', tabKind: 'file' as const, bookEdit: undefined }
    store.tabs = [book, file]
    store.currentFile = book

    const buffered = store.CREATE_BUFFERED_STATE()
    expect(buffered?.tabs).toHaveLength(1)
    expect(buffered?.tabs[0]?.id).toBe('file-tab')
    expect(buffered?.currentFileId).toBe('file-tab')
    expect(JSON.stringify(buffered)).not.toContain('secret-edit-id')
  })
})
