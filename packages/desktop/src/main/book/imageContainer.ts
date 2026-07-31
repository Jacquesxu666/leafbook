/* eslint-disable @stylistic/indent, @stylistic/space-before-function-paren */
import { inflate } from 'node:zlib'
import { promisify } from 'node:util'
import {
  BOOK_RASTER_MAX_BYTES,
  BOOK_RASTER_MAX_DECODE_PIXELS as MAX_BOOK_IMAGE_DECODE_PIXELS,
  BOOK_RASTER_MAX_DIMENSION as MAX_BOOK_IMAGE_DIMENSION,
  BOOK_RASTER_MAX_FRAMES as MAX_BOOK_IMAGE_FRAMES,
  BOOK_RASTER_MAX_PIXELS as MAX_BOOK_IMAGE_PIXELS,
  type BookRasterMediaType
} from 'common/book/rasterPolicy'

export type ValidatedBookImageMediaType = BookRasterMediaType

export interface ValidatedBookImageContainer {
  width: number
  height: number
  frameCount: number
  decodePixels: number
}

export {
  MAX_BOOK_IMAGE_DECODE_PIXELS,
  MAX_BOOK_IMAGE_DIMENSION,
  MAX_BOOK_IMAGE_FRAMES,
  MAX_BOOK_IMAGE_PIXELS
}
export const MAX_BOOK_PNG_INFLATED_BYTES = 64 * 1024 * 1024
const MAX_CONTAINER_RECORDS = 4_096
const MAX_PNG_COMPRESSED_BYTES = BOOK_RASTER_MAX_BYTES
const MAX_PNG_ANCILLARY_BYTES = 256 * 1024
const MAX_PNG_ANCILLARY_CHUNK_BYTES = 64 * 1024
const inflateAsync = promisify(inflate)

const validDimensions = (width: number, height: number, frames = 1): boolean =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  Number.isInteger(frames) &&
  width > 0 &&
  height > 0 &&
  frames > 0 &&
  width <= MAX_BOOK_IMAGE_DIMENSION &&
  height <= MAX_BOOK_IMAGE_DIMENSION &&
  frames <= MAX_BOOK_IMAGE_FRAMES &&
  width * height <= MAX_BOOK_IMAGE_PIXELS &&
  width * height * frames <= MAX_BOOK_IMAGE_DECODE_PIXELS

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value >>> 0
}

const crc32 = (bytes: Buffer, start: number, end: number): number => {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) {
    crc = (CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])
const PNG_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
const PNG_SAFE_ANCILLARY_CHUNKS = new Set([
  'cHRM',
  'gAMA',
  'sRGB',
  'pHYs',
  'tIME',
  'bKGD',
  'sBIT',
  'tRNS',
  'tEXt'
])
const PNG_REJECTED_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT', 'iCCP', 'zTXt', 'iTXt'])

const pngChannelCount = (colorType: number): number | null => {
  switch (colorType) {
    case 0:
    case 3:
      return 1
    case 2:
      return 3
    case 4:
      return 2
    case 6:
      return 4
    default:
      return null
  }
}

const validPngAncillarySchema = (
  type: string,
  data: Buffer,
  bitDepth: number,
  colorType: number,
  paletteEntries: number
): boolean => {
  if (type === 'cHRM') return data.length === 32
  if (type === 'gAMA') return data.length === 4
  if (type === 'sRGB') return data.length === 1 && (data[0] ?? 4) <= 3
  if (type === 'pHYs') return data.length === 9 && (data[8] ?? 2) <= 1
  if (type === 'tIME') return data.length === 7
  if (type === 'bKGD') {
    return data.length === (colorType === 3 ? 1 : colorType === 0 || colorType === 4 ? 2 : 6)
  }
  if (type === 'sBIT') {
    const expected = [1, 0, 3, 3, 2, 0, 4][colorType] ?? 0
    const maximum = colorType === 3 ? 8 : bitDepth
    return data.length === expected && [...data].every((value) => value > 0 && value <= maximum)
  }
  if (type === 'tRNS') {
    return (
      (colorType === 0 && data.length === 2) ||
      (colorType === 2 && data.length === 6) ||
      (colorType === 3 && paletteEntries > 0 && data.length > 0 && data.length <= paletteEntries)
    )
  }
  if (type === 'tEXt') {
    const separator = data.indexOf(0)
    return separator >= 1 && separator <= 79
  }
  return false
}

