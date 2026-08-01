export const BOOK_SVG_MEDIA_TYPE = 'image/svg+xml' as const
export type BookSvgMediaType = typeof BOOK_SVG_MEDIA_TYPE

export const BOOK_SVG_MAX_RAW_BYTES = 1024 * 1024
export const BOOK_SVG_MAX_CANONICAL_BYTES = 1024 * 1024
export const BOOK_SVG_MAX_ELEMENTS = 2_048
export const BOOK_SVG_MAX_ATTRIBUTES = 8_192
export const BOOK_SVG_MAX_DEPTH = 32
export const BOOK_SVG_MAX_TEXT_LENGTH = 256 * 1024
export const BOOK_SVG_MAX_PATH_DATA_LENGTH = 256 * 1024
export const BOOK_SVG_MAX_POINTS = 100_000
export const BOOK_SVG_MAX_IDS = 512
export const BOOK_SVG_MAX_REFERENCES = 1_024
export const BOOK_SVG_MAX_REFERENCE_CHAIN = 32
export const BOOK_SVG_MAX_DIMENSION = 16_384
export const BOOK_SVG_MAX_PIXELS = 40_000_000
export const BOOK_SVG_MAX_COORDINATE = 1_000_000
export const BOOK_SVG_MAX_NUMBER_EXPONENT = 12
export const BOOK_SVG_MIN_NONZERO_NUMBER = 1e-12
export const BOOK_SVG_MAX_TRANSFORM_OPERATIONS = 64
export const BOOK_SVG_MAX_TRANSFORM_SCALE = 1_024
export const BOOK_SVG_MAX_TRANSFORM_MATRIX_COMPONENT = 1_000_000
export const BOOK_SVG_MAX_ANGLE = 360_000

export const BOOK_SVG_ELEMENTS = Object.freeze([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'linearGradient',
  'radialGradient',
  'stop'
] as const)

export type BookSvgElement = (typeof BOOK_SVG_ELEMENTS)[number]

export const BOOK_SVG_GLOBAL_ATTRIBUTES = Object.freeze([
  'id',
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform'
] as const)

export const BOOK_SVG_ELEMENT_ATTRIBUTES: Readonly<Record<BookSvgElement, readonly string[]>> =
  Object.freeze({
    svg: ['width', 'height', 'viewBox', 'preserveAspectRatio'],
    g: [],
    defs: [],
    title: [],
    desc: [],
    path: ['d', 'pathLength'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    polyline: ['points'],
    polygon: ['points'],
    linearGradient: [
      'x1',
      'y1',
      'x2',
      'y2',
      'gradientUnits',
      'gradientTransform',
      'spreadMethod',
      'href'
    ],
    radialGradient: [
      'cx',
      'cy',
      'r',
      'fx',
      'fy',
      'fr',
      'gradientUnits',
      'gradientTransform',
      'spreadMethod',
      'href'
    ],
    stop: ['offset', 'stop-color', 'stop-opacity']
  })

export const BOOK_SVG_REFERENCE_ATTRIBUTES = Object.freeze(['href', 'fill', 'stroke'] as const)
