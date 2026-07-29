/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  BookReaderNodeDto,
  BookReaderResult,
  BookshelfEntryDto,
  BookSessionDto
} from '@shared/types/bookReader'
import { adjacentChapter, flattenReadableNodeIds } from '@/book/readerModel'
import { renderBookMarkdown } from '@/book/renderMarkdown'
import { useBooksStore } from '@/store/books'

const mocks = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
  selectedPath: '',
  openedExternal: vi.fn()
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    private state: Record<string, unknown>
    constructor(options: { cwd?: string; name?: string; defaults?: Record<string, unknown> }) {
      const key = `${options.cwd ?? ''}/${options.name ?? ''}`
      if (!mocks.stores.has(key)) mocks.stores.set(key, structuredClone(options.defaults ?? {}))
      this.state = mocks.stores.get(key) ?? {}
    }

    get(key: string): unknown {
      return this.state[key]
    }

    set(key: string, value: unknown): void {
      this.state[key] = structuredClone(value)
    }
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showOpenDialog: async () => ({
      canceled: !mocks.selectedPath,
      filePaths: mocks.selectedPath ? [mocks.selectedPath] : []
    })
  },
  shell: { openExternal: mocks.openedExternal }
}))

import { BookSessionManager } from 'main_renderer/book/sessionManager'
import { loadBookFromDirectory } from 'main_renderer/book/filesystem'

const temporaryDirectories: string[] = []
const deferredValue = <T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} => {
  let complete!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}
const makeBook = async (files: Record<string, string>): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-reader-'))
  temporaryDirectories.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return root
}

