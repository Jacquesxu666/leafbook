import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { sanitizeBookSvg } from 'main_renderer/book/svgSanitizer'
import {
  BOOK_SVG_MAX_DEPTH,
  BOOK_SVG_MAX_COORDINATE,
  BOOK_SVG_MAX_IDS,
  BOOK_SVG_MAX_PATH_DATA_LENGTH,
  BOOK_SVG_MAX_RAW_BYTES,
  BOOK_SVG_MAX_REFERENCE_CHAIN
} from 'common/book/svgPolicy'

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

const safeSvg = `<svg height="32" width="64" viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="paint" x1="0%" x2="100%" y1="0%" y2="0%">
      <stop offset="0%" stop-color="#fff"/>
      <stop offset="100%" stop-color="#000"/>
    </linearGradient>
  </defs>
  <g transform="translate(1 2)">
    <path d="M0 0 L10 10 Z" fill="url(#paint)"/>
    <circle cx="20" cy="20" fill="#fff" r="4"/>
  </g>
</svg>`

describe('safe local SVG sanitizer', () => {
  it('returns deterministic canonical bytes and trusted dimensions for the audited subset', () => {
    const first = sanitizeBookSvg(bytes(safeSvg))
    const second = sanitizeBookSvg(bytes(safeSvg))
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.width).toBe(64)
    expect(first?.height).toBe(32)
    expect(first?.frameCount).toBe(1)
    expect(first?.decodePixels).toBe(2_048)
    expect(first?.bytes).toEqual(second?.bytes)
    const canonical = new TextDecoder().decode(first?.bytes)
    expect(canonical).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 0 64 32" width="64"><defs><linearGradient id="paint" x1="0%" x2="100%" y1="0%" y2="0%"><stop offset="0%" stop-color="#fff"></stop><stop offset="100%" stop-color="#000"></stop></linearGradient></defs><g transform="translate(1 2)"><path d="M0 0 L10 10 Z" fill="url(#paint)"></path><circle cx="20" cy="20" fill="#fff" r="4"></circle></g></svg>'
    )
  })

  it.each([
    ['doctype', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],
    [
      'entity',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>&amp;</title></svg>'
    ],
    [
      'processing instruction',
      '<?target payload?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    ],
    [
      'foreign namespace',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="urn:evil" width="1" height="1"><x:path/></svg>'
    ],
    [
      'nested namespace reset',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g xmlns="urn:evil"/></svg>'
    ],
    [
      'xml base',
      '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.test/" width="1" height="1"/>'
    ],
    [
      'script',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>'
    ],
    [
      'foreignObject',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><foreignObject/></svg>'
    ],
    [
      'image',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://evil.test/x"/></svg>'
    ],
    ['use', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><use href="#x"/></svg>'],
    [
      'event attribute',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" onload="alert(1)"/>'
    ],
    [
      'style attribute',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path style="fill:url(https://evil.test)"/></svg>'
    ],
    [
      'external href',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><linearGradient href="https://evil.test/x"/></svg>'
    ],
    [
      'protocol-relative href',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><linearGradient href="//evil.test/x"/></svg>'
    ],
    [
      'file href',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><linearGradient href="file:///etc/passwd"/></svg>'
    ],
    [
      'xlink href',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1" height="1"><linearGradient xlink:href="#x"/></svg>'
    ],
    [
      'animation element',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><animate attributeName="x"/></svg>'
    ],
    [
      'data paint',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="url(data:image/png,x)" d="M0 0"/></svg>'
    ],
    [
      'unknown attribute',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path vector-effect="non-scaling-stroke" d="M0 0"/></svg>'
    ],
    [
      'malformed transform',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g transform="translate(1) garbage"/></svg>'
    ],
    [
      'malformed path arity',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M 1"/></svg>'
    ],
    [
      'absolute arc command outside the static subset',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0 A 1 1 0 0 0 3 3"/></svg>'
    ],
    [
      'relative arc command outside the static subset',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0 a 1 1 0 0 0 3 3"/></svg>'
    ],
    [
      'duplicate id',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g id="x"/><g id="x"/></svg>'
    ],
    [
      'dangling fragment',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0" fill="url(#missing)"/></svg>'
    ],
    [
      'reference cycle',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs></svg>'
    ],
    [
      'fractional viewport metadata',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1.5 1"/>'
    ],
    [
      'duplicate attribute',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" width="2" height="1"/>'
    ],
    [
      'CDATA',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title><![CDATA[x]]></title></svg>'
    ],
    ['comment', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!--x--></svg>'],
    [
      'XML declaration',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    ]
  ])('rejects %s', (_name, source) => {
    expect(sanitizeBookSvg(bytes(source))).toBeNull()
  })

  it('rejects byte, depth, and path complexity overflow', () => {
    expect(sanitizeBookSvg(new Uint8Array(BOOK_SVG_MAX_RAW_BYTES + 1))).toBeNull()
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${'<g>'.repeat(BOOK_SVG_MAX_DEPTH)}${'</g>'.repeat(BOOK_SVG_MAX_DEPTH)}</svg>`
        )
      )
    ).toBeNull()
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="${'M0 0 '.repeat(Math.ceil(BOOK_SVG_MAX_PATH_DATA_LENGTH / 5))}"/></svg>`
        )
      )
    ).toBeNull()
  })

  it('rejects fragment-reference chains beyond the audited bound', () => {
    const gradients = Array.from(
      { length: 34 },
      (_, index) => `<linearGradient id="g${index}"${index < 33 ? ` href="#g${index + 1}"` : ''}/>`
    ).join('')
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><defs>${gradients}</defs><path d="M0 0" fill="url(#g0)"/></svg>`
        )
      )
    ).toBeNull()
  })

  it.each([
    ['huge exponent', 'M0 0 L1e308 0'],
    ['bounded-value exponent overflow', 'M0 0 L1e13 0'],
    ['nonzero underflow', 'M0 0 L1e-13 0'],
    ['relative coordinate accumulation', `M${BOOK_SVG_MAX_COORDINATE - 1} 0 l2 0`],
    ['cubic control point overflow', `M0 0 C${BOOK_SVG_MAX_COORDINATE + 1} 0 1 1 2 2`],
    ['quadratic control point overflow', `M0 0 Q0 ${BOOK_SVG_MAX_COORDINATE + 1} 2 2`],
    [
      'reflected smooth cubic control overflow',
      `M0 0 C0 0 ${-BOOK_SVG_MAX_COORDINATE} 0 ${BOOK_SVG_MAX_COORDINATE} 0 S${BOOK_SVG_MAX_COORDINATE} 0 ${BOOK_SVG_MAX_COORDINATE} 0`
    ],
    [
      'reflected smooth quadratic control overflow',
      `M0 0 Q${-BOOK_SVG_MAX_COORDINATE} 0 ${BOOK_SVG_MAX_COORDINATE} 0 T${BOOK_SVG_MAX_COORDINATE} 0`
    ],
    ['unsupported absolute arc command', 'M0 0 A1 1 0 0 0 2 2'],
    ['unsupported relative arc command', 'M0 0 a1 1 0 0 0 2 2']
  ])('rejects semantically unbounded path geometry: %s', (_name, data) => {
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="${data}"/></svg>`
        )
      )
    ).toBeNull()
  })

  it('accepts the exact audited coordinate boundary without accumulation', () => {
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M${BOOK_SVG_MAX_COORDINATE} ${-BOOK_SVG_MAX_COORDINATE} L0 0"/></svg>`
        )
      )
    ).not.toBeNull()
  })

  it.each([
    [
      '30-level scale chain',
      `${'<g transform="scale(2)">'.repeat(30)}<rect width="1" height="1"/>${'</g>'.repeat(30)}`
    ],
    [
      'four-level scale/translate chain',
      `${'<g transform="scale(32) translate(32 0)">'.repeat(4)}<rect width="1" height="1"/>${'</g>'.repeat(4)}`
    ],
    [
      'nested cancellation after an excessive intermediate CTM',
      `${'<g transform="scale(4)">'.repeat(15)}${'<g transform="scale(.25)">'.repeat(15)}<rect width="1" height="1"/>${'</g>'.repeat(30)}`
    ]
  ])('rejects effective tree CTM overflow: %s', (_name, body) => {
    expect(
      sanitizeBookSvg(
        bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${body}</svg>`)
      )
    ).toBeNull()
  })

  it('rejects a tiny viewBox whose viewport mapping exceeds the CTM bound', () => {
    expect(
      sanitizeBookSvg(
        bytes(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 .0000001 .0000001"><rect width=".0000001" height=".0000001"/></svg>'
        )
      )
    ).toBeNull()
  })

  it('applies the default viewport mapping before validating transformed geometry', () => {
    expect(
      sanitizeBookSvg(
        bytes(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 20 100 50"><rect x="10" y="20" width="100" height="50"/></svg>'
        )
      )
    ).not.toBeNull()
    expect(
      sanitizeBookSvg(
        bytes(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1 1"><path d="M0 0 C2000 0 0 0 1 1"/></svg>'
        )
      )
    ).toBeNull()
  })

  it('includes inherited stroke width in effective transformed geometry', () => {
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g stroke="#000" stroke-width="${BOOK_SVG_MAX_COORDINATE}"><path d="M${BOOK_SVG_MAX_COORDINATE} 0L${BOOK_SVG_MAX_COORDINATE} 1"/></g></svg>`
        )
      )
    ).toBeNull()
  })

  it.each([
    ['acute path', '<path d="M999997 0L999999 1L999997 2"/>'],
    ['acute polyline', '<polyline points="999997 0 999999 1 999997 2"/>'],
    ['acute polygon', '<polygon points="999997 0 999999 1 999997 2"/>'],
    ['rect corner', '<rect x="999997" y="0" width="2" height="2"/>']
  ])('reserves the default miter limit for inherited stroke geometry: %s', (_name, body) => {
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g stroke="#000" stroke-width="1">${body}</g></svg>`
        )
      )
    ).toBeNull()
  })

  it.each([
    ['viewBox area hidden by 1x1 output', 'width="1" height="1" viewBox="0 0 16384 16384"'],
    ['viewBox origin plus extent', 'width="1" height="1" viewBox="999999 0 2 1"'],
    ['root width overflow', 'width="16385" height="1"'],
    ['viewBox exponent overflow', 'width="1" height="1" viewBox="0 0 1e308 1"'],
    ['transform parameter overflow', 'width="1" height="1"><g transform="translate(1000001 0)"'],
    ['transform scale overflow', 'width="1" height="1"><g transform="scale(1025)"'],
    ['transform skew result overflow', 'width="1" height="1"><g transform="skewX(89.99)"'],
    [
      'transform composition overflow',
      'width="1" height="1"><g transform="scale(1024) scale(1024)"'
    ],
    ['transform matrix overflow', 'width="1" height="1"><g transform="matrix(1025 0 0 1 0 0)"']
  ])('rejects bounded viewport/transform bypass: %s', (_name, attributes) => {
    const needsGroup = attributes.includes('<g')
    expect(
      sanitizeBookSvg(
        bytes(
          needsGroup
            ? `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}></g></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`
        )
      )
    ).toBeNull()
  })

  it.each([
    ['points overflow', '<polyline points="0 0 1e308 1"/>'],
    ['pathLength overflow', '<path d="M0 0L1 1" pathLength="1e308"/>'],
    ['shape coordinate underflow', '<rect x="1e-13" y="0" width="1" height="1"/>'],
    ['radius overflow', '<circle cx="0" cy="0" r="1000001"/>']
  ])('rejects unbounded non-path geometry: %s', (_name, body) => {
    expect(
      sanitizeBookSvg(
        bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${body}</svg>`)
      )
    ).toBeNull()
  })

  it.each([
    ['text', '<text x="0" y="0">unsafe</text>'],
    ['tspan', '<g><tspan x="0" y="0">unsafe</tspan></g>'],
    ['clipPath', '<defs><clipPath id="a"><path d="M0 0"/></clipPath></defs>'],
    ['clip-path attribute', '<path d="M0 0" clip-path="url(#a)"/>']
  ])('rejects unsupported dynamic or coordinate-combining SVG surface: %s', (_name, body) => {
    expect(
      sanitizeBookSvg(
        bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${body}</svg>`)
      )
    ).toBeNull()
  })

  it('uses memoized longest depth for reordered and merged-tail DAGs', () => {
    const tail = Array.from(
      { length: BOOK_SVG_MAX_REFERENCE_CHAIN },
      (_, index) =>
        `<linearGradient id="t${index}"${index + 1 < BOOK_SVG_MAX_REFERENCE_CHAIN ? ` href="#t${index + 1}"` : ''}/>`
    ).join('')
    for (const gradients of [
      `${tail}<linearGradient id="source" href="#t0"/>`,
      `<linearGradient id="source" href="#t0"/>${tail}`,
      `${tail}<linearGradient id="short" href="#t30"/><linearGradient id="source" href="#t0"/>`
    ]) {
      expect(
        sanitizeBookSvg(
          bytes(
            `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><defs>${gradients}</defs></svg>`
          )
        )
      ).toBeNull()
    }
  })

  it('accepts a typed acyclic reference chain exactly at the bound', () => {
    const gradients = Array.from(
      { length: BOOK_SVG_MAX_REFERENCE_CHAIN },
      (_, index) =>
        `<linearGradient id="g${index}"${index + 1 < BOOK_SVG_MAX_REFERENCE_CHAIN ? ` href="#g${index + 1}"` : ''}/>`
    ).join('')
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><defs>${gradients}</defs><path d="M0 0" fill="url(#g0)"/></svg>`
        )
      )
    ).not.toBeNull()
  })

  it.each([41, BOOK_SVG_MAX_IDS])('rejects an over-depth %i-node reference chain', (count) => {
    const gradients = Array.from(
      { length: count },
      (_, index) =>
        `<linearGradient id="g${index}"${index + 1 < count ? ` href="#g${index + 1}"` : ''}/>`
    ).join('')
    expect(
      sanitizeBookSvg(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><defs>${gradients}</defs></svg>`
        )
      )
    ).toBeNull()
  })

  it('canonicalizes to the same hash in child processes under different locales', () => {
    const sanitizerSource = fs.readFileSync(path.resolve('src/main/book/svgSanitizer.ts'), 'utf8')
    expect(sanitizerSource).not.toContain('localeCompare')
    const hashes = ['C', 'en_US.UTF-8', 'tr_TR.UTF-8', 'lt_LT.UTF-8', 'lv_LV.UTF-8'].map(
      (locale) => {
        const child = spawnSync('pnpm', ['exec', 'tsx', 'scripts/svg-canonical-probe.ts'], {
          cwd: process.cwd(),
          env: { ...process.env, LANG: locale, LC_ALL: locale },
          encoding: 'utf8'
        })
        expect(child.status, child.stderr).toBe(0)
        expect(child.stdout).toMatch(/^[0-9a-f]{64}\n$/u)
        return child.stdout
      }
    )
    expect(new Set(hashes).size).toBe(1)
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}\n$/u)
  }, 30_000)
})
