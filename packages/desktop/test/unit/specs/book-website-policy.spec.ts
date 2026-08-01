import { describe, expect, it } from 'vitest'
import {
  createBookWebsiteManifest,
  parseBookWebsiteManifest,
  serializeBookWebsiteManifest,
  sha256Bytes
} from 'common/book/websitePolicy'

describe('LeafBook website manifest policy', () => {
  it('generates a canonical complete manifest with sorted content-addressed assets', () => {
    const html = Buffer.from('<!doctype html>', 'utf8')
    const png = Buffer.from('png')
    const svg = Buffer.from('<svg/>')
    const pngHash = sha256Bytes(png)
    const svgHash = sha256Bytes(svg)
    const manifest = createBookWebsiteManifest(html, [
      { path: `assets/${svgHash}.svg`, bytes: svg },
      { path: `assets/${pngHash}.png`, bytes: png }
    ])
    expect(manifest).toEqual({
      schemaVersion: 2,
      generator: 'LeafBook',
      files: [
        {
          path: `assets/${pngHash}.png`,
          size: png.byteLength,
          sha256: sha256Bytes(png)
        },
        {
          path: `assets/${svgHash}.svg`,
          size: svg.byteLength,
          sha256: sha256Bytes(svg)
        },
        { path: 'index.html', size: html.byteLength, sha256: sha256Bytes(html) }
      ].sort((left, right) => left.path.localeCompare(right.path))
    })
    const bytes = Buffer.from(serializeBookWebsiteManifest(manifest), 'utf8')
    expect(parseBookWebsiteManifest(bytes)).toEqual(manifest)
    expect(bytes.toString()).not.toMatch(/timestamp|created|Users|\\\\|:\//i)
  })

  it('rejects unknown fields, duplicates, traversal, unsupported asset names, and noncanonical JSON', () => {
    const hash = 'a'.repeat(64)
    const unsafe = [
      `{"schemaVersion":2,"generator":"LeafBook","files":[{"path":"../index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":2,"generator":"LeafBook","files":[{"path":"index.html","size":1,"sha256":"${hash}"},{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":2,"generator":"LeafBook","files":[{"path":"assets/${hash}.html","size":1,"sha256":"${hash}"},{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":2,"generator":"LeafBook","files":[{"path":"assets/${'b'.repeat(64)}.png","size":1,"sha256":"${hash}"},{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":2,"schemaVersion":2,"generator":"LeafBook","files":[{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":2,"generator":"LeafBook","files":[{"path":"index.html","size":1,"sha256":"${hash}","extra":true}]}\n`,
      `{"generator":"LeafBook","schemaVersion":2,"files":[{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`
    ]
    for (const value of unsafe) {
      expect(parseBookWebsiteManifest(Buffer.from(value))).toBeNull()
    }
  })
})
