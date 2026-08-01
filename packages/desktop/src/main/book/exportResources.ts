/* eslint-disable @stylistic/space-before-function-paren */
import { createHash } from 'crypto'
import fs, { constants as fsConstants, type BigIntStats } from 'fs'
import path from 'path'
import {
  bookImageMediaTypeForReference,
  BOOK_IMAGE_GENERATION_MAX_DECODE_PIXELS,
  BOOK_IMAGE_GENERATION_MAX_FRAMES,
  type BookImageMediaType
} from 'common/book/imagePolicy'
import { BOOK_RASTER_MAX_BYTES } from 'common/book/rasterPolicy'
import { BOOK_SVG_MAX_RAW_BYTES, BOOK_SVG_MEDIA_TYPE } from 'common/book/svgPolicy'
import {
  readBookResourceFile,
  type BookResourceRawIdentity,
  type BookResourceRawSnapshot,
  type BookResourceRootIdentity
} from './resourceReader'
import { extractBookImageOccurrencePlan } from './resourceReferences'

export const BOOK_EXPORT_HTML_MAX_ASSET_BYTES = 24 * 1024 * 1024
export const BOOK_EXPORT_WEBSITE_MAX_ASSET_BYTES = 32 * 1024 * 1024
export const BOOK_EXPORT_MAX_ASSETS = 256
export const BOOK_EXPORT_MAX_RESOURCE_REFERENCES = 2_048
export const BOOK_EXPORT_MAX_RAW_REFERENCE_BYTES = 32 * 1024 * 1024
export const BOOK_EXPORT_MAX_SINGLE_ASSET_BYTES = 6 * 1024 * 1024
export const BOOK_EXPORT_HTML_MAX_EXPANDED_DATA_URL_CHARACTERS = 48 * 1024 * 1024
export const BOOK_EXPORT_MAX_DECODE_PIXELS = BOOK_IMAGE_GENERATION_MAX_DECODE_PIXELS * 2
export const BOOK_EXPORT_MAX_FRAMES = BOOK_IMAGE_GENERATION_MAX_FRAMES * 2

export class BookExportResourceLedgerError extends Error {
  constructor(
    readonly code: 'budget' | 'source-unverifiable',
    message: string
  ) {
    super(message)
    this.name = 'BookExportResourceLedgerError'
  }
}

const resourceBudgetError = (): BookExportResourceLedgerError =>
  new BookExportResourceLedgerError('budget', 'export-resource-budget')

const sourceUnverifiableError = (): BookExportResourceLedgerError =>
  new BookExportResourceLedgerError('source-unverifiable', 'export-resource-unverifiable')

export interface BookExportResourceDocument {
  documentId: string
  path: string
  markdown: string | null
}

export interface BookExportAsset {
  sha256: string
  mediaType: BookImageMediaType
  extension: 'png' | 'jpg' | 'gif' | 'webp' | 'svg'
  bytes: Uint8Array
  byteLength: number
  width: number
  height: number
  frameCount: number
  decodePixels: number
}

export interface BookExportResourceLedger {
  kind: 'html' | 'website'
  assets: BookExportAsset[]
  targetsByDocument: Map<string, Array<string | null>>
  referencesByDocument: Map<string, string[]>
  rawSnapshots: BookResourceRawSnapshot[]
  sourceStates: BookExportResourceSourceState[]
  fingerprint: string
  expectedImageSources: string[]
  expectedResourceSequence: string[]
}

interface BookExportObservedIdentity {
  path: string
  realPath: string | null
  linkTarget: string | null
  dev: bigint
  ino: bigint
  mode: bigint
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  type: 'directory' | 'file' | 'symlink' | 'other'
}

interface BookExportNegativeResourceSnapshot {
  reason: 'not-found' | 'too-large' | 'type-mismatch' | 'unsafe-path'
  absolutePath: string
  missingPath: string | null
  observed: BookExportObservedIdentity[]
  rawSha256: string | null
  rawByteLength: number | null
}

interface BookExportRawPhysicalProof {
  dev: bigint
  ino: bigint
  mode: bigint
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  rawSha256: string
  rawByteLength: number
}

interface BookExportRawPhysicalLedger {
  proofs: Map<string, BookExportRawPhysicalProof>
  totalBytes: number
}

