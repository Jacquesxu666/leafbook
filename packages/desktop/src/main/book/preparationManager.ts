import path from 'path'
import fs from 'fs/promises'
import fsSync, { constants as fsConstants, type BigIntStats } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { analyzeAtxH1Headings } from 'leafbook-muya-heading-analyzer'
import { validateBookHeadingFragments } from 'common/book/heading'
import { unicodeDefaultCaseFold } from 'common/book/unicodeCaseFold'
import {
  createPreparationDraftId,
  type BookPreparationDraftStore,
  type PreparationDraftChapter,
  type PreparationDraftFileIdentity,
  type PreparationDraftPayload,
  type PreparationDraftReadResult
} from './preparationDraftStore'
import type {
  BookPreparationDraftApplyRequestDto,
  BookPreparationDraftOperationDto,
  BookPreparationRecoveryRequestDto,
  BookPreparationCandidateDto,
  BookPreparationDto,
  BookReaderError,
  BookReaderResult
} from '@shared/types/bookReader'

const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_HEADINGS = 2_000
const MAX_LINES = 250_000
const MAX_TITLE_CHARACTERS = 512
const MAX_LINK_DESTINATION_CHARACTERS = 8_192
const MAX_SUMMARY_BYTES = 2 * 1024 * 1024
const MAX_ROOT_ENTRIES = 100_000
const MAX_ACTIVE_PER_OWNER = 4
const SUMMARY_NAME = 'SUMMARY.md'
const SUMMARY_IDENTITIES = new Set(['summary.md', 'summary.markdown'])

interface Identity {
  dev: bigint
  ino: bigint
  mode: number
}

interface FileState extends Identity {
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}

interface RootIdentity {
  realPath: string
  dev: bigint
  ino: bigint
}

export interface BookPreparationSource {
  nodeId: string
  title: string
  path: string
}

export interface BookPreparationBeginContext {
  ownerId: number
  sessionId: string
  sessionGeneration: number
  rootPath: string
  rootIdentity: RootIdentity
  rootName: string
  sources: BookPreparationSource[]
  isCurrent: () => boolean
}

interface PreparedSource {
  source: BookPreparationSource
  identity: FileState
  sourceRevision: string
  baseChapters: PreparationDraftChapter[]
  chapters: PreparationDraftChapter[]
  draftId: string
  nonce: number
  draftPersisted: boolean
  draftDurabilityUncertain: boolean
  summaryBytes: Buffer
  revision: string
  dto: BookPreparationDto
}

interface PreparationLease extends BookPreparationBeginContext {
  preparationId: string
  generation: number
  candidates: BookPreparationSource[]
  prepared: PreparedSource | null
  critical: boolean
  recoveryId: string | null
  recovery: PreparationDraftReadResult
}

interface CriticalValidationFailure {
  ok: false
  reason: 'expired' | 'root-or-source-changed' | 'summary-conflict'
}

type CriticalValidation = { ok: true } | CriticalValidationFailure

class UnsafeTargetError extends Error {}

export interface BookPreparationCommitResult {
  preparationId: string
  sourcePath: string
  committed: boolean
  durabilityUncertain: boolean
}

export interface BookPreparationManagerHooks {
  beforePrepareRead?: () => void | Promise<void>
  beforeDraftRead?: () => void | Promise<void>
  beforeOpen?: (targetPath: string) => void | Promise<void>
  openTarget?: (targetPath: string, flags: number, mode: number) => number
  afterOpen?: (targetPath: string, descriptor: number) => void
  write?: (descriptor: number, bytes: Buffer, offset: number, length: number) => number
  afterWrite?: (targetPath: string, descriptor: number) => void
  syncFile?: (descriptor: number) => void
  afterSync?: (targetPath: string, descriptor: number) => void
  forceDirectorySyncFailure?: boolean
}

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const identity = (stat: { dev: bigint; ino: bigint; mode: bigint | number }): Identity => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: Number(stat.mode)
})
const fileState = (stat: {
  dev: bigint
  ino: bigint
  mode: bigint | number
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}): FileState => ({
  ...identity(stat),
  nlink: stat.nlink,
  size: stat.size,
  mtimeNs: stat.mtimeNs,
  ctimeNs: stat.ctimeNs
})
const sameFileState = (left: FileState, right: FileState): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs
const sameDraftFileIdentity = (
  left: PreparationDraftFileIdentity,
  right: PreparationDraftFileIdentity
): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size
const resultError = <T>(
  code: BookReaderError['code'],
  message: string,
  committed?: boolean
): BookReaderResult<T> => ({
  ok: false,
  error: { code, message, ...(committed === undefined ? {} : { committed }) }
})

const safeReadFlags = (): number | null => {
  if (
    typeof fsConstants.O_NOFOLLOW !== 'number' ||
    fsConstants.O_NOFOLLOW === 0 ||
    typeof fsConstants.O_NONBLOCK !== 'number' ||
    fsConstants.O_NONBLOCK === 0
  ) {
    return null
  }
  return fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
}

const safeDirectoryFlags = (): number | null => {
  const readFlags = safeReadFlags()
  if (
    readFlags === null ||
    typeof fsConstants.O_DIRECTORY !== 'number' ||
    fsConstants.O_DIRECTORY === 0
  ) {
    return null
  }
  return readFlags | fsConstants.O_DIRECTORY
}

