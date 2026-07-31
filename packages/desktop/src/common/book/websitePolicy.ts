import { createHash } from 'crypto'
import type { BookWebsiteManifestDto, BookWebsiteManifestFileDto } from '@shared/types/bookReader'

export const BOOK_WEBSITE_INDEX = 'index.html' as const
export const BOOK_WEBSITE_MANIFEST = 'leafbook-manifest.json' as const
export const BOOK_WEBSITE_ASSETS = 'assets' as const
export const BOOK_WEBSITE_MAX_MANIFEST_BYTES = 128 * 1024
export const BOOK_WEBSITE_MAX_FILES = 257
export const BOOK_WEBSITE_MAX_ASSET_BYTES = 8 * 1024 * 1024
export const BOOK_WEBSITE_MAX_TOTAL_ASSET_BYTES = 32 * 1024 * 1024

const SHA256 = /^[a-f0-9]{64}$/
const ASSET_PATH = /^assets\/([a-f0-9]{64})\.(?:gif|jpg|png|svg|webp)$/

export const sha256Bytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export interface BookWebsiteAssetInput {
  path: string
  bytes: Uint8Array
}

export const createBookWebsiteManifest = (
  html: Uint8Array,
  assets: readonly BookWebsiteAssetInput[] = []
): BookWebsiteManifestDto => {
  const files = [
    { path: BOOK_WEBSITE_INDEX, bytes: html },
    ...assets.map((asset) => ({ path: asset.path, bytes: asset.bytes }))
  ]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map(({ path, bytes }) => ({ path, size: bytes.byteLength, sha256: sha256Bytes(bytes) }))
  if (files.some((file) => file.path !== BOOK_WEBSITE_INDEX && !validFile(file))) {
    throw new Error('website-asset-path-hash')
  }
  return { schemaVersion: 2, generator: 'LeafBook', files }
}

export const serializeBookWebsiteManifest = (manifest: BookWebsiteManifestDto): string =>
  `${JSON.stringify(manifest, null, 2)}\n`

const exactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const validFile = (value: unknown): value is BookWebsiteManifestFileDto => {
  if (
    !(
      value &&
      typeof value === 'object' &&
      exactKeys(value, ['path', 'size', 'sha256']) &&
      ((value as BookWebsiteManifestFileDto).path === BOOK_WEBSITE_INDEX ||
        ASSET_PATH.test((value as BookWebsiteManifestFileDto).path)) &&
      Number.isSafeInteger((value as BookWebsiteManifestFileDto).size) &&
      (value as BookWebsiteManifestFileDto).size >= 0 &&
      typeof (value as BookWebsiteManifestFileDto).sha256 === 'string' &&
      SHA256.test((value as BookWebsiteManifestFileDto).sha256)
    )
  ) {
    return false
  }
  const file = value as BookWebsiteManifestFileDto
  if (file.path !== BOOK_WEBSITE_INDEX) {
    const match = ASSET_PATH.exec(file.path)
    if (!match || match[1] !== file.sha256) {
      return false
    }
  }
  return true
}

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
      candidate.schemaVersion !== 2 ||
      candidate.generator !== 'LeafBook' ||
      !Array.isArray(candidate.files)
    ) {
      return null
    }
    const files = candidate.files
    if (
      files.length === 0 ||
      files.length > BOOK_WEBSITE_MAX_FILES ||
      files.some((file) => !validFile(file)) ||
      files.filter((file) => file.path === BOOK_WEBSITE_INDEX).length !== 1 ||
      files.some((file, index) => index > 0 && (files[index - 1]?.path ?? '') >= file.path)
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
