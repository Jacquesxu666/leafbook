import { TextDecoder } from 'node:util'
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes'
import {
  BOOK_SVG_ELEMENT_ATTRIBUTES,
  BOOK_SVG_ELEMENTS,
  BOOK_SVG_GLOBAL_ATTRIBUTES,
  BOOK_SVG_MAX_ATTRIBUTES,
  BOOK_SVG_MAX_CANONICAL_BYTES,
  BOOK_SVG_MAX_ANGLE,
  BOOK_SVG_MAX_COORDINATE,
  BOOK_SVG_MAX_DEPTH,
  BOOK_SVG_MAX_DIMENSION,
  BOOK_SVG_MAX_ELEMENTS,
  BOOK_SVG_MAX_IDS,
  BOOK_SVG_MAX_NUMBER_EXPONENT,
  BOOK_SVG_MAX_PATH_DATA_LENGTH,
  BOOK_SVG_MAX_PIXELS,
  BOOK_SVG_MAX_POINTS,
  BOOK_SVG_MAX_RAW_BYTES,
  BOOK_SVG_MAX_REFERENCE_CHAIN,
  BOOK_SVG_MAX_REFERENCES,
  BOOK_SVG_MAX_TEXT_LENGTH,
  BOOK_SVG_MAX_TRANSFORM_MATRIX_COMPONENT,
  BOOK_SVG_MAX_TRANSFORM_OPERATIONS,
  BOOK_SVG_MAX_TRANSFORM_SCALE,
  BOOK_SVG_MIN_NONZERO_NUMBER,
  type BookSvgElement
} from '../../common/book/svgPolicy'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
const NUMBER_SOURCE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
const numberPattern = new RegExp(`^${NUMBER_SOURCE}$`, 'u')
const numberTokenPattern = new RegExp(NUMBER_SOURCE, 'uy')
const allowedElements = new Set<string>(BOOK_SVG_ELEMENTS)
const globalAttributes = new Set<string>(BOOK_SVG_GLOBAL_ATTRIBUTES)
const attributesByElement = new Map(
  Object.entries(BOOK_SVG_ELEMENT_ATTRIBUTES).map(([name, attributes]) => [
    name,
    new Set(attributes)
  ])
)

interface SafeSvgNode {
  name: BookSvgElement
  key: string
  parent: SafeSvgNode | null
  attributes: Map<string, string>
  children: Array<SafeSvgNode | string>
  references: Array<{ attribute: string; target: string }>
}

export interface SanitizedBookSvg {
  bytes: Uint8Array
  width: number
  height: number
  frameCount: 1
  decodePixels: number
  elementCount: number
}

const finiteNumber = (value: string, maxAbs = BOOK_SVG_MAX_COORDINATE): number | null => {
  if (!numberPattern.test(value)) return null
  const exponent = /[eE]([+-]?\d+)$/u.exec(value)
  if (
    exponent &&
    (exponent[1] === undefined ||
      Math.abs(Number.parseInt(exponent[1], 10)) > BOOK_SVG_MAX_NUMBER_EXPONENT)
  ) {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > maxAbs) return null
  const nonzeroSyntax = /[1-9]/u.test(value.replace(/[eE].*$/u, ''))
  if (
    (number === 0 && nonzeroSyntax) ||
    (number !== 0 && Math.abs(number) < BOOK_SVG_MIN_NONZERO_NUMBER)
  ) {
    return null
  }
  return number
}

const parseNumberList = (
  value: string,
  maxCount = BOOK_SVG_MAX_POINTS * 2,
  maxAbs = BOOK_SVG_MAX_COORDINATE
): number[] | null => {
  const numbers: number[] = []
  let offset = 0
  while (offset < value.length) {
    while (offset < value.length && /[\t\n\r ,]/u.test(value[offset] ?? '')) offset += 1
    if (offset >= value.length) break
    numberTokenPattern.lastIndex = offset
    const match = numberTokenPattern.exec(value)
    if (!match || match.index !== offset) return null
    const number = finiteNumber(match[0], maxAbs)
    if (number === null) return null
    numbers.push(number)
    offset = numberTokenPattern.lastIndex
    if (numbers.length > maxCount) return null
  }
  return numbers
}

