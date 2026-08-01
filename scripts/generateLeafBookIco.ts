import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REQUIRED_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

export function readIcoSizes(buffer: Buffer): number[] {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('Invalid ICO header')
  }
  const count = buffer.readUInt16LE(4)
  if (count === 0 || buffer.length < 6 + count * 16) {
    throw new Error('ICO contains no complete directory entries')
  }
  return Array.from({ length: count }, (_, index) => {
    const width = buffer.readUInt8(6 + index * 16)
    const height = buffer.readUInt8(7 + index * 16)
    const normalizedWidth = width === 0 ? 256 : width
    const normalizedHeight = height === 0 ? 256 : height
    if (normalizedWidth !== normalizedHeight) {
      throw new Error(`ICO layer is not square: ${normalizedWidth}x${normalizedHeight}`)
    }
    return normalizedWidth
  })
}

export function createIco(pngInputs: Array<{ size: number; path: string }>): Buffer {
  const orderedInputs = [...pngInputs].sort((left, right) => left.size - right.size)
  if (orderedInputs.map(({ size }) => size).join(',') !== REQUIRED_ICO_SIZES.join(',')) {
    throw new Error(`ICO inputs must contain sizes ${REQUIRED_ICO_SIZES.join(', ')}`)
  }

  const images = orderedInputs.map(({ size, path: imagePath }) => {
    const buffer = fs.readFileSync(imagePath)
    if (
      buffer.subarray(1, 4).toString('ascii') !== 'PNG' ||
      buffer.readUInt32BE(16) !== size ||
      buffer.readUInt32BE(20) !== size
    ) {
      throw new Error(`Invalid ${size}x${size} PNG input: ${imagePath}`)
    }
    return { size, buffer }
  })
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = headerSize
  images.forEach(({ size, buffer }, index) => {
    const entryOffset = 6 + index * 16
    header.writeUInt8(size === 256 ? 0 : size, entryOffset)
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
    header.writeUInt8(0, entryOffset + 2)
    header.writeUInt8(0, entryOffset + 3)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(buffer.length, entryOffset + 8)
    header.writeUInt32LE(offset, entryOffset + 12)
    offset += buffer.length
  })
  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)])
}

function main(): void {
  const [outputPath, ...inputArguments] = process.argv.slice(2)
  if (!outputPath) {
    throw new Error('Usage: generateLeafBookIco.ts OUTPUT.ico SIZE=INPUT.png ...')
  }
  const inputs = inputArguments.map((argument) => {
    const separator = argument.indexOf('=')
    if (separator < 1) {
      throw new Error(`Invalid ICO input argument: ${argument}`)
    }
    return {
      size: Number(argument.slice(0, separator)),
      path: argument.slice(separator + 1)
    }
  })
  fs.writeFileSync(outputPath, createIco(inputs))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