const validPngImageData = async (
  chunks: Buffer[],
  compressedBytes: number,
  expectedBytes: number,
  rowBytes: number,
  height: number
): Promise<boolean> => {
  if (
    chunks.length === 0 ||
    compressedBytes === 0 ||
    compressedBytes > MAX_PNG_COMPRESSED_BYTES ||
    expectedBytes <= 0 ||
    expectedBytes > MAX_BOOK_PNG_INFLATED_BYTES
  ) {
    return false
  }
  try {
    const compressed = Buffer.concat(chunks, compressedBytes)
    const result = (await inflateAsync(compressed, {
      info: true,
      maxOutputLength: expectedBytes
    })) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    if (
      result.buffer.length !== expectedBytes ||
      result.engine.bytesWritten !== compressed.length
    ) {
      return false
    }
    const stride = rowBytes + 1
    for (let row = 0; row < height; row += 1) {
      if ((result.buffer[row * stride] ?? 5) > 4) return false
    }
    return true
  } catch {
    return false
  }
}

const validPng = async (bytes: Buffer): Promise<ValidatedBookImageContainer | false | null> => {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null
  }
  let offset = 8
  let records = 0
  let sawHeader = false
  let sawData = false
  let dataEnded = false
  let sawPalette = false
  let sawTransparency = false
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let rowBytes = 0
  let expectedBytes = 0
  let paletteEntries = 0
  let compressedBytes = 0
  let ancillaryBytes = 0
  const dataChunks: Buffer[] = []
  while (offset < bytes.length && ++records <= MAX_CONTAINER_RECORDS) {
    if (offset + 12 > bytes.length) return false
    const length = bytes.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const crcOffset = dataEnd
    if (dataEnd < dataStart || crcOffset + 4 > bytes.length) return false
    const type = bytes.subarray(typeStart, dataStart).toString('ascii')
    if (
      !/^[A-Za-z]{4}$/u.test(type) ||
      type.charCodeAt(2) < 0x41 ||
      type.charCodeAt(2) > 0x5a ||
      PNG_REJECTED_CHUNKS.has(type)
    ) {
      return false
    }
    const critical = (type.charCodeAt(0) & 0x20) === 0
    if (
      (critical && !PNG_CRITICAL_CHUNKS.has(type)) ||
      (!critical && !PNG_SAFE_ANCILLARY_CHUNKS.has(type))
    ) {
      return false
    }
    if (bytes.readUInt32BE(crcOffset) !== crc32(bytes, typeStart, dataEnd)) return false
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false
      width = bytes.readUInt32BE(dataStart)
      height = bytes.readUInt32BE(dataStart + 4)
      bitDepth = bytes[dataStart + 8] ?? 0
      colorType = bytes[dataStart + 9] ?? -1
      const validDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth))
      const channels = pngChannelCount(colorType)
      rowBytes = channels === null ? 0 : Math.ceil((width * channels * bitDepth) / 8)
      expectedBytes = (rowBytes + 1) * height
      if (
        !validDimensions(width, height) ||
        !validDepth ||
        !Number.isSafeInteger(rowBytes) ||
        !Number.isSafeInteger(expectedBytes) ||
        expectedBytes > MAX_BOOK_PNG_INFLATED_BYTES ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        bytes[dataStart + 12] !== 0
      ) {
        return false
      }
      sawHeader = true
      offset = crcOffset + 4
      continue
    } else if (type === 'IHDR') {
      return false
    }
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === 'PLTE') {
      if (
        sawPalette ||
        sawData ||
        colorType === 0 ||
        colorType === 4 ||
        length < 3 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        return false
      }
      paletteEntries = length / 3
      if (colorType === 3 && paletteEntries > 2 ** bitDepth) return false
      sawPalette = true
    } else if (type === 'IDAT') {
      if (dataEnded || (colorType === 3 && !sawPalette)) return false
      compressedBytes += length
      if (
        compressedBytes > MAX_PNG_COMPRESSED_BYTES ||
        dataChunks.length >= MAX_CONTAINER_RECORDS
      ) {
        return false
      }
      dataChunks.push(data)
      sawData = true
    } else if (type === 'IEND') {
      if (
        length === 0 &&
        sawHeader &&
        sawData &&
        crcOffset + 4 === bytes.length &&
        (await validPngImageData(dataChunks, compressedBytes, expectedBytes, rowBytes, height))
      ) {
        return { width, height, frameCount: 1, decodePixels: width * height }
      }
      return null
    } else {
      if (sawData) dataEnded = true
      if (length > MAX_PNG_ANCILLARY_CHUNK_BYTES) return false
      ancillaryBytes += length
      if (ancillaryBytes > MAX_PNG_ANCILLARY_BYTES) return false
      if (type === 'tRNS') {
        if (sawTransparency || sawData) return false
        sawTransparency = true
      }
      if (!validPngAncillarySchema(type, data, bitDepth, colorType, paletteEntries)) {
        return false
      }
    }
    offset = crcOffset + 4
  }
  return null
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
])