const validLength = (value: string, allowPercent = false): boolean => {
  const suffix = allowPercent && value.endsWith('%') ? '%' : value.endsWith('px') ? 'px' : ''
  const max = suffix === '%' ? 1_000 : BOOK_SVG_MAX_COORDINATE
  return finiteNumber(suffix ? value.slice(0, -suffix.length) : value, max) !== null
}

const validUnitInterval = (value: string): boolean => {
  const percent = value.endsWith('%')
  const number = finiteNumber(percent ? value.slice(0, -1) : value, 100)
  return number !== null && number >= 0 && number <= (percent ? 100 : 1)
}

type Matrix = readonly [number, number, number, number, number, number]
type Bounds = readonly [number, number, number, number]

const boundedMatrix = (matrix: Matrix): Matrix | null =>
  matrix.every(
    (value) => Number.isFinite(value) && Math.abs(value) <= BOOK_SVG_MAX_TRANSFORM_MATRIX_COMPONENT
  )
    ? matrix
    : null

const multiplyMatrices = (left: Matrix, right: Matrix): Matrix | null =>
  boundedMatrix([
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ])

const parseTransform = (value: string): Matrix | null => {
  let offset = 0
  let count = 0
  let composed: Matrix = [1, 0, 0, 1, 0, 0]
  const transform = /(?:matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)/uy
  while (offset < value.length) {
    while (offset < value.length && /[\t\n\r ,]/u.test(value[offset] ?? '')) offset += 1
    if (offset >= value.length) break
    transform.lastIndex = offset
    const match = transform.exec(value)
    if (!match || match.index !== offset) return null
    const name = match[0].slice(0, match[0].indexOf('(')).trim()
    const values = parseNumberList(match[1] ?? '', 6)
    const allowed =
      name === 'matrix'
        ? values?.length === 6
        : name === 'rotate'
          ? values?.length === 1 || values?.length === 3
          : name === 'translate' || name === 'scale'
            ? values?.length === 1 || values?.length === 2
            : values?.length === 1
    if (!allowed || ++count > BOOK_SVG_MAX_TRANSFORM_OPERATIONS || !values) return null
    let next: Matrix | null = null
    if (name === 'matrix') {
      const [a, b, c, d, e, f] = values
      if (
        a === undefined ||
        b === undefined ||
        c === undefined ||
        d === undefined ||
        e === undefined ||
        f === undefined ||
        [a, b, c, d].some((item) => Math.abs(item) > BOOK_SVG_MAX_TRANSFORM_SCALE) ||
        [e, f].some((item) => Math.abs(item) > BOOK_SVG_MAX_COORDINATE)
      ) {
        return null
      }
      next = [a, b, c, d, e, f]
    } else if (name === 'translate') {
      const [x = 0, y = 0] = values
      next = [1, 0, 0, 1, x, y]
    } else if (name === 'scale') {
      const [x = 1, y = x] = values
      if (
        Math.abs(x) > BOOK_SVG_MAX_TRANSFORM_SCALE ||
        Math.abs(y) > BOOK_SVG_MAX_TRANSFORM_SCALE
      ) {
        return null
      }
      next = [x, 0, 0, y, 0, 0]
    } else {
      const angle = values[0]
      if (angle === undefined || Math.abs(angle) > BOOK_SVG_MAX_ANGLE) return null
      const radians = (angle * Math.PI) / 180
      if (name === 'rotate') {
        const cosine = Math.cos(radians)
        const sine = Math.sin(radians)
        const [cx = 0, cy = 0] = values.slice(1)
        next = [
          cosine,
          sine,
          -sine,
          cosine,
          cx - cosine * cx + sine * cy,
          cy - sine * cx - cosine * cy
        ]
      } else {
        if (Math.abs(angle % 180) >= 89.999 && Math.abs(angle % 180) <= 90.001) return null
        const tangent = Math.tan(radians)
        if (!Number.isFinite(tangent) || Math.abs(tangent) > BOOK_SVG_MAX_TRANSFORM_SCALE) {
          return null
        }
        next = name === 'skewX' ? [1, 0, tangent, 1, 0, 0] : [1, tangent, 0, 1, 0, 0]
      }
    }
    const bounded = next && boundedMatrix(next)
    const product = bounded && multiplyMatrices(composed, bounded)
    if (!product) return null
    composed = product
    offset = transform.lastIndex
  }
  return count > 0 ? composed : null
}