const escapeTitle = (value: string): string => value.replace(/[\\[\]]/g, '\\$&')
const encodePath = (value: string): string => value.split('/').map(encodeURIComponent).join('/')
const summaryBytes = (
  title: string,
  sourcePath: string,
  chapters: readonly { title: string; fragment: string }[]
): Buffer =>
  Buffer.from(
    `# ${escapeTitle(title)}\n\n${chapters
      .map(
        (chapter) =>
          `- [${escapeTitle(chapter.title)}](${encodePath(sourcePath)}#${encodeURIComponent(chapter.fragment)})`
      )
      .join('\n')}\n`,
    'utf8'
  )

const READ_CHUNK_BYTES = 64 * 1024

// eslint-disable-next-line @stylistic/space-before-function-paren
const readExactAsync = async (
  handle: Awaited<ReturnType<typeof fs.open>>,
  expectedSize: number
): Promise<Buffer | null> => {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_SOURCE_BYTES) {
    return null
  }
  const bytes = Buffer.allocUnsafe(expectedSize)
  let offset = 0
  while (offset < expectedSize) {
    const length = Math.min(READ_CHUNK_BYTES, expectedSize - offset)
    const read = await handle.read(bytes, offset, length, offset)
    if (read.bytesRead <= 0 || read.bytesRead > length) return null
    offset += read.bytesRead
  }
  const probe = Buffer.allocUnsafe(1)
  if ((await handle.read(probe, 0, 1, expectedSize)).bytesRead !== 0) return null
  return bytes
}

const hashExactSync = (
  descriptor: number,
  expectedSize: number,
  maximumSize: number
): string | null => {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > maximumSize) {
    return null
  }
  const bytes = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, Math.max(1, expectedSize)))
  const digest = createHash('sha256')
  let offset = 0
  while (offset < expectedSize) {
    const length = Math.min(READ_CHUNK_BYTES, expectedSize - offset)
    const read = fsSync.readSync(descriptor, bytes, 0, length, offset)
    if (read <= 0 || read > length) return null
    digest.update(bytes.subarray(0, read))
    offset += read
  }
  if (fsSync.readSync(descriptor, bytes, 0, 1, expectedSize) !== 0) return null
  return digest.digest('hex')
}

export class BookPreparationManager {
  private readonly leases = new Map<string, PreparationLease>()

  constructor(
    private readonly hooks: BookPreparationManagerHooks = {},
    private readonly draftStore: BookPreparationDraftStore | null = null
  ) {}

  private owned(id: unknown, ownerId: number): PreparationLease | null {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null
    const lease = this.leases.get(id)
    return lease?.ownerId === ownerId ? lease : null
  }

  sessionIdFor(preparationId: unknown, ownerId: number): string | null {
    return this.owned(preparationId, ownerId)?.sessionId ?? null
  }

  private current(lease: PreparationLease, generation = lease.generation): boolean {
    return (
      this.leases.get(lease.preparationId) === lease &&
      lease.generation === generation &&
      lease.isCurrent()
    )
  }

  private async rootCurrent(lease: PreparationLease): Promise<boolean> {
    if (!this.current(lease)) return false
    try {
      const realPath = await fs.realpath(lease.rootPath)
      const stat = await fs.stat(realPath, { bigint: true })
      return (
        stat.isDirectory() &&
        realPath === lease.rootIdentity.realPath &&
        stat.dev === lease.rootIdentity.dev &&
        stat.ino === lease.rootIdentity.ino &&
        this.current(lease)
      )
    } catch {
      return false
    }
  }

  private async summaryAbsent(lease: PreparationLease): Promise<boolean> {
    if (!(await this.rootCurrent(lease))) return false
    let directory: Awaited<ReturnType<typeof fs.opendir>> | null = null
    try {
      directory = await fs.opendir(lease.rootPath)
      let count = 0
      for await (const entry of directory) {
        if (++count > MAX_ROOT_ENTRIES) return false
        const entryIdentity = unicodeDefaultCaseFold(entry.name)
        if (entryIdentity === null || SUMMARY_IDENTITIES.has(entryIdentity)) return false
      }
      return this.current(lease)
    } catch {
      return false
    } finally {
      await directory?.close().catch(() => undefined)
    }
  }

  private async readSource(
    lease: PreparationLease,
    source: BookPreparationSource
  ): Promise<{ bytes: Buffer; identity: FileState } | null> {
    if (
      source.path.includes('/') ||
      source.path.includes('\\') ||
      path.basename(source.path) !== source.path ||
      !(await this.rootCurrent(lease))
    ) {
      return null
    }
    const target = path.join(lease.rootPath, source.path)
    const flags = safeReadFlags()
    if (flags === null) return null
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      handle = await fs.open(target, flags)
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || before.size > BigInt(MAX_SOURCE_BYTES) || before.nlink !== 1n) {
        return null
      }
      const bytes = await readExactAsync(handle, Number(before.size))
      if (!bytes) return null
      const after = await handle.stat({ bigint: true })
      if (
        !after.isFile() ||
        after.nlink !== 1n ||
        !sameFileState(fileState(before), fileState(after)) ||
        !(await this.rootCurrent(lease))
      ) {
        return null
      }
      return { bytes, identity: fileState(after) }
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  private validateCriticalBoundary(
    lease: PreparationLease,
    generation: number,
    prepared: PreparedSource,
    targetPath: string,
    expectedOwnerId: number,
    expectedSessionId: string,
    expectedSessionGeneration: number,
    expectedPreparationId: string
  ): CriticalValidation {
    let directory: fsSync.Dir | null = null
    let sourceDescriptor: number | null = null
    try {
      if (
        lease.preparationId !== expectedPreparationId ||
        this.leases.get(lease.preparationId) !== lease ||
        lease.ownerId !== expectedOwnerId ||
        lease.sessionId !== expectedSessionId ||
        lease.sessionGeneration !== expectedSessionGeneration ||
        lease.generation !== generation ||
        lease.prepared !== prepared ||
        !lease.isCurrent()
      ) {
        return { ok: false, reason: 'expired' }
      }

      const rootRealPath = fsSync.realpathSync(lease.rootPath)
      const rootStat = fsSync.statSync(rootRealPath, { bigint: true })
      const parentStat = fsSync.statSync(path.dirname(targetPath), { bigint: true })
      if (
        !rootStat.isDirectory() ||
        !parentStat.isDirectory() ||
        rootRealPath !== lease.rootIdentity.realPath ||
        rootStat.dev !== lease.rootIdentity.dev ||
        rootStat.ino !== lease.rootIdentity.ino ||
        parentStat.dev !== lease.rootIdentity.dev ||
        parentStat.ino !== lease.rootIdentity.ino
      ) {
        return { ok: false, reason: 'root-or-source-changed' }
      }

      directory = fsSync.opendirSync(lease.rootPath)
      let count = 0
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > MAX_ROOT_ENTRIES) {
          return { ok: false, reason: 'summary-conflict' }
        }
        const entryIdentity = unicodeDefaultCaseFold(entry.name)
        if (entryIdentity === null || SUMMARY_IDENTITIES.has(entryIdentity)) {
          return { ok: false, reason: 'summary-conflict' }
        }
      }
      directory.closeSync()
      directory = null
      try {
        fsSync.lstatSync(targetPath)
        return { ok: false, reason: 'summary-conflict' }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          return { ok: false, reason: 'summary-conflict' }
        }
      }

      const sourcePath = path.join(lease.rootPath, prepared.source.path)
      const flags = safeReadFlags()
      if (flags === null) return { ok: false, reason: 'root-or-source-changed' }
      sourceDescriptor = fsSync.openSync(sourcePath, flags)
      const sourceBefore = fsSync.fstatSync(sourceDescriptor, { bigint: true })
      const sourcePathStat = fsSync.lstatSync(sourcePath, { bigint: true })
      if (
        !sourceBefore.isFile() ||
        sourcePathStat.isSymbolicLink() ||
        !sourcePathStat.isFile() ||
        sourceBefore.nlink !== 1n ||
        sourceBefore.size > BigInt(MAX_SOURCE_BYTES) ||
        !sameFileState(fileState(sourceBefore), prepared.identity) ||
        sourcePathStat.dev !== sourceBefore.dev ||
        sourcePathStat.ino !== sourceBefore.ino
      ) {
        return { ok: false, reason: 'root-or-source-changed' }
      }
      const sourceHash = hashExactSync(
        sourceDescriptor,
        Number(sourceBefore.size),
        MAX_SOURCE_BYTES
      )
      if (!sourceHash) return { ok: false, reason: 'root-or-source-changed' }
      const sourceAfter = fsSync.fstatSync(sourceDescriptor, { bigint: true })
      if (
        !sourceAfter.isFile() ||
        sourceAfter.nlink !== 1n ||
        !sameFileState(fileState(sourceBefore), fileState(sourceAfter)) ||
        sourceHash !== prepared.sourceRevision
      ) {
        return { ok: false, reason: 'root-or-source-changed' }
      }
      fsSync.closeSync(sourceDescriptor)
      sourceDescriptor = null

      if (
        lease.preparationId !== expectedPreparationId ||
        this.leases.get(lease.preparationId) !== lease ||
        lease.ownerId !== expectedOwnerId ||
        lease.sessionId !== expectedSessionId ||
        lease.sessionGeneration !== expectedSessionGeneration ||
        lease.generation !== generation ||
        lease.prepared !== prepared ||
        !lease.isCurrent()
      ) {
        return { ok: false, reason: 'expired' }
      }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'root-or-source-changed' }
    } finally {
      if (directory) {
        try {
          directory.closeSync()
        } catch {
          // The critical validation already failed closed.
        }
      }
      if (sourceDescriptor !== null) fsSync.closeSync(sourceDescriptor)
    }
  }

  private rootAndParentCurrent(lease: PreparationLease, targetPath: string): boolean {
    try {
      const realPath = fsSync.realpathSync(lease.rootPath)
      const rootStat = fsSync.statSync(realPath, { bigint: true })
      const parentStat = fsSync.statSync(path.dirname(targetPath), { bigint: true })
      return (
        rootStat.isDirectory() &&
        parentStat.isDirectory() &&
        realPath === lease.rootIdentity.realPath &&
        rootStat.dev === lease.rootIdentity.dev &&
        rootStat.ino === lease.rootIdentity.ino &&
        parentStat.dev === lease.rootIdentity.dev &&
        parentStat.ino === lease.rootIdentity.ino
      )
    } catch {
      return false
    }
  }

  private validatePrewriteBoundary(
    lease: PreparationLease,
    generation: number,
    prepared: PreparedSource,
    targetPath: string,
    descriptor: number,
    openedIdentity: Identity,
    expectedOwnerId: number,
    expectedSessionId: string,
    expectedSessionGeneration: number,
    expectedPreparationId: string
  ): CriticalValidation {
    let directory: fsSync.Dir | null = null
    let sourceDescriptor: number | null = null
    try {
      const leaseCurrent = (): boolean =>
        lease.preparationId === expectedPreparationId &&
        this.leases.get(lease.preparationId) === lease &&
        lease.ownerId === expectedOwnerId &&
        lease.sessionId === expectedSessionId &&
        lease.sessionGeneration === expectedSessionGeneration &&
        lease.generation === generation &&
        lease.prepared === prepared &&
        lease.isCurrent()
      if (!leaseCurrent()) return { ok: false, reason: 'expired' }

      const parentPath = path.dirname(targetPath)
      const rootRealPath = fsSync.realpathSync(lease.rootPath)
      const parentRealPath = fsSync.realpathSync(parentPath)
      const rootStat = fsSync.statSync(rootRealPath, { bigint: true })
      const parentStat = fsSync.statSync(parentRealPath, { bigint: true })
      if (
        path.basename(targetPath) !== SUMMARY_NAME ||
        !rootStat.isDirectory() ||
        !parentStat.isDirectory() ||
        rootRealPath !== lease.rootIdentity.realPath ||
        parentRealPath !== lease.rootIdentity.realPath ||
        rootStat.dev !== lease.rootIdentity.dev ||
        rootStat.ino !== lease.rootIdentity.ino ||
        parentStat.dev !== lease.rootIdentity.dev ||
        parentStat.ino !== lease.rootIdentity.ino
      ) {
        return { ok: false, reason: 'root-or-source-changed' }
      }

      directory = fsSync.opendirSync(lease.rootPath)
      let count = 0
      let exactTargetCount = 0
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > MAX_ROOT_ENTRIES) {
          return { ok: false, reason: 'summary-conflict' }
        }
        const entryIdentity = unicodeDefaultCaseFold(entry.name)
        if (entryIdentity === null || SUMMARY_IDENTITIES.has(entryIdentity)) {
          if (entry.name !== SUMMARY_NAME) {
            return { ok: false, reason: 'summary-conflict' }
          }
          exactTargetCount++
        }
      }
      directory.closeSync()
      directory = null
      if (exactTargetCount !== 1) return { ok: false, reason: 'summary-conflict' }

      if (
        !this.targetMatchesDescriptor(
          targetPath,
          descriptor,
          openedIdentity,
          0,
          hash(Buffer.alloc(0))
        )
      ) {
        return { ok: false, reason: 'summary-conflict' }
      }

      const sourcePath = path.join(lease.rootPath, prepared.source.path)
      const flags = safeReadFlags()
      if (flags === null) return { ok: false, reason: 'root-or-source-changed' }
      sourceDescriptor = fsSync.openSync(sourcePath, flags)
      const sourceBefore = fsSync.fstatSync(sourceDescriptor, { bigint: true })
      const sourcePathStat = fsSync.lstatSync(sourcePath, { bigint: true })
      if (
        !sourceBefore.isFile() ||
        sourcePathStat.isSymbolicLink() ||
        !sourcePathStat.isFile() ||
        sourceBefore.nlink !== 1n ||
        sourceBefore.size > BigInt(MAX_SOURCE_BYTES) ||
        !sameFileState(fileState(sourceBefore), prepared.identity) ||
        sourcePathStat.dev !== sourceBefore.dev ||
        sourcePathStat.ino !== sourceBefore.ino
      ) {
        return { ok: false, reason: 'root-or-source-changed' }
      }
      const sourceHash = hashExactSync(
        sourceDescriptor,
        Number(sourceBefore.size),
        MAX_SOURCE_BYTES
      )
      const sourceAfter = fsSync.fstatSync(sourceDescriptor, { bigint: true })
      if (
        !sourceHash ||
        !sourceAfter.isFile() ||
        sourceAfter.nlink !== 1n ||
        !sameFileState(fileState(sourceBefore), fileState(sourceAfter)) ||
        sourceHash !== prepared.sourceRevision
      ) {
        return { ok: false, reason: 'root-or-source-changed' }
      }
      fsSync.closeSync(sourceDescriptor)
      sourceDescriptor = null
      return leaseCurrent() ? { ok: true } : { ok: false, reason: 'expired' }
    } catch {
      return { ok: false, reason: 'root-or-source-changed' }
    } finally {
      if (directory) {
        try {
          directory.closeSync()
        } catch {
          // The prewrite boundary already failed closed.
        }
      }
      if (sourceDescriptor !== null) fsSync.closeSync(sourceDescriptor)
    }
  }

  private targetMatchesDescriptor(
    targetPath: string,
    descriptor: number,
    expectedIdentity: Identity,
    expectedSize: number,
    expectedHash: string
  ): boolean {
    let pathDescriptor: number | null = null
    try {
      const descriptorStat = fsSync.fstatSync(descriptor, { bigint: true })
      if (!this.safeExpectedTarget(descriptorStat, expectedIdentity, expectedSize)) return false
      const descriptorBefore = fileState(descriptorStat)
      const pathStat = fsSync.lstatSync(targetPath, { bigint: true })
      if (
        !descriptorStat.isFile() ||
        descriptorStat.nlink !== 1n ||
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        pathStat.dev !== descriptorStat.dev ||
        pathStat.ino !== descriptorStat.ino
      ) {
        return false
      }
      const flags = safeReadFlags()
      if (flags === null) return false
      pathDescriptor = fsSync.openSync(targetPath, flags)
      const openedStat = fsSync.fstatSync(pathDescriptor, { bigint: true })
      if (
        openedStat.isFile() &&
        openedStat.nlink === 1n &&
        openedStat.dev === descriptorStat.dev &&
        openedStat.ino === descriptorStat.ino &&
        this.descriptorMatches(pathDescriptor, expectedIdentity, expectedSize, expectedHash)
      ) {
        const descriptorAfter = fsSync.fstatSync(descriptor, { bigint: true })
        return (
          descriptorAfter.isFile() && sameFileState(descriptorBefore, fileState(descriptorAfter))
        )
      }
      return false
    } catch {
      return false
    } finally {
      if (pathDescriptor !== null) fsSync.closeSync(pathDescriptor)
    }
  }

  private descriptorMatches(
    descriptor: number,
    expectedIdentity: Identity,
    expectedSize: number,
    expectedHash: string
  ): boolean {
    try {
      if (
        !Number.isSafeInteger(expectedSize) ||
        expectedSize < 0 ||
        expectedSize > MAX_SUMMARY_BYTES
      ) {
        return false
      }
      const before = fsSync.fstatSync(descriptor, { bigint: true })
      if (!this.safeExpectedTarget(before, expectedIdentity, expectedSize)) return false
      if (hashExactSync(descriptor, expectedSize, MAX_SUMMARY_BYTES) !== expectedHash) return false
      const after = fsSync.fstatSync(descriptor, { bigint: true })
      return (
        after.isFile() && after.nlink === 1n && sameFileState(fileState(before), fileState(after))
      )
    } catch {
      return false
    }
  }

  private safeExpectedTarget(
    stat: BigIntStats,
    expectedIdentity: Identity,
    expectedSize: number
  ): boolean {
    return (
      Number.isSafeInteger(expectedSize) &&
      expectedSize >= 0 &&
      expectedSize <= MAX_SUMMARY_BYTES &&
      stat.isFile() &&
      stat.nlink === 1n &&
      stat.size === BigInt(expectedSize) &&
      stat.dev === expectedIdentity.dev &&
      stat.ino === expectedIdentity.ino &&
      Number(stat.mode) === expectedIdentity.mode
    )
  }

  private unlinkExactTarget(
    lease: PreparationLease,
    targetPath: string,
    descriptor: number
  ): boolean {
    try {
      if (!this.rootAndParentCurrent(lease, targetPath)) return false
      const descriptorStat = fsSync.fstatSync(descriptor, { bigint: true })
      const pathStat = fsSync.lstatSync(targetPath, { bigint: true })
      if (
        !descriptorStat.isFile() ||
        descriptorStat.nlink !== 1n ||
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        pathStat.dev !== descriptorStat.dev ||
        pathStat.ino !== descriptorStat.ino
      ) {
        return false
      }
      fsSync.unlinkSync(targetPath)
      return true
    } catch {
      return false
    }
  }

  private unlinkExactEmptyTarget(targetPath: string, descriptor: number): boolean {
    try {
      const descriptorStat = fsSync.fstatSync(descriptor, { bigint: true })
      if (
        !descriptorStat.isFile() ||
        descriptorStat.nlink !== 1n ||
        descriptorStat.size !== 0n ||
        !this.targetMatchesDescriptor(
          targetPath,
          descriptor,
          identity(descriptorStat),
          0,
          hash(Buffer.alloc(0))
        )
      ) {
        return false
      }
      fsSync.unlinkSync(targetPath)
      return true
    } catch {
      return false
    }
  }

  private recoveryStatus(lease: PreparationLease): 'available' | 'stale' | 'invalid' | null {
    if (lease.recovery.status === 'none') return null
    if (lease.recovery.status === 'invalid') return 'invalid'
    const payload = lease.recovery.payload
    const prepared = lease.prepared
    const rootHmac = this.draftStore?.rootHmac(lease.rootIdentity.realPath)
    if (
      !prepared ||
      !rootHmac ||
      payload.rootRealPathHmac !== rootHmac ||
      payload.rootDev !== lease.rootIdentity.dev.toString() ||
      payload.rootIno !== lease.rootIdentity.ino.toString() ||
      payload.sourcePath !== prepared.source.path ||
      payload.baseRevision !== prepared.sourceRevision ||
      payload.sourceIdentity.dev !== prepared.identity.dev.toString() ||
      payload.sourceIdentity.ino !== prepared.identity.ino.toString() ||
      payload.sourceIdentity.mode !== prepared.identity.mode ||
      payload.sourceIdentity.nlink !== prepared.identity.nlink.toString() ||
      payload.sourceIdentity.size !== prepared.identity.size.toString() ||
      payload.sourceIdentity.mtimeNs !== prepared.identity.mtimeNs.toString() ||
      payload.sourceIdentity.ctimeNs !== prepared.identity.ctimeNs.toString()
    ) {
      return 'stale'
    }
    return 'available'
  }

  private recoveryDto(lease: PreparationLease): BookPreparationDto['recovery'] {
    const status = this.recoveryStatus(lease)
    if (!status || !lease.recoveryId) return null
    return {
      recoveryId: lease.recoveryId,
      status,
      chapterCount:
        lease.recovery.status === 'valid' ? lease.recovery.payload.chapters.length : null
    }
  }

  private rebuildPrepared(lease: PreparationLease, prepared: PreparedSource): void {
    const included = prepared.chapters
      .filter((chapter) => chapter.included)
      .sort((left, right) => left.order - right.order)
    const removed = prepared.chapters
      .filter((chapter) => !chapter.included)
      .sort((left, right) => left.order - right.order)
    prepared.summaryBytes = summaryBytes(lease.rootName, prepared.source.path, included)
    prepared.revision = hash(
      Buffer.concat([
        Buffer.from(prepared.sourceRevision, 'ascii'),
        Buffer.from(`${prepared.identity.dev}:${prepared.identity.ino}`, 'utf8'),
        prepared.summaryBytes
      ])
    )
    const toDto = (chapter: PreparationDraftChapter, index: number) => ({
      chapterId: chapter.id,
      ordinal: index + 1,
      line: chapter.line,
      title: chapter.title,
      fragment: chapter.fragment
    })
    prepared.dto = {
      ...this.baseDto(lease),
      revision: prepared.revision,
      sourceNodeId: prepared.source.nodeId,
      sourceTitle: prepared.source.title,
      chapters: included.map(toDto),
      removedChapters: removed.map(toDto),
      summaryPreview: `# Contents\n\n${included.map((chapter) => `- ${chapter.title}`).join('\n')}\n`,
      requiresSelection: false,
      draftPersisted: prepared.draftPersisted,
      draftDurabilityUncertain: prepared.draftDurabilityUncertain,
      draftId: prepared.draftPersisted ? prepared.draftId : null,
      draftNonce: prepared.nonce
    }
  }

  private draftPayload(lease: PreparationLease, prepared: PreparedSource): PreparationDraftPayload {
    const rootRealPathHmac = this.draftStore?.rootHmac(lease.rootIdentity.realPath)
    if (!rootRealPathHmac) throw new Error('preparation draft storage is unavailable')
    return {
      draftId: prepared.draftId,
      rootDev: lease.rootIdentity.dev.toString(),
      rootIno: lease.rootIdentity.ino.toString(),
      rootRealPathHmac,
      sourcePath: prepared.source.path,
      sourceIdentity: {
        dev: prepared.identity.dev.toString(),
        ino: prepared.identity.ino.toString(),
        mode: prepared.identity.mode,
        nlink: prepared.identity.nlink.toString(),
        size: prepared.identity.size.toString(),
        mtimeNs: prepared.identity.mtimeNs.toString(),
        ctimeNs: prepared.identity.ctimeNs.toString()
      },
      baseRevision: prepared.sourceRevision,
      chapters: prepared.chapters.map((chapter) => ({ ...chapter })),
      nonce: prepared.nonce
    }
  }

  private baseDto(lease: PreparationLease): BookPreparationDto {
    return {
      preparationId: lease.preparationId,
      sessionId: lease.sessionId,
      revision: null,
      sourceNodeId: null,
      sourceTitle: null,
      candidates: lease.candidates.map(
        ({ nodeId, title }, index): BookPreparationCandidateDto => ({
          nodeId,
          title,
          displayLabel: `Document ${index + 1}`
        })
      ),
      chapters: [],
      removedChapters: [],
      summaryPreview: null,
      requiresSelection: true,
      recovery: this.recoveryDto(lease),
      draftPersisted: false,
      draftDurabilityUncertain: false,
      draftId: null,
      draftNonce: 0
    }
  }

  private async prepare(
    lease: PreparationLease,
    source: BookPreparationSource
  ): Promise<BookReaderResult<BookPreparationDto>> {
    const generation = lease.generation
    if (!(await this.summaryAbsent(lease))) {
      return resultError('preparation-conflict', 'A SUMMARY already exists or the book changed.')
    }
    await this.hooks.beforePrepareRead?.()
    if (!this.current(lease, generation)) {
      return resultError('preparation-not-found', 'This preparation has expired.')
    }
    const read = await this.readSource(lease, source)
    if (!read || !this.current(lease, generation)) {
      return resultError('preparation-source-changed', 'The selected manuscript changed.')
    }
    const markdown = read.bytes.toString('utf8')
    if (!Buffer.from(markdown, 'utf8').equals(read.bytes)) {
      return resultError('preparation-invalid-headings', 'The selected manuscript is not UTF-8.')
    }
    const analysis = analyzeAtxH1Headings(markdown, {
      maxBytes: MAX_SOURCE_BYTES,
      maxHeadings: MAX_HEADINGS,
      maxLines: MAX_LINES
    })
    if (!analysis.ok) {
      return resultError(
        analysis.error === 'source-too-large'
          ? 'preparation-too-large'
          : 'preparation-invalid-headings',
        'The manuscript exceeds the safe heading-analysis limits.'
      )
    }
    if (analysis.headings.length < 2) {
      return resultError(
        'preparation-invalid-headings',
        'At least two top-level ATX H1 headings are required.'
      )
    }
    if (
      analysis.headings.some(
        (heading) => !heading.title || [...heading.title].length > MAX_TITLE_CHARACTERS
      )
    ) {
      return resultError(
        'preparation-invalid-headings',
        'A chapter heading exceeds the safe title limit.'
      )
    }
    const fragments = validateBookHeadingFragments(
      analysis.headings.map((heading) => heading.title)
    )
    if (!fragments.ok) {
      return resultError(
        'preparation-invalid-headings',
        'Every chapter heading must have a unique, addressable fragment.'
      )
    }
    const chapters = analysis.headings.map((heading, index) => ({
      ...heading,
      fragment: fragments.fragments[index]
    }))
    if (
      chapters.some(
        (chapter) =>
          `${encodePath(source.path)}#${encodeURIComponent(chapter.fragment)}`.length >
          MAX_LINK_DESTINATION_CHARACTERS
      )
    ) {
      return resultError(
        'preparation-invalid-headings',
        'A generated chapter destination exceeds its safety limit.'
      )
    }
    const baseChapters: PreparationDraftChapter[] = chapters.map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      line: chapter.line,
      title: chapter.title,
      fragment: chapter.fragment,
      included: true,
      order: index
    }))
    const prepared: PreparedSource = {
      source,
      identity: read.identity,
      sourceRevision: hash(read.bytes),
      baseChapters,
      chapters: baseChapters.map((chapter) => ({ ...chapter })),
      draftId: createPreparationDraftId(),
      nonce: 0,
      draftPersisted: false,
      draftDurabilityUncertain: false,
      summaryBytes: Buffer.alloc(0),
      revision: '',
      dto: null as unknown as BookPreparationDto
    }
    lease.prepared = prepared
    this.rebuildPrepared(lease, prepared)
    if (prepared.summaryBytes.byteLength > MAX_SUMMARY_BYTES) {
      lease.prepared = null
      return resultError('preparation-too-large', 'The generated SUMMARY exceeds its safety limit.')
    }
    return { ok: true, value: prepared.dto }
  }

  async begin(context: BookPreparationBeginContext): Promise<BookReaderResult<BookPreparationDto>> {
    if (
      safeReadFlags() === null ||
      safeDirectoryFlags() === null ||
      !context.isCurrent() ||
      context.sources.length === 0 ||
      [...this.leases.values()].filter((lease) => lease.ownerId === context.ownerId).length >=
        MAX_ACTIVE_PER_OWNER
    ) {
      return resultError('preparation-not-available', 'This book cannot be prepared.')
    }
    const unique = new Map<string, BookPreparationSource>()
    for (const source of context.sources) {
      if (
        source.path.includes('/') ||
        source.path.includes('\\') ||
        source.nodeId.length === 0 ||
        source.nodeId.length > 128
      ) {
        continue
      }
      if (!unique.has(source.path)) unique.set(source.path, source)
    }
    const candidates = [...unique.values()]
    if (!candidates.length) {
      return resultError(
        'preparation-not-available',
        'No root-level Markdown manuscript is available.'
      )
    }
    const preparationId = randomUUID()
    let recovery: PreparationDraftReadResult = { status: 'none' }
    if (this.draftStore) {
      try {
        recovery = this.draftStore.read(context.rootIdentity.realPath)
      } catch {
        recovery = { status: 'none' }
      }
    }
    const lease: PreparationLease = {
      ...context,
      preparationId,
      generation: 1,
      candidates,
      prepared: null,
      critical: false,
      recoveryId: recovery.status === 'none' ? null : randomUUID(),
      recovery
    }
    this.leases.set(preparationId, lease)
    if (!(await this.summaryAbsent(lease))) {
      this.leases.delete(preparationId)
      return resultError('preparation-conflict', 'A SUMMARY already exists or the book changed.')
    }
    if (recovery.status === 'valid') {
      const recoveredSource = candidates.find(
        (candidate) => candidate.path === recovery.payload.sourcePath
      )
      if (recoveredSource) return this.prepare(lease, recoveredSource)
    }
    const rootStem = unicodeDefaultCaseFold(context.rootName)
    const automatic = candidates.filter((candidate) => {
      const candidateStem = unicodeDefaultCaseFold(
        path.basename(candidate.path, path.extname(candidate.path))
      )
      return rootStem !== null && candidateStem !== null && candidateStem === rootStem
    })
    if (automatic.length === 1) {
      const automaticGeneration = lease.generation
      let automaticSucceeded = false
      try {
        const automaticResult = await this.prepare(lease, automatic[0])
        automaticSucceeded = automaticResult.ok
        return automaticResult
      } finally {
        if (
          !automaticSucceeded &&
          this.leases.get(preparationId) === lease &&
          lease.preparationId === preparationId &&
          lease.ownerId === context.ownerId &&
          lease.sessionId === context.sessionId &&
          lease.sessionGeneration === context.sessionGeneration &&
          lease.generation === automaticGeneration
        ) {
          this.leases.delete(preparationId)
        }
      }
    }
    return { ok: true, value: this.baseDto(lease) }
  }

  select(
    preparationId: unknown,
    sourceNodeId: unknown,
    ownerId: number
  ): Promise<BookReaderResult<BookPreparationDto>> {
    const lease = this.owned(preparationId, ownerId)
    if (!lease || typeof sourceNodeId !== 'string') {
      return Promise.resolve(resultError('preparation-not-found', 'This preparation has expired.'))
    }
    const source = lease.candidates.find((candidate) => candidate.nodeId === sourceNodeId)
    if (!source) {
      return Promise.resolve(
        resultError('preparation-source-required', 'Choose a manuscript from this book.')
      )
    }
    lease.generation++
    lease.prepared = null
    return this.prepare(lease, source)
  }

  async applyDraft(
    request: BookPreparationDraftApplyRequestDto,
    ownerId: number
  ): Promise<BookReaderResult<BookPreparationDto>> {
    const lease = this.owned(request.preparationId, ownerId)
    const prepared = lease?.prepared
    if (
      !lease ||
      !prepared ||
      !this.draftStore ||
      request.revision !== prepared.revision ||
      !Number.isSafeInteger(request.nonce) ||
      request.nonce >= Number.MAX_SAFE_INTEGER ||
      prepared.nonce >= Number.MAX_SAFE_INTEGER - 1 ||
      request.nonce !== prepared.nonce + 1 ||
      lease.recoveryId !== null ||
      !this.current(lease)
    ) {
      return resultError('preparation-not-found', 'This preparation draft is stale.')
    }
    const source = await this.readSource(lease, prepared.source)
    if (
      !source ||
      !sameFileState(source.identity, prepared.identity) ||
      hash(source.bytes) !== prepared.sourceRevision ||
      !this.current(lease) ||
      lease.prepared !== prepared ||
      request.revision !== prepared.revision ||
      request.nonce !== prepared.nonce + 1
    ) {
      return resultError(
        'preparation-draft-stale',
        'The book changed; this draft cannot be edited.'
      )
    }
    const previous = prepared.chapters.map((chapter) => ({ ...chapter }))
    const previousNonce = prepared.nonce
    const previousDurabilityUncertain = prepared.draftDurabilityUncertain
    const operation: BookPreparationDraftOperationDto = request.operation
    const chapter = prepared.chapters.find((item) => item.id === operation.chapterId)
    if (!chapter) {
      return resultError('preparation-conflict', 'The selected chapter is unavailable.')
    }
    if (operation.type === 'rename') {
      const title = operation.title.trim()
      if (
        !title ||
        [...title].length > MAX_TITLE_CHARACTERS ||
        [...title].some((character) => {
          const codePoint = character.codePointAt(0) ?? 0
          return codePoint <= 0x1f || codePoint === 0x7f
        })
      ) {
        return resultError('preparation-conflict', 'The chapter title is invalid.')
      }
      chapter.title = title
    } else if (operation.type === 'remove') {
      if (!chapter.included || prepared.chapters.filter((item) => item.included).length <= 1) {
        return resultError('preparation-conflict', 'At least one chapter must remain.')
      }
      chapter.included = false
    } else if (operation.type === 'restore') {
      if (chapter.included) {
        return resultError('preparation-conflict', 'The chapter is already added.')
      }
      chapter.included = true
      chapter.order = Math.max(-1, ...prepared.chapters.map((item) => item.order)) + 1
    } else {
      const active = prepared.chapters
        .filter((item) => item.included)
        .sort((left, right) => left.order - right.order)
      const index = active.findIndex((item) => item.id === chapter.id)
      const targetIndex = operation.type === 'move-up' ? index - 1 : index + 1
      if (index < 0 || targetIndex < 0 || targetIndex >= active.length) {
        return resultError('preparation-conflict', 'The chapter cannot move farther.')
      }
      const target = active[targetIndex]
      const currentOrder = chapter.order
      chapter.order = target.order
      target.order = currentOrder
    }
    prepared.nonce = request.nonce
    prepared.draftPersisted = false
    prepared.draftDurabilityUncertain = false
    this.rebuildPrepared(lease, prepared)
    if (prepared.summaryBytes.byteLength > MAX_SUMMARY_BYTES) {
      prepared.chapters = previous
      prepared.nonce = previousNonce
      this.rebuildPrepared(lease, prepared)
      return resultError('preparation-too-large', 'The draft SUMMARY exceeds its safety limit.')
    }
    const payload = this.draftPayload(lease, prepared)
    const generation = lease.generation
    const saved = this.draftStore.write(lease.rootIdentity.realPath, payload, () =>
      Boolean(
        this.current(lease, generation) &&
        lease.prepared === prepared &&
        prepared.nonce === request.nonce
      )
    )
    if (saved === 'failed') {
      prepared.chapters = previous
      prepared.nonce = previousNonce
      prepared.draftPersisted = previousNonce > 0
      prepared.draftDurabilityUncertain = previousDurabilityUncertain
      this.rebuildPrepared(lease, prepared)
      return resultError(
        'preparation-draft-write-failed',
        'LeafBook could not durably save this preparation draft.'
      )
    }
    prepared.draftPersisted = true
    prepared.draftDurabilityUncertain = saved === 'uncertain'
    lease.recoveryId = null
    try {
      lease.recovery = this.draftStore.read(lease.rootIdentity.realPath)
    } catch {
      lease.recovery = { status: 'none' }
    }
    this.rebuildPrepared(lease, prepared)
    return { ok: true, value: prepared.dto }
  }

  async restoreDraft(
    request: BookPreparationRecoveryRequestDto,
    ownerId: number
  ): Promise<BookReaderResult<BookPreparationDto>> {
    const lease = this.owned(request.preparationId, ownerId)
    const prepared = lease?.prepared
    if (
      !lease ||
      !prepared ||
      !lease.recoveryId ||
      request.recoveryId !== lease.recoveryId ||
      lease.recovery.status !== 'valid' ||
      this.recoveryStatus(lease) !== 'available'
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft cannot be restored.')
    }
    const generation = lease.generation
    const expectedRecovery = lease.recovery
    const expectedRecoveryId = lease.recoveryId
    const expectedDraftId = expectedRecovery.payload.draftId
    const expectedNonce = expectedRecovery.payload.nonce
    const source = await this.readSource(lease, prepared.source)
    if (
      !source ||
      !sameFileState(source.identity, prepared.identity) ||
      hash(source.bytes) !== prepared.sourceRevision ||
      !this.current(lease, generation) ||
      lease.prepared !== prepared ||
      lease.recovery !== expectedRecovery ||
      lease.recoveryId !== expectedRecoveryId
    ) {
      return resultError('preparation-draft-stale', 'The source changed; this draft is stale.')
    }
    await this.hooks.beforeDraftRead?.()
    if (
      !this.current(lease, generation) ||
      lease.prepared !== prepared ||
      lease.recovery !== expectedRecovery ||
      lease.recoveryId !== expectedRecoveryId
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft cannot be restored.')
    }
    let persisted: PreparationDraftReadResult
    try {
      persisted = this.draftStore?.read(lease.rootIdentity.realPath) ?? { status: 'none' }
    } catch {
      return resultError('preparation-draft-write-failed', 'The draft identity is unavailable.')
    }
    if (
      persisted.status !== 'valid' ||
      !sameDraftFileIdentity(persisted.identity, expectedRecovery.identity) ||
      persisted.payload.draftId !== expectedDraftId ||
      persisted.payload.nonce !== expectedNonce
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft is no longer current.')
    }
    prepared.chapters = expectedRecovery.payload.chapters.map((chapter) => ({ ...chapter }))
    prepared.draftId = expectedDraftId
    prepared.nonce = expectedNonce
    prepared.draftPersisted = true
    prepared.draftDurabilityUncertain = false
    lease.recoveryId = null
    this.rebuildPrepared(lease, prepared)
    return { ok: true, value: prepared.dto }
  }

  async discardDraft(
    request: BookPreparationRecoveryRequestDto,
    ownerId: number
  ): Promise<BookReaderResult<BookPreparationDto>> {
    const lease = this.owned(request.preparationId, ownerId)
    const prepared = lease?.prepared
    const generation = lease?.generation
    const expectedRecovery = lease?.recovery
    const expectedRecoveryId = lease?.recoveryId ?? null
    const discardingCurrent = Boolean(
      prepared?.draftPersisted && request.recoveryId === prepared.draftId
    )
    if (
      !lease ||
      !this.draftStore ||
      generation === undefined ||
      !expectedRecovery ||
      (!discardingCurrent &&
        (!expectedRecoveryId ||
          request.recoveryId !== expectedRecoveryId ||
          expectedRecovery.status === 'none')) ||
      (discardingCurrent &&
        (expectedRecovery.status !== 'valid' ||
          expectedRecovery.payload.draftId !== prepared?.draftId ||
          expectedRecovery.payload.nonce !== prepared.nonce))
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft cannot be discarded.')
    }
    const rootIsCurrent = await this.rootCurrent(lease)
    if (
      !rootIsCurrent ||
      !this.current(lease, generation) ||
      lease.prepared !== prepared ||
      lease.recovery !== expectedRecovery ||
      lease.recoveryId !== expectedRecoveryId
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft cannot be discarded.')
    }
    await this.hooks.beforeDraftRead?.()
    if (
      !this.current(lease, generation) ||
      lease.prepared !== prepared ||
      lease.recovery !== expectedRecovery ||
      lease.recoveryId !== expectedRecoveryId
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft cannot be discarded.')
    }
    let persisted: PreparationDraftReadResult
    try {
      persisted = this.draftStore.read(lease.rootIdentity.realPath)
    } catch {
      return resultError('preparation-draft-write-failed', 'The draft identity is unavailable.')
    }
    if (
      persisted.status === 'none' ||
      persisted.status !== expectedRecovery.status ||
      !sameDraftFileIdentity(persisted.identity, expectedRecovery.identity) ||
      (persisted.status === 'valid' &&
        expectedRecovery.status === 'valid' &&
        (persisted.payload.draftId !== expectedRecovery.payload.draftId ||
          persisted.payload.nonce !== expectedRecovery.payload.nonce))
    ) {
      return resultError('preparation-draft-stale', 'This preparation draft no longer exists.')
    }
    const expected: PreparationDraftFileIdentity = persisted.identity
    if (!this.draftStore.discard(lease.rootIdentity.realPath, expected)) {
      return resultError(
        'preparation-draft-write-failed',
        'LeafBook could not safely discard this draft.'
      )
    }
    lease.recovery = { status: 'none' }
    lease.recoveryId = null
    if (prepared) {
      if (discardingCurrent) {
        prepared.chapters = prepared.baseChapters.map((chapter) => ({ ...chapter }))
      }
      prepared.draftId = createPreparationDraftId()
      prepared.nonce = 0
      prepared.draftPersisted = false
      prepared.draftDurabilityUncertain = false
      this.rebuildPrepared(lease, prepared)
    }
    return { ok: true, value: prepared?.dto ?? this.baseDto(lease) }
  }

  async commit(
    preparationId: unknown,
    revision: unknown,
    ownerId: number
  ): Promise<BookReaderResult<BookPreparationCommitResult>> {
    const lease = this.owned(preparationId, ownerId)
    if (
      !lease ||
      typeof revision !== 'string' ||
      revision.length !== 64 ||
      !lease.prepared ||
      lease.recoveryId !== null ||
      lease.prepared.revision !== revision
    ) {
      return resultError('preparation-not-found', 'This preparation has expired.')
    }
    const generation = lease.generation
    const prepared = lease.prepared
    const expectedOwnerId = lease.ownerId
    const expectedSessionId = lease.sessionId
    const expectedSessionGeneration = lease.sessionGeneration
    const expectedPreparationId = lease.preparationId
    if (!(await this.summaryAbsent(lease))) {
      return resultError('preparation-conflict', 'A SUMMARY was created before confirmation.')
    }
    const source = await this.readSource(lease, prepared.source)
    if (
      !source ||
      !sameFileState(source.identity, prepared.identity) ||
      hash(source.bytes) !== prepared.sourceRevision ||
      !this.current(lease, generation)
    ) {
      return resultError('preparation-source-changed', 'The selected manuscript changed.')
    }

    const targetPath = path.join(lease.rootPath, SUMMARY_NAME)
    await this.hooks.beforeOpen?.(targetPath)
    const validation = this.validateCriticalBoundary(
      lease,
      generation,
      prepared,
      targetPath,
      expectedOwnerId,
      expectedSessionId,
      expectedSessionGeneration,
      expectedPreparationId
    )
    if (!validation.ok) {
      this.leases.delete(lease.preparationId)
      if (validation.reason === 'expired') {
        return resultError('preparation-not-found', 'This preparation was cancelled.')
      }
      if (validation.reason === 'summary-conflict') {
        return resultError('preparation-conflict', 'A SUMMARY was created before confirmation.')
      }
      return resultError('preparation-source-changed', 'The selected manuscript changed.')
    }

    if (
      typeof fsConstants.O_NOFOLLOW !== 'number' ||
      fsConstants.O_NOFOLLOW === 0 ||
      typeof fsConstants.O_NONBLOCK !== 'number' ||
      fsConstants.O_NONBLOCK === 0
    ) {
      this.leases.delete(lease.preparationId)
      return resultError(
        'preparation-write-failed',
        'This platform cannot safely create SUMMARY.',
        false
      )
    }

    let descriptor: number | null = null
    let opened = false
    let prewriteValidated = false
    let prewriteFailure: CriticalValidationFailure['reason'] | null = null
    try {
      const flags =
        fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW |
        fsConstants.O_NONBLOCK
      descriptor = this.hooks.openTarget
        ? this.hooks.openTarget(targetPath, flags, 0o600)
        : fsSync.openSync(targetPath, flags, 0o600)
      opened = true
      const openedStat = fsSync.fstatSync(descriptor, { bigint: true })
      if (!openedStat.isFile() || openedStat.nlink !== 1n || openedStat.size !== 0n) {
        throw new UnsafeTargetError('unsafe target')
      }
      const openedIdentity = identity(openedStat)
      this.hooks.afterOpen?.(targetPath, descriptor)
      const prewrite = this.validatePrewriteBoundary(
        lease,
        generation,
        prepared,
        targetPath,
        descriptor,
        openedIdentity,
        expectedOwnerId,
        expectedSessionId,
        expectedSessionGeneration,
        expectedPreparationId
      )
      if (!prewrite.ok) {
        prewriteFailure = prewrite.reason
        throw new UnsafeTargetError(`prewrite ${prewrite.reason}`)
      }
      prewriteValidated = true
      lease.critical = true

      let offset = 0
      while (offset < prepared.summaryBytes.byteLength) {
        const remaining = prepared.summaryBytes.byteLength - offset
        let written: number
        if (this.hooks.write) {
          written = this.hooks.write(descriptor, prepared.summaryBytes, offset, remaining)
        } else {
          written = fsSync.writeSync(descriptor, prepared.summaryBytes, offset, remaining)
        }
        if (!Number.isSafeInteger(written) || written <= 0 || written > remaining) {
          throw new Error('incomplete write')
        }
        offset += written
      }
      this.hooks.afterWrite?.(targetPath, descriptor)
      const expectedSize = prepared.summaryBytes.byteLength
      const expectedHash = hash(prepared.summaryBytes)
      if (
        !this.rootAndParentCurrent(lease, targetPath) ||
        !this.targetMatchesDescriptor(
          targetPath,
          descriptor,
          openedIdentity,
          expectedSize,
          expectedHash
        )
      ) {
        throw new UnsafeTargetError('target identity changed after write')
      }
      if (this.hooks.syncFile) {
        this.hooks.syncFile(descriptor)
      } else if (typeof fsSync.fdatasyncSync === 'function') {
        fsSync.fdatasyncSync(descriptor)
      } else {
        fsSync.fsyncSync(descriptor)
      }
      this.hooks.afterSync?.(targetPath, descriptor)
      if (
        !this.rootAndParentCurrent(lease, targetPath) ||
        !this.targetMatchesDescriptor(
          targetPath,
          descriptor,
          openedIdentity,
          expectedSize,
          expectedHash
        )
      ) {
        throw new UnsafeTargetError('target identity changed after sync')
      }

      let durabilityUncertain = false
      try {
        if (this.hooks.forceDirectorySyncFailure) throw new Error('forced directory sync failure')
        const flags = safeDirectoryFlags()
        if (flags === null) throw new Error('safe read flags unavailable')
        const directory = fsSync.openSync(lease.rootPath, flags)
        try {
          const directoryStat = fsSync.fstatSync(directory, { bigint: true })
          if (
            !directoryStat.isDirectory() ||
            directoryStat.dev !== lease.rootIdentity.dev ||
            directoryStat.ino !== lease.rootIdentity.ino
          ) {
            throw new Error('root descriptor changed')
          }
          if (
            !this.rootAndParentCurrent(lease, targetPath) ||
            !this.targetMatchesDescriptor(
              targetPath,
              descriptor,
              openedIdentity,
              expectedSize,
              expectedHash
            )
          ) {
            throw new UnsafeTargetError('target identity changed before directory sync')
          }
          fsSync.fsyncSync(directory)
        } finally {
          fsSync.closeSync(directory)
        }
      } catch (error) {
        if (error instanceof UnsafeTargetError) throw error
        durabilityUncertain = true
      }
      if (!durabilityUncertain && this.draftStore && prepared.draftPersisted) {
        try {
          const persisted = this.draftStore.read(lease.rootIdentity.realPath)
          if (
            persisted.status === 'valid' &&
            persisted.payload.draftId === prepared.draftId &&
            persisted.payload.nonce === prepared.nonce
          ) {
            this.draftStore.discard(lease.rootIdentity.realPath, persisted.identity)
          }
        } catch {
          // The verified source commit remains successful; an unverifiable draft is retained.
        }
      }
      this.leases.delete(lease.preparationId)
      return {
        ok: true,
        value: {
          preparationId: lease.preparationId,
          sourcePath: prepared.source.path,
          committed: true,
          durabilityUncertain
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!opened) {
        this.leases.delete(lease.preparationId)
        if (code === 'EEXIST') {
          return resultError('preparation-conflict', 'A SUMMARY was created before confirmation.')
        }
        return resultError(
          'preparation-write-failed',
          'LeafBook could not safely create SUMMARY.',
          false
        )
      }
      this.leases.delete(lease.preparationId)
      if (
        descriptor !== null &&
        (prewriteValidated
          ? this.unlinkExactTarget(lease, targetPath, descriptor)
          : this.unlinkExactEmptyTarget(targetPath, descriptor))
      ) {
        if (prewriteFailure === 'expired') {
          return resultError(
            'preparation-not-found',
            'This preparation was cancelled before SUMMARY was written.',
            false
          )
        }
        if (prewriteFailure === 'summary-conflict') {
          return resultError(
            'preparation-conflict',
            'A SUMMARY was created before confirmation.',
            false
          )
        }
        if (prewriteFailure === 'root-or-source-changed') {
          return resultError(
            'preparation-source-changed',
            'The book or selected manuscript changed before SUMMARY was written.',
            false
          )
        }
        return resultError(
          'preparation-write-failed',
          'LeafBook could not safely create SUMMARY.',
          false
        )
      }
      return resultError(
        'preparation-commit-uncertain',
        'SUMMARY may contain a partial create; inspect it before retrying.',
        true
      )
    } finally {
      lease.critical = false
      if (descriptor !== null) fsSync.closeSync(descriptor)
    }
  }

  close(preparationId: unknown, ownerId: number): BookReaderResult<true> {
    const lease = this.owned(preparationId, ownerId)
    if (!lease) return resultError('preparation-not-found', 'This preparation has expired.')
    if (lease.critical) {
      return resultError(
        'preparation-conflict',
        'SUMMARY publication has started and cannot be cancelled.',
        true
      )
    }
    this.leases.delete(lease.preparationId)
    return { ok: true, value: true }
  }

  revokeSession(sessionId: string): void {
    for (const lease of this.leases.values()) {
      if (lease.sessionId === sessionId && !lease.critical) this.leases.delete(lease.preparationId)
    }
  }

  cleanupOwner(ownerId: number): void {
    for (const lease of this.leases.values()) {
      if (lease.ownerId === ownerId && !lease.critical) this.leases.delete(lease.preparationId)
    }
  }
}
