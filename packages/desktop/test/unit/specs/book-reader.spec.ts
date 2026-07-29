/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
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
  openedExternal: vi.fn(),
  browserWindow: null as Record<string, unknown> | null,
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
    })
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      mocks.ipcHandlers.set(channel, handler)
  },
  shell: { openExternal: mocks.openedExternal }
}))

import { BookSessionManager } from 'main_renderer/book/sessionManager'
import { loadBookFromDirectory, safelyReadBookChapter } from 'main_renderer/book/filesystem'
import { isTrustedEditorSender, registerBookHandlers } from 'main_renderer/ipc/books'

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

beforeEach(() => {
  mocks.stores.clear()
  mocks.selectedPath = ''
  mocks.openedExternal.mockReset()
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

describe('book IPC trust boundary', () => {
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
      expect.arrayContaining(['lb::books::list', 'lb::books::search', 'lb::books::cancel-search'])
    )
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
