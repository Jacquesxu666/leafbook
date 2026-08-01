import path from 'path'
import fs from 'fs/promises'
import fsSync, { constants as fsConstants } from 'fs'
import { createHash, randomUUID } from 'crypto'
import {
  applySummaryArrangement,
  parseSummaryDocument,
  restoreSummaryDocument,
  serializeSummaryDocument,
  type SummaryArrangementOperation,
  type SummaryDocument
} from 'common/book/summaryDocument'
import type {
  BookArrangementApplyRequestDto,
  BookArrangementDto,
  BookArrangementNodeDto,
  BookArrangementSaveRequestDto,
  BookArrangementSaveDto,
  BookReaderErrorCode,
  BookReaderResult
} from '@shared/types/bookReader'

const MAX_SUMMARY_BYTES = 2 * 1024 * 1024
const MAX_HISTORY = 50
const MAX_HISTORY_BYTES = 8 * 1024 * 1024
const MAX_OWNER_LEASES = 4
const MAX_GLOBAL_LEASES = 32
const MAX_LIFETIME_OPERATIONS = 10_000
const LINE_WEIGHT = 64
const NODE_WEIGHT = 256
const MAX_DOCUMENT_WEIGHT = MAX_SUMMARY_BYTES + 50_000 * LINE_WEIGHT + 20_000 * NODE_WEIGHT
const MAX_OWNER_RETAINED_WEIGHT = 48 * 1024 * 1024
const MAX_GLOBAL_RETAINED_WEIGHT = 384 * 1024 * 1024

interface RootIdentity {
  realPath: string
  dev: bigint
  ino: bigint
}

interface FileIdentity {
  dev: bigint
  ino: bigint
  mode: number
}

export interface ArrangementBeginContext {
  ownerId: number
  sessionId: string
  sessionGeneration: number
  rootPath: string
  rootIdentity: RootIdentity
  summaryPath: 'SUMMARY.md' | 'SUMMARY.markdown'
  isCurrent(): boolean
}

export interface BookArrangementManagerTestHooks {
  afterTempSync?: () => void | Promise<void>
  beforeCommitCritical?: () => void | Promise<void>
  commitCriticalStarted?: () => void
  forceDirectorySyncFailure?: boolean
  forceCommittedVerificationFailure?: boolean
  maxHistoryBytes?: number
  maxLifetimeOperations?: number
  pendingDocumentWeight?: number
  maxOwnerRetainedWeight?: number
  maxGlobalRetainedWeight?: number
  beforeActivate?: (ownerId: number) => void | Promise<void>
}

interface OverwriteGrant {
  token: string
  ownerId: number
  generation: number
  baseRevision: string
  externalRevision: string
  candidateRevision: string
}

interface ArrangementHistorySnapshot {
  bytes: Buffer
  lineIds: Uint32Array
  weight: number
}

interface ArrangementLease {
  arrangementId: string
  ownerId: number
  sessionId: string
  sessionGeneration: number
  rootPath: string
  rootIdentity: RootIdentity
  targetPath: string
  parentIdentity: FileIdentity
  targetIdentity: FileIdentity
  mode: number
  revision: string
  document: SummaryDocument
  history: ArrangementHistorySnapshot[]
  historyBytes: number
  operationCount: number
  currentWeight: number
  generation: number
  isCurrent(): boolean
  overwriteGrant: OverwriteGrant | null
  saving: boolean
  criticalCommit: boolean
  revokeAfterCommit: boolean
}

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const resultError = <T>(
  code: BookReaderErrorCode,
  message: string,
  overwriteToken?: string,
  committed?: boolean
): BookReaderResult<T> => ({
  ok: false,
  error: {
    code,
    message,
    ...(overwriteToken ? { overwriteToken } : {}),
    ...(committed === undefined ? {} : { committed })
  }
})

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.mode === right.mode

