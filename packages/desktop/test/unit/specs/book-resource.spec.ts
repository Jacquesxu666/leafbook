/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { deflateSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_BOOK_IMAGE_DIMENSION,
  validateBookImageContainer
} from 'main_renderer/book/imageContainer'
import { extractBookImageReferences } from 'main_renderer/book/resourceReferences'
import { MAX_BOOK_RESOURCE_BYTES, readBookResourceFile } from 'main_renderer/book/resourceReader'
import { renderBookMarkdown } from '@/book/renderMarkdown'

const roots: string[] = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/SiiiitDM//Z',
  'base64'
)
const gif = Buffer.from(
  'R0lGODdhAQABAJEAAAAAACgsNP///wAAACH5BAkAAAMALAAAAAABAAEAAAICTAEAOw==',
  'base64'
)
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
const safeSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect id="box" x="0" y="0" width="16" height="8" fill="#123"/></svg>'
)

const testCrc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Buffer<ArrayBufferLike> = Buffer.alloc(0)): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

const makeStaticPng = ({
  width = 1,
  height = 1,
  bitDepth = 8,
  colorType = 6,
  interlace = 0,
  raw = Buffer.from([0, 0, 0, 0, 0]),
  compressed = deflateSync(raw),
  beforeData = [],
  afterData = []
}: {
  width?: number
  height?: number
  bitDepth?: number
  colorType?: number
  interlace?: number
  raw?: Buffer
  compressed?: Buffer
  beforeData?: Buffer[]
  afterData?: Buffer[]
} = {}): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = bitDepth
  header[9] = colorType
  header[12] = interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    ...beforeData,
    pngChunk('IDAT', compressed),
    ...afterData,
    pngChunk('IEND')
  ])
}

const makeRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-resource-'))
  roots.push(root)
  await fs.mkdir(path.join(root, 'chapters'), { recursive: true })
  await fs.mkdir(path.join(root, 'assets'), { recursive: true })
  await fs.writeFile(path.join(root, 'chapters', 'intro.md'), '# Intro')
  return fs.realpath(root)
}

