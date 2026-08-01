import { describe, expect, it } from 'vitest'
import {
  applySummaryArrangement,
  parseSummaryDocument,
  serializeSummaryDocument,
  type SummaryDocument
} from 'common/book/summaryDocument'
import { parseBookSummary } from 'common/book/summary'

const bytes = (value: string): Buffer => Buffer.from(value, 'utf8')

const parsed = (value: string): SummaryDocument => {
  const result = parseSummaryDocument(bytes(value))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const serialized = (document: SummaryDocument): string =>
  serializeSummaryDocument(document).toString('utf8')

const listNodes = (document: SummaryDocument) => {
  const values: SummaryDocument['nodes'][number][] = []
  const visit = (nodes: SummaryDocument['nodes']): void => {
    for (const node of nodes) {
      if (node.kind === 'list') values.push(node)
      visit(node.children)
    }
  }
  visit(document.nodes)
  return values
}

describe('lossless SUMMARY documents', () => {
  it('round-trips BOM, per-line EOL, comments, opaque lines, and no final newline byte-for-byte', () => {
    const input = bytes(
      '\uFEFF# Summary\r\n<!-- keep -->\n- [One](one.md)\r\nunsupported\r\n```md\n- hidden\n```'
    )
    const result = parseSummaryDocument(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(serializeSummaryDocument(result.value)).toEqual(input)
    expect(result.value.bom).toBe(true)
  })

  it('records original UTF-8 byte spans independently from UTF-16 string offsets', () => {
    const result = parseSummaryDocument(bytes('- 中文\r\n- B\n'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.source.map(({ rawStart, rawEnd }) => [rawStart, rawEnd])).toEqual([
      [0, 10],
      [10, 14]
    ])
    const [chinese, b] = result.value.nodes
    const moved = applySummaryArrangement(result.value, {
      type: 'move-before',
      nodeId: b.id,
      targetId: chinese.id
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.value.source.map(({ rawStart, rawEnd }) => [rawStart, rawEnd])).toEqual([
      [0, 4],
      [4, 14]
    ])
    const nested = applySummaryArrangement(moved.value, {
      type: 'indent',
      nodeId: chinese.id
    })
    expect(nested.ok).toBe(true)
    if (!nested.ok) return
    expect(nested.value.source.map(({ rawStart, rawEnd }) => [rawStart, rawEnd])).toEqual([
      [0, 4],
      [4, 16]
    ])
  })

  it.each([
    {
      name: 'EOF trivia',
      input: '- A\r\n- B\n\n<!-- EOF -->\r\n',
      expected: '- B\n- A\r\n\n<!-- EOF -->\r\n'
    },
    {
      name: 'trivia before a heading',
      input: '- A\r\n- B\n\n<!-- heading -->\r\n## Next\n- C\n',
      expected: '- B\n- A\r\n\n<!-- heading -->\r\n## Next\n- C\n'
    },
    {
      name: 'trivia before an opaque barrier',
      input: '- A\r\n- B\n\n<!-- opaque -->\r\nunsupported\n- C\n',
      expected: '- B\n- A\r\n\n<!-- opaque -->\r\nunsupported\n- C\n'
    }
  ])('does not attach trailing $name to the preceding subtree', ({ input, expected }) => {
    const document = parsed(input)
    const [a, b] = listNodes(document)
    const moved = applySummaryArrangement(document, {
      type: 'move-after',
      nodeId: a.id,
      targetId: b.id
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(serialized(moved.value)).toBe(expected)
  })

  it('rejects invalid UTF-8, bare CR, oversized input, and unterminated fences', () => {
    expect(parseSummaryDocument(Buffer.from([0xc3, 0x28]))).toMatchObject({
      ok: false,
      error: { code: 'invalid-encoding' }
    })
    expect(parseSummaryDocument(bytes('- One\r- Two'))).toMatchObject({
      ok: false,
      error: { code: 'invalid-encoding' }
    })
    expect(parseSummaryDocument(bytes('12345'), { maxBytes: 4 })).toMatchObject({
      ok: false,
      error: { code: 'limit-exceeded' }
    })
    const fence = parseSummaryDocument(bytes('```\n- [One](one.md)\n'))
    expect(fence).toMatchObject({ ok: true, value: { editable: false } })
  })

  it('reorders complete subtrees while preserving attached comments and every untouched byte', () => {
    const document = parsed(
      '# Summary\r\n<!-- for one -->\n- [One](one.md)\r\n  - [Child](child.md)\n<!-- for two -->\r\n- [Two](two.md)\n'
    )
    const [one, , two] = listNodes(document)
    const result = applySummaryArrangement(document, {
      type: 'move-before',
      nodeId: two.id,
      targetId: one.id
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(serialized(result.value)).toBe(
      '# Summary\r\n<!-- for two -->\r\n- [Two](two.md)\n<!-- for one -->\n- [One](one.md)\r\n  - [Child](child.md)\n'
    )
  })

  it('keeps node identities stable across reorder and supports undo by retaining the old document', () => {
    const original = parsed('- A\n- B\n- C\n')
    const [a, b, c] = original.nodes
    const moved = applySummaryArrangement(original, {
      type: 'move-after',
      nodeId: a.id,
      targetId: c.id
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.value.nodes.map((node) => node.id)).toEqual([b.id, c.id, a.id])
    expect(serialized(original)).toBe('- A\n- B\n- C\n')
  })

  it('indents and outdents an entire subtree without normalizing EOL or markers', () => {
    const document = parsed('* A\r\n+ B\n  - Child\r\n')
    const b = document.nodes[1]
    const indented = applySummaryArrangement(document, { type: 'indent', nodeId: b.id })
    expect(indented.ok).toBe(true)
    if (!indented.ok) return
    expect(serialized(indented.value)).toBe('* A\r\n  + B\n    - Child\r\n')
    const nested = indented.value.nodes[0].children[0]
    const outdented = applySummaryArrangement(indented.value, {
      type: 'outdent',
      nodeId: nested.id
    })
    expect(outdented.ok).toBe(true)
    if (!outdented.ok) return
    expect(serialized(outdented.value)).toBe('* A\r\n+ B\n  - Child\r\n')
  })

  it('rejects cross-heading reorder, non-sibling reorder, and ambiguous mixed indentation', () => {
    const sections = parsed('## A\n- One\n## B\n- Two\n')
    const [sectionOne, sectionTwo] = listNodes(sections)
    expect(
      applySummaryArrangement(sections, {
        type: 'move-before',
        nodeId: sectionTwo.id,
        targetId: sectionOne.id
      })
    ).toMatchObject({ ok: false, error: { code: 'opaque-barrier' } })

    const nested = parsed('- One\n  - Child\n- Two\n')
    expect(
      applySummaryArrangement(nested, {
        type: 'move-after',
        nodeId: nested.nodes[0].children[0].id,
        targetId: nested.nodes[1].id
      })
    ).toMatchObject({ ok: false, error: { code: 'opaque-barrier' } })

    const mixed = parsed('- One\n \t- Child\n- Two\n')
    expect(
      applySummaryArrangement(mixed, {
        type: 'outdent',
        nodeId: mixed.nodes[0].children[0].id
      })
    ).toMatchObject({ ok: false, error: { code: 'indentation-conflict' } })
  })

  it('exposes fixed heading containers and refuses to cross unsupported opaque lines', () => {
    const document = parsed('## Part\n- One\nunsupported\n- Two\n')
    expect(document.nodes[0]).toMatchObject({
      kind: 'heading',
      title: 'Part',
      canIndent: false,
      canOutdent: false,
      children: [
        { kind: 'list', title: 'One' },
        { kind: 'list', title: 'Two' }
      ]
    })
    const [one, two] = listNodes(document)
    expect(
      applySummaryArrangement(document, {
        type: 'move-after',
        nodeId: one.id,
        targetId: two.id
      })
    ).toMatchObject({ ok: false, error: { code: 'opaque-barrier' } })
  })

  it('preserves no-final-newline and rejects moving that EOF line into the document', () => {
    const document = parsed('- One\n- Two')
    const [one, two] = document.nodes
    expect(
      applySummaryArrangement(document, {
        type: 'move-before',
        nodeId: two.id,
        targetId: one.id
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid-operation' } })
    expect(serialized(document)).toBe('- One\n- Two')
  })

  it('enforces node, depth, line, and operation work caps', () => {
    expect(parseSummaryDocument(bytes('- A\n- B\n'), { maxNodes: 1 })).toMatchObject({
      ok: true,
      value: { editable: false }
    })
    expect(parseSummaryDocument(bytes('- A\n- B\n'), { maxLines: 1 })).toMatchObject({
      ok: false,
      error: { code: 'limit-exceeded' }
    })
    const document = parsed('- A\n- B\n')
    const limited = { ...document, operationCount: document.limits.maxOperations }
    expect(
      applySummaryArrangement(limited, {
        type: 'move-before',
        nodeId: document.nodes[1].id,
        targetId: document.nodes[0].id
      })
    ).toMatchObject({ ok: false, error: { code: 'limit-exceeded' } })
  })

  it('rejects an indent that would create a document deeper than the configured limit', () => {
    const result = parseSummaryDocument(bytes('- A\n  - B\n  - C\n'), { maxDepth: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [, , c] = listNodes(result.value)
    expect(applySummaryArrangement(result.value, { type: 'indent', nodeId: c.id })).toMatchObject({
      ok: false,
      error: { code: 'unsafe-document' }
    })
    expect(serialized(result.value)).toBe('- A\n  - B\n  - C\n')
  })

  it.each([
    '- [Valid](valid.md)\n- [Broken](missing\n  - [Child](child.md)\n',
    '- [Valid](valid.md)\n- [Escape](../secret.md)\n  - [Child](child.md)\n'
  ])('uses malformed or unsafe list items as opaque sentinel boundaries', (input) => {
    const document = parsed(input)
    const navigation = parseBookSummary(input)
    const arranged = listNodes(document)
    expect(arranged.map((node) => node.title)).toEqual(['Valid', 'Child'])
    expect(arranged.map((node) => node.depth)).toEqual([0, 0])
    expect(navigation.nodes.map((node) => node.title)).toEqual(['Valid', 'Child'])
    expect(navigation.nodes.map((node) => node.children.length)).toEqual([0, 0])
    expect(
      applySummaryArrangement(document, {
        type: 'move-after',
        nodeId: arranged[0].id,
        targetId: arranged[1].id
      })
    ).toMatchObject({ ok: false, error: { code: 'opaque-barrier' } })
  })

  it('matches navigation semantics for the title H1 and empty headings', () => {
    const input = '# Book title\n## Part\n## ** **\n- One\n'
    const document = parsed(input)
    const navigation = parseBookSummary(input)
    expect(document.nodes.map((node) => node.title)).toEqual(['Part'])
    expect(document.nodes[0].children.map((node) => node.title)).toEqual(['One'])
    expect(navigation.title).toBe('Book title')
    expect(navigation.nodes.map((node) => node.title)).toEqual(['Part'])
    expect(navigation.nodes[0].children.map((node) => node.title)).toEqual(['One'])
  })

  it('matches authoritative heading hierarchy when the first H1 follows an H2', () => {
    const input = '## Prelude\n# Book title\n### Nested\n## Part\n- Chapter\n'
    const document = parsed(input)
    const navigation = parseBookSummary(input)
    const arrangementShape = document.nodes.map((node) => ({
      title: node.title,
      children: node.children.map((child) => ({
        title: child.title,
        children: child.children.map((grandchild) => grandchild.title)
      }))
    }))
    const navigationShape = navigation.nodes.map((node) => ({
      title: node.title,
      children: node.children.map((child) => ({
        title: child.title,
        children: child.children.map((grandchild) => grandchild.title)
      }))
    }))
    expect(navigation.title).toBe('Book title')
    expect(arrangementShape).toEqual([
      { title: 'Prelude', children: [{ title: 'Nested', children: [] }] },
      { title: 'Part', children: [{ title: 'Chapter', children: [] }] }
    ])
    expect(arrangementShape).toEqual(navigationShape)
  })

  it('counts headings and list items together against the public node cap', () => {
    const input = '# Book\n## Part\n- One\n- Two\n'
    const document = parseSummaryDocument(bytes(input), { maxNodes: 2 })
    expect(document).toMatchObject({ ok: true, value: { editable: false } })
    const navigation = parseBookSummary(input, 'SUMMARY.md', { maxNodes: 2 })
    expect(navigation.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'build-node-limit' })])
    )
    expect(navigation.nodes).toHaveLength(1)
    expect(navigation.nodes[0].children).toHaveLength(1)
  })
})
