import path from 'path'
import fs, { constants as fsConstants, type BigIntStats } from 'fs'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'

const DIRECTORY_NAME = 'leafbook-preparation-drafts'
const KEY_NAME = '.root-hmac-key'
const SCHEMA_VERSION = 1
const MAX_DRAFT_BYTES = 2 * 1024 * 1024
const MAX_CHAPTERS = 2_000
const MAX_TITLE_CHARACTERS = 512
const MAX_RELATIVE_PATH_CHARACTERS = 8_192
const MAX_STARTUP_ENTRIES = 256

export interface PreparationDraftSourceIdentity {
  dev: string
  ino: string
  mode: number
  nlink: string
  size: string
  mtimeNs: string
  ctimeNs: string
}

export interface PreparationDraftChapter {
  id: string
  line: number
  title: string
  fragment: string
  included: boolean
  order: number
}

export interface PreparationDraftPayload {
  draftId: string
  rootDev: string
  rootIno: string
  rootRealPathHmac: string
  sourcePath: string
  sourceIdentity: PreparationDraftSourceIdentity
  baseRevision: string
  chapters: PreparationDraftChapter[]
  nonce: number
}

interface PreparationDraftEnvelope {
  schemaVersion: number
  payload: PreparationDraftPayload
  checksum: string
}

export interface PreparationDraftFileIdentity {
  dev: bigint
  ino: bigint
  mode: number
  nlink: bigint
  size: bigint
}

export type PreparationDraftReadResult =
  | { status: 'none' }
  | { status: 'invalid'; identity: PreparationDraftFileIdentity }
  | {
    status: 'valid'
    identity: PreparationDraftFileIdentity
    payload: PreparationDraftPayload
  }

const canonicalJson = (value: unknown): string => JSON.stringify(value)
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const identity = (stat: BigIntStats): PreparationDraftFileIdentity => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: Number(stat.mode),
  nlink: stat.nlink,
  size: stat.size
})
const sameIdentity = (
  left: PreparationDraftFileIdentity,
  right: PreparationDraftFileIdentity
): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size
const ownedByCurrentUser = (stat: BigIntStats): boolean =>
  typeof process.getuid !== 'function' || stat.uid === BigInt(process.getuid())
const privateRegular = (stat: BigIntStats, expectedSize?: number): boolean =>
  stat.isFile() &&
  !stat.isSymbolicLink() &&
  stat.nlink === 1n &&
  ownedByCurrentUser(stat) &&
  (Number(stat.mode) & 0o777) === 0o600 &&
  (expectedSize === undefined || stat.size === BigInt(expectedSize))

const validHexDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const validBoundedText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && [...value].length <= maximum && !/\0/.test(value)
const validRelativeSource = (value: unknown): value is string =>
  validBoundedText(value, MAX_RELATIVE_PATH_CHARACTERS) &&
  !path.isAbsolute(value) &&
  !value.includes('\\') &&
  value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')

const validSourceIdentity = (value: unknown): value is PreparationDraftSourceIdentity => {
  const item = value as Partial<PreparationDraftSourceIdentity> | null
  return Boolean(
    item &&
    typeof item.dev === 'string' &&
    /^\d+$/.test(item.dev) &&
    typeof item.ino === 'string' &&
    /^\d+$/.test(item.ino) &&
    Number.isSafeInteger(item.mode) &&
    typeof item.nlink === 'string' &&
    /^\d+$/.test(item.nlink) &&
    typeof item.size === 'string' &&
    /^\d+$/.test(item.size) &&
    typeof item.mtimeNs === 'string' &&
    /^\d+$/.test(item.mtimeNs) &&
    typeof item.ctimeNs === 'string' &&
    /^\d+$/.test(item.ctimeNs)
  )
}

