/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import fsSync from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BookPreparationManager,
  type BookPreparationBeginContext,
  type BookPreparationManagerHooks
} from '../../../src/main/book/preparationManager'

const roots: string[] = []
const mkfifoPath =
  process.platform === 'win32'
    ? null
    : (['/usr/bin/mkfifo', '/bin/mkfifo'].find((candidate) => fsSync.existsSync(candidate)) ?? null)

const createFifo = (targetPath: string): void => {
  if (!mkfifoPath) throw new Error('mkfifo is unavailable')
  execFileSync(mkfifoPath, [targetPath])
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

const root = async (): Promise<string> => {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-preparation-'))
  roots.push(value)
  return value
}

const context = async (
  rootPath: string,
  sources: Array<{ nodeId: string; title: string; path: string }>,
  current = { value: true }
): Promise<BookPreparationBeginContext> => {
  const realPath = await fs.realpath(rootPath)
  const stat = await fs.stat(realPath, { bigint: true })
  return {
    ownerId: 41,
    sessionId: 'session-id-0000000000001',
    sessionGeneration: 1,
    rootPath,
    rootIdentity: { realPath, dev: stat.dev, ino: stat.ino },
    rootName: path.basename(rootPath),
    sources,
    isCurrent: () => current.value
  }
}

const manuscript = '# First **chapter**\n\nText\n\n# 第二章\n\nMore\n'

const deferred = () => {
  let resolveGate!: () => void
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve
  })
  return { promise, resolve: resolveGate }
}

const auto = async (manager: BookPreparationManager, rootPath: string, markdown = manuscript) => {
  const filename = `${path.basename(rootPath)}.md`
  await fs.writeFile(path.join(rootPath, filename), markdown)
  const begun = await manager.begin(
    await context(rootPath, [
      { nodeId: 'source-node-00000001', title: 'Manuscript', path: filename }
    ])
  )
  expect(begun.ok).toBe(true)
  if (!begun.ok) throw new Error(begun.error.code)
  return begun.value
}

