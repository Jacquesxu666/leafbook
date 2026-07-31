/* eslint-disable @stylistic/space-before-function-paren, vue/one-component-per-file */
import { createApp, defineComponent, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BookChapterDto,
  BookReaderResult,
  BookResourceDto,
  BookSessionDto
} from '@shared/types/bookReader'

let booksStore: ReturnType<typeof makeBooksStore>

vi.mock('@/store/books', () => ({
  useBooksStore: () => booksStore
}))
vi.mock('@/book/restoreReadingPosition', () => ({
  waitForPaint: async () => undefined,
  restoreReadingPosition: async (options: {
    render: () => Promise<unknown>
    isCurrent: () => boolean
    mount: (result: unknown) => void
    waitForMount: () => Promise<void>
    complete: (ratio: number) => void
    release: () => void
    fail: () => void
  }) => {
    try {
      const result = await options.render()
      if (!options.isCurrent()) return options.release()
      options.mount(result)
      await options.waitForMount()
      if (!options.isCurrent()) return options.release()
      options.complete(0)
    } catch {
      options.fail()
    }
  }
}))
vi.mock('@/components/bookWorkspace/BookTreeNode.vue', () => ({
  default: defineComponent({ template: '<div />' })
}))
vi.mock('@/components/bookWorkspace/BookSearchPanel.vue', () => ({
  default: defineComponent({ template: '<div />' })
}))
vi.mock('@/components/bookWorkspace/BookArrangementPanel.vue', () => ({
  default: defineComponent({ template: '<div />' })
}))
vi.mock('@/components/bookWorkspace/BookPreparationPanel.vue', () => ({
  default: defineComponent({ template: '<div />' })
}))

import BookWorkspace from '@/components/bookWorkspace/index.vue'

const makeSession = (resourceToken: string): BookSessionDto => ({
  libraryId: 'library-1',
  sessionId: 'session-1',
  resourceToken,
  title: 'Lifecycle book',
  navigationSource: 'summary',
  nodes: [],
  entryNodeId: null,
  landingNodeId: null,
  resumeNodeId: null,
  readingProgress: 0,
  diagnostics: []
})
const makeChapter = (nodeId: string, reference: string): BookChapterDto => ({
  nodeId,
  title: nodeId,
  markdown: `# ${nodeId}\n\n![${nodeId}](${reference})`,
  fragment: null,
  readingPosition: 0,
  hasReadingPosition: false
})
const makeBooksStore = () =>
  reactive({
    mode: 'reader' as 'reader' | 'bookshelf' | 'editor',
    session: makeSession('token-1') as BookSessionDto | null,
    chapter: makeChapter('node-1', 'one.png') as BookChapterDto | null,
    libraries: [],
    error: null,
    loading: false,
    refreshing: false,
    arrangementPending: false,
    arrangement: null,
    arrangementError: null,
    preparationPending: false,
    preparation: null,
    preparationError: null,
    preparationStatus: null,
    preparationRetryBlocked: false,
    outputPending: false,
    exportPending: false,
    exportCancelRequested: false,
    exportSuccess: null,
    websitePending: false,
    websiteCancelRequested: false,
    websiteSuccess: null,
    searchQuery: '',
    searchResults: [],
    searchLoading: false,
    searchProgress: null,
    searchIndexStatus: null,
    searchTotalResults: 0,
    searchTruncated: false,
    searchError: null,
    readingPositionReady: true,
    previousNodeId: null,
    nextNodeId: null,
    beginReadingPositionRestore: vi.fn(() => 1),
    cancelReadingPositionRestore: vi.fn(),
    completeReadingPositionRestore: vi.fn(),
    registerReadingPositionProvider: vi.fn(() => () => undefined),
    reportReadingPosition: vi.fn(),
    flushReadingPosition: vi.fn(async () => undefined),
    clearTransientOperationFeedback: vi.fn(),
    handleSearchProgress: vi.fn(),
    closeArrangement: vi.fn(async () => undefined),
    closePreparation: vi.fn(async () => undefined),
    cancelExport: vi.fn(async () => undefined),
    cancelWebsite: vi.fn(async () => undefined),
    cancelSearch: vi.fn(async () => undefined),
    showBookshelf: vi.fn(async () => undefined),
    showEditor: vi.fn(),
    openPicker: vi.fn(),
    openLibrary: vi.fn(),
    removeLibrary: vi.fn(),
    beginArrangement: vi.fn(),
    beginPreparation: vi.fn(),
    commitPreparation: vi.fn(),
    exportBook: vi.fn(),
    generateWebsite: vi.fn(),
    refresh: vi.fn(),
    followLink: vi.fn(),
    activateNode: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
    openSearchResult: vi.fn()
  })

