/* eslint-disable @stylistic/space-before-function-paren */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fsSync from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  addExpandedBookExportTargetCharacters,
  assetRelativePath,
  BookExportResourceLedgerError,
  buildBookExportResourceLedger,
  BOOK_EXPORT_HTML_MAX_EXPANDED_DATA_URL_CHARACTERS,
  exportResourcesCurrentSync
} from 'main_renderer/book/exportResources'

const temporaryRoots: string[] = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const gif = Buffer.from(
  'R0lGODdhAQABAJEAAAAAACgsNP///wAAACH5BAkAAAMALAAAAAABAAEAAAICTAEAOw==',
  'base64'
)

const makeRoot = async (): Promise<{
  root: string
  identity: { realPath: string; dev: bigint; ino: bigint }
}> => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-export-ledger-'))
  )
  temporaryRoots.push(root)
  const stat = await fs.stat(root, { bigint: true })
  return { root, identity: { realPath: root, dev: stat.dev, ino: stat.ino } }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe('book export resource ledger', () => {
  it('rejects a repeated maximum data URL before allocating occurrence-expanded output', () => {
    const sixMiBDataUrl = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`
    const occurrences = Array<string>(256).fill('cover.png')
    expect(
      addExpandedBookExportTargetCharacters(0, occurrences, new Map([['cover.png', sixMiBDataUrl]]))
    ).toBeNull()
  })

  it('accepts the exact occurrence-expanded HTML target boundary and rejects one more character', () => {
    const occurrences = Array<string>(256).fill('cover.png')
    const exact = 'A'.repeat(BOOK_EXPORT_HTML_MAX_EXPANDED_DATA_URL_CHARACTERS / 256)
    expect(
      addExpandedBookExportTargetCharacters(0, occurrences, new Map([['cover.png', exact]]))
    ).toBe(BOOK_EXPORT_HTML_MAX_EXPANDED_DATA_URL_CHARACTERS)
    expect(
      addExpandedBookExportTargetCharacters(0, occurrences, new Map([['cover.png', `${exact}A`]]))
    ).toBeNull()
  })

  it('deduplicates sanitized content across chapters and produces deterministic opaque targets', async () => {
    const { root, identity } = await makeRoot()
    await Promise.all([
      fs.writeFile(path.join(root, 'cover.png'), png),
      fs.writeFile(path.join(root, 'duplicate.png'), png)
    ])
    const documents = [
      { documentId: '1', path: 'one.md', markdown: '![one](cover.png)' },
      { documentId: '2', path: 'two.md', markdown: '![two](duplicate.png)' }
    ]
    const first = await buildBookExportResourceLedger(identity, documents, 'website')
    const second = await buildBookExportResourceLedger(identity, documents, 'website')

    expect(first.assets).toHaveLength(1)
    const asset = first.assets[0]
    expect(asset).toBeDefined()
    if (!asset) return
    expect(first.targetsByDocument.get('1')).toEqual(first.targetsByDocument.get('2'))
    expect(first.targetsByDocument.get('1')?.[0]).toBe(assetRelativePath(asset))
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(JSON.stringify([...first.targetsByDocument.values()])).not.toMatch(
      /cover|duplicate|leafbook-export-ledger/u
    )
  })

  it('keeps same source names with different validated content as distinct hashed assets', async () => {
    const { root, identity } = await makeRoot()
    await Promise.all([fs.mkdir(path.join(root, 'a')), fs.mkdir(path.join(root, 'b'))])
    await Promise.all([
      fs.writeFile(path.join(root, 'a/image.png'), png),
      fs.writeFile(path.join(root, 'b/image.gif'), gif)
    ])
    const ledger = await buildBookExportResourceLedger(
      identity,
      [
        { documentId: '1', path: 'a/one.md', markdown: '![one](image.png)' },
        { documentId: '2', path: 'b/two.md', markdown: '![two](image.gif)' }
      ],
      'website'
    )

    expect(ledger.assets).toHaveLength(2)
    expect(new Set(ledger.assets.map((asset) => asset.sha256)).size).toBe(2)
    expect(ledger.targetsByDocument.get('1')?.[0]).toMatch(/^assets\/[a-f0-9]{64}\.png$/u)
    expect(ledger.targetsByDocument.get('2')?.[0]).toMatch(/^assets\/[a-f0-9]{64}\.gif$/u)
  })

  it('never reads remote, data, file, absolute, unsupported, or raw-HTML image sources', async () => {
    const { root, identity } = await makeRoot()
    await fs.writeFile(path.join(root, 'safe.png'), png)
    const ledger = await buildBookExportResourceLedger(
      identity,
      [
        {
          documentId: '1',
          path: 'one.md',
          markdown: [
            '![safe](safe.png)',
            '![remote](https://example.invalid/x.png)',
            '![data](data:image/png;base64,AAAA)',
            '![file](file:///tmp/x.png)',
            '![absolute](/tmp/x.png)',
            '![unsupported](movie.mp4)',
            '<img src="raw.png">'
          ].join('\n\n')
        }
      ],
      'html'
    )

    expect(ledger.assets).toHaveLength(1)
    expect(ledger.referencesByDocument.get('1')).toEqual(['safe.png'])
    expect(ledger.targetsByDocument.get('1')?.[0]).toMatch(/^data:image\/png;base64,/u)
    expect(JSON.stringify([...ledger.targetsByDocument.values()])).not.toMatch(
      /https?:|file:|\/tmp|raw\.png/u
    )
  })

  it('fails closed when the full-book reference budget is exceeded', async () => {
    const { identity } = await makeRoot()
    const markdown = Array.from(
      { length: 64 },
      (_, index) => `![asset-${index}](missing-${index}.png)`
    ).join('\n')
    const documents = Array.from({ length: 33 }, (_, index) => ({
      documentId: `${index + 1}`,
      path: `chapter-${index + 1}.md`,
      markdown
    }))

    await expect(buildBookExportResourceLedger(identity, documents, 'website')).rejects.toThrow(
      'export-resource-budget'
    )
  })

  it('uses the shared first-256 occurrence plan and ignores a new reference after the cap', async () => {
    const { root, identity } = await makeRoot()
    await fs.writeFile(path.join(root, 'safe.png'), png)
    const markdown = [
      ...Array.from({ length: 256 }, (_, index) => `![safe-${index}](safe.png)`),
      '![must-not-be-read](after-limit.png)'
    ].join('\n')
    const ledger = await buildBookExportResourceLedger(
      identity,
      [{ documentId: '1', path: 'one.md', markdown }],
      'website'
    )
    expect(ledger.referencesByDocument.get('1')).toHaveLength(256)
    expect(ledger.referencesByDocument.get('1')).not.toContain('after-limit.png')
    expect(ledger.targetsByDocument.get('1')).toHaveLength(1)
    expect(ledger.assets).toHaveLength(1)
  })

  it.each(['html', 'website'] as const)(
    'keeps %s renderer targets unique while expanding the exact occurrence sequence',
    async (kind) => {
      const { root, identity } = await makeRoot()
      await Promise.all([
        fs.writeFile(path.join(root, 'a.png'), png),
        fs.writeFile(path.join(root, 'b.gif'), gif)
      ])
      const ledger = await buildBookExportResourceLedger(
        identity,
        [
          {
            documentId: '1',
            path: 'one.md',
            markdown: '![a-1](a.png)\n![a-2](a.png)\n![b](b.gif)'
          }
        ],
        kind
      )
      const targets = ledger.targetsByDocument.get('1') ?? []
      expect(targets).toHaveLength(2)
      expect(ledger.expectedImageSources).toEqual([targets[0], targets[0], targets[1]])
      expect(ledger.expectedResourceSequence).toEqual([targets[0], targets[0], targets[1]])
    }
  )

  it('binds missing, corrupt, and symlink placeholders to exact negative states', async () => {
    const { root, identity } = await makeRoot()
    const outside = path.join(root, '..', `leafbook-export-outside-${Date.now()}.png`)
    await fs.writeFile(path.join(root, 'corrupt.png'), 'not-a-png')
    await fs.writeFile(outside, png)
    await fs.symlink(outside, path.join(root, 'linked.png'))
    try {
      const documents = [
        {
          documentId: '1',
          path: 'one.md',
          markdown: '![missing](missing.png)\n![corrupt](corrupt.png)\n![linked](linked.png)'
        }
      ]
      const unchanged = await buildBookExportResourceLedger(identity, documents, 'website')
      expect(unchanged.sourceStates).toHaveLength(3)
      expect(unchanged.sourceStates.every((source) => source.state.kind === 'negative')).toBe(true)
      expect(exportResourcesCurrentSync(unchanged)).toBe(true)

      const missingCreated = await buildBookExportResourceLedger(identity, documents, 'website')
      await fs.writeFile(path.join(root, 'missing.png'), 'still-invalid')
      expect(exportResourcesCurrentSync(missingCreated)).toBe(false)
      await fs.rm(path.join(root, 'missing.png'))

      const corruptChanged = await buildBookExportResourceLedger(identity, documents, 'website')
      await fs.writeFile(path.join(root, 'corrupt.png'), 'different-invalid-bytes')
      expect(exportResourcesCurrentSync(corruptChanged)).toBe(false)

      const corruptValid = await buildBookExportResourceLedger(identity, documents, 'website')
      await fs.writeFile(path.join(root, 'corrupt.png'), png)
      expect(exportResourcesCurrentSync(corruptValid)).toBe(false)

      await fs.writeFile(path.join(root, 'corrupt.png'), 'not-a-png')
      const symlinkReplaced = await buildBookExportResourceLedger(identity, documents, 'website')
      await fs.rm(path.join(root, 'linked.png'))
      await fs.writeFile(path.join(root, 'linked.png'), png)
      expect(exportResourcesCurrentSync(symlinkReplaced)).toBe(false)
    } finally {
      await fs.rm(outside, { force: true })
    }
  })

  it('rejects preparation when an invalid regular file cannot produce a stable negative proof', async () => {
    const { root, identity } = await makeRoot()
    await fs.writeFile(path.join(root, 'corrupt.png'), 'not-a-png')
    const open = vi.spyOn(fsSync, 'openSync').mockImplementationOnce(() => {
      const denied = new Error('denied') as NodeJS.ErrnoException
      denied.code = 'EACCES'
      throw denied
    })
    try {
      const attempt = buildBookExportResourceLedger(
        identity,
        [{ documentId: '1', path: 'one.md', markdown: '![corrupt](corrupt.png)' }],
        'website'
      )
      await expect(attempt).rejects.toBeInstanceOf(BookExportResourceLedgerError)
      await expect(attempt).rejects.toMatchObject({ code: 'source-unverifiable' })
    } finally {
      open.mockRestore()
    }
  })

  it('counts readable negative regular files against the shared 32 MiB physical budget', async () => {
    const { root, identity } = await makeRoot()
    const names = Array.from({ length: 5 }, (_, index) => `corrupt-${index}.png`)
    const corrupt = Buffer.alloc(8 * 1024 * 1024)
    await Promise.all(names.map((name) => fs.writeFile(path.join(root, name), corrupt)))
    const attempt = buildBookExportResourceLedger(
      identity,
      [
        {
          documentId: '1',
          path: 'one.md',
          markdown: names.map((name) => `![${name}](${name})`).join('\n')
        }
      ],
      'website'
    )
    await expect(attempt).rejects.toMatchObject({ code: 'budget' })
  })

  it('stable-reads 2048 negative hardlinks at most once per physical inode', async () => {
    const { root, identity } = await makeRoot()
    const names = Array.from({ length: 2_048 }, (_, index) => `linked-${index}.png`)
    const first = path.join(root, names[0] as string)
    await fs.writeFile(first, 'shared-invalid-image')
    await Promise.all(names.slice(1).map((name) => fs.link(first, path.join(root, name))))
    const originalOpen = fsSync.openSync
    let stableOpens = 0
    const open = vi.spyOn(fsSync, 'openSync').mockImplementation((...args) => {
      stableOpens += 1
      return originalOpen(...args)
    })
    try {
      const ledger = await buildBookExportResourceLedger(
        identity,
        Array.from({ length: 32 }, (_, documentIndex) => ({
          documentId: `${documentIndex + 1}`,
          path: `chapter-${documentIndex + 1}.md`,
          markdown: names
            .slice(documentIndex * 64, (documentIndex + 1) * 64)
            .map((name) => `![${name}](${name})`)
            .join('\n')
        })),
        'website'
      )
      expect(ledger.sourceStates).toHaveLength(2_048)
      expect(stableOpens).toBeLessThanOrEqual(1)
    } finally {
      open.mockRestore()
    }
  })

  it.each(['html', 'website'] as const)(
    'keeps repeated missing %s resources as placeholders before a valid unique target',
    async (kind) => {
      const { root, identity } = await makeRoot()
      await fs.writeFile(path.join(root, 'b.gif'), gif)
      const ledger = await buildBookExportResourceLedger(
        identity,
        [
          {
            documentId: '1',
            path: 'one.md',
            markdown: '![missing-1](missing.png)\n![missing-2](missing.png)\n![b](b.gif)'
          }
        ],
        kind
      )
      const targets = ledger.targetsByDocument.get('1') ?? []
      expect(targets).toHaveLength(2)
      expect(targets[0]).toBeNull()
      expect(ledger.expectedImageSources).toEqual([targets[1]])
      expect(ledger.expectedResourceSequence).toEqual([
        'placeholder:image-0',
        'placeholder:image-0',
        targets[1]
      ])
    }
  )
})
