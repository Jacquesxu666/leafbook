import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  BOOK_IMAGE_EXTENSION_MEDIA_TYPES,
  BOOK_IMAGE_MEDIA_TYPES,
  bookImageMediaTypeForReference,
  isSupportedBookImageReference
} from 'common/book/imagePolicy'
import {
  BOOK_RASTER_GENERATION_MAX_BYTES,
  BOOK_RASTER_GENERATION_MAX_DECODE_PIXELS,
  BOOK_RASTER_GENERATION_MAX_FRAMES,
  BOOK_RASTER_EXTENSION_MEDIA_TYPES,
  BOOK_RASTER_MEDIA_TYPES,
  BOOK_RASTER_MAX_BYTES,
  BOOK_RASTER_MAX_DECODE_PIXELS,
  BOOK_RASTER_MAX_DIMENSION,
  BOOK_RASTER_MAX_FRAMES,
  BOOK_RASTER_MAX_OCCURRENCES,
  BOOK_RASTER_MAX_PIXELS,
  BOOK_RASTER_MAX_UNIQUE,
  bookRasterMediaTypeForReference,
  isSupportedBookRasterReference
} from 'common/book/rasterPolicy'
import { BOOK_SVG_ELEMENTS, BOOK_SVG_GLOBAL_ATTRIBUTES } from 'common/book/svgPolicy'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relativePath: string): string =>
  fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8')