const dtoNodes = (nodes: SummaryDocument['nodes']): BookArrangementNodeDto[] =>
  nodes.map((node) => ({
    nodeId: node.id,
    kind: node.kind,
    title: node.title.slice(0, 512),
    depth: node.depth,
    children: dtoNodes(node.children),
    canIndent: node.canIndent,
    canOutdent: node.canOutdent
  }))

const operationFromDto = (request: BookArrangementApplyRequestDto): SummaryArrangementOperation => {
  const operation = request.operation
  if (operation.type === 'move-before' || operation.type === 'move-after') {
    return { type: operation.type, nodeId: operation.nodeId, targetId: operation.targetNodeId }
  }
  return { type: operation.type, nodeId: operation.nodeId }
}

const countNodes = (nodes: SummaryDocument['nodes']): number =>
  nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)

const documentWeight = (document: SummaryDocument): number =>
  serializeSummaryDocument(document).byteLength +
  document.source.length * LINE_WEIGHT +
  countNodes(document.nodes) * NODE_WEIGHT

export class BookArrangementManager {
  private readonly leases = new Map<string, ArrangementLease>()
  private readonly pendingBeginsByOwner = new Map<number, number>()
  private readonly pendingWeightByOwner = new Map<number, number>()
  private pendingBegins = 0
  private pendingWeight = 0

  constructor(private readonly testHooks: BookArrangementManagerTestHooks = {}) {}

  private lease(id: unknown, ownerId: number): ArrangementLease | null {
    if (typeof id !== 'string') return null
    const lease = this.leases.get(id)
    return lease?.ownerId === ownerId ? lease : null
  }

  sessionIdFor(arrangementId: unknown, ownerId: number): string | null {
    return this.lease(arrangementId, ownerId)?.sessionId ?? null
  }

  private current(lease: ArrangementLease, generation = lease.generation): boolean {
    return (
      this.leases.get(lease.arrangementId) === lease &&
      lease.generation === generation &&
      lease.isCurrent()
    )
  }

  private dto(lease: ArrangementLease): BookArrangementDto {
    const bytes = serializeSummaryDocument(lease.document)
    return {
      arrangementId: lease.arrangementId,
      sessionId: lease.sessionId,
      revision: lease.revision,
      candidateRevision: hash(bytes),
      nodes: dtoNodes(lease.document.nodes),
      dirty: hash(bytes) !== lease.revision,
      canUndo: lease.history.length > 0,
      preview: {
        operationCount: lease.operationCount,
        byteLength: bytes.byteLength
      }
    }
  }

  private activeRetainedWeight(ownerId?: number, except?: ArrangementLease): number {
    let total = 0
    for (const lease of this.leases.values()) {
      if (lease !== except && (ownerId === undefined || lease.ownerId === ownerId)) {
        total += lease.currentWeight + lease.historyBytes
      }
    }
    return total
  }

  private canRetain(
    ownerId: number,
    weight: number,
    except?: ArrangementLease,
    excludedPendingReservation = 0
  ): boolean {
    const ownerPending = (this.pendingWeightByOwner.get(ownerId) ?? 0) - excludedPendingReservation
    const globalPending = this.pendingWeight - excludedPendingReservation
    return (
      this.activeRetainedWeight(ownerId, except) + ownerPending + weight <=
        (this.testHooks.maxOwnerRetainedWeight ?? MAX_OWNER_RETAINED_WEIGHT) &&
      this.activeRetainedWeight(undefined, except) + globalPending + weight <=
        (this.testHooks.maxGlobalRetainedWeight ?? MAX_GLOBAL_RETAINED_WEIGHT)
    )
  }

