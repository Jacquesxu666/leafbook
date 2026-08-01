/* eslint-disable @stylistic/indent */
import path from 'path'
import { createHash } from 'crypto'
import { constants as fsConstants, type BigIntStats } from 'fs'
import fs, { type FileHandle } from 'fs/promises'
import {
  bookImageMediaTypeForReference,
  isSupportedBookImageReference,
  type BookImageMediaType
} from 'common/book/imagePolicy'
import { BOOK_RASTER_MAX_BYTES as MAX_BOOK_RESOURCE_BYTES } from 'common/book/rasterPolicy'
import { BOOK_SVG_MAX_RAW_BYTES, BOOK_SVG_MEDIA_TYPE } from 'common/book/svgPolicy'
import {
  validateBookImageContainer,
  type ValidatedBookImageContainer,
  type ValidatedBookImageMediaType
} from './imageContainer'
import { sanitizeBookSvg } from './svgSanitizer'

export { MAX_BOOK_RESOURCE_BYTES }

export type BookResourceMediaType = BookImageMediaType

export type BookResourceReadResult =
  | {
      ok: true
      bytes: Uint8Array
      mediaType: BookResourceMediaType
      metadata: ValidatedBookImageContainer
      rawSnapshot: BookResourceRawSnapshot
    }
  | {
      ok: false
      reason: 'invalid-reference' | 'not-found' | 'too-large' | 'type-mismatch' | 'unsafe-path'
    }

export interface BookResourceReaderHooks {
  /** Test seam used to exercise pathname replacement after the descriptor is pinned. */
  afterOpen?: (handle: FileHandle) => void | Promise<void>
  /** Test seam used to exercise in-place mutation immediately before the bounded read. */
  beforeRead?: (handle: FileHandle) => void | Promise<void>
}

export interface BookResourceRootIdentity {
  realPath: string
  dev: bigint
  ino: bigint
}

export interface BookResourceRawIdentity {
  path: string
  realPath: string
  dev: bigint
  ino: bigint
  mode: bigint
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  type: 'directory' | 'file'
}

export interface BookResourceRawSnapshot {
  root: BookResourceRawIdentity
  ancestors: BookResourceRawIdentity[]
  file: BookResourceRawIdentity
  rawSha256: string
  rawByteLength: number
}

const rawIdentity = (
  pathname: string,
  realPath: string,
  stat: BigIntStats,
  type: BookResourceRawIdentity['type']
): BookResourceRawIdentity => ({
  path: pathname,
  realPath,
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  nlink: stat.nlink,
  size: stat.size,
  mtimeNs: stat.mtimeNs,
  ctimeNs: stat.ctimeNs,
  type
})

export const isSupportedBookResourceReference = isSupportedBookImageReference

const withinRoot = (rootPath: string, candidatePath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

const resolveResourcePath = (
  rootPath: string,
  chapterPath: string,
  reference: unknown
): { absolutePath: string; mediaType: BookResourceMediaType } | null => {
  if (!isSupportedBookResourceReference(reference)) return null
  const mediaType = bookImageMediaTypeForReference(reference)
  if (!mediaType) return null
  const chapterDirectory = path.posix.dirname(chapterPath)
  const relativePath = path.posix.normalize(path.posix.join(chapterDirectory, reference))
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    path.posix.isAbsolute(relativePath)
  ) {
    return null
  }
  const absolutePath = path.resolve(rootPath, ...relativePath.split('/'))
  return withinRoot(rootPath, absolutePath) ? { absolutePath, mediaType } : null
}

const unchanged = (left: BigIntStats, right: BigIntStats): boolean =>
  left.isFile() &&
  right.isFile() &&
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