const includePoint = (bounds: Bounds | null, x: number, y: number): Bounds => {
  if (!bounds) return [x, y, x, y]
  return [
    Math.min(bounds[0], x),
    Math.min(bounds[1], y),
    Math.max(bounds[2], x),
    Math.max(bounds[3], y)
  ]
}

const pathBounds = (value: string): Bounds | null => {
  if (!value || value.length > BOOK_SVG_MAX_PATH_DATA_LENGTH) return null
  const tokens: Array<string | number> = []
  let offset = 0
  const token = new RegExp(`[CcHhLlMmQqSsTtVvZz]|${NUMBER_SOURCE}`, 'uy')
  while (offset < value.length) {
    while (offset < value.length && /[\t\n\r ,]/u.test(value[offset] ?? '')) offset += 1
    if (offset >= value.length) break
    token.lastIndex = offset
    const match = token.exec(value)
    if (!match || match.index !== offset) return null
    if (/^[A-Za-z]$/u.test(match[0])) tokens.push(match[0])
    else {
      const number = finiteNumber(match[0])
      if (number === null) return null
      tokens.push(number)
    }
    if (tokens.length > BOOK_SVG_MAX_POINTS * 4) return null
    offset = token.lastIndex
  }
  let cursor = 0
  let command = ''
  let x = 0
  let y = 0
  let subpathX = 0
  let subpathY = 0
  let previousSegment = ''
  let cubicControl: readonly [number, number] | null = null
  let quadraticControl: readonly [number, number] | null = null
  let bounds: Bounds | null = null
  let first = true
  const coordinate = (base: number, delta: number, relative: boolean): number | null => {
    const result = relative ? base + delta : delta
    return Number.isFinite(result) && Math.abs(result) <= BOOK_SVG_MAX_COORDINATE ? result : null
  }
  while (cursor < tokens.length) {
    const tokenValue = tokens[cursor]
    if (typeof tokenValue === 'string') {
      command = tokenValue
      cursor += 1
    } else {
      if (!command || command.toUpperCase() === 'Z') return null
    }
    const upper = command.toUpperCase()
    if (first && upper !== 'M') return null
    first = false
    if (upper === 'Z') {
      x = subpathX
      y = subpathY
      previousSegment = 'Z'
      cubicControl = null
      quadraticControl = null
      command = ''
      continue
    }
    const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 }[upper]
    if (!arity) return null
    let consumed = 0
    while (cursor < tokens.length && typeof tokens[cursor] !== 'string') {
      if (cursor + arity > tokens.length) return null
      const values = tokens.slice(cursor, cursor + arity)
      if (values.some((item) => typeof item !== 'number')) return null
      const numbers = values as number[]
      const relative = command === command.toLowerCase()
      let pairs: Array<Array<number | boolean>>
      if (upper === 'H') pairs = [[numbers[0] ?? Number.NaN, y, true, false]]
      else if (upper === 'V') pairs = [[x, numbers[0] ?? Number.NaN, false, true]]
      else {
        pairs = Array.from({ length: arity / 2 }, (_, index) => [
          numbers[index * 2] ?? Number.NaN,
          numbers[index * 2 + 1] ?? Number.NaN,
          true,
          true
        ])
      }
      const absolutePairs: Array<readonly [number, number]> = []
      for (const [rawX, rawY, applyX, applyY] of pairs) {
        if (typeof rawX !== 'number' || typeof rawY !== 'number') return null
        const nextX = applyX ? coordinate(x, rawX, relative) : rawX
        const nextY = applyY ? coordinate(y, rawY, relative) : rawY
        if (nextX === null || nextY === null) return null
        absolutePairs.push([nextX, nextY])
        bounds = includePoint(bounds, nextX, nextY)
      }
      if (upper === 'S') {
        const reflectedX: number =
          previousSegment === 'C' || previousSegment === 'S' ? 2 * x - (cubicControl?.[0] ?? x) : x
        const reflectedY: number =
          previousSegment === 'C' || previousSegment === 'S' ? 2 * y - (cubicControl?.[1] ?? y) : y
        if (
          !Number.isFinite(reflectedX) ||
          !Number.isFinite(reflectedY) ||
          Math.abs(reflectedX) > BOOK_SVG_MAX_COORDINATE ||
          Math.abs(reflectedY) > BOOK_SVG_MAX_COORDINATE
        ) {
          return null
        }
        bounds = includePoint(bounds, reflectedX, reflectedY)
      }
      if (upper === 'T') {
        const reflectedX: number =
          previousSegment === 'Q' || previousSegment === 'T'
            ? 2 * x - (quadraticControl?.[0] ?? x)
            : x
        const reflectedY: number =
          previousSegment === 'Q' || previousSegment === 'T'
            ? 2 * y - (quadraticControl?.[1] ?? y)
            : y
        if (
          !Number.isFinite(reflectedX) ||
          !Number.isFinite(reflectedY) ||
          Math.abs(reflectedX) > BOOK_SVG_MAX_COORDINATE ||
          Math.abs(reflectedY) > BOOK_SVG_MAX_COORDINATE
        ) {
          return null
        }
        quadraticControl = [reflectedX, reflectedY]
        bounds = includePoint(bounds, reflectedX, reflectedY)
      }
      const rawEndpointX = numbers[upper === 'H' ? 0 : arity - 2]
      const rawEndpointY = numbers[upper === 'V' ? 0 : arity - 1]
      if (
        (upper !== 'V' && rawEndpointX === undefined) ||
        (upper !== 'H' && rawEndpointY === undefined)
      ) {
        return null
      }
      const endpointX = upper === 'V' ? x : coordinate(x, rawEndpointX as number, relative)
      const endpointY = upper === 'H' ? y : coordinate(y, rawEndpointY as number, relative)
      if (endpointX === null || endpointY === null) return null
      x = endpointX
      y = endpointY
      if (upper === 'C') cubicControl = absolutePairs[1] ?? null
      else if (upper === 'S') cubicControl = absolutePairs[0] ?? null
      else cubicControl = null
      if (upper === 'Q') quadraticControl = absolutePairs[0] ?? null
      else if (upper !== 'T') quadraticControl = null
      previousSegment = upper
      if (upper === 'M' && consumed === 0) {
        subpathX = x
        subpathY = y
      }
      cursor += arity
      consumed += 1
    }
    if (consumed === 0) return null
    if (upper === 'M') command = command === 'm' ? 'l' : 'L'
  }
  return first ? null : bounds
}

