/* eslint-disable @stylistic/space-before-function-paren */
import { describe, expect, it } from 'vitest'
import { generateBookExportHtml } from '@/book/exportBookHtml'
import {
  BOOK_EXPORT_CSP,
  BOOK_EXPORT_MAX_ATTRIBUTES,
  BOOK_EXPORT_MAX_DEPTH,
  BOOK_EXPORT_MAX_IMAGE_SOURCE_LENGTH,
  BOOK_EXPORT_MAX_IMAGE_TEXT_LENGTH,
  BOOK_EXPORT_MAX_IMAGE_TOKEN_LENGTH,
  BOOK_EXPORT_MAX_TAGS,
  BOOK_EXPORT_MAX_TOKEN_LENGTH,
  BOOK_EXPORT_STYLE,
  BOOK_WEBSITE_CSP,
  validateBookExportHtml
} from 'common/book/exportPolicy'
import type { BookExportSnapshotDto } from '@shared/types/bookReader'

const snapshot = (): BookExportSnapshotDto => ({
  exportId: 'export-id-0000000001',
  format: 'html',
  title: '离线书籍 <安全>',
  landingNodeId: null,
  nodes: [
    {
      nodeId: 'node-one-00000001',
      type: 'chapter',
      title: '第一章',
      children: []
    },
    {
      nodeId: 'node-one-alias-01',
      type: 'chapter',
      title: '第一章（别名）',
      children: []
    },
    {
      nodeId: 'node-two-00000002',
      type: 'chapter',
      title: '第二章',
      children: []
    }
  ],
  navigationTargets: {
    'node-one-00000001': { documentId: '1', fragment: null },
    'node-one-alias-01': { documentId: '1', fragment: '重复标题' },
    'node-two-00000002': { documentId: '2', fragment: null }
  },
  documents: [
    {
      documentId: '1',
      nodeIds: ['node-one-00000001', 'node-one-alias-01'],
      title: '第一章',
      markdown:
        '# 重复标题\n\n[去第二个标题](two.md#重复标题)\n\n# 重复标题\n\n<img src=x onerror=alert(1) style="background:url(https://bad)">',
      linkTargets: {
        'two.md#重复标题': { documentId: '2', fragment: '重复标题' }
      },
      resourceTargets: []
    },
    {
      documentId: '2',
      nodeIds: ['node-two-00000002'],
      title: '第二章',
      markdown:
        '# 重复标题\n\n[网络地址](https://example.invalid/x)\n\n![本地图](private.png)\n\n<script>alert(1)</script>',
      linkTargets: {},
      resourceTargets: []
    }
  ]
})