const resource = (): BookReaderResult<BookResourceDto> => ({
  ok: true,
  value: {
    mediaType: 'image/png',
    byteLength: 1,
    width: 1,
    height: 1,
    frameCount: 1,
    decodePixels: 1,
    bytes: new Uint8Array([1])
  }
})
const deferred = <T>() => {
  let resolveValue!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

let host: HTMLElement
let app: ReturnType<typeof createApp> | null
const createObjectUrl = vi.fn<() => string>()
const revokeObjectUrl = vi.fn<(url: string) => void>()

beforeEach(() => {
  booksStore = makeBooksStore()
  host = document.createElement('div')
  document.body.append(host)
  app = null
  let index = 0
  createObjectUrl.mockReset()
  createObjectUrl.mockImplementation(() => `blob:workspace-${++index}`)
  revokeObjectUrl.mockReset()
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false })
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  app?.unmount()
  host.remove()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'electron')
})

describe('compiled BookWorkspace image lifecycle', () => {
  it('does not re-read a burned one-shot reference on an unrelated component re-render', async () => {
    const readResource = vi.fn(async () => resource())
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          readResource,
          onSearchProgress: () => () => undefined
        }
      }
    })
    app = createApp(BookWorkspace)
    const instance = app.mount(host)
    await vi.waitFor(() => expect(readResource).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLImageElement>('article img')?.src).toBe('blob:workspace-1')
    )

    instance.$forceUpdate()
    await nextTick()

    expect(readResource).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLImageElement>('article img')?.src).toBe('blob:workspace-1')
    expect(revokeObjectUrl).not.toHaveBeenCalled()
  })

  it('revokes on chapter/token/refresh/exit/unmount and never reassigns a stale response', async () => {
    const stale = deferred<BookReaderResult<BookResourceDto>>()
    const readResource = vi.fn(async ({ reference }: { reference: string }) =>
      reference === 'one.png' ? stale.promise : resource()
    )
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          readResource,
          onSearchProgress: () => () => undefined
        }
      }
    })
    app = createApp(BookWorkspace)
    app.mount(host)
    await vi.waitFor(() =>
      expect(readResource).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'one.png', resourceToken: 'token-1' })
      )
    )

    booksStore.chapter = makeChapter('node-2', 'two.png')
    booksStore.session = makeSession('token-2')
    await nextTick()
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLImageElement>('article img')?.src).toBe('blob:workspace-1')
    )
    stale.resolve(resource())
    await Promise.resolve()
    expect(createObjectUrl).toHaveBeenCalledOnce()

    booksStore.refreshing = true
    await nextTick()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workspace-1')
    booksStore.refreshing = false
    booksStore.chapter = makeChapter('node-3', 'three.png')
    booksStore.session = makeSession('token-3')
    await nextTick()
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLImageElement>('article img')?.src).toBe('blob:workspace-2')
    )

    booksStore.mode = 'bookshelf'
    await nextTick()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workspace-2')
    booksStore.mode = 'reader'
    booksStore.chapter = makeChapter('node-4', 'four.png')
    booksStore.session = makeSession('token-4')
    await nextTick()
    await vi.waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(3))
    app.unmount()
    app = null
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workspace-3')
  })
})
