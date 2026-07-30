export const BOOK_EXPORT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; navigate-to 'none'"

export const BOOK_EXPORT_STYLE = `
:root{color-scheme:light dark;font-family:ui-serif,Georgia,serif;line-height:1.65}
*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#24221f}
.leafbook-shell{display:grid;grid-template-columns:minmax(15rem,22rem) minmax(0,52rem);gap:3rem;max-width:80rem;margin:auto;padding:2rem}
.leafbook-toc{position:sticky;top:0;max-height:100vh;overflow:auto;padding:1rem 0}
.leafbook-toc ul{list-style:none;padding-left:1rem}.leafbook-toc>ul{padding-left:0}
.leafbook-toc a{color:#34558b;text-decoration:none}.leafbook-toc a:hover{text-decoration:underline}
.leafbook-toc .unavailable{color:#777}.leafbook-book>header{padding:4rem 0 2rem;border-bottom:1px solid #ccc}
.leafbook-chapter{padding:3rem 0;border-bottom:1px solid #ddd}.leafbook-placeholder{padding:1rem;border:1px dashed #999}
.leafbook-media-placeholder,.leafbook-broken-link,.leafbook-external-link{color:#766f64}
pre{overflow:auto;padding:1rem;background:#eee}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.35rem}
@media(max-width:760px){.leafbook-shell{display:block;padding:1rem}.leafbook-toc{position:static;max-height:none}.leafbook-book>header{padding-top:2rem}}
@media(prefers-color-scheme:dark){body{background:#171614;color:#e8e4dc}a,.leafbook-toc a{color:#9dbcf0}pre{background:#282622}}
`.trim()

export const BOOK_EXPORT_MAX_DEPTH = 128
export const BOOK_EXPORT_MAX_TAGS = 200_000
export const BOOK_EXPORT_MAX_ATTRIBUTES = 32
export const BOOK_EXPORT_MAX_TOKEN_LENGTH = 64 * 1024