const validPayload = (value: unknown): value is PreparationDraftPayload => {
  const item = value as Partial<PreparationDraftPayload> | null
  if (
    !item ||
    !validBoundedText(item.draftId, 128) ||
    typeof item.rootDev !== 'string' ||
    !/^\d+$/.test(item.rootDev) ||
    typeof item.rootIno !== 'string' ||
    !/^\d+$/.test(item.rootIno) ||
    !validHexDigest(item.rootRealPathHmac) ||
    !validRelativeSource(item.sourcePath) ||
    !validSourceIdentity(item.sourceIdentity) ||
    !validHexDigest(item.baseRevision) ||
    !Number.isSafeInteger(item.nonce) ||
    (item.nonce ?? -1) < 0 ||
    (item.nonce ?? Number.MAX_SAFE_INTEGER) >= Number.MAX_SAFE_INTEGER ||
    !Array.isArray(item.chapters) ||
    item.chapters.length < 2 ||
    item.chapters.length > MAX_CHAPTERS
  ) {
    return false
  }
  const ids = new Set<string>()
  const orders = new Set<number>()
  for (const chapter of item.chapters) {
    if (
      !chapter ||
      !validBoundedText(chapter.id, 128) ||
      ids.has(chapter.id) ||
      !Number.isSafeInteger(chapter.line) ||
      chapter.line < 1 ||
      !validBoundedText(chapter.title, MAX_TITLE_CHARACTERS) ||
      !validBoundedText(chapter.fragment, MAX_RELATIVE_PATH_CHARACTERS) ||
      typeof chapter.included !== 'boolean' ||
      !Number.isSafeInteger(chapter.order) ||
      chapter.order < 0 ||
      orders.has(chapter.order)
    ) {
      return false
    }
    ids.add(chapter.id)
    orders.add(chapter.order)
  }
  return item.chapters.filter((chapter) => chapter.included).length > 0
}

export class BookPreparationDraftStore {
  private readonly directoryPath: string
  private readonly directoryIdentity: PreparationDraftFileIdentity
  private readonly key: Buffer