const validJpeg = (bytes: Buffer): ValidatedBookImageContainer | false => {
  if (bytes.length < 14 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let offset = 2
  let records = 0
  let sawFrame = false
  let sawScan = false
  let imageWidth = 0
  let imageHeight = 0
  while (offset < bytes.length && ++records <= MAX_CONTAINER_RECORDS) {
    if (bytes[offset] !== 0xff) return false
    while (bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return false
    const marker = bytes[offset] ?? -1
    offset += 1
    if (marker === 0xd9) {
      return sawFrame && sawScan && offset === bytes.length
        ? {
            width: imageWidth,
            height: imageHeight,
            frameCount: 1,
            decodePixels: imageWidth * imageHeight
          }
        : false
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || marker === 0xd0) return false
    if (marker >= 0xd1 && marker <= 0xd7) return false
    if (offset + 2 > bytes.length) return false
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return false
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8 || sawFrame) return false
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (!validDimensions(width, height)) return false
      imageWidth = width
      imageHeight = height
      sawFrame = true
    }
    offset += length
    if (marker !== 0xda) continue
    sawScan = true
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const markerStart = offset
      while (bytes[offset] === 0xff) offset += 1
      if (offset >= bytes.length) return false
      const scanMarker = bytes[offset] ?? -1
      offset += 1
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) continue
      if (scanMarker === 0xd9) {
        return sawFrame && offset === bytes.length
          ? {
              width: imageWidth,
              height: imageHeight,
              frameCount: 1,
              decodePixels: imageWidth * imageHeight
            }
          : false
      }
      offset = markerStart
      break
    }
  }
  return false
}

const skipGifSubBlocks = (bytes: Buffer, start: number): number | null => {
  let offset = start
  let records = 0
  while (offset < bytes.length && ++records <= MAX_CONTAINER_RECORDS) {
    const length = bytes[offset] ?? -1
    offset += 1
    if (length === 0) return offset
    if (length < 0 || offset + length > bytes.length) return null
    offset += length
  }
  return null
}