beforeEach(() => {
  mocks.stores.clear()
  mocks.selectedPath = ''
  mocks.openedExternal.mockReset()
})
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe('BookSessionManager authorization boundary', () => {
  it('keeps roots out of DTOs and reads only model-owned opaque nodes', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n- [Next](guide/next.md)\n',
      'README.md': '# Start\nHello\n\n[Next](guide/next.md#Next)',
      'guide/next.md': '# Next\nWorld\n\n[Back](../README.md)'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/test-user-data')
    const opened = await manager.openPicker({ sender: {} } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const serialized = JSON.stringify(opened.value)
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain('README.md')
    expect(opened.value.sessionId).toMatch(/^[a-zA-Z0-9-]+$/)

    const firstNode = opened.value.nodes[0]
    expect(firstNode).toBeDefined()
    if (!firstNode) return
    const chapter = await manager.readChapter(opened.value.sessionId, firstNode.nodeId)
    expect(chapter).toMatchObject({
      ok: true,
      value: { title: 'Start' }
    })
    const followed = await manager.followLink(
      opened.value.sessionId,
      firstNode.nodeId,
      'guide/next.md#Next'
    )
    expect(followed).toMatchObject({
      ok: true,
      value: { fragment: 'Next' }
    })
    expect(
      await manager.followLink(opened.value.sessionId, firstNode.nodeId, '#bad%00fragment')
    ).toMatchObject({ ok: false, error: { code: 'unsafe-link' } })
    for (const href of [
      '/../README.md',
      '%2F..%2FREADME.md',
      'C:/../x.md',
      ' /../README.md ',
      ' %2F..%2FREADME.md ',
      '%20%2F..%2FREADME.md%20',
      ' C:/../README.md ',
      '%09C%3A%2F..%2FREADME.md%09',
      ' \\\\server\\README.md '
    ]) {
      expect(
        await manager.followLink(opened.value.sessionId, firstNode.nodeId, href)
      ).toMatchObject({ ok: false, error: { code: 'unsafe-link' } })
    }
    expect(await manager.readChapter(opened.value.sessionId, 'not-a-valid-node')).toMatchObject({
      ok: false,
      error: { code: 'node-not-found' }
    })
    expect(manager.closeSession(opened.value.sessionId)).toEqual({ ok: true, value: true })
    expect(await manager.readChapter(opened.value.sessionId, firstNode.nodeId)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
  })

  it('persists, reopens and removes a bookshelf entry without deleting the folder', async () => {
    const root = await makeBook({ 'README.md': '# Persistent book' })
    mocks.selectedPath = root
    const first = new BookSessionManager('/persistent-user-data')
    const opened = await first.openPicker({ sender: {} } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const second = new BookSessionManager('/persistent-user-data')
    const listed = await second.listLibraries()
    expect(listed).toMatchObject([
      { libraryId: opened.value.libraryId, title: 'Persistent book', available: true }
    ])
    expect((await second.openLibrary(opened.value.libraryId)).ok).toBe(true)
    expect(await second.removeLibrary(opened.value.libraryId)).toEqual({ ok: true, value: true })
    expect(await second.listLibraries()).toEqual([])
    expect((await fs.stat(root)).isDirectory()).toBe(true)
  })

  it('opens only stored safe external nodes and rejects executable chapter links', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n- [Website](https://example.com/docs)\n',
      'README.md': '# Start\n[bad](javascript:alert(1))'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/links-user-data')
    const opened = await manager.openPicker({ sender: {} } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const [chapter, external] = opened.value.nodes
    expect(chapter).toBeDefined()
    expect(external).toBeDefined()
    if (!chapter || !external) return
    expect(
      await manager.followLink(opened.value.sessionId, chapter.nodeId, 'javascript:alert(1)')
    ).toMatchObject({ ok: false, error: { code: 'unsafe-link' } })
    expect(await manager.followLink(opened.value.sessionId, external.nodeId, '#')).toEqual({
      ok: true,
      value: null
    })
    expect(mocks.openedExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('binds sessions to one renderer owner and clears them when that owner is destroyed', async () => {
    const root = await makeBook({ 'README.md': '# Private' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/owner-user-data')
    const opened = await manager.openPicker({ sender: { id: 41 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return

    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 42)
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 41)
    ).toMatchObject({ ok: true })
    manager.cleanupOwner(41)
    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 41)
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it.each(['close', 'remove', 'cleanup'] as const)(
    'rejects a deferred chapter read after session %s revocation',
    async (revocation) => {
      const root = await makeBook({ 'README.md': '# Revoked read' })
      mocks.selectedPath = root
      const pendingRead = deferredValue<{ content: string } | null>()
      const readChapter = vi.fn(() => pendingRead.promise)
      const manager = new BookSessionManager(
        `/read-${revocation}-user-data`,
        loadBookFromDirectory,
        readChapter
      )
      const opened = await manager.openPicker({ sender: { id: 51 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.entryNodeId) return

      const reading = manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 51)
      await vi.waitFor(() => expect(readChapter).toHaveBeenCalledOnce())
      if (revocation === 'close') {
        expect(manager.closeSession(opened.value.sessionId, 51)).toMatchObject({ ok: true })
      } else if (revocation === 'remove') {
        expect(await manager.removeLibrary(opened.value.libraryId)).toMatchObject({ ok: true })
      } else {
        manager.cleanupOwner(51)
      }
      pendingRead.resolve({ content: '# Late content' })
      expect(await reading).toMatchObject({
        ok: false,
        error: { code: 'session-not-found' }
      })
    }
  )

  it('does not open an external link after its owner is cleaned up during validation', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Website](https://example.com/docs)\n',
      'README.md': '# Home'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/revoked-link-user-data')
    const opened = await manager.openPicker({ sender: { id: 61 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.nodes[0]) return

    const following = manager.followLink(
      opened.value.sessionId,
      opened.value.nodes[0].nodeId,
      '#',
      61
    )
    manager.cleanupOwner(61)
    expect(await following).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(mocks.openedExternal).not.toHaveBeenCalled()
  })

  it('does not register a session when owner cleanup wins a deferred open', async () => {
    const root = await makeBook({ 'README.md': '# Deferred open' })
    const scanned = await loadBookFromDirectory(root)
    const pendingLoad = deferredValue<typeof scanned>()
    const loader = vi.fn(() => pendingLoad.promise)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/revoked-open-user-data', loader)

    const opening = manager.openPicker({ sender: { id: 71 } } as never)
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
    manager.cleanupOwner(71)
    pendingLoad.resolve(scanned)
    expect(await opening).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(await manager.listLibraries()).toEqual([])
  })

  it('invalidates a session when its authorized root is replaced at the same path', async () => {
    const root = await makeBook({ 'README.md': '# Original' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/root-identity-user-data')
    const opened = await manager.openPicker({ sender: {} } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return

    const moved = `${root}-moved`
    temporaryDirectories.push(moved)
    await fs.rename(root, moved)
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'README.md'), '# Replacement')
    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId)
    ).toMatchObject({ ok: false, error: { code: 'book-unavailable' } })
    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId)
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it.skipIf(process.platform === 'win32')(
    'invalidates a session when its authorized root path becomes a symlink',
    async () => {
      const root = await makeBook({ 'README.md': '# Original' })
      mocks.selectedPath = root
      const manager = new BookSessionManager('/root-symlink-user-data')
      const opened = await manager.openPicker({ sender: {} } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.entryNodeId) return

      const moved = `${root}-symlink-target`
      temporaryDirectories.push(moved)
      await fs.rename(root, moved)
      await fs.symlink(moved, root, 'dir')
      expect(await manager.refresh(opened.value.sessionId)).toMatchObject({
        ok: false,
        error: { code: 'book-unavailable' }
      })
    }
  )

  it('does not duplicate a README landing already present in the contents', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Home](README.md)\n- [Next](next.md)\n',
      'README.md': '# Home',
      'next.md': '# Next'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/landing-user-data')
    const opened = await manager.openPicker({ sender: {} } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.landingNodeId).toBeNull()
    expect(opened.value.entryNodeId).toBe(opened.value.nodes[0]?.nodeId)
  })

  it('preserves an existing chapter node across refresh', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Home](README.md)\n- [Next](next.md)\n',
      'README.md': '# Home',
      'next.md': '# Next'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/refresh-user-data')
    const opened = await manager.openPicker({ sender: { id: 7 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const nextNodeId = opened.value.nodes[1]?.nodeId
    expect(nextNodeId).toBeDefined()
    const refreshed = await manager.refresh(opened.value.sessionId, 7)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.value.sessionId).toBe(opened.value.sessionId)
    expect(refreshed.value.nodes[1]?.nodeId).toBe(nextNodeId)
  })

  it('shares one in-flight scan between concurrent refresh requests', async () => {
    const root = await makeBook({ 'README.md': '# Single flight' })
    const scanned = await loadBookFromDirectory(root)
    const pendingRefresh = deferredValue<typeof scanned>()
    let loads = 0
    const loader: typeof loadBookFromDirectory = async () => {
      loads++
      return loads === 1 ? scanned : pendingRefresh.promise
    }
    mocks.selectedPath = root
    const manager = new BookSessionManager('/single-flight-user-data', loader)
    const opened = await manager.openPicker({ sender: { id: 7 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const first = manager.refresh(opened.value.sessionId, 7)
    const second = manager.refresh(opened.value.sessionId, 7)
    await vi.waitFor(() => expect(loads).toBe(2))
    pendingRefresh.resolve(scanned)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toMatchObject({ ok: true })
    expect(secondResult).toEqual(firstResult)
    expect(loads).toBe(2)
  })

  it('keeps duplicate targets unique and all model node IDs stable across refresh', async () => {
    const root = await makeBook({
      'SUMMARY.md': `## Part
- [Same](README.md#same)
- [Same again](README.md#same)
`,
      'README.md': '# Home\n\n## Same\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/duplicate-refresh-user-data')
    const opened = await manager.openPicker({ sender: { id: 8 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const group = opened.value.nodes[0]
    const first = group?.children[0]
    const second = group?.children[1]
    expect(group?.type).toBe('group')
    expect(first?.nodeId).toBeDefined()
    expect(second?.nodeId).toBeDefined()
    expect(first?.nodeId).not.toBe(second?.nodeId)
    if (!group || !first || !second) return
    expect(await manager.readChapter(opened.value.sessionId, first.nodeId, 8)).toMatchObject({
      ok: true,
      value: { title: 'Same', fragment: 'same' }
    })
    expect(await manager.readChapter(opened.value.sessionId, second.nodeId, 8)).toMatchObject({
      ok: true,
      value: { title: 'Same again', fragment: 'same' }
    })

    const refreshed = await manager.refresh(opened.value.sessionId, 8)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.value).toMatchObject({
      sessionId: opened.value.sessionId,
      nodes: [
        {
          nodeId: group.nodeId,
          children: [{ nodeId: first.nodeId }, { nodeId: second.nodeId }]
        }
      ]
    })
  })

  it('keeps the previous session usable when refresh scanning fails without changing the root', async () => {
    const root = await makeBook({ 'README.md': '# Still here' })
    mocks.selectedPath = root
    let failScan = false
    const loader: typeof loadBookFromDirectory = async (rootPath, options) => {
      const result = await loadBookFromDirectory(rootPath, options)
      if (!failScan) return result
      return {
        book: result.book,
        diagnostics: [
          {
            code: 'scan-root-error',
            severity: 'error',
            message: 'The book root could not be scanned.'
          }
        ]
      }
    }
    const manager = new BookSessionManager('/failed-refresh-user-data', loader)
    const opened = await manager.openPicker({ sender: { id: 9 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return

    failScan = true
    expect(await manager.refresh(opened.value.sessionId, 9)).toMatchObject({
      ok: false,
      error: { code: 'book-unavailable' }
    })
    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 9)
    ).toMatchObject({ ok: true, value: { title: 'Still here' } })
  })

  it('serializes concurrent shelf open and remove mutations without losing either update', async () => {
    const firstRoot = await makeBook({ 'README.md': '# First' })
    const secondRoot = await makeBook({ 'README.md': '# Second' })
    const manager = new BookSessionManager('/concurrent-shelf-user-data')
    mocks.selectedPath = firstRoot
    const first = await manager.openPicker({ sender: { id: 1 } } as never)
    mocks.selectedPath = secondRoot
    const second = await manager.openPicker({ sender: { id: 2 } } as never)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    await Promise.all([
      manager.openLibrary(first.value.libraryId, 1),
      manager.removeLibrary(second.value.libraryId)
    ])
    const libraries = await manager.listLibraries()
    expect(libraries.map((item) => item.libraryId)).toEqual([first.value.libraryId])
  })
})

describe('reader presentation boundary', () => {
  it('flattens readable navigation in display order for previous and next', () => {
    const nodes: BookReaderNodeDto[] = [
      {
        nodeId: 'group',
        type: 'group',
        title: 'Part',
        landingNodeId: 'landing',
        children: [
          { nodeId: 'one', type: 'chapter', title: 'One', children: [] },
          { nodeId: 'web', type: 'external', title: 'Web', children: [] }
        ]
      },
      { nodeId: 'two', type: 'chapter', title: 'Two', children: [] }
    ]
    expect(flattenReadableNodeIds(nodes)).toEqual(['landing', 'one', 'two'])
    expect(adjacentChapter(nodes, 'one', -1)).toBe('landing')
    expect(adjacentChapter(nodes, 'one', 1)).toBe('two')
    expect(adjacentChapter(nodes, 'two', 1)).toBeNull()
  })

  it('sanitizes active content, disables native links and replaces local media', async () => {
    const result = await renderBookMarkdown(`# Safe

<script>alert(1)</script>

<img src="file:///tmp/secret.png" onerror="alert(1)" alt="cover">

[unsafe](javascript:alert(1))

[chapter](next.md)
`)
    expect(result.html).not.toMatch(/<script|onerror=|file:\/\/|href="javascript:/i)
    expect(result.html).toContain('leafbook-media-placeholder')
    expect(result.html).toContain('data-book-href="next.md"')
    expect(result.html).not.toMatch(/\shref="next\.md"/)
    expect(result.outline).toMatchObject([{ level: 1, text: 'Safe' }])
  })

  it('keeps diagram languages inert and strips SVG and legacy resource attributes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await renderBookMarkdown(`
\`\`\`plantuml
@startuml
A -> B
@enduml
\`\`\`

<svg><a href="https://example.com" xlink:href="file:///tmp/x">x</a></svg>
<table background="file:///tmp/background.png" style="background:url(file:///tmp/x)"><tr><td>x</td></tr></table>
<a href="next.md">Next</a>
`)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.html).toContain('language-plantuml')
    expect(result.html).not.toMatch(/<svg|xlink:href|background=|style=|file:\/\//i)
    expect(result.html).toContain('data-book-href="next.md"')
    expect(result.html).toContain('role="link"')
    expect(result.html).toContain('tabindex="0"')
    expect(result.html).not.toMatch(/\shref="next\.md"/)
    fetchSpy.mockRestore()
  })

  it('assigns deterministic unique IDs to duplicate headings and matching outline entries', async () => {
    const markdown = '# Repeat\n\n# Repeat\n\n# Repeat\n'
    const first = await renderBookMarkdown(markdown)
    const second = await renderBookMarkdown(markdown)
    const ids = first.outline.map((item) => item.id)
    expect(new Set(ids).size).toBe(3)
    expect(second.outline.map((item) => item.id)).toEqual(ids)
    const document = new DOMParser().parseFromString(first.html, 'text/html')
    expect([...document.querySelectorAll('h1')].map((heading) => heading.id)).toEqual(ids)
    for (const id of ids) expect(document.getElementById(id)?.id).toBe(id)
  })
})

describe('book store async generations', () => {
  const sessionDto = (sessionId: string, title: string): BookSessionDto => ({
    libraryId: `${sessionId}-library`,
    sessionId,
    title,
    navigationSource: 'inferred',
    nodes: [],
    entryNodeId: null,
    landingNodeId: null,
    diagnostics: []
  })
  const deferred = <T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
  } => {
    let complete!: (value: T) => void
    const promise = new Promise<T>((resolve) => {
      complete = resolve
    })
    return { promise, resolve: complete }
  }

  it('ignores an older open response and keeps loading accurate until all requests settle', async () => {
    setActivePinia(createPinia())
    const first = deferred<BookReaderResult<BookSessionDto>>()
    const second = deferred<BookReaderResult<BookSessionDto>>()
    const openLibrary = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          openLibrary,
          closeSession: vi.fn().mockResolvedValue({ ok: true, value: true })
        }
      }
    })
    const store = useBooksStore()
    const older = store.openLibrary('older')
    const newer = store.openLibrary('newer')
    expect(store.loading).toBe(true)
    second.resolve({ ok: true, value: sessionDto('newer-session-id', 'Newer') })
    await newer
    expect(store.session?.title).toBe('Newer')
    expect(store.loading).toBe(true)
    first.resolve({ ok: true, value: sessionDto('older-session-id', 'Older') })
    await older
    expect(store.session?.title).toBe('Newer')
    expect(store.loading).toBe(false)
  })

  it('turns rejected IPC into a stable error and always clears loading', async () => {
    setActivePinia(createPinia())
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          openPicker: vi.fn().mockRejectedValue(new Error('secret raw error'))
        }
      }
    })
    const store = useBooksStore()
    await store.openPicker()
    expect(store.error).toEqual({
      code: 'invalid-request',
      message: 'LeafBook could not complete this request. Please try again.'
    })
    expect(store.loading).toBe(false)
  })

  it('serializes opening a node behind a deferred refresh and uses the refreshed session', async () => {
    setActivePinia(createPinia())
    const pendingRefresh = deferred<BookReaderResult<BookSessionDto>>()
    const refreshed = {
      ...sessionDto('stable-session-id', 'Refreshed'),
      nodes: [
        { nodeId: 'stable-node-id-0001', type: 'chapter' as const, title: 'Chapter', children: [] }
      ]
    }
    const readChapter = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        nodeId: 'stable-node-id-0001',
        title: 'Chapter',
        markdown: '# Chapter',
        fragment: null
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          refresh: vi.fn(() => pendingRefresh.promise),
          readChapter
        }
      }
    })
    const store = useBooksStore()
    store.session = {
      ...sessionDto('stable-session-id', 'Original'),
      nodes: refreshed.nodes
    }
    store.mode = 'reader'
    const refreshing = store.refresh()
    const opening = store.openNode('stable-node-id-0001')
    await Promise.resolve()
    expect(readChapter).not.toHaveBeenCalled()
    pendingRefresh.resolve({ ok: true, value: refreshed })
    await refreshing
    await opening
    expect(store.session?.title).toBe('Refreshed')
    expect(readChapter).toHaveBeenCalledTimes(1)
    expect(readChapter).toHaveBeenCalledWith('stable-session-id', 'stable-node-id-0001')
    expect(store.chapter?.nodeId).toBe('stable-node-id-0001')
  })

  it('does not revive or close a session again when a stale refresh resolves', async () => {
    setActivePinia(createPinia())
    const pendingRefresh = deferred<BookReaderResult<BookSessionDto>>()
    const closeSession = vi.fn().mockResolvedValue({ ok: true, value: true })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          refresh: vi.fn(() => pendingRefresh.promise),
          closeSession,
          list: vi.fn().mockResolvedValue([])
        }
      }
    })
    const store = useBooksStore()
    store.session = sessionDto('stable-session-id', 'Original')
    store.mode = 'reader'
    const refreshing = store.refresh()
    const leaving = store.showBookshelf()
    pendingRefresh.resolve({
      ok: true,
      value: sessionDto('stable-session-id', 'Late refresh')
    })
    await Promise.all([refreshing, leaving])
    expect(store.mode).toBe('bookshelf')
    expect(store.session).toBeNull()
    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(closeSession).toHaveBeenCalledWith('stable-session-id')
  })

  it('rechecks store identity after the asynchronous post-remove list', async () => {
    setActivePinia(createPinia())
    const pendingList = deferred<BookshelfEntryDto[]>()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          remove: vi.fn().mockResolvedValue({ ok: true, value: true }),
          list: vi.fn(() => pendingList.promise),
          closeSession: vi.fn().mockResolvedValue({ ok: true, value: true })
        }
      }
    })
    const store = useBooksStore()
    store.mode = 'bookshelf'
    const removing = store.removeLibrary('library-id-00001')
    await Promise.resolve()
    const leaving = store.showEditor()
    pendingList.resolve([
      {
        libraryId: 'late-library-id-01',
        title: 'Late',
        lastOpenedAt: new Date(0).toISOString(),
        available: true
      }
    ])
    await Promise.all([removing, leaving])
    expect(store.mode).toBe('editor')
    expect(store.libraries).toEqual([])
  })
})