export interface BookExportResourceSourceState {
  key: string
  chapterPath: string
  reference: string
  state:
    | { kind: 'positive'; snapshot: BookResourceRawSnapshot }
    | { kind: 'negative'; snapshot: BookExportNegativeResourceSnapshot }
}

const extensionForMediaType = (
  mediaType: BookImageMediaType
): BookExportAsset['extension'] | null => {
  switch (mediaType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default:
      return null
  }
}

const dataUrl = (asset: BookExportAsset): string =>
  `data:${asset.mediaType};base64,${Buffer.from(asset.bytes).toString('base64')}`

export const addExpandedBookExportTargetCharacters = (
  current: number,
  occurrences: readonly string[],
  targets: ReadonlyMap<string, string | null>
): number | null => {
  let total = current
  for (const reference of occurrences) {
    total += targets.get(reference)?.length ?? 0
    if (!Number.isSafeInteger(total) || total > BOOK_EXPORT_HTML_MAX_EXPANDED_DATA_URL_CHARACTERS) {
      return null
    }
  }
  return total
}

export const assetRelativePath = (asset: BookExportAsset): string =>
  `assets/${asset.sha256}.${asset.extension}`

const statType = (stat: BigIntStats): BookExportObservedIdentity['type'] =>
  stat.isSymbolicLink()
    ? 'symlink'
    : stat.isDirectory()
      ? 'directory'
      : stat.isFile()
        ? 'file'
        : 'other'

const observedIdentitySync = (pathname: string, stat: BigIntStats): BookExportObservedIdentity => {
  let realPath: string | null = null
  let linkTarget: string | null = null
  if (stat.isSymbolicLink()) {
    linkTarget = fs.readlinkSync(pathname)
    try {
      realPath = fs.realpathSync(pathname)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  } else {
    realPath = fs.realpathSync(pathname)
  }
  return {
    path: pathname,
    realPath,
    linkTarget,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    type: statType(stat)
  }
}

const sameObservedStat = (stat: BigIntStats, expected: BookExportObservedIdentity): boolean =>
  statType(stat) === expected.type &&
  stat.dev === expected.dev &&
  stat.ino === expected.ino &&
  stat.mode === expected.mode &&
  stat.nlink === expected.nlink &&
  stat.size === expected.size &&
  stat.mtimeNs === expected.mtimeNs &&
  stat.ctimeNs === expected.ctimeNs

const physicalKey = (identity: { dev: bigint; ino: bigint }): string =>
  `${identity.dev.toString()}:${identity.ino.toString()}`

const samePhysicalMetadata = (
  left: BookExportRawPhysicalProof,
  right: Omit<BookExportRawPhysicalProof, 'rawSha256' | 'rawByteLength'>
): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const registerRawPhysicalProof = (
  ledger: BookExportRawPhysicalLedger,
  identity: Omit<BookExportRawPhysicalProof, 'rawSha256' | 'rawByteLength'>,
  raw: { rawSha256: string; rawByteLength: number }
): BookExportRawPhysicalProof => {
  const key = physicalKey(identity)
  const existing = ledger.proofs.get(key)
  if (existing) {
    if (
      !samePhysicalMetadata(existing, identity) ||
      existing.rawSha256 !== raw.rawSha256 ||
      existing.rawByteLength !== raw.rawByteLength
    ) {
      throw sourceUnverifiableError()
    }
    return existing
  }
  const totalBytes = ledger.totalBytes + raw.rawByteLength
  if (!Number.isSafeInteger(totalBytes) || totalBytes > BOOK_EXPORT_MAX_RAW_REFERENCE_BYTES) {
    throw resourceBudgetError()
  }
  const proof = { ...identity, ...raw }
  ledger.proofs.set(key, proof)
  ledger.totalBytes = totalBytes
  return proof
}

const physicalMetadata = (
  identity: BookExportObservedIdentity | BookResourceRawIdentity
): Omit<BookExportRawPhysicalProof, 'rawSha256' | 'rawByteLength'> => ({
  dev: identity.dev,
  ino: identity.ino,
  mode: identity.mode,
  nlink: identity.nlink,
  size: identity.size,
  mtimeNs: identity.mtimeNs,
  ctimeNs: identity.ctimeNs
})

const stableRawFileSync = (
  pathname: string,
  expected: BookExportObservedIdentity,
  maximumBytes: number,
  physicalLedger: BookExportRawPhysicalLedger
): { rawSha256: string; rawByteLength: number } | null => {
  if (expected.type !== 'file' || expected.size < 0n || expected.size > BigInt(maximumBytes)) {
    return null
  }
  const byteLength = Number(expected.size)
  if (!Number.isSafeInteger(byteLength)) throw sourceUnverifiableError()
  const cached = physicalLedger.proofs.get(physicalKey(expected))
  if (cached) {
    if (!samePhysicalMetadata(cached, physicalMetadata(expected))) {
      throw sourceUnverifiableError()
    }
    return { rawSha256: cached.rawSha256, rawByteLength: cached.rawByteLength }
  }
  if (physicalLedger.totalBytes + byteLength > BOOK_EXPORT_MAX_RAW_REFERENCE_BYTES) {
    throw resourceBudgetError()
  }
  let fd: number | null = null
  let closeFailed = false
  let result: { rawSha256: string; rawByteLength: number } | null = null
  try {
    fd = fs.openSync(
      pathname,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    )
    const before = fs.fstatSync(fd, { bigint: true })
    if (!sameObservedStat(before, expected)) throw sourceUnverifiableError()
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, byteLength)))
    let offset = 0
    while (offset < byteLength) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, byteLength - offset), offset)
      if (count <= 0) throw sourceUnverifiableError()
      hash.update(buffer.subarray(0, count))
      offset += count
    }
    if (fs.readSync(fd, buffer, 0, 1, byteLength) !== 0) {
      throw sourceUnverifiableError()
    }
    const after = fs.fstatSync(fd, { bigint: true })
    const pathnameAfter = fs.lstatSync(pathname, { bigint: true })
    if (
      !sameObservedStat(after, expected) ||
      !sameObservedStat(pathnameAfter, expected) ||
      fs.realpathSync(pathname) !== expected.realPath
    ) {
      throw sourceUnverifiableError()
    }
    result = registerRawPhysicalProof(physicalLedger, physicalMetadata(expected), {
      rawSha256: hash.digest('hex'),
      rawByteLength: byteLength
    })
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        closeFailed = true
      }
    }
  }
  if (closeFailed || !result) throw sourceUnverifiableError()
  return result
}