describe('BookPreparationManager', () => {
  it('keeps safe source flags mandatory in every platform build without a zero fallback', async () => {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../src/main/book/preparationManager.ts'
    )
    const source = await fs.readFile(sourcePath, 'utf8')
    expect(source).toContain(
      'return fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK'
    )
    expect(source).toContain('return readFlags | fsConstants.O_DIRECTORY')
    expect(source).not.toMatch(/O_(?:NOFOLLOW|NONBLOCK)\s*\?\?\s*0/)
    expect(source).not.toContain('readFileSync(')
    expect(source).toContain('const READ_CHUNK_BYTES = 64 * 1024')
  })

  it('auto-selects only the basename-stem source and exposes no path or raw Markdown', async () => {
    const rootPath = await root()
    const prepared = await auto(new BookPreparationManager(), rootPath)
    expect(prepared.requiresSelection).toBe(false)
    expect(
      prepared.chapters.map(({ ordinal, line, title, fragment }) => ({
        ordinal,
        line,
        title,
        fragment
      }))
    ).toEqual([
      { ordinal: 1, line: 1, title: 'First chapter', fragment: 'first-chapter' },
      { ordinal: 2, line: 5, title: '第二章', fragment: '第二章' }
    ])
    const serialized = JSON.stringify(prepared)
    expect(serialized).not.toContain(rootPath)
    expect(serialized).not.toContain(`${path.basename(rootPath)}.md`)
    expect(serialized).not.toContain('Text')
  })

  it('releases every failed automatic lease without consuming the owner cap', async () => {
    const manager = new BookPreparationManager()
    const failures: Array<{ bytes: Buffer | string; code: string }> = [
      { bytes: '# Only one\n', code: 'preparation-invalid-headings' },
      { bytes: Buffer.from([0xff, 0xfe]), code: 'preparation-invalid-headings' },
      { bytes: '# Same\n# same!!!\n', code: 'preparation-invalid-headings' },
      { bytes: '# One\n# Two\n', code: 'preparation-source-changed' }
    ]

    for (const [index, failure] of failures.entries()) {
      const rootPath = await root()
      const filename = `${path.basename(rootPath)}.md`
      if (index !== failures.length - 1) {
        await fs.writeFile(path.join(rootPath, filename), failure.bytes)
      }
      expect(
        await manager.begin(
          await context(rootPath, [
            {
              nodeId: `failed-source-node-${index}`.padEnd(24, '0'),
              title: 'Failed',
              path: filename
            }
          ])
        )
      ).toMatchObject({ ok: false, error: { code: failure.code } })
    }

    const validRoot = await root()
    const validFilename = `${path.basename(validRoot)}.md`
    await fs.writeFile(path.join(validRoot, validFilename), manuscript)
    const valid = await manager.begin(
      await context(validRoot, [
        { nodeId: 'valid-source-node-000001', title: 'Valid', path: validFilename }
      ])
    )
    expect(valid).toMatchObject({
      ok: true,
      value: { requiresSelection: false, sourceNodeId: 'valid-source-node-000001' }
    })
    if (!valid.ok) throw new Error(valid.error.code)
    expect(manager.close(valid.value.preparationId, 41)).toEqual({ ok: true, value: true })
  })

  it('cleans only the failed concurrent automatic lease', async () => {
    const manager = new BookPreparationManager()
    const failedRoot = await root()
    const failedFilename = `${path.basename(failedRoot)}.md`
    await fs.writeFile(path.join(failedRoot, failedFilename), '# Only one\n')
    const validRoot = await root()
    const validFilename = `${path.basename(validRoot)}.md`
    await fs.writeFile(path.join(validRoot, validFilename), manuscript)
    const failedContext = await context(failedRoot, [
      { nodeId: 'failed-source-node-00001', title: 'Failed', path: failedFilename }
    ])
    const validContext = await context(validRoot, [
      { nodeId: 'valid-source-node-000001', title: 'Valid', path: validFilename }
    ])

    const failedPromise = manager.begin(failedContext)
    const validPromise = manager.begin(validContext)
    const [failed, valid] = await Promise.all([failedPromise, validPromise])
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'preparation-invalid-headings' }
    })
    expect(valid).toMatchObject({
      ok: true,
      value: { sourceNodeId: 'valid-source-node-000001' }
    })
    if (!valid.ok) throw new Error(valid.error.code)
    expect(manager.close(valid.value.preparationId, 41)).toEqual({ ok: true, value: true })
  })

  it.each([
    { rootName: 'Straße', candidateStem: 'STRASSE' },
    { rootName: 'ΟΣ', candidateStem: 'ος' },
    { rootName: 'οσ', candidateStem: 'ος' },
    { rootName: 'Kelvin', candidateStem: 'kelvin' },
    { rootName: 'Café', candidateStem: 'Cafe\u0301' }
  ])(
    'auto-selects canonically case-folded manuscript $rootName/$candidateStem',
    async ({ rootName, candidateStem }) => {
      const parent = await root()
      const rootPath = path.join(parent, rootName)
      await fs.mkdir(rootPath)
      const filename = `${candidateStem}.md`
      await fs.writeFile(path.join(rootPath, filename), manuscript)
      const manager = new BookPreparationManager()
      expect(
        await manager.begin(
          await context(rootPath, [
            { nodeId: 'source-node-00000001', title: 'Manuscript', path: filename }
          ])
        )
      ).toMatchObject({
        ok: true,
        value: { sourceNodeId: 'source-node-00000001', requiresSelection: false }
      })
    }
  )

  it('requires selection when multiple candidate stems have the same full Unicode fold', async () => {
    const parent = await root()
    const rootPath = path.join(parent, 'Straße')
    await fs.mkdir(rootPath)
    await fs.writeFile(path.join(rootPath, 'STRASSE.md'), manuscript)
    await fs.writeFile(path.join(rootPath, 'Straße.markdown'), manuscript)
    const manager = new BookPreparationManager()
    expect(
      await manager.begin(
        await context(rootPath, [
          { nodeId: 'source-node-00000001', title: 'Upper', path: 'STRASSE.md' },
          {
            nodeId: 'source-node-00000002',
            title: 'Sharp s',
            path: 'Straße.markdown'
          }
        ])
      )
    ).toMatchObject({ ok: true, value: { requiresSelection: true, revision: null } })
  })

  it('treats full Unicode folds of SUMMARY as existing conflicts', async () => {
    for (const conflictingName of ['ſummary.md', 'SUMMARY.MARKDOWN']) {
      const rootPath = await root()
      await fs.writeFile(path.join(rootPath, conflictingName), 'occupied')
      const filename = `${path.basename(rootPath)}.md`
      await fs.writeFile(path.join(rootPath, filename), manuscript)
      expect(
        await new BookPreparationManager().begin(
          await context(rootPath, [
            { nodeId: 'source-node-00000001', title: 'Manuscript', path: filename }
          ])
        )
      ).toMatchObject({ ok: false, error: { code: 'preparation-conflict' } })
    }
  })

  it('rejects a long-s SUMMARY winner at the synchronous pre-open boundary', async () => {
    const rootPath = await root()
    const conflictingPath = path.join(rootPath, 'ſummary.md')
    const manager = new BookPreparationManager({
      beforeOpen: () => fsSync.writeFileSync(conflictingPath, 'attacker-preserved')
    })
    const prepared = await auto(manager, rootPath)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-conflict' }
    })
    expect(await fs.readFile(conflictingPath, 'utf8')).toBe('attacker-preserved')
  })

  it('rejects a long-s SUMMARY winner at the post-open prewrite boundary', async () => {
    const rootPath = await root()
    const targetPath = path.join(rootPath, 'SUMMARY.md')
    const movedTarget = path.join(rootPath, 'opened-empty-summary')
    const conflictingPath = path.join(rootPath, 'ſummary.md')
    const manager = new BookPreparationManager({
      afterOpen: () => {
        fsSync.renameSync(targetPath, movedTarget)
        fsSync.writeFileSync(conflictingPath, 'attacker-preserved')
      }
    })
    const prepared = await auto(manager, rootPath)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-commit-uncertain', committed: true }
    })
    expect(await fs.readFile(conflictingPath, 'utf8')).toBe('attacker-preserved')
    expect((await fs.readFile(movedTarget)).byteLength).toBe(0)
  })

  it('requires an explicit opaque selection when no unique exact stem exists', async () => {
    const rootPath = await root()
    await fs.writeFile(path.join(rootPath, 'a.md'), manuscript)
    await fs.writeFile(path.join(rootPath, 'b.md'), manuscript.replace('First', 'Other'))
    const manager = new BookPreparationManager()
    const begun = await manager.begin(
      await context(rootPath, [
        { nodeId: 'source-node-00000001', title: 'Same title', path: 'a.md' },
        { nodeId: 'source-node-00000002', title: 'Same title', path: 'b.md' }
      ])
    )
    expect(begun).toMatchObject({ ok: true, value: { requiresSelection: true, revision: null } })
    if (!begun.ok) throw new Error(begun.error.code)
    expect(begun.value.candidates).toEqual([
      {
        nodeId: 'source-node-00000001',
        title: 'Same title',
        displayLabel: 'Document 1'
      },
      {
        nodeId: 'source-node-00000002',
        title: 'Same title',
        displayLabel: 'Document 2'
      }
    ])
    expect(Object.keys(begun.value.candidates[0]).sort()).toEqual([
      'displayLabel',
      'nodeId',
      'title'
    ])
    const serializedCandidates = JSON.stringify(begun.value.candidates)
    expect(serializedCandidates).not.toContain(rootPath)
    expect(serializedCandidates).not.toContain('a.md')
    expect(serializedCandidates).not.toContain('b.md')
    expect(serializedCandidates).not.toContain('First **chapter**')
    const selected = await manager.select(begun.value.preparationId, 'source-node-00000002', 41)
    expect(selected).toMatchObject({
      ok: true,
      value: { sourceNodeId: 'source-node-00000002', requiresSelection: false }
    })
  })

  it('keeps an explicit-selection lease usable after a selected source fails', async () => {
    const rootPath = await root()
    await fs.writeFile(path.join(rootPath, 'invalid.md'), '# Only one\n')
    await fs.writeFile(path.join(rootPath, 'valid.md'), manuscript)
    const manager = new BookPreparationManager()
    const begun = await manager.begin(
      await context(rootPath, [
        { nodeId: 'invalid-source-node-0001', title: 'Invalid', path: 'invalid.md' },
        { nodeId: 'valid-source-node-000001', title: 'Valid', path: 'valid.md' }
      ])
    )
    if (!begun.ok) throw new Error(begun.error.code)
    expect(
      await manager.select(begun.value.preparationId, 'invalid-source-node-0001', 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-invalid-headings' }
    })
    expect(
      await manager.select(begun.value.preparationId, 'valid-source-node-000001', 41)
    ).toMatchObject({
      ok: true,
      value: { sourceNodeId: 'valid-source-node-000001' }
    })
    expect(manager.close(begun.value.preparationId, 41)).toEqual({ ok: true, value: true })
  })

  it('cancel is zero-write and owner isolated', async () => {
    const rootPath = await root()
    const manager = new BookPreparationManager()
    const prepared = await auto(manager, rootPath)
    expect(manager.close(prepared.preparationId, 99)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    expect(manager.close(prepared.preparationId, 41)).toEqual({ ok: true, value: true })
    await expect(fs.stat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('creates SUMMARY once without modifying the manuscript', async () => {
    const rootPath = await root()
    const manager = new BookPreparationManager()
    const prepared = await auto(manager, rootPath)
    const sourcePath = path.join(rootPath, `${path.basename(rootPath)}.md`)
    const before = await fs.readFile(sourcePath)
    const result = await manager.commit(prepared.preparationId, prepared.revision, 41)
    expect(result).toMatchObject({
      ok: true,
      value: { committed: true, durabilityUncertain: false }
    })
    expect(await fs.readFile(sourcePath)).toEqual(before)
    const summary = await fs.readFile(path.join(rootPath, 'SUMMARY.md'), 'utf8')
    expect(summary).toContain('#first-chapter)')
    expect(summary).toContain(`#${encodeURIComponent('第二章')})`)
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(rootPath, 'SUMMARY.md'))).mode & 0o777).toBe(0o600)
    }
  })

  it('preserves a pathname attacker after direct open without writing canonical bytes', async () => {
    const rootPath = await root()
    const movedTarget = path.join(rootPath, 'opened-summary')
    const manager = new BookPreparationManager({
      afterOpen: (targetPath) => {
        fsSync.renameSync(targetPath, movedTarget)
        fsSync.writeFileSync(targetPath, 'attacker-preserved')
      }
    })
    const prepared = await auto(manager, rootPath)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-commit-uncertain', committed: true }
    })
    expect(await fs.readFile(path.join(rootPath, 'SUMMARY.md'), 'utf8')).toBe('attacker-preserved')
    await expect(fs.readFile(movedTarget, 'utf8')).resolves.toBe('')
  })

  it('rejects a huge sparse grow after exclusive open without attacker-sized allocation', async () => {
    const rootPath = await root()
    const manager = new BookPreparationManager({
      afterOpen: (_targetPath, descriptor) => {
        fsSync.ftruncateSync(descriptor, 4 * 1024 * 1024 * 1024)
      }
    })
    const prepared = await auto(manager, rootPath)
    const started = performance.now()
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-commit-uncertain', committed: true }
    })
    expect(performance.now() - started).toBeLessThan(1_000)
    expect((await fs.lstat(path.join(rootPath, 'SUMMARY.md'))).size).toBe(4 * 1024 * 1024 * 1024)
  })

  it.each([
    {
      name: 'append',
      mutate: (descriptor: number) => {
        fsSync.writeSync(descriptor, Buffer.from('attacker'))
      }
    },
    {
      name: 'overwrite',
      mutate: (descriptor: number) => {
        fsSync.writeSync(descriptor, Buffer.from('attacker'), 0, 8, 0)
      }
    },
    {
      name: 'truncate',
      mutate: (descriptor: number) => {
        fsSync.ftruncateSync(descriptor, 1)
      }
    }
  ])('fails closed when the target is changed by $name after write', async ({ mutate }) => {
    const rootPath = await root()
    const manager = new BookPreparationManager({
      afterWrite: (_targetPath, descriptor) => mutate(descriptor)
    })
    const prepared = await auto(manager, rootPath)
    const started = performance.now()
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-write-failed', committed: false }
    })
    expect(performance.now() - started).toBeLessThan(1_000)
    await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('revalidates bounded target content after file sync', async () => {
    const rootPath = await root()
    const manager = new BookPreparationManager({
      afterSync: (_targetPath, descriptor) => {
        fsSync.writeSync(descriptor, Buffer.from('late-attacker'))
      }
    })
    const prepared = await auto(manager, rootPath)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-write-failed', committed: false }
    })
    await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it.each([
    {
      name: 'write',
      hooks: {
        write: () => {
          throw new Error('forced write failure')
        }
      } satisfies BookPreparationManagerHooks
    },
    {
      name: 'file sync',
      hooks: {
        syncFile: () => {
          throw new Error('forced sync failure')
        }
      } satisfies BookPreparationManagerHooks
    }
  ])('removes only its exact target after a safe $name failure', async ({ hooks }) => {
    const rootPath = await root()
    const manager = new BookPreparationManager(hooks)
    const prepared = await auto(manager, rootPath)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-write-failed', committed: false }
    })
    await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('never writes canonical bytes or path-cleans its empty fd create after the root is swapped', async () => {
    const rootPath = await root()
    const movedRoot = `${rootPath}-partial-moved`
    let firstWrite = true
    const manager = new BookPreparationManager({
      afterOpen: () => {
        fsSync.renameSync(rootPath, movedRoot)
        fsSync.mkdirSync(rootPath)
      },
      write: (descriptor, bytes, offset, length) => {
        if (!firstWrite) throw new Error('forced partial write failure')
        firstWrite = false
        return fsSync.writeSync(descriptor, bytes, offset, Math.min(length, 12))
      }
    })
    const prepared = await auto(manager, rootPath)
    roots.push(movedRoot)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-commit-uncertain', committed: true }
    })
    await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect((await fs.readFile(path.join(movedRoot, 'SUMMARY.md'))).byteLength).toBe(0)
  })

  it('fails before open when the root is redirected through a symlink', async () => {
    const rootPath = await root()
    const movedRoot = `${rootPath}-redirected-original`
    const attackerRoot = await root()
    const manager = new BookPreparationManager({
      beforeOpen: () => {
        fsSync.renameSync(rootPath, movedRoot)
        fsSync.symlinkSync(attackerRoot, rootPath, 'dir')
      }
    })
    const prepared = await auto(manager, rootPath)
    roots.push(movedRoot)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })
    await expect(fs.lstat(path.join(attackerRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.lstat(path.join(movedRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('fails before open when an ancestor is replaced by a symlink', async () => {
    const ancestor = await root()
    const rootPath = path.join(ancestor, 'book')
    await fs.mkdir(rootPath)
    const movedAncestor = `${ancestor}-ancestor-original`
    const attackerAncestor = await root()
    const redirectedRoot = path.join(attackerAncestor, 'book')
    await fs.mkdir(redirectedRoot)
    const manager = new BookPreparationManager({
      beforeOpen: () => {
        fsSync.renameSync(ancestor, movedAncestor)
        fsSync.symlinkSync(attackerAncestor, ancestor, 'dir')
      }
    })
    const prepared = await auto(manager, rootPath)
    roots.push(movedAncestor)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })
    await expect(fs.lstat(path.join(redirectedRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.lstat(path.join(movedAncestor, 'book', 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('fails the prewrite boundary after a root symlink swap and preserves attacker bytes', async () => {
    const rootPath = await root()
    const movedRoot = `${rootPath}-post-open-original`
    const attackerRoot = await root()
    await fs.writeFile(path.join(attackerRoot, 'SUMMARY.md'), 'attacker-preserved')
    const manager = new BookPreparationManager({
      afterOpen: () => {
        fsSync.renameSync(rootPath, movedRoot)
        fsSync.symlinkSync(attackerRoot, rootPath, 'dir')
      }
    })
    const prepared = await auto(manager, rootPath)
    roots.push(movedRoot)
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-commit-uncertain', committed: true }
    })
    expect(await fs.readFile(path.join(attackerRoot, 'SUMMARY.md'), 'utf8')).toBe(
      'attacker-preserved'
    )
    expect((await fs.readFile(path.join(movedRoot, 'SUMMARY.md'))).byteLength).toBe(0)
  })

  it('revalidates source state and session currency after open with zero canonical writes', async () => {
    const sourceRoot = await root()
    const sourcePath = path.join(sourceRoot, `${path.basename(sourceRoot)}.md`)
    const sourceManager = new BookPreparationManager({
      afterOpen: () => fsSync.writeFileSync(sourcePath, '# Replaced\n# Source\n')
    })
    const sourcePrepared = await auto(sourceManager, sourceRoot)
    expect(
      await sourceManager.commit(sourcePrepared.preparationId, sourcePrepared.revision, 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed', committed: false }
    })
    await expect(fs.lstat(path.join(sourceRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const sessionRoot = await root()
    const current = { value: true }
    const sessionFilename = `${path.basename(sessionRoot)}.md`
    await fs.writeFile(path.join(sessionRoot, sessionFilename), manuscript)
    const sessionManager = new BookPreparationManager({
      afterOpen: () => {
        current.value = false
      }
    })
    const begun = await sessionManager.begin(
      await context(
        sessionRoot,
        [{ nodeId: 'source-node-00000001', title: 'Manuscript', path: sessionFilename }],
        current
      )
    )
    if (!begun.ok) throw new Error(begun.error.code)
    expect(
      await sessionManager.commit(begun.value.preparationId, begun.value.revision, 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found', committed: false }
    })
    await expect(fs.lstat(path.join(sessionRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('rejects existing case-folded SUMMARY and duplicate or empty fragments', async () => {
    const rootPath = await root()
    await fs.writeFile(path.join(rootPath, 'summary.MD'), 'occupied')
    const filename = `${path.basename(rootPath)}.md`
    await fs.writeFile(path.join(rootPath, filename), manuscript)
    const manager = new BookPreparationManager()
    expect(
      await manager.begin(
        await context(rootPath, [
          { nodeId: 'source-node-00000001', title: 'Manuscript', path: filename }
        ])
      )
    ).toMatchObject({ ok: false, error: { code: 'preparation-conflict' } })

    const duplicateRoot = await root()
    const duplicateFilename = `${path.basename(duplicateRoot)}.md`
    await fs.writeFile(path.join(duplicateRoot, duplicateFilename), '# Same\n\n# same!!!\n')
    expect(
      await new BookPreparationManager().begin(
        await context(duplicateRoot, [
          {
            nodeId: 'source-node-00000001',
            title: 'Manuscript',
            path: duplicateFilename
          }
        ])
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-invalid-headings' }
    })
  })

  it('fails closed when the source or root identity changes', async () => {
    const sourceRoot = await root()
    const sourceManager = new BookPreparationManager()
    const prepared = await auto(sourceManager, sourceRoot)
    await fs.writeFile(
      path.join(sourceRoot, `${path.basename(sourceRoot)}.md`),
      '# Changed\n# Again\n'
    )
    expect(await sourceManager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject(
      { ok: false, error: { code: 'preparation-source-changed' } }
    )

    const changedRoot = await root()
    const rootManager = new BookPreparationManager()
    const rootPrepared = await auto(rootManager, changedRoot)
    const moved = `${changedRoot}-moved`
    await fs.rename(changedRoot, moved)
    roots.push(moved)
    await fs.mkdir(changedRoot)
    expect(
      await rootManager.commit(rootPrepared.preparationId, rootPrepared.revision, 41)
    ).toMatchObject({ ok: false })
  })

  it('rejects source hard-link and mode changes after preparation', async () => {
    const hardLinkRoot = await root()
    const hardLinkManager = new BookPreparationManager()
    const hardLinkPrepared = await auto(hardLinkManager, hardLinkRoot)
    const hardLinkSource = path.join(hardLinkRoot, `${path.basename(hardLinkRoot)}.md`)
    await fs.link(hardLinkSource, path.join(hardLinkRoot, 'source-alias.md'))
    expect(
      await hardLinkManager.commit(hardLinkPrepared.preparationId, hardLinkPrepared.revision, 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })

    const modeRoot = await root()
    const modeManager = new BookPreparationManager()
    const modePrepared = await auto(modeManager, modeRoot)
    const modeSource = path.join(modeRoot, `${path.basename(modeRoot)}.md`)
    const originalMode = (await fs.stat(modeSource)).mode & 0o777
    await fs.chmod(modeSource, originalMode ^ 0o100)
    expect(
      await modeManager.commit(modePrepared.preparationId, modePrepared.revision, 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })

    const restoredRoot = await root()
    const restoredManager = new BookPreparationManager()
    const restoredPrepared = await auto(restoredManager, restoredRoot)
    const restoredSource = path.join(restoredRoot, `${path.basename(restoredRoot)}.md`)
    const transientAlias = path.join(restoredRoot, 'transient-source-alias.md')
    await fs.link(restoredSource, transientAlias)
    await fs.unlink(transientAlias)
    expect(
      await restoredManager.commit(restoredPrepared.preparationId, restoredPrepared.revision, 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })
  })

  it('rejects source symlinks and existing target symlinks or FIFOs', async () => {
    const sourceRoot = await root()
    const outside = path.join(sourceRoot, 'outside.md')
    await fs.writeFile(outside, manuscript)
    const filename = `${path.basename(sourceRoot)}.md`
    await fs.symlink(outside, path.join(sourceRoot, filename))
    const manager = new BookPreparationManager()
    expect(
      await manager.begin(
        await context(sourceRoot, [
          { nodeId: 'source-node-00000001', title: 'Manuscript', path: filename }
        ])
      )
    ).toMatchObject({ ok: false, error: { code: 'preparation-source-changed' } })

    for (const kind of ['symlink', 'fifo'] as const) {
      const targetRoot = await root()
      const targetManager = new BookPreparationManager()
      const targetPrepared = await auto(targetManager, targetRoot)
      const target = path.join(targetRoot, 'SUMMARY.md')
      if (kind === 'symlink') {
        await fs.symlink(outside, target)
      } else {
        if (!mkfifoPath) continue
        createFifo(target)
      }
      expect(
        await targetManager.commit(targetPrepared.preparationId, targetPrepared.revision, 41)
      ).toMatchObject({ ok: false, error: { code: 'preparation-conflict' } })
      expect((await fs.lstat(target)).isSymbolicLink() || (await fs.lstat(target)).isFIFO()).toBe(
        true
      )
    }
  })

  it.skipIf(!mkfifoPath)(
    'rejects FIFO manuscripts during automatic begin and explicit selection without blocking',
    async () => {
      const automaticRoot = await root()
      const automaticName = `${path.basename(automaticRoot)}.md`
      const automaticPath = path.join(automaticRoot, automaticName)
      createFifo(automaticPath)
      const automaticStarted = performance.now()
      expect(
        await new BookPreparationManager().begin(
          await context(automaticRoot, [
            { nodeId: 'source-node-00000001', title: 'FIFO', path: automaticName }
          ])
        )
      ).toMatchObject({
        ok: false,
        error: { code: 'preparation-source-changed' }
      })
      expect(performance.now() - automaticStarted).toBeLessThan(1_000)
      expect((await fs.lstat(automaticPath)).isFIFO()).toBe(true)
      await expect(fs.lstat(path.join(automaticRoot, 'SUMMARY.md'))).rejects.toMatchObject({
        code: 'ENOENT'
      })

      const selectionRoot = await root()
      const fifoPath = path.join(selectionRoot, 'fifo.md')
      createFifo(fifoPath)
      await fs.writeFile(path.join(selectionRoot, 'regular.md'), manuscript)
      const manager = new BookPreparationManager()
      const begun = await manager.begin(
        await context(selectionRoot, [
          { nodeId: 'source-node-00000001', title: 'FIFO', path: 'fifo.md' },
          { nodeId: 'source-node-00000002', title: 'Regular', path: 'regular.md' }
        ])
      )
      expect(begun).toMatchObject({ ok: true, value: { requiresSelection: true } })
      if (!begun.ok) throw new Error(begun.error.code)
      const selectionStarted = performance.now()
      expect(
        await manager.select(begun.value.preparationId, 'source-node-00000001', 41)
      ).toMatchObject({
        ok: false,
        error: { code: 'preparation-source-changed' }
      })
      expect(performance.now() - selectionStarted).toBeLessThan(1_000)
      expect((await fs.lstat(fifoPath)).isFIFO()).toBe(true)
      await expect(fs.lstat(path.join(selectionRoot, 'SUMMARY.md'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
  )

  it.skipIf(!mkfifoPath)(
    'rejects a manuscript swapped to a FIFO at the final synchronous boundary without blocking',
    async () => {
      const rootPath = await root()
      const reached = deferred()
      const release = deferred()
      const sourcePath = path.join(rootPath, `${path.basename(rootPath)}.md`)
      const manager = new BookPreparationManager({
        beforeOpen: async () => {
          reached.resolve()
          await release.promise
        }
      })
      const prepared = await auto(manager, rootPath)
      const committing = manager.commit(prepared.preparationId, prepared.revision, 41)
      await reached.promise
      await fs.unlink(sourcePath)
      createFifo(sourcePath)
      const finalStarted = performance.now()
      release.resolve()
      expect(await committing).toMatchObject({
        ok: false,
        error: { code: 'preparation-source-changed' }
      })
      expect(performance.now() - finalStarted).toBeLessThan(1_000)
      expect((await fs.lstat(sourcePath)).isFIFO()).toBe(true)
      await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
  )

  it('never overwrites a target won by a commit race and reports directory fsync uncertainty', async () => {
    const raceRoot = await root()
    const raceManager = new BookPreparationManager({
      openTarget: (targetPath, flags, mode) => {
        fsSync.writeFileSync(targetPath, 'racer')
        return fsSync.openSync(targetPath, flags, mode)
      }
    })
    const racePrepared = await auto(raceManager, raceRoot)
    expect(
      await raceManager.commit(racePrepared.preparationId, racePrepared.revision, 41)
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-conflict' }
    })
    expect(await fs.readFile(path.join(raceRoot, 'SUMMARY.md'), 'utf8')).toBe('racer')

    const uncertainRoot = await root()
    const uncertainManager = new BookPreparationManager({ forceDirectorySyncFailure: true })
    const uncertainPrepared = await auto(uncertainManager, uncertainRoot)
    expect(
      await uncertainManager.commit(uncertainPrepared.preparationId, uncertainPrepared.revision, 41)
    ).toMatchObject({
      ok: true,
      value: { committed: true, durabilityUncertain: true }
    })
  })

  it.each([
    {
      name: 'close',
      invalidate: (manager: BookPreparationManager, prepared: Awaited<ReturnType<typeof auto>>) => {
        expect(manager.close(prepared.preparationId, 41)).toEqual({ ok: true, value: true })
      }
    },
    {
      name: 'session revocation',
      invalidate: (manager: BookPreparationManager, prepared: Awaited<ReturnType<typeof auto>>) =>
        manager.revokeSession(prepared.sessionId)
    },
    {
      name: 'owner cleanup',
      invalidate: (manager: BookPreparationManager) => manager.cleanupOwner(41)
    }
  ])('fails closed when $name wins while beforeOpen is held', async ({ invalidate }) => {
    const rootPath = await root()
    const reached = deferred()
    const release = deferred()
    const manager = new BookPreparationManager({
      beforeOpen: async () => {
        reached.resolve()
        await release.promise
      }
    })
    const prepared = await auto(manager, rootPath)
    const committing = manager.commit(prepared.preparationId, prepared.revision, 41)
    await reached.promise
    invalidate(manager, prepared)
    release.resolve()
    expect(await committing).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found' }
    })
    await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('revalidates source bytes and root identity after a held beforeOpen hook', async () => {
    const sourceRoot = await root()
    const sourceReached = deferred()
    const sourceRelease = deferred()
    const sourceManager = new BookPreparationManager({
      beforeOpen: async () => {
        sourceReached.resolve()
        await sourceRelease.promise
      }
    })
    const sourcePrepared = await auto(sourceManager, sourceRoot)
    const sourceCommit = sourceManager.commit(
      sourcePrepared.preparationId,
      sourcePrepared.revision,
      41
    )
    await sourceReached.promise
    await fs.writeFile(
      path.join(sourceRoot, `${path.basename(sourceRoot)}.md`),
      '# Attacker\n# Kept\n'
    )
    sourceRelease.resolve()
    expect(await sourceCommit).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })
    await expect(fs.lstat(path.join(sourceRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const originalRoot = await root()
    const movedRoot = `${originalRoot}-held-moved`
    const rootReached = deferred()
    const rootRelease = deferred()
    const rootManager = new BookPreparationManager({
      beforeOpen: async () => {
        rootReached.resolve()
        await rootRelease.promise
      }
    })
    const rootPrepared = await auto(rootManager, originalRoot)
    const rootCommit = rootManager.commit(rootPrepared.preparationId, rootPrepared.revision, 41)
    await rootReached.promise
    await fs.rename(originalRoot, movedRoot)
    roots.push(movedRoot)
    await fs.mkdir(originalRoot)
    rootRelease.resolve()
    expect(await rootCommit).toMatchObject({
      ok: false,
      error: { code: 'preparation-source-changed' }
    })
    await expect(fs.lstat(path.join(originalRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.lstat(path.join(movedRoot, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it.each(['SUMMARY.md', 'SuMmArY.Md'])(
    'preserves an attacker winner named %s after a held beforeOpen hook',
    async (attackerName) => {
      const rootPath = await root()
      const reached = deferred()
      const release = deferred()
      const manager = new BookPreparationManager({
        beforeOpen: async () => {
          reached.resolve()
          await release.promise
        }
      })
      const prepared = await auto(manager, rootPath)
      const committing = manager.commit(prepared.preparationId, prepared.revision, 41)
      await reached.promise
      await fs.writeFile(path.join(rootPath, attackerName), 'attacker-preserved')
      release.resolve()
      expect(await committing).toMatchObject({
        ok: false,
        error: { code: 'preparation-conflict' }
      })
      expect(await fs.readFile(path.join(rootPath, attackerName), 'utf8')).toBe(
        'attacker-preserved'
      )
    }
  )

  it('lets cancellation win after open but before the synchronous prewrite boundary', async () => {
    const rootPath = await root()
    let cancelResult: ReturnType<BookPreparationManager['close']> | null = null
    let preparedId = ''
    const manager = new BookPreparationManager({
      afterOpen: () => {
        cancelResult = manager.close(preparedId, 41)
      }
    })
    const prepared = await auto(manager, rootPath)
    preparedId = prepared.preparationId
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: false,
      error: { code: 'preparation-not-found', committed: false }
    })
    expect(cancelResult).toEqual({ ok: true, value: true })
    await expect(fs.lstat(path.join(rootPath, 'SUMMARY.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('reports cancellation as too late once canonical writing has started', async () => {
    const rootPath = await root()
    let cancelResult: ReturnType<BookPreparationManager['close']> | null = null
    let preparedId = ''
    const manager = new BookPreparationManager({
      afterWrite: () => {
        cancelResult = manager.close(preparedId, 41)
      }
    })
    const prepared = await auto(manager, rootPath)
    preparedId = prepared.preparationId
    expect(await manager.commit(prepared.preparationId, prepared.revision, 41)).toMatchObject({
      ok: true,
      value: { committed: true }
    })
    expect(cancelResult).toMatchObject({
      ok: false,
      error: { code: 'preparation-conflict', committed: true }
    })
  })

  it('enforces source, heading, line, and title work limits and escapes generated labels', async () => {
    const oversizedRoot = await root()
    const oversizedFilename = `${path.basename(oversizedRoot)}.md`
    await fs.writeFile(
      path.join(oversizedRoot, oversizedFilename),
      `# One\n# Two\n${'x'.repeat(8 * 1024 * 1024)}`
    )
    expect(
      await new BookPreparationManager().begin(
        await context(oversizedRoot, [
          {
            nodeId: 'source-node-00000001',
            title: 'Oversized',
            path: oversizedFilename
          }
        ])
      )
    ).toMatchObject({ ok: false })

    const headingRoot = await root()
    const headingFilename = `${path.basename(headingRoot)}.md`
    await fs.writeFile(
      path.join(headingRoot, headingFilename),
      Array.from({ length: 2_001 }, (_, index) => `# Chapter ${index}`).join('\n')
    )
    expect(
      await new BookPreparationManager().begin(
        await context(headingRoot, [
          { nodeId: 'source-node-00000001', title: 'Many', path: headingFilename }
        ])
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-invalid-headings' }
    })

    const lineRoot = await root()
    const lineFilename = `${path.basename(lineRoot)}.md`
    await fs.writeFile(path.join(lineRoot, lineFilename), `# One\n# Two\n${'\n'.repeat(250_000)}`)
    expect(
      await new BookPreparationManager().begin(
        await context(lineRoot, [
          { nodeId: 'source-node-00000001', title: 'Lines', path: lineFilename }
        ])
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-invalid-headings' }
    })

    const titleRoot = await root()
    const titleFilename = `${path.basename(titleRoot)}.md`
    await fs.writeFile(path.join(titleRoot, titleFilename), `# ${'x'.repeat(513)}\n# Two\n`)
    expect(
      await new BookPreparationManager().begin(
        await context(titleRoot, [
          { nodeId: 'source-node-00000001', title: 'Long', path: titleFilename }
        ])
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'preparation-invalid-headings' }
    })

    const escapedRoot = await root()
    const escapedManager = new BookPreparationManager()
    const escaped = await auto(escapedManager, escapedRoot, '# [One] \\\\ path\n# Two\n')
    await escapedManager.commit(escaped.preparationId, escaped.revision, 41)
    expect(await fs.readFile(path.join(escapedRoot, 'SUMMARY.md'), 'utf8')).toContain(
      '- [\\[One\\] \\\\ path]'
    )
  })
})
