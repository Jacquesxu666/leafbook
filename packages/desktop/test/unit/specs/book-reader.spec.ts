/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  BookReaderNodeDto,
  BookReaderResult,
  BookSearchProgressDto,
  BookSearchResponseDto,
  BookshelfEntryDto,
  BookSessionDto
} from '@shared/types/bookReader'
import { adjacentChapter, flattenReadableNodeIds } from '@/book/readerModel'
import { renderBookMarkdown } from '@/book/renderMarkdown'
import { analyzeAtxH1Headings } from 'leafbook-muya-heading-analyzer'
import { generateBookExportHtml } from '@/book/exportBookHtml'
import { bookFragmentKey, validateBookHeadingFragments } from 'common/book/heading'
import {
  PAINT_WAIT_TIMEOUT_MS,
  restoreReadingPosition,
  waitForPaint
} from '@/book/restoreReadingPosition'
import { useBooksStore } from '@/store/books'
import {
  bookEditDecision,
  disposeAllBookEditDecisions,
  disposeBookEditDecisions,
  requestBookEditDecision,
  resolveBookEditDecision
} from '@/services/bookEditDecision'

const mocks = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
  selectedPath: '',
  exportPath: '',
  confirmOverwrite: true,
  openedExternal: vi.fn(),
  browserWindow: null as Record<string, unknown> | null,
  webContentsById: new Map<number, Record<string, unknown>>(),
  ipcHandlers: new Map<string, (...args: never[]) => unknown>()
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
  app: { getPath: () => '/ipc-user-data' },
  BrowserWindow: { fromWebContents: () => mocks.browserWindow },
  dialog: {
    showOpenDialog: async () => ({
      canceled: !mocks.selectedPath,
      filePaths: mocks.selectedPath ? [mocks.selectedPath] : []
    }),
    showSaveDialog: async () => ({
      canceled: !mocks.exportPath,
      filePath: mocks.exportPath || undefined
    }),
    showMessageBox: async () => ({ response: mocks.confirmOverwrite ? 1 : 0 })
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      mocks.ipcHandlers.set(channel, handler)
  },
  webContents: { fromId: (id: number) => mocks.webContentsById.get(id) },
  shell: { openExternal: mocks.openedExternal }
}))

import {
  BookSessionManager,
  type BookSessionManagerTestHooks
} from 'main_renderer/book/sessionManager'
import { loadBookFromDirectory, safelyReadBookChapter } from 'main_renderer/book/filesystem'
import {
  isTrustedEditorSender,
  openConfirmedBookExternal,
  registerBookHandlers
} from 'main_renderer/ipc/books'

const temporaryDirectories: string[] = []
const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const testGif = Buffer.from(
  'R0lGODdhAQABAJEAAAAAACgsNP///wAAACH5BAkAAAMALAAAAAABAAEAAAICTAEAOw==',
  'base64'
)
const largeCanvasGif = (): Buffer => {
  const bytes = Buffer.from(testGif)
  bytes.writeUInt16LE(6_000, 6)
  bytes.writeUInt16LE(5_000, 8)
  return bytes
}
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
type TestRootIdentity = { realPath: string; dev: bigint; ino: bigint } | null
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
const makeRasterBook = async (count: number): Promise<string> => {
  const names = Array.from({ length: count }, (_, index) => `image-${index}.png`)
  const root = await makeBook({
    'SUMMARY.md': '- [Start](start.md)\n',
    'start.md': ['# Start', ...names.map((name) => `![${name}](${name})`)].join('\n\n')
  })
  await Promise.all(names.map((name) => fs.writeFile(path.join(root, name), testPng)))
  return root
}