const resolveExportResourcePath = (
  rootPath: string,
  chapterPath: string,
  reference: string
): string | null => {
  const relativePath = path.posix.normalize(
    path.posix.join(path.posix.dirname(chapterPath), reference)
  )
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    path.posix.isAbsolute(relativePath)
  ) {
    return null
  }
  const absolutePath = path.resolve(rootPath, ...relativePath.split('/'))
  const relative = path.relative(rootPath, absolutePath)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    ? absolutePath
    : null
}

const captureNegativeResourceSnapshotSync = (
  root: BookResourceRootIdentity,
  chapterPath: string,
  reference: string,
  reason: BookExportNegativeResourceSnapshot['reason'],
  physicalLedger: BookExportRawPhysicalLedger
): BookExportNegativeResourceSnapshot => {
  const absolutePath = resolveExportResourcePath(root.realPath, chapterPath, reference)
  if (!absolutePath) throw sourceUnverifiableError()
  const rootStat = fs.lstatSync(root.realPath, { bigint: true })
  const rootObserved = observedIdentitySync(root.realPath, rootStat)
  if (
    rootObserved.type !== 'directory' ||
    rootObserved.realPath !== root.realPath ||
    rootObserved.dev !== root.dev ||
    rootObserved.ino !== root.ino
  ) {
    throw sourceUnverifiableError()
  }
  const observed = [rootObserved]
  const relative = path.relative(root.realPath, absolutePath)
  const components = relative.split(path.sep)
  let current = root.realPath
  for (const [index, component] of components.entries()) {
    current = path.join(current, component)
    let stat: BigIntStats
    try {
      stat = fs.lstatSync(current, { bigint: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (reason !== 'not-found') throw sourceUnverifiableError()
      return {
        reason,
        absolutePath,
        missingPath: current,
        observed,
        rawSha256: null,
        rawByteLength: null
      }
    }
    const identity = observedIdentitySync(current, stat)
    observed.push(identity)
    const final = index === components.length - 1
    if (!final && (identity.type !== 'directory' || identity.realPath !== current)) break
    if (final) break
  }
  if (reason === 'not-found') throw sourceUnverifiableError()
  const leaf = observed.at(-1)
  if (!leaf || leaf.path === root.realPath) throw sourceUnverifiableError()
  const mediaType = bookImageMediaTypeForReference(reference)
  if (!mediaType) throw sourceUnverifiableError()
  const maximumBytes =
    mediaType === BOOK_SVG_MEDIA_TYPE ? BOOK_SVG_MAX_RAW_BYTES : BOOK_RASTER_MAX_BYTES
  const raw = stableRawFileSync(leaf.path, leaf, maximumBytes, physicalLedger)
  if (reason === 'too-large' && !(leaf.type === 'file' && leaf.size > BigInt(maximumBytes))) {
    throw sourceUnverifiableError()
  }
  if (reason === 'type-mismatch' && !raw) throw sourceUnverifiableError()
  if (
    reason === 'unsafe-path' &&
    leaf.path === absolutePath &&
    leaf.type === 'file' &&
    leaf.nlink === 1n &&
    leaf.realPath === absolutePath
  ) {
    throw sourceUnverifiableError()
  }
  return {
    reason,
    absolutePath,
    missingPath: null,
    observed,
    rawSha256: raw?.rawSha256 ?? null,
    rawByteLength: raw?.rawByteLength ?? null
  }
}

const bigintComparable = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(bigintComparable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      bigintComparable(item)
    ])
  )
}

