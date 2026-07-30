import { describe, expect, it } from 'vitest'
import {
  createBookWebsiteManifest,
  parseBookWebsiteManifest,
  serializeBookWebsiteManifest,
  sha256Bytes
} from 'common/book/websitePolicy'

describe('LeafBook website manifest policy', () => {
  it('generates one canonical index entry without self hash, paths, or timestamps', () => {
    const html = Buffer.from('<!doctype html>', 'utf8')
    const manifest = createBookWebsiteManifest(html)
    expect(manifest).toEqual({
      schemaVersion: 1,
      generator: 'LeafBook',
      files: [{ path: 'index.html', size: html.byteLength, sha256: sha256Bytes(html) }]
    })
    const bytes = Buffer.from(serializeBookWebsiteManifest(manifest), 'utf8')
    expect(parseBookWebsiteManifest(bytes)).toEqual(manifest)
    expect(bytes.toString()).not.toMatch(/manifest|timestamp|created|Users|\\\\|:\//i)
  })

  it('rejects unknown fields, duplicate keys, traversal, self hash, and noncanonical JSON', () => {
    const hash = 'a'.repeat(64)
    const unsafe = [
      `{"schemaVersion":1,"generator":"LeafBook","files":[{"path":"../index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":1,"generator":"LeafBook","files":[{"path":"index.html","size":1,"sha256":"${hash}"},{"path":"leafbook-manifest.json","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":1,"schemaVersion":1,"generator":"LeafBook","files":[{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`,
      `{"schemaVersion":1,"generator":"LeafBook","files":[{"path":"index.html","size":1,"sha256":"${hash}","extra":true}]}\n`,
      `{"generator":"LeafBook","schemaVersion":1,"files":[{"path":"index.html","size":1,"sha256":"${hash}"}]}\n`
    ]
    for (const value of unsafe) {
      expect(parseBookWebsiteManifest(Buffer.from(value))).toBeNull()
    }
  })
})