const validPaint = (value: string): boolean =>
  value === 'none' ||
  value === 'currentColor' ||
  /^[a-z]{3,20}$/u.test(value) ||
  /^#[0-9a-fA-F]{3,8}$/u.test(value) ||
  /^url\(#[A-Za-z_][A-Za-z0-9_.-]{0,127}\)$/u.test(value)

const referencedId = (name: string, value: string): string | null => {
  if (name === 'href') return /^#[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(value) ? value.slice(1) : ''
  const match = /^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,127})\)$/u.exec(value)
  return match?.[1] ?? null
}

const validAttribute = (element: BookSvgElement, name: string, value: string): boolean => {
  if (!value || value.length > BOOK_SVG_MAX_PATH_DATA_LENGTH) return false
  if (name === 'id') return /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(value)
  if (name === 'd') return pathBounds(value) !== null
  if (name === 'points') {
    const points = parseNumberList(value, BOOK_SVG_MAX_POINTS * 2)
    return Boolean(points && points.length >= 4 && points.length % 2 === 0)
  }
  if (name === 'transform' || name === 'gradientTransform') return parseTransform(value) !== null
  if (name === 'fill' || name === 'stroke' || name === 'stop-color') return validPaint(value)
  if (name === 'href') {
    const reference = referencedId(name, value)
    return typeof reference === 'string' && reference.length > 0
  }
  if (name === 'opacity' || name === 'fill-opacity' || name === 'stroke-opacity') {
    return validUnitInterval(value)
  }
  if (name === 'offset' || name === 'stop-opacity') return validUnitInterval(value)
  if (name === 'viewBox') {
    const numbers = parseNumberList(value, 4)
    const originX = numbers?.[0]
    const originY = numbers?.[1]
    const width = numbers?.[2]
    const height = numbers?.[3]
    return (
      numbers?.length === 4 &&
      originX !== undefined &&
      originY !== undefined &&
      width !== undefined &&
      height !== undefined &&
      width > 0 &&
      height > 0 &&
      width <= BOOK_SVG_MAX_DIMENSION &&
      height <= BOOK_SVG_MAX_DIMENSION &&
      width * height <= BOOK_SVG_MAX_PIXELS &&
      Math.abs(originX + width) <= BOOK_SVG_MAX_COORDINATE &&
      Math.abs(originY + height) <= BOOK_SVG_MAX_COORDINATE
    )
  }
  if (name === 'preserveAspectRatio') {
    return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: meet| slice)?)$/u.test(value)
  }
  if (name === 'gradientUnits') {
    return value === 'userSpaceOnUse' || value === 'objectBoundingBox'
  }
  if (name === 'spreadMethod') return value === 'pad' || value === 'reflect' || value === 'repeat'
  if (name === 'pathLength') {
    const number = finiteNumber(value)
    return number !== null && number > 0 && number <= BOOK_SVG_MAX_COORDINATE
  }
  if (name === 'width' || name === 'height' || name === 'r' || name === 'rx' || name === 'ry') {
    const number = finiteNumber(value.replace(/px$/u, ''))
    return number !== null && number >= 0 && validLength(value)
  }
  if (name === 'stroke-width') {
    const number = finiteNumber(value.replace(/px$/u, ''))
    return number !== null && number >= 0 && validLength(value)
  }
  return validLength(value, element.includes('Gradient') || name === 'offset')
}