const sourceStateComparable = (state: BookExportResourceSourceState): unknown =>
  bigintComparable(state)

const comparable = (ledger: BookExportResourceLedger): object => ({
  kind: ledger.kind,
  assets: ledger.assets.map(({ bytes: _bytes, ...asset }) => asset),
  rawSnapshots: ledger.rawSnapshots.map((snapshot) => ({
    rawSha256: snapshot.rawSha256,
    rawByteLength: snapshot.rawByteLength,
    identities: [snapshot.root, ...snapshot.ancestors, snapshot.file].map((identity) => ({
      ...identity,
      dev: identity.dev.toString(),
      ino: identity.ino.toString(),
      mode: identity.mode.toString(),
      nlink: identity.nlink.toString(),
      size: identity.size.toString(),
      mtimeNs: identity.mtimeNs.toString(),
      ctimeNs: identity.ctimeNs.toString()
    }))
  })),
  sourceStates: ledger.sourceStates.map(sourceStateComparable),
  documents: [...ledger.referencesByDocument].map(([documentId, references]) => ({
    documentId,
    references,
    targets: ledger.targetsByDocument.get(documentId) ?? []
  })),
  expectedResourceSequence: ledger.expectedResourceSequence
})

const sameRawIdentity = (stat: BigIntStats, expected: BookResourceRawIdentity): boolean =>
  (expected.type === 'file' ? stat.isFile() : stat.isDirectory()) &&
  !stat.isSymbolicLink() &&
  stat.dev === expected.dev &&
  stat.ino === expected.ino &&
  stat.mode === expected.mode &&
  stat.nlink === expected.nlink &&
  stat.size === expected.size &&
  stat.mtimeNs === expected.mtimeNs &&
  stat.ctimeNs === expected.ctimeNs

const identityCurrentSync = (expected: BookResourceRawIdentity): boolean => {
  try {
    const stat = fs.lstatSync(expected.path, { bigint: true })
    return sameRawIdentity(stat, expected) && fs.realpathSync(expected.path) === expected.realPath
  } catch {
    return false
  }
}

export const exportResourcesCurrentSync = (ledger: BookExportResourceLedger): boolean => {
  const physicalLedger: BookExportRawPhysicalLedger = { proofs: new Map(), totalBytes: 0 }
  for (const snapshot of ledger.rawSnapshots) {
    if (!identityCurrentSync(snapshot.root)) return false
    for (const ancestor of snapshot.ancestors) {
      if (!identityCurrentSync(ancestor)) return false
    }
    try {
      const pathname = fs.lstatSync(snapshot.file.path, { bigint: true })
      if (!sameRawIdentity(pathname, snapshot.file) || pathname.nlink !== 1n) return false
      const raw = stableRawFileSync(
        snapshot.file.path,
        { ...snapshot.file, type: 'file', linkTarget: null },
        snapshot.rawByteLength,
        physicalLedger
      )
      if (
        !raw ||
        raw.rawByteLength !== snapshot.rawByteLength ||
        raw.rawSha256 !== snapshot.rawSha256
      ) {
        return false
      }
    } catch {
      return false
    }
  }
  for (const source of ledger.sourceStates) {
    if (source.state.kind !== 'negative') continue
    const expected = source.state.snapshot
    const root = expected.observed[0]
    if (!root) return false
    try {
      const current = captureNegativeResourceSnapshotSync(
        { realPath: root.path, dev: root.dev, ino: root.ino },
        source.chapterPath,
        source.reference,
        expected.reason,
        physicalLedger
      )
      if (
        JSON.stringify(bigintComparable(current)) !== JSON.stringify(bigintComparable(expected))
      ) {
        return false
      }
    } catch {
      return false
    }
  }
  return true
}