const readResource = async (
  root: string,
  reference: string,
  hooks?: Parameters<typeof readBookResourceFile>[3]
) => {
  const stat = await fs.stat(root, { bigint: true })
  return readBookResourceFile(
    { realPath: root, dev: stat.dev, ino: stat.ino },
    'chapters/intro.md',
    reference,
    hooks
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('book resource reader', () => {
  it('extracts only exact local Markdown image token destinations', () => {
    expect([
      ...extractBookImageReferences(
        [
          '![Inline](images/inline.png)',
          '![Reference][cover]',
          '[cover]: ../assets/cover.jpg',
          '![Remote](https://example.com/tracker.png)',
          '![Data](data:image/png;base64,AA==)',
          '<img src="html-only.gif">',
          '`![Code](code.webp)`'
        ].join('\n\n')
      )
    ]).toEqual(['images/inline.png', '../assets/cover.jpg'])
  })

  it('shares Muya Reader tokenizer semantics for resource authorization', async () => {
    const markdown = [
      '![Inline](images/inline.png)',
      '![Reference][cover]',
      '[cover]: ../assets/cover.jpg',
      '$ ![Inline math](hidden-inline-math.png) $',
      '$$',
      '![Block math](hidden-block-math.gif)',
      '$$',
      '~![Sub](hidden-sub.webp)~',
      '^![Sup](hidden-sup.png)^',
      '`![Code](hidden-code.png)`',
      '```md',
      '![Block code](hidden-block-code.jpg)',
      '```',
      '<img src="hidden-raw.gif">'
    ].join('\n\n')
    const mainReferences = [...extractBookImageReferences(markdown)]
    const readerReferences = (await renderBookMarkdown(markdown)).resources.map(
      ({ reference }) => reference
    )

    expect(mainReferences).toEqual(['images/inline.png', '../assets/cover.jpg'])
    expect(new Set(mainReferences)).toEqual(new Set(readerReferences))
  })

  it('does not let unsupported image occurrences consume the shared 64-reference quota', async () => {
    const markdown = [
      ...Array.from({ length: 256 }, (_, index) =>
        index % 2 === 0
          ? `![Bitmap ${index}](bitmap-${index}.bmp)`
          : `![No ext ${index}](asset-${index})`
      ),
      '![Allowed](allowed.png)'
    ].join('\n\n')
    const mainReferences = [...extractBookImageReferences(markdown)]
    const readerReferences = (await renderBookMarkdown(markdown)).resources.map(
      ({ reference }) => reference
    )

    expect(mainReferences).toEqual(['allowed.png'])
    expect(readerReferences).toEqual(mainReferences)
  })

  it.each([
    ['cover.png', png, 'image/png'],
    ['cover.jpg', jpeg, 'image/jpeg'],
    ['cover.gif', gif, 'image/gif'],
    ['cover.webp', webp, 'image/webp']
  ] as const)(
    'pins and reads an allowed %s without returning a path',
    async (name, bytes, mediaType) => {
      const root = await makeRoot()
      await fs.writeFile(path.join(root, 'assets', name), bytes)

      const result = await readResource(root, `../assets/${name}`)

      expect(result).toMatchObject({ ok: true, mediaType })
      if (!result.ok) return
      expect(Buffer.from(result.bytes)).toEqual(bytes)
      expect(JSON.stringify(result)).not.toContain(root)
    }
  )

  it('returns only canonical sanitized SVG bytes and trusted metadata', async () => {
    const root = await makeRoot()
    await fs.writeFile(path.join(root, 'assets', 'safe.svg'), safeSvg)
    const result = await readResource(root, '../assets/safe.svg')
    expect(result).toMatchObject({
      ok: true,
      mediaType: 'image/svg+xml',
      metadata: { width: 16, height: 8, frameCount: 1, decodePixels: 128 }
    })
    if (!result.ok) return
    const canonical = Buffer.from(result.bytes).toString('utf8')
    expect(canonical).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" height="8" width="16"><rect fill="#123" height="8" id="box" width="16" x="0" y="0"></rect></svg>'
    )
    expect(canonical).not.toBe(safeSvg.toString('utf8'))
  })

  it('rejects malicious SVG content without returning its source bytes', async () => {
    const root = await makeRoot()
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><script>secret-token</script></svg>'
    await fs.writeFile(path.join(root, 'assets', 'malicious.svg'), malicious)
    const result = await readResource(root, '../assets/malicious.svg')
    expect(result).toEqual({ ok: false, reason: 'type-mismatch' })
    expect(JSON.stringify(result)).not.toContain('secret-token')
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('fails closed when an SVG pathname is replaced after its descriptor is pinned', async () => {
    const root = await makeRoot()
    const target = path.join(root, 'assets', 'safe.svg')
    const replacement = path.join(root, 'assets', 'replacement.svg')
    await fs.writeFile(target, safeSvg)
    await fs.writeFile(
      replacement,
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script/></svg>'
    )
    expect(
      await readResource(root, '../assets/safe.svg', {
        afterOpen: async () => fs.rename(replacement, target)
      })
    ).toEqual({ ok: false, reason: 'unsafe-path' })
  })

  it('accepts an explicit current-directory reference', async () => {
    const root = await makeRoot()
    await fs.writeFile(path.join(root, 'chapters', 'inline.png'), png)
    expect(await readResource(root, './inline.png')).toMatchObject({
      ok: true,
      mediaType: 'image/png'
    })
  })

  it.each([
    'https://example.com/image.png',
    'data:image/png;base64,AA==',
    'file:///tmp/image.png',
    '//server/share.png',
    'C:/Windows/system32/logo.png',
    'C:\\Windows\\system32\\logo.png',
    '/etc/passwd.png',
    '../../../outside.png',
    '..%2f..%2foutside.png',
    '%252e%252e%252foutside.png',
    '../assets/cover.png?ignored=.jpg',
    '../assets/cover.png#fragment',
    '..\\assets\\cover.png',
    '../assets/\u0000cover.png',
    '../assets/cafe\u0301.png',
    '../assets/vector.svgz',
    '../assets/page.html',
    '../assets/script.js'
  ])(
    'rejects an unsafe or unsupported reference without path disclosure: %s',
    async (reference) => {
      const root = await makeRoot()
      const result = await readResource(root, reference)
      expect(result).toMatchObject({ ok: false, reason: 'invalid-reference' })
      expect(JSON.stringify(result)).not.toContain(root)
    }
  )

  it('rejects extension and magic mismatches', async () => {
    const root = await makeRoot()
    await fs.writeFile(path.join(root, 'assets', 'renamed.jpg'), png)
    expect(await readResource(root, '../assets/renamed.jpg')).toEqual({
      ok: false,
      reason: 'type-mismatch'
    })
  })

  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/gif', gif],
    ['image/webp', webp]
  ] as const)('rejects truncated and trailing-polyglot %s containers', async (mediaType, bytes) => {
    expect(await validateBookImageContainer(bytes.subarray(0, -1), mediaType)).toBeNull()
    expect(
      await validateBookImageContainer(Buffer.concat([bytes, Buffer.from('<script>')]), mediaType)
    ).toBeNull()
  })

  it('rejects oversized dimension headers before any decode', async () => {
    const gifBomb = Buffer.from(gif)
    gifBomb.writeUInt16LE(MAX_BOOK_IMAGE_DIMENSION + 1, 6)
    expect(await validateBookImageContainer(gifBomb, 'image/gif')).toBeNull()

    const jpegBomb = Buffer.from(jpeg)
    const frame = jpegBomb.indexOf(Buffer.from([0xff, 0xc0]))
    expect(frame).toBeGreaterThan(0)
    jpegBomb.writeUInt16BE(MAX_BOOK_IMAGE_DIMENSION + 1, frame + 7)
    expect(await validateBookImageContainer(jpegBomb, 'image/jpeg')).toBeNull()

    const webpPixelBomb = Buffer.from(webp)
    webpPixelBomb.writeUInt16LE(0x3fff, 26)
    webpPixelBomb.writeUInt16LE(0x3fff, 28)
    expect(await validateBookImageContainer(webpPixelBomb, 'image/webp')).toBeNull()
  })

  it('rejects GIF frame-count bombs before decode', async () => {
    const prefix = gif.subarray(0, 33)
    const frame = gif.subarray(33, 48)
    const frameBomb = Buffer.concat([
      prefix,
      ...Array.from({ length: 257 }, () => frame),
      Buffer.from([0x3b])
    ])
    expect(await validateBookImageContainer(frameBomb, 'image/gif')).toBeNull()
  })

  it('accepts real and generated static PNGs with bounded safe ancillary data', async () => {
    expect(await validateBookImageContainer(png, 'image/png')).toEqual({
      width: 1,
      height: 1,
      frameCount: 1,
      decodePixels: 1
    })
    const generated = makeStaticPng({
      beforeData: [
        pngChunk('gAMA', Buffer.from([0, 0, 177, 143])),
        pngChunk('tEXt', Buffer.from('Author\0LeafBook'))
      ]
    })
    expect(await validateBookImageContainer(generated, 'image/png')).toEqual({
      width: 1,
      height: 1,
      frameCount: 1,
      decodePixels: 1
    })
  })

  it('inflates PNG image data asynchronously off the main event-loop turn', async () => {
    const width = 2048
    const height = 2048
    const rowBytes = width * 4
    const largePng = makeStaticPng({
      width,
      height,
      raw: Buffer.alloc((rowBytes + 1) * height)
    })
    const validation = validateBookImageContainer(largePng, 'image/png')
    const eventLoopAdvancedFirst = await Promise.race([
      validation.then(() => false),
      new Promise<true>((resolve) => setImmediate(() => resolve(true)))
    ])

    expect(eventLoopAdvancedFirst).toBe(true)
    expect(await validation).toEqual({
      width,
      height,
      frameCount: 1,
      decodePixels: width * height
    })
  }, 15_000)

  it.each(['acTL', 'fcTL', 'fdAT'])('rejects APNG %s chunks', async (type) => {
    expect(
      await validateBookImageContainer(
        makeStaticPng({ beforeData: [pngChunk(type, Buffer.alloc(8))] }),
        'image/png'
      )
    ).toBeNull()
  })

  it.each(['iCCP', 'zTXt', 'iTXt'])('rejects compressed PNG metadata chunk %s', async (type) => {
    expect(
      await validateBookImageContainer(
        makeStaticPng({ beforeData: [pngChunk(type, Buffer.from('metadata'))] }),
        'image/png'
      )
    ).toBeNull()
  })

  it('rejects unknown critical PNG chunks, interlace, and oversized ancillary data', async () => {
    expect(
      await validateBookImageContainer(
        makeStaticPng({ beforeData: [pngChunk('ABCD', Buffer.alloc(1))] }),
        'image/png'
      )
    ).toBeNull()
    expect(
      await validateBookImageContainer(makeStaticPng({ interlace: 1 }), 'image/png')
    ).toBeNull()
    expect(
      await validateBookImageContainer(
        makeStaticPng({
          beforeData: [
            pngChunk('tEXt', Buffer.concat([Buffer.from('Key\0'), Buffer.alloc(65_537)]))
          ]
        }),
        'image/png'
      )
    ).toBeNull()
  })

  it('rejects empty, truncated, trailing, and invalid-filter PNG zlib streams', async () => {
    const validCompressed = deflateSync(Buffer.from([0, 0, 0, 0, 0]))
    for (const compressed of [
      Buffer.alloc(0),
      validCompressed.subarray(0, -1),
      Buffer.concat([validCompressed, Buffer.from([0x00])]),
      deflateSync(Buffer.from([5, 0, 0, 0, 0]))
    ]) {
      expect(
        await validateBookImageContainer(makeStaticPng({ compressed }), 'image/png')
      ).toBeNull()
    }
  })

  it('rejects PNG inflate bombs and exact-length mismatches', async () => {
    expect(
      await validateBookImageContainer(
        makeStaticPng({ compressed: deflateSync(Buffer.alloc(1024 * 1024)) }),
        'image/png'
      )
    ).toBeNull()
    expect(
      await validateBookImageContainer(
        makeStaticPng({ compressed: deflateSync(Buffer.from([0, 0, 0, 0])) }),
        'image/png'
      )
    ).toBeNull()
  })

  it('fails closed for a case-ambiguous pathname', async () => {
    const root = await makeRoot()
    await fs.writeFile(path.join(root, 'assets', 'Cover.png'), png)
    const result = await readResource(root, '../assets/cover.png')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it.runIf(process.platform === 'win32')(
    'rejects Windows case aliases without requiring symlink privileges',
    async () => {
      const root = await makeRoot()
      await fs.writeFile(path.join(root, 'assets', 'Cover.png'), png)
      expect(await readResource(root, '../assets/cover.png')).toMatchObject({
        ok: false,
        reason: 'unsafe-path'
      })
    }
  )

  it('rejects resources above the byte budget before allocation', async () => {
    const root = await makeRoot()
    const target = path.join(root, 'assets', 'large.png')
    await fs.writeFile(target, png)
    await fs.truncate(target, MAX_BOOK_RESOURCE_BYTES + 1)
    expect(await readResource(root, '../assets/large.png')).toEqual({
      ok: false,
      reason: 'too-large'
    })
  })

  it.runIf(process.platform !== 'win32')(
    'rejects symlinked resources and symlinked ancestors',
    async () => {
      const root = await makeRoot()
      const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.png`)
      await fs.writeFile(outside, png)
      roots.push(outside)
      await fs.symlink(outside, path.join(root, 'assets', 'linked.png'))
      await fs.symlink(path.dirname(outside), path.join(root, 'linked-assets'))

      expect(await readResource(root, '../assets/linked.png')).toMatchObject({
        ok: false,
        reason: 'unsafe-path'
      })
      expect(await readResource(root, '../linked-assets/outside.png')).toMatchObject({
        ok: false,
        reason: 'unsafe-path'
      })
    }
  )

  it('rejects a hard-linked file even when its directory entry is inside the root', async () => {
    const root = await makeRoot()
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside-hardlink.png`)
    await fs.writeFile(outside, png)
    roots.push(outside)
    await fs.link(outside, path.join(root, 'assets', 'linked.png'))

    expect(await readResource(root, '../assets/linked.png')).toMatchObject({
      ok: false,
      reason: 'unsafe-path'
    })
  })

  it('fails closed when the pathname is replaced after the descriptor is opened', async () => {
    const root = await makeRoot()
    const target = path.join(root, 'assets', 'cover.png')
    const replacement = path.join(root, 'assets', 'replacement.png')
    await fs.writeFile(target, png)
    await fs.writeFile(replacement, png)

    const result = await readResource(root, '../assets/cover.png', {
      afterOpen: async () => fs.rename(replacement, target)
    })

    expect(result).toEqual({ ok: false, reason: 'unsafe-path' })
  })

  it.runIf(process.platform !== 'win32')(
    'fails closed when an ancestor is renamed and replaced by a symlink after open',
    async () => {
      const root = await makeRoot()
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-resource-outside-'))
      roots.push(outside)
      await fs.writeFile(path.join(root, 'assets', 'cover.png'), png)
      await fs.writeFile(path.join(outside, 'cover.png'), png)

      const result = await readResource(root, '../assets/cover.png', {
        afterOpen: async () => {
          await fs.rename(path.join(root, 'assets'), path.join(root, 'assets-original'))
          await fs.symlink(outside, path.join(root, 'assets'))
        }
      })

      expect(result).toEqual({ ok: false, reason: 'unsafe-path' })
    }
  )

  it('fails closed when the pinned inode changes during the read boundary', async () => {
    const root = await makeRoot()
    const target = path.join(root, 'assets', 'cover.png')
    await fs.writeFile(target, png)

    const result = await readResource(root, '../assets/cover.png', {
      beforeRead: async () => fs.writeFile(target, Buffer.concat([png, Buffer.from([0x01])]))
    })

    expect(result).toEqual({ ok: false, reason: 'unsafe-path' })
  })

  it('fails closed on same-size mutation after open and before descriptor validation', async () => {
    const root = await makeRoot()
    const target = path.join(root, 'assets', 'cover.png')
    await fs.writeFile(target, png)

    const result = await readResource(root, '../assets/cover.png', {
      afterOpen: async () => {
        const mutated = Buffer.from(png)
        mutated[mutated.length - 10] = (mutated[mutated.length - 10] ?? 0) ^ 0x01
        await fs.writeFile(target, mutated)
      }
    })

    expect(result).toEqual({ ok: false, reason: 'unsafe-path' })
  })
})