const ALLOWED_TAGS = new Set([
  'html',
  'head',
  'meta',
  'title',
  'style',
  'body',
  'div',
  'nav',
  'main',
  'header',
  'footer',
  'section',
  'article',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'del',
  's',
  'mark',
  'small',
  'sub',
  'sup',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'kbd',
  'figure',
  'figcaption',
  'abbr',
  'cite',
  'q',
  'time',
  'var',
  'samp'
])
const VOID_TAGS = new Set(['meta', 'br', 'hr'])
const HEAD_TAGS = new Set(['meta', 'title', 'style'])
const SAFE_ATTRS = new Set([
  'class',
  'id',
  'title',
  'role',
  'tabindex',
  'lang',
  'dir',
  'colspan',
  'rowspan',
  'start',
  'reversed',
  'open',
  'datetime',
  'scope'
])
const NAME = /^[a-z][a-z0-9-]*$/i
const ASCII_WHITESPACE = /[ \t\n\f\r]/
const disallowedControl = (character: string): boolean => {
  const code = character.charCodeAt(0)
  return (
    code === 0 ||
    (code >= 1 && code <= 8) ||
    code === 11 ||
    (code >= 14 && code <= 31) ||
    code === 127
  )
}
const hasDisallowedControl = (value: string, start: number, end: number): boolean => {
  for (let index = start; index < end; index++) {
    if (disallowedControl(value[index] as string)) return true
  }
  return false
}
const findTagEnd = (html: string, open: number): number => {
  let quote: '"' | "'" | null = null
  for (let index = open + 1; index < html.length; index++) {
    if (index - open - 1 > BOOK_EXPORT_MAX_TOKEN_LENGTH) return -1
    const character = html[index] as string
    if (disallowedControl(character) || character === '<') return -1
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}
const onlyAsciiWhitespace = (value: string, start = 0, end = value.length): boolean => {
  for (let index = start; index < end; index++) {
    if (!ASCII_WHITESPACE.test(value[index] as string)) return false
  }
  return true
}

/**
 * Strictly tokenize the generated subset instead of asking a regex blacklist
 * to recognize arbitrary HTML. All attributes must be quoted and explicitly
 * allowed; the only URL-bearing attribute is an in-document LeafBook anchor.
 */
export const validateBookExportHtml = (html: string): boolean => {
  if (!html.startsWith('<!doctype html>')) return false
  let index = '<!doctype html>'.length
  let styleCount = 0
  let cspCount = 0
  let charsetCount = 0
  let viewportCount = 0
  let titleCount = 0
  let tagCount = 0
  let inBody = false
  let documentState: 'before-html' | 'in-html' | 'after-head' | 'after-body' = 'before-html'
  const stack: string[] = []
  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open === -1) {
      return (
        !hasDisallowedControl(html, index, html.length) &&
        onlyAsciiWhitespace(html, index) &&
        documentState === 'after-body' &&
        stack.length === 0 &&
        styleCount === 1 &&
        cspCount === 1 &&
        charsetCount === 1 &&
        viewportCount === 1 &&
        titleCount === 1
      )
    }
    if (hasDisallowedControl(html, index, open)) return false
    if (
      stack.length === 0
        ? !onlyAsciiWhitespace(html, index, open)
        : !inBody && stack.at(-1) !== 'title' && !onlyAsciiWhitespace(html, index, open)
    ) {
      return false
    }
    if (html.startsWith('<!--', open) || html.startsWith('<!', open)) return false
    const close = findTagEnd(html, open)
    if (close === -1) return false
    if (close - open - 1 > BOOK_EXPORT_MAX_TOKEN_LENGTH) return false
    tagCount++
    if (tagCount > BOOK_EXPORT_MAX_TAGS) return false
    let token = html.slice(open + 1, close)
    const closing = token.startsWith('/')
    if (closing) token = token.slice(1)
    const selfClosing = token.endsWith('/')
    if (selfClosing) token = token.slice(0, -1)
    let cursor = 0
    while (cursor < token.length && ASCII_WHITESPACE.test(token[cursor] as string)) cursor++
    const nameStart = cursor
    while (cursor < token.length && /[a-z0-9-]/i.test(token[cursor] as string)) cursor++
    const tag = token.slice(nameStart, cursor).toLocaleLowerCase('en-US')
    if (!NAME.test(tag) || !ALLOWED_TAGS.has(tag)) return false
    if (closing) {
      if (!onlyAsciiWhitespace(token, cursor) || VOID_TAGS.has(tag) || stack.pop() !== tag) {
        return false
      }
      if (tag === 'head') documentState = 'after-head'
      if (tag === 'body') {
        inBody = false
        documentState = 'after-body'
      }
      index = close + 1
      continue
    }
    if (selfClosing && !VOID_TAGS.has(tag)) return false
    const parent = stack.at(-1)
    if (tag === 'html') {
      if (documentState !== 'before-html' || parent !== undefined) return false
      documentState = 'in-html'
    } else if (tag === 'head') {
      if (documentState !== 'in-html' || parent !== 'html') return false
    } else if (tag === 'body') {
      if (documentState !== 'after-head' || parent !== 'html') return false
      inBody = true
    } else if (HEAD_TAGS.has(tag)) {
      if (parent !== 'head') return false
    } else if (parent !== 'body' && !stack.includes('body')) {
      return false
    }
    const attributes = new Map<string, string>()
    while (cursor < token.length) {
      while (cursor < token.length && ASCII_WHITESPACE.test(token[cursor] as string)) cursor++
      if (cursor >= token.length) break
      const attributeStart = cursor
      while (cursor < token.length && /[a-z0-9:-]/i.test(token[cursor] as string)) cursor++
      const attribute = token.slice(attributeStart, cursor).toLocaleLowerCase('en-US')
      if (!NAME.test(attribute) || attributes.has(attribute)) return false
      while (cursor < token.length && ASCII_WHITESPACE.test(token[cursor] as string)) cursor++
      if (token[cursor] !== '=') return false
      cursor++
      while (cursor < token.length && ASCII_WHITESPACE.test(token[cursor] as string)) cursor++
      const quote = token[cursor]
      if (quote !== '"' && quote !== "'") return false
      cursor++
      const valueStart = cursor
      while (cursor < token.length && token[cursor] !== quote) cursor++
      if (cursor >= token.length) return false
      const value = token.slice(valueStart, cursor++)
      attributes.set(attribute, value)
      if (attributes.size > BOOK_EXPORT_MAX_ATTRIBUTES) return false
      if (
        !SAFE_ATTRS.has(attribute) &&
        !attribute.startsWith('aria-') &&
        !(tag === 'meta' && ['charset', 'name', 'content', 'http-equiv'].includes(attribute)) &&
        !(tag === 'a' && attribute === 'href')
      ) {
        return false
      }
      if (attribute === 'href' && !/^#leafbook-(?:chapter|heading)-[a-z0-9-]+$/i.test(value)) {
        return false
      }
    }
    if (
      (tag === 'html' && (attributes.size !== 1 || attributes.get('lang') !== 'en')) ||
      ((tag === 'head' || tag === 'body' || tag === 'title' || tag === 'style') &&
        attributes.size !== 0)
    ) {
      return false
    }
    if (tag === 'meta' && attributes.get('http-equiv') === 'Content-Security-Policy') {
      if (attributes.get('content') !== BOOK_EXPORT_CSP) return false
      cspCount++
    } else if (tag === 'meta' && attributes.get('charset') === 'utf-8' && attributes.size === 1) {
      charsetCount++
    } else if (
      tag === 'meta' &&
      attributes.get('name') === 'viewport' &&
      attributes.get('content') === 'width=device-width,initial-scale=1' &&
      attributes.size === 2
    ) {
      viewportCount++
    } else if (tag === 'meta') {
      return false
    }
    if (tag === 'style') {
      const styleEnd = html.indexOf('</style>', close + 1)
      if (styleEnd === -1 || html.slice(close + 1, styleEnd) !== BOOK_EXPORT_STYLE) return false
      styleCount++
      index = styleEnd + '</style>'.length
      continue
    }
    if (tag === 'title') titleCount++
    if (!selfClosing && !VOID_TAGS.has(tag)) {
      if (stack.length >= BOOK_EXPORT_MAX_DEPTH) return false
      stack.push(tag)
    }
    index = close + 1
  }
  return (
    stack.length === 0 &&
    styleCount === 1 &&
    cspCount === 1 &&
    charsetCount === 1 &&
    viewportCount === 1 &&
    titleCount === 1 &&
    documentState === 'after-body'
  )
}