export const disposeBookExportResourceLedger = (ledger: BookExportResourceLedger): void => {
  for (const asset of ledger.assets) asset.bytes.fill(0)
  ledger.assets.length = 0
  ledger.rawSnapshots.length = 0
  ledger.sourceStates.length = 0
  ledger.expectedImageSources.length = 0
  ledger.expectedResourceSequence.length = 0
  ledger.targetsByDocument.clear()
  ledger.referencesByDocument.clear()
  ledger.fingerprint = ''
}

export const sameBookExportResourceLedger = (
  left: BookExportResourceLedger,
  right: BookExportResourceLedger
): boolean => left.fingerprint === right.fingerprint

export const buildBookExportResourceLedger = async (
  root: BookResourceRootIdentity,
  documents: readonly BookExportResourceDocument[],
  kind: 'html' | 'website'
): Promise<BookExportResourceLedger> => {
  const assetsByHash = new Map<string, BookExportAsset>()
  const referencesByDocument = new Map<string, string[]>()
  const hashesByDocumentReference = new Map<string, Map<string, string | null>>()
  const rawSnapshotsByPhysical = new Map<string, BookResourceRawSnapshot>()
  const sourceStatesByKey = new Map<string, BookExportResourceSourceState>()
  const readsByDocumentReference = new Map<
    string,
    Awaited<ReturnType<typeof readBookResourceFile>>
  >()
  let referenceCount = 0
  let totalBytes = 0
  let totalDecodePixels = 0
  let totalFrames = 0
  const physicalLedger: BookExportRawPhysicalLedger = { proofs: new Map(), totalBytes: 0 }
  const maximumBytes =
    kind === 'html' ? BOOK_EXPORT_HTML_MAX_ASSET_BYTES : BOOK_EXPORT_WEBSITE_MAX_ASSET_BYTES

  for (const document of documents) {
    const occurrences = document.markdown
      ? [...extractBookImageOccurrencePlan(document.markdown)]
      : []
    referenceCount += occurrences.length
    if (referenceCount > BOOK_EXPORT_MAX_RESOURCE_REFERENCES) {
      throw resourceBudgetError()
    }
    referencesByDocument.set(document.documentId, occurrences)
    const hashes = new Map<string, string | null>()
    const references = [...new Set(occurrences)]
    for (const reference of references) {
      const readKey = `${document.path}\0${reference}`
      let read = readsByDocumentReference.get(readKey)
      if (!read) {
        read = await readBookResourceFile(root, document.path, reference)
        readsByDocumentReference.set(readKey, read)
      }
      if (!read.ok) {
        if (read.reason === 'invalid-reference') throw sourceUnverifiableError()
        let negative: BookExportNegativeResourceSnapshot
        try {
          negative = captureNegativeResourceSnapshotSync(
            root,
            document.path,
            reference,
            read.reason,
            physicalLedger
          )
        } catch (snapshotError) {
          if (snapshotError instanceof BookExportResourceLedgerError) throw snapshotError
          throw sourceUnverifiableError()
        }
        sourceStatesByKey.set(readKey, {
          key: readKey,
          chapterPath: document.path,
          reference,
          state: { kind: 'negative', snapshot: negative }
        })
        hashes.set(reference, null)
        continue
      }
      sourceStatesByKey.set(readKey, {
        key: readKey,
        chapterPath: document.path,
        reference,
        state: { kind: 'positive', snapshot: read.rawSnapshot }
      })
      registerRawPhysicalProof(physicalLedger, physicalMetadata(read.rawSnapshot.file), {
        rawSha256: read.rawSnapshot.rawSha256,
        rawByteLength: read.rawSnapshot.rawByteLength
      })
      const rawKey = physicalKey(read.rawSnapshot.file)
      if (!rawSnapshotsByPhysical.has(rawKey)) {
        rawSnapshotsByPhysical.set(rawKey, read.rawSnapshot)
      }
      const sha256 = createHash('sha256').update(read.bytes).digest('hex')
      let asset = assetsByHash.get(sha256)
      if (!asset) {
        const extension = extensionForMediaType(read.mediaType)
        if (!extension) {
          hashes.set(reference, null)
          continue
        }
        asset = {
          sha256,
          mediaType: read.mediaType,
          extension,
          bytes: new Uint8Array(read.bytes),
          byteLength: read.bytes.byteLength,
          width: read.metadata.width,
          height: read.metadata.height,
          frameCount: read.metadata.frameCount,
          decodePixels: read.metadata.decodePixels
        }
        totalBytes += asset.byteLength
        totalDecodePixels += asset.decodePixels
        totalFrames += asset.frameCount
        if (
          asset.byteLength > BOOK_EXPORT_MAX_SINGLE_ASSET_BYTES ||
          assetsByHash.size >= BOOK_EXPORT_MAX_ASSETS ||
          totalBytes > maximumBytes ||
          totalDecodePixels > BOOK_EXPORT_MAX_DECODE_PIXELS ||
          totalFrames > BOOK_EXPORT_MAX_FRAMES
        ) {
          throw resourceBudgetError()
        }
        assetsByHash.set(sha256, asset)
      }
      hashes.set(reference, sha256)
    }
    hashesByDocumentReference.set(document.documentId, hashes)
  }

  const assets = [...assetsByHash.values()].sort((left, right) =>
    left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0
  )
  const targetByHash = new Map(
    assets.map((asset) => [
      asset.sha256,
      kind === 'html' ? dataUrl(asset) : assetRelativePath(asset)
    ])
  )
  const targetsByDocument = new Map<string, Array<string | null>>()
  const targetByDocumentReference = new Map<string, Map<string, string | null>>()
  let expandedDataUrlCharacters = 0
  for (const document of documents) {
    const hashes = hashesByDocumentReference.get(document.documentId) ?? new Map()
    const targets = new Map<string, string | null>()
    for (const [reference, hash] of hashes) {
      targets.set(reference, hash ? (targetByHash.get(hash) ?? null) : null)
    }
    targetByDocumentReference.set(document.documentId, targets)
    targetsByDocument.set(document.documentId, [...targets.values()])
    if (kind === 'html') {
      const expanded = addExpandedBookExportTargetCharacters(
        expandedDataUrlCharacters,
        referencesByDocument.get(document.documentId) ?? [],
        targets
      )
      if (expanded === null) throw resourceBudgetError()
      expandedDataUrlCharacters = expanded
    }
  }
  const expectedImageSources = documents.flatMap((document) =>
    (referencesByDocument.get(document.documentId) ?? [])
      .map(
        (reference) => targetByDocumentReference.get(document.documentId)?.get(reference) ?? null
      )
      .filter((target): target is string => target !== null)
  )
  const expectedResourceSequence = documents.flatMap((document) => {
    const references = referencesByDocument.get(document.documentId) ?? []
    const targets = targetByDocumentReference.get(document.documentId) ?? new Map()
    const uniqueReferences = [...targets.keys()]
    const indexByReference = new Map(
      uniqueReferences.map((reference, index) => [reference, `image-${index}`])
    )
    return references.map(
      (reference) => targets.get(reference) ?? `placeholder:${indexByReference.get(reference)}`
    )
  })
  const provisional: BookExportResourceLedger = {
    kind,
    assets,
    targetsByDocument,
    referencesByDocument,
    rawSnapshots: [...rawSnapshotsByPhysical.values()].sort((left, right) =>
      left.file.realPath < right.file.realPath
        ? -1
        : left.file.realPath > right.file.realPath
          ? 1
          : 0
    ),
    sourceStates: [...sourceStatesByKey.values()].sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    ),
    fingerprint: '',
    expectedImageSources,
    expectedResourceSequence
  }
  provisional.fingerprint = createHash('sha256')
    .update(JSON.stringify(comparable(provisional)))
    .digest('hex')
  return provisional
}
