/* eslint-disable @stylistic/generator-star-spacing, @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildBook } from 'common/book/builder'
import type { BookNavigationNode } from 'common/book/model'
import { resolveBookTarget } from 'common/book/path'
import { parseBookSummary } from 'common/book/summary'
import { loadBookFromDirectory } from 'main_renderer/book'

const tempDirectories: string[] = []

const createBookDirectory = async (
  files: Record<string, string>,
  prefix: string = 'leafbook-domain-'
): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirectories.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content, 'utf8')
  }
  return root
}

const flatten = (nodes: readonly BookNavigationNode[]): BookNavigationNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)])

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('book target safety', () => {
  it('normalizes encoded spaces, backslashes, and a decoded fragment', () => {
    expect(resolveBookTarget('guide%20book\\intro.md#Hello%20World')).toEqual({
      kind: 'local',
      path: 'guide book/intro.md',
      fragment: 'Hello World'
    })
  })

  it.each([
    ['/absolute.md', 'unsafe-path'],
    ['C:\\book\\chapter.md', 'unsafe-path'],
    ['../secret.md', 'unsafe-path'],
    ['%2e%2e/secret.md', 'unsafe-path'],
    ['file:///tmp/secret.md', 'unsafe-path'],
    ['chapter.txt', 'non-markdown-target'],
    ['chapter.md\0oops', 'unsafe-path']
  ])('rejects unsafe or unsupported local target %s', (target, reason) => {
    expect(resolveBookTarget(target)).toMatchObject({ kind: 'invalid', reason })
  })

  it('keeps safe web links external and rejects executable schemes', () => {
    expect(resolveBookTarget('https://example.com/docs')).toEqual({
      kind: 'external',
      url: 'https://example.com/docs'
    })
    expect(resolveBookTarget('javascript:alert(1)')).toMatchObject({
      kind: 'invalid',
      reason: 'unsafe-external-url'
    })
  })

  it.each([
    '//example.com/docs',
    'https://user:pass@example.com',
    'https://exa%mple.com',
    'https://example.com/\nsecret',
    'file:///tmp/book.md'
  ])('rejects protocol-relative, malformed, credentialed, control, or file URL %s', (target) => {
    expect(resolveBookTarget(target)).toMatchObject({ kind: 'invalid' })
  })

  it('decodes a SUMMARY target exactly once and rejects control fragments', () => {
    expect(resolveBookTarget('a%2520b.md')).toMatchObject({
      kind: 'local',
      path: 'a%20b.md'
    })
    expect(resolveBookTarget('a.md#bad%00fragment')).toMatchObject({
      kind: 'invalid',
      reason: 'unsafe-path'
    })
  })
})

describe('SUMMARY.md parsing', () => {
  it('preserves headings, nested list order, Chinese titles, external links, and fragments', () => {
    const result = parseBookSummary(`# 目录

## 第一部分

- [开始](README.md)
  - [安装 指南](guide%20book/install.markdown#macOS%20安装)
- [官网](https://example.com)
`)

    expect(result.title).toBe('目录')
    expect(result.chapterPaths).toEqual(['README.md', 'guide book/install.markdown'])
    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toHaveLength(1)

    const group = result.nodes[0]
    expect(group).toMatchObject({ type: 'group', title: '第一部分' })
    expect(group.children[0]).toMatchObject({
      type: 'chapter',
      title: '开始',
      path: 'README.md'
    })
    expect(group.children[0].children[0]).toMatchObject({
      type: 'chapter',
      title: '安装 指南',
      path: 'guide book/install.markdown',
      fragment: 'macOS 安装'
    })
    expect(group.children[1]).toMatchObject({
      type: 'external',
      url: 'https://example.com/'
    })
  })

  it('allows different anchors and diagnoses exact duplicates, malformed items, and escapes', () => {
    const result = parseBookSummary(`# Summary
- [One](one.md)
- [Again](one.md#other)
- [Again duplicate](one.md#other)
- [Again duplicate twice](one.md#other)
- [Broken](missing
- [Escape](../escape.md)
- [Not Markdown](image.png)
`)

    expect(result.chapterPaths).toEqual(['one.md'])
    const chapters = flatten(result.nodes).filter((node) => node.type === 'chapter')
    expect(chapters).toHaveLength(4)
    expect(new Set(chapters.map((node) => node.id))).toHaveProperty('size', 4)
    expect(result.diagnostics.filter((item) => item.code === 'duplicate-chapter')).toHaveLength(1)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'duplicate-chapter',
        'invalid-summary-item',
        'unsafe-path',
        'non-markdown-target'
      ])
    )
  })

  it('ignores navigation-looking content in fences of the correct length', () => {
    const result = parseBookSummary(`# Summary
\`\`\`\`
- [Hidden](hidden.md)
\`\`\`
- [Still hidden](also-hidden.md)
\`\`\`\`
- [Visible](visible.md)
`)
    expect(result.chapterPaths).toEqual(['visible.md'])
  })

  it('uses an invalid list item as a child boundary', () => {
    const result = parseBookSummary(`# Summary
- [Valid](valid.md)
- [Broken](missing
  - [Child](child.md)
`)
    const valid = result.nodes[0]
    expect(valid.children).toEqual([])
    expect(result.nodes[1]).toMatchObject({ type: 'chapter', path: 'child.md' })
  })

  it('returns a structured diagnostic instead of throwing for an invalid summary', () => {
    const result = parseBookSummary('This is not a supported SUMMARY document.')
    expect(result.nodes).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-summary')).toBe(
      true
    )
  })

  it('enforces parser work limits before scanning or creating excess nodes', () => {
    const rejected = parseBookSummary('- [One](one.md)', 'SUMMARY.md', {
      maxCharacters: 4
    })
    expect(rejected.nodes).toEqual([])
    expect(rejected.diagnostics).toEqual([
      expect.objectContaining({ code: 'summary-character-limit' })
    ])

    const bounded = parseBookSummary(
      ['not supported', 'still invalid', '- [One](one.md)', '- [Two](two.md)'].join('\n'),
      'SUMMARY.md',
      {
        maxLines: 3,
        maxNodes: 1,
        maxListItems: 1,
        maxDiagnostics: 2
      }
    )
    expect(bounded.nodes).toHaveLength(1)
    expect(bounded.chapterPaths).toEqual(['one.md'])
    expect(bounded.diagnostics).toHaveLength(2)
    expect(bounded.diagnostics.at(-1)?.code).toBe('diagnostic-limit')
  })

  it('diagnoses SUMMARY line and node limits only after real truncation', () => {
    const exactLines = parseBookSummary('- One\n- Two\n', 'SUMMARY.md', {
      maxLines: 2
    })
    expect(exactLines.diagnostics.some((item) => item.code === 'summary-line-limit')).toBe(false)

    const extraLine = parseBookSummary('- One\n- Two\n- Three\n', 'SUMMARY.md', {
      maxLines: 2
    })
    expect(extraLine.diagnostics.some((item) => item.code === 'summary-line-limit')).toBe(true)

    const exactNode = parseBookSummary('- [One](one.md)\n', 'SUMMARY.md', {
      maxNodes: 1
    })
    expect(exactNode.diagnostics.some((item) => item.code === 'build-node-limit')).toBe(false)

    const extraNode = parseBookSummary('- [One](one.md)\n- [Two](two.md)\n', 'SUMMARY.md', {
      maxNodes: 1
    })
    expect(extraNode.diagnostics.some((item) => item.code === 'build-node-limit')).toBe(true)
  })

  it('bounds link destinations, decoded fragments, and nesting depth', () => {
    const destination = parseBookSummary('- [Long](abcdefghij.md)', 'SUMMARY.md', {
      maxLinkDestinationLength: 4
    })
    expect(destination.nodes).toEqual([])
    expect(destination.diagnostics.some((item) => item.code === 'summary-link-limit')).toBe(true)

    const fragment = parseBookSummary('- [Long](one.md#abcdef)', 'SUMMARY.md', {
      maxFragmentLength: 2
    })
    expect(fragment.nodes).toEqual([])
    expect(fragment.diagnostics.some((item) => item.code === 'summary-link-limit')).toBe(true)

    const depth = parseBookSummary('- Parent\n  - [Nested](nested.md)', 'SUMMARY.md', {
      maxDepth: 0
    })
    expect(flatten(depth.nodes).some((node) => node.type === 'chapter')).toBe(false)
    expect(depth.diagnostics.some((item) => item.code === 'build-depth-limit')).toBe(true)
  })

  it('uses unambiguous tuple identities when paths and fragments contain hashes', () => {
    const result = parseBookSummary(
      '- [Fragment hash](a.md#b.md%23c)\n- [Path hash](a.md%23b.md#c)'
    )
    const chapters = flatten(result.nodes).filter((node) => node.type === 'chapter')
    expect(chapters).toHaveLength(2)
    expect(chapters[0].id).not.toBe(chapters[1].id)
    expect(result.diagnostics.some((item) => item.code === 'duplicate-chapter')).toBe(false)
  })
})

describe('pure book building', () => {
  it.each([undefined, null, 42, 'book'])(
    'normalizes invalid top-level build input %s without throwing',
    (input) => {
      const result = buildBook(input as unknown as Parameters<typeof buildBook>[0])
      expect(result.book.metadata.title).toBe('Untitled Book')
      expect(result.book.navigation.nodes).toEqual([])
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'invalid-path', severity: 'warning' })
      ])
    }
  )

  it('uses SUMMARY order, chooses its first existing local page, and does not append orphans', () => {
    const result = buildBook({
      rootName: 'my-book',
      files: [
        { path: 'SUMMARY.md', content: '- [Missing](missing.md)\n- [Two](two.md)' },
        { path: 'README.md', content: '# Book title' },
        { path: 'two.md', content: '# Two' },
        { path: 'orphan.md', content: '# Orphan' }
      ]
    })

    expect(result.book.navigation.source).toBe('summary')
    expect(result.book.navigation.chapterPaths).toEqual(['missing.md', 'two.md'])
    expect(result.book.navigation.entryPath).toBe('two.md')
    expect(flatten(result.book.navigation.nodes).some((node) => node.title === 'Orphan')).toBe(
      false
    )
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-chapter', relatedPath: 'missing.md' }),
        expect.objectContaining({ code: 'orphaned-chapters', count: 1 })
      ])
    )
  })

  it('keeps physical percent names distinct and maps each through one SUMMARY decode', () => {
    const result = buildBook({
      rootName: 'percent',
      files: [
        { path: 'a%20b.md', content: '# Percent' },
        { path: 'a b.md', content: '# Space' }
      ],
      summary: {
        path: 'SUMMARY.md',
        content: '- [Percent](a%2520b.md)\n- [Space](a%20b.md)'
      }
    })
    expect(result.book.navigation.chapterPaths).toEqual(['a%20b.md', 'a b.md'])
    expect(result.diagnostics.some((item) => item.code === 'missing-chapter')).toBe(false)
  })

  it('reports case-fold and NFC path collisions without dropping nodes', () => {
    const result = buildBook({
      rootName: 'identity',
      files: [
        { path: 'Guide.md', content: '# Upper' },
        { path: 'guide.md', content: '# Lower' },
        { path: 'é.md', content: '# NFC' },
        { path: 'e\u0301.md', content: '# NFD' }
      ]
    })
    expect(result.book.navigation.chapterPaths).toHaveLength(4)
    expect(
      result.diagnostics.filter((item) => item.code === 'path-identity-collision')
    ).toHaveLength(2)
  })

  it('sanitizes raw absolute model fields and preserves missing SUMMARY line numbers', () => {
    const result = buildBook({
      rootName: '/private/tmp/secret-book',
      files: [
        { path: '/private/tmp/secret.md', content: '# Secret' },
        { path: 'SUMMARY.md', content: '- [Missing](missing.md)' }
      ],
      summary: { path: '/private/tmp/SUMMARY.md', content: '- [Bad](bad.md)' },
      diagnostics: [
        {
          code: 'scan-read-error',
          severity: 'warning',
          message: 'Unable to read /private/tmp/secret.md',
          source: { path: '/private/tmp/secret.md' }
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('/private/tmp')
    expect(result.book.metadata.title).toBe('Untitled Book')

    const missing = buildBook({
      rootName: 'line',
      files: [{ path: 'SUMMARY.md', content: '# Summary\n\n- [Missing](missing.md)' }]
    }).diagnostics.find((item) => item.code === 'missing-chapter')
    expect(missing?.source).toEqual({ path: 'SUMMARY.md', line: 3 })
  })

  it('rebuilds incoming diagnostics from stable code mappings without raw messages', () => {
    const rawMessages = [
      'ENOENT:/private/tmp/secret.md',
      'path=/private/tmp/secret.md',
      'open=C:\\Users\\secret.md'
    ]
    const result = buildBook({
      rootName: 'safe',
      files: [],
      diagnostics: rawMessages.map((message, index) => ({
        code: 'scan-read-error' as const,
        severity: index === 0 ? ('error' as const) : ('info' as const),
        message,
        source: index === 0 ? { path: '' } : { path: '/invalid/source.md' }
      }))
    })
    expect(result.diagnostics).toHaveLength(3)
    expect(new Set(result.diagnostics.map((item) => item.message))).toEqual(
      new Set(['A filesystem item could not be read safely.'])
    )
    expect(result.diagnostics.every((item) => item.severity === 'warning')).toBe(true)
    expect(result.diagnostics.every((item) => item.source === undefined)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/private|Users|ENOENT|path=|open=/)
  })

  it('caps candidate and diagnostic iteration even when inputs are invalid or duplicate', () => {
    let diagnosticIterations = 0
    const diagnostics = {
      *[Symbol.iterator]() {
        while (true) {
          diagnosticIterations++
          yield {
            code: 'scan-read-error' as const,
            severity: 'warning' as const,
            message: 'raw'
          }
        }
      }
    }
    const result = buildBook({
      rootName: 'caps',
      files: [
        { path: '../invalid.md', content: '' },
        { path: '../still-invalid.md', content: '' },
        { path: 'never-visited.md', content: '# Never' }
      ],
      diagnostics: diagnostics as unknown as readonly never[],
      limits: { maxFiles: 2, maxDiagnostics: 2 }
    })
    expect(diagnosticIterations).toBe(3)
    expect(result.book.navigation.chapterPaths).toEqual([])
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.at(-1)?.code).toBe('diagnostic-limit')

    const duplicates = buildBook({
      rootName: 'duplicates',
      files: [
        { path: 'same.md', content: '# One' },
        { path: 'same.md', content: '# Two' },
        { path: 'not-visited.md', content: '# Three' }
      ],
      limits: { maxFiles: 2 }
    })
    expect(duplicates.book.navigation.chapterPaths).toEqual(['same.md'])
    expect(duplicates.diagnostics.some((item) => item.code === 'build-file-limit')).toBe(true)
  })

  it('applies the raw character budget before accepting book content', () => {
    const result = buildBook({
      rootName: 'characters',
      files: [
        { path: 'too-large.md', content: 'abc' },
        { path: 'never.md', content: '# Never' }
      ],
      limits: { maxContentCharacters: 2 }
    })
    expect(result.book.navigation.chapterPaths).toEqual([])
    expect(result.diagnostics.some((item) => item.code === 'build-content-limit')).toBe(true)
  })

  it('caps pure build files, nodes, depth, content, and diagnostics', () => {
    const result = buildBook({
      rootName: 'caps',
      files: [
        { path: 'one.md', content: '# One' },
        { path: 'two.md', content: '# Two' }
      ],
      diagnostics: Array.from({ length: 5 }, () => ({
        code: 'scan-read-error' as const,
        severity: 'warning' as const,
        message: 'Stable read failure.'
      })),
      limits: {
        maxFiles: 1,
        maxNodes: 1,
        maxDepth: 0,
        maxContentBytes: 20,
        maxDiagnostics: 2
      }
    })
    expect(result.book.navigation.chapterPaths).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.at(-1)?.code).toBe('diagnostic-limit')
  })

  it('diagnoses inferred node limits only when a node is omitted', () => {
    const exact = buildBook({
      rootName: 'exact',
      files: [{ path: 'one.md', content: '# One' }],
      limits: { maxNodes: 1 }
    })
    expect(exact.diagnostics.some((item) => item.code === 'build-node-limit')).toBe(false)

    const overflow = buildBook({
      rootName: 'overflow',
      files: [
        { path: 'one.md', content: '# One' },
        { path: 'two.md', content: '# Two' }
      ],
      limits: { maxNodes: 1 }
    })
    expect(overflow.book.navigation.chapterPaths).toEqual(['one.md'])
    expect(overflow.diagnostics.some((item) => item.code === 'build-node-limit')).toBe(true)
  })

  it('uses safe defaults for NaN and Infinity build limits and honors fence length for H1', () => {
    const result = buildBook({
      rootName: 'safe',
      files: [
        {
          path: 'README.md',
          content: '````\n# Hidden\n```\n# Still hidden\n````\n# Visible'
        }
      ],
      limits: { maxFiles: Number.NaN, maxNodes: Number.POSITIVE_INFINITY }
    })
    expect(result.book.metadata.title).toBe('Visible')
  })

  it('does not count root landing or either SUMMARY candidate as orphans', () => {
    const result = buildBook({
      rootName: 'special',
      files: [
        { path: 'README.md', content: '# Home' },
        { path: 'SUMMARY.md', content: '- [One](one.md)' },
        { path: 'SUMMARY.markdown', content: '- [Other](other.md)' },
        { path: 'one.md', content: '# One' }
      ]
    })
    expect(result.book.navigation.summaryPath).toBe('SUMMARY.md')
    expect(result.diagnostics.some((item) => item.code === 'orphaned-chapters')).toBe(false)
  })

  it('falls back to README when SUMMARY has no valid local page', () => {
    const result = buildBook({
      rootName: 'fallback',
      files: [
        { path: 'SUMMARY.md', content: '- [Website](https://example.com)' },
        { path: 'README.md', content: '# Welcome' }
      ]
    })
    expect(result.book.navigation.entryPath).toBe('README.md')
    expect(result.book.metadata).toEqual({
      title: 'Welcome',
      titleSource: 'document-h1'
    })
  })

  it('infers a deterministic tree and represents directory README as its landing page once', () => {
    const result = buildBook({
      rootName: 'fallback-title',
      files: [
        { path: 'zeta.md', content: 'No heading' },
        { path: 'Alpha.md', content: '# Alpha H1' },
        { path: 'guide/topic2.md', content: '# Topic 2' },
        { path: 'guide/topic10.md', content: '# Topic 10' },
        { path: 'guide/README.md', content: '# Guide Home' },
        { path: 'README.md', content: '# Root Home' }
      ]
    })

    expect(result.book.navigation.source).toBe('inferred')
    expect(result.book.navigation.entryPath).toBe('README.md')
    expect(result.book.navigation.landingPath).toBe('README.md')
    expect(result.book.metadata.title).toBe('Root Home')

    const guide = result.book.navigation.nodes[0]
    expect(guide).toMatchObject({
      type: 'group',
      title: 'Guide Home',
      landingPath: 'guide/README.md'
    })
    expect(guide.children.map((node) => node.title)).toEqual(['Topic 2', 'Topic 10'])
    expect(
      flatten(result.book.navigation.nodes).filter((node) => node.title === 'Guide Home')
    ).toHaveLength(1)
    expect(result.book.navigation.nodes.slice(1).map((node) => node.title)).toEqual([
      'Alpha H1',
      'zeta'
    ])
  })

  it('uses exact README/index names first, then deterministic case-insensitive matches', () => {
    const exact = buildBook({
      rootName: 'case',
      files: [
        { path: 'readme.md', content: '# Lower' },
        { path: 'README.md', content: '# Exact' }
      ]
    })
    expect(exact.book.navigation.landingPath).toBe('README.md')

    const insensitive = buildBook({
      rootName: 'case',
      files: [
        { path: 'ReadMe.md', content: '# Mixed' },
        { path: 'INDEX.MD', content: '# Index' }
      ]
    })
    expect(insensitive.book.navigation.landingPath).toBe('ReadMe.md')
  })
})

describe('filesystem book scanning', () => {
  it.each([
    ['relative/path', 'relative/path'],
    ['', ''],
    [null, '']
  ])('rejects invalid root input %s without throwing or leaking it', async (rootValue, leaked) => {
    const result = await loadBookFromDirectory(rootValue as string)
    expect(result.book.metadata.title).toBe('Untitled Book')
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'scan-root-error', severity: 'error' })
    ])
    if (leaked) expect(JSON.stringify(result)).not.toContain(leaked)
  })

  it('uses a root error for an unreadable root while keeping item read errors warnings', async () => {
    const missingRoot = path.join(os.tmpdir(), `leafbook-missing-${Date.now()}`)
    const missing = await loadBookFromDirectory(missingRoot)
    expect(missing.diagnostics).toEqual([
      expect.objectContaining({ code: 'scan-root-error', severity: 'error' })
    ])

    const root = await createBookDirectory({ 'one.md': '# One' })
    const itemFailure = await loadBookFromDirectory(
      root,
      {},
      {
        async beforeRead() {
          throw new Error('simulated read failure')
        }
      }
    )
    expect(itemFailure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'scan-read-error', severity: 'warning' })
      ])
    )
    expect(itemFailure.diagnostics.some((item) => item.code === 'scan-root-error')).toBe(false)
  })

  it('ignores built-in and configured directories', async () => {
    const root = await createBookDirectory({
      'README.md': '# Home',
      '.hidden/secret.md': '# Hidden',
      'node_modules/pkg/readme.md': '# Dependency',
      'drafts/draft.md': '# Draft',
      'published/one.md': '# One'
    })

    const result = await loadBookFromDirectory(root, { exclude: ['drafts/**'] })
    expect(result.book.navigation.chapterPaths).toEqual(['published/one.md'])
    expect(result.book.navigation.landingPath).toBe('README.md')
  })

  it('rejects symlinks that escape the real book root', async () => {
    const root = await createBookDirectory({ 'README.md': '# Home' })
    const outside = await createBookDirectory({ 'secret.md': '# Secret' }, 'leafbook-outside-')
    await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'escape.md'))

    const result = await loadBookFromDirectory(root)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'symlink-escape' })])
    )
    expect(result.book.navigation.chapterPaths).not.toContain('escape.md')
  })

  it('never traverses a directory symlink alias', async () => {
    const root = await createBookDirectory({ 'guide/one.md': '# One' })
    await fs.symlink(root, path.join(root, 'guide', 'loop'))

    const result = await loadBookFromDirectory(root)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'symlink-directory' })])
    )
    expect(result.book.navigation.chapterPaths).toContain('guide/one.md')
    expect(
      result.book.navigation.chapterPaths.filter((item) => item === 'guide/one.md')
    ).toHaveLength(1)
  })

  it('loads SUMMARY independently even when the ordinary file cap stops immediately', async () => {
    const root = await createBookDirectory({
      'SUMMARY.md': '- [One](one.md)',
      'one.md': '# One',
      'two.md': '# Two'
    })
    const result = await loadBookFromDirectory(root, { maxFiles: 1 })
    expect(result.book.navigation.source).toBe('summary')
    expect(result.book.navigation.summaryPath).toBe('SUMMARY.md')
    expect(result.book.navigation.chapterPaths).toEqual(['one.md'])
    expect(result.diagnostics.some((item) => item.code === 'scan-file-limit')).toBe(true)
  })

  it('stops opening ordinary files as soon as maxFiles is reached', async () => {
    const root = await createBookDirectory({
      'a.md': '# A',
      'b.md': '# B',
      'c.md': '# C'
    })
    let opens = 0
    const result = await loadBookFromDirectory(
      root,
      { maxFiles: 1 },
      {
        async afterOpen() {
          opens++
        }
      }
    )
    expect(opens).toBe(1)
    expect(result.book.navigation.chapterPaths).toEqual(['a.md'])
  })

  it('diagnoses the file cap only after observing another Markdown candidate', async () => {
    const exactRoot = await createBookDirectory({ 'one.md': '# One' })
    const exact = await loadBookFromDirectory(exactRoot, { maxFiles: 1 })
    expect(exact.book.navigation.chapterPaths).toEqual(['one.md'])
    expect(exact.diagnostics.some((item) => item.code === 'scan-file-limit')).toBe(false)

    const overflowRoot = await createBookDirectory({
      'one.md': '# One',
      'notes.txt': 'ignored',
      'two.md': '# Two'
    })
    const overflow = await loadBookFromDirectory(overflowRoot, {
      maxFiles: 1,
      maxEntries: 10,
      maxDirectories: 10
    })
    expect(overflow.book.navigation.chapterPaths).toEqual(['one.md'])
    expect(overflow.diagnostics.some((item) => item.code === 'scan-file-limit')).toBe(true)
  })

  it('applies entry, directory, file, total, summary byte, and diagnostic caps', async () => {
    const root = await createBookDirectory({
      'SUMMARY.md': '- [A](a.md)\n'.repeat(20),
      'a.md': '# A content',
      'b.md': '# B content',
      'dir/c.md': '# C'
    })
    const summaryLimited = await loadBookFromDirectory(root, { maxSummaryBytes: 8 })
    expect(
      summaryLimited.diagnostics.some((item) => item.code === 'scan-summary-bytes-limit')
    ).toBe(true)
    const fileLimited = await loadBookFromDirectory(root, { maxFileBytes: 3 })
    expect(fileLimited.diagnostics.some((item) => item.code === 'scan-file-bytes-limit')).toBe(true)
    const totalLimited = await loadBookFromDirectory(root, { maxTotalBytes: 8 })
    expect(totalLimited.diagnostics.some((item) => item.code === 'scan-total-bytes-limit')).toBe(
      true
    )
    const entryLimited = await loadBookFromDirectory(root, { maxEntries: 1 })
    expect(entryLimited.diagnostics.some((item) => item.code === 'scan-entry-limit')).toBe(true)
    const directoryLimited = await loadBookFromDirectory(root, { maxDirectories: 1 })
    expect(directoryLimited.diagnostics.some((item) => item.code === 'scan-directory-limit')).toBe(
      true
    )
    const diagnosticsLimited = await loadBookFromDirectory(root, {
      maxFileBytes: 1,
      maxDiagnostics: 1
    })
    expect(diagnosticsLimited.diagnostics).toHaveLength(1)
  })

  it('skips an entire oversized directory while retaining independently loaded SUMMARY', async () => {
    const root = await createBookDirectory({
      'SUMMARY.md': '- [A](a.md)',
      'a.md': '# A',
      'b.md': '# B',
      'c.md': '# C'
    })
    let ordinaryOpens = 0
    const result = await loadBookFromDirectory(
      root,
      { maxEntriesPerDirectory: 2, maxEntries: 20 },
      {
        async afterOpen(absolutePath) {
          if (!absolutePath.endsWith(`${path.sep}SUMMARY.md`)) ordinaryOpens++
        }
      }
    )
    expect(ordinaryOpens).toBe(0)
    expect(result.book.navigation.source).toBe('summary')
    expect(result.diagnostics.some((item) => item.code === 'scan-directory-entry-limit')).toBe(true)
  })

  it('caps and precompiles exclude patterns under count and character budgets', async () => {
    const root = await createBookDirectory({
      'a/one.md': '# A',
      'b/two.md': '# B'
    })
    const countLimited = await loadBookFromDirectory(root, {
      exclude: ['a', 'b'],
      maxExcludePatterns: 1
    })
    expect(countLimited.book.navigation.chapterPaths).toEqual(['b/two.md'])
    expect(countLimited.diagnostics.some((item) => item.code === 'scan-exclude-limit')).toBe(true)

    const characterLimited = await loadBookFromDirectory(root, {
      exclude: ['abcd'],
      maxExcludePatternLength: 2,
      maxExcludeTotalCharacters: 2
    })
    expect(characterLimited.diagnostics.some((item) => item.code === 'scan-exclude-limit')).toBe(
      true
    )
  })

  it('falls back safely for NaN/Infinity scan limits', async () => {
    const root = await createBookDirectory({ 'one.md': '# One' })
    const result = await loadBookFromDirectory(root, {
      maxFiles: Number.NaN,
      maxEntries: Number.POSITIVE_INFINITY
    })
    expect(result.book.navigation.chapterPaths).toEqual(['one.md'])
  })

  it('rejects a file replaced after open instead of reading either identity', async () => {
    const root = await createBookDirectory({ 'race.md': '# Original' })
    let replaced = false
    const result = await loadBookFromDirectory(
      root,
      {},
      {
        async afterOpen(absolutePath) {
          if (replaced || !absolutePath.endsWith(`${path.sep}race.md`)) return
          replaced = true
          await fs.rename(absolutePath, `${absolutePath}.old`)
          await fs.writeFile(absolutePath, '# Replacement', 'utf8')
        }
      }
    )
    expect(result.diagnostics.some((item) => item.code === 'scan-identity-mismatch')).toBe(true)
    expect(result.book.navigation.chapterPaths).not.toContain('race.md')
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('reads at most the byte cap plus one when the same inode grows', async () => {
    const root = await createBookDirectory({ 'growth.md': '1234' })
    let grew = false
    const result = await loadBookFromDirectory(
      root,
      { maxFileBytes: 8 },
      {
        async beforeRead(absolutePath) {
          if (grew || !absolutePath.endsWith(`${path.sep}growth.md`)) return
          grew = true
          await fs.appendFile(absolutePath, '5678901234567890')
        }
      }
    )
    expect(grew).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'scan-file-bytes-limit')).toBe(true)
    expect(result.book.navigation.chapterPaths).not.toContain('growth.md')
  })

  it('rejects a same-inode same-length rewrite even when mtime is restored', async () => {
    const root = await createBookDirectory({ 'rewrite.md': 'AAAA' })
    const absolutePath = path.join(root, 'rewrite.md')
    const fixedTime = new Date('2024-01-02T03:04:05.000Z')
    await fs.utimes(absolutePath, fixedTime, fixedTime)
    let rewritten = false

    const result = await loadBookFromDirectory(
      root,
      {},
      {
        async beforeRead(candidatePath) {
          if (rewritten || !candidatePath.endsWith(`${path.sep}rewrite.md`)) return
          rewritten = true
          await fs.writeFile(candidatePath, 'BBBB', 'utf8')
          await fs.utimes(candidatePath, fixedTime, fixedTime)
        }
      }
    )

    expect(rewritten).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'scan-file-changed')).toBe(true)
    expect(result.book.navigation.chapterPaths).not.toContain('rewrite.md')
    expect(JSON.stringify(result)).not.toContain('BBBB')
  })

  it('reports depth and file limits without throwing', async () => {
    const root = await createBookDirectory({
      'one.md': '# One',
      'two.md': '# Two',
      'deep/nested.md': '# Nested'
    })

    const result = await loadBookFromDirectory(root, { maxDepth: 0, maxFiles: 1 })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['scan-depth-limit', 'scan-file-limit'])
    )
    expect(result.book.navigation.chapterPaths).toHaveLength(1)
  })
})