describe('LeafBook single-file HTML export', () => {
  it('binds only main-approved opaque image targets to the matching Markdown slots', async () => {
    const value = snapshot()
    const second = value.documents[1]
    if (!second) throw new Error('The test snapshot is missing its second document.')
    const target = 'data:image/png;base64,iVBORw0KGgo='
    value.documents[1] = { ...second, resourceTargets: [target] }
    const html = await generateBookExportHtml(value)

    expect(
      validateBookExportHtml(html, {
        format: 'html',
        expectedImageSources: [target]
      })
    ).toBe(true)
    expect(validateBookExportHtml(html)).toBe(false)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll(`img[src="${target}"]`)).toHaveLength(1)
    expect(html).not.toContain('private.png')
  })

  it('uses website CSP and accepts only the exact content-addressed asset path', async () => {
    const value = snapshot()
    const second = value.documents[1]
    if (!second) throw new Error('The test snapshot is missing its second document.')
    const target = `assets/${'a'.repeat(64)}.png`
    value.format = 'website'
    value.documents[1] = { ...second, resourceTargets: [target] }
    const html = await generateBookExportHtml(value)

    expect(html).toContain(BOOK_WEBSITE_CSP)
    expect(html).not.toContain(BOOK_EXPORT_CSP)
    expect(
      validateBookExportHtml(html, {
        format: 'website',
        expectedImageSources: [target]
      })
    ).toBe(true)
    expect(
      validateBookExportHtml(html, {
        format: 'website',
        expectedImageSources: [`assets/${'b'.repeat(64)}.png`]
      })
    ).toBe(false)
  })

  it('emits one body per physical document and rewrites only scoped offline links', async () => {
    const html = await generateBookExportHtml(snapshot())
    expect(validateBookExportHtml(html)).toBe(true)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.title).toBe('离线书籍 <安全>')
    expect(document.querySelectorAll('#leafbook-chapter-1')).toHaveLength(1)
    expect(document.querySelectorAll('.leafbook-chapter')).toHaveLength(2)
    expect(document.querySelectorAll('.leafbook-toc a[href="#leafbook-chapter-1"]')).toHaveLength(1)
    expect(document.querySelectorAll('.leafbook-toc a[href^="#leafbook-heading-1-"]')).toHaveLength(
      1
    )
    expect(document.querySelector('a[href="#leafbook-heading-2-1"]')?.textContent).toContain(
      '去第二个标题'
    )
    expect(html).not.toMatch(/\s(?:href|src)=["'](?:https?:|file:|\/)/i)
    expect(html).not.toMatch(/<script|\son[a-z]+=|\sstyle=|data-book-href=/i)
    expect(document.querySelector('.leafbook-external-link')?.textContent).toBe('网络地址')
    expect(document.querySelector('.leafbook-media-placeholder')?.textContent).toContain(
      'Local image unavailable'
    )
  })

  it('renders unavailable documents as disabled navigation without a body', async () => {
    const value = snapshot()
    const unavailable = value.documents[1]
    if (!unavailable) throw new Error('The test snapshot is missing its second document.')
    value.documents[1] = { ...unavailable, markdown: null }
    const html = await generateBookExportHtml(value)
    expect(validateBookExportHtml(html)).toBe(true)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('.leafbook-chapter')).toHaveLength(1)
    expect(document.querySelector('#leafbook-chapter-2')).toBeNull()
    expect(document.querySelector('.leafbook-toc .leafbook-broken-link')?.textContent).toContain(
      'chapter unavailable'
    )
    expect(
      [...document.querySelectorAll('.leafbook-book a')].find((anchor) =>
        anchor.textContent?.includes('去第二个标题')
      )
    ).toBeUndefined()
    expect(
      [...document.querySelectorAll('.leafbook-book .leafbook-broken-link')].find((node) =>
        node.textContent?.includes('去第二个标题')
      )
    ).toBeDefined()
  })

  it('renders an unresolved navigation fragment as unavailable instead of chapter-top', async () => {
    const value = snapshot()
    value.navigationTargets['node-one-alias-01'] = {
      documentId: '1',
      fragment: 'heading-that-does-not-exist'
    }
    const html = await generateBookExportHtml(value)
    expect(validateBookExportHtml(html)).toBe(true)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const item = [...document.querySelectorAll('.leafbook-toc li')].find((candidate) =>
      candidate.textContent?.includes('第一章（别名）')
    )
    expect(item?.querySelector('a')).toBeNull()
    expect(item?.querySelector('.leafbook-broken-link')?.textContent).toContain(
      'section unavailable'
    )
  })

  it('adds one semantic Book home item for a landing body outside SUMMARY', async () => {
    const value = snapshot()
    value.landingNodeId = 'book-home-node-01'
    value.navigationTargets['book-home-node-01'] = { documentId: '1', fragment: null }
    const html = await generateBookExportHtml(value)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const home = [...document.querySelectorAll('.leafbook-toc a')].filter(
      (anchor) => anchor.textContent === 'Book home'
    )
    expect(home).toHaveLength(1)
    expect(home[0]?.getAttribute('href')).toBe('#leafbook-chapter-1')
    expect(document.querySelectorAll('#leafbook-chapter-1')).toHaveLength(1)
  })

  it('uses a group landing as the group label target without duplicating its body', async () => {
    const value = snapshot()
    value.nodes = [
      {
        nodeId: 'group-node-000001',
        type: 'group',
        title: 'Part one',
        landingNodeId: 'group-home-000001',
        children: value.nodes
      }
    ]
    value.navigationTargets['group-home-000001'] = { documentId: '2', fragment: null }
    const html = await generateBookExportHtml(value)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(
      [...document.querySelectorAll('.leafbook-toc a')]
        .find((anchor) => anchor.textContent === 'Part one')
        ?.getAttribute('href')
    ).toBe('#leafbook-chapter-2')
    expect(document.querySelectorAll('#leafbook-chapter-2')).toHaveLength(1)
  })

  it('preserves quoted greater-than text from the generator through strict validation', async () => {
    const value = snapshot()
    const first = value.documents[0]
    if (!first) throw new Error('The test snapshot is missing its first document.')
    value.documents[0] = {
      ...first,
      markdown: `${first.markdown}\n\n<abbr title="a > b">quoted comparison</abbr>`
    }
    const html = await generateBookExportHtml(value)
    expect(html).toContain('title="a > b"')
    expect(validateBookExportHtml(html)).toBe(true)
  })

  it('rejects active tags, unquoted URLs, meta refresh, foreign namespaces and altered CSS', () => {
    const safe = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>Safe</title><style>${BOOK_EXPORT_STYLE}</style></head><body><main><a href="#leafbook-chapter-1">One</a></main></body></html>`
    expect(validateBookExportHtml(safe)).toBe(true)
    for (const unsafe of [
      safe.replace('<main>', '<main><script>1</script>'),
      safe.replace('<main>', '<main><img src=https://bad>'),
      safe.replace('<main>', '<main><meta http-equiv="refresh" content="0;url=https://bad">'),
      safe.replace('<main>', '<main><svg><foreignObject></foreignObject></svg>'),
      safe.replace(BOOK_EXPORT_STYLE, `${BOOK_EXPORT_STYLE}a{background:url(https://bad)}`),
      safe.replace('#leafbook-chapter-1', 'file:///Users/private/book.md'),
      safe.replace('<head>', '<head></head><head>'),
      safe.replace('</head><body>', '<body></body></head><body>'),
      safe.replace('<meta http-equiv=', '</head><body><meta http-equiv='),
      safe.replace('<style>', '</head><body><style>'),
      safe.replace('<main>', '<main/>'),
      safe.replace('<main>', '<main\u00a0class="bad">'),
      safe.replace('</body>', '</body><div></div>')
    ]) {
      expect(validateBookExportHtml(unsafe)).toBe(false)
    }
  })

  it('rejects bounded structural complexity without recursive or body-stack scans', () => {
    const shell = (body: string): string =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>Safe</title><style>${BOOK_EXPORT_STYLE}</style></head><body>${body}</body></html>`
    const excessiveDepth = `${'<div>'.repeat(BOOK_EXPORT_MAX_DEPTH)}</div>${'</div>'.repeat(
      BOOK_EXPORT_MAX_DEPTH - 1
    )}`
    const excessiveTags = '<br>'.repeat(BOOK_EXPORT_MAX_TAGS + 1)
    const excessiveAttributes = `<div ${Array.from(
      { length: BOOK_EXPORT_MAX_ATTRIBUTES + 1 },
      (_, index) => `aria-x${index}="x"`
    ).join(' ')}></div>`
    const excessiveToken = `<div title="${'x'.repeat(BOOK_EXPORT_MAX_TOKEN_LENGTH)}"></div>`
    for (const unsafe of [
      shell(excessiveDepth),
      shell(excessiveTags),
      shell(excessiveAttributes),
      shell(excessiveToken)
    ]) {
      expect(validateBookExportHtml(unsafe)).toBe(false)
    }
  })

  it('permits only a bounded large img token and enforces exact image count, order, and source', () => {
    const shell = (body: string): string =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>Safe</title><style>${BOOK_EXPORT_STYLE}</style></head><body>${body}</body></html>`
    const first = `data:image/png;base64,${'A'.repeat(100 * 1024)}`
    const second = `data:image/png;base64,${'B'.repeat(
      BOOK_EXPORT_MAX_IMAGE_SOURCE_LENGTH - 'data:image/png;base64,'.length
    )}`
    const boundaryText = 'x'.repeat(BOOK_EXPORT_MAX_IMAGE_TEXT_LENGTH)
    const safe = shell(
      `<img src="${first}" alt="one"><img src="${second}" alt="${boundaryText}" title="${boundaryText}">`
    )
    expect(BOOK_EXPORT_MAX_IMAGE_TOKEN_LENGTH).toBeGreaterThan(
      BOOK_EXPORT_MAX_IMAGE_SOURCE_LENGTH + BOOK_EXPORT_MAX_IMAGE_TEXT_LENGTH * 2
    )
    expect(validateBookExportHtml(safe, { expectedImageSources: [first, second] })).toBe(true)
    expect(validateBookExportHtml(safe, { expectedImageSources: [second, first] })).toBe(false)
    expect(validateBookExportHtml(safe, { expectedImageSources: [first] })).toBe(false)
    expect(validateBookExportHtml(safe, { expectedImageSources: [first, first] })).toBe(false)
    const over = `${second}C`
    expect(
      validateBookExportHtml(shell(`<img src="${over}" alt="over">`), {
        expectedImageSources: [over]
      })
    ).toBe(false)
    expect(
      validateBookExportHtml(
        shell(`<img src="${first}" alt="${boundaryText}x" title="boundary">`),
        { expectedImageSources: [first] }
      )
    ).toBe(false)
    expect(
      validateBookExportHtml(
        shell(`<img src="${first}" alt="boundary" title="${boundaryText}x">`),
        { expectedImageSources: [first] }
      )
    ).toBe(false)
    expect(validateBookExportHtml(shell(`<div title="${'x'.repeat(100 * 1024)}"></div>`))).toBe(
      false
    )
  })

  it('validates only managed supported-resource placeholders in the exact mixed sequence', () => {
    const shell = (body: string): string =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>Safe</title><style>${BOOK_EXPORT_STYLE}</style></head><body>${body}</body></html>`
    const source = `data:image/png;base64,${'A'.repeat(32)}`
    const managed =
      '<span class="leafbook-media-placeholder" data-leafbook-export-placeholder="image-0">missing</span>'
    const unrelated = '<span class="leafbook-media-placeholder">unsupported raw image</span>'
    const html = shell(`${managed}${managed}${unrelated}<img src="${source}" alt="safe">`)
    expect(
      validateBookExportHtml(html, {
        expectedResourceSequence: ['placeholder:image-0', 'placeholder:image-0', source]
      })
    ).toBe(true)
    expect(
      validateBookExportHtml(html, {
        expectedResourceSequence: ['placeholder:image-0', source, 'placeholder:image-0']
      })
    ).toBe(false)
  })

  it('fails closed on deterministic DOM-repair differential mutations', () => {
    const safe = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>Safe</title><style>${BOOK_EXPORT_STYLE}</style></head><body><main><p>Text</p></main></body></html>`
    const mutations = [
      safe.replace('<head>', '<body><head>'),
      safe.replace('</head>', '</head></body><body>'),
      safe.replace('<main>', '<html lang="en"><main>'),
      safe.replace('</main>', '</main></html>'),
      safe.replace('<p>', '<p/><p>'),
      safe.replace('<body>', '<body><meta charset="utf-8">'),
      safe.replace('<main>', '<main\u00a0class="x">'),
      safe.replace('</body>', '</body><body></body>')
    ]
    for (const mutation of mutations) {
      const parsed = new DOMParser().parseFromString(mutation, 'text/html')
      expect(parsed.documentElement.tagName).toBe('HTML')
      expect(validateBookExportHtml(mutation)).toBe(false)
    }
  })

  it('tracks both attribute quote styles and rejects unterminated or controlled tokens', () => {
    const shell = (main: string): string =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>Safe</title><style>${BOOK_EXPORT_STYLE}</style></head><body>${main}</body></html>`
    expect(validateBookExportHtml(shell('<main title="a > b">Text</main>'))).toBe(true)
    expect(validateBookExportHtml(shell("<main title='a > b'>Text</main>"))).toBe(true)
    expect(validateBookExportHtml(shell('<main title="a &gt; b">Text</main>'))).toBe(true)
    for (const unsafe of [
      shell('<main title="unterminated >Text</main>'),
      shell("<main title='unterminated >Text</main>"),
      shell('<main title="nul\u0000value">Text</main>'),
      shell('<main title="control\u0001value">Text</main>'),
      shell('<main>body\u0000text</main>')
    ]) {
      expect(validateBookExportHtml(unsafe)).toBe(false)
    }
  })
})
