import {
  BOOK_RASTER_MAX_BYTES,
  BOOK_RASTER_MAX_DECODE_PIXELS,
  BOOK_RASTER_MAX_DIMENSION,
  BOOK_RASTER_MAX_FRAMES,
  BOOK_RASTER_MAX_PIXELS,
  BOOK_RASTER_EXTENSION_MEDIA_TYPES,
  BOOK_RASTER_GENERATION_MAX_BYTES,
  BOOK_RASTER_GENERATION_MAX_DECODE_PIXELS,
  BOOK_RASTER_GENERATION_MAX_FRAMES,
  BOOK_RASTER_MAX_OCCURRENCES,
  BOOK_RASTER_MAX_REFERENCE_COMPONENTS,
  BOOK_RASTER_MAX_REFERENCE_LENGTH,
  BOOK_RASTER_MAX_UNIQUE,
  type BookRasterMediaType
} from './rasterPolicy'
import {
  BOOK_SVG_MAX_CANONICAL_BYTES,
  BOOK_SVG_MAX_DIMENSION,
  BOOK_SVG_MAX_PIXELS,
  BOOK_SVG_MEDIA_TYPE,
  type BookSvgMediaType
} from './svgPolicy'

export type BookImageMediaType = BookRasterMediaType | BookSvgMediaType

export const BOOK_IMAGE_EXTENSION_MEDIA_TYPES = Object.freeze({
  ...BOOK_RASTER_EXTENSION_MEDIA_TYPES,
  '.svg': BOOK_SVG_MEDIA_TYPE
} as const)

export const BOOK_IMAGE_MEDIA_TYPES: readonly BookImageMediaType[] = Object.freeze([
  ...new Set<BookImageMediaType>(Object.values(BOOK_IMAGE_EXTENSION_MEDIA_TYPES))
])

export const BOOK_IMAGE_MAX_OCCURRENCES = BOOK_RASTER_MAX_OCCURRENCES
export const BOOK_IMAGE_MAX_UNIQUE = BOOK_RASTER_MAX_UNIQUE
export const BOOK_IMAGE_GENERATION_MAX_BYTES = BOOK_RASTER_GENERATION_MAX_BYTES
export const BOOK_IMAGE_GENERATION_MAX_DECODE_PIXELS = BOOK_RASTER_GENERATION_MAX_DECODE_PIXELS
export const BOOK_IMAGE_GENERATION_MAX_FRAMES = BOOK_RASTER_GENERATION_MAX_FRAMES

export interface BookImageResourceMetrics {
  mediaType: BookImageMediaType
  byteLength: number
  width: number
  height: number
  frameCount: number
  decodePixels: number
}

export const isValidBookImageResourceMetrics = (
  value: BookImageResourceMetrics,
  reference: string
): boolean => {
  if (
    value.mediaType !== bookImageMediaTypeForReference(reference) ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    !Number.isSafeInteger(value.width) ||
    value.width <= 0 ||
    !Number.isSafeInteger(value.height) ||
    value.height <= 0 ||
    !Number.isSafeInteger(value.frameCount) ||
    value.frameCount <= 0 ||
    !Number.isSafeInteger(value.decodePixels) ||
    value.decodePixels <= 0
  ) {
    return false
  }
  if (value.mediaType === BOOK_SVG_MEDIA_TYPE) {
    return (
      value.byteLength <= BOOK_SVG_MAX_CANONICAL_BYTES &&
      value.width <= BOOK_SVG_MAX_DIMENSION &&
      value.height <= BOOK_SVG_MAX_DIMENSION &&
      value.width * value.height <= BOOK_SVG_MAX_PIXELS &&
      value.frameCount === 1 &&
      value.decodePixels === value.width * value.height
    )
  }
  return (
    value.byteLength <= BOOK_RASTER_MAX_BYTES &&
    value.width <= BOOK_RASTER_MAX_DIMENSION &&
    value.height <= BOOK_RASTER_MAX_DIMENSION &&
    value.width * value.height <= BOOK_RASTER_MAX_PIXELS &&
    value.frameCount <= BOOK_RASTER_MAX_FRAMES &&
    value.decodePixels <= BOOK_RASTER_MAX_DECODE_PIXELS &&
    value.decodePixels === value.width * value.height * value.frameCount
  )
}

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })

export const bookImageMediaTypeForReference = (reference: string): BookImageMediaType | null => {
  const slash = reference.lastIndexOf('/')
  const dot = reference.lastIndexOf('.')
  if (dot <= slash) return null
  const extension = reference.slice(dot).toLocaleLowerCase('en')
  return (
    BOOK_IMAGE_EXTENSION_MEDIA_TYPES[extension as keyof typeof BOOK_IMAGE_EXTENSION_MEDIA_TYPES] ??
    null
  )
}

export const isSupportedBookImageReference = (reference: unknown): reference is string => {
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
    bookImageMediaTypeForReference(reference) === null
  ) {
    return false
  }
  const components = reference.split('/')
  return (
    components.length <= BOOK_RASTER_MAX_REFERENCE_COMPONENTS &&
    components.every((component) => component.length > 0)
  )
}
