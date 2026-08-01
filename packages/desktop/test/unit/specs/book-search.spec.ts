import { describe, expect, it } from 'vitest'
/* eslint-disable @stylistic/space-before-function-paren */

import {
  createBookSearchDocument,
  createBookSearchDocumentAsync,
  matchBookSearchDocumentAsync,
  parseBookSearchQuery,
  segmentBookSearchTextForTests,
  searchBookDocuments
} from 'common/book/search'

const makeDocument = (
  markdown: string,
  overrides: Partial<Parameters<typeof createBookSearchDocument>[0]> = {}
) =>
  createBookSearchDocument({
    nodeId: 'node-1',
    title: 'Introduction',
    breadcrumbs: ['Guide', 'Introduction'],
    filename: 'README.md',
    aliases: [],
    markdown,
    order: 0,
    ...overrides
  })

describe('book search query contract', () => {
  it('normalizes Unicode and case while enforcing the public query limits', () => {
    expect(parseBookSearchQuery('  ＬＥＡＦ book  ')).toEqual({
      raw: 'ＬＥＡＦ book',
      normalized: 'leaf book',
      tokens: ['leaf', 'book']
    })
    expect(parseBookSearchQuery('')).toBeNull()
    expect(parseBookSearchQuery(' '.repeat(10))).toBeNull()
    expect(parseBookSearchQuery('x'.repeat(257))).toBeNull()
    expect(parseBookSearchQuery('1 2 3 4 5 6 7 8 9')).toBeNull()
  })

  it('uses literal AND matching for Latin and Chinese tokens', () => {
    const document = makeDocument('# 使用指南\n\nLeafBook 支持全书阅读。')
    expect(searchBookDocuments([document], 'leafbook 阅读', 50)).toHaveLength(1)
    expect(searchBookDocuments([document], 'leafbook 缺失', 50)).toHaveLength(0)
  })
})