beforeEach(() => {
  mocks.stores.clear()
  mocks.selectedPath = ''
  mocks.exportPath = ''
  mocks.confirmOverwrite = true
  mocks.openedExternal.mockReset()
  mocks.webContentsById.clear()
  mocks.browserWindow = null
  mocks.ipcHandlers.clear()
})
afterEach(async () => {
  disposeAllBookEditDecisions()
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe('book edit decision queue', () => {
  it('serves decisions FIFO and ignores stale request owners and request ids', async () => {
    let firstCurrent = true
    const first = requestBookEditDecision(
      'First',
      'First message',
      [
        { id: 'cancel', label: 'Cancel' },
        { id: 'save', label: 'Save' }
      ],
      'cancel',
      {
        tabId: 'tab-first',
        operationGeneration: 1,
        isCurrent: () => firstCurrent
      }
    )
    const firstRequestId = bookEditDecision.requestId
    const second = requestBookEditDecision(
      'Second',
      'Second message',
      [
        { id: 'cancel', label: 'Cancel' },
        { id: 'discard', label: 'Discard' }
      ],
      'cancel',
      {
        tabId: 'tab-second',
        operationGeneration: 3,
        isCurrent: () => true
      }
    )
    expect(bookEditDecision.title).toBe('First')
    resolveBookEditDecision(firstRequestId + 100, 'save')
    expect(bookEditDecision.title).toBe('First')
    firstCurrent = false
    resolveBookEditDecision(firstRequestId, 'save')
    await expect(first).resolves.toBe('cancel')
    expect(bookEditDecision.title).toBe('Second')
    resolveBookEditDecision(bookEditDecision.requestId, 'discard')
    await expect(second).resolves.toBe('discard')
    expect(bookEditDecision.open).toBe(false)
  })

  it('disposes only the matching queued owner generation', async () => {
    const active = requestBookEditDecision('Active', 'Active message', [
      { id: 'cancel', label: 'Cancel' }
    ])
    const stale = requestBookEditDecision(
      'Stale',
      'Stale message',
      [{ id: 'cancel', label: 'Cancel' }],
      'cancel',
      {
        tabId: 'tab-owner',
        operationGeneration: 4,
        isCurrent: () => true
      }
    )
    const next = requestBookEditDecision(
      'Next',
      'Next message',
      [{ id: 'cancel', label: 'Cancel' }],
      'cancel',
      {
        tabId: 'tab-owner',
        operationGeneration: 5,
        isCurrent: () => true
      }
    )
    disposeBookEditDecisions('tab-owner', 4)
    await expect(stale).resolves.toBe('cancel')
    resolveBookEditDecision(bookEditDecision.requestId, 'cancel')
    await active
    expect(bookEditDecision.title).toBe('Next')
    resolveBookEditDecision(bookEditDecision.requestId, 'cancel')
    await next
  })
})

describe('book session LRU', () => {
  it('keeps direct session Map mutation inside the lifecycle helpers', () => {
    const sourcePath = [
      path.resolve(process.cwd(), 'src/main/book/sessionManager.ts'),
      path.resolve(process.cwd(), 'packages/desktop/src/main/book/sessionManager.ts')
    ].find((candidate) => fsSync.existsSync(candidate))
    expect(sourcePath).toBeDefined()
    if (!sourcePath) return

    const source = fsSync.readFileSync(sourcePath, 'utf8')
    const helperStart = source.indexOf('  private touchSession(')
    const helperEnd = source.indexOf('  private ownerGeneration(', helperStart)
    expect(helperStart).toBeGreaterThan(-1)
    expect(helperEnd).toBeGreaterThan(helperStart)
    const helperSource = source.slice(helperStart, helperEnd)
    const outsideHelpers = `${source.slice(0, helperStart)}${source.slice(helperEnd)}`

    expect(outsideHelpers).not.toMatch(/this\.sessions\.(?:set|delete|clear)\(/)
    expect(helperSource.match(/this\.sessions\.set\(/g)).toHaveLength(3)
    expect(helperSource.match(/this\.sessions\.delete\(/g)).toHaveLength(3)
    expect(helperSource).not.toContain('this.sessions.clear(')
  })

  it('touches successful access and repeatedly evicts only that owner least-recent session', async () => {
    const root = await makeBook({ 'chapter.md': '# Chapter\n' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/session-lru-user-data')
    const ownerId = 68
    const otherOwnerId = 69
    const sessions: BookSessionDto[] = []

    for (let index = 0; index < 20; index++) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      sessions.push(opened.value)
    }
    const other = await manager.openPicker({ sender: { id: otherOwnerId } } as never)
    expect(other.ok).toBe(true)
    if (!other.ok) return

    expect(
      await manager.readChapter(sessions[0].sessionId, sessions[0].nodes[0].nodeId, ownerId)
    ).toMatchObject({ ok: true })
    expect((await manager.openPicker({ sender: { id: ownerId } } as never)).ok).toBe(true)
    expect(manager.closeSession(sessions[1].sessionId, ownerId)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(
      await manager.readChapter(sessions[0].sessionId, sessions[0].nodes[0].nodeId, ownerId)
    ).toMatchObject({ ok: true })

    expect((await manager.openPicker({ sender: { id: ownerId } } as never)).ok).toBe(true)
    expect(manager.closeSession(sessions[2].sessionId, ownerId)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(
      await manager.readChapter(other.value.sessionId, other.value.nodes[0].nodeId, otherOwnerId)
    ).toMatchObject({ ok: true })
  })

  it('touches an existing session replacement after refresh', async () => {
    const root = await makeBook({ 'chapter.md': '# Chapter\n' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/session-refresh-lru-user-data')
    const ownerId = 70
    const sessions: BookSessionDto[] = []

    for (let index = 0; index < 20; index++) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      sessions.push(opened.value)
    }
    expect(await manager.refresh(sessions[0].sessionId, ownerId)).toMatchObject({ ok: true })
    expect((await manager.openPicker({ sender: { id: ownerId } } as never)).ok).toBe(true)
    expect(manager.closeSession(sessions[1].sessionId, ownerId)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(manager.closeSession(sessions[0].sessionId, ownerId)).toEqual({
      ok: true,
      value: true
    })
  })

  it('revokes the old session exactly once when public refresh publishes its replacement', async () => {
    const root = await makeBook({ 'chapter.md': '# Chapter\n' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/session-refresh-revoke-user-data')
    const opened = await manager.openPicker({ sender: { id: 71 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    type SessionInternals = {
      sessions: Map<string, { generation: number }>
      revokeSessionLeases: (...args: unknown[]) => void
    }
    const internals = manager as unknown as SessionInternals
    const original = internals.sessions.get(opened.value.sessionId)
    expect(original).toBeDefined()
    if (!original) return
    const revoke = vi.spyOn(internals, 'revokeSessionLeases')

    expect(await manager.refresh(opened.value.sessionId, 71)).toMatchObject({ ok: true })
    const replacement = internals.sessions.get(opened.value.sessionId)
    expect(replacement).toBeDefined()
    expect(replacement).not.toBe(original)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke.mock.calls[0]?.[1]).toBe(original)
    expect(revoke.mock.calls.some((call) => call[1] === replacement)).toBe(false)
  })

  it.each([
    {
      operation: 'read',
      files: { 'README.md': '# One\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> =>
        manager.readChapter(opened.sessionId, opened.entryNodeId, ownerId)
    },
    {
      operation: 'edit',
      files: { 'SUMMARY.md': '- [One](README.md)\n', 'README.md': '# One\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> =>
        manager.beginEdit(opened.sessionId, opened.nodes[0].nodeId, ownerId)
    },
    {
      operation: 'arrange',
      files: { 'SUMMARY.md': '- [One](README.md)\n', 'README.md': '# One\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> => manager.beginArrangement(opened.sessionId, ownerId)
    },
    {
      operation: 'prepare',
      files: { 'manuscript.md': '# One\n\n# Two\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> => manager.beginPreparation(opened.sessionId, ownerId)
    },
    {
      operation: 'export',
      files: { 'README.md': '# One\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> =>
        manager.beginExport(opened.sessionId, { sender: { id: ownerId } } as never, ownerId)
    },
    {
      operation: 'search',
      files: { 'README.md': '# One\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> =>
        manager.search(
          opened.sessionId,
          { searchId: randomUUID(), query: 'One', limit: 10 },
          ownerId
        )
    },
    {
      operation: 'link navigation',
      files: { 'README.md': '# One\n' },
      run: (
        manager: BookSessionManager,
        opened: BookSessionDto,
        ownerId: number
      ): Promise<BookReaderResult<unknown>> =>
        manager.followLink(opened.sessionId, opened.entryNodeId, '#one', ownerId)
    }
  ])(
    'fails $operation acquisition closed while the exact session refresh is pending',
    async ({ files, run }) => {
      const root = await makeBook(files as unknown as Record<string, string>)
      const reached = deferredValue<void>()
      const release = deferredValue<void>()
      let loads = 0
      const loader: typeof loadBookFromDirectory = async (rootPath, options) => {
        const result = await loadBookFromDirectory(rootPath, options)
        loads++
        if (loads > 1) {
          reached.resolve()
          await release.promise
        }
        return result
      }
      mocks.selectedPath = root
      const ownerId = 79
      const manager = new BookSessionManager('/session-refresh-freeze-user-data', loader)
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.entryNodeId) return

      const refreshing = manager.refresh(opened.value.sessionId, ownerId)
      await reached.promise
      await expect(run(manager, opened.value, ownerId)).resolves.toMatchObject({
        ok: false,
        error: { code: 'session-not-found' }
      })
      release.resolve()
      await expect(refreshing).resolves.toMatchObject({ ok: true })
    }
  )

  it.each(['success', 'scan-failure'] as const)(
    'clears the atomic refresh freeze after %s without reviving old leases',
    async (outcome) => {
      const root = await makeBook({
        'SUMMARY.md': '- [One](README.md)\n',
        'README.md': '# One\n'
      })
      const reached = deferredValue<void>()
      const release = deferredValue<void>()
      let loads = 0
      let recover = false
      const loader: typeof loadBookFromDirectory = async (rootPath, options) => {
        const result = await loadBookFromDirectory(rootPath, options)
        loads++
        if (loads === 1) return result
        reached.resolve()
        await release.promise
        if (outcome === 'success' || recover) return result
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
      mocks.selectedPath = root
      const ownerId = 80
      const manager = new BookSessionManager(
        `/session-refresh-${outcome}-recovery-user-data`,
        loader
      )
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.nodes[0]) return
      const edit = await manager.beginEdit(
        opened.value.sessionId,
        opened.value.nodes[0].nodeId,
        ownerId
      )
      expect(edit.ok).toBe(true)
      if (!edit.ok) return

      const refreshing = manager.refresh(opened.value.sessionId, ownerId)
      await reached.promise
      expect(await manager.reloadEdit(edit.value.editId, ownerId)).toMatchObject({
        ok: false,
        error: { code: 'edit-not-found' }
      })
      release.resolve()
      await expect(refreshing).resolves.toMatchObject({
        ok: outcome === 'success',
        ...(outcome === 'success' ? {} : { error: { code: 'book-unavailable' } })
      })
      await expect(
        manager.readChapter(opened.value.sessionId, opened.value.nodes[0].nodeId, ownerId)
      ).resolves.toMatchObject(
        outcome === 'success' ? { ok: true } : { ok: false, error: { code: 'session-not-found' } }
      )
      if (outcome === 'scan-failure') {
        recover = true
        await expect(manager.openLibrary(opened.value.libraryId, ownerId)).resolves.toMatchObject({
          ok: true
        })
      }
      expect(await manager.reloadEdit(edit.value.editId, ownerId)).toMatchObject({
        ok: false,
        error: { code: 'edit-not-found' }
      })
    }
  )

  it('shares repeated refresh, rejects the wrong owner, and leaves another owner unfrozen', async () => {
    const root = await makeBook({ 'README.md': '# One\n' })
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    let loads = 0
    const loader: typeof loadBookFromDirectory = async (rootPath, options) => {
      const result = await loadBookFromDirectory(rootPath, options)
      loads++
      if (loads === 3) {
        reached.resolve()
        await release.promise
      }
      return result
    }
    mocks.selectedPath = root
    const manager = new BookSessionManager('/session-refresh-owner-isolation-user-data', loader)
    const first = await manager.openPicker({ sender: { id: 81 } } as never)
    const other = await manager.openPicker({ sender: { id: 82 } } as never)
    expect(first.ok && other.ok).toBe(true)
    if (!first.ok || !first.value.entryNodeId || !other.ok || !other.value.entryNodeId) return

    const initial = manager.refresh(first.value.sessionId, 81)
    await reached.promise
    const repeated = manager.refresh(first.value.sessionId, 81)
    await expect(manager.refresh(first.value.sessionId, 82)).resolves.toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    await expect(
      manager.readChapter(other.value.sessionId, other.value.entryNodeId, 82)
    ).resolves.toMatchObject({ ok: true })
    release.resolve()
    const [initialResult, repeatedResult] = await Promise.all([initial, repeated])
    expect(initialResult).toMatchObject({ ok: true })
    expect(repeatedResult).toEqual(initialResult)
    expect(loads).toBe(3)
  })

  it('lets owner close the frozen session and prevents a late refresh replacement', async () => {
    const root = await makeBook({ 'README.md': '# One\n' })
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    let loads = 0
    const loader: typeof loadBookFromDirectory = async (rootPath, options) => {
      const result = await loadBookFromDirectory(rootPath, options)
      loads++
      if (loads > 1) {
        reached.resolve()
        await release.promise
      }
      return result
    }
    mocks.selectedPath = root
    const ownerId = 83
    const manager = new BookSessionManager('/session-refresh-close-user-data', loader)
    const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const refreshing = manager.refresh(opened.value.sessionId, ownerId)
    await reached.promise
    expect(manager.closeSession(opened.value.sessionId, ownerId)).toEqual({
      ok: true,
      value: true
    })
    release.resolve()
    await expect(refreshing).resolves.toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(manager.closeSession(opened.value.sessionId, ownerId)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
  })

  it.each(['close', 'remove', 'cleanup', 'capacity'] as const)(
    'routes %s removal through one idempotent session revocation',
    async (boundary) => {
      const root = await makeBook({ 'chapter.md': '# Chapter\n' })
      mocks.selectedPath = root
      const ownerId = 72
      const manager = new BookSessionManager(`/session-${boundary}-lifecycle-user-data`)
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return

      type SessionInternals = {
        revokeSessionLeases: (...args: unknown[]) => void
      }
      const internals = manager as unknown as SessionInternals
      const revoke = vi.spyOn(internals, 'revokeSessionLeases')
      if (boundary === 'close') {
        expect(manager.closeSession(opened.value.sessionId, ownerId)).toEqual({
          ok: true,
          value: true
        })
        expect(manager.closeSession(opened.value.sessionId, ownerId)).toMatchObject({
          ok: false,
          error: { code: 'session-not-found' }
        })
      } else if (boundary === 'remove') {
        expect(await manager.removeLibrary(opened.value.libraryId)).toEqual({
          ok: true,
          value: true
        })
        expect(await manager.removeLibrary(opened.value.libraryId)).toMatchObject({
          ok: false,
          error: { code: 'library-not-found' }
        })
      } else if (boundary === 'cleanup') {
        manager.cleanupOwner(ownerId)
        manager.cleanupOwner(ownerId)
      } else {
        for (let index = 0; index < 20; index++) {
          expect((await manager.openPicker({ sender: { id: ownerId } } as never)).ok).toBe(true)
        }
      }
      expect(revoke.mock.calls.filter((call) => call[0] === opened.value.sessionId)).toHaveLength(1)
      expect(manager.closeSession(opened.value.sessionId, ownerId)).toMatchObject({
        ok: false,
        error: { code: 'session-not-found' }
      })
    }
  )

  it('rebinds repeated edits and removeLibrary revokes the current sessions across owners', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\nOriginal\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/session-edit-remove-user-data')
    const first = await manager.openPicker({ sender: { id: 73 } } as never)
    expect(first.ok).toBe(true)
    if (!first.ok || !first.value.nodes[0]) return
    const other = await manager.openLibrary(first.value.libraryId, 74)
    expect(other.ok).toBe(true)
    if (!other.ok || !other.value.nodes[0]) return
    const edit = await manager.beginEdit(first.value.sessionId, first.value.nodes[0].nodeId, 73)
    const otherEdit = await manager.beginEdit(
      other.value.sessionId,
      other.value.nodes[0].nodeId,
      74
    )
    expect(edit.ok && otherEdit.ok).toBe(true)
    if (!edit.ok || !otherEdit.ok) return

    type SessionInternals = {
      sessions: Map<string, object>
      revokeSessionLeases: (...args: unknown[]) => void
    }
    const internals = manager as unknown as SessionInternals
    const revoke = vi.spyOn(internals, 'revokeSessionLeases')
    let revision = edit.value.revision
    for (const body of ['First save', 'Second save']) {
      const previous = internals.sessions.get(first.value.sessionId)
      const saved = await manager.saveEdit(
        {
          editId: edit.value.editId,
          revision,
          markdown: `# Start\n${body}\n`
        },
        73
      )
      expect(saved).toMatchObject({
        ok: true,
        value: {
          editId: edit.value.editId,
          session: { sessionId: first.value.sessionId },
          readOnly: false
        }
      })
      if (!saved.ok) return
      revision = saved.value.revision
      const current = internals.sessions.get(first.value.sessionId)
      expect(current).toBeDefined()
      expect(current).not.toBe(previous)
      expect(revoke.mock.calls.at(-1)?.[1]).toBe(previous)
      expect(revoke.mock.calls.some((call) => call[1] === current)).toBe(false)
      expect(await manager.reloadEdit(edit.value.editId, 73)).toMatchObject({
        ok: true,
        value: { revision }
      })
    }

    expect(await manager.removeLibrary(first.value.libraryId)).toEqual({ ok: true, value: true })
    expect(await manager.reloadEdit(edit.value.editId, 73)).toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
    expect(await manager.reloadEdit(otherEdit.value.editId, 74)).toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
    expect(manager.closeSession(first.value.sessionId, 73)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(manager.closeSession(other.value.sessionId, 74)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
  })
})

describe('book preparation sessions', () => {
  it('creates SUMMARY from an explicit inferred source and privately refreshes the session', async () => {
    const root = await makeBook({
      'manuscript.md': '# First chapter\n\nBody\n\n# Second chapter\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/preparation-session-user-data')
    const opened = await manager.openPicker({ sender: { id: 71 } } as never)
    expect(opened).toMatchObject({ ok: true, value: { navigationSource: 'inferred' } })
    if (!opened.ok) return
    const begun = await manager.beginPreparation(opened.value.sessionId, 71)
    expect(begun).toMatchObject({
      ok: true,
      value: { requiresSelection: true, candidates: [{ title: 'First chapter' }] }
    })
    if (!begun.ok) return
    const selected = await manager.selectPreparationSource(
      begun.value.preparationId,
      begun.value.candidates[0].nodeId,
      71
    )
    expect(selected).toMatchObject({
      ok: true,
      value: {
        requiresSelection: false,
        chapters: [{ title: 'First chapter' }, { title: 'Second chapter' }]
      }
    })
    if (!selected.ok || !selected.value.revision) return
    const saved = await manager.commitPreparation(
      { preparationId: selected.value.preparationId, revision: selected.value.revision },
      71
    )
    expect(saved).toMatchObject({
      ok: true,
      value: {
        committed: true,
        durabilityUncertain: false,
        sourceNodeId: expect.any(String),
        session: {
          sessionId: opened.value.sessionId,
          navigationSource: 'summary',
          nodes: [{ title: 'First chapter' }, { title: 'Second chapter' }]
        }
      }
    })
    expect(await fs.readFile(path.join(root, 'manuscript.md'), 'utf8')).toContain('Body')
    expect(await fs.readFile(path.join(root, 'SUMMARY.md'), 'utf8')).toContain(
      'manuscript.md#first-chapter'
    )
    expect(manager.closePreparation(selected.value.preparationId, 71)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
  })

  it('is unavailable for summary books and revokes previews at refresh and owner cleanup', async () => {
    const summaryRoot = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n',
      'one.md': '# One'
    })
    mocks.selectedPath = summaryRoot
    const manager = new BookSessionManager('/preparation-boundary-user-data')
    const summary = await manager.openPicker({ sender: { id: 72 } } as never)
    if (!summary.ok) return
    expect(await manager.beginPreparation(summary.value.sessionId, 72)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-available' }
    })

    const inferredRoot = await makeBook({ 'book.md': '# One\n\n# Two\n' })
    mocks.selectedPath = inferredRoot
    const inferred = await manager.openPicker({ sender: { id: 73 } } as never)
    if (!inferred.ok) return
    const begun = await manager.beginPreparation(inferred.value.sessionId, 73)
    if (!begun.ok) return
    await manager.refresh(inferred.value.sessionId, 73)
    expect(manager.closePreparation(begun.value.preparationId, 73)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })

    const second = await manager.beginPreparation(inferred.value.sessionId, 73)
    if (!second.ok) return
    manager.cleanupOwner(73)
    expect(manager.closePreparation(second.value.preparationId, 73)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
  })

  it('revokes preparation leases in per-owner LRU order and restores only that owner capacity', async () => {
    const root = await makeBook({ 'manuscript.md': '# One\n\n# Two\n' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/preparation-lru-user-data')
    const ownerId = 74
    const otherOwnerId = 75
    const opened: BookSessionDto[] = []
    const preparationIds: string[] = []

    for (let index = 0; index < 4; index++) {
      const result = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      opened.push(result.value)
      const begun = await manager.beginPreparation(result.value.sessionId, ownerId)
      expect(begun.ok).toBe(true)
      if (!begun.ok) return
      preparationIds.push(begun.value.preparationId)
    }
    const otherSession = await manager.openPicker({ sender: { id: otherOwnerId } } as never)
    expect(otherSession.ok).toBe(true)
    if (!otherSession.ok) return
    const otherPreparation = await manager.beginPreparation(
      otherSession.value.sessionId,
      otherOwnerId
    )
    expect(otherPreparation.ok).toBe(true)
    if (!otherPreparation.ok) return

    for (let index = 4; index < 21; index++) {
      const result = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      opened.push(result.value)
    }
    expect(manager.closePreparation(preparationIds[0], ownerId)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    expect(manager.closePreparation(otherPreparation.value.preparationId, otherOwnerId)).toEqual({
      ok: true,
      value: true
    })
    const isolatedPreparation = await manager.beginPreparation(
      otherSession.value.sessionId,
      otherOwnerId
    )
    expect(isolatedPreparation.ok).toBe(true)
    if (!isolatedPreparation.ok) return

    const replacement = await manager.beginPreparation(opened.at(-1)?.sessionId, ownerId)
    expect(replacement.ok).toBe(true)
    if (!replacement.ok) return
    const next = await manager.openPicker({ sender: { id: ownerId } } as never)
    expect(next.ok).toBe(true)
    expect(manager.closePreparation(preparationIds[1], ownerId)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    expect(manager.closePreparation(preparationIds[2], ownerId)).toEqual({
      ok: true,
      value: true
    })
    expect(manager.closePreparation(preparationIds[3], ownerId)).toEqual({
      ok: true,
      value: true
    })
    expect(manager.closePreparation(replacement.value.preparationId, ownerId)).toEqual({
      ok: true,
      value: true
    })
    manager.cleanupOwner(ownerId)
    expect(manager.closePreparation(isolatedPreparation.value.preparationId, otherOwnerId)).toEqual(
      {
        ok: true,
        value: true
      }
    )
  })

  it('does not let a late automatic begin revive or clear a newer preparation after eviction', async () => {
    const root = await makeBook({})
    await fs.writeFile(path.join(root, `${path.basename(root)}.md`), '# One\n\n# Two\n')
    mocks.selectedPath = root
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    let holdRead = true
    const hooks: BookSessionManagerTestHooks = {
      beforePreparationRead: async () => {
        if (!holdRead) return
        reached.resolve()
        await release.promise
      }
    }
    const manager = new BookSessionManager(
      '/preparation-late-begin-user-data',
      undefined,
      undefined,
      undefined,
      hooks
    )
    const ownerId = 76
    const oldest = await manager.openPicker({ sender: { id: ownerId } } as never)
    expect(oldest.ok).toBe(true)
    if (!oldest.ok) return
    const lateBegin = manager.beginPreparation(oldest.value.sessionId, ownerId)
    await reached.promise

    let newest = oldest.value
    for (let index = 0; index < 20; index++) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      newest = opened.value
    }
    holdRead = false
    const current = await manager.beginPreparation(newest.sessionId, ownerId)
    expect(current.ok).toBe(true)
    if (!current.ok) return
    release.resolve()
    await expect(lateBegin).resolves.toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    expect(manager.closePreparation(current.value.preparationId, ownerId)).toEqual({
      ok: true,
      value: true
    })
  })

  it('does not let a late selection revive or clear a newer preparation after eviction', async () => {
    const root = await makeBook({ 'manuscript.md': '# One\n\n# Two\n' })
    mocks.selectedPath = root
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    let holdRead = true
    const manager = new BookSessionManager(
      '/preparation-late-select-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforePreparationRead: async () => {
          if (!holdRead) return
          reached.resolve()
          await release.promise
        }
      }
    )
    const ownerId = 77
    const oldest = await manager.openPicker({ sender: { id: ownerId } } as never)
    expect(oldest.ok).toBe(true)
    if (!oldest.ok) return
    const begun = await manager.beginPreparation(oldest.value.sessionId, ownerId)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const lateSelect = manager.selectPreparationSource(
      begun.value.preparationId,
      begun.value.candidates[0].nodeId,
      ownerId
    )
    await reached.promise

    let newest = oldest.value
    for (let index = 0; index < 20; index++) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      newest = opened.value
    }
    holdRead = false
    const current = await manager.beginPreparation(newest.sessionId, ownerId)
    expect(current.ok).toBe(true)
    if (!current.ok) return
    release.resolve()
    await expect(lateSelect).resolves.toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    expect(manager.closePreparation(current.value.preparationId, ownerId)).toEqual({
      ok: true,
      value: true
    })
  })

  it('does not let a late commit publish or clear a newer preparation after eviction', async () => {
    const root = await makeBook({ 'manuscript.md': '# One\n\n# Two\n' })
    mocks.selectedPath = root
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    let holdCommit = true
    const manager = new BookSessionManager(
      '/preparation-late-commit-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforePreparationCommitOpen: async () => {
          if (!holdCommit) return
          reached.resolve()
          await release.promise
        }
      }
    )
    const ownerId = 78
    const oldest = await manager.openPicker({ sender: { id: ownerId } } as never)
    expect(oldest.ok).toBe(true)
    if (!oldest.ok) return
    const begun = await manager.beginPreparation(oldest.value.sessionId, ownerId)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const selected = await manager.selectPreparationSource(
      begun.value.preparationId,
      begun.value.candidates[0].nodeId,
      ownerId
    )
    expect(selected.ok).toBe(true)
    if (!selected.ok || !selected.value.revision) return
    const lateCommit = manager.commitPreparation(
      {
        preparationId: selected.value.preparationId,
        revision: selected.value.revision
      },
      ownerId
    )
    await reached.promise

    let newest = oldest.value
    for (let index = 0; index < 20; index++) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      newest = opened.value
    }
    holdCommit = false
    const current = await manager.beginPreparation(newest.sessionId, ownerId)
    expect(current.ok).toBe(true)
    if (!current.ok) return
    release.resolve()
    await expect(lateCommit).resolves.toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    await expect(fs.stat(path.join(root, 'SUMMARY.md'))).rejects.toThrow()
    expect(manager.closePreparation(current.value.preparationId, ownerId)).toEqual({
      ok: true,
      value: true
    })
  })
})

describe('book SUMMARY arrangement sessions', () => {
  it('arranges only an existing SUMMARY and privately refreshes the reader after save', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n- [Two](two.md)\n',
      'one.md': '# One',
      'two.md': '# Two'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/arrangement-session-user-data')
    const opened = await manager.openPicker({ sender: { id: 81 } } as never)
    expect(opened).toMatchObject({ ok: true, value: { navigationSource: 'summary' } })
    if (!opened.ok) return

    const begun = await manager.beginArrangement(opened.value.sessionId, 81)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [one, two] = begun.value.nodes
    const applied = manager.applyArrangement(
      {
        arrangementId: begun.value.arrangementId,
        operation: {
          type: 'move-before',
          nodeId: two.nodeId,
          targetNodeId: one.nodeId
        }
      },
      81
    )
    expect(applied).toMatchObject({ ok: true, value: { dirty: true, canUndo: true } })
    const saved = await manager.saveArrangement(
      { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
      81
    )
    expect(saved).toMatchObject({
      ok: true,
      value: {
        session: {
          sessionId: opened.value.sessionId,
          nodes: [{ title: 'Two' }, { title: 'One' }]
        }
      }
    })
    expect(await fs.readFile(path.join(root, 'SUMMARY.md'), 'utf8')).toBe(
      '- [Two](two.md)\n- [One](one.md)\n'
    )
    expect(manager.closeArrangement(begun.value.arrangementId, 81)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
  })

  it('does not create SUMMARY for inferred books and revokes drafts at refresh/owner boundaries', async () => {
    const inferredRoot = await makeBook({ 'README.md': '# Inferred' })
    mocks.selectedPath = inferredRoot
    const manager = new BookSessionManager('/arrangement-boundary-user-data')
    const inferred = await manager.openPicker({ sender: { id: 82 } } as never)
    expect(inferred.ok).toBe(true)
    if (!inferred.ok) return
    expect(await manager.beginArrangement(inferred.value.sessionId, 82)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-read-only' }
    })
    await expect(fs.stat(path.join(inferredRoot, 'SUMMARY.md'))).rejects.toThrow()

    const summaryRoot = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n',
      'one.md': '# One'
    })
    mocks.selectedPath = summaryRoot
    const arranged = await manager.openPicker({ sender: { id: 83 } } as never)
    expect(arranged.ok).toBe(true)
    if (!arranged.ok) return
    const begun = await manager.beginArrangement(arranged.value.sessionId, 83)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(await manager.refresh(arranged.value.sessionId, 83)).toMatchObject({ ok: true })
    expect(manager.undoArrangement(begun.value.arrangementId, 83)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })

    const second = await manager.beginArrangement(arranged.value.sessionId, 83)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(manager.closeSession(arranged.value.sessionId, 83)).toEqual({ ok: true, value: true })
    expect(manager.closeArrangement(second.value.arrangementId, 83)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })

    const reopened = await manager.openLibrary(arranged.value.libraryId, 84)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    const third = await manager.beginArrangement(reopened.value.sessionId, 84)
    expect(third.ok).toBe(true)
    if (!third.ok) return
    manager.cleanupOwner(84)
    expect(manager.closeArrangement(third.value.arrangementId, 84)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
  })

  it('keeps the lease busy through the save-owned private refresh', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n- [Two](two.md)\n',
      'one.md': '# One',
      'two.md': '# Two'
    })
    mocks.selectedPath = root
    const refreshStarted = deferredValue<void>()
    const releaseRefresh = deferredValue<void>()
    let loads = 0
    const load = async (...args: Parameters<typeof loadBookFromDirectory>) => {
      loads++
      if (loads === 2) {
        refreshStarted.resolve()
        await releaseRefresh.promise
      }
      return loadBookFromDirectory(...args)
    }
    const manager = new BookSessionManager('/arrangement-linearization-user-data', load)
    const opened = await manager.openPicker({ sender: { id: 85 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const begun = await manager.beginArrangement(opened.value.sessionId, 85)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [one, two] = begun.value.nodes
    const operation = {
      arrangementId: begun.value.arrangementId,
      operation: {
        type: 'move-before' as const,
        nodeId: two.nodeId,
        targetNodeId: one.nodeId
      }
    }
    expect(manager.applyArrangement(operation, 85)).toMatchObject({ ok: true })
    const saving = manager.saveArrangement(
      { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
      85
    )
    await refreshStarted.promise

    expect(manager.applyArrangement(operation, 85)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-conflict' }
    })
    expect(
      await manager.saveArrangement(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        85
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-conflict' } })

    releaseRefresh.resolve()
    expect(await saving).toMatchObject({
      ok: true,
      value: {
        session: {
          nodes: [{ title: 'Two' }, { title: 'One' }]
        }
      }
    })
    expect(await fs.readFile(path.join(root, 'SUMMARY.md'), 'utf8')).toBe(
      '- [Two](two.md)\n- [One](one.md)\n'
    )
  })

  it('reports committed bytes but revokes the lease when private refresh fails', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n- [Two](two.md)\n',
      'one.md': '# One',
      'two.md': '# Two'
    })
    mocks.selectedPath = root
    let loads = 0
    const load = async (...args: Parameters<typeof loadBookFromDirectory>) => {
      if (++loads === 2) throw new Error('private refresh failed')
      return loadBookFromDirectory(...args)
    }
    const manager = new BookSessionManager('/arrangement-refresh-failure-user-data', load)
    const opened = await manager.openPicker({ sender: { id: 86 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const begun = await manager.beginArrangement(opened.value.sessionId, 86)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [one, two] = begun.value.nodes
    manager.applyArrangement(
      {
        arrangementId: begun.value.arrangementId,
        operation: {
          type: 'move-before',
          nodeId: two.nodeId,
          targetNodeId: one.nodeId
        }
      },
      86
    )
    expect(
      await manager.saveArrangement(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        86
      )
    ).toMatchObject({ ok: true, value: { session: null } })
    expect(manager.undoArrangement(begun.value.arrangementId, 86)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
    expect(await fs.readFile(path.join(root, 'SUMMARY.md'), 'utf8')).toBe(
      '- [Two](two.md)\n- [One](one.md)\n'
    )
  })

  it('cleans a held save when the session object changes immediately after commit', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n- [Two](two.md)\n',
      'one.md': '# One',
      'two.md': '# Two'
    })
    mocks.selectedPath = root
    const committed = deferredValue<void>()
    const release = deferredValue<void>()
    const manager = new BookSessionManager(
      '/arrangement-session-change-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterArrangementSave: async () => {
          committed.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 87 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const begun = await manager.beginArrangement(opened.value.sessionId, 87)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [one, two] = begun.value.nodes
    manager.applyArrangement(
      {
        arrangementId: begun.value.arrangementId,
        operation: {
          type: 'move-before',
          nodeId: two.nodeId,
          targetNodeId: one.nodeId
        }
      },
      87
    )
    const saving = manager.saveArrangement(
      { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
      87
    )
    await committed.promise
    const refreshed = await manager.refresh(opened.value.sessionId, 87)
    expect(refreshed).toMatchObject({
      ok: true,
      value: { nodes: [{ title: 'Two' }, { title: 'One' }] }
    })
    release.resolve()
    expect(await saving).toMatchObject({ ok: true, value: { session: null } })
    expect(manager.closeArrangement(begun.value.arrangementId, 87)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
  })
})

describe('book IPC trust boundary', () => {
  it('fails closed for a missing, destroyed, or untrusted Reader external-link owner', async () => {
    expect(await openConfirmedBookExternal(700, 'https://example.com/')).toBe(false)

    mocks.webContentsById.set(701, { isDestroyed: () => true })
    expect(await openConfirmedBookExternal(701, 'https://example.com/')).toBe(false)

    mocks.webContentsById.set(702, {
      id: 702,
      isDestroyed: () => false,
      getURL: () => 'file:///index.html?type=settings',
      once: vi.fn()
    })
    expect(await openConfirmedBookExternal(702, 'https://example.com/')).toBe(false)
    expect(mocks.openedExternal).not.toHaveBeenCalled()
  })

  it('gates bookshelf listing and every book handler behind an editor sender', async () => {
    registerBookHandlers()
    const listHandler = mocks.ipcHandlers.get('lb::books::list')
    expect(listHandler).toBeDefined()
    const untrustedEvent = {
      sender: {
        id: 90,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=settings',
        once: vi.fn()
      }
    }
    expect(isTrustedEditorSender(untrustedEvent as never)).toBe(false)
    expect(await listHandler?.(untrustedEvent as never)).toEqual([])

    mocks.browserWindow = {
      restoreBufferId: 'editor-buffer',
      isDestroyed: () => false
    }
    const trustedEvent = {
      sender: {
        id: 91,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=editor',
        once: vi.fn()
      }
    }
    expect(isTrustedEditorSender(trustedEvent as never)).toBe(true)
    expect(
      [...mocks.ipcHandlers.keys()].filter((channel) => channel.startsWith('lb::books::'))
    ).toEqual(
      expect.arrayContaining([
        'lb::books::list',
        'lb::books::search',
        'lb::books::cancel-search',
        'lb::books::begin-arrangement',
        'lb::books::apply-arrangement',
        'lb::books::undo-arrangement',
        'lb::books::save-arrangement',
        'lb::books::close-arrangement',
        'lb::books::begin-export',
        'lb::books::commit-export',
        'lb::books::cancel-export',
        'lb::books::begin-website',
        'lb::books::commit-website',
        'lb::books::cancel-website'
      ])
    )
  })

  it('rejects malformed arrangement operations and revisions before manager dispatch', async () => {
    registerBookHandlers()
    mocks.browserWindow = {
      restoreBufferId: 'editor-buffer',
      isDestroyed: () => false
    }
    const event = {
      sender: {
        id: 93,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=editor',
        once: vi.fn()
      }
    }
    const apply = vi.spyOn(BookSessionManager.prototype, 'applyArrangement')
    const save = vi.spyOn(BookSessionManager.prototype, 'saveArrangement')
    const applyHandler = mocks.ipcHandlers.get('lb::books::apply-arrangement')
    const saveHandler = mocks.ipcHandlers.get('lb::books::save-arrangement')
    expect(
      await applyHandler?.(
        event as never,
        {
          arrangementId: 'arrangement',
          operation: { type: 'move-before', nodeId: 'one' }
        } as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(
      await saveHandler?.(
        event as never,
        { arrangementId: 'arrangement', revision: '../not-a-revision' } as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(apply).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects malformed and untrusted resource requests before manager dispatch', async () => {
    registerBookHandlers()
    mocks.browserWindow = {
      restoreBufferId: 'editor-buffer',
      isDestroyed: () => false
    }
    const event = {
      sender: {
        id: 931,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=editor',
        once: vi.fn()
      }
    }
    const read = vi.spyOn(BookSessionManager.prototype, 'readResource')
    const handler = mocks.ipcHandlers.get('lb::books::read-resource')
    expect(
      await handler?.(
        event as never,
        {
          sessionId: randomUUID(),
          resourceToken: randomUUID(),
          nodeId: randomUUID(),
          reference: 'x'.repeat(4_097)
        } as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(read).not.toHaveBeenCalled()

    mocks.browserWindow = {
      restoreBufferId: 'settings-buffer',
      isDestroyed: () => false
    }
    const untrusted = {
      sender: {
        id: 932,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=settings',
        once: vi.fn()
      }
    }
    expect(
      await handler?.(
        untrusted as never,
        {
          sessionId: randomUUID(),
          resourceToken: randomUUID(),
          nodeId: randomUUID(),
          reference: 'cover.png'
        } as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(read).not.toHaveBeenCalled()
  })

  it('does not dispatch any arrangement handler for an untrusted sender', async () => {
    registerBookHandlers()
    const event = {
      sender: {
        id: 94,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=settings',
        once: vi.fn()
      }
    }
    const begin = vi.spyOn(BookSessionManager.prototype, 'beginArrangement')
    const apply = vi.spyOn(BookSessionManager.prototype, 'applyArrangement')
    const undo = vi.spyOn(BookSessionManager.prototype, 'undoArrangement')
    const save = vi.spyOn(BookSessionManager.prototype, 'saveArrangement')
    const close = vi.spyOn(BookSessionManager.prototype, 'closeArrangement')
    const id = randomUUID()
    const calls: Array<[string, unknown]> = [
      ['lb::books::begin-arrangement', id],
      [
        'lb::books::apply-arrangement',
        {
          arrangementId: id,
          operation: { type: 'indent', nodeId: id }
        }
      ],
      ['lb::books::undo-arrangement', id],
      ['lb::books::save-arrangement', { arrangementId: id, revision: 'a'.repeat(64) }],
      ['lb::books::close-arrangement', id]
    ]
    for (const [channel, request] of calls) {
      expect(
        await mocks.ipcHandlers.get(channel)?.(event as never, request as never)
      ).toMatchObject({
        ok: false,
        error: { code: 'invalid-request' }
      })
    }
    expect(begin).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('rejects malformed and untrusted preparation IPC without manager dispatch', async () => {
    registerBookHandlers()
    const trusted = {
      sender: {
        id: 941,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=editor',
        once: vi.fn()
      }
    }
    mocks.browserWindow = {
      restoreBufferId: 'editor-buffer',
      isDestroyed: () => false
    }
    const select = vi.spyOn(BookSessionManager.prototype, 'selectPreparationSource')
    const commit = vi.spyOn(BookSessionManager.prototype, 'commitPreparation')
    expect(
      await mocks.ipcHandlers.get('lb::books::select-preparation-source')?.(
        trusted as never,
        '../lease' as never,
        '' as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(
      await mocks.ipcHandlers.get('lb::books::commit-preparation')?.(
        trusted as never,
        { preparationId: randomUUID(), revision: 'not-a-hash' } as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(select).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()

    mocks.browserWindow = {
      restoreBufferId: 'settings-buffer',
      isDestroyed: () => false
    }
    const untrusted = {
      sender: {
        id: 942,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=settings',
        once: vi.fn()
      }
    }
    const begin = vi.spyOn(BookSessionManager.prototype, 'beginPreparation')
    const close = vi.spyOn(BookSessionManager.prototype, 'closePreparation')
    const id = randomUUID()
    for (const [channel, args] of [
      ['lb::books::begin-preparation', [id]],
      ['lb::books::select-preparation-source', [id, id]],
      ['lb::books::commit-preparation', [{ preparationId: id, revision: 'a'.repeat(64) }]],
      ['lb::books::close-preparation', [id]]
    ] as const) {
      expect(
        await mocks.ipcHandlers.get(channel)?.(untrusted as never, ...(args as unknown as never[]))
      ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    }
    expect(begin).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('does not dispatch any export handler for an untrusted sender', async () => {
    registerBookHandlers()
    const event = {
      sender: {
        id: 95,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=settings',
        once: vi.fn()
      }
    }
    const begin = vi.spyOn(BookSessionManager.prototype, 'beginExport')
    const commit = vi.spyOn(BookSessionManager.prototype, 'commitExport')
    const cancel = vi.spyOn(BookSessionManager.prototype, 'cancelExport')
    const id = randomUUID()
    expect(
      await mocks.ipcHandlers.get('lb::books::begin-export')?.(event as never, id as never)
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(
      await mocks.ipcHandlers.get('lb::books::commit-export')?.(
        event as never,
        { exportId: id, html: '<!doctype html>' } as never
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(
      await mocks.ipcHandlers.get('lb::books::cancel-export')?.(event as never, id as never)
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(begin).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('rejects malformed, oversized, and untrusted website IPC without manager dispatch', async () => {
    registerBookHandlers()
    const begin = vi.spyOn(BookSessionManager.prototype, 'beginWebsite')
    const commit = vi.spyOn(BookSessionManager.prototype, 'commitWebsite')
    const cancel = vi.spyOn(BookSessionManager.prototype, 'cancelWebsite')
    const id = randomUUID()
    const sender = (url: string) => ({
      sender: {
        id: 96,
        isDestroyed: () => false,
        getURL: () => url,
        once: vi.fn()
      }
    })
    const trusted = sender('file:///index.html?type=editor')
    const untrusted = sender('file:///index.html?type=settings')
    for (const [channel, request] of [
      ['lb::books::begin-website', 'short'],
      ['lb::books::commit-website', { websiteId: id, html: 'x'.repeat(64 * 1024 * 1024 + 1) }],
      ['lb::books::cancel-website', '../invalid']
    ] as const) {
      expect(
        await mocks.ipcHandlers.get(channel)?.(trusted as never, request as never)
      ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    }
    for (const [channel, request] of [
      ['lb::books::begin-website', id],
      ['lb::books::commit-website', { websiteId: id, html: '<!doctype html>' }],
      ['lb::books::cancel-website', id]
    ] as const) {
      expect(
        await mocks.ipcHandlers.get(channel)?.(untrusted as never, request as never)
      ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    }
    expect(begin).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('contains a renderer destruction race while sending search progress', async () => {
    registerBookHandlers()
    mocks.browserWindow = {
      restoreBufferId: 'editor-buffer',
      isDestroyed: () => false
    }
    const send = vi.fn(() => {
      throw new Error('webContents was destroyed during send')
    })
    const event = {
      sender: {
        id: 92,
        isDestroyed: () => false,
        getURL: () => 'file:///index.html?type=editor',
        once: vi.fn(),
        send
      }
    }
    const search = vi
      .spyOn(BookSessionManager.prototype, 'search')
      .mockImplementation(async (_sessionId, request, _ownerId, onProgress) => {
        const searchId = (request as { searchId: string }).searchId
        onProgress?.({ searchId, phase: 'indexing', completed: 1, total: 1 })
        return { ok: false, error: { code: 'search-cancelled', message: 'test complete' } }
      })
    const handler = mocks.ipcHandlers.get('lb::books::search')
    await expect(
      handler?.(
        event as never,
        randomUUID() as never,
        {
          searchId: randomUUID(),
          query: 'needle'
        } as never
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'search-cancelled' } })
    expect(send).toHaveBeenCalledOnce()
    search.mockRestore()
  })
})

describe('BookSessionManager authorization boundary', () => {
  it('lets only the latest concurrent readChapter authorize resource references', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': '# Start\n'
    })
    await fs.writeFile(path.join(root, 'old.png'), testPng)
    await fs.writeFile(path.join(root, 'new.png'), testPng)
    mocks.selectedPath = root
    const oldRead = deferredValue<{ content: string } | null>()
    const newRead = deferredValue<{ content: string } | null>()
    const firstEntered = deferredValue<void>()
    let readCount = 0
    const manager = new BookSessionManager(
      '/resource-chapter-nonce-user-data',
      undefined,
      async () => {
        readCount += 1
        if (readCount === 1) {
          firstEntered.resolve()
          return oldRead.promise
        }
        return newRead.promise
      }
    )
    const opened = await manager.openPicker({ sender: { id: 103 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    const first = manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 103)
    await firstEntered.promise
    const second = manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 103)
    newRead.resolve({ content: '# New\n\n![New](new.png)' })
    expect(await second).toMatchObject({
      ok: true,
      value: { markdown: expect.stringContaining('New') }
    })
    oldRead.resolve({ content: '# Old\n\n![Old](old.png)' })
    expect(await first).toMatchObject({
      ok: true,
      value: { markdown: expect.stringContaining('Old') }
    })
    const request = {
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId
    }

    expect(await manager.readResource({ ...request, reference: 'new.png' }, 103)).toMatchObject({
      ok: true
    })
    expect(await manager.readResource({ ...request, reference: 'old.png' }, 103)).toMatchObject({
      ok: false,
      error: { code: 'resource-not-readable' }
    })
  }, 10_000)

  it('binds resource reads to an owned session and current chapter, then revokes on close', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](chapters/start.md)\n',
      'chapters/start.md': '# Start\n![Cover](../assets/cover.png)\n'
    })
    await fs.mkdir(path.join(root, 'assets'))
    await fs.writeFile(path.join(root, 'assets', 'cover.png'), testPng)
    await fs.writeFile(path.join(root, 'assets', 'unreferenced.png'), testPng)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/resource-user-data')
    const opened = await manager.openPicker({ sender: { id: 104 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 104)
    ).toMatchObject({ ok: true })
    const request = {
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId,
      reference: '../assets/cover.png'
    }

    const read = await manager.readResource(request, 104)
    expect(read).toMatchObject({
      ok: true,
      value: {
        mediaType: 'image/png',
        byteLength: testPng.byteLength,
        width: 1,
        height: 1,
        frameCount: 1,
        decodePixels: 1
      }
    })
    expect(JSON.stringify(read)).not.toContain(root)
    expect(await manager.readResource(request, 104)).toMatchObject({
      ok: false,
      error: { code: 'resource-not-readable' }
    })
    expect(
      await manager.readResource({ ...request, reference: '../assets/unreferenced.png' }, 104)
    ).toMatchObject({
      ok: false,
      error: { code: 'resource-not-readable' }
    })
    expect(await manager.readResource(request, 105)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(manager.closeSession(opened.value.sessionId, 104)).toEqual({ ok: true, value: true })
    expect(await manager.readResource(request, 104)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
  })

  it('withholds resource bytes when the session closes after the file is pinned', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': '# Start\n\n![Cover](cover.png)\n'
    })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    mocks.selectedPath = root
    const pinned = deferredValue<void>()
    const release = deferredValue<void>()
    const manager = new BookSessionManager(
      '/resource-revoke-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          pinned.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 106 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 106)
    const reading = manager.readResource(
      {
        sessionId: opened.value.sessionId,
        resourceToken: opened.value.resourceToken,
        nodeId: opened.value.entryNodeId,
        reference: 'cover.png'
      },
      106
    )
    await pinned.promise
    expect(manager.closeSession(opened.value.sessionId, 106)).toEqual({ ok: true, value: true })
    release.resolve()
    expect(await reading).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
  })

  it('revokes a pinned resource read when refresh replaces its session', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': '# Start\n\n![Cover](cover.png)\n'
    })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    mocks.selectedPath = root
    const pinned = deferredValue<void>()
    const release = deferredValue<void>()
    const manager = new BookSessionManager(
      '/resource-refresh-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          pinned.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 107 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 107)
    const oldRequest = {
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId,
      reference: 'cover.png'
    }
    const reading = manager.readResource(oldRequest, 107)
    await pinned.promise
    const refreshed = await manager.refresh(opened.value.sessionId, 107)
    expect(refreshed.ok).toBe(true)
    release.resolve()
    expect(await reading).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(await manager.readResource(oldRequest, 107)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    if (!refreshed.ok || !refreshed.value.entryNodeId) return
    expect(refreshed.value.resourceToken).not.toBe(oldRequest.resourceToken)
    await manager.readChapter(refreshed.value.sessionId, refreshed.value.entryNodeId, 107)
    expect(
      await manager.readResource(
        {
          sessionId: refreshed.value.sessionId,
          resourceToken: refreshed.value.resourceToken,
          nodeId: refreshed.value.entryNodeId,
          reference: 'cover.png'
        },
        107
      )
    ).toMatchObject({ ok: true, value: { mediaType: 'image/png' } })
  })

  it('queues per-owner resource reads so slow prior work cannot starve a new chapter', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': [
        '# Start',
        '![Old one](old-1.png)',
        '![Old two](old-2.png)',
        '![New one](new-1.png)',
        '![New two](new-2.png)'
      ].join('\n\n')
    })
    for (const name of ['old-1.png', 'old-2.png', 'new-1.png', 'new-2.png']) {
      await fs.writeFile(path.join(root, name), testPng)
    }
    mocks.selectedPath = root
    const openedCount = deferredValue<void>()
    const release = deferredValue<void>()
    const openedReferences: string[] = []
    let count = 0
    const manager = new BookSessionManager(
      '/resource-budget-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          count += 1
          if (count === 2) openedCount.resolve()
          if (count <= 2) await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 108 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 108)
    const request = {
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId
    }
    const read = (reference: string) => {
      openedReferences.push(reference)
      return manager.readResource({ ...request, reference }, 108)
    }
    const first = read('old-1.png')
    const second = read('old-2.png')
    await openedCount.promise
    const third = read('new-1.png')
    const fourth = read('new-2.png')
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(count).toBe(2)
    release.resolve()
    expect((await Promise.all([first, second, third, fourth])).every((result) => result.ok)).toBe(
      true
    )
    expect(openedReferences).toEqual(['old-1.png', 'old-2.png', 'new-1.png', 'new-2.png'])
    expect(count).toBe(4)
  }, 10_000)

  it('admits another owner immediately while the first owner has two active and eight queued', async () => {
    const root = await makeRasterBook(11)
    mocks.selectedPath = root
    const firstOwnerOpened = deferredValue<void>()
    const releaseFirstOwner = deferredValue<void>()
    const openedReferences: string[] = []
    let firstOwnerOpenCount = 0
    const manager = new BookSessionManager(
      '/resource-fair-admission-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async (reference) => {
          openedReferences.push(reference ?? '')
          if (reference !== 'image-10.png') {
            firstOwnerOpenCount += 1
            if (firstOwnerOpenCount === 2) firstOwnerOpened.resolve()
            await releaseFirstOwner.promise
          }
        }
      }
    )
    const firstSession = await manager.openPicker({ sender: { id: 111 } } as never)
    const secondSession = await manager.openPicker({ sender: { id: 112 } } as never)
    expect(firstSession.ok && secondSession.ok).toBe(true)
    if (
      !firstSession.ok ||
      !firstSession.value.entryNodeId ||
      !secondSession.ok ||
      !secondSession.value.entryNodeId
    ) {
      return
    }
    await manager.readChapter(firstSession.value.sessionId, firstSession.value.entryNodeId, 111)
    await manager.readChapter(secondSession.value.sessionId, secondSession.value.entryNodeId, 112)
    const requestFor = (session: BookSessionDto, reference: string) => ({
      sessionId: session.sessionId,
      resourceToken: session.resourceToken,
      nodeId: session.entryNodeId as string,
      reference
    })
    const firstOwnerReads = [
      manager.readResource(requestFor(firstSession.value, 'image-0.png'), 111),
      manager.readResource(requestFor(firstSession.value, 'image-1.png'), 111)
    ]
    await firstOwnerOpened.promise
    for (let index = 2; index < 10; index += 1) {
      firstOwnerReads.push(
        manager.readResource(requestFor(firstSession.value, `image-${index}.png`), 111)
      )
    }

    expect(
      await manager.readResource(requestFor(secondSession.value, 'image-10.png'), 112)
    ).toMatchObject({ ok: true })
    expect(new Set(openedReferences.slice(0, 2))).toEqual(new Set(['image-0.png', 'image-1.png']))
    expect(openedReferences[2]).toBe('image-10.png')

    releaseFirstOwner.resolve()
    expect((await Promise.all(firstOwnerReads)).every((result) => result.ok)).toBe(true)
  }, 10_000)

  it('caps each owner at eight queued reads without burning rejected references', async () => {
    const root = await makeRasterBook(11)
    mocks.selectedPath = root
    const bothOpened = deferredValue<void>()
    const release = deferredValue<void>()
    const openedReferences: string[] = []
    let openCount = 0
    const manager = new BookSessionManager(
      '/resource-owner-queue-cap-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async (reference) => {
          openedReferences.push(reference ?? '')
          openCount += 1
          if (openCount === 2) bothOpened.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 113 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 113)
    const request = (reference: string) => ({
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId as string,
      reference
    })
    const reads = [
      manager.readResource(request('image-0.png'), 113),
      manager.readResource(request('image-1.png'), 113)
    ]
    await bothOpened.promise
    for (let index = 2; index < 10; index += 1) {
      reads.push(manager.readResource(request(`image-${index}.png`), 113))
    }
    expect(await manager.readResource(request('image-2.png'), 113)).toMatchObject({
      ok: false,
      error: { code: 'resource-not-readable' }
    })
    expect(await manager.readResource(request('image-10.png'), 113)).toMatchObject({
      ok: false,
      error: { code: 'resource-busy' }
    })
    expect(
      (
        manager as unknown as {
          queuedResourceReadsByOwner: Map<number, number>
        }
      ).queuedResourceReadsByOwner.get(113)
    ).toBe(8)

    release.resolve()
    expect((await Promise.all(reads)).every((result) => result.ok)).toBe(true)
    expect(new Set(openedReferences.slice(0, 2))).toEqual(new Set(['image-0.png', 'image-1.png']))
    expect(openedReferences.slice(2, 10)).toEqual(
      Array.from({ length: 8 }, (_, index) => `image-${index + 2}.png`)
    )
    expect(await manager.readResource(request('image-10.png'), 113)).toMatchObject({ ok: true })
  }, 10_000)

  it('caps the global resource queue at 64 and keeps duplicate requests out of it', async () => {
    const root = await makeRasterBook(9)
    mocks.selectedPath = root
    const allOpened = deferredValue<void>()
    const release = deferredValue<void>()
    let openCount = 0
    const manager = new BookSessionManager(
      '/resource-global-queue-cap-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          openCount += 1
          if (openCount === 8) allOpened.resolve()
          await release.promise
        }
      }
    )
    const sessions = new Map<number, BookSessionDto>()
    for (let ownerId = 220; ownerId <= 232; ownerId += 1) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.entryNodeId) return
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, ownerId)
      sessions.set(ownerId, opened.value)
    }
    const request = (ownerId: number, index: number) => {
      const session = sessions.get(ownerId)
      if (!session?.entryNodeId) throw new Error('missing resource test session')
      return {
        sessionId: session.sessionId,
        resourceToken: session.resourceToken,
        nodeId: session.entryNodeId,
        reference: `image-${index}.png`
      }
    }
    const active = []
    for (let ownerId = 220; ownerId < 224; ownerId += 1) {
      active.push(manager.readResource(request(ownerId, 0), ownerId))
      active.push(manager.readResource(request(ownerId, 1), ownerId))
    }
    await allOpened.promise
    const queued = []
    for (let ownerId = 224; ownerId < 232; ownerId += 1) {
      for (let index = 0; index < 8; index += 1) {
        queued.push(manager.readResource(request(ownerId, index), ownerId))
      }
    }
    expect(
      (manager as unknown as { queuedResourceReads: unknown[] }).queuedResourceReads
    ).toHaveLength(64)
    expect(await manager.readResource(request(224, 0), 224)).toMatchObject({
      ok: false,
      error: { code: 'resource-not-readable' }
    })
    expect(
      (manager as unknown as { queuedResourceReads: unknown[] }).queuedResourceReads
    ).toHaveLength(64)
    expect(await manager.readResource(request(232, 0), 232)).toMatchObject({
      ok: false,
      error: { code: 'resource-busy' }
    })

    for (let ownerId = 224; ownerId < 232; ownerId += 1) manager.cleanupOwner(ownerId)
    expect((await Promise.all(queued)).every((result) => !result.ok)).toBe(true)
    release.resolve()
    await Promise.all(active)
    expect(await manager.readResource(request(232, 0), 232)).toMatchObject({ ok: true })
    manager.cleanupOwner(232)
    expect(
      (manager as unknown as { queuedResourceReadsByOwner: Map<number, number> })
        .queuedResourceReadsByOwner.size
    ).toBe(0)
  }, 15_000)

  it('never admits a timed-out read, retains its one-shot lease, and clears queue counters', async () => {
    const root = await makeRasterBook(4)
    mocks.selectedPath = root
    const bothOpened = deferredValue<void>()
    const release = deferredValue<void>()
    const timers = new Map<number, { callback: () => void; delay: number }>()
    let timerId = 0
    let openCount = 0
    const manager = new BookSessionManager(
      '/resource-queue-timeout-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          openCount += 1
          if (openCount === 2) bothOpened.resolve()
          if (openCount <= 2) await release.promise
        },
        resourceQueueClock: {
          setTimeout: (callback, delay) => {
            const id = ++timerId
            timers.set(id, { callback, delay })
            return id
          },
          clearTimeout: (timer) => {
            timers.delete(timer as number)
          }
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 114 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 114)
    const request = (reference: string) => ({
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId as string,
      reference
    })
    const first = manager.readResource(request('image-0.png'), 114)
    const second = manager.readResource(request('image-1.png'), 114)
    await bothOpened.promise
    const timedOut = manager.readResource(request('image-2.png'), 114)
    expect([...timers.values()].map(({ delay }) => delay)).toEqual([30_000])
    timers.values().next().value?.callback()
    expect(await timedOut).toMatchObject({
      ok: false,
      error: { code: 'resource-busy' }
    })
    expect(
      (
        manager as unknown as {
          queuedResourceReadsByOwner: Map<number, number>
        }
      ).queuedResourceReadsByOwner.size
    ).toBe(0)

    release.resolve()
    await Promise.all([first, second])
    expect(openCount).toBe(2)
    expect(await manager.readResource(request('image-2.png'), 114)).toMatchObject({
      ok: false,
      error: { code: 'resource-not-readable' }
    })
    expect(await manager.readResource(request('image-3.png'), 114)).toMatchObject({ ok: true })
    expect(openCount).toBe(3)
  }, 10_000)

  it('binds pre-open handoff watchdogs to opaque generation tokens without ABA cleanup', async () => {
    const root = await makeRasterBook(4)
    mocks.selectedPath = root
    const initialOpened = deferredValue<void>()
    const releaseInitial = deferredValue<void>()
    const oldPreOpenEntered = deferredValue<void>()
    const releaseOldPreOpen = deferredValue<void>()
    const newDirectOpened = deferredValue<void>()
    const releaseNewDirect = deferredValue<void>()
    const newPreOpenEntered = deferredValue<void>()
    const releaseNewPreOpen = deferredValue<void>()
    const timers = new Map<number, { callback: () => void; delay: number }>()
    let timerId = 0
    let initialOpenCount = 0
    let holdInitial = true
    let holdNewDirect = false
    let holdNewQueued = false
    const manager = new BookSessionManager(
      '/resource-handoff-aba-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeResourceOpen: async (reference) => {
          if (reference === 'image-2.png') {
            oldPreOpenEntered.resolve()
            await releaseOldPreOpen.promise
          } else if (reference === 'image-1.png' && holdNewQueued) {
            newPreOpenEntered.resolve()
            await releaseNewPreOpen.promise
          }
        },
        afterResourceOpen: async (reference) => {
          if (holdInitial && (reference === 'image-0.png' || reference === 'image-1.png')) {
            initialOpenCount += 1
            if (initialOpenCount === 2) initialOpened.resolve()
            await releaseInitial.promise
          } else if (holdNewDirect && reference === 'image-0.png') {
            newDirectOpened.resolve()
            await releaseNewDirect.promise
          }
        },
        resourceQueueClock: {
          setTimeout: (callback, delay) => {
            const id = ++timerId
            timers.set(id, { callback, delay })
            return id
          },
          clearTimeout: (timer) => {
            timers.delete(timer as number)
          }
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 115 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 115)
    const requestFor = (session: BookSessionDto, reference: string) => ({
      sessionId: session.sessionId,
      resourceToken: session.resourceToken,
      nodeId: session.entryNodeId as string,
      reference
    })

    const initial = [
      manager.readResource(requestFor(opened.value, 'image-0.png'), 115),
      manager.readResource(requestFor(opened.value, 'image-1.png'), 115)
    ]
    await initialOpened.promise
    const oldQueued = manager.readResource(requestFor(opened.value, 'image-2.png'), 115)
    holdInitial = false
    releaseInitial.resolve()
    await oldPreOpenEntered.promise
    await Promise.all(initial)

    const handoffs = (
      manager as unknown as {
        pendingQueuedResourceStartsByOwner: Map<
          number,
          {
            operationId: string
            sessionId: string
            resourceToken: string
            nodeId: string
            nodeNonce: number
          }
        >
      }
    ).pendingQueuedResourceStartsByOwner
    const oldHandoff = handoffs.get(115)
    expect(oldHandoff).toMatchObject({
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId,
      nodeNonce: 1
    })
    expect(oldHandoff?.operationId).toMatch(/^[0-9a-f-]{36}$/u)
    expect([...timers.values()].map(({ delay }) => delay)).toEqual([30_000])
    timers.values().next().value?.callback()
    expect(handoffs.has(115)).toBe(false)
    expect(timers.size).toBe(0)

    const refreshed = await manager.refresh(opened.value.sessionId, 115)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok || !refreshed.value.entryNodeId) return
    await manager.readChapter(refreshed.value.sessionId, refreshed.value.entryNodeId, 115)
    holdNewDirect = true
    const newDirect = manager.readResource(requestFor(refreshed.value, 'image-0.png'), 115)
    await newDirectOpened.promise
    holdNewQueued = true
    const newQueued = manager.readResource(requestFor(refreshed.value, 'image-1.png'), 115)
    holdNewDirect = false
    releaseNewDirect.resolve()
    expect(await newDirect).toMatchObject({ ok: true })
    await newPreOpenEntered.promise
    const newHandoff = handoffs.get(115)
    expect(newHandoff).toBeDefined()
    expect(newHandoff).not.toBe(oldHandoff)
    expect(newHandoff?.operationId).not.toBe(oldHandoff?.operationId)

    releaseOldPreOpen.resolve()
    expect(await oldQueued).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(handoffs.get(115)).toBe(newHandoff)

    expect(await manager.refresh(refreshed.value.sessionId, 115)).toMatchObject({ ok: true })
    expect(handoffs.size).toBe(0)
    expect(timers.size).toBe(0)
    releaseNewPreOpen.resolve()
    expect(await newQueued).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(
      (
        manager as unknown as {
          queuedResourceReadsByOwner: Map<number, number>
          activeResourceReadsByOwner: Map<number, number>
        }
      ).queuedResourceReadsByOwner.size
    ).toBe(0)
    expect(
      (
        manager as unknown as {
          activeResourceReadsByOwner: Map<number, number>
        }
      ).activeResourceReadsByOwner.size
    ).toBe(0)
  }, 10_000)

  it('allows same-generation liveness overtaking only after the pre-open watchdog', async () => {
    const root = await makeRasterBook(4)
    mocks.selectedPath = root
    const initialOpened = deferredValue<void>()
    const releaseInitial = deferredValue<void>()
    const stuckEntered = deferredValue<void>()
    const releaseStuck = deferredValue<void>()
    const timers = new Map<number, () => void>()
    const postWatchdogOpenOrder: string[] = []
    let timerId = 0
    let initialCount = 0
    let holdInitial = true
    const manager = new BookSessionManager(
      '/resource-handoff-overtaking-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeResourceOpen: async (reference) => {
          if (reference === 'image-2.png') {
            stuckEntered.resolve()
            await releaseStuck.promise
          }
        },
        afterResourceOpen: async (reference) => {
          if (holdInitial && (reference === 'image-0.png' || reference === 'image-1.png')) {
            initialCount += 1
            if (initialCount === 2) initialOpened.resolve()
            await releaseInitial.promise
          } else if (reference) {
            postWatchdogOpenOrder.push(reference)
          }
        },
        resourceQueueClock: {
          setTimeout: (callback) => {
            const id = ++timerId
            timers.set(id, callback)
            return id
          },
          clearTimeout: (timer) => {
            timers.delete(timer as number)
          }
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 116 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 116)
    const request = (reference: string) => ({
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId as string,
      reference
    })
    const initial = [
      manager.readResource(request('image-0.png'), 116),
      manager.readResource(request('image-1.png'), 116)
    ]
    await initialOpened.promise
    const stuck = manager.readResource(request('image-2.png'), 116)
    holdInitial = false
    releaseInitial.resolve()
    await stuckEntered.promise
    await Promise.all(initial)
    expect(postWatchdogOpenOrder).toEqual([])

    expect(timers.size).toBe(1)
    timers.values().next().value?.()
    expect(timers.size).toBe(0)
    expect(await manager.readResource(request('image-3.png'), 116)).toMatchObject({ ok: true })
    expect(postWatchdogOpenOrder).toEqual(['image-3.png'])

    releaseStuck.resolve()
    expect(await stuck).toMatchObject({ ok: true })
    expect(postWatchdogOpenOrder).toEqual(['image-3.png', 'image-2.png'])
    expect(
      (
        manager as unknown as {
          pendingQueuedResourceStartsByOwner: Map<number, unknown>
          queuedResourceReadsByOwner: Map<number, number>
          activeResourceReadsByOwner: Map<number, number>
        }
      ).pendingQueuedResourceStartsByOwner.size
    ).toBe(0)
    expect(
      (manager as unknown as { queuedResourceReadsByOwner: Map<number, number> })
        .queuedResourceReadsByOwner.size
    ).toBe(0)
    expect(
      (manager as unknown as { activeResourceReadsByOwner: Map<number, number> })
        .activeResourceReadsByOwner.size
    ).toBe(0)
  }, 10_000)

  it('releases a pending pre-open handoff on chapter nonce replacement', async () => {
    const root = await makeRasterBook(3)
    mocks.selectedPath = root
    const initialOpened = deferredValue<void>()
    const releaseInitial = deferredValue<void>()
    const pendingEntered = deferredValue<void>()
    const releasePending = deferredValue<void>()
    const timers = new Map<number, () => void>()
    let timerId = 0
    let initialCount = 0
    const manager = new BookSessionManager(
      '/resource-handoff-nonce-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeResourceOpen: async (reference) => {
          if (reference === 'image-2.png') {
            pendingEntered.resolve()
            await releasePending.promise
          }
        },
        afterResourceOpen: async (reference) => {
          if (reference === 'image-0.png' || reference === 'image-1.png') {
            initialCount += 1
            if (initialCount === 2) initialOpened.resolve()
            await releaseInitial.promise
          }
        },
        resourceQueueClock: {
          setTimeout: (callback) => {
            const id = ++timerId
            timers.set(id, callback)
            return id
          },
          clearTimeout: (timer) => {
            timers.delete(timer as number)
          }
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 117 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 117)
    const request = (reference: string) => ({
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId as string,
      reference
    })
    const initial = [
      manager.readResource(request('image-0.png'), 117),
      manager.readResource(request('image-1.png'), 117)
    ]
    await initialOpened.promise
    const pending = manager.readResource(request('image-2.png'), 117)
    releaseInitial.resolve()
    await pendingEntered.promise
    await Promise.all(initial)
    expect(timers.size).toBe(1)

    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 117)
    ).toMatchObject({ ok: true })
    expect(timers.size).toBe(0)
    releasePending.resolve()
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    const state = manager as unknown as {
      pendingQueuedResourceStartsByOwner: Map<number, unknown>
      queuedResourceReadsByOwner: Map<number, number>
      activeResourceReadsByOwner: Map<number, number>
    }
    expect(state.pendingQueuedResourceStartsByOwner.size).toBe(0)
    expect(state.queuedResourceReadsByOwner.size).toBe(0)
    expect(state.activeResourceReadsByOwner.size).toBe(0)
  }, 10_000)

  it('releases a pending pre-open handoff when the generation budget fail-stops', async () => {
    const names = Array.from({ length: 6 }, (_, index) => `budget-${index}.gif`)
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': ['# Start', ...names.map((name) => `![${name}](${name})`)].join('\n\n')
    })
    for (const name of names) await fs.writeFile(path.join(root, name), largeCanvasGif())
    mocks.selectedPath = root
    const boundaryOpened = deferredValue<void>()
    const releaseFourth = deferredValue<void>()
    const releaseFifth = deferredValue<void>()
    const pendingEntered = deferredValue<void>()
    const releasePending = deferredValue<void>()
    const timers = new Map<number, () => void>()
    let timerId = 0
    let boundaryCount = 0
    const manager = new BookSessionManager(
      '/resource-handoff-budget-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeResourceOpen: async (reference) => {
          if (reference === names[5]) {
            pendingEntered.resolve()
            await releasePending.promise
          }
        },
        afterResourceOpen: async (reference) => {
          if (reference === names[3] || reference === names[4]) {
            boundaryCount += 1
            if (boundaryCount === 2) boundaryOpened.resolve()
            await (reference === names[3] ? releaseFourth.promise : releaseFifth.promise)
          }
        },
        resourceQueueClock: {
          setTimeout: (callback) => {
            const id = ++timerId
            timers.set(id, callback)
            return id
          },
          clearTimeout: (timer) => {
            timers.delete(timer as number)
          }
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 118 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 118)
    const request = (reference: string) => ({
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId as string,
      reference
    })
    for (const reference of names.slice(0, 3)) {
      expect(await manager.readResource(request(reference), 118)).toMatchObject({ ok: true })
    }
    const fourth = manager.readResource(request(names[3] as string), 118)
    const fifth = manager.readResource(request(names[4] as string), 118)
    await boundaryOpened.promise
    const pending = manager.readResource(request(names[5] as string), 118)
    releaseFourth.resolve()
    expect(await fourth).toMatchObject({ ok: true })
    await pendingEntered.promise
    expect(timers.size).toBe(1)
    releaseFifth.resolve()
    expect(await fifth).toMatchObject({
      ok: false,
      error: { code: 'resource-too-large' }
    })
    expect(timers.size).toBe(0)
    releasePending.resolve()
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'resource-too-large' }
    })
    const state = manager as unknown as {
      pendingQueuedResourceStartsByOwner: Map<number, unknown>
      queuedResourceReadsByOwner: Map<number, number>
      activeResourceReadsByOwner: Map<number, number>
    }
    expect(state.pendingQueuedResourceStartsByOwner.size).toBe(0)
    expect(state.queuedResourceReadsByOwner.size).toBe(0)
    expect(state.activeResourceReadsByOwner.size).toBe(0)
  }, 15_000)

  it.each(['closeSession', 'cleanupOwner'] as const)(
    'releases a pending pre-open handoff on %s',
    async (operation) => {
      const root = await makeRasterBook(3)
      mocks.selectedPath = root
      const initialOpened = deferredValue<void>()
      const releaseInitial = deferredValue<void>()
      const pendingEntered = deferredValue<void>()
      const releasePending = deferredValue<void>()
      const timers = new Map<number, () => void>()
      let timerId = 0
      let initialCount = 0
      const ownerId = operation === 'closeSession' ? 119 : 120
      const manager = new BookSessionManager(
        `/resource-handoff-${operation}-user-data`,
        undefined,
        undefined,
        undefined,
        {
          beforeResourceOpen: async (reference) => {
            if (reference === 'image-2.png') {
              pendingEntered.resolve()
              await releasePending.promise
            }
          },
          afterResourceOpen: async (reference) => {
            if (reference === 'image-0.png' || reference === 'image-1.png') {
              initialCount += 1
              if (initialCount === 2) initialOpened.resolve()
              await releaseInitial.promise
            }
          },
          resourceQueueClock: {
            setTimeout: (callback) => {
              const id = ++timerId
              timers.set(id, callback)
              return id
            },
            clearTimeout: (timer) => {
              timers.delete(timer as number)
            }
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.entryNodeId) return
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, ownerId)
      const request = (reference: string) => ({
        sessionId: opened.value.sessionId,
        resourceToken: opened.value.resourceToken,
        nodeId: opened.value.entryNodeId as string,
        reference
      })
      const initial = [
        manager.readResource(request('image-0.png'), ownerId),
        manager.readResource(request('image-1.png'), ownerId)
      ]
      await initialOpened.promise
      const pending = manager.readResource(request('image-2.png'), ownerId)
      releaseInitial.resolve()
      await pendingEntered.promise
      await Promise.all(initial)
      expect(timers.size).toBe(1)

      if (operation === 'closeSession') {
        expect(manager.closeSession(opened.value.sessionId, ownerId)).toEqual({
          ok: true,
          value: true
        })
      } else {
        manager.cleanupOwner(ownerId)
      }
      expect(timers.size).toBe(0)
      releasePending.resolve()
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: 'session-not-found' }
      })
      const state = manager as unknown as {
        pendingQueuedResourceStartsByOwner: Map<number, unknown>
        queuedResourceReadsByOwner: Map<number, number>
        activeResourceReadsByOwner: Map<number, number>
      }
      expect(state.pendingQueuedResourceStartsByOwner.size).toBe(0)
      expect(state.queuedResourceReadsByOwner.size).toBe(0)
      expect(state.activeResourceReadsByOwner.size).toBe(0)
    },
    10_000
  )

  it('cancels queued and in-flight resource reads when the chapter nonce changes', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': '# Start\n\n![One](one.png)\n\n![Two](two.png)\n\n![Three](three.png)\n'
    })
    for (const name of ['one.png', 'two.png', 'three.png']) {
      await fs.writeFile(path.join(root, name), testPng)
    }
    mocks.selectedPath = root
    const bothOpened = deferredValue<void>()
    const release = deferredValue<void>()
    let openCount = 0
    const manager = new BookSessionManager(
      '/resource-queue-stale-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          openCount += 1
          if (openCount === 2) bothOpened.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 110 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 110)
    const request = {
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId
    }
    const first = manager.readResource({ ...request, reference: 'one.png' }, 110)
    const second = manager.readResource({ ...request, reference: 'two.png' }, 110)
    await bothOpened.promise
    const queued = manager.readResource({ ...request, reference: 'three.png' }, 110)

    expect(
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 110)
    ).toMatchObject({ ok: true })
    expect(await queued).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' }
    })
    expect(openCount).toBe(2)
    release.resolve()
    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false })
    ])
  }, 10_000)

  it('enforces the global resource concurrency budget across owners', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': '# Start\n\n![Cover](cover.png)\n'
    })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    mocks.selectedPath = root
    const allOpened = deferredValue<void>()
    const release = deferredValue<void>()
    let count = 0
    const manager = new BookSessionManager(
      '/resource-global-budget-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          count += 1
          if (count === 8) allOpened.resolve()
          await release.promise
        }
      }
    )
    const sessions = []
    for (let ownerId = 200; ownerId < 209; ownerId += 1) {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok || !opened.value.entryNodeId) return
      await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, ownerId)
      sessions.push({ ownerId, session: opened.value })
    }
    const reads = sessions.slice(0, 8).map(({ ownerId, session }) =>
      manager.readResource(
        {
          sessionId: session.sessionId,
          resourceToken: session.resourceToken,
          nodeId: session.entryNodeId as string,
          reference: 'cover.png'
        },
        ownerId
      )
    )
    await allOpened.promise
    const ninth = sessions[8]
    expect(ninth).toBeDefined()
    if (!ninth || !ninth.session.entryNodeId) return
    const ninthRead = manager.readResource(
      {
        sessionId: ninth.session.sessionId,
        resourceToken: ninth.session.resourceToken,
        nodeId: ninth.session.entryNodeId,
        reference: 'cover.png'
      },
      ninth.ownerId
    )
    await Promise.resolve()
    expect(count).toBe(8)
    release.resolve()
    expect((await Promise.all(reads)).every((result) => result.ok)).toBe(true)
    expect(await ninthRead).toMatchObject({ ok: true })
  })

  it('atomically fail-stops a chapter generation at the cumulative decode budget', async () => {
    const names = Array.from({ length: 6 }, (_, index) => `large-${index}.gif`)
    const root = await makeBook({
      'SUMMARY.md': '- [Start](start.md)\n',
      'start.md': ['# Start', ...names.map((name) => `![${name}](${name})`)].join('\n\n')
    })
    for (const name of names) await fs.writeFile(path.join(root, name), largeCanvasGif())
    mocks.selectedPath = root
    let openedFiles = 0
    const manager = new BookSessionManager(
      '/resource-cumulative-budget-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterResourceOpen: async () => {
          openedFiles += 1
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 109 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 109)
    const request = {
      sessionId: opened.value.sessionId,
      resourceToken: opened.value.resourceToken,
      nodeId: opened.value.entryNodeId
    }

    for (const reference of names.slice(0, 3)) {
      expect(await manager.readResource({ ...request, reference }, 109)).toMatchObject({
        ok: true,
        value: { decodePixels: 30_000_000 }
      })
    }
    const boundary = await Promise.all(
      names.slice(3, 5).map((reference) => manager.readResource({ ...request, reference }, 109))
    )
    expect(boundary.filter((result) => result.ok)).toHaveLength(1)
    expect(boundary.filter((result) => !result.ok)).toHaveLength(1)
    expect(boundary.find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { code: 'resource-too-large' }
    })
    expect(openedFiles).toBe(5)

    expect(await manager.readResource({ ...request, reference: names[5] }, 109)).toMatchObject({
      ok: false,
      error: { code: 'resource-too-large' }
    })
    expect(openedFiles).toBe(5)
  }, 15_000)

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

  it('edits a model-owned chapter through an opaque lease and preserves BOM/CRLF', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '\uFEFF# Start\r\nOriginal\r\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-user-data')
    const opened = await manager.openPicker({ sender: { id: 41 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.nodes[0]) return

    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 41)
    expect(begun).toMatchObject({
      ok: true,
      value: {
        sessionId: opened.value.sessionId,
        nodeId: opened.value.nodes[0].nodeId,
        markdown: '# Start\nOriginal\n',
        format: { bom: true, lineEnding: 'crlf', mixedLineEndings: false }
      }
    })
    expect(JSON.stringify(begun)).not.toContain(root)
    if (!begun.ok) return

    const saved = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Start\nChanged\n'
      },
      41
    )
    expect(saved).toMatchObject({
      ok: true,
      value: { readOnly: false, nodeId: opened.value.nodes[0].nodeId }
    })
    expect(await fs.readFile(path.join(root, 'README.md'))).toEqual(
      Buffer.from('\uFEFF# Start\r\nChanged\r\n')
    )
  })

  it('rejects external changes by default and consumes a one-shot overwrite token', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\nOriginal\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-conflict-user-data')
    const opened = await manager.openPicker({ sender: { id: 42 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 42)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    await fs.writeFile(path.join(root, 'README.md'), '# Start\nExternal\n')
    const conflict = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Start\nMine\n'
      },
      42
    )
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'edit-conflict', overwriteToken: expect.any(String) }
    })
    if (conflict.ok || !conflict.error.overwriteToken) return
    const overwritten = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Start\nMine\n',
        overwriteToken: conflict.error.overwriteToken
      },
      42
    )
    expect(overwritten.ok).toBe(true)
    expect(
      await manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# Start\nAgain\n',
          overwriteToken: conflict.error.overwriteToken
        },
        42
      )
    ).toMatchObject({ ok: false })
  })

  it('requires mixed-EOL confirmation and closes leases with their owner', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\r\nMixed\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-mixed-user-data')
    const opened = await manager.openPicker({ sender: { id: 43 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 43)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(
      await manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# Start\nChanged\n'
        },
        43
      )
    ).toMatchObject({ ok: false, error: { code: 'edit-mixed-line-endings' } })
    expect(manager.closeEdit(begun.value.editId, 44)).toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
    expect(manager.closeEdit(begun.value.editId, 43)).toEqual({ ok: true, value: true })
  })

  it('binds overwrite grants to the exact candidate and rejects concurrent mutation', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\nOriginal\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-grant-user-data')
    const opened = await manager.openPicker({ sender: { id: 45 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 45)
    if (!begun.ok) return

    await fs.writeFile(path.join(root, 'README.md'), '# Start\nExternal\n')
    const conflict = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Start\nMine\n'
      },
      45
    )
    if (conflict.ok || !conflict.error.overwriteToken) return
    await expect(
      manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# Start\nDifferent candidate\n',
          overwriteToken: conflict.error.overwriteToken
        },
        45
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'edit-conflict' } })

    const retry = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Start\nMine\n'
      },
      45
    )
    if (retry.ok || !retry.error.overwriteToken) return
    const request = {
      editId: begun.value.editId,
      revision: begun.value.revision,
      markdown: '# Start\nMine\n',
      overwriteToken: retry.error.overwriteToken
    }
    const [first, duplicate] = await Promise.all([
      manager.saveEdit(request, 45),
      manager.saveEdit(request, 45)
    ])
    expect(first.ok).toBe(true)
    expect(duplicate).toEqual(first)
  })

  it('revokes edit generations with their session and detects replaced ancestors', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](chapters/README.md)\n',
      'chapters/README.md': '# Start\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-ancestry-user-data')
    const opened = await manager.openPicker({ sender: { id: 46 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 46)
    if (!begun.ok) return

    await fs.rename(path.join(root, 'chapters'), path.join(root, 'old-chapters'))
    await fs.mkdir(path.join(root, 'chapters'))
    await fs.writeFile(path.join(root, 'chapters/README.md'), '# Replacement\n')
    expect(await manager.reloadEdit(begun.value.editId, 46)).toMatchObject({
      ok: false,
      error: { code: 'edit-read-only' }
    })

    const reopened = await manager.refresh(opened.value.sessionId, 46)
    if (!reopened.ok || !reopened.value.nodes[0]) return
    const second = await manager.beginEdit(
      reopened.value.sessionId,
      reopened.value.nodes[0].nodeId,
      46
    )
    if (!second.ok) return
    expect(manager.closeSession(reopened.value.sessionId, 46)).toEqual({ ok: true, value: true })
    expect(await manager.reloadEdit(second.value.editId, 46)).toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
  })

  it('rejects read-only and unbounded or lone-CR edit inputs', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-input-user-data')
    const opened = await manager.openPicker({ sender: { id: 47 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 47)
    if (!begun.ok) return
    expect(
      await manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# lone\rreturn'
        },
        47
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(
      await manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '💥'.repeat(3 * 1024 * 1024)
        },
        47
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    manager.closeEdit(begun.value.editId, 47)
    await fs.chmod(path.join(root, 'README.md'), 0o444)
    expect(
      await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 47)
    ).toMatchObject({
      ok: false,
      error: { code: 'edit-read-only' }
    })
  })

  it('reports a committed save as durability-uncertain when directory fsync fails', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-fsync-user-data')
    const opened = await manager.openPicker({ sender: { id: 48 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 48)
    if (!begun.ok) return

    vi.spyOn(
      manager as unknown as { syncBookEditDirectorySync: () => void },
      'syncBookEditDirectorySync'
    ).mockImplementationOnce(() => {
      throw new Error('injected directory fsync failure')
    })
    const saved = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Committed\n'
      },
      48
    )
    expect(saved).toMatchObject({ ok: true, value: { durabilityUncertain: true } })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Committed\n')
  })

  it('keeps post-rename final-read failure in the committed uncertain state', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Start\n'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/edit-final-read-user-data')
    const opened = await manager.openPicker({ sender: { id: 49 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 49)
    if (!begun.ok) return

    const chapterPath = path.join(root, 'README.md')
    vi.spyOn(
      manager as unknown as { verifyCommittedBookEditSync: () => boolean },
      'verifyCommittedBookEditSync'
    ).mockReturnValueOnce(false)
    const saved = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Committed despite verification failure\n'
      },
      49
    )
    expect(saved).toMatchObject({
      ok: false,
      error: { code: 'edit-commit-uncertain', committed: true }
    })
    expect(await manager.reloadEdit(begun.value.editId, 49)).toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
    expect(await fs.readFile(chapterPath, 'utf8')).toContain(
      'Committed despite verification failure'
    )
  })

  it('aborts and cleans a pre-commit temp when the edit is closed', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    mocks.selectedPath = root
    const manager = new BookSessionManager(
      '/edit-close-precommit-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterEditTempSync: async () => {
          reached.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 50 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 50)
    if (!begun.ok) return
    const saving = manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Candidate\n'
      },
      50
    )
    await reached.promise
    expect(manager.closeEdit(begun.value.editId, 50)).toEqual({ ok: true, value: true })
    release.resolve()
    await expect(saving).resolves.toMatchObject({
      ok: false,
      error: { code: 'edit-write-failed' }
    })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Original\n')
    expect((await fs.readdir(root)).some((name) => name.startsWith('.leafbook-'))).toBe(false)
  })

  it('rejects a final target swap before the synchronous commit boundary', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    mocks.selectedPath = root
    const chapterPath = path.join(root, 'README.md')
    const movedPath = path.join(root, 'README-old.md')
    const manager = new BookSessionManager(
      '/edit-final-swap-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeEditCommitCritical: async () => {
          await fs.rename(chapterPath, movedPath)
          await fs.writeFile(chapterPath, '# Replacement\n')
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 51 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 51)
    if (!begun.ok) return
    await expect(
      manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# Candidate\n'
        },
        51
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'edit-write-failed' } })
    expect(await fs.readFile(chapterPath, 'utf8')).toBe('# Replacement\n')
    expect(await fs.readFile(movedPath, 'utf8')).toBe('# Original\n')
  })

  it('rejects an oversized same-inode target before the final synchronous read', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    mocks.selectedPath = root
    const chapterPath = path.join(root, 'README.md')
    const before = await fs.stat(chapterPath, { bigint: true })
    const syncRead = vi.spyOn(fsSync, 'readFileSync')
    const syncRename = vi.spyOn(fsSync, 'renameSync')
    const manager = new BookSessionManager(
      '/edit-final-oversize-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeEditCommitCritical: async () => {
          await fs.appendFile(chapterPath, Buffer.alloc(8 * 1024 * 1024 + 1, 0x78))
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 58 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 58)
    if (!begun.ok) return
    await expect(
      manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# Candidate\n'
        },
        58
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'edit-write-failed' } })
    const after = await fs.stat(chapterPath, { bigint: true })
    expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino })
    expect(after.size).toBeGreaterThan(BigInt(8 * 1024 * 1024))
    expect(syncRead).not.toHaveBeenCalled()
    expect(syncRename).not.toHaveBeenCalled()
    const descriptor = await fs.open(chapterPath, 'r')
    try {
      const prefix = Buffer.alloc(11)
      await descriptor.read(prefix, 0, prefix.length, 0)
      expect(prefix.toString()).toBe('# Original\n')
    } finally {
      await descriptor.close()
    }
  })

  it('finishes the atomic commit before honoring a close from the critical hook', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    mocks.selectedPath = root
    let editId = ''
    const manager = new BookSessionManager(
      '/edit-critical-close-user-data',
      undefined,
      undefined,
      undefined,
      {
        editCommitCriticalStarted: () => {
          expect(manager.closeEdit(editId, 52)).toEqual({ ok: true, value: true })
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 52 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 52)
    if (!begun.ok) return
    editId = begun.value.editId
    const saved = await manager.saveEdit(
      {
        editId,
        revision: begun.value.revision,
        markdown: '# Candidate\n'
      },
      52
    )
    expect(saved).toMatchObject({ ok: true, value: { readOnly: true } })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Candidate\n')
    expect(await manager.reloadEdit(editId, 52)).toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
  })

  it('finishes the atomic commit before honoring critical session revocation', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    mocks.selectedPath = root
    let sessionId = ''
    const manager = new BookSessionManager(
      '/edit-critical-session-close-user-data',
      undefined,
      undefined,
      undefined,
      {
        editCommitCriticalStarted: () => {
          expect(manager.closeSession(sessionId, 57)).toEqual({ ok: true, value: true })
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 57 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    sessionId = opened.value.sessionId
    const begun = await manager.beginEdit(sessionId, opened.value.nodes[0].nodeId, 57)
    if (!begun.ok) return
    const saved = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Candidate\n'
      },
      57
    )
    expect(saved).toMatchObject({ ok: true, value: { readOnly: true } })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Candidate\n')
  })

  it('lets public refresh revoke a pre-commit save without sharing its private refresh', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    mocks.selectedPath = root
    const manager = new BookSessionManager(
      '/edit-public-refresh-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterEditTempSync: async () => {
          reached.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 53 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 53)
    if (!begun.ok) return
    const saving = manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Candidate\n'
      },
      53
    )
    await reached.promise
    const refreshing = manager.refresh(opened.value.sessionId, 53)
    release.resolve()
    await expect(refreshing).resolves.toMatchObject({ ok: true })
    await expect(saving).resolves.toMatchObject({
      ok: false,
      error: { code: 'edit-write-failed' }
    })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Original\n')
  })

  it('lets a public refresh started after commit observe bytes and revoke the edit', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    mocks.selectedPath = root
    let refresh: Promise<BookReaderResult<BookSessionDto>> | null = null
    let sessionId = ''
    const manager = new BookSessionManager(
      '/edit-postcommit-refresh-user-data',
      undefined,
      undefined,
      undefined,
      {
        editCommitCriticalStarted: () => {
          queueMicrotask(() => {
            refresh = manager.refresh(sessionId, 54)
          })
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 54 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    sessionId = opened.value.sessionId
    const begun = await manager.beginEdit(sessionId, opened.value.nodes[0].nodeId, 54)
    if (!begun.ok) return
    const saved = await manager.saveEdit(
      {
        editId: begun.value.editId,
        revision: begun.value.revision,
        markdown: '# Candidate\n'
      },
      54
    )
    expect(saved).toMatchObject({ ok: true, value: { readOnly: true } })
    await vi.waitFor(() => expect(refresh).not.toBeNull())
    const refreshOperation = refresh as Promise<BookReaderResult<BookSessionDto>> | null
    if (!refreshOperation) return
    const refreshed = await refreshOperation
    expect(refreshed).toMatchObject({ ok: true })
    if (!refreshed.ok || !refreshed.value.nodes[0]) return
    await expect(
      manager.readChapter(refreshed.value.sessionId, refreshed.value.nodes[0].nodeId, 54)
    ).resolves.toMatchObject({ ok: true, value: { markdown: '# Candidate\n' } })
    await expect(manager.reloadEdit(begun.value.editId, 54)).resolves.toMatchObject({
      ok: false,
      error: { code: 'edit-not-found' }
    })
  })

  it('rejects a root swap at the final synchronous commit check', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    const movedRoot = `${root}-authorized`
    temporaryDirectories.push(movedRoot)
    mocks.selectedPath = root
    const manager = new BookSessionManager(
      '/edit-final-root-swap-user-data',
      undefined,
      undefined,
      undefined,
      {
        beforeEditCommitCritical: async () => {
          await fs.rename(root, movedRoot)
          await fs.mkdir(root)
          await fs.writeFile(path.join(root, 'README.md'), '# Replacement\n')
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 55 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    const begun = await manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 55)
    if (!begun.ok) return
    await expect(
      manager.saveEdit(
        {
          editId: begun.value.editId,
          revision: begun.value.revision,
          markdown: '# Candidate\n'
        },
        55
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'edit-write-failed' } })
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Replacement\n')
    expect(await fs.readFile(path.join(movedRoot, 'README.md'), 'utf8')).toBe('# Original\n')
  })

  it('does not issue or mutate a lease after a begin/reload final-read swap', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n',
      'README.md': '# Original\n'
    })
    mocks.selectedPath = root
    const chapterPath = path.join(root, 'README.md')
    let operationToSwap: 'begin' | 'reload' | null = 'begin'
    const manager = new BookSessionManager(
      '/edit-final-read-swap-user-data',
      undefined,
      undefined,
      undefined,
      {
        afterEditRead: async (operation) => {
          if (operation !== operationToSwap) return
          operationToSwap = null
          const prior = `${chapterPath}-${operation}`
          await fs.rename(chapterPath, prior)
          await fs.writeFile(chapterPath, `# ${operation} replacement\n`)
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 56 } } as never)
    if (!opened.ok || !opened.value.nodes[0]) return
    await expect(
      manager.beginEdit(opened.value.sessionId, opened.value.nodes[0].nodeId, 56)
    ).resolves.toMatchObject({ ok: false })

    const refreshed = await manager.refresh(opened.value.sessionId, 56)
    if (!refreshed.ok || !refreshed.value.nodes[0]) return
    const begun = await manager.beginEdit(
      refreshed.value.sessionId,
      refreshed.value.nodes[0].nodeId,
      56
    )
    if (!begun.ok) return
    operationToSwap = 'reload'
    await expect(manager.reloadEdit(begun.value.editId, 56)).resolves.toMatchObject({
      ok: false,
      error: { code: 'edit-read-only' }
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

  it('searches only model-owned unique chapters without exposing filesystem paths', async () => {
    const root = await makeBook({
      'SUMMARY.md':
        '- [First title](README.md)\n- [Duplicate alias](README.md)\n- [Second](second.md)\n',
      'README.md':
        '---\ntags: [phase-six]\n---\n# First\n\nLeafBook search needle\n\n## Target\n\n```ts\nconst codeNeedle = true\n```',
      'second.md': '# Second\n\nOther text',
      'orphan.md': '# Orphan\n\nLeafBook search needle'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/search-boundary-user-data')
    const opened = await manager.openPicker({ sender: { id: 71 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const found = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'leafbook needle' },
      71
    )
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.value.results).toHaveLength(1)
    expect(found.value.index).toMatchObject({
      eligibleDocuments: 2,
      indexedDocuments: 2,
      omittedDocuments: 0,
      partial: false
    })
    expect(JSON.stringify(found.value)).not.toContain(root)
    expect(JSON.stringify(found.value)).not.toContain('README.md')

    const tag = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'phase-six' },
      71
    )
    expect(tag.ok && tag.value.results[0]?.matches[0]?.kind).toBe('tag')
    const code = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'codeneedle' },
      71
    )
    expect(code.ok && code.value.results[0]?.matches[0]?.fragment).toBe('Target')
    expect(
      await manager.search(
        opened.value.sessionId,
        { searchId: randomUUID(), query: 'leafbook' },
        72
      )
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('keeps a shared index build alive when one search waiter is cancelled', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [First](README.md)\n- [Second](second.md)\n',
      'README.md': '# First\n\nshared needle',
      'second.md': '# Second\n\nshared needle'
    })
    mocks.selectedPath = root
    const gate = deferredValue<void>()
    const read = vi.fn(async (rootPath: string, relativePath: string, byteLimit?: number) => {
      await gate.promise
      return safelyReadBookChapter(rootPath, relativePath, byteLimit)
    })
    const manager = new BookSessionManager('/search-cancel-user-data', loadBookFromDirectory, read)
    const opened = await manager.openPicker({ sender: { id: 73 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const firstSearchId = randomUUID()
    const secondSearchId = randomUUID()
    const first = manager.search(
      opened.value.sessionId,
      { searchId: firstSearchId, query: 'shared' },
      73
    )
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const second = manager.search(
      opened.value.sessionId,
      { searchId: secondSearchId, query: 'needle' },
      73
    )
    await Promise.resolve()
    expect(manager.cancelSearch(opened.value.sessionId, firstSearchId, 73)).toEqual({
      ok: true,
      value: true
    })
    gate.resolve()

    expect(await first).toMatchObject({ ok: false, error: { code: 'search-cancelled' } })
    const secondResult = await second
    expect(secondResult).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ totalResults: 2 }) })
    )
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('isolates a throwing progress callback and reuses the completed shared index', async () => {
    const root = await makeBook({
      'README.md': '# Progress\n\ncallback isolation needle'
    })
    mocks.selectedPath = root
    const read = vi.fn(safelyReadBookChapter)
    const manager = new BookSessionManager(
      '/search-progress-isolation-user-data',
      loadBookFromDirectory,
      read
    )
    const opened = await manager.openPicker({ sender: { id: 76 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const internal = manager as unknown as {
      sessions: Map<string, unknown>
      acquireSearchIndex: (
        session: unknown,
        waiterId: string,
        signal: AbortSignal,
        onProgress: (progress: BookSearchProgressDto) => void
      ) => Promise<unknown>
    }
    const session = internal.sessions.get(opened.value.sessionId)
    expect(session).toBeDefined()
    if (!session) return
    const badProgress = vi.fn(() => {
      throw new Error('renderer progress callback failed')
    })
    const goodProgress = vi.fn()
    const first = internal.acquireSearchIndex(
      session,
      randomUUID(),
      new AbortController().signal,
      badProgress
    )
    const second = internal.acquireSearchIndex(
      session,
      randomUUID(),
      new AbortController().signal,
      goodProgress
    )

    const [firstIndex, secondIndex] = await Promise.all([first, second])
    expect(firstIndex).toBe(secondIndex)
    expect(badProgress).toHaveBeenCalled()
    expect(goodProgress).toHaveBeenCalled()
    const reused = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'needle' },
      76
    )
    expect(reused).toMatchObject({ ok: true, value: { totalResults: 1 } })
    expect(read).toHaveBeenCalledTimes(1)
    expect(manager.searchDebugStateForTests()).toMatchObject({
      builds: 0,
      waiters: 0,
      reservationBytes: 0
    })
  })

  it('bounds a flood of latest-wins searches to one owner, build, waiter and reservation', async () => {
    const root = await makeBook({
      'README.md': '# Flood\n\nbounded search needle'
    })
    mocks.selectedPath = root
    const gate = deferredValue<void>()
    const read = vi.fn(async (rootPath: string, relativePath: string, byteLimit?: number) => {
      await gate.promise
      return safelyReadBookChapter(rootPath, relativePath, byteLimit)
    })
    const manager = new BookSessionManager('/search-flood-user-data', loadBookFromDirectory, read)
    const opened = await manager.openPicker({ sender: { id: 74 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const requests = [
      manager.search(opened.value.sessionId, { searchId: randomUUID(), query: 'needle' }, 74)
    ]
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    for (let index = 0; index < 100; index += 1) {
      requests.push(
        manager.search(
          opened.value.sessionId,
          { searchId: randomUUID(), query: `needle ${index}` },
          74
        )
      )
    }
    await Promise.resolve()
    expect(manager.searchDebugStateForTests()).toMatchObject({
      activeOwners: 1,
      builds: 1,
      reservationBytes: 32 * 1024 * 1024
    })
    expect(manager.searchDebugStateForTests().waiters).toBeLessThanOrEqual(1)
    expect(
      manager.searchDebugStateForTests().cacheBytes +
        manager.searchDebugStateForTests().reservationBytes
    ).toBeLessThanOrEqual(64 * 1024 * 1024)
    gate.resolve()

    const settled = await Promise.all(requests)
    expect(settled.filter((result) => result.ok)).toHaveLength(1)
    expect(
      settled.filter((result) => !result.ok && result.error.code === 'search-cancelled')
    ).toHaveLength(100)
    expect(manager.searchDebugStateForTests()).toMatchObject({
      activeOwners: 0,
      builds: 0,
      waiters: 0,
      reservationBytes: 0
    })
    expect(manager.searchDebugStateForTests().cacheBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  })

  it('rejects excess owners and concurrent cross-session builds with a stable busy error', async () => {
    const root = await makeBook({ 'README.md': '# Busy\n\nneedle' })
    mocks.selectedPath = root
    const gate = deferredValue<void>()
    const read = vi.fn(async (rootPath: string, relativePath: string, byteLimit?: number) => {
      await gate.promise
      return safelyReadBookChapter(rootPath, relativePath, byteLimit)
    })
    const manager = new BookSessionManager(
      '/search-global-cap-user-data',
      loadBookFromDirectory,
      read
    )
    const firstSession = await manager.openPicker({ sender: { id: 100 } } as never)
    expect(firstSession.ok).toBe(true)
    if (!firstSession.ok) return
    const otherSessions = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        manager.openLibrary(firstSession.value.libraryId, 101 + index)
      )
    )
    expect(otherSessions.every((result) => result.ok)).toBe(true)
    const first = manager.search(
      firstSession.value.sessionId,
      { searchId: randomUUID(), query: 'needle' },
      100
    )
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const competing = otherSessions.map((result, index) => {
      if (!result.ok) throw new Error('Expected a test session.')
      return manager.search(
        result.value.sessionId,
        { searchId: randomUUID(), query: 'needle' },
        101 + index
      )
    })
    expect(manager.searchDebugStateForTests().activeOwners).toBeLessThanOrEqual(8)
    await vi.waitFor(() => expect(manager.searchDebugStateForTests().activeOwners).toBe(1))
    gate.resolve()
    const competingResults = await Promise.all(competing)
    expect(
      competingResults.every(
        (result) => !result.ok && ['search-busy', 'search-cancelled'].includes(result.error.code)
      )
    ).toBe(true)
    expect(await first).toMatchObject({ ok: true })
    expect(manager.searchDebugStateForTests().activeOwners).toBe(0)
  })

  it('reports content truncation as partial without claiming a document was omitted', async () => {
    const root = await makeBook({
      'README.md': `# Large\n\n${Array.from({ length: 4 }, () => '\uFDFA'.repeat(4_096)).join('\n')}`
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/search-partial-user-data')
    const opened = await manager.openPicker({ sender: { id: 75 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const result = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'large' },
      75
    )
    expect(result).toMatchObject({
      ok: true,
      value: {
        index: {
          eligibleDocuments: 1,
          indexedDocuments: 1,
          omittedDocuments: 0,
          partial: true
        }
      }
    })
    const debug = manager.searchDebugStateForTests()
    expect(debug.cacheBytes + debug.reservationBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  })

  it('bounds root identity I/O while indexing and matching thousands of lines', async () => {
    const root = await makeBook({
      'README.md': Array.from({ length: 4_000 }, (_, index) => `searchable line ${index}`).join(
        '\n'
      )
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/search-root-checkpoint-budget-user-data')
    const opened = await manager.openPicker({ sender: { id: 77 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const internal = manager as unknown as {
      identifyRoot: (rootPath: string) => Promise<TestRootIdentity>
    }
    const identifyRoot = vi.spyOn(internal, 'identifyRoot')

    const result = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'searchable' },
      77
    )
    expect(result).toMatchObject({ ok: true, value: { totalResults: 1 } })
    expect(identifyRoot.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(identifyRoot.mock.calls.length).toBeLessThanOrEqual(32)
  })

  it('rejects a root identity replacement at a periodic search checkpoint', async () => {
    const root = await makeBook({
      'README.md': Array.from({ length: 4_000 }, (_, index) => `periodic line ${index}`).join('\n')
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/search-periodic-root-change-user-data')
    const opened = await manager.openPicker({ sender: { id: 78 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const internal = manager as unknown as {
      identifyRoot: (rootPath: string) => Promise<TestRootIdentity>
    }
    const originalIdentifyRoot = internal.identifyRoot.bind(manager)
    let identityCalls = 0
    vi.spyOn(internal, 'identifyRoot').mockImplementation(async (rootPath) => {
      const identity = await originalIdentifyRoot(rootPath)
      identityCalls += 1
      return identityCalls >= 3 && identity ? { ...identity, ino: identity.ino + 1n } : identity
    })

    expect(
      await manager.search(
        opened.value.sessionId,
        { searchId: randomUUID(), query: 'periodic' },
        78
      )
    ).toMatchObject({ ok: false, error: { code: 'search-unavailable' } })
    expect(identityCalls).toBe(3)
  })

  it('rejects a root identity replacement during the final search check', async () => {
    const root = await makeBook({ 'README.md': '# Final\n\nfinal identity needle' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/search-final-root-change-user-data')
    const opened = await manager.openPicker({ sender: { id: 79 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const internal = manager as unknown as {
      identifyRoot: (rootPath: string) => Promise<TestRootIdentity>
    }
    const originalIdentifyRoot = internal.identifyRoot.bind(manager)
    let replaced = false
    vi.spyOn(internal, 'identifyRoot').mockImplementation(async (rootPath) => {
      const identity = await originalIdentifyRoot(rootPath)
      return replaced && identity ? { ...identity, ino: identity.ino + 1n } : identity
    })

    const result = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'needle' },
      79,
      (progress) => {
        if (progress.phase === 'matching') replaced = true
      }
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'book-unavailable' } })
  })

  it('keeps the full inferred parent hierarchy in group landing breadcrumbs', async () => {
    const root = await makeBook({
      'README.md': '# Root book',
      'part/sub/README.md': '# Nested landing\n\nbreadcrumb needle'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/search-breadcrumb-user-data')
    const opened = await manager.openPicker({ sender: { id: 76 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const result = await manager.search(
      opened.value.sessionId,
      { searchId: randomUUID(), query: 'breadcrumb needle' },
      76
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const breadcrumbText = result.value.results[0]?.breadcrumbs.join(' / ').toLowerCase()
    expect(breadcrumbText).toContain('part')
    expect(breadcrumbText).toContain('nested landing')
  })

  it('persists per-chapter reading positions and resumes them across manager restarts', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [First](README.md)\n- [Second](second.md)\n',
      'README.md': '# First\n\nStart',
      'second.md': '# Second\n\nContinue'
    })
    mocks.selectedPath = root
    const first = new BookSessionManager('/reading-progress-user-data')
    const opened = await first.openPicker({ sender: { id: 31 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const [firstNode, secondNode] = opened.value.nodes
    expect(firstNode).toBeDefined()
    expect(secondNode).toBeDefined()
    if (!firstNode || !secondNode) return

    expect(
      await first.saveReadingPosition(opened.value.sessionId, firstNode.nodeId, 0.4, 31)
    ).toMatchObject({
      ok: true,
      value: { chapterProgress: 0.4, overallProgress: 0.2 }
    })
    expect(
      await first.saveReadingPosition(opened.value.sessionId, secondNode.nodeId, 0.5, 31)
    ).toMatchObject({
      ok: true,
      value: { chapterProgress: 0.5, overallProgress: 0.75 }
    })

    const second = new BookSessionManager('/reading-progress-user-data')
    const listed = await second.listLibraries()
    expect(listed).toMatchObject([
      {
        libraryId: opened.value.libraryId,
        readingProgress: 0.75,
        lastChapterTitle: 'Second'
      }
    ])
    const reopened = await second.openLibrary(opened.value.libraryId, 32)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok || !reopened.value.resumeNodeId) return
    expect(reopened.value.readingProgress).toBe(0.75)
    const resumed = await second.readChapter(
      reopened.value.sessionId,
      reopened.value.resumeNodeId,
      32
    )
    expect(resumed).toMatchObject({
      ok: true,
      value: { title: 'Second', readingPosition: 0.5 }
    })

    const reopenedFirst = reopened.value.nodes[0]
    expect(reopenedFirst).toBeDefined()
    if (!reopenedFirst) return
    expect(
      await second.readChapter(reopened.value.sessionId, reopenedFirst.nodeId, 32)
    ).toMatchObject({
      ok: true,
      value: { title: 'First', readingPosition: 0.4 }
    })
  })

  it('rejects invalid or revoked reading-position writes', async () => {
    const root = await makeBook({ 'README.md': '# Progress safety' })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/reading-progress-safety-user-data')
    const opened = await manager.openPicker({ sender: { id: 41 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(
        await manager.saveReadingPosition(
          opened.value.sessionId,
          opened.value.entryNodeId,
          value,
          41
        )
      ).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    }
    expect(
      await manager.saveReadingPosition(opened.value.sessionId, opened.value.entryNodeId, 0.5, 42)
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    manager.cleanupOwner(41)
    expect(
      await manager.saveReadingPosition(opened.value.sessionId, opened.value.entryNodeId, 0.5, 41)
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('invalidates reading-position writes when the authorized root is replaced', async () => {
    const root = await makeBook({ 'README.md': '# Replace progress root' })
    const movedRoot = `${root}-moved`
    temporaryDirectories.push(movedRoot)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/reading-progress-root-user-data')
    const opened = await manager.openPicker({ sender: { id: 45 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return

    await fs.rename(root, movedRoot)
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'README.md'), '# Replacement')
    expect(
      await manager.saveReadingPosition(opened.value.sessionId, opened.value.entryNodeId, 0.5, 45)
    ).toMatchObject({ ok: false, error: { code: 'book-unavailable' } })
    expect(await manager.listLibraries()).toMatchObject([{ readingProgress: 0 }])
    expect(await manager.refresh(opened.value.sessionId, 45)).toMatchObject({
      ok: false,
      error: { code: 'book-unavailable' }
    })
  })

  it('normalizes and bounds long chapter titles without losing resume state', async () => {
    const longTitle = `${'章节'.repeat(300)}😀`
    const root = await makeBook({
      'SUMMARY.md': `- [${longTitle}](README.md)\n`,
      'README.md': '# Long title'
    })
    mocks.selectedPath = root
    const first = new BookSessionManager('/long-progress-title-user-data')
    const opened = await first.openPicker({ sender: { id: 46 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    expect(
      await first.saveReadingPosition(opened.value.sessionId, opened.value.entryNodeId, 0.4, 46)
    ).toMatchObject({ ok: true })
    const listed = await first.listLibraries()
    expect(listed[0]?.lastChapterTitle?.length).toBeLessThanOrEqual(512)
    expect(listed[0]?.lastChapterTitle?.endsWith('\ud83d')).toBe(false)

    const second = new BookSessionManager('/long-progress-title-user-data')
    const reopened = await second.openLibrary(opened.value.libraryId, 47)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok || !reopened.value.resumeNodeId) return
    expect(
      await second.readChapter(reopened.value.sessionId, reopened.value.resumeNodeId, 47)
    ).toMatchObject({
      ok: true,
      value: { readingPosition: 0.4, hasReadingPosition: true }
    })
  })

  it('falls back safely when the saved chapter disappears after refresh', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [First](README.md)\n- [Second](second.md)\n',
      'README.md': '# First',
      'second.md': '# Second'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager('/reading-progress-refresh-user-data')
    const opened = await manager.openPicker({ sender: { id: 51 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const secondNode = opened.value.nodes[1]
    expect(secondNode).toBeDefined()
    if (!secondNode) return
    expect(
      await manager.saveReadingPosition(opened.value.sessionId, secondNode.nodeId, 0.6, 51)
    ).toMatchObject({ ok: true })

    await fs.writeFile(path.join(root, 'SUMMARY.md'), '- [First](README.md)\n')
    await fs.rm(path.join(root, 'second.md'))
    const refreshed = await manager.refresh(opened.value.sessionId, 51)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.value.resumeNodeId).toBe(refreshed.value.entryNodeId)
    expect(refreshed.value.readingProgress).toBe(0)
  })

  it('keeps duplicate chapter occurrences distinct when resuming', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [First copy](README.md)\n- [Second copy](README.md)\n',
      'README.md': '# Duplicate target'
    })
    mocks.selectedPath = root
    const first = new BookSessionManager('/duplicate-progress-user-data')
    const opened = await first.openPicker({ sender: { id: 61 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const [firstCopy, secondCopy] = opened.value.nodes
    expect(firstCopy).toBeDefined()
    expect(secondCopy).toBeDefined()
    if (!firstCopy || !secondCopy) return
    expect(firstCopy.nodeId).not.toBe(secondCopy.nodeId)
    expect(
      await first.saveReadingPosition(opened.value.sessionId, secondCopy.nodeId, 0.25, 61)
    ).toMatchObject({ ok: true, value: { overallProgress: 0.625 } })

    const second = new BookSessionManager('/duplicate-progress-user-data')
    const reopened = await second.openLibrary(opened.value.libraryId, 62)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.resumeNodeId).toBe(reopened.value.nodes[1]?.nodeId)
    expect(reopened.value.resumeNodeId).not.toBe(reopened.value.nodes[0]?.nodeId)
  })

  it('bounds and sanitizes persisted chapter positions without dropping a legacy book', async () => {
    const root = await makeBook({ 'README.md': '# Capacity' })
    const key = '/capacity-user-data/bookshelf'
    mocks.stores.set(key, {
      libraries: [
        {
          libraryId: 'capacity-library-id',
          rootPath: root,
          title: 'Capacity',
          lastOpenedAt: new Date(0).toISOString(),
          reading: {
            lastTargetKey: 'target-0',
            lastChapterTitle: 'Chapter',
            overallProgress: 0.5,
            updatedAt: new Date(0).toISOString(),
            positions: [
              ...Array.from({ length: 600 }, (_, index) => ({
                targetKey: `target-${index}`,
                ratio: 0.5,
                updatedAt: new Date(index).toISOString()
              })),
              { targetKey: 'invalid-ratio', ratio: 2, updatedAt: new Date(0).toISOString() }
            ]
          }
        },
        {
          libraryId: 'legacy-library-id',
          rootPath: `${root}-legacy`,
          title: 'Legacy',
          lastOpenedAt: new Date(0).toISOString()
        }
      ]
    })
    const manager = new BookSessionManager('/capacity-user-data')
    const persisted = mocks.stores.get(key) as {
      libraries: Array<{ title: string; reading?: { positions: unknown[] } }>
    }
    expect(persisted.libraries).toHaveLength(2)
    expect(persisted.libraries[0]?.reading?.positions).toHaveLength(500)
    expect(persisted.libraries[1]?.title).toBe('Legacy')
    expect(persisted.libraries[1]?.reading).toBeUndefined()
    expect(await manager.listLibraries()).toHaveLength(2)
  })

  it('opens only stored safe external nodes and rejects executable chapter links', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Start](README.md)\n- [Website](https://example.com/docs)\n',
      'README.md': '# Start\n[bad](javascript:alert(1))'
    })
    mocks.selectedPath = root
    const manager = new BookSessionManager(
      '/links-user-data',
      undefined,
      undefined,
      async (ownerId, target) => {
        expect(ownerId).toBe(71)
        mocks.openedExternal(target)
        return true
      }
    )
    const opened = await manager.openPicker({ sender: { id: 71 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const [chapter, external] = opened.value.nodes
    expect(chapter).toBeDefined()
    expect(external).toBeDefined()
    if (!chapter || !external) return
    expect(
      await manager.followLink(opened.value.sessionId, chapter.nodeId, 'javascript:alert(1)', 71)
    ).toMatchObject({ ok: false, error: { code: 'unsafe-link' } })
    expect(await manager.followLink(opened.value.sessionId, external.nodeId, '#', 71)).toEqual({
      ok: true,
      value: null
    })
    expect(mocks.openedExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('fails closed when an external-link confirmation is cancelled', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Website](https://example.com/docs)\n',
      'README.md': '# Home'
    })
    mocks.selectedPath = root
    const dispatch = vi.fn()
    const manager = new BookSessionManager(
      '/cancelled-link-user-data',
      undefined,
      undefined,
      async () => false
    )
    const opened = await manager.openPicker({ sender: { id: 72 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.nodes[0]) return
    expect(
      await manager.followLink(opened.value.sessionId, opened.value.nodes[0].nodeId, '#', 72)
    ).toMatchObject({ ok: false, error: { code: 'unsafe-link' } })
    expect(dispatch).not.toHaveBeenCalled()
    expect(mocks.openedExternal).not.toHaveBeenCalled()
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

  it('keeps a separate root landing first in reading order and resumes it across restart', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [Next](next.md)\n',
      'README.md': '# Book home',
      'next.md': '# Next'
    })
    mocks.selectedPath = root
    const first = new BookSessionManager('/root-landing-progress-user-data')
    const opened = await first.openPicker({ sender: { id: 71 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.landingNodeId) return
    const rootLanding = opened.value.landingNodeId
    const nextNode = opened.value.nodes[0]?.nodeId
    expect(nextNode).toBeDefined()
    if (!nextNode) return
    expect(
      await first.saveReadingPosition(opened.value.sessionId, rootLanding, 0.4, 71)
    ).toMatchObject({
      ok: true,
      value: { chapterProgress: 0.4, overallProgress: 0.2 }
    })

    const second = new BookSessionManager('/root-landing-progress-user-data')
    const reopened = await second.openLibrary(opened.value.libraryId, 72)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok || !reopened.value.resumeNodeId) return
    expect(reopened.value.resumeNodeId).toBe(reopened.value.landingNodeId)
    expect(reopened.value.readingProgress).toBe(0.2)
    expect(
      await second.readChapter(reopened.value.sessionId, reopened.value.resumeNodeId, 72)
    ).toMatchObject({
      ok: true,
      value: { title: 'Book home', readingPosition: 0.4, hasReadingPosition: true }
    })
    expect(
      await second.saveReadingPosition(
        reopened.value.sessionId,
        reopened.value.nodes[0]?.nodeId,
        0,
        72
      )
    ).toMatchObject({ ok: true, value: { overallProgress: 0.5 } })
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

  it('revokes the previous session when refresh scanning fails and recovers by reopening', async () => {
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
    ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    failScan = false
    expect(await manager.openLibrary(opened.value.libraryId, 9)).toMatchObject({
      ok: true,
      value: { title: 'Still here' }
    })
  })

  it('contains a throwing refresh loader and revokes both observed resource tokens', async () => {
    const root = await makeBook({
      'README.md': '# Throwing refresh\n\n![Cover](cover.png)\n'
    })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    let loads = 0
    const loader: typeof loadBookFromDirectory = async (rootPath, options) => {
      loads += 1
      if (loads > 1) throw new Error(`secret loader failure at ${rootPath}`)
      return loadBookFromDirectory(rootPath, options)
    }
    mocks.selectedPath = root
    const manager = new BookSessionManager('/throwing-refresh-user-data', loader)
    const opened = await manager.openPicker({ sender: { id: 10 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.value.entryNodeId) return
    await manager.readChapter(opened.value.sessionId, opened.value.entryNodeId, 10)
    const oldToken = opened.value.resourceToken

    const refreshPromise = manager.refresh(opened.value.sessionId, 10)
    await expect(refreshPromise).resolves.toMatchObject({
      ok: false,
      error: { code: 'book-unavailable' }
    })
    const refreshResult = await refreshPromise
    expect(JSON.stringify(refreshResult)).not.toContain(root)
    expect(JSON.stringify(refreshResult)).not.toContain('secret loader failure')
    const rotatedToken = opened.value.resourceToken
    expect(rotatedToken).not.toBe(oldToken)

    for (const resourceToken of [oldToken, rotatedToken]) {
      expect(
        await manager.readResource(
          {
            sessionId: opened.value.sessionId,
            resourceToken,
            nodeId: opened.value.entryNodeId,
            reference: 'cover.png'
          },
          10
        )
      ).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    }
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

describe('book HTML export lease', () => {
  it('includes an out-of-SUMMARY root landing once and excludes orphan bodies', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n',
      'README.md': '# Home\n',
      'one.md': '# One\n',
      'orphan.md': '# Orphan secret\n'
    })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-landing-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-landing-user-data')
    const opened = await manager.openPicker({ sender: { id: 200 } } as never)
    expect(opened).toMatchObject({ ok: true, value: { navigationSource: 'summary' } })
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 200 } } as never,
      200
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.value.landingNodeId).not.toBeNull()
    expect(prepared.value.documents.map((document) => document.markdown)).toEqual(
      expect.arrayContaining(['# Home\n', '# One\n'])
    )
    expect(JSON.stringify(prepared.value)).not.toContain('Orphan secret')
    expect(prepared.value.documents).toHaveLength(2)
    manager.cancelExport(prepared.value.exportId, 200)
  })

  it('exports an inferred book without requiring SUMMARY', async () => {
    const root = await makeBook({ 'README.md': '# Home\n', 'chapter.md': '# Chapter\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-inferred-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-inferred-user-data')
    const opened = await manager.openPicker({ sender: { id: 199 } } as never)
    expect(opened).toMatchObject({ ok: true, value: { navigationSource: 'inferred' } })
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 199 } } as never,
      199
    )
    expect(prepared.ok).toBe(true)
    if (prepared.ok) manager.cancelExport(prepared.value.exportId, 199)
  })

  it('revokes an expired short-lived export lease before any output can be committed', async () => {
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-expired-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-expired-user-data')
    const opened = await manager.openPicker({ sender: { id: 198 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    vi.useFakeTimers({ now: Date.now() })
    try {
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: 198 } } as never,
        198
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      const internals = manager as unknown as {
        exportLeases: Map<
          string,
          { parentFd: number | null; resourceLedger: { assets: unknown[] } }
        >
      }
      const lease = internals.exportLeases.get(prepared.value.exportId)
      expect(lease).toBeDefined()
      await vi.advanceTimersByTimeAsync(120_001)
      expect(internals.exportLeases.size).toBe(0)
      expect(lease?.parentFd).toBeNull()
      expect(lease?.resourceLedger.assets).toEqual([])
      expect(manager.cancelExport(prepared.value.exportId, 198)).toMatchObject({
        ok: false,
        error: { code: 'cancelled' }
      })
      await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
      mocks.exportPath = path.join(destination, 'replacement.html')
      const replacement = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: 198 } } as never,
        198
      )
      expect(replacement).toMatchObject({ ok: true })
      if (replacement.ok) manager.cancelExport(replacement.value.exportId, 198)
    } finally {
      vi.useRealTimers()
    }
  })

  it('freezes an opaque snapshot and atomically commits a validated offline export', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [一](one.md)\n- [一的别名](one.md#标题)\n- [二](two.md)\n',
      'one.md': '# 标题\n\n[去第二章](two.md#第二章)\n',
      'two.md': '# 第二章\n\n正文'
    })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-target-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-user-data')
    const opened = await manager.openPicker({ sender: { id: 201 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 201 } } as never,
      201
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(JSON.stringify(prepared.value)).not.toContain(root)
    expect(prepared.value.documents).toHaveLength(2)
    expect(prepared.value.documents[0]?.nodeIds).toHaveLength(2)
    const html = await generateBookExportHtml(prepared.value)
    const saved = await manager.commitExport({ exportId: prepared.value.exportId, html }, 201)
    expect(saved).toMatchObject({ ok: true, value: { fileName: 'book.html' } })
    const written = await fs.readFile(mocks.exportPath, 'utf8')
    expect(written).toBe(html)
    expect(written).not.toContain(root)
    expect(manager.cancelExport(prepared.value.exportId, 201)).toMatchObject({
      ok: false,
      error: { code: 'cancelled' }
    })
  })

  it('embeds one main-validated data asset across duplicate chapter references', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n- [Two](two.md)\n',
      'one.md': '# One\n\n![cover](cover.png)\n',
      'two.md': '# Two\n\n![same](cover.png)\n'
    })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-assets-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-assets-user-data')
    const opened = await manager.openPicker({ sender: { id: 214 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 214 } } as never,
      214
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const targets = prepared.value.documents.flatMap((document) => document.resourceTargets)
    expect(targets).toHaveLength(2)
    expect(new Set(targets).size).toBe(1)
    expect(targets[0]).toMatch(/^data:image\/png;base64,/u)
    expect(
      JSON.stringify(prepared.value.documents.map((document) => document.resourceTargets))
    ).not.toContain('cover.png')
    const html = await generateBookExportHtml(prepared.value)
    expect(html).not.toContain('cover.png')
    expect(html).not.toContain(root)
    expect(html.match(/data:image\/png;base64,/gu)).toHaveLength(2)
    const saved = await manager.commitExport({ exportId: prepared.value.exportId, html }, 214)
    if (!saved.ok) {
      throw new Error(`${saved.error.code}: ${saved.error.message}`)
    }
  })

  it('maps unique HTML targets while preserving duplicate and missing occurrence order', async () => {
    const root = await makeBook({
      'one.md': [
        '# One',
        '![a-1](a.png)',
        '![a-2](a.png)',
        '![b-1](b.gif)',
        '![missing-1](missing.png)',
        '![missing-2](missing.png)',
        '![b-2](b.gif)'
      ].join('\n\n')
    })
    await Promise.all([
      fs.writeFile(path.join(root, 'a.png'), testPng),
      fs.writeFile(path.join(root, 'b.gif'), testGif)
    ])
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-order-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-order-user-data')
    const opened = await manager.openPicker({ sender: { id: 216 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 216 } } as never,
      216
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const targets = prepared.value.documents[0]?.resourceTargets ?? []
    expect(targets).toHaveLength(3)
    expect(targets[2]).toBeNull()
    const html = await generateBookExportHtml(prepared.value)
    const sources = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/giu)].map(
      (match) => match[1]
    )
    expect(sources).toEqual([targets[0], targets[0], targets[1], targets[1]])
    expect(html.match(/<span class="leafbook-media-placeholder"/gu)).toHaveLength(2)
    await expect(
      manager.commitExport({ exportId: prepared.value.exportId, html }, 216)
    ).resolves.toMatchObject({ ok: true })
  })

  it('rejects a resource changed after the export ledger was prepared', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n',
      'one.md': '# One\n\n![cover](cover.png)\n'
    })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-asset-race-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager('/export-asset-race-user-data')
    const opened = await manager.openPicker({ sender: { id: 215 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 215 } } as never,
      215
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const html = await generateBookExportHtml(prepared.value)
    await fs.writeFile(path.join(root, 'cover.png'), testGif)
    await expect(
      manager.commitExport({ exportId: prepared.value.exportId, html }, 215)
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-source-changed' } })
    await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['missing-created', false, true, false],
    ['invalid-replaced-with-valid', true, true, false],
    ['unchanged-invalid', true, false, true]
  ] as const)(
    'binds the final HTML placeholder to its exact negative source state: %s',
    async (_label, initiallyInvalid, replaceWithValid, succeeds) => {
      const root = await makeBook({ 'one.md': '# One\n\n![cover](cover.png)\n' })
      const imagePath = path.join(root, 'cover.png')
      if (initiallyInvalid) await fs.writeFile(imagePath, 'not-a-png')
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-negative-'))
      temporaryDirectories.push(destination)
      mocks.selectedPath = root
      mocks.exportPath = path.join(destination, 'book.html')
      const ownerId = 230 + (initiallyInvalid ? 1 : 0) + (replaceWithValid ? 2 : 0)
      const manager = new BookSessionManager(
        `/export-negative-${randomUUID()}`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          beforeExportCommitCritical: () => {
            if (replaceWithValid) fsSync.writeFileSync(imagePath, testPng)
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: ownerId } } as never,
        ownerId
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      expect(prepared.value.documents[0]?.resourceTargets).toEqual([null])
      const html = await generateBookExportHtml(prepared.value)
      const result = await manager.commitExport(
        { exportId: prepared.value.exportId, html },
        ownerId
      )
      expect(result.ok).toBe(succeeds)
      if (!succeeds) {
        expect(result).toMatchObject({ ok: false, error: { code: 'export-source-changed' } })
        await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    }
  )

  it('classifies an unverifiable negative image source as source-changed instead of too-large', async () => {
    const root = await makeBook({ 'one.md': '# One\n\n![cover](cover.png)\n' })
    const imagePath = path.join(root, 'cover.png')
    await fs.writeFile(imagePath, 'not-a-png')
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-unverifiable-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    await fs.chmod(imagePath, 0o000)
    try {
      const manager = new BookSessionManager('/export-unverifiable-user-data')
      const opened = await manager.openPicker({ sender: { id: 236 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      await expect(
        manager.beginExport(opened.value.sessionId, { sender: { id: 236 } } as never, 236)
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'export-source-changed' }
      })
    } finally {
      await fs.chmod(imagePath, 0o600)
    }
  })

  it('rechecks HTML lease expiry after the final synchronous source validation', async () => {
    const root = await makeBook({ 'one.md': '# One\n\n![cover](cover.png)\n' })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-final-ttl-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    vi.useFakeTimers({ now: Date.now() })
    try {
      const manager = new BookSessionManager(
        '/export-final-ttl-user-data',
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          beforeExportCommitCritical: () => {
            vi.setSystemTime(Date.now() + 120_001)
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: 235 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: 235 } } as never,
        235
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      const html = await generateBookExportHtml(prepared.value)
      await expect(
        manager.commitExport({ exportId: prepared.value.exportId, html }, 235)
      ).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
      await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rechecks raw resource identity and bytes synchronously beside final HTML rename', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n',
      'one.md': '# One\n\n![cover](cover.png)\n'
    })
    const imagePath = path.join(root, 'cover.png')
    await fs.writeFile(imagePath, testPng)
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-final-image-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager(
      '/export-final-image-user-data',
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      { beforeExportCommitCritical: () => fsSync.writeFileSync(imagePath, testGif) }
    )
    const opened = await manager.openPicker({ sender: { id: 216 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 216 } } as never,
      216
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const html = await generateBookExportHtml(prepared.value)
    await expect(
      manager.commitExport({ exportId: prepared.value.exportId, html }, 216)
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-source-changed' } })
    await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects source mutation and canonical source-root destinations', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n',
      'one.md': '# One\n'
    })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-race-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/export-race-user-data')
    const opened = await manager.openPicker({ sender: { id: 202 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    mocks.exportPath = path.join(destination, 'book.html')
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 202 } } as never,
      202
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    await fs.writeFile(path.join(root, 'one.md'), '# Changed\n')
    const html = await generateBookExportHtml(prepared.value)
    await expect(
      manager.commitExport({ exportId: prepared.value.exportId, html }, 202)
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-source-changed' } })

    if (process.platform !== 'win32') {
      const link = path.join(destination, 'source-link')
      await fs.symlink(root, link)
      mocks.exportPath = path.join(link, 'inside.html')
      await expect(
        manager.beginExport(opened.value.sessionId, { sender: { id: 202 } } as never, 202)
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    }
  })

  it('rejects overwrite cancellation, symlink/hardlink targets and inode replacement', async () => {
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-target-race-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/export-target-race-user-data')
    const opened = await manager.openPicker({ sender: { id: 203 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const target = path.join(destination, 'book.html')
    await fs.writeFile(target, 'old')
    mocks.exportPath = target
    mocks.confirmOverwrite = false
    await expect(
      manager.beginExport(opened.value.sessionId, { sender: { id: 203 } } as never, 203)
    ).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })

    mocks.confirmOverwrite = true
    if (process.platform !== 'win32') {
      const symlinkTarget = path.join(destination, 'symlink.html')
      await fs.symlink(target, symlinkTarget)
      mocks.exportPath = symlinkTarget
      await expect(
        manager.beginExport(opened.value.sessionId, { sender: { id: 203 } } as never, 203)
      ).resolves.toMatchObject({ ok: false, error: { code: 'export-write-failed' } })

      const hardlinkTarget = path.join(destination, 'hardlink.html')
      await fs.link(target, hardlinkTarget)
      mocks.exportPath = hardlinkTarget
      await expect(
        manager.beginExport(opened.value.sessionId, { sender: { id: 203 } } as never, 203)
      ).resolves.toMatchObject({ ok: false, error: { code: 'export-write-failed' } })
      await fs.unlink(hardlinkTarget)
    }

    mocks.exportPath = target
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 203 } } as never,
      203
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    await fs.unlink(target)
    await fs.writeFile(target, 'replacement inode')
    const html = await generateBookExportHtml(prepared.value)
    await expect(
      manager.commitExport({ exportId: prepared.value.exportId, html }, 203)
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-write-failed' } })
    expect(await fs.readFile(target, 'utf8')).toBe('replacement inode')

    mocks.exportPath = path.join(destination, 'cancelled.html')
    const cancelled = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 203 } } as never,
      203
    )
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(manager.cancelExport(cancelled.value.exportId, 203)).toEqual({ ok: true, value: true })
    await expect(
      manager.commitExport(
        { exportId: cancelled.value.exportId, html: await generateBookExportHtml(cancelled.value) },
        203
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('admits only one commit and cancellation or owner cleanup cannot reach rename', async () => {
    for (const revocation of ['cancel', 'cleanup'] as const) {
      const root = await makeBook({ 'one.md': '# One\n' })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), `leafbook-export-${revocation}-`))
      temporaryDirectories.push(destination)
      mocks.selectedPath = root
      mocks.exportPath = path.join(destination, 'book.html')
      const reachedTempSync = deferredValue<void>()
      const releaseTempSync = deferredValue<void>()
      let tempSyncEntries = 0
      const manager = new BookSessionManager(
        `/export-${revocation}-user-data`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          afterExportTempSync: async () => {
            tempSyncEntries++
            reachedTempSync.resolve()
            await releaseTempSync.promise
          }
        }
      )
      const ownerId = revocation === 'cancel' ? 204 : 205
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) continue
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: ownerId } } as never,
        ownerId
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) continue
      const html = await generateBookExportHtml(prepared.value)
      const first = manager.commitExport({ exportId: prepared.value.exportId, html }, ownerId)
      await reachedTempSync.promise
      await expect(
        manager.commitExport({ exportId: prepared.value.exportId, html }, ownerId)
      ).resolves.toMatchObject({ ok: false, error: { code: 'export-busy' } })
      expect(tempSyncEntries).toBe(1)
      if (revocation === 'cancel') {
        expect(manager.cancelExport(prepared.value.exportId, ownerId)).toEqual({
          ok: true,
          value: true
        })
      } else {
        manager.cleanupOwner(ownerId)
      }
      releaseTempSync.resolve()
      await expect(first).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
      await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(
        (await fs.readdir(destination)).filter((name) => name.includes('leafbook-export'))
      ).toEqual([])
    }
  })

  it('removes a revoked active export from admission before disposing its in-flight ledger', async () => {
    const root = await makeBook({ 'one.md': '# One\n\n![cover](cover.png)\n' })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-inflight-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const reached = deferredValue<void>()
    const release = deferredValue<void>()
    const manager = new BookSessionManager(
      '/export-inflight-user-data',
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      {
        afterExportTempSync: async () => {
          reached.resolve()
          await release.promise
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 217 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 217 } } as never,
      217
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const internals = manager as unknown as {
      exportLeases: Map<
        string,
        {
          parentFd: number | null
          inFlight: number
          disposed: boolean
          resourceLedger: { assets: Array<{ bytes: Uint8Array }> }
        }
      >
    }
    const lease = internals.exportLeases.get(prepared.value.exportId)
    const operation = manager.commitExport(
      {
        exportId: prepared.value.exportId,
        html: await generateBookExportHtml(prepared.value)
      },
      217
    )
    await reached.promise
    expect(manager.cancelExport(prepared.value.exportId, 217)).toEqual({ ok: true, value: true })
    expect(internals.exportLeases.has(prepared.value.exportId)).toBe(false)
    expect(lease?.inFlight).toBe(1)
    expect(lease?.disposed).toBe(false)
    expect(lease?.parentFd).not.toBeNull()
    expect(lease?.resourceLedger.assets[0]?.bytes.byteLength).toBeGreaterThan(0)
    release.resolve()
    await expect(operation).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(lease?.inFlight).toBe(0)
    expect(lease?.disposed).toBe(true)
    expect(lease?.parentFd).toBeNull()
    expect(lease?.resourceLedger.assets).toEqual([])
  })

  it.each(['before-temp', 'before-rename'] as const)(
    'fails closed when the canonical parent is redirected %s',
    async (racePoint) => {
      if (process.platform === 'win32') return
      const root = await makeBook({ 'one.md': '# One\n' })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-parent-swap-'))
      const moved = `${destination}-moved`
      temporaryDirectories.push(destination, moved)
      mocks.selectedPath = root
      mocks.exportPath = path.join(destination, 'book.html')
      let swapped = false
      const swapParent = async (): Promise<void> => {
        if (swapped) return
        swapped = true
        await fs.rename(destination, moved)
        await fs.symlink(root, destination)
      }
      let hooks: BookSessionManagerTestHooks
      if (racePoint === 'before-temp') {
        hooks = {
          afterExportSourcePass: async (pass) => {
            if (pass === 1) await swapParent()
          }
        }
      } else {
        hooks = { beforeExportCommitCritical: swapParent }
      }
      const manager = new BookSessionManager(
        `/export-parent-${racePoint}-user-data`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        hooks
      )
      const opened = await manager.openPicker({ sender: { id: 206 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: 206 } } as never,
        206
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      const result = await manager.commitExport(
        { exportId: prepared.value.exportId, html: await generateBookExportHtml(prepared.value) },
        206
      )
      expect(result).toMatchObject({ ok: false, error: { code: 'export-write-failed' } })
      await expect(fs.stat(path.join(root, 'book.html'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.stat(path.join(moved, 'book.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('leaves only an empty random temp when the pinned parent is redirected after open', async () => {
    if (process.platform === 'win32') return
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-open-swap-'))
    const moved = `${destination}-moved`
    temporaryDirectories.push(destination, moved)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager(
      '/export-open-swap-user-data',
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      {
        afterExportTempOpen: async () => {
          await fs.rename(destination, moved)
          await fs.symlink(root, destination)
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 210 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 210 } } as never,
      210
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    await expect(
      manager.commitExport(
        { exportId: prepared.value.exportId, html: await generateBookExportHtml(prepared.value) },
        210
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-write-failed' } })
    const residue = (await fs.readdir(moved)).filter((name) => name.startsWith('.leafbook-export-'))
    expect(residue).toHaveLength(1)
    expect((await fs.stat(path.join(moved, residue[0] as string))).size).toBe(0)
    await expect(fs.stat(path.join(root, 'book.html'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('detects a root swap and a source mutation at the final commit boundary', async () => {
    for (const race of ['root', 'source'] as const) {
      const root = await makeBook({ 'one.md': '# One\n' })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), `leafbook-export-${race}-late-`))
      temporaryDirectories.push(destination)
      mocks.selectedPath = root
      mocks.exportPath = path.join(destination, 'book.html')
      const moved = `${root}-moved`
      if (race === 'root') temporaryDirectories.push(moved)
      const manager = new BookSessionManager(
        `/export-${race}-late-user-data`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          afterExportSourcePass: async (pass) => {
            if (pass !== 2) return
            if (race === 'root') {
              await fs.rename(root, moved)
              await fs.mkdir(root)
              await fs.writeFile(path.join(root, 'one.md'), '# One\n')
            } else {
              await fs.writeFile(path.join(root, 'one.md'), '# Changed after pass two\n')
            }
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: 207 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) continue
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: 207 } } as never,
        207
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) continue
      await expect(
        manager.commitExport(
          { exportId: prepared.value.exportId, html: await generateBookExportHtml(prepared.value) },
          207
        )
      ).resolves.toMatchObject({
        ok: false,
        error: { code: race === 'root' ? 'export-source-changed' : 'export-source-changed' }
      })
      await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it.each(['oversized', 'sparse'] as const)(
    'rejects a late %s regular source before allocating from its declared size',
    async (replacement) => {
      const root = await makeBook({ 'one.md': '# One\n' })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-large-late-'))
      temporaryDirectories.push(destination)
      mocks.selectedPath = root
      mocks.exportPath = path.join(destination, 'book.html')
      const sourcePath = path.join(root, 'one.md')
      const manager = new BookSessionManager(
        `/export-${replacement}-source-user-data`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          afterExportSourcePass: async (pass) => {
            if (pass !== 2) return
            const handle = await fs.open(sourcePath, 'w')
            try {
              if (replacement === 'sparse') {
                await handle.truncate(64 * 1024 * 1024)
              } else {
                const chunk = Buffer.alloc(64 * 1024, 0x61)
                for (let index = 0; index < 513; index++) await handle.write(chunk)
              }
            } finally {
              await handle.close()
            }
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: 209 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const prepared = await manager.beginExport(
        opened.value.sessionId,
        { sender: { id: 209 } } as never,
        209
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      const html = await generateBookExportHtml(prepared.value)
      const allocation = vi.spyOn(Buffer, 'allocUnsafe')
      const result = await manager.commitExport({ exportId: prepared.value.exportId, html }, 209)
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'export-source-changed' }
      })
      expect(
        allocation.mock.calls.every(([size]) => typeof size === 'number' && size <= 64 * 1024)
      ).toBe(true)
      await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('rejects a late FIFO source without blocking the main thread', async () => {
    if (process.platform === 'win32') return
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-fifo-source-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const sourcePath = path.join(root, 'one.md')
    const manager = new BookSessionManager(
      '/export-fifo-source-user-data',
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      {
        afterExportSourcePass: async (pass) => {
          if (pass !== 2) return
          await fs.unlink(sourcePath)
          execFileSync('mkfifo', [sourcePath])
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 211 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 211 } } as never,
      211
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const started = performance.now()
    await expect(
      manager.commitExport(
        { exportId: prepared.value.exportId, html: await generateBookExportHtml(prepared.value) },
        211
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-source-changed' } })
    expect(performance.now() - started).toBeLessThan(1_000)
    await expect(fs.stat(mocks.exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a FIFO destination parent at the final pin without blocking', async () => {
    if (process.platform === 'win32') return
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-fifo-parent-'))
    const moved = `${destination}-moved`
    temporaryDirectories.push(destination, moved)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager(
      '/export-fifo-parent-user-data',
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      {
        beforeExportParentPin: async () => {
          await fs.rename(destination, moved)
          execFileSync('mkfifo', [destination])
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 212 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const started = performance.now()
    await expect(
      manager.beginExport(opened.value.sessionId, { sender: { id: 212 } } as never, 212)
    ).resolves.toMatchObject({ ok: false, error: { code: 'export-write-failed' } })
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('reports committed uncertainty if the parent identity changes after rename', async () => {
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-post-rename-'))
    const moved = `${destination}-moved`
    temporaryDirectories.push(destination, moved)
    mocks.selectedPath = root
    mocks.exportPath = path.join(destination, 'book.html')
    const manager = new BookSessionManager(
      '/export-post-rename-user-data',
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      {
        afterExportRename: () => {
          fsSync.renameSync(destination, moved)
          fsSync.mkdirSync(destination)
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 208 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginExport(
      opened.value.sessionId,
      { sender: { id: 208 } } as never,
      208
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const result = await manager.commitExport(
      { exportId: prepared.value.exportId, html: await generateBookExportHtml(prepared.value) },
      208
    )
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'export-write-failed', committed: true }
    })
    expect(await fs.readFile(path.join(moved, 'book.html'), 'utf8')).toContain('<!doctype html>')
    await expect(fs.stat(path.join(destination, 'book.html'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})

describe('book local website transaction', () => {
  const generate = async (manager: BookSessionManager, sessionId: string, ownerId: number) => {
    const prepared = await manager.beginWebsite(
      sessionId,
      { sender: { id: ownerId } } as never,
      ownerId
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(prepared.error.message)
    const html = await generateBookExportHtml({
      ...prepared.value,
      exportId: prepared.value.websiteId
    })
    return manager.commitWebsite({ websiteId: prepared.value.websiteId, html }, ownerId)
  }

  it('revokes an expired website lease before staging any files', async () => {
    const root = await makeBook({ 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-expired-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const manager = new BookSessionManager('/website-expired-user-data')
    const opened = await manager.openPicker({ sender: { id: 300 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    vi.useFakeTimers({ now: Date.now() })
    try {
      const prepared = await manager.beginWebsite(
        opened.value.sessionId,
        { sender: { id: 300 } } as never,
        300
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      await vi.advanceTimersByTimeAsync(120_001)
      expect(manager.cancelWebsite(prepared.value.websiteId, 300)).toMatchObject({
        ok: false,
        error: { code: 'cancelled' }
      })
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['cancel-after-first-asset', 0, false],
    ['cancel-after-middle-asset', 1, false],
    ['ttl-after-first-asset', 0, true]
  ] as const)('removes an exact partial stage on %s', async (_label, stopIndex, expire) => {
    const root = await makeBook({
      'one.md': '# One\n\n![a](a.png)\n\n![b](b.gif)\n\n![c](c.svg)\n'
    })
    await Promise.all([
      fs.writeFile(path.join(root, 'a.png'), testPng),
      fs.writeFile(path.join(root, 'b.gif'), testGif),
      fs.writeFile(
        path.join(root, 'c.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#123456"/></svg>'
      )
    ])
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-partial-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const ownerId = 316 + stopIndex + (expire ? 10 : 0)
    let websiteId = ''
    const manager = new BookSessionManager(
      `/website-partial-${randomUUID()}`,
      loadBookFromDirectory,
      safelyReadBookChapter,
      undefined,
      {
        afterWebsiteAssetWrite: async (assetIndex) => {
          if (assetIndex !== stopIndex) return
          if (expire) {
            await vi.advanceTimersByTimeAsync(120_001)
          } else {
            expect(manager.cancelWebsite(websiteId, ownerId)).toEqual({ ok: true, value: true })
          }
        }
      }
    )
    if (expire) vi.useFakeTimers({ now: Date.now() })
    try {
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const prepared = await manager.beginWebsite(
        opened.value.sessionId,
        { sender: { id: ownerId } } as never,
        ownerId
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      websiteId = prepared.value.websiteId
      const html = await generateBookExportHtml({
        ...prepared.value,
        exportId: prepared.value.websiteId
      })
      await expect(manager.commitWebsite({ websiteId, html }, ownerId)).resolves.toMatchObject({
        ok: false,
        error: { code: 'cancelled' }
      })
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await fs.readdir(destination)).filter((name) => name.includes('stage'))).toEqual([])
    } finally {
      if (expire) vi.useRealTimers()
    }
  })

  it('creates exactly index and a canonical main-owned manifest in an absent target', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [一](one.md)\n- [别名](one.md#标题)\n- [缺失](missing.md)\n',
      'one.md': '# 标题\n\n中文正文\n'
    })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-target-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const manager = new BookSessionManager('/website-user-data')
    const opened = await manager.openPicker({ sender: { id: 301 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const saved = await generate(manager, opened.value.sessionId, 301)
    expect(saved).toMatchObject({
      ok: true,
      value: {
        directoryName: 'LeafBook-site',
        files: ['index.html', 'leafbook-manifest.json']
      }
    })
    expect((await fs.readdir(target)).sort()).toEqual(['index.html', 'leafbook-manifest.json'])
    const html = await fs.readFile(path.join(target, 'index.html'))
    const manifestBytes = await fs.readFile(path.join(target, 'leafbook-manifest.json'))
    const manifest = JSON.parse(manifestBytes.toString())
    expect(manifest).toEqual({
      schemaVersion: 2,
      generator: 'LeafBook',
      files: [
        {
          path: 'index.html',
          size: html.byteLength,
          sha256: createHash('sha256').update(html).digest('hex')
        }
      ]
    })
    expect(html.toString()).toContain('中文正文')
    expect(html.toString()).not.toContain(root)
  })

  it('writes deduplicated hashed assets and binds every website file in the manifest', async () => {
    const root = await makeBook({
      'SUMMARY.md': '- [One](one.md)\n- [Two](two.md)\n',
      'one.md': '# One\n\n![cover](cover.png)\n',
      'two.md': '# Two\n\n![duplicate](duplicate.png)\n'
    })
    await Promise.all([
      fs.writeFile(path.join(root, 'cover.png'), testPng),
      fs.writeFile(path.join(root, 'duplicate.png'), testPng)
    ])
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-assets-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const manager = new BookSessionManager('/website-assets-user-data')
    const opened = await manager.openPicker({ sender: { id: 314 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const saved = await generate(manager, opened.value.sessionId, 314)
    if (!saved.ok) {
      throw new Error(`${saved.error.code}: ${saved.error.message}`)
    }
    if (!saved.ok) return
    const assets = await fs.readdir(path.join(target, 'assets'))
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatch(/^[a-f0-9]{64}\.png$/u)
    const html = await fs.readFile(path.join(target, 'index.html'), 'utf8')
    expect(html).toContain(`assets/${assets[0]}`)
    expect(html).not.toMatch(/cover\.png|duplicate\.png|file:|https?:/u)
    const manifest = JSON.parse(
      await fs.readFile(path.join(target, 'leafbook-manifest.json'), 'utf8')
    ) as { files: Array<{ path: string; size: number; sha256: string }> }
    expect(manifest.files.map((file) => file.path)).toEqual([`assets/${assets[0]}`, 'index.html'])
    for (const file of manifest.files) {
      const bytes = await fs.readFile(path.join(target, ...file.path.split('/')))
      expect(file).toMatchObject({
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex')
      })
    }
  })

  it('maps unique website targets while preserving duplicate and missing occurrence order', async () => {
    const root = await makeBook({
      'one.md': [
        '# One',
        '![a-1](a.png)',
        '![a-2](a.png)',
        '![b-1](b.gif)',
        '![missing-1](missing.png)',
        '![missing-2](missing.png)',
        '![b-2](b.gif)'
      ].join('\n\n')
    })
    await Promise.all([
      fs.writeFile(path.join(root, 'a.png'), testPng),
      fs.writeFile(path.join(root, 'b.gif'), testGif)
    ])
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-order-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const manager = new BookSessionManager('/website-order-user-data')
    const opened = await manager.openPicker({ sender: { id: 315 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const prepared = await manager.beginWebsite(
      opened.value.sessionId,
      { sender: { id: 315 } } as never,
      315
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const targets = prepared.value.documents[0]?.resourceTargets ?? []
    expect(targets).toHaveLength(3)
    expect(targets[2]).toBeNull()
    const html = await generateBookExportHtml({
      ...prepared.value,
      exportId: prepared.value.websiteId
    })
    const sources = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/giu)].map(
      (match) => match[1]
    )
    expect(sources).toEqual([targets[0], targets[0], targets[1], targets[1]])
    expect(html.match(/<span class="leafbook-media-placeholder"/gu)).toHaveLength(2)
    await expect(
      manager.commitWebsite({ websiteId: prepared.value.websiteId, html }, 315)
    ).resolves.toMatchObject({ ok: true })
  })

  it.each([
    ['missing-created', false, true, false],
    ['invalid-replaced-with-valid', true, true, false],
    ['unchanged-invalid', true, false, true]
  ] as const)(
    'binds the final website placeholder to its exact negative source state: %s',
    async (_label, initiallyInvalid, replaceWithValid, succeeds) => {
      const root = await makeBook({ 'one.md': '# One\n\n![cover](cover.png)\n' })
      const imagePath = path.join(root, 'cover.png')
      if (initiallyInvalid) await fs.writeFile(imagePath, 'not-a-png')
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-negative-'))
      temporaryDirectories.push(destination)
      const target = path.join(destination, 'LeafBook-site')
      mocks.selectedPath = root
      mocks.exportPath = target
      const ownerId = 335 + (initiallyInvalid ? 1 : 0) + (replaceWithValid ? 2 : 0)
      const manager = new BookSessionManager(
        `/website-negative-${randomUUID()}`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          beforeExportCommitCritical: () => {
            if (replaceWithValid) fsSync.writeFileSync(imagePath, testPng)
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const result = await generate(manager, opened.value.sessionId, ownerId)
      expect(result.ok).toBe(succeeds)
      if (!succeeds) {
        expect(result).toMatchObject({ ok: false, error: { code: 'website-source-changed' } })
        await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
        expect((await fs.readdir(destination)).filter((name) => name.includes('stage'))).toEqual([])
      }
    }
  )

  it('rechecks website lease expiry after final synchronous validation and removes the stage', async () => {
    const root = await makeBook({ 'one.md': '# One\n\n![cover](cover.png)\n' })
    await fs.writeFile(path.join(root, 'cover.png'), testPng)
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-final-ttl-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    vi.useFakeTimers({ now: Date.now() })
    try {
      const manager = new BookSessionManager(
        '/website-final-ttl-user-data',
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          beforeWebsiteStageRename: () => {
            vi.setSystemTime(Date.now() + 120_001)
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: 340 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      await expect(generate(manager, opened.value.sessionId, 340)).resolves.toMatchObject({
        ok: false,
        error: { code: 'cancelled' }
      })
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await fs.readdir(destination)).filter((name) => name.includes('stage'))).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces empty and exact-owned targets, but refuses unknown or tampered targets', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-replace-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/website-replace-user-data')
    const opened = await manager.openPicker({ sender: { id: 302 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const empty = path.join(destination, 'empty-site')
    await fs.mkdir(empty)
    mocks.exportPath = empty
    expect(await generate(manager, opened.value.sessionId, 302)).toMatchObject({ ok: true })
    await fs.writeFile(path.join(root, 'one.md'), '# Changed\n')
    const refreshed = await manager.refresh(opened.value.sessionId, 302)
    expect(refreshed.ok).toBe(true)
    mocks.exportPath = empty
    expect(await generate(manager, opened.value.sessionId, 302)).toMatchObject({ ok: true })
    expect(await fs.readFile(path.join(empty, 'index.html'), 'utf8')).toContain('Changed')

    const unknown = path.join(destination, 'unknown-site')
    await fs.mkdir(unknown)
    await fs.writeFile(path.join(unknown, 'notes.txt'), 'keep me')
    mocks.exportPath = unknown
    expect(
      await manager.beginWebsite(opened.value.sessionId, { sender: { id: 302 } } as never, 302)
    ).toMatchObject({ ok: false, error: { code: 'website-unsafe-target' } })
    expect(await fs.readFile(path.join(unknown, 'notes.txt'), 'utf8')).toBe('keep me')

    await fs.writeFile(path.join(empty, 'index.html'), 'tampered')
    mocks.exportPath = empty
    expect(
      await manager.beginWebsite(opened.value.sessionId, { sender: { id: 302 } } as never, 302)
    ).toMatchObject({ ok: false, error: { code: 'website-unsafe-target' } })
  })

  it.each(['missing-to-valid', 'corrupt-to-valid', 'markdown-change'] as const)(
    'restores an owned website when %s is detected after the old target is backed up',
    async (mutation) => {
      const imageMarkdown = mutation === 'markdown-change' ? '' : '\n\n![cover](cover.png)\n'
      const root = await makeBook({ 'one.md': `# One${imageMarkdown}` })
      const imagePath = path.join(root, 'cover.png')
      if (mutation === 'corrupt-to-valid') await fs.writeFile(imagePath, 'not-a-png')
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-rollback-source-'))
      temporaryDirectories.push(destination)
      const target = path.join(destination, 'LeafBook-site')
      mocks.selectedPath = root
      mocks.exportPath = target
      const ownerId =
        mutation === 'missing-to-valid' ? 350 : mutation === 'corrupt-to-valid' ? 351 : 352
      let armed = false
      const manager = new BookSessionManager(
        `/website-rollback-source-${randomUUID()}`,
        loadBookFromDirectory,
        safelyReadBookChapter,
        undefined,
        {
          beforeWebsiteStageRename: () => {
            if (!armed) return
            if (mutation === 'markdown-change') {
              fsSync.writeFileSync(path.join(root, 'one.md'), '# Changed\n')
            } else {
              fsSync.writeFileSync(imagePath, testPng)
            }
          }
        }
      )
      const opened = await manager.openPicker({ sender: { id: ownerId } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      await expect(generate(manager, opened.value.sessionId, ownerId)).resolves.toMatchObject({
        ok: true
      })
      const oldIndex = await fs.readFile(path.join(target, 'index.html'))
      const oldManifest = await fs.readFile(path.join(target, 'leafbook-manifest.json'))
      armed = true
      await expect(generate(manager, opened.value.sessionId, ownerId)).resolves.toMatchObject({
        ok: false,
        error: { code: 'website-source-changed', committed: false }
      })
      expect(await fs.readFile(path.join(target, 'index.html'))).toEqual(oldIndex)
      expect(await fs.readFile(path.join(target, 'leafbook-manifest.json'))).toEqual(oldManifest)
      const leftovers = await fs.readdir(destination)
      expect(leftovers.filter((name) => name.includes('stage'))).toEqual([])
      expect(leftovers.filter((name) => name.includes('backup'))).toEqual([])
    }
  )

  it('refuses symlink, hardlink, and FIFO leaves without dispatching writes', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-special-'))
    temporaryDirectories.push(destination)
    mocks.selectedPath = root
    const manager = new BookSessionManager('/website-special-user-data')
    const opened = await manager.openPicker({ sender: { id: 303 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    for (const kind of ['symlink', 'hardlink', 'fifo'] as const) {
      const target = path.join(destination, kind)
      await fs.mkdir(target)
      const outside = path.join(destination, `${kind}-outside`)
      await fs.writeFile(outside, 'outside')
      if (kind === 'symlink') await fs.symlink(outside, path.join(target, 'index.html'))
      if (kind === 'hardlink') await fs.link(outside, path.join(target, 'index.html'))
      if (kind === 'fifo') {
        execFileSync('mkfifo', [path.join(target, 'index.html')])
      }
      await fs.writeFile(path.join(target, 'leafbook-manifest.json'), '{}')
      mocks.exportPath = target
      expect(
        await manager.beginWebsite(opened.value.sessionId, { sender: { id: 303 } } as never, 303)
      ).toMatchObject({ ok: false, error: { code: 'website-unsafe-target' } })
      expect(await fs.readFile(outside, 'utf8')).toBe('outside')
    }
  })

  it.each([
    ['second rename', false, false],
    ['rollback', true, false],
    ['backup cleanup', false, true]
  ] as const)(
    'contains deterministic %s failure without deleting an unproven path',
    async (_label, failRollback, failCleanup) => {
      const root = await makeBook({
        'SUMMARY.md': '- [One](one.md)\n',
        'one.md': '# Original\n'
      })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-failure-'))
      temporaryDirectories.push(destination)
      const target = path.join(destination, 'LeafBook-site')
      mocks.selectedPath = root
      mocks.exportPath = target
      const seed = new BookSessionManager(`/website-seed-${randomUUID()}`)
      const seededSession = await seed.openPicker({ sender: { id: 304 } } as never)
      expect(seededSession.ok).toBe(true)
      if (!seededSession.ok) return
      expect(await generate(seed, seededSession.value.sessionId, 304)).toMatchObject({ ok: true })
      const oldIndex = await fs.readFile(path.join(target, 'index.html'), 'utf8')

      await fs.writeFile(path.join(root, 'one.md'), '# Replacement\n')
      let stageRenameCalls = 0
      const hooks: BookSessionManagerTestHooks = {}
      if (failCleanup) {
        hooks.beforeWebsiteBackupCleanup = () => {
          throw new Error('injected cleanup failure')
        }
      } else {
        hooks.beforeWebsiteStageRename = () => {
          stageRenameCalls++
          throw new Error('injected second rename failure')
        }
        if (failRollback) {
          hooks.beforeWebsiteRollback = () => {
            throw new Error('injected rollback failure')
          }
        }
      }
      const manager = new BookSessionManager(
        `/website-failure-${randomUUID()}`,
        undefined,
        undefined,
        undefined,
        hooks
      )
      const opened = await manager.openPicker({ sender: { id: 305 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const result = await generate(manager, opened.value.sessionId, 305)
      if (failCleanup) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'website-commit-uncertain', committed: true }
        })
        expect(await fs.readFile(path.join(target, 'index.html'), 'utf8')).toContain('Replacement')
      } else if (failRollback) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'website-commit-uncertain', committed: true }
        })
        await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(stageRenameCalls).toBe(1)
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'website-write-failed', committed: false }
        })
        expect(await fs.readFile(path.join(target, 'index.html'), 'utf8')).toBe(oldIndex)
      }
      const leftovers = await fs.readdir(destination)
      expect(leftovers.filter((name) => name.includes('stage'))).toEqual([])
      if (!failRollback && !failCleanup) {
        expect(leftovers.filter((name) => name.includes('backup'))).toEqual([])
      } else {
        expect(leftovers.filter((name) => name.includes('backup'))).toHaveLength(1)
      }
    }
  )

  it('refuses a staging-directory identity swap and never deletes the replacement', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-stage-swap-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    let replacementPath = ''
    const manager = new BookSessionManager(
      `/website-stage-swap-${randomUUID()}`,
      undefined,
      undefined,
      undefined,
      {
        afterExportTempSync: async (stagePath) => {
          if (!stagePath) return
          await fs.rename(stagePath, `${stagePath}-moved`)
          await fs.mkdir(stagePath)
          await fs.writeFile(path.join(stagePath, 'attacker.txt'), 'do not delete')
          replacementPath = stagePath
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 306 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(await generate(manager, opened.value.sessionId, 306)).toMatchObject({
      ok: false,
      error: { code: 'website-write-failed', committed: false }
    })
    expect(await fs.readFile(path.join(replacementPath, 'attacker.txt'), 'utf8')).toBe(
      'do not delete'
    )
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses an exact-owned stage swap immediately before rename and preserves it', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-stage-critical-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    let attackerStage = ''
    let attackerIndexIno = 0n
    const manager = new BookSessionManager(
      `/website-stage-critical-${randomUUID()}`,
      undefined,
      undefined,
      undefined,
      {
        beforeWebsiteStageRename: (stagePath) => {
          if (!stagePath) throw new Error('missing stage path')
          const original = `${stagePath}-original`
          fsSync.renameSync(stagePath, original)
          fsSync.mkdirSync(stagePath)
          fsSync.copyFileSync(path.join(original, 'index.html'), path.join(stagePath, 'index.html'))
          fsSync.copyFileSync(
            path.join(original, 'leafbook-manifest.json'),
            path.join(stagePath, 'leafbook-manifest.json')
          )
          attackerStage = stagePath
          attackerIndexIno = fsSync.lstatSync(path.join(stagePath, 'index.html'), {
            bigint: true
          }).ino
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 308 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(await generate(manager, opened.value.sessionId, 308)).toMatchObject({
      ok: false,
      error: { code: 'website-write-failed', committed: false }
    })
    expect(fsSync.lstatSync(path.join(attackerStage, 'index.html'), { bigint: true }).ino).toBe(
      attackerIndexIno
    )
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports uncertainty and preserves an exact-owned target swap after rename', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-target-post-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    let attackerIndexIno = 0n
    const manager = new BookSessionManager(
      `/website-target-post-${randomUUID()}`,
      undefined,
      undefined,
      undefined,
      {
        afterWebsiteStageRename: (targetPath) => {
          if (!targetPath) throw new Error('missing target path')
          const original = `${targetPath}-original`
          fsSync.renameSync(targetPath, original)
          fsSync.mkdirSync(targetPath)
          fsSync.copyFileSync(
            path.join(original, 'index.html'),
            path.join(targetPath, 'index.html')
          )
          fsSync.copyFileSync(
            path.join(original, 'leafbook-manifest.json'),
            path.join(targetPath, 'leafbook-manifest.json')
          )
          attackerIndexIno = fsSync.lstatSync(path.join(targetPath, 'index.html'), {
            bigint: true
          }).ino
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 309 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(await generate(manager, opened.value.sessionId, 309)).toMatchObject({
      ok: false,
      error: { code: 'website-commit-uncertain', committed: true }
    })
    expect(fsSync.lstatSync(path.join(target, 'index.html'), { bigint: true }).ino).toBe(
      attackerIndexIno
    )
  })

  it('refuses rollback from a swapped exact-owned backup and preserves the attacker', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-backup-rollback-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const seed = new BookSessionManager(`/website-backup-seed-${randomUUID()}`)
    const seeded = await seed.openPicker({ sender: { id: 310 } } as never)
    expect(seeded.ok).toBe(true)
    if (!seeded.ok) return
    expect(await generate(seed, seeded.value.sessionId, 310)).toMatchObject({ ok: true })
    let attackerBackup = ''
    let attackerIndexIno = 0n
    const manager = new BookSessionManager(
      `/website-backup-rollback-${randomUUID()}`,
      undefined,
      undefined,
      undefined,
      {
        beforeWebsiteStageRename: () => {
          throw new Error('force rollback')
        },
        beforeWebsiteRollback: (backupPath) => {
          if (!backupPath) throw new Error('missing backup path')
          const original = `${backupPath}-original`
          fsSync.renameSync(backupPath, original)
          fsSync.mkdirSync(backupPath)
          fsSync.copyFileSync(
            path.join(original, 'index.html'),
            path.join(backupPath, 'index.html')
          )
          fsSync.copyFileSync(
            path.join(original, 'leafbook-manifest.json'),
            path.join(backupPath, 'leafbook-manifest.json')
          )
          attackerBackup = backupPath
          attackerIndexIno = fsSync.lstatSync(path.join(backupPath, 'index.html'), {
            bigint: true
          }).ino
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 311 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(await generate(manager, opened.value.sessionId, 311)).toMatchObject({
      ok: false,
      error: { code: 'website-commit-uncertain', committed: true }
    })
    expect(fsSync.lstatSync(path.join(attackerBackup, 'index.html'), { bigint: true }).ino).toBe(
      attackerIndexIno
    )
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stops cleanup after an exact-owned backup swap and preserves the attacker leaves', async () => {
    const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-backup-cleanup-'))
    temporaryDirectories.push(destination)
    const target = path.join(destination, 'LeafBook-site')
    mocks.selectedPath = root
    mocks.exportPath = target
    const seed = new BookSessionManager(`/website-cleanup-seed-${randomUUID()}`)
    const seeded = await seed.openPicker({ sender: { id: 312 } } as never)
    expect(seeded.ok).toBe(true)
    if (!seeded.ok) return
    expect(await generate(seed, seeded.value.sessionId, 312)).toMatchObject({ ok: true })
    const attackerSource = path.join(destination, 'attacker-owned')
    fsSync.mkdirSync(attackerSource)
    fsSync.copyFileSync(path.join(target, 'index.html'), path.join(attackerSource, 'index.html'))
    fsSync.copyFileSync(
      path.join(target, 'leafbook-manifest.json'),
      path.join(attackerSource, 'leafbook-manifest.json')
    )
    const attackerIndexIno = fsSync.lstatSync(path.join(attackerSource, 'index.html'), {
      bigint: true
    }).ino
    let attackerBackup = ''
    const manager = new BookSessionManager(
      `/website-backup-cleanup-${randomUUID()}`,
      undefined,
      undefined,
      undefined,
      {
        duringWebsiteBackupCleanup: (backupPath) => {
          if (!backupPath) throw new Error('missing backup path')
          fsSync.renameSync(backupPath, `${backupPath}-original`)
          fsSync.renameSync(attackerSource, backupPath)
          attackerBackup = backupPath
        }
      }
    )
    const opened = await manager.openPicker({ sender: { id: 313 } } as never)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(await generate(manager, opened.value.sessionId, 313)).toMatchObject({
      ok: true,
      value: { durabilityUncertain: true }
    })
    expect(fsSync.lstatSync(path.join(attackerBackup, 'index.html'), { bigint: true }).ino).toBe(
      attackerIndexIno
    )
    expect(
      await fs.readFile(path.join(attackerBackup, 'leafbook-manifest.json'), 'utf8')
    ).toContain('"generator": "LeafBook"')
  })

  it.each(['index', 'manifest'] as const)(
    'rechecks a replacement %s leaf after expensive cleanup boundary validation',
    async (leaf) => {
      const root = await makeBook({ 'SUMMARY.md': '- [One](one.md)\n', 'one.md': '# One\n' })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-leaf-race-'))
      temporaryDirectories.push(destination)
      const target = path.join(destination, 'LeafBook-site')
      mocks.selectedPath = root
      mocks.exportPath = target
      const seed = new BookSessionManager(`/website-leaf-seed-${randomUUID()}`)
      const seeded = await seed.openPicker({ sender: { id: 314 } } as never)
      expect(seeded.ok).toBe(true)
      if (!seeded.ok) return
      expect(await generate(seed, seeded.value.sessionId, 314)).toMatchObject({ ok: true })
      let backupPath = ''
      let replacementIno = 0n
      const replaceLeaf = (directoryPath: string, name: string): void => {
        const leafPath = path.join(directoryPath, name)
        const bytes = fsSync.readFileSync(leafPath)
        fsSync.unlinkSync(leafPath)
        fsSync.writeFileSync(leafPath, bytes)
        backupPath = directoryPath
        replacementIno = fsSync.lstatSync(leafPath, { bigint: true }).ino
      }
      const hooks: BookSessionManagerTestHooks = {}
      if (leaf === 'index') {
        hooks.beforeWebsiteIndexFinalInspection = (directoryPath) => {
          if (!directoryPath) throw new Error('missing backup path')
          replaceLeaf(directoryPath, 'index.html')
        }
      } else {
        hooks.beforeWebsiteManifestFinalInspection = (directoryPath) => {
          if (!directoryPath) throw new Error('missing backup path')
          replaceLeaf(directoryPath, 'leafbook-manifest.json')
        }
      }
      const manager = new BookSessionManager(
        `/website-leaf-race-${randomUUID()}`,
        undefined,
        undefined,
        undefined,
        hooks
      )
      const opened = await manager.openPicker({ sender: { id: 315 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      expect(await generate(manager, opened.value.sessionId, 315)).toMatchObject({
        ok: true,
        value: { durabilityUncertain: true }
      })
      const name = leaf === 'index' ? 'index.html' : 'leafbook-manifest.json'
      expect(fsSync.lstatSync(path.join(backupPath, name), { bigint: true }).ino).toBe(
        replacementIno
      )
    }
  )

  it('revalidates chapter, SUMMARY, and absent-target state before writing', async () => {
    for (const mutation of ['chapter', 'summary', 'target'] as const) {
      const root = await makeBook({
        'SUMMARY.md': '- [One](one.md)\n',
        'one.md': '# One\n'
      })
      const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-site-revalidate-'))
      temporaryDirectories.push(destination)
      const target = path.join(destination, `site-${mutation}`)
      mocks.selectedPath = root
      mocks.exportPath = target
      const manager = new BookSessionManager(`/website-revalidate-${randomUUID()}`)
      const opened = await manager.openPicker({ sender: { id: 307 } } as never)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const prepared = await manager.beginWebsite(
        opened.value.sessionId,
        { sender: { id: 307 } } as never,
        307
      )
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      if (mutation === 'chapter') await fs.writeFile(path.join(root, 'one.md'), '# Mutated\n')
      if (mutation === 'summary') {
        await fs.writeFile(path.join(root, 'SUMMARY.md'), '- [Changed](one.md)\n')
      }
      if (mutation === 'target') {
        await fs.mkdir(target)
        await fs.writeFile(path.join(target, 'unknown.txt'), 'keep')
      }
      const html = await generateBookExportHtml({
        ...prepared.value,
        exportId: prepared.value.websiteId
      })
      const result = await manager.commitWebsite({ websiteId: prepared.value.websiteId, html }, 307)
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: mutation === 'target' ? 'website-unsafe-target' : 'website-source-changed'
        }
      })
      if (mutation === 'target') {
        expect(await fs.readFile(path.join(target, 'unknown.txt'), 'utf8')).toBe('keep')
      }
    }
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
    expect(flattenReadableNodeIds(nodes, 'root')).toEqual(['root', 'landing', 'one', 'two'])
    expect(adjacentChapter(nodes, 'landing', -1, 'root')).toBe('root')
    expect(adjacentChapter(nodes, 'root', 1, 'root')).toBe('landing')
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

  it('keeps semantic heading identity aligned before image placeholders mutate the body', async () => {
    const markdown = [
      '# ![Logo](local.png) **Final**',
      'Setext title',
      '============',
      '# [Linked *title*](chapter.md) &amp; Héllo，世界',
      '# ![Remote](https://example.invalid/image.png) `Code`',
      '<h1><img src="raw.png" alt="Raw"> HTML</h1>',
      '# Repeat',
      '# Repeat'
    ].join('\n\n')
    const analyzed = analyzeAtxH1Headings(markdown)
    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return

    const rendered = await renderBookMarkdown(markdown)
    const titles = analyzed.headings.map((heading) => heading.title)
    const fragments = titles.map(bookFragmentKey)
    expect(titles).toEqual([
      'Logo Final',
      'Linked title & Héllo，世界',
      'Remote Code',
      'Repeat',
      'Repeat'
    ])
    expect(rendered.outline.map(({ text }) => text)).toEqual([
      titles[0],
      titles[1],
      titles[2],
      'Raw HTML',
      titles[3],
      titles[4]
    ])
    expect(rendered.outline.filter((_, index) => [0, 1, 2, 4, 5].includes(index))).toMatchObject(
      titles.map((text, index) => ({ text, fragment: fragments[index] }))
    )
    expect(rendered.outline.map(({ id }) => id)).toEqual([
      fragments[0],
      fragments[1],
      fragments[2],
      'raw-html',
      fragments[3],
      `${fragments[4]}-2`
    ])
    expect(validateBookHeadingFragments(titles)).toMatchObject({
      ok: false,
      error: 'duplicate-fragment',
      index: 4
    })
    const renderedDocument = new DOMParser().parseFromString(rendered.html, 'text/html')
    const renderedHeadings = [...renderedDocument.querySelectorAll('h1')]
    expect(renderedHeadings[0].textContent).toBe(' Final')
    expect(renderedHeadings[0].querySelector('img')?.alt).toBe('Logo')
    expect(renderedHeadings[0].querySelector('img')?.getAttribute('src')).toBeNull()
    expect(renderedHeadings[2].textContent).toBe(
      '[Local image unavailable in this reader version: Remote] Code'
    )
    expect(renderedHeadings[3].textContent).toBe(
      '[Local image unavailable in this reader version: Raw] HTML'
    )
    expect(rendered.html).toContain('Setext title')
    expect(renderedDocument.querySelectorAll('.leafbook-media-placeholder')).toHaveLength(2)
    expect(rendered.outline[0].id).not.toContain('local-image-unavailable')
  })
})

describe('book store async generations', () => {
  const sessionDto = (sessionId: string, title: string): BookSessionDto => ({
    libraryId: `${sessionId}-library`,
    sessionId,
    resourceToken: `${sessionId}-resource`,
    title,
    navigationSource: 'inferred',
    nodes: [],
    entryNodeId: null,
    landingNodeId: null,
    resumeNodeId: null,
    readingProgress: 0,
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

  it('blocks opening a node during refresh instead of replaying it against the replacement', async () => {
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
    expect(readChapter).not.toHaveBeenCalled()
    expect(store.chapter).toBeNull()
  })

  it('blocks every current-book IPC entrypoint while renderer refresh is pending', async () => {
    vi.useFakeTimers()
    try {
      setActivePinia(createPinia())
      const pendingRefresh = deferred<BookReaderResult<BookSessionDto>>()
      const refreshed = {
        ...sessionDto('stable-session-id', 'Refreshed'),
        navigationSource: 'summary' as const,
        nodes: [
          {
            nodeId: 'stable-node-id-0001',
            type: 'chapter' as const,
            title: 'Chapter',
            children: []
          }
        ]
      }
      const books = {
        refresh: vi.fn(() => pendingRefresh.promise),
        readChapter: vi.fn(),
        followLink: vi.fn(),
        beginEdit: vi.fn(),
        beginArrangement: vi.fn(),
        beginPreparation: vi.fn(),
        beginExport: vi.fn(),
        beginWebsite: vi.fn(),
        search: vi.fn(),
        cancelSearch: vi.fn().mockResolvedValue({ ok: true, value: true })
      }
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { books }
      })
      const store = useBooksStore()
      store.session = refreshed
      store.chapter = {
        nodeId: 'stable-node-id-0001',
        title: 'Chapter',
        markdown: '# Chapter',
        fragment: null,
        readingPosition: 0,
        hasReadingPosition: false
      }
      store.mode = 'reader'

      const refreshing = store.refresh()
      expect(store.refreshing).toBe(true)
      await Promise.all([
        store.openNode('stable-node-id-0001'),
        store.activateNode(refreshed.nodes[0]),
        store.followLink('#chapter'),
        store.editCurrentChapter(),
        store.beginArrangement(),
        store.exportBook(),
        store.generateWebsite(),
        store.previous(),
        store.next()
      ])
      store.scheduleSearch('chapter')
      store.session = { ...refreshed, navigationSource: 'inferred' }
      await store.beginPreparation()
      await vi.advanceTimersByTimeAsync(500)

      for (const method of [
        books.readChapter,
        books.followLink,
        books.beginEdit,
        books.beginArrangement,
        books.beginPreparation,
        books.beginExport,
        books.beginWebsite,
        books.search
      ]) {
        expect(method).not.toHaveBeenCalled()
      }
      pendingRefresh.resolve({ ok: true, value: refreshed })
      await refreshing
      expect(store.refreshing).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('debounces searches, cancels the prior request and ignores its stale result', async () => {
    vi.useFakeTimers()
    try {
      setActivePinia(createPinia())
      const first = deferred<BookReaderResult<BookSearchResponseDto>>()
      const second = deferred<BookReaderResult<BookSearchResponseDto>>()
      const search = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
      const cancelSearch = vi.fn().mockResolvedValue({ ok: true, value: true })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { books: { search, cancelSearch } }
      })
      const store = useBooksStore()
      store.session = sessionDto('stable-session-id', 'Search')
      store.mode = 'reader'

      store.scheduleSearch('first')
      await vi.advanceTimersByTimeAsync(200)
      const firstSearchId = search.mock.calls[0]?.[1].searchId as string
      store.scheduleSearch('second')
      first.resolve({
        ok: true,
        value: {
          searchId: firstSearchId,
          query: 'first',
          results: [{ nodeId: 'first-node', title: 'First', breadcrumbs: [], matches: [] }],
          totalResults: 1,
          truncated: false,
          index: {
            eligibleDocuments: 1,
            indexedDocuments: 1,
            omittedDocuments: 0,
            partial: false
          }
        }
      })
      await Promise.resolve()
      expect(store.searchResults).toEqual([])
      expect(search).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(200)
      expect(search).toHaveBeenCalledTimes(2)
      expect(cancelSearch).toHaveBeenCalledTimes(1)

      const secondSearchId = search.mock.calls[1]?.[1].searchId as string
      second.resolve({
        ok: true,
        value: {
          searchId: secondSearchId,
          query: 'second',
          results: [{ nodeId: 'second-node', title: 'Second', breadcrumbs: [], matches: [] }],
          totalResults: 1,
          truncated: false,
          index: {
            eligibleDocuments: 1,
            indexedDocuments: 1,
            omittedDocuments: 0,
            partial: false
          }
        }
      })
      await Promise.resolve()
      expect(store.searchResults.map((result) => result.nodeId)).toEqual(['second-node'])
    } finally {
      vi.useRealTimers()
    }
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
        available: true,
        readingProgress: 0
      }
    ])
    await Promise.all([removing, leaving])
    expect(store.mode).toBe('editor')
    expect(store.libraries).toEqual([])
  })

  it('saves progress only for the current session and applies the returned overall progress', async () => {
    setActivePinia(createPinia())
    const saveReadingPosition = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        chapterProgress: 0.5,
        overallProgress: 0.75,
        updatedAt: new Date(0).toISOString()
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { saveReadingPosition } }
    })
    const store = useBooksStore()
    store.session = {
      ...sessionDto('stable-session-id', 'Progress'),
      nodes: [{ nodeId: 'stable-node-id-0001', type: 'chapter', title: 'Chapter', children: [] }]
    }
    store.chapter = {
      nodeId: 'stable-node-id-0001',
      title: 'Chapter',
      markdown: '# Chapter',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    store.mode = 'reader'

    await store.saveReadingPosition(0.5)
    expect(saveReadingPosition).toHaveBeenCalledWith(
      'stable-session-id',
      'stable-node-id-0001',
      0.5
    )
    expect(store.session.readingProgress).toBe(0.75)

    const pending = deferred<
      BookReaderResult<{
        chapterProgress: number
        overallProgress: number
        updatedAt: string
      }>
    >()
    saveReadingPosition.mockImplementationOnce(() => pending.promise)
    const stale = store.saveReadingPosition(0.8)
    store.session = sessionDto('replacement-session', 'Replacement')
    pending.resolve({
      ok: true,
      value: {
        chapterProgress: 0.8,
        overallProgress: 0.9,
        updatedAt: new Date(1).toISOString()
      }
    })
    await stale
    expect(store.session.readingProgress).toBe(0)
  })

  it('debounces writes and coalesces them to one in-flight request plus the latest position', async () => {
    vi.useFakeTimers()
    try {
      setActivePinia(createPinia())
      const first = deferred<
        BookReaderResult<{
          chapterProgress: number
          overallProgress: number
          updatedAt: string
        }>
      >()
      const second = deferred<
        BookReaderResult<{
          chapterProgress: number
          overallProgress: number
          updatedAt: string
        }>
      >()
      const saveReadingPosition = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            saveReadingPosition
          }
        }
      })
      const store = useBooksStore()
      store.mode = 'reader'
      store.session = {
        ...sessionDto('stable-session-id', 'Progress'),
        nodes: [{ nodeId: 'stable-node-id-0001', type: 'chapter', title: 'Chapter', children: [] }]
      }
      store.chapter = {
        nodeId: 'stable-node-id-0001',
        title: 'Chapter',
        markdown: '# Chapter',
        fragment: null,
        readingPosition: 0,
        hasReadingPosition: false
      }
      store.reportReadingPosition(0.1)
      store.reportReadingPosition(0.2)
      store.reportReadingPosition(0.3)
      expect(saveReadingPosition).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(saveReadingPosition).toHaveBeenCalledTimes(1)
      expect(saveReadingPosition).toHaveBeenLastCalledWith(
        'stable-session-id',
        'stable-node-id-0001',
        0.3
      )

      store.reportReadingPosition(0.4)
      store.reportReadingPosition(0.5)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(saveReadingPosition).toHaveBeenCalledTimes(1)
      const flushing = store.flushReadingPosition()
      first.resolve({
        ok: true,
        value: { chapterProgress: 0.3, overallProgress: 0.3, updatedAt: new Date(0).toISOString() }
      })
      await vi.waitFor(() => expect(saveReadingPosition).toHaveBeenCalledTimes(2))
      expect(store.chapter?.readingPosition).toBe(0.5)
      expect(saveReadingPosition).toHaveBeenLastCalledWith(
        'stable-session-id',
        'stable-node-id-0001',
        0.5
      )
      second.resolve({
        ok: true,
        value: { chapterProgress: 0.5, overallProgress: 0.5, updatedAt: new Date(1).toISOString() }
      })
      await flushing
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores reading-position reports while loading and does not enqueue a delayed write', async () => {
    vi.useFakeTimers()
    try {
      setActivePinia(createPinia())
      const listed = deferred<BookshelfEntryDto[]>()
      const saveReadingPosition = vi.fn()
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            list: vi.fn(() => listed.promise),
            saveReadingPosition
          }
        }
      })
      const store = useBooksStore()
      store.mode = 'reader'
      store.session = {
        ...sessionDto('stable-session-id', 'Loading'),
        nodes: [{ nodeId: 'stable-node-id-0001', type: 'chapter', title: 'Chapter', children: [] }]
      }
      store.chapter = {
        nodeId: 'stable-node-id-0001',
        title: 'Chapter',
        markdown: '# Chapter',
        fragment: null,
        readingPosition: 0.4,
        hasReadingPosition: true
      }
      const loading = store.loadBookshelf()
      expect(store.loading).toBe(true)
      store.reportReadingPosition(0)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(saveReadingPosition).not.toHaveBeenCalled()
      expect(store.chapter.readingPosition).toBe(0.4)
      listed.resolve([])
      await loading
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not prequeue zero for an explicit fragment and saves the completed anchor ratio', async () => {
    vi.useFakeTimers()
    try {
      setActivePinia(createPinia())
      const saveReadingPosition = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          chapterProgress: 0.8,
          overallProgress: 0.9,
          updatedAt: new Date().toISOString()
        }
      })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            readChapter: vi.fn().mockResolvedValue({
              ok: true,
              value: {
                nodeId: 'second-node-id-0001',
                title: 'Second',
                markdown: '# Second',
                fragment: null,
                readingPosition: 0,
                hasReadingPosition: false
              }
            }),
            saveReadingPosition
          }
        }
      })
      const store = useBooksStore()
      store.mode = 'reader'
      store.session = {
        ...sessionDto('stable-session-id', 'Anchor'),
        nodes: [
          { nodeId: 'first-node-id-00001', type: 'chapter', title: 'First', children: [] },
          { nodeId: 'second-node-id-0001', type: 'chapter', title: 'Second', children: [] }
        ]
      }
      await store.openNode('second-node-id-0001', 'section-80')
      await vi.advanceTimersByTimeAsync(3_000)
      expect(saveReadingPosition).not.toHaveBeenCalled()

      const restoration = store.beginReadingPositionRestore()
      const flushing = store.flushReadingPosition()
      await Promise.resolve()
      expect(saveReadingPosition).not.toHaveBeenCalled()
      store.completeReadingPositionRestore(restoration, 0.8, true)
      await flushing
      expect(saveReadingPosition).toHaveBeenCalledOnce()
      expect(saveReadingPosition).toHaveBeenCalledWith(
        'stable-session-id',
        'second-node-id-0001',
        0.8
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['render', 'paint'] as const)(
    'releases restoration after a controlled %s failure and keeps later saves usable',
    async (failure) => {
      setActivePinia(createPinia())
      const saveReadingPosition = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          chapterProgress: 0.4,
          overallProgress: 0.4,
          updatedAt: new Date().toISOString()
        }
      })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            readChapter: vi.fn().mockImplementation(async (_sessionId, nodeId) => ({
              ok: true,
              value: {
                nodeId,
                title: 'Next chapter',
                markdown: '# Next chapter',
                fragment: null,
                readingPosition: 0.4,
                hasReadingPosition: true
              }
            })),
            saveReadingPosition
          }
        }
      })
      const store = useBooksStore()
      store.mode = 'reader'
      store.session = {
        ...sessionDto('stable-session-id', 'Failure'),
        nodes: [
          { nodeId: 'stable-node-id-0001', type: 'chapter', title: 'Chapter', children: [] },
          { nodeId: 'stable-node-id-0002', type: 'chapter', title: 'Next', children: [] }
        ]
      }
      store.chapter = {
        nodeId: 'stable-node-id-0001',
        title: 'Chapter',
        markdown: '# Chapter',
        fragment: null,
        readingPosition: 0,
        hasReadingPosition: false
      }
      const generation = store.beginReadingPositionRestore()
      const failed = vi.fn()
      const flushing = store.flushReadingPosition()
      await restoreReadingPosition({
        render: async () => {
          if (failure === 'render') throw new Error('controlled render failure')
          return { html: '<h1>Chapter</h1>' }
        },
        isCurrent: () => true,
        mount: vi.fn(),
        waitForMount: async () => undefined,
        waitForPaint: async () => {
          if (failure === 'paint') throw new Error('controlled paint failure')
        },
        position: vi.fn(),
        sample: () => 0,
        complete: vi.fn(),
        fail: failed,
        release: () => store.cancelReadingPositionRestore(generation)
      })
      await flushing
      expect(failed).toHaveBeenCalledOnce()
      expect(store.readingPositionReady).toBe(true)

      store.reportReadingPosition(0.4)
      await store.flushReadingPosition()
      expect(saveReadingPosition).toHaveBeenCalledWith(
        'stable-session-id',
        'stable-node-id-0001',
        0.4
      )

      await store.openNode('stable-node-id-0002')
      expect(store.chapter?.markdown).toBe('# Next chapter')
    }
  )

  it('bounds restoration when animation frames never run and keeps later work usable', async () => {
    vi.useFakeTimers()
    try {
      let frameId = 0
      const cancelAnimationFrame = vi.fn()
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => ++frameId)
      )
      vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
      setActivePinia(createPinia())
      const saveReadingPosition = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          chapterProgress: 0.4,
          overallProgress: 0.4,
          updatedAt: new Date().toISOString()
        }
      })
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          books: {
            readChapter: vi.fn().mockResolvedValue({
              ok: true,
              value: {
                nodeId: 'stable-node-id-0002',
                title: 'Next chapter',
                markdown: '# Next chapter',
                fragment: null,
                readingPosition: 0,
                hasReadingPosition: false
              }
            }),
            saveReadingPosition
          }
        }
      })
      const store = useBooksStore()
      store.mode = 'reader'
      store.session = {
        ...sessionDto('stable-session-id', 'Bounded paint'),
        nodes: [
          { nodeId: 'stable-node-id-0001', type: 'chapter', title: 'Chapter', children: [] },
          { nodeId: 'stable-node-id-0002', type: 'chapter', title: 'Next', children: [] }
        ]
      }
      store.chapter = {
        nodeId: 'stable-node-id-0001',
        title: 'Chapter',
        markdown: '# Chapter',
        fragment: null,
        readingPosition: 0,
        hasReadingPosition: false
      }
      const generation = store.beginReadingPositionRestore()
      const restoration = restoreReadingPosition({
        render: async () => ({ html: '<h1>Chapter</h1>' }),
        isCurrent: () => true,
        mount: vi.fn(),
        waitForMount: async () => undefined,
        waitForPaint,
        position: vi.fn(),
        sample: () => 0,
        complete: (ratio) => store.completeReadingPositionRestore(generation, ratio, false),
        fail: vi.fn(),
        release: () => store.cancelReadingPositionRestore(generation)
      })
      let flushed = false
      const flushing = store.flushReadingPosition().then(() => {
        flushed = true
      })

      await vi.advanceTimersByTimeAsync(PAINT_WAIT_TIMEOUT_MS * 2 - 1)
      expect(flushed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([restoration, flushing])
      expect(flushed).toBe(true)
      expect(cancelAnimationFrame).toHaveBeenCalledTimes(2)

      store.reportReadingPosition(0.4)
      await store.flushReadingPosition()
      expect(saveReadingPosition).toHaveBeenCalledWith(
        'stable-session-id',
        'stable-node-id-0001',
        0.4
      )
      await store.openNode('stable-node-id-0002')
      expect(store.chapter?.markdown).toBe('# Next chapter')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('falls back and cancels the second frame when only one animation frame runs', async () => {
    vi.useFakeTimers()
    try {
      const callbacks = new Map<number, FrameRequestCallback>()
      let frameId = 0
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          callbacks.set(++frameId, callback)
          return frameId
        })
      )
      const cancelAnimationFrame = vi.fn((id: number) => callbacks.delete(id))
      vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

      const waiting = waitForPaint()
      callbacks.get(1)?.(0)
      callbacks.delete(1)
      expect(callbacks.has(2)).toBe(true)
      await vi.advanceTimersByTimeAsync(PAINT_WAIT_TIMEOUT_MS)
      await waiting

      expect(cancelAnimationFrame).toHaveBeenCalledWith(2)
      expect(callbacks.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('uses the bounded fallback when animation frame APIs are unavailable', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('requestAnimationFrame', undefined)
      vi.stubGlobal('cancelAnimationFrame', undefined)
      let finished = false
      const waiting = waitForPaint().then(() => {
        finished = true
      })

      await vi.advanceTimersByTimeAsync(PAINT_WAIT_TIMEOUT_MS - 1)
      expect(finished).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await waiting
      expect(finished).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('finishes on two animation frames without waiting for the timeout', async () => {
    vi.useFakeTimers()
    try {
      const callbacks = new Map<number, FrameRequestCallback>()
      let frameId = 0
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          callbacks.set(++frameId, callback)
          return frameId
        })
      )
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => callbacks.delete(id))
      )

      let finished = false
      const waiting = waitForPaint().then(() => {
        finished = true
      })
      callbacks.get(1)?.(0)
      callbacks.delete(1)
      await Promise.resolve()
      expect(finished).toBe(false)
      callbacks.get(2)?.(0)
      callbacks.delete(2)
      await waiting

      expect(finished).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('cancels a pending second frame and timeout when restoration becomes stale', async () => {
    vi.useFakeTimers()
    try {
      const callbacks = new Map<number, FrameRequestCallback>()
      let frameId = 0
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          callbacks.set(++frameId, callback)
          return frameId
        })
      )
      const cancelAnimationFrame = vi.fn((id: number) => callbacks.delete(id))
      vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
      const controller = new AbortController()

      const waiting = waitForPaint(controller.signal)
      const firstFrame = callbacks.get(1)
      callbacks.delete(1)
      firstFrame?.(0)
      expect(callbacks.has(2)).toBe(true)
      controller.abort()
      await waiting

      expect(cancelAnimationFrame).toHaveBeenCalledWith(2)
      expect(callbacks.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('does not let stale restoration cleanup release the current generation', async () => {
    setActivePinia(createPinia())
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { books: { saveReadingPosition: vi.fn() } }
    })
    const store = useBooksStore()
    store.mode = 'reader'
    store.session = {
      ...sessionDto('stable-session-id', 'Stale'),
      nodes: [{ nodeId: 'stable-node-id-0001', type: 'chapter', title: 'Chapter', children: [] }]
    }
    store.chapter = {
      nodeId: 'stable-node-id-0001',
      title: 'Chapter',
      markdown: '# Chapter',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    const oldGeneration = store.beginReadingPositionRestore()
    let current = true
    const rendered = deferred<{ html: string }>()
    const oldWork = restoreReadingPosition({
      render: () => rendered.promise,
      isCurrent: () => current,
      mount: vi.fn(),
      waitForMount: async () => undefined,
      waitForPaint: async () => undefined,
      position: vi.fn(),
      sample: () => 0,
      complete: vi.fn(),
      fail: vi.fn(),
      release: () => store.cancelReadingPositionRestore(oldGeneration)
    })
    current = false
    const currentGeneration = store.beginReadingPositionRestore()
    let flushed = false
    const flushing = store.flushReadingPosition().then(() => {
      flushed = true
    })
    rendered.resolve({ html: '<h1>Stale</h1>' })
    await oldWork
    await Promise.resolve()
    expect(flushed).toBe(false)
    expect(store.readingPositionReady).toBe(false)

    store.cancelReadingPositionRestore(currentGeneration)
    await flushing
    expect(store.readingPositionReady).toBe(true)
  })

  it('flushes the latest provider position before refresh reads the restored chapter', async () => {
    setActivePinia(createPinia())
    const saved = deferred<
      BookReaderResult<{
        chapterProgress: number
        overallProgress: number
        updatedAt: string
      }>
    >()
    const refreshed = {
      ...sessionDto('stable-session-id', 'Refreshed'),
      nodes: [
        { nodeId: 'stable-node-id-0001', type: 'chapter' as const, title: 'Chapter', children: [] }
      ],
      entryNodeId: 'stable-node-id-0001',
      resumeNodeId: 'stable-node-id-0001'
    }
    const refresh = vi.fn().mockResolvedValue({ ok: true, value: refreshed })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          saveReadingPosition: vi.fn(() => saved.promise),
          refresh,
          readChapter: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              nodeId: 'stable-node-id-0001',
              title: 'Chapter',
              markdown: '# Chapter',
              fragment: null,
              readingPosition: 0.82,
              hasReadingPosition: true
            }
          })
        }
      }
    })
    const store = useBooksStore()
    store.session = refreshed
    store.chapter = {
      nodeId: 'stable-node-id-0001',
      title: 'Chapter',
      markdown: '# Chapter',
      fragment: null,
      readingPosition: 0.2,
      hasReadingPosition: true
    }
    store.registerReadingPositionProvider(() => 0.82)
    const refreshing = store.refresh()
    await vi.waitFor(() =>
      expect(window.electron.books.saveReadingPosition).toHaveBeenCalledWith(
        'stable-session-id',
        'stable-node-id-0001',
        0.82
      )
    )
    expect(refresh).not.toHaveBeenCalled()
    saved.resolve({
      ok: true,
      value: { chapterProgress: 0.82, overallProgress: 0.82, updatedAt: new Date().toISOString() }
    })
    await refreshing
    expect(refresh).toHaveBeenCalledOnce()
    expect(store.chapter?.readingPosition).toBe(0.82)
  })

  it('lets explicit fragments win while restore intent uses a saved ratio', async () => {
    setActivePinia(createPinia())
    const value = {
      ...sessionDto('stable-session-id', 'Intent'),
      nodes: [
        { nodeId: 'first-node-id-00001', type: 'chapter' as const, title: 'First', children: [] },
        { nodeId: 'second-node-id-0001', type: 'chapter' as const, title: 'Second', children: [] }
      ],
      entryNodeId: 'first-node-id-00001',
      resumeNodeId: 'second-node-id-0001'
    }
    const readChapter = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        nodeId: 'second-node-id-0001',
        title: 'Second',
        markdown: '# Second',
        fragment: 'section-80',
        readingPosition: 0.6,
        hasReadingPosition: true
      }
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        books: {
          openLibrary: vi.fn().mockResolvedValue({ ok: true, value }),
          readChapter,
          saveReadingPosition: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              chapterProgress: 0,
              overallProgress: 0.5,
              updatedAt: new Date().toISOString()
            }
          })
        }
      }
    })
    const store = useBooksStore()
    await store.openLibrary(value.libraryId)
    expect(store.chapter).toMatchObject({ fragment: null, readingPosition: 0.6 })

    await store.openNode('second-node-id-0001', 'section-80')
    expect(store.chapter).toMatchObject({ fragment: 'section-80', readingPosition: 0 })
    expect(store.session?.readingProgress).toBe(0.5)
  })
})