const attributeNumber = (node: SafeSvgNode, name: string, fallback = 0): number =>
  finiteNumber((node.attributes.get(name) ?? String(fallback)).replace(/px$/u, '')) ?? Number.NaN

const nodeGeometryBounds = (node: SafeSvgNode, strokeMargin: number): Bounds | null => {
  let bounds: Bounds | null = null
  if (node.name === 'path') {
    bounds = node.attributes.has('d') ? pathBounds(node.attributes.get('d') ?? '') : null
  } else if (node.name === 'rect') {
    const x = attributeNumber(node, 'x')
    const y = attributeNumber(node, 'y')
    const width = attributeNumber(node, 'width')
    const height = attributeNumber(node, 'height')
    bounds = [x, y, x + width, y + height]
  } else if (node.name === 'circle') {
    const cx = attributeNumber(node, 'cx')
    const cy = attributeNumber(node, 'cy')
    const radius = attributeNumber(node, 'r')
    bounds = [cx - radius, cy - radius, cx + radius, cy + radius]
  } else if (node.name === 'ellipse') {
    const cx = attributeNumber(node, 'cx')
    const cy = attributeNumber(node, 'cy')
    const rx = attributeNumber(node, 'rx')
    const ry = attributeNumber(node, 'ry')
    bounds = [cx - rx, cy - ry, cx + rx, cy + ry]
  } else if (node.name === 'line') {
    const x1 = attributeNumber(node, 'x1')
    const y1 = attributeNumber(node, 'y1')
    const x2 = attributeNumber(node, 'x2')
    const y2 = attributeNumber(node, 'y2')
    bounds = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
  } else if (node.name === 'polyline' || node.name === 'polygon') {
    const points = parseNumberList(node.attributes.get('points') ?? '')
    if (points) {
      for (let index = 0; index < points.length; index += 2) {
        bounds = includePoint(bounds, points[index] ?? Number.NaN, points[index + 1] ?? Number.NaN)
      }
    }
  }
  if (!bounds || bounds.some((value) => !Number.isFinite(value))) return bounds
  return [
    bounds[0] - strokeMargin,
    bounds[1] - strokeMargin,
    bounds[2] + strokeMargin,
    bounds[3] + strokeMargin
  ]
}

