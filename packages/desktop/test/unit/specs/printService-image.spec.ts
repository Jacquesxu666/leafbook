import { describe, it, expect, vi } from 'vitest'

// `resolveLocalImageSrc` reads `window.DIRNAME` + `window.path.resolve` for the
// relative-resolve branch. Stub those preload surfaces before the hoisted
// import runs (copied from exportHtml.spec.ts). The function is otherwise a
// pure string transform — no Muya/engine needed.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        join?: (...parts: string[]) => string
        resolve?: (...parts: string[]) => string
      }
      DIRNAME?: string
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    join: (...parts: string[]) => parts.join('/'),
    resolve: (...parts: string[]) =>
      parts
        .join('/')
        .replace(/\/\.\//g, '/')
        .replace(/\/{2,}/g, '/')
  }
  w.window.DIRNAME = '/docs'
})

import { resolveLocalImageSrc } from '@/util/resolveImageSrc'
import MarkdownPrint from '@/services/printService'

// Branch coverage the exportHtml.spec.ts wrapper does NOT exercise (it only
// covers the relative-resolve and http-untouched paths). Driving the exported
// fn directly here pins the absolute / drive / UNC / data: / extensionless /
// already-file:// / https branches (issue 230 / GH#678).
describe('resolveLocalImageSrc — branch coverage', () => {
  it('(a) POSIX absolute image path → file:// (no double slash)', () => {
    expect(resolveLocalImageSrc('/tmp/b.png')).toBe('file:///tmp/b.png')
  })

  it('(b) Windows drive image path → empty-authority file URL', () => {
    expect(resolveLocalImageSrc('C:\\pics\\b.png')).toBe('file:///C:/pics/b.png')
  })

  it.each([
    '\\\\host\\share\\c.png',
    '//host/share/c.png',
    '\\/host/share/c.png',
    '%2F%2Fhost%2Fshare%2Fc.png',
    '%5C%5Chost%5Cshare%5Cc.png',
    'file://host/share/c.png',
    'file://localhost/share/c.png',
    'file://user:password@host/share/c.png',
    'file://[::1]/share/c.png',
    'file:%2F%2Fhost%2Fshare%2Fc.png'
  ])('(c) rejects network-file image source %s', (source) => {
    expect(resolveLocalImageSrc(source)).toBe('')
  })

  it('(d) data: URI is left untouched (no file:// prefix)', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    expect(resolveLocalImageSrc(src)).toBe(src)
  })

  it('(e) extensionless absolute server path is NOT rewritten to file://', () => {
    // No recognised image extension before `?`/end → IMAGE_EXT_REG gate fails,
    // so `/api/image?id=1` must NOT become `file:///api/image…`.
    expect(resolveLocalImageSrc('/api/image?id=1')).toBe('/api/image?id=1')
  })

  it('(f) already-file:// src is left untouched (no file://file://…)', () => {
    expect(resolveLocalImageSrc('file:///docs/a.png')).toBe('file:///docs/a.png')
  })

  it('(g) https URL is left untouched', () => {
    expect(resolveLocalImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('absolute path with a query keeps its extension recognised (POSIX → file://)', () => {
    // `.png` immediately followed by `?` still matches IMAGE_EXT_REG.
    expect(resolveLocalImageSrc('/tmp/b.png?v=2')).toBe('file:///tmp/b.png?v=2')
  })

  it('empty / falsy src is returned as-is', () => {
    expect(resolveLocalImageSrc('')).toBe('')
  })

  it.each([
    '\\\\host\\share\\c.png',
    '//host/share/c.png',
    'file://host/share/c.png',
    'file:%2F%2Fhost%2Fshare%2Fc.png'
  ])('static print creates an inert placeholder before DOM connection for %s', (source) => {
    const printer = new MarkdownPrint()
    printer.renderMarkdown(`<p>before</p><img src="${source}"><p>after</p>`, true)
    const container = document.querySelector('.print-container')
    expect(container?.querySelector('img')).toBeNull()
    expect(container?.querySelector('.leafbook-image-placeholder')?.textContent).toBe(
      '[Image unavailable]'
    )
    expect(container?.innerHTML).not.toContain(source)
    printer.clearup()
  })
})