describe('book resource preload and IPC contract', () => {
  it('exposes only the typed opaque resource request through preload', () => {
    const preload = source('src/preload/index.ts')
    const globals = source('src/types/global.d.ts')
    expect(preload).toContain('readResource: (request: BookResourceRequestDto)')
    expect(preload).toContain("invoke('lb::books::read-resource', request)")
    expect(globals).toContain(
      'readResource(request: BookResourceRequestDto): Promise<BookReaderResult<BookResourceDto>>'
    )
    expect(globals).toContain('BookResourceRequestDto')
    expect(globals).toContain('BookResourceDto')
    expect(preload).not.toMatch(/readResource:\s*\([^)]*(?:fullPath|absolutePath|rootPath)/u)
  })

  it('keeps the resource channel typed and editor-gated', () => {
    const contract = source('src/shared/types/ipc.ts')
    const handlers = source('src/main/ipc/books.ts')
    expect(contract).toContain('args: [request: BookResourceRequestDto]')
    expect(contract).toContain('ret: BookReaderResult<BookResourceDto>')
    expect(handlers).toContain("ipcMain.handle('lb::books::read-resource'")
    expect(handlers).toContain('isTrustedEditorSender(event) && boundedResourceRequest(request)')
  })

  it('does not add renderer filesystem or protocol handlers for book resources', () => {
    const preload = source('src/preload/index.ts')
    const handlers = source('src/main/ipc/books.ts')
    expect(preload).not.toContain('fs.readFile')
    expect(handlers).not.toContain("protocol.handle('leafbook-resource'")
    expect(handlers).not.toContain('registerFileProtocol')
  })

  it('bundles the ESM-only Markdown lexer into the CommonJS main process', () => {
    const buildConfig = source('electron.vite.config.ts')
    expect(buildConfig).toMatch(/exclude:\s*\[[^\]]*['"]marked['"][^\]]*\]/u)
  })

  it('shares one pure tokenizer extension contract without main-process renderer imports', () => {
    const extractor = source('src/main/book/resourceReferences.ts')
    const muyaRenderer = fs.readFileSync(
      path.resolve(desktopRoot, '../muya/src/utils/marked/getHighlightHtml.ts'),
      'utf8'
    )
    const contract = fs.readFileSync(
      path.resolve(desktopRoot, '../muya/src/utils/marked/tokenizerContract.ts'),
      'utf8'
    )
    expect(extractor).toContain("from 'leafbook-markdown-tokenizer-contract'")
    expect(muyaRenderer).toContain("from './tokenizerContract'")
    expect(extractor).toContain('leafBookTokenizerContract({ math: true, superSubScript: true })')
    expect(contract).not.toMatch(/(?:from|import)\s*['"].*(?:katex|prism|dompurify)/iu)
    expect(contract).not.toMatch(/\b(?:document|window|DOMParser)\s*[.(]/u)
  })

  it('keeps one pure image policy for main authorization, validation, and Renderer budgets', () => {
    expect({
      bytes: BOOK_RASTER_MAX_BYTES,
      dimension: BOOK_RASTER_MAX_DIMENSION,
      pixels: BOOK_RASTER_MAX_PIXELS,
      frames: BOOK_RASTER_MAX_FRAMES,
      decodePixels: BOOK_RASTER_MAX_DECODE_PIXELS,
      occurrences: BOOK_RASTER_MAX_OCCURRENCES,
      unique: BOOK_RASTER_MAX_UNIQUE,
      generationBytes: BOOK_RASTER_GENERATION_MAX_BYTES,
      generationDecodePixels: BOOK_RASTER_GENERATION_MAX_DECODE_PIXELS,
      generationFrames: BOOK_RASTER_GENERATION_MAX_FRAMES
    }).toEqual({
      bytes: 8 * 1024 * 1024,
      dimension: 16_384,
      pixels: 40_000_000,
      frames: 256,
      decodePixels: 80_000_000,
      occurrences: 256,
      unique: 64,
      generationBytes: 32 * 1024 * 1024,
      generationDecodePixels: 120_000_000,
      generationFrames: 512
    })
    expect(
      ['cover.png', 'cover.JPG', 'cover.jpeg', 'cover.gif', 'cover.webp'].map(
        bookRasterMediaTypeForReference
      )
    ).toEqual(['image/png', 'image/jpeg', 'image/jpeg', 'image/gif', 'image/webp'])
    expect(new Set(BOOK_RASTER_MEDIA_TYPES)).toEqual(
      new Set(Object.values(BOOK_RASTER_EXTENSION_MEDIA_TYPES))
    )
    expect(BOOK_RASTER_MEDIA_TYPES).toEqual([
      ...new Set(Object.values(BOOK_RASTER_EXTENSION_MEDIA_TYPES))
    ])
    expect(isSupportedBookRasterReference('../assets/cover.png')).toBe(true)
    expect(isSupportedBookRasterReference('cover.svg')).toBe(false)
    expect(bookImageMediaTypeForReference('cover.svg')).toBe('image/svg+xml')
    expect(isSupportedBookImageReference('../assets/cover.svg')).toBe(true)
    expect(new Set(BOOK_IMAGE_MEDIA_TYPES)).toEqual(
      new Set(Object.values(BOOK_IMAGE_EXTENSION_MEDIA_TYPES))
    )
    const sharedTypes = source('src/shared/types/bookReader.ts')
    expect(sharedTypes).toContain(
      "import type { BookImageMediaType } from '../../common/book/imagePolicy'"
    )
    expect(sharedTypes).toContain('mediaType: BookImageMediaType')
    expect(sharedTypes).not.toMatch(
      /mediaType:\s*'image\/png'\s*\|\s*'image\/jpeg'\s*\|\s*'image\/gif'\s*\|\s*'image\/webp'/u
    )

    for (const relativePath of [
      'src/main/book/imageContainer.ts',
      'src/main/book/resourceReader.ts',
      'src/main/book/resourceReferences.ts',
      'src/renderer/src/book/renderMarkdown.ts',
      'src/renderer/src/book/hydrateBookImages.ts'
    ]) {
      expect(source(relativePath), relativePath).toMatch(
        /common\/book\/(?:rasterPolicy|imagePolicy)/u
      )
    }
    expect(source('src/main/book/sessionManager.ts')).not.toContain('MAX_RESOURCE_GENERATION_')
    expect(source('src/renderer/src/book/hydrateBookImages.ts')).not.toMatch(
      /(?:MAX_TOTAL_|MAX_IMAGE_|MAX_RESOURCE_BYTES|40_000_000|120_000_000)/u
    )
    expect(source('src/renderer/src/book/hydrateBookImages.ts')).toContain(
      'isValidBookImageResourceMetrics'
    )
    expect(source('src/renderer/src/book/hydrateBookImages.ts')).not.toContain(
      'BOOK_SVG_MAX_CANONICAL_BYTES'
    )
    expect(source('src/main/book/svgSanitizer.ts')).not.toContain('localeCompare')
    expect(source('src/main/book/svgSanitizer.ts')).not.toMatch(
      /\b(?:DOMParser|document|window|innerHTML)\b/u
    )
    expect(BOOK_SVG_ELEMENTS).not.toEqual(expect.arrayContaining(['text', 'tspan', 'clipPath']))
    expect(BOOK_SVG_GLOBAL_ATTRIBUTES).not.toContain('clip-path')
    expect(source('src/renderer/src/book/renderMarkdown.ts')).not.toMatch(
      /MAX_READER_(?:IMAGE_OCCURRENCES|UNIQUE_IMAGES)/u
    )
  })
})