const viewportMatrix = (
  width: number,
  height: number,
  viewBox: number[] | null,
  preserveAspectRatio: string | undefined
): Matrix | null => {
  if (!viewBox) return [1, 0, 0, 1, 0, 0]
  const [minX, minY, viewWidth, viewHeight] = viewBox
  if (
    minX === undefined ||
    minY === undefined ||
    viewWidth === undefined ||
    viewHeight === undefined
  ) {
    return null
  }
  const scaleX = width / viewWidth
  const scaleY = height / viewHeight
  if (preserveAspectRatio === 'none') {
    return boundedMatrix([scaleX, 0, 0, scaleY, -minX * scaleX, -minY * scaleY])
  }
  const setting = preserveAspectRatio ?? 'xMidYMid meet'
  const match = /^(x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?: (meet|slice))?$/u.exec(setting)
  if (!match) return null
  const scale =
    (match[2] ?? 'meet') === 'slice' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  const remainingX = width - viewWidth * scale
  const remainingY = height - viewHeight * scale
  const alignment = match[1] ?? 'xMidYMid'
  const offsetX = alignment.startsWith('xMin')
    ? 0
    : alignment.startsWith('xMid')
      ? remainingX / 2
      : remainingX
  const offsetY = alignment.includes('YMin')
    ? 0
    : alignment.includes('YMid')
      ? remainingY / 2
      : remainingY
  return boundedMatrix([scale, 0, 0, scale, offsetX - minX * scale, offsetY - minY * scale])
}

const boundedGeometryTree = (root: SafeSvgNode, initial: Matrix): boolean => {
  const visit = (
    node: SafeSvgNode,
    parent: Matrix,
    inheritedStroke: string,
    inheritedStrokeWidth: number
  ): boolean => {
    const transformValue = node.attributes.get('transform')
    const local = transformValue ? parseTransform(transformValue) : ([1, 0, 0, 1, 0, 0] as const)
    const current = local && multiplyMatrices(parent, local)
    if (!current) return false
    const stroke = node.attributes.get('stroke') ?? inheritedStroke
    const explicitStrokeWidth = node.attributes.has('stroke-width')
      ? attributeNumber(node, 'stroke-width')
      : inheritedStrokeWidth
    if (!Number.isFinite(explicitStrokeWidth) || explicitStrokeWidth < 0) return false
    // SVG's default miter joins can extend well beyond half the stroke width.
    // Reserve the full default miter limit conservatively for every stroked
    // primitive, including inherited strokes.
    const bounds = nodeGeometryBounds(node, stroke === 'none' ? 0 : explicitStrokeWidth * 4)
    if (bounds) {
      for (const [x, y] of [
        [bounds[0], bounds[1]],
        [bounds[0], bounds[3]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]]
      ] as const) {
        const transformedX = current[0] * x + current[2] * y + current[4]
        const transformedY = current[1] * x + current[3] * y + current[5]
        if (
          !Number.isFinite(transformedX) ||
          !Number.isFinite(transformedY) ||
          Math.abs(transformedX) > BOOK_SVG_MAX_COORDINATE ||
          Math.abs(transformedY) > BOOK_SVG_MAX_COORDINATE
        ) {
          return false
        }
      }
    }
    return node.children.every(
      (child) => typeof child === 'string' || visit(child, current, stroke, explicitStrokeWidth)
    )
  }
  return visit(root, initial, 'none', 1)
}

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')

const escapeText = (value: string): string =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

