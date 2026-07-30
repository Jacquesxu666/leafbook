import { createHash } from 'crypto'
import type { BookWebsiteManifestDto, BookWebsiteManifestFileDto } from '@shared/types/bookReader'

export const BOOK_WEBSITE_INDEX = 'index.html' as const
export const BOOK_WEBSITE_MANIFEST = 'leafbook-manifest.json' as const
export const BOOK_WEBSITE_FILES = [BOOK_WEBSITE_INDEX, BOOK_WEBSITE_MANIFEST] as const
export const BOOK_WEBSITE_MAX_MANIFEST_BYTES = 16 * 1024

const SHA256 = /^[a-f0-9]{64}$/

export const sha256Bytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export const createBookWebsiteManifest = (html: Uint8Array): BookWebsiteManifestDto => ({
  schemaVersion: 1,
  generator: 'LeafBook',
  files: [
    {
      path: BOOK_WEBSITE_INDEX,
      size: html.byteLength,
      sha256: sha256Bytes(html)
    }
  ]
})

export const serializeBookWebsiteManifest = (manifest: BookWebsiteManifestDto): string =>
  `${JSON.stringify(manifest, null, 2)}\n`

const exactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const validFile = (value: unknown): value is BookWebsiteManifestFileDto =>
  Boolean(
    value &&
    typeof value === 'object' &&
    exactKeys(value, ['path', 'size', 'sha256']) &&
    (value as BookWebsiteManifestFileDto).path === BOOK_WEBSITE_INDEX &&
    Number.isSafeInteger((value as BookWebsiteManifestFileDto).size) &&
    (value as BookWebsiteManifestFileDto).size >= 0 &&
    typeof (value as BookWebsiteManifestFileDto).sha256 === 'string' &&
    SHA256.test((value as BookWebsiteManifestFileDto).sha256)
  )

export const parseBookWebsiteManifest = (bytes: Uint8Array): BookWebsiteManifestDto | null => {
  if (bytes.byteLength > BOOK_WEBSITE_MAX_MANIFEST_BYTES) return null
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    if (
      !value ||
      typeof value !== 'object' ||
      !exactKeys(value, ['schemaVersion', 'generator', 'files'])
    ) {
      return null
    }
    const candidate = value as Partial<BookWebsiteManifestDto>
    if (
      candidate.schemaVersion !== 1 ||
      candidate.generator !== 'LeafBook' ||
      !Array.isArray(candidate.files) ||
      candidate.files.length !== 1 ||
      !validFile(candidate.files[0])
    ) {
      return null
    }
    const manifest = candidate as BookWebsiteManifestDto
    if (!Buffer.from(bytes).equals(Buffer.from(serializeBookWebsiteManifest(manifest), 'utf8'))) {
      return null
    }
    return manifest
  } catch {
    return null
  }
}