describe('bounded book search extraction and results', () => {
  it('indexes filename, title, aliases, headings, body, code and frontmatter tags', () => {
    const document = makeDocument(
      [
        '---',
        'tags: [manual, 快速开始]',
        '---',
        '# Install',
        '',
        'Read the friendly guide.',
        '',
        '```ts',
        'const codeNeedle = true',
        '# fenced-not-a-heading',
        '```'
      ].join('\n'),
      { aliases: ['Setup'], filename: 'getting-started.md' }
    )

    for (const query of [
      'getting-started',
      'introduction',
      'setup',
      'install',
      'friendly',
      'codeneedle',
      '快速开始'
    ]) {
      expect(searchBookDocuments([document], query, 50), query).toHaveLength(1)
    }
    const fenced = searchBookDocuments([document], 'fenced-not-a-heading', 50)
    expect(fenced[0]?.matches[0]?.kind).toBe('code')
    expect(fenced[0]?.matches[0]?.fragment).toBe('Install')
  })

  it('ranks title, metadata, headings, body and code deterministically', () => {
    const documents = [
      makeDocument('```txt\nneedle\n```', { nodeId: 'code', title: 'Code', order: 0 }),
      makeDocument('needle in body', { nodeId: 'body', title: 'Body', order: 1 }),
      makeDocument('# Needle', { nodeId: 'heading', title: 'Heading', order: 2 }),
      makeDocument('nothing', {
        nodeId: 'metadata',
        title: 'Metadata',
        aliases: ['Needle'],
        order: 3
      }),
      makeDocument('nothing', { nodeId: 'title', title: 'Needle', order: 4 })
    ]

    expect(searchBookDocuments(documents, 'needle', 50).map((result) => result.nodeId)).toEqual([
      'title',
      'metadata',
      'heading',
      'body',
      'code'
    ])
  })

  it('returns plain snippets with valid UTF-16 highlight ranges and stable result caps', () => {
    const documents = Array.from({ length: 4 }, (_, order) =>
      makeDocument(`Text <img src=x onerror=alert(1)> 😀LeafBook ${order}`, {
        nodeId: `node-${order}`,
        title: `Chapter ${order}`,
        order
      })
    )
    const results = searchBookDocuments(documents, 'leafbook', 2)

    expect(results.map((result) => result.nodeId)).toEqual(['node-0', 'node-1'])
    const match = results[0]?.matches[0]
    expect(match?.snippet).not.toContain('<img')
    expect(match?.highlights).toHaveLength(1)
    const range = match?.highlights[0]
    expect(range && match?.snippet.slice(range.start, range.end).toLowerCase()).toBe('leafbook')
  })

  it('maps compatibility-normalized matches back to original UTF-16 ranges', () => {
    const result = searchBookDocuments([makeDocument('Emoji 😀 and the ligature ﬃ.')], 'ffi', 50)
    const match = result[0]?.matches[0]
    const range = match?.highlights[0]
    expect(range && match?.snippet.slice(range.start, range.end)).toBe('ﬃ')
  })

  it('normalizes NFC and NFD consistently across every searchable field', () => {
    const nfd = (value: string): string => value.normalize('NFD')
    const document = makeDocument(
      [
        '---',
        `tags: [${nfd('Tagé')}]`,
        '---',
        `# ${nfd('Headingé')}`,
        '',
        nfd('Bodyé'),
        '',
        '```txt',
        nfd('Codeé'),
        '```'
      ].join('\n'),
      {
        title: nfd('Titleé'),
        filename: `${nfd('Fileé')}.md`,
        aliases: [nfd('Aliasé')]
      }
    )

    for (const [query, kind] of [
      ['Titleé', 'title'],
      ['Fileé', 'filename'],
      ['Aliasé', 'title'],
      ['Tagé', 'tag'],
      ['Headingé', 'heading'],
      ['Bodyé', 'body'],
      ['Codeé', 'code']
    ] as const) {
      expect(searchBookDocuments([document], query, 50)[0]?.matches[0]?.kind, query).toBe(kind)
    }
    const accent = searchBookDocuments([document], 'é', 50)[0]?.matches[0]
    const range = accent?.highlights[0]
    expect(range && accent?.snippet.slice(range.start, range.end)).toBe('e\u0301')
  })

  it('matches NFD queries to NFC and preserves Hangul, emoji and combining clusters', () => {
    const family = '👩‍👩‍👧‍👦'
    const document = makeDocument(
      ['Café', 'Hangul 가', `Family ${family}`, 'Marks a\u0301\u0323'].join('\n')
    )
    expect(searchBookDocuments([document], 'Cafe\u0301', 50)).toHaveLength(1)

    for (const [query, original] of [
      ['가', '가'],
      [family, family],
      ['a\u0323\u0301'.normalize('NFC'), 'a\u0301\u0323']
    ]) {
      const match = searchBookDocuments([document], query, 50)[0]?.matches[0]
      const range = match?.highlights[0]
      expect(range && match?.snippet.slice(range.start, range.end), query).toBe(original)
    }
  })

  it('applies non-Turkic case folding across metadata and Markdown fields', () => {
    const document = makeDocument(
      [
        '---',
        'tags: [TAG ΟΣ]',
        '---',
        '# HEADING οσ',
        '',
        'BODY ος',
        '',
        '```txt',
        'CODE ΟΣ',
        '```'
      ].join('\n'),
      {
        title: 'TITLE ΟΣ',
        filename: 'FILE οσ.md',
        aliases: ['ALIAS ος']
      }
    )

    for (const [query, kind] of [
      ['title ος', 'title'],
      ['file ΟΣ', 'filename'],
      ['alias οσ', 'title'],
      ['tag ος', 'tag'],
      ['heading ΟΣ', 'heading'],
      ['body οσ', 'body'],
      ['code ος', 'code']
    ] as const) {
      expect(searchBookDocuments([document], query, 50)[0]?.matches[0]?.kind, query).toBe(kind)
    }
  })

  it('folds sharp s expansions while preserving complete original highlights', () => {
    for (const [source, query, expected] of [
      ['Straße', 'STRASSE', 'Straße'],
      ['STRASSE', 'straße', 'STRASSE'],
      ['ẞ', 'ss', 'ẞ']
    ]) {
      const match = searchBookDocuments([makeDocument(source)], query, 50)[0]?.matches[0]
      const range = match?.highlights[0]
      expect(range && match?.snippet.slice(range.start, range.end), `${source}/${query}`).toBe(
        expected
      )
    }
  })

  it('uses default non-Turkic dotted-I semantics without merging dotless i', () => {
    const neutralMetadata = { title: 'Book', breadcrumbs: ['Book'], filename: 'x.md' }
    const dotted = makeDocument('Dotted İ\nExpanded i\u0307', {
      ...neutralMetadata,
      nodeId: 'dotted'
    })
    const plain = makeDocument('Plain i', { ...neutralMetadata, nodeId: 'plain' })
    const dotless = makeDocument('Dotless ı', { ...neutralMetadata, nodeId: 'dotless' })

    expect(searchBookDocuments([dotted], 'dotted i\u0307', 50)).toHaveLength(1)
    expect(searchBookDocuments([dotted], 'expanded İ', 50)).toHaveLength(1)
    expect(searchBookDocuments([plain], 'ı', 50)).toHaveLength(0)
    expect(searchBookDocuments([dotless], 'i', 50)).toHaveLength(0)
    expect(searchBookDocuments([dotless], 'ı', 50)).toHaveLength(1)
  })

  it('provides a deterministic, surrogate-safe fallback grapheme approximation', () => {
    const cases = [
      ['\r\n', ['\r\n']],
      ['\r\n\u0301', ['\r\n', '\u0301']],
      ['\u0600A', ['\u0600A']],
      ['का', ['का']],
      ['क्ष', ['क्ष']],
      ['e\u0301\u0323', ['e\u0301\u0323']],
      ['가', ['가']],
      ['👩‍👩‍👧‍👦', ['👩‍👩‍👧‍👦']],
      ['🇨🇳🇺🇸', ['🇨🇳', '🇺🇸']]
    ] as const

    for (const [source, expected] of cases) {
      const segments = segmentBookSearchTextForTests(source, null)
      expect(
        segments.map((segment) => segment.text),
        source
      ).toEqual(expected)
      expect(segments.map((segment) => source.slice(segment.start, segment.end)).join('')).toBe(
        source
      )
    }
  })

  it('stops compatibility-heavy sources before normalization can exceed the document budget', () => {
    const startedAt = performance.now()
    const document = makeDocument(`${'ﬃ'.repeat(600_000)}\n${'中文'.repeat(300_000)}`, {
      aliases: Array.from({ length: 160 }, (_, index) => `Alias ${index}`)
    })
    const elapsedMs = performance.now() - startedAt

    expect(document.partial).toBe(true)
    expect(document.estimatedBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    // Diagnostic only: the correctness assertion is the bounded byte estimate,
    // not a machine-dependent wall-clock threshold.
    expect(elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('uses exact NFKC and mapping costs for high-expansion and boundary-heavy units', async () => {
    const budget = 128 * 1024
    const expansion = '\uFDFA'
    const expansionSource = Array.from({ length: 4 }, () => expansion.repeat(4_096)).join('\n')
    const expansionInput = {
      nodeId: 'high-expansion',
      title: 'High expansion',
      breadcrumbs: ['Book'],
      filename: 'high-expansion.md',
      aliases: [],
      markdown: expansionSource,
      order: 0
    }
    const highExpansion = createBookSearchDocument(expansionInput, { maxBytes: budget })
    const boundaryLines = createBookSearchDocument(
      {
        nodeId: 'boundary-lines',
        title: 'Boundary lines',
        breadcrumbs: ['Book'],
        filename: 'boundary-lines.md',
        aliases: [],
        markdown: Array.from({ length: 180 }, (_, index) =>
          index % 3 === 0 ? 'ﬃ'.repeat(1_000) : index % 3 === 1 ? '中文'.repeat(1_000) : 'plain'
        ).join('\n'),
        order: 0
      },
      { maxBytes: budget }
    )

    for (const document of [highExpansion, boundaryLines]) {
      expect(document.estimatedBytes).toBeLessThanOrEqual(budget)
      expect(document.partial).toBe(true)
    }
    const asyncHighExpansion = await createBookSearchDocumentAsync(expansionInput, {
      maxBytes: budget,
      checkpoint: async () => undefined
    })
    expect(asyncHighExpansion.estimatedBytes).toBeLessThanOrEqual(budget)
    expect(asyncHighExpansion.partial).toBe(true)
    expect(asyncHighExpansion).toEqual(highExpansion)
    const foldExpansionInput = {
      ...expansionInput,
      nodeId: 'fold-expansion',
      markdown: 'ß'.repeat(4_096)
    }
    const syncFoldExpansion = createBookSearchDocument(foldExpansionInput, {
      maxBytes: budget
    })
    const asyncFoldExpansion = await createBookSearchDocumentAsync(foldExpansionInput, {
      maxBytes: budget,
      checkpoint: async () => undefined
    })
    expect(syncFoldExpansion.estimatedBytes).toBeLessThanOrEqual(budget)
    expect(syncFoldExpansion.partial).toBe(true)
    expect(asyncFoldExpansion).toEqual(syncFoldExpansion)
    const result = searchBookDocuments([highExpansion], expansion, 50)
    const match = result[0]?.matches[0]
    const range = match?.highlights[0]
    expect(range && match?.snippet.slice(range.start, range.end)).toBe(expansion)
  })

  it('marks frontmatter/tag and unit caps as partial even when no document is omitted', () => {
    const tags = Array.from({ length: 160 }, (_, index) => `tag-${index}`).join(', ')
    const lines = Array.from({ length: 8_200 }, (_, index) => `line ${index}`).join('\n')
    const document = makeDocument(`---\ntags: [${tags}]\n---\n${lines}`)
    expect(document.partial).toBe(true)
  })

  it('can cancel matching inside one large indexed document', async () => {
    const document = makeDocument(
      Array.from({ length: 2_000 }, (_, index) => `body line ${index}`).join('\n')
    )
    const query = parseBookSearchQuery('not-present')
    expect(query).not.toBeNull()
    if (!query) return
    const controller = new AbortController()
    let checkpoints = 0
    await expect(
      matchBookSearchDocumentAsync(document, query, {
        signal: controller.signal,
        checkpoint: async () => {
          checkpoints += 1
          controller.abort()
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(checkpoints).toBe(1)
  })

  it('cancels during actual async extraction before processing the tail', async () => {
    const controller = new AbortController()
    let releaseCheckpoint: (() => void) | undefined
    let notifyCheckpoint: (() => void) | undefined
    const checkpointStarted = new Promise<void>((resolve) => {
      notifyCheckpoint = resolve
    })
    let checkpoints = 0
    const extraction = createBookSearchDocumentAsync(
      {
        nodeId: 'async-cancel',
        title: 'Async cancel',
        breadcrumbs: ['Book'],
        filename: 'cancel.md',
        aliases: [],
        markdown: [
          ...Array.from({ length: 100 }, (_, index) => `prefix line ${index}`),
          `unprocessed-tail-${'\uFDFA'.repeat(4_096)}`
        ].join('\n'),
        order: 0
      },
      {
        signal: controller.signal,
        checkpoint: () => {
          checkpoints += 1
          notifyCheckpoint?.()
          return new Promise<void>((resolve) => {
            releaseCheckpoint = resolve
          })
        }
      }
    )

    await checkpointStarted
    controller.abort()
    releaseCheckpoint?.()
    await expect(extraction).rejects.toMatchObject({ name: 'AbortError' })
    expect(checkpoints).toBe(1)
  })
})