  constructor(userDataPath: string) {
    this.directoryPath = path.join(userDataPath, DIRECTORY_NAME)
    fs.mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 })
    const directory = fs.lstatSync(this.directoryPath, { bigint: true })
    if (directory.isSymbolicLink() || !directory.isDirectory() || !ownedByCurrentUser(directory)) {
      throw new Error('unsafe preparation draft directory')
    }
    if ((Number(directory.mode) & 0o777) !== 0o700) fs.chmodSync(this.directoryPath, 0o700)
    const stableDirectory = fs.lstatSync(this.directoryPath, { bigint: true })
    if (
      stableDirectory.isSymbolicLink() ||
      !stableDirectory.isDirectory() ||
      !ownedByCurrentUser(stableDirectory) ||
      (Number(stableDirectory.mode) & 0o777) !== 0o700
    ) {
      throw new Error('preparation draft directory is not private')
    }
    this.directoryIdentity = identity(stableDirectory)
    this.key = this.loadOrCreateKey()
    this.cleanupKnownTemps()
  }

  private directoryCurrent(): boolean {
    try {
      const current = fs.lstatSync(this.directoryPath, { bigint: true })
      return (
        current.isDirectory() &&
        !current.isSymbolicLink() &&
        ownedByCurrentUser(current) &&
        (Number(current.mode) & 0o777) === 0o700 &&
        current.dev === this.directoryIdentity.dev &&
        current.ino === this.directoryIdentity.ino &&
        Number(current.mode) === this.directoryIdentity.mode
      )
    } catch {
      return false
    }
  }

  private loadOrCreateKey(): Buffer {
    const keyPath = path.join(this.directoryPath, KEY_NAME)
    let descriptor: number | null = null
    try {
      try {
        descriptor = fs.openSync(
          keyPath,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            (fsConstants.O_NOFOLLOW ?? 0),
          0o600
        )
        const created = randomBytes(32)
        fs.writeFileSync(descriptor, created)
        fs.fsyncSync(descriptor)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      } finally {
        if (descriptor !== null) fs.closeSync(descriptor)
      }
      descriptor = fs.openSync(keyPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      const before = fs.fstatSync(descriptor, { bigint: true })
      const pathname = fs.lstatSync(keyPath, { bigint: true })
      if (!privateRegular(before, 32) || !sameIdentity(identity(before), identity(pathname))) {
        throw new Error('unsafe preparation draft key')
      }
      const key = fs.readFileSync(descriptor)
      const after = fs.fstatSync(descriptor, { bigint: true })
      if (key.byteLength !== 32 || !sameIdentity(identity(before), identity(after))) {
        throw new Error('unstable preparation draft key')
      }
      return key
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor)
    }
  }

  rootHmac(canonicalRootPath: string): string {
    return createHmac('sha256', this.key).update(canonicalRootPath, 'utf8').digest('hex')
  }

  private filePath(rootHmac: string): string {
    if (!validHexDigest(rootHmac)) throw new Error('invalid preparation draft key')
    return path.join(this.directoryPath, `${rootHmac}.json`)
  }

  private readExact(pathname: string): PreparationDraftReadResult {
    let descriptor: number | null = null
    let observed: PreparationDraftFileIdentity | null = null
    try {
      const pathnameBefore = fs.lstatSync(pathname, { bigint: true })
      observed = identity(pathnameBefore)
      if (
        !privateRegular(pathnameBefore) ||
        pathnameBefore.size < 2n ||
        pathnameBefore.size > BigInt(MAX_DRAFT_BYTES)
      ) {
        return { status: 'invalid', identity: observed }
      }
      descriptor = fs.openSync(
        pathname,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
      )
      const before = fs.fstatSync(descriptor, { bigint: true })
      const fileIdentity = identity(before)
      if (
        !privateRegular(before) ||
        before.size < 2n ||
        before.size > BigInt(MAX_DRAFT_BYTES) ||
        !sameIdentity(observed, fileIdentity)
      ) {
        return { status: 'invalid', identity: fileIdentity }
      }
      const bytes = fs.readFileSync(descriptor)
      const after = fs.fstatSync(descriptor, { bigint: true })
      const pathnameAfter = fs.lstatSync(pathname, { bigint: true })
      if (
        bytes.byteLength !== Number(before.size) ||
        !sameIdentity(fileIdentity, identity(after)) ||
        !sameIdentity(fileIdentity, identity(pathnameAfter))
      ) {
        return { status: 'invalid', identity: fileIdentity }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(bytes.toString('utf8'))
      } catch {
        return { status: 'invalid', identity: fileIdentity }
      }
      const envelope = parsed as Partial<PreparationDraftEnvelope> | null
      if (
        !envelope ||
        envelope.schemaVersion !== SCHEMA_VERSION ||
        !validPayload(envelope.payload) ||
        !validHexDigest(envelope.checksum)
      ) {
        return { status: 'invalid', identity: fileIdentity }
      }
      const expected = Buffer.from(sha256(canonicalJson(envelope.payload)), 'hex')
      const actual = Buffer.from(envelope.checksum, 'hex')
      if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
        return { status: 'invalid', identity: fileIdentity }
      }
      return { status: 'valid', identity: fileIdentity, payload: envelope.payload }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'none' }
      if (observed) return { status: 'invalid', identity: observed }
      throw error
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor)
    }
  }

  read(canonicalRootPath: string): PreparationDraftReadResult {
    if (!this.directoryCurrent()) throw new Error('preparation draft directory changed')
    return this.readExact(this.filePath(this.rootHmac(canonicalRootPath)))
  }

  write(
    canonicalRootPath: string,
    payload: PreparationDraftPayload,
    isCurrent: () => boolean
  ): 'saved' | 'uncertain' | 'failed' {
    if (!validPayload(payload) || !this.directoryCurrent() || !isCurrent()) return 'failed'
    const rootHmac = this.rootHmac(canonicalRootPath)
    if (payload.rootRealPathHmac !== rootHmac) return 'failed'
    const destination = this.filePath(rootHmac)
    const temp = path.join(this.directoryPath, `.${rootHmac}.${randomUUID()}.tmp`)
    const envelope: PreparationDraftEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      payload,
      checksum: sha256(canonicalJson(payload))
    }
    const bytes = Buffer.from(canonicalJson(envelope), 'utf8')
    if (bytes.byteLength > MAX_DRAFT_BYTES) return 'failed'
    let descriptor: number | null = null
    let renamed = false
    try {
      descriptor = fs.openSync(
        temp,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0),
        0o600
      )
      fs.writeFileSync(descriptor, bytes)
      fs.fsyncSync(descriptor)
      const written = fs.fstatSync(descriptor, { bigint: true })
      if (!privateRegular(written, bytes.byteLength) || !isCurrent() || !this.directoryCurrent()) {
        return 'failed'
      }
      fs.closeSync(descriptor)
      descriptor = null
      if (!isCurrent() || !this.directoryCurrent()) return 'failed'
      const existing = this.readExact(destination)
      if (
        existing.status !== 'none' &&
        (existing.status !== 'valid' ||
          existing.payload.draftId !== payload.draftId ||
          existing.payload.nonce >= payload.nonce)
      ) {
        return 'failed'
      }
      fs.renameSync(temp, destination)
      renamed = true
      const committed = this.readExact(destination)
      if (
        committed.status !== 'valid' ||
        canonicalJson(committed.payload) !== canonicalJson(payload)
      ) {
        return 'uncertain'
      }
      const directory = fs.openSync(
        this.directoryPath,
        fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)
      )
      try {
        const directoryStat = fs.fstatSync(directory, { bigint: true })
        if (
          !directoryStat.isDirectory() ||
          directoryStat.dev !== this.directoryIdentity.dev ||
          directoryStat.ino !== this.directoryIdentity.ino ||
          Number(directoryStat.mode) !== this.directoryIdentity.mode
        ) {
          return 'uncertain'
        }
        fs.fsyncSync(directory)
      } finally {
        fs.closeSync(directory)
      }
      return isCurrent() ? 'saved' : 'uncertain'
    } catch {
      return renamed ? 'uncertain' : 'failed'
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor)
      if (!renamed) this.unlinkKnownTemp(temp)
    }
  }

  discard(canonicalRootPath: string, expected?: PreparationDraftFileIdentity): boolean {
    if (!this.directoryCurrent()) return false
    const pathname = this.filePath(this.rootHmac(canonicalRootPath))
    let current: BigIntStats
    try {
      current = fs.lstatSync(pathname, { bigint: true })
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
    const currentIdentity = identity(current)
    if (
      current.isDirectory() ||
      (expected && !sameIdentity(currentIdentity, expected)) ||
      !this.directoryCurrent()
    ) {
      return false
    }
    let descriptor: number | null = null
    try {
      if (!current.isSymbolicLink() && current.isFile()) {
        descriptor = fs.openSync(
          pathname,
          fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
        )
        const opened = fs.fstatSync(descriptor, { bigint: true })
        if (!sameIdentity(currentIdentity, identity(opened))) return false
      }
      const pathnameAfter = fs.lstatSync(pathname, { bigint: true })
      if (!sameIdentity(currentIdentity, identity(pathnameAfter)) || !this.directoryCurrent()) {
        return false
      }
      fs.unlinkSync(pathname)
      const directory = fs.openSync(
        this.directoryPath,
        fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0)
      )
      try {
        fs.fsyncSync(directory)
      } finally {
        fs.closeSync(directory)
      }
      return true
    } catch {
      return false
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor)
    }
  }

  private cleanupKnownTemps(): void {
    if (!this.directoryCurrent()) return
    let directory: fs.Dir | null = null
    try {
      directory = fs.opendirSync(this.directoryPath)
      let count = 0
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > MAX_STARTUP_ENTRIES) break
        if (entry.isFile() && /^\.[a-f0-9]{64}\.[0-9a-f-]{36}\.tmp$/.test(entry.name)) {
          this.unlinkKnownTemp(path.join(this.directoryPath, entry.name))
        }
      }
    } catch {
      // Startup cleanup is fail-closed and never broadens its target set.
    } finally {
      directory?.closeSync()
    }
  }

  private unlinkKnownTemp(pathname: string): void {
    let descriptor: number | null = null
    try {
      const pathnameBefore = fs.lstatSync(pathname, { bigint: true })
      if (!privateRegular(pathnameBefore) || !this.directoryCurrent()) return
      descriptor = fs.openSync(pathname, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      const opened = fs.fstatSync(descriptor, { bigint: true })
      const pathnameAfter = fs.lstatSync(pathname, { bigint: true })
      if (
        !sameIdentity(identity(pathnameBefore), identity(opened)) ||
        !sameIdentity(identity(opened), identity(pathnameAfter)) ||
        !this.directoryCurrent()
      ) {
        return
      }
      fs.unlinkSync(pathname)
    } catch {
      // Never remove an entry whose identity cannot be proven.
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor)
    }
  }
}

export const createPreparationDraftId = (): string => randomUUID()