const validGif = (bytes: Buffer): ValidatedBookImageContainer | false => {
  if (bytes.length < 20 || !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) {
    return false
  }
  const canvasWidth = bytes.readUInt16LE(6)
  const canvasHeight = bytes.readUInt16LE(8)
  if (!validDimensions(canvasWidth, canvasHeight)) return false
  const globalPacked = bytes[10] ?? 0
  let offset = 13
  if ((globalPacked & 0x80) !== 0) offset += 3 * 2 ** ((globalPacked & 0x07) + 1)
  if (offset > bytes.length) return false
  let frames = 0
  let decodePixels = 0
  let records = 0
  while (offset < bytes.length && ++records <= MAX_CONTAINER_RECORDS) {
    const introducer = bytes[offset] ?? -1
    offset += 1
    if (introducer === 0x3b) {
      return frames > 0 && offset === bytes.length
        ? {
            width: canvasWidth,
            height: canvasHeight,
            frameCount: frames,
            decodePixels
          }
        : false
    }
    if (introducer === 0x21) {
      if (offset >= bytes.length) return false
      offset += 1
      const next = skipGifSubBlocks(bytes, offset)
      if (next === null) return false
      offset = next
      continue
    }
    if (introducer !== 0x2c || offset + 9 > bytes.length) return false
    const width = bytes.readUInt16LE(offset + 4)
    const height = bytes.readUInt16LE(offset + 6)
    const packed = bytes[offset + 8] ?? 0
    frames += 1
    decodePixels = canvasWidth * canvasHeight * frames
    if (
      !validDimensions(width, height) ||
      !validDimensions(canvasWidth, canvasHeight, frames) ||
      decodePixels > MAX_BOOK_IMAGE_DECODE_PIXELS
    ) {
      return false
    }
    offset += 9
    if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1)
    if (offset >= bytes.length || (bytes[offset] ?? 0) < 2 || (bytes[offset] ?? 0) > 8) {
      return false
    }
    offset += 1
    const next = skipGifSubBlocks(bytes, offset)
    if (next === null) return false
    offset = next
  }
  return false
}

const readUint24LE = (bytes: Buffer, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)

const webpDimensions = (type: string, bytes: Buffer): [number, number] | null => {
  if (type === 'VP8 ') {
    if (bytes.length < 10 || bytes[3] !== 0x9d || bytes[4] !== 0x01 || bytes[5] !== 0x2a) {
      return null
    }
    return [bytes.readUInt16LE(6) & 0x3fff, bytes.readUInt16LE(8) & 0x3fff]
  }
  if (type === 'VP8L') {
    if (bytes.length < 5 || bytes[0] !== 0x2f) return null
    const packed = bytes.readUInt32LE(1)
    return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1]
  }
  return null
}

const validWebp = (bytes: Buffer): ValidatedBookImageContainer | false => {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return false
  }
  let offset = 12
  let records = 0
  let imageDimensions: [number, number] | null = null
  let extendedDimensions: [number, number] | null = null
  const allowed = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP', 'EXIF', 'XMP '])
  while (offset < bytes.length && ++records <= MAX_CONTAINER_RECORDS) {
    if (offset + 8 > bytes.length) return false
    const type = bytes.subarray(offset, offset + 4).toString('ascii')
    const length = bytes.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const paddedEnd = dataEnd + (length & 1)
    if (!allowed.has(type) || dataEnd < dataStart || paddedEnd > bytes.length) return false
    const payload = bytes.subarray(dataStart, dataEnd)
    if (type === 'VP8X') {
      if (extendedDimensions || length !== 10 || ((payload[0] ?? 0) & 0xc3) !== 0) return false
      extendedDimensions = [readUint24LE(payload, 4) + 1, readUint24LE(payload, 7) + 1]
      if (!validDimensions(...extendedDimensions)) return false
    }
    if (type === 'VP8 ' || type === 'VP8L') {
      if (imageDimensions) return false
      imageDimensions = webpDimensions(type, payload)
      if (!imageDimensions || !validDimensions(...imageDimensions)) return false
    }
    offset = paddedEnd
  }
  if (
    offset !== bytes.length ||
    !imageDimensions ||
    (extendedDimensions &&
      (extendedDimensions[0] !== imageDimensions[0] ||
        extendedDimensions[1] !== imageDimensions[1]))
  ) {
    return false
  }
  return {
    width: imageDimensions[0],
    height: imageDimensions[1],
    frameCount: 1,
    decodePixels: imageDimensions[0] * imageDimensions[1]
  }
}

export const validateBookImageContainer = async (
  value: Uint8Array,
  mediaType: ValidatedBookImageMediaType
): Promise<ValidatedBookImageContainer | null> => {
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  switch (mediaType) {
    case 'image/png':
      return (await validPng(bytes)) || null
    case 'image/jpeg':
      return validJpeg(bytes) || null
    case 'image/gif':
      return validGif(bytes) || null
    case 'image/webp':
      return validWebp(bytes) || null
  }
}
