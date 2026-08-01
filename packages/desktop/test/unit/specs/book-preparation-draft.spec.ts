/* eslint-disable @stylistic/space-before-function-paren, @typescript-eslint/no-non-null-assertion */
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookPreparationManager,
  type BookPreparationBeginContext
} from '../../../src/main/book/preparationManager'
import { BookPreparationDraftStore } from '../../../src/main/book/preparationDraftStore'

const temporaryRoots: string[] = []

const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

const manuscript = '# First\n\nBody\n\n# Second\n\nBody\n\n# Third\n'

const prepareContext = async (
  rootPath: string,
  current = { value: true }
): Promise<BookPreparationBeginContext> => {
  const realPath = await fs.realpath(rootPath)
  const stat = await fs.stat(realPath, { bigint: true })
  const sourcePath = `${path.basename(rootPath)}.md`
  return {
    ownerId: 71,
    sessionId: 'draft-session-00000001',
    sessionGeneration: 4,
    rootPath,
    rootIdentity: { realPath, dev: stat.dev, ino: stat.ino },
    rootName: path.basename(rootPath),
    sources: [{ nodeId: 'draft-source-00000001', title: 'Manuscript', path: sourcePath }],
    isCurrent: () => current.value
  }
}

const begin = async (manager: BookPreparationManager, rootPath: string) => {
  const result = await manager.begin(await prepareContext(rootPath))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

const environment = async () => {
  const userData = await temporaryRoot('leafbook-draft-user-')
  const book = await temporaryRoot('leafbook-draft-book-')
  await fs.writeFile(path.join(book, `${path.basename(book)}.md`), manuscript)
  return { userData, book }
}

describe('BookPreparationDraftStore integration', () => {
  it('persists edits privately and requires explicit crash recovery', async () => {
    const { userData, book } = await environment()
    const firstStore = new BookPreparationDraftStore(userData)
    const firstManager = new BookPreparationManager({}, firstStore)
    const prepared = await begin(firstManager, book)
    const edited = await firstManager.applyDraft(
      {
        preparationId: prepared.preparationId,
        revision: prepared.revision!,
        nonce: 1,
        operation: { type: 'rename', chapterId: 'chapter-1', title: 'Opening' }
      },
      71
    )
    expect(edited).toMatchObject({ ok: true, value: { draftPersisted: true, draftNonce: 1 } })
    if (!edited.ok) throw new Error(edited.error.code)
    expect(firstManager.close(prepared.preparationId, 71)).toEqual({ ok: true, value: true })

    const directory = path.join(userData, 'leafbook-preparation-drafts')
    expect(Number((await fs.stat(directory)).mode) & 0o077).toBe(0)
    const entries = await fs.readdir(directory)
    const draftName = entries.find((entry) => entry.endsWith('.json'))
    expect(draftName).toMatch(/^[a-f0-9]{64}\.json$/)
    const draftPath = path.join(directory, draftName!)
    expect(Number((await fs.stat(draftPath)).mode) & 0o077).toBe(0)
    const stored = await fs.readFile(draftPath, 'utf8')
    expect(stored).not.toContain(book)
    expect(stored).not.toContain('Body')

    const restarted = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const rediscovered = await begin(restarted, book)
    expect(rediscovered.recovery).toMatchObject({ status: 'available', chapterCount: 3 })
    expect(rediscovered.chapters[0].title).toBe('First')
    const restored = await restarted.restoreDraft(
      {
        preparationId: rediscovered.preparationId,
        recoveryId: rediscovered.recovery!.recoveryId
      },
      71
    )
    expect(restored).toMatchObject({
      ok: true,
      value: { recovery: null, draftPersisted: true }
    })
    if (!restored.ok) throw new Error(restored.error.code)
    expect(restored.value.chapters[0].title).toBe('Opening')
  })

  it('supports ordered remove/add-back edits and rejects an out-of-order nonce', async () => {
    const { userData, book } = await environment()
    const manager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    let prepared = await begin(manager, book)
    const apply = async (
      nonce: number,
      operation: Parameters<typeof manager.applyDraft>[0]['operation']
    ) => {
      const result = await manager.applyDraft(
        {
          preparationId: prepared.preparationId,
          revision: prepared.revision!,
          nonce,
          operation
        },
        71
      )
      if (result.ok) prepared = result.value
      return result
    }
    expect(await apply(1, { type: 'move-down', chapterId: 'chapter-1' })).toMatchObject({
      ok: true
    })
    expect(prepared.chapters.map((chapter) => chapter.title)).toEqual(['Second', 'First', 'Third'])
    expect(await apply(2, { type: 'remove', chapterId: 'chapter-1' })).toMatchObject({ ok: true })
    expect(prepared.removedChapters.map((chapter) => chapter.title)).toEqual(['First'])
    expect(await apply(3, { type: 'restore', chapterId: 'chapter-1' })).toMatchObject({ ok: true })
    expect(prepared.chapters.at(-1)?.title).toBe('First')
    const stale = await manager.applyDraft(
      {
        preparationId: prepared.preparationId,
        revision: prepared.revision!,
        nonce: 2,
        operation: { type: 'rename', chapterId: 'chapter-1', title: 'Stale' }
      },
      71
    )
    expect(stale).toMatchObject({ ok: false, error: { code: 'preparation-not-found' } })
    for (const nonce of [prepared.draftNonce + 2, Number.MAX_SAFE_INTEGER]) {
      expect(
        await manager.applyDraft(
          {
            preparationId: prepared.preparationId,
            revision: prepared.revision!,
            nonce,
            operation: { type: 'rename', chapterId: 'chapter-1', title: 'Gap' }
          },
          71
        )
      ).toMatchObject({ ok: false, error: { code: 'preparation-not-found' } })
    }
  })

  it('binds restore and discard to the initially discovered file, draft id, and nonce', async () => {
    const { userData, book } = await environment()
    const writer = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const initial = await begin(writer, book)
    const firstSaved = await writer.applyDraft(
      {
        preparationId: initial.preparationId,
        revision: initial.revision!,
        nonce: 1,
        operation: { type: 'rename', chapterId: 'chapter-1', title: 'Version one' }
      },
      71
    )
    if (!firstSaved.ok) throw new Error(firstSaved.error.code)
    writer.close(initial.preparationId, 71)

    const paused = deferred()
    let entered = false
    const staleManager = new BookPreparationManager(
      {
        beforeDraftRead: () => {
          entered = true
          return paused.promise
        }
      },
      new BookPreparationDraftStore(userData)
    )
    const stale = await begin(staleManager, book)
    const newerManager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    let newer = await begin(newerManager, book)
    const restoringStale = staleManager.restoreDraft(
      { preparationId: stale.preparationId, recoveryId: stale.recovery!.recoveryId },
      71
    )
    await vi.waitFor(() => expect(entered).toBe(true))
    const restoredNewer = await newerManager.restoreDraft(
      { preparationId: newer.preparationId, recoveryId: newer.recovery!.recoveryId },
      71
    )
    if (!restoredNewer.ok) throw new Error(restoredNewer.error.code)
    newer = restoredNewer.value
    expect(
      await newerManager.applyDraft(
        {
          preparationId: newer.preparationId,
          revision: newer.revision!,
          nonce: 2,
          operation: { type: 'rename', chapterId: 'chapter-2', title: 'Version two' }
        },
        71
      )
    ).toMatchObject({ ok: true })
    paused.resolve()
    expect(await restoringStale).toMatchObject({
      ok: false,
      error: { code: 'preparation-draft-stale' }
    })
    expect(
      await staleManager.discardDraft(
        { preparationId: stale.preparationId, recoveryId: stale.recovery!.recoveryId },
        71
      )
    ).toMatchObject({ ok: false, error: { code: 'preparation-draft-stale' } })
    expect(new BookPreparationDraftStore(userData).read(await fs.realpath(book))).toMatchObject({
      status: 'valid',
      payload: { nonce: 2 }
    })
  })

  it('returns typed stale errors when restore/discard interleave with select or close', async () => {
    const { userData, book } = await environment()
    const writer = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const initial = await begin(writer, book)
    expect(
      await writer.applyDraft(
        {
          preparationId: initial.preparationId,
          revision: initial.revision!,
          nonce: 1,
          operation: { type: 'remove', chapterId: 'chapter-3' }
        },
        71
      )
    ).toMatchObject({ ok: true })
    writer.close(initial.preparationId, 71)

    const restorePause = deferred()
    let restoreEntered = false
    const restoreManager = new BookPreparationManager(
      {
        beforeDraftRead: () => {
          restoreEntered = true
          return restorePause.promise
        }
      },
      new BookPreparationDraftStore(userData)
    )
    const restoreDto = await begin(restoreManager, book)
    const restoring = restoreManager.restoreDraft(
      {
        preparationId: restoreDto.preparationId,
        recoveryId: restoreDto.recovery!.recoveryId
      },
      71
    )
    await vi.waitFor(() => expect(restoreEntered).toBe(true))
    await restoreManager.select(restoreDto.preparationId, restoreDto.sourceNodeId!, 71)
    restorePause.resolve()
    expect(await restoring).toMatchObject({
      ok: false,
      error: { code: 'preparation-draft-stale' }
    })

    const closeRestorePause = deferred()
    let closeRestoreEntered = false
    const closeRestoreManager = new BookPreparationManager(
      {
        beforeDraftRead: () => {
          closeRestoreEntered = true
          return closeRestorePause.promise
        }
      },
      new BookPreparationDraftStore(userData)
    )
    const closeRestoreDto = await begin(closeRestoreManager, book)
    const closeRestoring = closeRestoreManager.restoreDraft(
      {
        preparationId: closeRestoreDto.preparationId,
        recoveryId: closeRestoreDto.recovery!.recoveryId
      },
      71
    )
    await vi.waitFor(() => expect(closeRestoreEntered).toBe(true))
    closeRestoreManager.close(closeRestoreDto.preparationId, 71)
    closeRestorePause.resolve()
    expect(await closeRestoring).toMatchObject({
      ok: false,
      error: { code: 'preparation-draft-stale' }
    })

    const discardPause = deferred()
    let discardEntered = false
    const discardManager = new BookPreparationManager(
      {
        beforeDraftRead: () => {
          discardEntered = true
          return discardPause.promise
        }
      },
      new BookPreparationDraftStore(userData)
    )
    const discardDto = await begin(discardManager, book)
    const discarding = discardManager.discardDraft(
      {
        preparationId: discardDto.preparationId,
        recoveryId: discardDto.recovery!.recoveryId
      },
      71
    )
    await vi.waitFor(() => expect(discardEntered).toBe(true))
    discardManager.close(discardDto.preparationId, 71)
    discardPause.resolve()
    expect(await discarding).toMatchObject({
      ok: false,
      error: { code: 'preparation-draft-stale' }
    })

    const crossRestorePause = deferred()
    let crossRestoreEntered = false
    const crossRestoreManager = new BookPreparationManager(
      {
        beforeDraftRead: () => {
          crossRestoreEntered = true
          return crossRestorePause.promise
        }
      },
      new BookPreparationDraftStore(userData)
    )
    const crossRestoreDto = await begin(crossRestoreManager, book)
    const deletingManager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const deletingDto = await begin(deletingManager, book)
    const crossRestoring = crossRestoreManager.restoreDraft(
      {
        preparationId: crossRestoreDto.preparationId,
        recoveryId: crossRestoreDto.recovery!.recoveryId
      },
      71
    )
    await vi.waitFor(() => expect(crossRestoreEntered).toBe(true))
    expect(
      await deletingManager.discardDraft(
        {
          preparationId: deletingDto.preparationId,
          recoveryId: deletingDto.recovery!.recoveryId
        },
        71
      )
    ).toMatchObject({ ok: true })
    crossRestorePause.resolve()
    expect(await crossRestoring).toMatchObject({
      ok: false,
      error: { code: 'preparation-draft-stale' }
    })
  })

  it('marks source/root changes stale, never restores them, and allows exact discard', async () => {
    const { userData, book } = await environment()
    const manager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const prepared = await begin(manager, book)
    const saved = await manager.applyDraft(
      {
        preparationId: prepared.preparationId,
        revision: prepared.revision!,
        nonce: 1,
        operation: { type: 'remove', chapterId: 'chapter-3' }
      },
      71
    )
    expect(saved.ok).toBe(true)
    manager.close(prepared.preparationId, 71)
    await fs.writeFile(
      path.join(book, `${path.basename(book)}.md`),
      '# Changed\n\n# Second\n\n# Third\n'
    )
    const restarted = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const stale = await begin(restarted, book)
    expect(stale.recovery?.status).toBe('stale')
    expect(
      await restarted.restoreDraft(
        { preparationId: stale.preparationId, recoveryId: stale.recovery!.recoveryId },
        71
      )
    ).toMatchObject({ ok: false, error: { code: 'preparation-draft-stale' } })
    expect(
      await restarted.discardDraft(
        { preparationId: stale.preparationId, recoveryId: stale.recovery!.recoveryId },
        71
      )
    ).toMatchObject({ ok: true, value: { recovery: null } })
    expect(new BookPreparationDraftStore(userData).read(await fs.realpath(book))).toEqual({
      status: 'none'
    })
  })

  it('exposes corrupt/old-schema drafts only for safe discard and cleans only known temps', async () => {
    const { userData, book } = await environment()
    const store = new BookPreparationDraftStore(userData)
    const directory = path.join(userData, 'leafbook-preparation-drafts')
    const rootHmac = store.rootHmac(await fs.realpath(book))
    const draftPath = path.join(directory, `${rootHmac}.json`)
    await fs.writeFile(draftPath, '{"schemaVersion":0', { mode: 0o600 })
    const knownTemp = path.join(directory, `.${rootHmac}.00000000-0000-4000-8000-000000000000.tmp`)
    const unknownTemp = path.join(directory, '.unowned.tmp')
    await fs.writeFile(knownTemp, 'known', { mode: 0o600 })
    await fs.writeFile(unknownTemp, 'unknown', { mode: 0o600 })
    const cleanupStore = new BookPreparationDraftStore(userData)
    expect(cleanupStore.rootHmac(await fs.realpath(book))).toBe(rootHmac)
    await expect(fs.lstat(knownTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(unknownTemp, 'utf8')).resolves.toBe('unknown')

    const manager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const prepared = await begin(manager, book)
    expect(prepared.recovery?.status).toBe('invalid')
    expect(
      await manager.restoreDraft(
        { preparationId: prepared.preparationId, recoveryId: prepared.recovery!.recoveryId },
        71
      )
    ).toMatchObject({ ok: false, error: { code: 'preparation-draft-stale' } })
    expect(
      await manager.discardDraft(
        { preparationId: prepared.preparationId, recoveryId: prepared.recovery!.recoveryId },
        71
      )
    ).toMatchObject({ ok: true })
  })

  it('deletes the exact draft only after a verified durable SUMMARY commit', async () => {
    const { userData, book } = await environment()
    const store = new BookPreparationDraftStore(userData)
    const manager = new BookPreparationManager({}, store)
    const prepared = await begin(manager, book)
    const edited = await manager.applyDraft(
      {
        preparationId: prepared.preparationId,
        revision: prepared.revision!,
        nonce: 1,
        operation: { type: 'rename', chapterId: 'chapter-2', title: 'Middle' }
      },
      71
    )
    if (!edited.ok) throw new Error(edited.error.code)
    expect(
      await manager.commit(edited.value.preparationId, edited.value.revision!, 71)
    ).toMatchObject({ ok: true, value: { committed: true, durabilityUncertain: false } })
    expect(store.read(await fs.realpath(book))).toEqual({ status: 'none' })
    expect(await fs.readFile(path.join(book, 'SUMMARY.md'), 'utf8')).toContain('[Middle]')
  })

  it('keeps drafts isolated by HMAC root identity across books', async () => {
    const userData = await temporaryRoot('leafbook-draft-user-')
    const firstBook = await temporaryRoot('leafbook-draft-book-a-')
    const secondBook = await temporaryRoot('leafbook-draft-book-b-')
    for (const book of [firstBook, secondBook]) {
      await fs.writeFile(path.join(book, `${path.basename(book)}.md`), manuscript)
    }
    const store = new BookPreparationDraftStore(userData)
    const manager = new BookPreparationManager({}, store)
    const first = await begin(manager, firstBook)
    expect(
      await manager.applyDraft(
        {
          preparationId: first.preparationId,
          revision: first.revision!,
          nonce: 1,
          operation: { type: 'remove', chapterId: 'chapter-3' }
        },
        71
      )
    ).toMatchObject({ ok: true })
    const second = await begin(manager, secondBook)
    expect(second.recovery).toBeNull()
    expect(store.rootHmac(await fs.realpath(firstBook))).not.toBe(
      store.rootHmac(await fs.realpath(secondBook))
    )
    expect(
      fsSync.readFileSync(path.join(userData, 'leafbook-preparation-drafts', '.root-hmac-key'))
    ).toHaveLength(32)
  })

  it('uses persisted nonce latest-wins across concurrent preparation owners', async () => {
    const { userData, book } = await environment()
    const first = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    let firstDto = await begin(first, book)
    const firstSaved = await first.applyDraft(
      {
        preparationId: firstDto.preparationId,
        revision: firstDto.revision!,
        nonce: 1,
        operation: { type: 'remove', chapterId: 'chapter-3' }
      },
      71
    )
    if (!firstSaved.ok) throw new Error(firstSaved.error.code)
    firstDto = firstSaved.value

    const second = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    let secondDto = await begin(second, book)
    const restored = await second.restoreDraft(
      {
        preparationId: secondDto.preparationId,
        recoveryId: secondDto.recovery!.recoveryId
      },
      71
    )
    if (!restored.ok) throw new Error(restored.error.code)
    secondDto = restored.value

    const newer = await first.applyDraft(
      {
        preparationId: firstDto.preparationId,
        revision: firstDto.revision!,
        nonce: 2,
        operation: { type: 'rename', chapterId: 'chapter-1', title: 'Newest' }
      },
      71
    )
    expect(newer).toMatchObject({ ok: true })
    const late = await second.applyDraft(
      {
        preparationId: secondDto.preparationId,
        revision: secondDto.revision!,
        nonce: 2,
        operation: { type: 'rename', chapterId: 'chapter-2', title: 'Late' }
      },
      71
    )
    expect(late).toMatchObject({
      ok: false,
      error: { code: 'preparation-draft-write-failed' }
    })

    first.close(firstDto.preparationId, 71)
    second.close(secondDto.preparationId, 71)
    const restarted = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const discovered = await begin(restarted, book)
    const finalRestore = await restarted.restoreDraft(
      {
        preparationId: discovered.preparationId,
        recoveryId: discovered.recovery!.recoveryId
      },
      71
    )
    if (!finalRestore.ok) throw new Error(finalRestore.error.code)
    expect(finalRestore.value.chapters.map((chapter) => chapter.title)).toEqual([
      'Newest',
      'Second'
    ])
  })

  it('treats a same-path replacement root as stale', async () => {
    const { userData, book } = await environment()
    const manager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const prepared = await begin(manager, book)
    expect(
      await manager.applyDraft(
        {
          preparationId: prepared.preparationId,
          revision: prepared.revision!,
          nonce: 1,
          operation: { type: 'remove', chapterId: 'chapter-3' }
        },
        71
      )
    ).toMatchObject({ ok: true })
    manager.close(prepared.preparationId, 71)
    const moved = `${book}-moved`
    await fs.rename(book, moved)
    temporaryRoots.push(moved)
    await fs.mkdir(book)
    await fs.writeFile(path.join(book, `${path.basename(book)}.md`), manuscript)
    const restarted = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
    const discovered = await begin(restarted, book)
    expect(discovered.recovery?.status).toBe('stale')
  })

  it.each(['old-schema', 'oversize', 'public-mode', 'symlink', 'hardlink'] as const)(
    'fails closed for an anomalous %s draft and safely discards only its entry',
    async (kind) => {
      const { userData, book } = await environment()
      const store = new BookPreparationDraftStore(userData)
      const directory = path.join(userData, 'leafbook-preparation-drafts')
      const rootHmac = store.rootHmac(await fs.realpath(book))
      const draftPath = path.join(directory, `${rootHmac}.json`)
      const external = path.join(userData, `external-${kind}`)
      await fs.writeFile(external, 'external-preserved', { mode: 0o600 })
      if (kind === 'old-schema') {
        await fs.writeFile(draftPath, '{"schemaVersion":0,"payload":{}}', { mode: 0o600 })
      } else if (kind === 'oversize') {
        await fs.writeFile(draftPath, Buffer.alloc(2 * 1024 * 1024 + 1), { mode: 0o600 })
      } else if (kind === 'public-mode') {
        await fs.writeFile(draftPath, '{}', { mode: 0o644 })
        await fs.chmod(draftPath, 0o644)
      } else if (kind === 'symlink') {
        await fs.symlink(external, draftPath)
      } else {
        await fs.link(external, draftPath)
      }
      const manager = new BookPreparationManager({}, new BookPreparationDraftStore(userData))
      const discovered = await begin(manager, book)
      expect(discovered.recovery?.status).toBe('invalid')
      expect(
        await manager.discardDraft(
          {
            preparationId: discovered.preparationId,
            recoveryId: discovered.recovery!.recoveryId
          },
          71
        )
      ).toMatchObject({ ok: true })
      await expect(fs.lstat(draftPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.readFile(external, 'utf8')).resolves.toBe('external-preserved')
    }
  )

  it('retains the draft when final directory durability is uncertain', async () => {
    const { userData, book } = await environment()
    const store = new BookPreparationDraftStore(userData)
    const manager = new BookPreparationManager({ forceDirectorySyncFailure: true }, store)
    const prepared = await begin(manager, book)
    const edited = await manager.applyDraft(
      {
        preparationId: prepared.preparationId,
        revision: prepared.revision!,
        nonce: 1,
        operation: { type: 'remove', chapterId: 'chapter-3' }
      },
      71
    )
    if (!edited.ok) throw new Error(edited.error.code)
    expect(
      await manager.commit(edited.value.preparationId, edited.value.revision!, 71)
    ).toMatchObject({ ok: true, value: { durabilityUncertain: true } })
    expect(store.read(await fs.realpath(book))).toMatchObject({
      status: 'valid',
      payload: { draftId: edited.value.draftId }
    })
  })
})
