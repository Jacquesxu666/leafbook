export const BOOK_RASTER_MAX_REFERENCE_LENGTH = 4_096
export const BOOK_RASTER_MAX_REFERENCE_COMPONENTS = 64
export const BOOK_RASTER_MAX_BYTES = 8 * 1024 * 1024
export const BOOK_RASTER_MAX_DIMENSION = 16_384
export const BOOK_RASTER_MAX_PIXELS = 40_000_000
export const BOOK_RASTER_MAX_FRAMES = 256
export const BOOK_RASTER_MAX_DECODE_PIXELS = 80_000_000
export const BOOK_RASTER_MAX_OCCURRENCES = 256
export const BOOK_RASTER_MAX_UNIQUE = 64
export const BOOK_RASTER_GENERATION_MAX_BYTES = 32 * 1024 * 1024
export const BOOK_RASTER_GENERATION_MAX_DECODE_PIXELS = 120_000_000
export const BOOK_RASTER_GENERATION_MAX_FRAMES = 512

export const BOOK_RASTER_EXTENSION_MEDIA_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
} as const)

export type BookRasterMediaType =
  (typeof BOOK_RASTER_EXTENSION_MEDIA_TYPES)[keyof typeof BOOK_RASTER_EXTENSION_MEDIA_TYPES]

export const BOOK_RASTER_MEDIA_TYPES: readonly BookRasterMediaType[] = Object.freeze([
  ...new Set<BookRasterMediaType>(Object.values(BOOK_RASTER_EXTENSION_MEDIA_TYPES))
])

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })

export const bookRasterMediaTypeForReference = (reference: string): BookRasterMediaType | null => {
  const slash = reference.lastIndexOf('/')
  const dot = reference.lastIndexOf('.')
  if (dot <= slash) return null
  const extension = reference.slice(dot).toLocaleLowerCase('en')
  return (
    BOOK_RASTER_EXTENSION_MEDIA_TYPES[
      extension as keyof typeof BOOK_RASTER_EXTENSION_MEDIA_TYPES
    ] ?? null
  )
}

/** Pure local-raster reference policy shared by main and Renderer. */
export const isSupportedBookRasterReference = (reference: unknown): reference is string => {
  if (
    typeof reference !== 'string' ||
    reference.length === 0 ||
    reference.length > BOOK_RASTER_MAX_REFERENCE_LENGTH ||
    reference !== reference.trim() ||
    reference !== reference.normalize('NFC') ||
    containsControlCharacter(reference) ||
    /[\\?#%:]/u.test(reference) ||
    reference.startsWith('/') ||
    reference.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(reference) ||
    bookRasterMediaTypeForReference(reference) === null
  ) {
    return false
  }
  const components = reference.split('/')
  return (
    components.length <= BOOK_RASTER_MAX_REFERENCE_COMPONENTS &&
    components.every((component) => component.length > 0)
  )
}