  private async fileIdentity(targetPath: string, directory = false): Promise<FileIdentity | null> {
    try {
      const stat = await fs.lstat(targetPath, { bigint: true })
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) return null
      return { dev: stat.dev, ino: stat.ino, mode: Number(stat.mode) }
    } catch {
      return null
    }
  }

  private async validate(lease: ArrangementLease): Promise<boolean> {
    try {
      if (!this.current(lease)) return false
      const rootRealPath = await fs.realpath(lease.rootPath)
      const root = await fs.stat(rootRealPath, { bigint: true })
      if (
        rootRealPath !== lease.rootIdentity.realPath ||
        root.dev !== lease.rootIdentity.dev ||
        root.ino !== lease.rootIdentity.ino
      ) {
        return false
      }
      const parent = await this.fileIdentity(lease.rootPath, true)
      const target = await this.fileIdentity(lease.targetPath)
      await fs.access(lease.rootPath, fsConstants.W_OK)
      await fs.access(lease.targetPath, fsConstants.W_OK)
      return Boolean(
        parent &&
        target &&
        sameIdentity(parent, lease.parentIdentity) &&
        sameIdentity(target, lease.targetIdentity)
      )
    } catch {
      return false
    }
  }

  private async read(lease: ArrangementLease): Promise<Buffer | null> {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      if (!(await this.validate(lease))) return null
      handle = await fs.open(lease.targetPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      const before = await handle.stat({ bigint: true })
      if (
        !before.isFile() ||
        before.size > BigInt(MAX_SUMMARY_BYTES) ||
        before.dev !== lease.targetIdentity.dev ||
        before.ino !== lease.targetIdentity.ino
      ) {
        return null
      }
      const bytes = await handle.readFile()
      const after = await handle.stat({ bigint: true })
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        !this.current(lease)
      ) {
        return null
      }
      return bytes
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async begin(context: ArrangementBeginContext): Promise<BookReaderResult<BookArrangementDto>> {
    const ownerLeases = [...this.leases.values()].filter(
      (lease) => lease.ownerId === context.ownerId
    ).length
    const ownerPending = this.pendingBeginsByOwner.get(context.ownerId) ?? 0
    const reservation = this.testHooks.pendingDocumentWeight ?? MAX_DOCUMENT_WEIGHT
    const ownerPendingWeight = this.pendingWeightByOwner.get(context.ownerId) ?? 0
    if (
      ownerLeases + ownerPending >= MAX_OWNER_LEASES ||
      this.leases.size + this.pendingBegins >= MAX_GLOBAL_LEASES ||
      this.activeRetainedWeight(context.ownerId) + ownerPendingWeight + reservation >
        (this.testHooks.maxOwnerRetainedWeight ?? MAX_OWNER_RETAINED_WEIGHT) ||
      this.activeRetainedWeight() + this.pendingWeight + reservation >
        (this.testHooks.maxGlobalRetainedWeight ?? MAX_GLOBAL_RETAINED_WEIGHT)
    ) {
      return resultError('arrangement-conflict', 'Too many arrangement drafts are already open.')
    }
    this.pendingBegins++
    this.pendingBeginsByOwner.set(context.ownerId, ownerPending + 1)
    this.pendingWeight += reservation
    this.pendingWeightByOwner.set(context.ownerId, ownerPendingWeight + reservation)
    try {
      return await this.beginReserved(context, reservation)
    } finally {
      this.pendingBegins--
      this.pendingWeight -= reservation
      const remaining = (this.pendingBeginsByOwner.get(context.ownerId) ?? 1) - 1
      if (remaining > 0) this.pendingBeginsByOwner.set(context.ownerId, remaining)
      else this.pendingBeginsByOwner.delete(context.ownerId)
      const remainingWeight =
        (this.pendingWeightByOwner.get(context.ownerId) ?? reservation) - reservation
      if (remainingWeight > 0) this.pendingWeightByOwner.set(context.ownerId, remainingWeight)
      else this.pendingWeightByOwner.delete(context.ownerId)
    }
  }

  private async beginReserved(
    context: ArrangementBeginContext,
    reservation: number
  ): Promise<BookReaderResult<BookArrangementDto>> {
    const targetPath = path.join(context.rootPath, context.summaryPath)
    if (path.dirname(targetPath) !== context.rootPath || !context.isCurrent()) {
      return resultError('arrangement-read-only', 'This book cannot be safely arranged.')
    }
    const parentIdentity = await this.fileIdentity(context.rootPath, true)
    let targetIdentity: FileIdentity | null = null
    try {
      const target = await fs.lstat(targetPath, { bigint: true })
      if (target.size > BigInt(MAX_SUMMARY_BYTES)) {
        return resultError('arrangement-too-large', 'The existing SUMMARY exceeds 2 MiB.')
      }
      if (!target.isSymbolicLink() && target.isFile()) {
        targetIdentity = { dev: target.dev, ino: target.ino, mode: Number(target.mode) }
      }
      await fs.access(context.rootPath, fsConstants.W_OK)
      await fs.access(targetPath, fsConstants.W_OK)
    } catch {
      targetIdentity = null
    }
    if (!parentIdentity || !targetIdentity || !context.isCurrent()) {
      return resultError(
        'arrangement-read-only',
        'The existing SUMMARY is not a stable regular file.'
      )
    }
    const seed: ArrangementLease = {
      arrangementId: randomUUID(),
      ownerId: context.ownerId,
      sessionId: context.sessionId,
      sessionGeneration: context.sessionGeneration,
      rootPath: context.rootPath,
      rootIdentity: { ...context.rootIdentity },
      targetPath,
      parentIdentity,
      targetIdentity,
      mode: targetIdentity.mode,
      revision: '',
      document: null as unknown as SummaryDocument,
      history: [],
      historyBytes: 0,
      operationCount: 0,
      currentWeight: 0,
      generation: 1,
      isCurrent: context.isCurrent,
      overwriteGrant: null,
      saving: false,
      criticalCommit: false,
      revokeAfterCommit: false
    }
    this.leases.set(seed.arrangementId, seed)
    const bytes = await this.read(seed)
    if (!bytes || !this.current(seed)) {
      this.revoke(seed)
      return resultError('arrangement-read-only', 'The existing SUMMARY could not be read safely.')
    }
    const parsed = parseSummaryDocument(bytes)
    if (!parsed.ok) {
      this.revoke(seed)
      const code =
        parsed.error.code === 'invalid-encoding'
          ? 'arrangement-encoding'
          : parsed.error.code === 'limit-exceeded'
            ? 'arrangement-too-large'
            : 'arrangement-read-only'
      return resultError(code, parsed.error.message)
    }
    if (!parsed.value.editable) {
      this.revoke(seed)
      return resultError(
        'arrangement-read-only',
        'This SUMMARY contains an ambiguous or unterminated opaque region.'
      )
    }
    const seedWeight = documentWeight(parsed.value)
    await this.testHooks.beforeActivate?.(context.ownerId)
    if (!this.current(seed) || !this.canRetain(context.ownerId, seedWeight, seed, reservation)) {
      this.revoke(seed)
      return resultError('arrangement-too-large', 'The arrangement document budget is full.')
    }
    seed.document = parsed.value
    seed.currentWeight = seedWeight
    seed.revision = parsed.value.revision
    return { ok: true, value: this.dto(seed) }
  }

  apply(
    request: BookArrangementApplyRequestDto,
    ownerId: number
  ): BookReaderResult<BookArrangementDto> {
    const lease = this.lease(request.arrangementId, ownerId)
    if (!lease || !this.current(lease)) {
      return resultError('arrangement-not-found', 'This arrangement draft has expired.')
    }
    if (lease.saving) {
      return resultError('arrangement-conflict', 'This arrangement is currently being saved.')
    }
    if (lease.operationCount >= (this.testHooks.maxLifetimeOperations ?? MAX_LIFETIME_OPERATIONS)) {
      return resultError('arrangement-conflict', 'The arrangement operation limit was reached.')
    }
    const snapshotBytes = serializeSummaryDocument(lease.document)
    const snapshotLineIds = Uint32Array.from(lease.document.source, (line) => line.id)
    const snapshotWeight = snapshotBytes.byteLength + snapshotLineIds.byteLength
    if (
      lease.history.length >= MAX_HISTORY ||
      lease.historyBytes + snapshotWeight > (this.testHooks.maxHistoryBytes ?? MAX_HISTORY_BYTES)
    ) {
      return resultError('arrangement-too-large', 'The bounded arrangement undo history is full.')
    }
    const applied = applySummaryArrangement(
      lease.document,
      operationFromDto(request),
      lease.operationCount
    )
    if (!applied.ok) {
      return resultError('arrangement-conflict', applied.error.message)
    }
    const nextWeight = documentWeight(applied.value)
    const nextRetainedWeight = nextWeight + lease.historyBytes + snapshotWeight
    if (!this.canRetain(ownerId, nextRetainedWeight, lease)) {
      return resultError('arrangement-too-large', 'The arrangement document budget is full.')
    }
    lease.history.push({
      bytes: snapshotBytes,
      lineIds: snapshotLineIds,
      weight: snapshotWeight
    })
    lease.historyBytes += snapshotWeight
    lease.document = applied.value
    lease.currentWeight = nextWeight
    lease.operationCount++
    lease.overwriteGrant = null
    return { ok: true, value: this.dto(lease) }
  }

  undo(arrangementId: unknown, ownerId: number): BookReaderResult<BookArrangementDto> {
    const lease = this.lease(arrangementId, ownerId)
    if (!lease || !this.current(lease)) {
      return resultError('arrangement-not-found', 'This arrangement draft has expired.')
    }
    if (lease.saving) {
      return resultError('arrangement-conflict', 'This arrangement is currently being saved.')
    }
    const previousSnapshot = lease.history.at(-1)
    if (!previousSnapshot) {
      return resultError('arrangement-conflict', 'There is no arrangement to undo.')
    }
    const previous = restoreSummaryDocument(
      previousSnapshot.bytes,
      previousSnapshot.lineIds,
      lease.document.limits
    )
    if (!previous.ok || !previous.value.editable) {
      this.revoke(lease)
      return resultError('arrangement-read-only', 'The undo snapshot is no longer safely readable.')
    }
    const previousWeight = documentWeight(previous.value)
    const nextRetainedWeight = previousWeight + lease.historyBytes - previousSnapshot.weight
    if (!this.canRetain(ownerId, nextRetainedWeight, lease)) {
      return resultError('arrangement-too-large', 'The arrangement document budget is full.')
    }
    lease.history.pop()
    lease.historyBytes -= previousSnapshot.weight
    lease.document = previous.value
    lease.currentWeight = previousWeight
    lease.overwriteGrant = null
    return { ok: true, value: this.dto(lease) }
  }

  private validateSync(lease: ArrangementLease, expectedRevision: string): boolean {
    try {
      if (!this.current(lease)) return false
      const rootRealPath = fsSync.realpathSync(lease.rootPath)
      const root = fsSync.statSync(rootRealPath, { bigint: true })
      const parent = fsSync.lstatSync(lease.rootPath, { bigint: true })
      const target = fsSync.lstatSync(lease.targetPath, { bigint: true })
      if (
        rootRealPath !== lease.rootIdentity.realPath ||
        root.dev !== lease.rootIdentity.dev ||
        root.ino !== lease.rootIdentity.ino ||
        parent.isSymbolicLink() ||
        !parent.isDirectory() ||
        target.isSymbolicLink() ||
        !target.isFile() ||
        parent.dev !== lease.parentIdentity.dev ||
        parent.ino !== lease.parentIdentity.ino ||
        target.dev !== lease.targetIdentity.dev ||
        target.ino !== lease.targetIdentity.ino
      ) {
        return false
      }
      const descriptor = fsSync.openSync(
        lease.targetPath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
      )
      try {
        fsSync.accessSync(lease.rootPath, fsConstants.W_OK)
        fsSync.accessSync(lease.targetPath, fsConstants.W_OK)
        const stat = fsSync.fstatSync(descriptor, { bigint: true })
        return (
          stat.isFile() &&
          stat.size <= BigInt(MAX_SUMMARY_BYTES) &&
          stat.dev === lease.targetIdentity.dev &&
          stat.ino === lease.targetIdentity.ino &&
          hash(fsSync.readFileSync(descriptor)) === expectedRevision
        )
      } finally {
        fsSync.closeSync(descriptor)
      }
    } catch {
      return false
    }
  }

  private async atomicWrite(
    lease: ArrangementLease,
    bytes: Buffer,
    expectedRevision: string
  ): Promise<{
    committed: boolean
    verified: boolean
    uncertain: boolean
    identity: FileIdentity
  } | null> {
    if (!(await this.validate(lease))) return null
    const tempPath = path.join(lease.rootPath, `.leafbook-summary-${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    let committed = false
    try {
      handle = await fs.open(
        tempPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0),
        lease.mode & 0o777
      )
      await handle.writeFile(bytes)
      await handle.chmod(lease.mode & 0o777)
      await handle.sync()
      const replacement = await handle.stat({ bigint: true })
      await handle.close()
      handle = null
      await this.testHooks.afterTempSync?.()
      if (!(await this.validate(lease))) return null
      const current = await this.read(lease)
      if (!current || hash(current) !== expectedRevision) return null
      await this.testHooks.beforeCommitCritical?.()
      if (!this.validateSync(lease, expectedRevision)) return null
      lease.criticalCommit = true
      this.testHooks.commitCriticalStarted?.()
      fsSync.renameSync(tempPath, lease.targetPath)
      committed = true
      let uncertain = false
      try {
        if (this.testHooks.forceDirectorySyncFailure) {
          throw new Error('test directory fsync failure')
        }
        const directory = fsSync.openSync(lease.rootPath, fsConstants.O_RDONLY)
        try {
          fsSync.fsyncSync(directory)
        } finally {
          fsSync.closeSync(directory)
        }
      } catch {
        uncertain = true
      }
      const descriptor = fsSync.openSync(
        lease.targetPath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
      )
      let verified = false
      try {
        const stat = fsSync.fstatSync(descriptor, { bigint: true })
        verified =
          !this.testHooks.forceCommittedVerificationFailure &&
          stat.isFile() &&
          stat.dev === replacement.dev &&
          stat.ino === replacement.ino &&
          hash(fsSync.readFileSync(descriptor)) === hash(bytes)
      } finally {
        fsSync.closeSync(descriptor)
      }
      return {
        committed: true,
        verified,
        uncertain: uncertain || !verified,
        identity: { dev: replacement.dev, ino: replacement.ino, mode: Number(replacement.mode) }
      }
    } catch {
      if (!committed) return null
      return {
        committed: true,
        verified: false,
        uncertain: true,
        identity: lease.targetIdentity
      }
    } finally {
      lease.criticalCommit = false
      if (lease.revokeAfterCommit) this.finalizeRevoke(lease)
      await handle?.close().catch(() => undefined)
      await fs.unlink(tempPath).catch(() => undefined)
    }
  }

  async save(
    request: BookArrangementSaveRequestDto,
    ownerId: number,
    holdForRefresh: boolean = false
  ): Promise<BookReaderResult<BookArrangementSaveDto>> {
    const lease = this.lease(request.arrangementId, ownerId)
    if (!lease || !this.current(lease)) {
      return resultError('arrangement-not-found', 'This arrangement draft has expired.')
    }
    if (lease.saving) {
      return resultError('arrangement-conflict', 'Another save is already in progress.')
    }
    if (request.revision !== lease.revision) {
      return resultError('arrangement-conflict', 'This arrangement revision is stale.')
    }
    const bytes = serializeSummaryDocument(lease.document)
    if (bytes.byteLength > MAX_SUMMARY_BYTES) {
      return resultError('arrangement-too-large', 'The arranged SUMMARY is too large.')
    }
    lease.saving = true
    let keepBusy = false
    try {
      const reparsed = parseSummaryDocument(bytes)
      if (
        !lease.document.editable ||
        !reparsed.ok ||
        !reparsed.value.editable ||
        reparsed.value.revision !== hash(bytes)
      ) {
        return resultError(
          'arrangement-read-only',
          'The arrangement candidate is no longer safely writable.'
        )
      }
      const current = await this.read(lease)
      if (!current || !this.current(lease)) {
        return resultError(
          'arrangement-read-only',
          'The SUMMARY was replaced or became unreadable.'
        )
      }
      const currentRevision = hash(current)
      const candidateRevision = hash(bytes)
      let expectedRevision = lease.revision
      if (currentRevision !== lease.revision) {
        const grant = lease.overwriteGrant
        const valid =
          typeof request.overwriteToken === 'string' &&
          grant?.token === request.overwriteToken &&
          grant.ownerId === ownerId &&
          grant.generation === lease.generation &&
          grant.baseRevision === lease.revision &&
          grant.externalRevision === currentRevision &&
          grant.candidateRevision === candidateRevision
        if (!valid) {
          const token = randomUUID()
          lease.overwriteGrant = {
            token,
            ownerId,
            generation: lease.generation,
            baseRevision: lease.revision,
            externalRevision: currentRevision,
            candidateRevision
          }
          return resultError(
            'arrangement-conflict',
            'SUMMARY changed outside LeafBook. Reload it or explicitly overwrite it.',
            token
          )
        }
        expectedRevision = currentRevision
        lease.overwriteGrant = null
      }
      const write = await this.atomicWrite(lease, bytes, expectedRevision)
      if (!write) {
        return resultError(
          'arrangement-write-failed',
          'SUMMARY changed while LeafBook was saving it.'
        )
      }
      if (!write.verified) {
        this.revoke(lease)
        return resultError(
          'arrangement-commit-uncertain',
          'The arranged SUMMARY may be visible, but its commit could not be verified.',
          undefined,
          true
        )
      }
      lease.revision = candidateRevision
      lease.targetIdentity = write.identity
      lease.mode = write.identity.mode
      lease.history = []
      lease.historyBytes = 0
      keepBusy = holdForRefresh
      return {
        ok: true,
        value: {
          arrangementId: lease.arrangementId,
          revision: candidateRevision,
          session: null,
          durabilityUncertain: write.uncertain
        }
      }
    } finally {
      if (!keepBusy && this.leases.get(lease.arrangementId) === lease) lease.saving = false
    }
  }

  finishSave(arrangementId: unknown, ownerId: number): void {
    const lease = this.lease(arrangementId, ownerId)
    if (lease) lease.saving = false
  }

  close(arrangementId: unknown, ownerId: number): BookReaderResult<true> {
    const lease = this.lease(arrangementId, ownerId)
    if (!lease) return resultError('arrangement-not-found', 'This arrangement draft has expired.')
    this.revoke(lease)
    return { ok: true, value: true }
  }

  revokeSession(sessionId: string): void {
    for (const lease of this.leases.values()) {
      if (lease.sessionId === sessionId) this.revoke(lease)
    }
  }

  cleanupOwner(ownerId: number): void {
    for (const lease of this.leases.values()) {
      if (lease.ownerId === ownerId) this.revoke(lease)
    }
  }

  private revoke(lease: ArrangementLease): void {
    if (lease.criticalCommit) {
      lease.revokeAfterCommit = true
      return
    }
    this.finalizeRevoke(lease)
  }

  private finalizeRevoke(lease: ArrangementLease): void {
    lease.generation++
    lease.overwriteGrant = null
    this.leases.delete(lease.arrangementId)
  }
}
