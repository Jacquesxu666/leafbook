/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BookArrangementManager,
  type BookArrangementManagerTestHooks
} from 'main_renderer/book/arrangementManager'

const roots: string[] = []

const deferred = (): { promise: Promise<void>; resolve(): void } => {
  let complete!: () => void
  const promise = new Promise<void>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: () => complete() }
}

const fixture = async (
  summary = '- A\n- B\n',
  hooks: BookArrangementManagerTestHooks = {}
): Promise<{
  root: string
  manager: BookArrangementManager
  context: Parameters<BookArrangementManager['begin']>[0]
}> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-arrangement-'))
  roots.push(root)
  await fs.writeFile(path.join(root, 'SUMMARY.md'), summary)
  const realPath = await fs.realpath(root)
  const stat = await fs.stat(realPath, { bigint: true })
  const current = true
  return {
    root,
    manager: new BookArrangementManager(hooks),
    context: {
      ownerId: 7,
      sessionId: 'session-0000000000000001',
      sessionGeneration: 3,
      rootPath: realPath,
      rootIdentity: { realPath, dev: stat.dev, ino: stat.ino },
      summaryPath: 'SUMMARY.md',
      isCurrent: () => current
    }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('book arrangement manager', () => {
  it('keeps paths and raw bytes private while applying, undoing, and atomically saving a draft', async () => {
    const { root, manager, context } = await fixture('\uFEFF<!-- A -->\r\n- A\r\n- B\n')
    const begun = await manager.begin(context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(JSON.stringify(begun.value)).not.toContain(root)
    expect(JSON.stringify(begun.value)).not.toContain('SUMMARY.md')

    const [a, b] = begun.value.nodes
    const moved = manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    expect(moved).toMatchObject({ ok: true, value: { dirty: true, canUndo: true } })
    const undone = manager.undo(begun.value.arrangementId, 7)
    expect(undone).toMatchObject({ ok: true, value: { dirty: false, canUndo: false } })

    const movedAgain = manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    expect(movedAgain.ok).toBe(true)
    const saved = await manager.save(
      { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
      7
    )
    expect(saved).toMatchObject({
      ok: true,
      value: { session: null, durabilityUncertain: false }
    })
    expect(await fs.readFile(path.join(root, 'SUMMARY.md'), 'utf8')).toBe(
      '\uFEFF- B\n<!-- A -->\r\n- A\r\n'
    )
  })

  it('restores stable opaque node IDs from a non-initial multi-step undo snapshot', async () => {
    const { manager, context } = await fixture('- A\n- B\n- C\n')
    const begun = await manager.begin(context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b, c] = begun.value.nodes

    const firstMove = manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-after', nodeId: a.nodeId, targetNodeId: c.nodeId }
      },
      7
    )
    expect(firstMove.ok).toBe(true)
    if (!firstMove.ok) return
    expect(firstMove.value.nodes.map((node) => [node.title, node.nodeId])).toEqual([
      ['B', b.nodeId],
      ['C', c.nodeId],
      ['A', a.nodeId]
    ])

    expect(
      manager.apply(
        {
          arrangementId: begun.value.arrangementId,
          operation: { type: 'move-after', nodeId: b.nodeId, targetNodeId: a.nodeId }
        },
        7
      )
    ).toMatchObject({ ok: true })

    const undone = manager.undo(begun.value.arrangementId, 7)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.value.nodes.map((node) => [node.title, node.nodeId])).toEqual([
      ['B', b.nodeId],
      ['C', c.nodeId],
      ['A', a.nodeId]
    ])
    expect(
      manager.apply(
        {
          arrangementId: begun.value.arrangementId,
          operation: { type: 'move-before', nodeId: a.nodeId, targetNodeId: b.nodeId }
        },
        7
      )
    ).toMatchObject({
      ok: true,
      value: {
        nodes: [
          { title: 'A', nodeId: a.nodeId },
          { title: 'B', nodeId: b.nodeId },
          { title: 'C', nodeId: c.nodeId }
        ]
      }
    })
  })

  it('issues a one-use overwrite token bound to external and candidate revisions', async () => {
    let targetPath = ''
    let raceArmed = false
    const { root, manager, context } = await fixture('- A\n- B\n', {
      afterTempSync: async () => {
        if (!raceArmed) return
        raceArmed = false
        await fs.writeFile(targetPath, '- Race\n')
      }
    })
    targetPath = path.join(root, 'SUMMARY.md')
    const begun = await manager.begin(context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    const moved = manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    expect(moved.ok).toBe(true)
    await fs.writeFile(targetPath, '- External\n')

    const conflict = await manager.save(
      { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
      7
    )
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'arrangement-conflict', overwriteToken: expect.any(String) }
    })
    if (conflict.ok || !conflict.error.overwriteToken) return

    raceArmed = true
    expect(
      await manager.save(
        {
          arrangementId: begun.value.arrangementId,
          revision: begun.value.revision,
          overwriteToken: conflict.error.overwriteToken
        },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-write-failed' } })

    // Restore the exact external revision. Base and candidate also remain
    // unchanged because the first authorized write lost its pre-commit race.
    await fs.writeFile(targetPath, '- External\n')
    const replay = await manager.save(
      {
        arrangementId: begun.value.arrangementId,
        revision: begun.value.revision,
        overwriteToken: conflict.error.overwriteToken
      },
      7
    )
    expect(replay).toMatchObject({
      ok: false,
      error: { code: 'arrangement-conflict', overwriteToken: expect.any(String) }
    })
    if (replay.ok) return
    expect(replay.error.overwriteToken).not.toBe(conflict.error.overwriteToken)
  })

  it('rejects missing, invalid UTF-8, stale, and cross-owner leases', async () => {
    const missing = await fixture()
    await fs.unlink(path.join(missing.root, 'SUMMARY.md'))
    expect(await missing.manager.begin(missing.context)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-read-only' }
    })

    const invalid = await fixture()
    await fs.writeFile(path.join(invalid.root, 'SUMMARY.md'), Buffer.from([0xc3, 0x28]))
    expect(await invalid.manager.begin(invalid.context)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-encoding' }
    })

    const stale = await fixture()
    const begun = await stale.manager.begin(stale.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(stale.manager.undo(begun.value.arrangementId, 8)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
    stale.manager.cleanupOwner(7)
    expect(stale.manager.undo(begun.value.arrangementId, 7)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked SUMMARY and readonly target or parent',
    async () => {
      const symlinked = await fixture()
      await fs.rename(path.join(symlinked.root, 'SUMMARY.md'), path.join(symlinked.root, 'real.md'))
      await fs.symlink('real.md', path.join(symlinked.root, 'SUMMARY.md'))
      expect(await symlinked.manager.begin(symlinked.context)).toMatchObject({
        ok: false,
        error: { code: 'arrangement-read-only' }
      })

      const readonlyTarget = await fixture()
      await fs.chmod(path.join(readonlyTarget.root, 'SUMMARY.md'), 0o444)
      expect(await readonlyTarget.manager.begin(readonlyTarget.context)).toMatchObject({
        ok: false,
        error: { code: 'arrangement-read-only' }
      })
      await fs.chmod(path.join(readonlyTarget.root, 'SUMMARY.md'), 0o644)

      const readonlyParent = await fixture()
      await fs.chmod(readonlyParent.root, 0o555)
      expect(await readonlyParent.manager.begin(readonlyParent.context)).toMatchObject({
        ok: false,
        error: { code: 'arrangement-read-only' }
      })
      await fs.chmod(readonlyParent.root, 0o755)
    }
  )

  it('rejects an oversized SUMMARY before parsing', async () => {
    const oversized = await fixture('x'.repeat(2 * 1024 * 1024 + 1))
    expect(await oversized.manager.begin(oversized.context)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-too-large' }
    })
  })

  it('rejects a target inode replacement after begin without overwriting the replacement', async () => {
    const test = await fixture()
    const begun = await test.manager.begin(test.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    test.manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    await fs.rename(path.join(test.root, 'SUMMARY.md'), path.join(test.root, 'SUMMARY.original.md'))
    await fs.writeFile(path.join(test.root, 'SUMMARY.md'), '- Replacement\n')
    expect(
      await test.manager.save(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-read-only' } })
    expect(await fs.readFile(path.join(test.root, 'SUMMARY.md'), 'utf8')).toBe('- Replacement\n')
  })

  it('rejects a root inode replacement without writing into the replacement root', async () => {
    const test = await fixture()
    const begun = await test.manager.begin(test.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    test.manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    const displaced = `${test.root}-displaced`
    roots.push(displaced)
    await fs.rename(test.root, displaced)
    await fs.mkdir(test.root)
    await fs.writeFile(path.join(test.root, 'SUMMARY.md'), '- Replacement root\n')
    expect(
      await test.manager.save(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-read-only' } })
    expect(await fs.readFile(path.join(test.root, 'SUMMARY.md'), 'utf8')).toBe(
      '- Replacement root\n'
    )
  })

  it('rejects a concurrent save and a revoke before the commit boundary without changing SUMMARY', async () => {
    const reached = deferred()
    const release = deferred()
    const { root, manager, context } = await fixture('- A\n- B\n', {
      afterTempSync: async () => {
        reached.resolve()
        await release.promise
      }
    })
    const begun = await manager.begin(context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    expect(
      manager.apply(
        {
          arrangementId: begun.value.arrangementId,
          operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
        },
        7
      )
    ).toMatchObject({ ok: true })
    const saving = manager.save(
      { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
      7
    )
    await reached.promise
    expect(
      await manager.save(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-conflict' } })
    manager.cleanupOwner(7)
    release.resolve()
    expect(await saving).toMatchObject({
      ok: false,
      error: { code: 'arrangement-write-failed' }
    })
    expect(await fs.readFile(path.join(root, 'SUMMARY.md'), 'utf8')).toBe('- A\n- B\n')
    expect(
      (await fs.readdir(root)).filter((name) => name.startsWith('.leafbook-summary-'))
    ).toEqual([])
  })

  it('defers a critical revoke through rename and reports committed verification uncertainty', async () => {
    // Assigned after the fixture installs a callback that closes over it.
    // eslint-disable-next-line prefer-const
    let manager!: BookArrangementManager
    let arrangementId = ''
    const test = await fixture('- A\n- B\n', {
      forceCommittedVerificationFailure: true,
      commitCriticalStarted: () => {
        expect(manager.close(arrangementId, 7)).toEqual({ ok: true, value: true })
      }
    })
    manager = test.manager
    const begun = await manager.begin(test.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    arrangementId = begun.value.arrangementId
    const [a, b] = begun.value.nodes
    expect(
      manager.apply(
        {
          arrangementId,
          operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
        },
        7
      )
    ).toMatchObject({ ok: true })
    expect(await manager.save({ arrangementId, revision: begun.value.revision }, 7)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-commit-uncertain', committed: true }
    })
    expect(await fs.readFile(path.join(test.root, 'SUMMARY.md'), 'utf8')).toBe('- B\n- A\n')
    expect(manager.undo(arrangementId, 7)).toMatchObject({
      ok: false,
      error: { code: 'arrangement-not-found' }
    })
  })

  it('reports verified bytes as saved when only directory durability is uncertain', async () => {
    const { manager, context } = await fixture('- A\n- B\n', {
      forceDirectorySyncFailure: true
    })
    const begun = await manager.begin(context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    expect(
      await manager.save(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        7
      )
    ).toMatchObject({
      ok: true,
      value: { durabilityUncertain: true }
    })
  })

  it('caps active leases per owner and globally', async () => {
    const test = await fixture()
    for (let index = 0; index < 4; index++) {
      expect(
        await test.manager.begin({
          ...test.context,
          sessionId: `session-owner-7-${index}`
        })
      ).toMatchObject({ ok: true })
    }
    expect(
      await test.manager.begin({ ...test.context, sessionId: 'session-owner-7-overflow' })
    ).toMatchObject({ ok: false, error: { code: 'arrangement-conflict' } })

    for (let ownerId = 8; ownerId < 15; ownerId++) {
      for (let index = 0; index < 4; index++) {
        expect(
          await test.manager.begin({
            ...test.context,
            ownerId,
            sessionId: `session-owner-${ownerId}-${index}`
          })
        ).toMatchObject({ ok: true })
      }
    }
    expect(
      await test.manager.begin({
        ...test.context,
        ownerId: 15,
        sessionId: 'session-global-overflow'
      })
    ).toMatchObject({ ok: false, error: { code: 'arrangement-conflict' } })
  })

  it('reserves owner lease capacity before asynchronous begin checks', async () => {
    const test = await fixture()
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        test.manager.begin({
          ...test.context,
          sessionId: `concurrent-session-${index}`
        })
      )
    )
    expect(results.filter((result) => result.ok)).toHaveLength(4)
    expect(
      results.filter((result) => !result.ok && result.error.code === 'arrangement-conflict')
    ).toHaveLength(16)
  })

  it('bounds retained documents, pending reservations, and releases budget on cleanup', async () => {
    const pending = await fixture('- A\n', {
      pendingDocumentWeight: 300,
      maxOwnerRetainedWeight: 500,
      maxGlobalRetainedWeight: 2_000
    })
    const pendingResults = await Promise.all([
      pending.manager.begin({ ...pending.context, sessionId: 'pending-one' }),
      pending.manager.begin({ ...pending.context, sessionId: 'pending-two' })
    ])
    expect(pendingResults.filter((result) => result.ok)).toHaveLength(1)

    const weighted = await fixture('- A\n', {
      pendingDocumentWeight: 1,
      maxOwnerRetainedWeight: 500,
      maxGlobalRetainedWeight: 2_000
    })
    expect(
      await weighted.manager.begin({ ...weighted.context, sessionId: 'weighted-one' })
    ).toMatchObject({
      ok: true
    })
    expect(
      await weighted.manager.begin({ ...weighted.context, sessionId: 'weighted-two' })
    ).toMatchObject({
      ok: false,
      error: { code: 'arrangement-too-large' }
    })
    weighted.manager.cleanupOwner(7)
    expect(
      await weighted.manager.begin({ ...weighted.context, sessionId: 'weighted-after-cleanup' })
    ).toMatchObject({
      ok: true
    })
  })

  it('keeps other pending reservations while converting one begin to active weight', async () => {
    const firstActivation = deferred()
    const releaseFirst = deferred()
    const test = await fixture('- A\n', {
      pendingDocumentWeight: 1,
      maxOwnerRetainedWeight: 10_000,
      maxGlobalRetainedWeight: 324,
      beforeActivate: async (ownerId) => {
        if (ownerId !== 7) return
        firstActivation.resolve()
        await releaseFirst.promise
      }
    })
    const first = test.manager.begin({
      ...test.context,
      ownerId: 7,
      sessionId: 'pending-activation-first'
    })
    await firstActivation.promise
    const second = await test.manager.begin({
      ...test.context,
      ownerId: 8,
      sessionId: 'pending-activation-second'
    })
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'arrangement-too-large' }
    })
    releaseFirst.resolve()
    expect(await first).toMatchObject({ ok: true })
  })

  it('charges history to owner and global retained budgets across leases', async () => {
    const ownerBound = await fixture('- A\n- B\n', {
      pendingDocumentWeight: 1,
      maxOwnerRetainedWeight: 1_311,
      maxGlobalRetainedWeight: 10_000
    })
    const ownerFirst = await ownerBound.manager.begin({
      ...ownerBound.context,
      sessionId: 'owner-history-first'
    })
    const ownerSecond = await ownerBound.manager.begin({
      ...ownerBound.context,
      sessionId: 'owner-history-second'
    })
    expect(ownerFirst.ok && ownerSecond.ok).toBe(true)
    if (!ownerFirst.ok || !ownerSecond.ok) return
    const [ownerA, ownerB] = ownerFirst.value.nodes
    expect(
      ownerBound.manager.apply(
        {
          arrangementId: ownerFirst.value.arrangementId,
          operation: {
            type: 'move-before',
            nodeId: ownerB.nodeId,
            targetNodeId: ownerA.nodeId
          }
        },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-too-large' } })
    expect(ownerBound.manager.close(ownerSecond.value.arrangementId, 7)).toMatchObject({ ok: true })
    expect(
      ownerBound.manager.apply(
        {
          arrangementId: ownerFirst.value.arrangementId,
          operation: {
            type: 'move-before',
            nodeId: ownerB.nodeId,
            targetNodeId: ownerA.nodeId
          }
        },
        7
      )
    ).toMatchObject({ ok: true })

    const globalBound = await fixture('- A\n- B\n', {
      pendingDocumentWeight: 1,
      maxOwnerRetainedWeight: 10_000,
      maxGlobalRetainedWeight: 1_311
    })
    const globalFirst = await globalBound.manager.begin({
      ...globalBound.context,
      ownerId: 7,
      sessionId: 'global-history-first'
    })
    const globalSecond = await globalBound.manager.begin({
      ...globalBound.context,
      ownerId: 8,
      sessionId: 'global-history-second'
    })
    expect(globalFirst.ok && globalSecond.ok).toBe(true)
    if (!globalFirst.ok || !globalSecond.ok) return
    const [globalA, globalB] = globalFirst.value.nodes
    expect(
      globalBound.manager.apply(
        {
          arrangementId: globalFirst.value.arrangementId,
          operation: {
            type: 'move-before',
            nodeId: globalB.nodeId,
            targetNodeId: globalA.nodeId
          }
        },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-too-large' } })
    expect(globalBound.manager.close(globalSecond.value.arrangementId, 8)).toMatchObject({
      ok: true
    })
    expect(
      globalBound.manager.apply(
        {
          arrangementId: globalFirst.value.arrangementId,
          operation: {
            type: 'move-before',
            nodeId: globalB.nodeId,
            targetNodeId: globalA.nodeId
          }
        },
        7
      )
    ).toMatchObject({ ok: true })
  })

  it('stores bounded undo history as bytes plus stable line identity metadata', async () => {
    const test = await fixture()
    const begun = await test.manager.begin(test.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    test.manager.apply(
      {
        arrangementId: begun.value.arrangementId,
        operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
      },
      7
    )
    const internal = test.manager as unknown as {
      leases: Map<
        string,
        {
          history: Array<{ bytes: unknown; lineIds: Uint32Array; weight: number }>
          historyBytes: number
        }
      >
    }
    const lease = internal.leases.get(begun.value.arrangementId)
    expect(lease).toBeDefined()
    if (!lease) return
    expect(lease.history).toHaveLength(1)
    expect(Buffer.isBuffer(lease.history[0].bytes)).toBe(true)
    expect([...lease.history[0].lineIds]).toEqual([1, 2])
    expect(lease.historyBytes).toBe(
      Buffer.byteLength('- A\n- B\n') + 2 * Uint32Array.BYTES_PER_ELEMENT
    )
    expect(test.manager.undo(begun.value.arrangementId, 7)).toMatchObject({
      ok: true,
      value: { dirty: false }
    })
  })

  it('rejects undo history byte overflow and does not refund lifetime operations on undo', async () => {
    const historyLimited = await fixture('- A\n- B\n', { maxHistoryBytes: 16 })
    const begun = await historyLimited.manager.begin(historyLimited.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const [a, b] = begun.value.nodes
    expect(
      historyLimited.manager.apply(
        {
          arrangementId: begun.value.arrangementId,
          operation: { type: 'move-before', nodeId: b.nodeId, targetNodeId: a.nodeId }
        },
        7
      )
    ).toMatchObject({ ok: true })
    expect(
      historyLimited.manager.apply(
        {
          arrangementId: begun.value.arrangementId,
          operation: { type: 'move-after', nodeId: b.nodeId, targetNodeId: a.nodeId }
        },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-too-large' } })

    const operationsLimited = await fixture('- A\n- B\n', { maxLifetimeOperations: 2 })
    const started = await operationsLimited.manager.begin(operationsLimited.context)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const [first, second] = started.value.nodes
    for (let index = 0; index < 2; index++) {
      expect(
        operationsLimited.manager.apply(
          {
            arrangementId: started.value.arrangementId,
            operation: {
              type: 'move-before',
              nodeId: index === 0 ? second.nodeId : first.nodeId,
              targetNodeId: index === 0 ? first.nodeId : second.nodeId
            }
          },
          7
        )
      ).toMatchObject({ ok: true })
      expect(operationsLimited.manager.undo(started.value.arrangementId, 7)).toMatchObject({
        ok: true
      })
    }
    expect(
      operationsLimited.manager.apply(
        {
          arrangementId: started.value.arrangementId,
          operation: {
            type: 'move-before',
            nodeId: second.nodeId,
            targetNodeId: first.nodeId
          }
        },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-conflict' } })
  })

  it('defensively refuses a non-editable candidate at save time', async () => {
    const test = await fixture()
    const begun = await test.manager.begin(test.context)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const internal = test.manager as unknown as {
      leases: Map<string, { document: { editable: boolean } }>
    }
    const lease = internal.leases.get(begun.value.arrangementId)
    expect(lease).toBeDefined()
    if (!lease) return
    lease.document = { ...lease.document, editable: false }
    expect(
      await test.manager.save(
        { arrangementId: begun.value.arrangementId, revision: begun.value.revision },
        7
      )
    ).toMatchObject({ ok: false, error: { code: 'arrangement-read-only' } })
  })
})