export async function readBookResourceFile(
  root: BookResourceRootIdentity,
  chapterPath: string,
  reference: unknown,
  hooks: BookResourceReaderHooks = {}
): Promise<BookResourceReadResult> {
  const rootPath = root.realPath
  const resolved = resolveResourcePath(rootPath, chapterPath, reference)
  if (!resolved) return { ok: false, reason: 'invalid-reference' }

  let handle: FileHandle | null = null
  let rootHandle: FileHandle | null = null
  try {
    const realRoot = await fs.realpath(rootPath)
    if (realRoot !== rootPath) return { ok: false, reason: 'unsafe-path' }
    const rootPathname = await fs.lstat(rootPath, { bigint: true })
    if (
      rootPathname.isSymbolicLink() ||
      !rootPathname.isDirectory() ||
      rootPathname.dev !== root.dev ||
      rootPathname.ino !== root.ino
    ) {
      return { ok: false, reason: 'unsafe-path' }
    }
    rootHandle = await fs.open(rootPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const rootBefore = await rootHandle.stat({ bigint: true })
    if (!rootBefore.isDirectory() || rootBefore.dev !== root.dev || rootBefore.ino !== root.ino) {
      return { ok: false, reason: 'unsafe-path' }
    }

    const relative = path.relative(rootPath, resolved.absolutePath)
    const components = relative.split(path.sep)
    const ancestors: BookResourceRawIdentity[] = []
    let current = rootPath
    for (const component of components.slice(0, -1)) {
      current = path.join(current, component)
      const stat = await fs.lstat(current, { bigint: true })
      const realPath = await fs.realpath(current)
      if (stat.isSymbolicLink() || !stat.isDirectory() || realPath !== current) {
        return { ok: false, reason: 'unsafe-path' }
      }
      ancestors.push(rawIdentity(current, realPath, stat, 'directory'))
    }

    const pathnameBefore = await fs.lstat(resolved.absolutePath, { bigint: true })
    const maximumBytes =
      resolved.mediaType === BOOK_SVG_MEDIA_TYPE ? BOOK_SVG_MAX_RAW_BYTES : MAX_BOOK_RESOURCE_BYTES
    if (
      pathnameBefore.isSymbolicLink() ||
      !pathnameBefore.isFile() ||
      pathnameBefore.nlink !== 1n ||
      pathnameBefore.size < 0n
    ) {
      return { ok: false, reason: 'unsafe-path' }
    }
    if (pathnameBefore.size > BigInt(maximumBytes)) {
      return { ok: false, reason: 'too-large' }
    }
    if ((await fs.realpath(resolved.absolutePath)) !== resolved.absolutePath) {
      return { ok: false, reason: 'unsafe-path' }
    }

    handle = await fs.open(
      resolved.absolutePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    )
    await hooks.afterOpen?.(handle)
    const before = await handle.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.dev !== pathnameBefore.dev ||
      before.ino !== pathnameBefore.ino ||
      before.mode !== pathnameBefore.mode ||
      before.size !== pathnameBefore.size ||
      before.mtimeNs !== pathnameBefore.mtimeNs ||
      before.ctimeNs !== pathnameBefore.ctimeNs ||
      before.size > BigInt(maximumBytes)
    ) {
      return { ok: false, reason: 'unsafe-path' }
    }

    await hooks.beforeRead?.(handle)
    const byteLength = Number(before.size)
    if (!Number.isSafeInteger(byteLength)) return { ok: false, reason: 'too-large' }
    const bytes = Buffer.alloc(byteLength)
    let offset = 0
    while (offset < byteLength) {
      const read = await handle.read(bytes, offset, byteLength - offset, offset)
      if (read.bytesRead <= 0) return { ok: false, reason: 'unsafe-path' }
      offset += read.bytesRead
    }
    const probe = Buffer.alloc(1)
    if ((await handle.read(probe, 0, 1, byteLength)).bytesRead !== 0) {
      return { ok: false, reason: 'unsafe-path' }
    }
    const after = await handle.stat({ bigint: true })
    const pathnameAfter = await fs.lstat(resolved.absolutePath, { bigint: true })
    const resourceRealPathAfter = await fs.realpath(resolved.absolutePath)
    if (
      !unchanged(before, after) ||
      pathnameAfter.isSymbolicLink() ||
      pathnameAfter.dev !== before.dev ||
      pathnameAfter.ino !== before.ino ||
      pathnameAfter.mode !== before.mode ||
      pathnameAfter.size !== before.size ||
      pathnameAfter.mtimeNs !== before.mtimeNs ||
      pathnameAfter.ctimeNs !== before.ctimeNs ||
      pathnameAfter.nlink !== 1n ||
      resourceRealPathAfter !== resolved.absolutePath ||
      !withinRoot(rootPath, resourceRealPathAfter)
    ) {
      return { ok: false, reason: 'unsafe-path' }
    }
    for (const ancestor of ancestors) {
      const stat = await fs.lstat(ancestor.path, { bigint: true })
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        stat.dev !== ancestor.dev ||
        stat.ino !== ancestor.ino ||
        stat.mode !== ancestor.mode ||
        (await fs.realpath(ancestor.path)) !== ancestor.realPath
      ) {
        return { ok: false, reason: 'unsafe-path' }
      }
    }
    const sanitizedSvg = resolved.mediaType === BOOK_SVG_MEDIA_TYPE ? sanitizeBookSvg(bytes) : null
    const metadata =
      resolved.mediaType === BOOK_SVG_MEDIA_TYPE
        ? sanitizedSvg
        : await validateBookImageContainer(bytes, resolved.mediaType as ValidatedBookImageMediaType)
    if (!metadata) return { ok: false, reason: 'type-mismatch' }
    const safeBytes = sanitizedSvg?.bytes ?? new Uint8Array(bytes)
    const rootAfter = await rootHandle.stat({ bigint: true })
    const rootPathnameAfter = await fs.lstat(rootPath, { bigint: true })
    if (
      !rootAfter.isDirectory() ||
      rootAfter.dev !== rootBefore.dev ||
      rootAfter.ino !== rootBefore.ino ||
      rootAfter.mode !== rootBefore.mode ||
      rootAfter.nlink !== rootBefore.nlink ||
      rootAfter.mtimeNs !== rootBefore.mtimeNs ||
      rootAfter.ctimeNs !== rootBefore.ctimeNs ||
      rootPathnameAfter.isSymbolicLink() ||
      !rootPathnameAfter.isDirectory() ||
      rootPathnameAfter.dev !== root.dev ||
      rootPathnameAfter.ino !== root.ino
    ) {
      return { ok: false, reason: 'unsafe-path' }
    }
    const result: BookResourceReadResult = {
      ok: true,
      bytes: safeBytes,
      mediaType: resolved.mediaType,
      metadata
    } as BookResourceReadResult
    Object.defineProperty(result, 'rawSnapshot', {
      value: {
        root: rawIdentity(rootPath, realRoot, rootBefore, 'directory'),
        ancestors,
        file: rawIdentity(resolved.absolutePath, resourceRealPathAfter, after, 'file'),
        rawSha256: createHash('sha256').update(bytes).digest('hex'),
        rawByteLength: bytes.byteLength
      } satisfies BookResourceRawSnapshot,
      enumerable: false,
      configurable: false,
      writable: false
    })
    return result
  } catch (readError) {
    const code = (readError as NodeJS.ErrnoException).code
    return {
      ok: false,
      reason: code === 'ENOENT' ? 'not-found' : code === 'EFBIG' ? 'too-large' : 'unsafe-path'
    }
  } finally {
    await handle?.close().catch(() => undefined)
    await rootHandle?.close().catch(() => undefined)
  }
}