const serializeNode = (node: SafeSvgNode, root = false): string => {
  const attributes = [...node.attributes].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  const serializedAttributes = [...(root ? [['xmlns', SVG_NAMESPACE] as const] : []), ...attributes]
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')
  return `<${node.name}${serializedAttributes}>${node.children
    .map((child) => (typeof child === 'string' ? escapeText(child) : serializeNode(child)))
    .join('')}</${node.name}>`
}

export const sanitizeBookSvg = (input: Uint8Array): SanitizedBookSvg | null => {
  if (input.byteLength === 0 || input.byteLength > BOOK_SVG_MAX_RAW_BYTES) return null
  let source = ''
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    return null
  }
  if (!source || source.codePointAt(0) === 0xfeff || source.includes('&')) return null

  const stack: SafeSvgNode[] = []
  const ids = new Map<string, SafeSvgNode>()
  const references: Array<{ source: SafeSvgNode; attribute: string; target: string }> = []
  let root: SafeSvgNode | null = null
  let invalid = false
  let ended = false
  let elementCount = 0
  let attributeCount = 0
  let textLength = 0
  const parser = new SaxesParser({ xmlns: true, fragment: false })
  const reject = (): void => {
    invalid = true
  }
  parser.on('error', reject)
  parser.on('doctype', reject)
  parser.on('processinginstruction', reject)
  parser.on('xmldecl', reject)
  parser.on('comment', reject)
  parser.on('cdata', reject)
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (invalid) return
    if (
      tag.prefix !== '' ||
      tag.uri !== SVG_NAMESPACE ||
      !allowedElements.has(tag.local) ||
      ++elementCount > BOOK_SVG_MAX_ELEMENTS ||
      stack.length + 1 > BOOK_SVG_MAX_DEPTH ||
      (stack.length === 0 && (root !== null || tag.local !== 'svg')) ||
      (stack.length > 0 && tag.local === 'svg')
    ) {
      invalid = true
      return
    }
    const name = tag.local as BookSvgElement
    const node: SafeSvgNode = {
      name,
      key: `element-${elementCount}`,
      parent: stack.at(-1) ?? null,
      attributes: new Map(),
      children: [],
      references: []
    }
    const elementAttributes = attributesByElement.get(name)
    for (const attribute of Object.values(tag.attributes) as SaxesAttributeNS[]) {
      if (++attributeCount > BOOK_SVG_MAX_ATTRIBUTES) {
        invalid = true
        return
      }
      if (attribute.uri === XMLNS_NAMESPACE) {
        if (stack.length !== 0 || attribute.name !== 'xmlns' || attribute.value !== SVG_NAMESPACE) {
          invalid = true
        }
        continue
      }
      if (
        attribute.prefix !== '' ||
        attribute.uri !== '' ||
        attribute.local === 'style' ||
        attribute.local.toLowerCase().startsWith('on') ||
        (!globalAttributes.has(attribute.local) && !elementAttributes?.has(attribute.local)) ||
        !validAttribute(name, attribute.local, attribute.value)
      ) {
        invalid = true
        return
      }
      if (node.attributes.has(attribute.local)) {
        invalid = true
        return
      }
      node.attributes.set(attribute.local, attribute.value)
      if (attribute.local === 'id') {
        if (ids.size >= BOOK_SVG_MAX_IDS || ids.has(attribute.value)) {
          invalid = true
          return
        }
        ids.set(attribute.value, node)
      }
      const target = referencedId(attribute.local, attribute.value)
      if (target !== null) {
        if (!target || references.length >= BOOK_SVG_MAX_REFERENCES) {
          invalid = true
          return
        }
        const reference = { source: node, attribute: attribute.local, target }
        node.references.push({ attribute: attribute.local, target })
        references.push(reference)
      }
    }
    if (stack.length) stack[stack.length - 1]?.children.push(node)
    else root = node
    stack.push(node)
  })
  parser.on('text', (text: string) => {
    if (invalid || !text) return
    const normalized = text.replace(/\r\n?/gu, '\n')
    if (!stack.length) {
      if (normalized.trim()) invalid = true
      return
    }
    const parent = stack[stack.length - 1]
    if (!parent) return
    if (!['title', 'desc'].includes(parent.name)) {
      if (normalized.trim()) invalid = true
      return
    }
    textLength += normalized.length
    if (textLength > BOOK_SVG_MAX_TEXT_LENGTH) {
      invalid = true
      return
    }
    parent.children.push(normalized)
  })
  parser.on('closetag', (tag: SaxesTagNS) => {
    if (stack.pop()?.name !== tag.local) invalid = true
  })
  parser.on('end', () => {
    ended = true
  })
  try {
    parser.write(source).close()
  } catch {
    return null
  }
  if (invalid || !ended || !root || stack.length !== 0) return null

  const validReferenceTarget = (
    source: SafeSvgNode,
    attribute: string,
    target: SafeSvgNode
  ): boolean => {
    if (attribute === 'fill' || attribute === 'stroke') {
      return target.name === 'linearGradient' || target.name === 'radialGradient'
    }
    return (
      attribute === 'href' &&
      (source.name === 'linearGradient' || source.name === 'radialGradient') &&
      (target.name === 'linearGradient' || target.name === 'radialGradient')
    )
  }
  for (const reference of references) {
    const target = ids.get(reference.target)
    if (!target || !validReferenceTarget(reference.source, reference.attribute, target)) return null
  }

  const edges = new Map<string, Set<string>>()
  const collectSubtreeReferences = (owner: SafeSvgNode, current: SafeSvgNode): void => {
    for (const reference of current.references) {
      const target = ids.get(reference.target)
      if (!target) continue
      const targets = edges.get(owner.key) ?? new Set<string>()
      targets.add(target.key)
      edges.set(owner.key, targets)
    }
    for (const child of current.children) {
      if (typeof child !== 'string') collectSubtreeReferences(owner, child)
    }
  }
  for (const node of ids.values()) collectSubtreeReferences(node, node)

  const colors = new Map<string, 0 | 1 | 2>()
  const longest = new Map<string, number>()
  const visit = (key: string): number | null => {
    if (colors.get(key) === 1) return null
    if (colors.get(key) === 2) return longest.get(key) ?? 1
    colors.set(key, 1)
    let depth = 1
    for (const target of edges.get(key) ?? []) {
      const targetDepth = visit(target)
      if (targetDepth === null) return null
      depth = Math.max(depth, 1 + targetDepth)
      if (depth > BOOK_SVG_MAX_REFERENCE_CHAIN) return null
    }
    colors.set(key, 2)
    longest.set(key, depth)
    return depth
  }
  for (const node of ids.values()) {
    if (visit(node.key) === null) return null
  }

  const safeRoot = root as SafeSvgNode
  const rootAttributes = safeRoot.attributes
  const viewBox = rootAttributes.has('viewBox')
    ? parseNumberList(rootAttributes.get('viewBox') ?? '')
    : null
  const widthValue = rootAttributes.get('width')
  const heightValue = rootAttributes.get('height')
  const width = widthValue ? finiteNumber(widthValue.replace(/px$/u, '')) : (viewBox?.[2] ?? null)
  const height = heightValue
    ? finiteNumber(heightValue.replace(/px$/u, ''))
    : (viewBox?.[3] ?? null)
  if (
    width === null ||
    height === null ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > BOOK_SVG_MAX_DIMENSION ||
    height > BOOK_SVG_MAX_DIMENSION ||
    width * height > BOOK_SVG_MAX_PIXELS
  ) {
    return null
  }
  const initialMatrix = viewportMatrix(
    width,
    height,
    viewBox,
    rootAttributes.get('preserveAspectRatio')
  )
  if (!initialMatrix || !boundedGeometryTree(safeRoot, initialMatrix)) return null
  const canonical = Buffer.from(serializeNode(safeRoot, true), 'utf8')
  if (canonical.byteLength > BOOK_SVG_MAX_CANONICAL_BYTES) return null
  return {
    bytes: canonical,
    width,
    height,
    frameCount: 1,
    decodePixels: width * height,
    elementCount
  }
}
