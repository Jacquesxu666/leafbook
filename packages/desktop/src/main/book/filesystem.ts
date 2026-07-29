/* eslint-disable @stylistic/space-before-function-paren */
import path from 'path'
import { constants, type Dirent } from 'fs'
import fs, { type FileHandle } from 'fs/promises'
import { buildBook } from 'common/book/builder'
import type {
  BookBuildResult,
  BookDiagnostic,
  BookDiagnosticCode,
  BookFile,
  BookScanOptions
} from 'common/book/model'
import { isMarkdownBookPath } from 'common/book/path'

const DEFAULTS = {
  maxDepth: 32,
  maxFiles: 10_000,
  maxDirectories: 5_000,
  maxEntries: 100_000,
  maxEntriesPerDirectory: 10_000,
  maxDiagnostics: 1_000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxSummaryBytes: 2 * 1024 * 1024,
  maxExcludePatterns: 100,
  maxExcludePatternLength: 256,
  maxExcludeTotalCharacters: 8_192
} as const
const SUMMARY_NAMES = ['SUMMARY.md', 'SUMMARY.markdown'] as const
const ALWAYS_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules'])

export interface BookFilesystemHooks {
  /** Test seam invoked after open and before the first descriptor stat. */
  afterOpen?(absolutePath: string, handle: FileHandle): Promise<void>
  /** Test seam invoked after identity checks and before the bounded read. */
  beforeRead?(absolutePath: string, handle: FileHandle): Promise<void>
}

const finiteLimit = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  Number.isFinite(value) && Number.isInteger(value) && (value as number) >= minimum
    ? Math.min(value as number, maximum)
    : fallback

const normalizedOptions = (value: unknown) => {
  const options = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    maxDepth: finiteLimit(options.maxDepth, DEFAULTS.maxDepth, 0, 128),
    maxFiles: finiteLimit(options.maxFiles, DEFAULTS.maxFiles, 1, 100_000),
    maxDirectories: finiteLimit(options.maxDirectories, DEFAULTS.maxDirectories, 1, 50_000),
    maxEntries: finiteLimit(options.maxEntries, DEFAULTS.maxEntries, 1, 1_000_000),
    maxEntriesPerDirectory: finiteLimit(
      options.maxEntriesPerDirectory,
      DEFAULTS.maxEntriesPerDirectory,
      1,
      100_000
    ),
    maxDiagnostics: finiteLimit(options.maxDiagnostics, DEFAULTS.maxDiagnostics, 1, 10_000),
    maxFileBytes: finiteLimit(options.maxFileBytes, DEFAULTS.maxFileBytes, 1, 64 * 1024 * 1024),
    maxTotalBytes: finiteLimit(
      options.maxTotalBytes,
      DEFAULTS.maxTotalBytes,
      1,
      1024 * 1024 * 1024
    ),
    maxSummaryBytes: finiteLimit(
      options.maxSummaryBytes,
      DEFAULTS.maxSummaryBytes,
      1,
      16 * 1024 * 1024
    ),
    maxExcludePatterns: finiteLimit(
      options.maxExcludePatterns,
      DEFAULTS.maxExcludePatterns,
      0,
      1_000
    ),
    maxExcludePatternLength: finiteLimit(
      options.maxExcludePatternLength,
      DEFAULTS.maxExcludePatternLength,
      1,
      4_096
    ),
    maxExcludeTotalCharacters: finiteLimit(
      options.maxExcludeTotalCharacters,
      DEFAULTS.maxExcludeTotalCharacters,
      1,
      65_536
    )
  }
}

class ScanDiagnostics {
  readonly values: BookDiagnostic[] = []
  private limited = false

  constructor(private readonly maximum: number) {}

  add(
    code: BookDiagnosticCode,
    severity: BookDiagnostic['severity'],
    message: string,
    relativePath?: string,
    count?: number
  ): void {
    if (this.values.length < this.maximum) {
      this.values.push({
        code,
        severity,
        message,
        ...(relativePath ? { source: { path: relativePath }, relatedPath: relativePath } : {}),
        ...(count === undefined ? {} : { count })
      })
    } else if (!this.limited) {
      this.values[this.maximum - 1] = {
        code: 'diagnostic-limit',
        severity: 'warning',
        message: `Diagnostics were capped at ${this.maximum}.`,
        count: this.maximum
      }
      this.limited = true
    }
  }
}

const globToRegExp = (pattern: string): RegExp => {
  let expression = '^'
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        expression += '.*'
        index++
      } else {
        expression += '[^/]*'
      }
    } else if (character === '?') {
      expression += '[^/]'
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    }
  }
  return new RegExp(`${expression}$`)
}

interface ExcludeMatcher {
  pattern: string
  base: string | null
  exact: boolean
  matcher: RegExp | null
}

const compileExcludePatterns = (
  rawOptions: unknown,
  limits: ReturnType<typeof normalizedOptions>,
  diagnostics: ScanDiagnostics
): ExcludeMatcher[] => {
  const value =
    rawOptions && typeof rawOptions === 'object'
      ? (rawOptions as { exclude?: unknown }).exclude
      : undefined
  if (!Array.isArray(value)) return []
  const matchers: ExcludeMatcher[] = []
  let totalCharacters = 0
  let candidateCount = 0
  for (const rawPattern of value) {
    if (++candidateCount > limits.maxExcludePatterns) {
      diagnostics.add(
        'scan-exclude-limit',
        'warning',
        `Exclude patterns were capped at ${limits.maxExcludePatterns}.`,
        undefined,
        limits.maxExcludePatterns
      )
      break
    }
    if (typeof rawPattern !== 'string') continue
    if (
      rawPattern.length > limits.maxExcludePatternLength ||
      totalCharacters + rawPattern.length > limits.maxExcludeTotalCharacters ||
      [...rawPattern].some((character) => character.charCodeAt(0) <= 31)
    ) {
      diagnostics.add(
        'scan-exclude-limit',
        'warning',
        'Ignored an exclude pattern that exceeded a safety limit.'
      )
      continue
    }
    totalCharacters += rawPattern.length
    const pattern = rawPattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (!pattern) continue
    try {
      matchers.push({
        pattern,
        base: pattern.endsWith('/**') ? pattern.slice(0, -3) : null,
        exact: !pattern.includes('*') && !pattern.includes('?'),
        matcher: pattern.includes('*') || pattern.includes('?') ? globToRegExp(pattern) : null
      })
    } catch {
      diagnostics.add('scan-exclude-limit', 'warning', 'Ignored an invalid exclude pattern.')
    }
  }
  return matchers
}

const isWithinRoot = (rootPath: string, candidatePath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

const shouldExclude = (
  relativePath: string,
  name: string,
  patterns: readonly ExcludeMatcher[]
): boolean => {
  if (name.startsWith('.') || ALWAYS_IGNORED_DIRECTORIES.has(name)) return true
  return patterns.some(({ pattern, base, exact, matcher }) => {
    if (base && (relativePath === base || relativePath.startsWith(`${base}/`))) return true
    if (exact) {
      return relativePath === pattern || relativePath.startsWith(`${pattern}/`) || name === pattern
    }
    return Boolean(
      matcher?.test(relativePath) || matcher?.test(name) || matcher?.test(`${relativePath}/`)
    )
  })
}

interface FileIdentity {
  dev: bigint
  ino: bigint
}

interface FileSnapshot extends FileIdentity {
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino

const sameSnapshot = (left: FileSnapshot, right: FileSnapshot): boolean =>
  sameIdentity(left, right) &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

interface SafeReadResult {
  content: string
  bytes: number
}

const boundedRead = async (handle: FileHandle, byteLimit: number): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let total = 0
  const maximum = byteLimit + 1
  while (total < maximum) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum - total))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) break
    chunks.push(buffer.subarray(0, bytesRead))
    total += bytesRead
  }
  return Buffer.concat(chunks, total)
}

const safelyReadFile = async (
  absolutePath: string,
  relativePath: string,
  realRoot: string,
  byteLimit: number,
  diagnostics: ScanDiagnostics,
  hooks: BookFilesystemHooks,
  byteLimitCode: 'scan-file-bytes-limit' | 'scan-summary-bytes-limit' = 'scan-file-bytes-limit'
): Promise<SafeReadResult | null> => {
  let before
  try {
    before = await fs.lstat(absolutePath, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink()) {
      let resolved: string | null = null
      try {
        resolved = await fs.realpath(absolutePath)
      } catch {
        // A broken or changing symlink remains unreadable.
      }
      diagnostics.add(
        resolved && !isWithinRoot(realRoot, resolved) ? 'symlink-escape' : 'scan-identity-mismatch',
        'error',
        'Skipped a file whose identity was unsafe or changed.',
        relativePath
      )
      return null
    }
  } catch {
    diagnostics.add(
      'scan-read-error',
      'warning',
      'Unable to inspect a Markdown file.',
      relativePath
    )
    return null
  }

  let handle: FileHandle | null = null
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    handle = await fs.open(absolutePath, constants.O_RDONLY | noFollow)
    await hooks.afterOpen?.(absolutePath, handle)
    const openedBefore = await handle.stat({ bigint: true })
    const currentRealPath = await fs.realpath(absolutePath)
    if (!isWithinRoot(realRoot, currentRealPath)) {
      diagnostics.add(
        'symlink-escape',
        'error',
        'Skipped a file that resolves outside the book root.',
        relativePath
      )
      return null
    }
    const currentBefore = await fs.stat(currentRealPath, { bigint: true })
    if (
      !openedBefore.isFile() ||
      !sameIdentity(before, openedBefore) ||
      !sameIdentity(openedBefore, currentBefore)
    ) {
      diagnostics.add(
        'scan-identity-mismatch',
        'error',
        'Skipped a file whose identity changed during inspection.',
        relativePath
      )
      return null
    }
    if (!sameSnapshot(before, openedBefore) || !sameSnapshot(openedBefore, currentBefore)) {
      diagnostics.add(
        'scan-file-changed',
        'warning',
        'Skipped a file that changed during inspection.',
        relativePath
      )
      return null
    }
    if (openedBefore.size > BigInt(byteLimit)) {
      diagnostics.add(
        byteLimitCode,
        'warning',
        byteLimitCode === 'scan-summary-bytes-limit'
          ? `Skipped SUMMARY larger than ${byteLimit} bytes.`
          : `Skipped a Markdown file larger than ${byteLimit} bytes.`,
        relativePath,
        byteLimit
      )
      return null
    }

    await hooks.beforeRead?.(absolutePath, handle)
    const raw = await boundedRead(handle, byteLimit)
    if (raw.length > byteLimit) {
      diagnostics.add(
        byteLimitCode,
        'warning',
        byteLimitCode === 'scan-summary-bytes-limit'
          ? `Skipped SUMMARY larger than ${byteLimit} bytes.`
          : `Skipped a Markdown file larger than ${byteLimit} bytes.`,
        relativePath,
        byteLimit
      )
      return null
    }
    const openedAfter = await handle.stat({ bigint: true })
    const finalRealPath = await fs.realpath(absolutePath)
    const currentAfter = await fs.stat(finalRealPath, { bigint: true })
    if (
      !isWithinRoot(realRoot, finalRealPath) ||
      !sameIdentity(openedBefore, openedAfter) ||
      !sameIdentity(openedAfter, currentAfter)
    ) {
      diagnostics.add(
        'scan-identity-mismatch',
        'error',
        'Skipped a file whose identity changed while it was read.',
        relativePath
      )
      return null
    }
    if (!sameSnapshot(openedBefore, openedAfter) || !sameSnapshot(openedAfter, currentAfter)) {
      diagnostics.add(
        'scan-file-changed',
        'warning',
        'Skipped a file that changed while it was read.',
        relativePath
      )
      return null
    }
    if (raw.includes(0)) {
      diagnostics.add(
        'scan-read-error',
        'warning',
        'Skipped a Markdown file containing NUL bytes.',
        relativePath
      )
      return null
    }
    return { content: new TextDecoder().decode(raw), bytes: raw.length }
  } catch {
    diagnostics.add(
      'scan-read-error',
      'warning',
      'Unable to safely read a Markdown file.',
      relativePath
    )
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Main-process filesystem boundary.
 *
 * The caller must provide a non-empty absolute path selected by an authorized
 * Phase 4 picker flow; this function revalidates it. Directory symlinks found
 * during a static scan are never traversed. File content is read only from a
 * bounded descriptor after identity and containment checks, then checked again.
 *
 * Node does not expose the openat-style primitives needed to freeze an entire
 * concurrently mutable parent namespace. A hostile parent rename can therefore
 * invalidate directory enumeration assumptions. No content is accepted unless
 * the opened file descriptor itself remains an in-root, stable identity.
 */
export const loadBookFromDirectory = async (
  rootPath: string,
  options: BookScanOptions = {},
  hooks: BookFilesystemHooks = {}
): Promise<BookBuildResult> => {
  const limits = normalizedOptions(options)
  const diagnostics = new ScanDiagnostics(limits.maxDiagnostics)
  const files: BookFile[] = []
  const excludes = compileExcludePatterns(options, limits, diagnostics)

  if (
    typeof rootPath !== 'string' ||
    !rootPath.trim() ||
    rootPath.length > 32_768 ||
    rootPath.includes('\0') ||
    !path.isAbsolute(rootPath)
  ) {
    diagnostics.add('scan-root-error', 'error', 'The book root must be a non-empty absolute path.')
    return buildBook({
      rootName: 'Untitled Book',
      files,
      diagnostics: diagnostics.values,
      limits: { maxDiagnostics: limits.maxDiagnostics }
    })
  }

  let realRoot: string
  try {
    realRoot = await fs.realpath(rootPath)
    const rootStat = await fs.stat(realRoot)
    if (!rootStat.isDirectory()) throw new Error()
  } catch {
    diagnostics.add('scan-root-error', 'error', 'Unable to read the book root.')
    return buildBook({
      rootName: path.basename(rootPath),
      files,
      diagnostics: diagnostics.values,
      limits: { maxDiagnostics: limits.maxDiagnostics }
    })
  }

  // Probe exact candidates directly so a huge root directory cannot prevent
  // the independently bounded, authoritative SUMMARY from loading.
  let summary: BookFile | null = null
  for (const summaryName of SUMMARY_NAMES) {
    let exists = false
    try {
      exists = !(await fs.lstat(path.join(realRoot, summaryName))).isDirectory()
    } catch {
      // Missing candidates are normal and do not produce diagnostics.
    }
    if (!exists) continue
    const result = await safelyReadFile(
      path.join(realRoot, summaryName),
      summaryName,
      realRoot,
      limits.maxSummaryBytes,
      diagnostics,
      hooks,
      'scan-summary-bytes-limit'
    )
    if (result) summary = { path: summaryName, content: result.content }
    break
  }

  let fileCount = 0
  let directoryCount = 1
  let entryCount = 0
  let totalBytes = 0
  let stopped = false

  const stop = (
    code: BookDiagnosticCode,
    message: string,
    count: number,
    relativePath?: string
  ): void => {
    diagnostics.add(code, 'warning', message, relativePath, count)
    stopped = true
  }

  const readDirectory = async (
    absoluteDirectory: string,
    relativeDirectory: string
  ): Promise<Dirent[] | null> => {
    const entries: Dirent[] = []
    let directory
    try {
      directory = await fs.opendir(absoluteDirectory)
      for await (const entry of directory) {
        if (++entryCount > limits.maxEntries) {
          stop(
            'scan-entry-limit',
            `Stopped scanning at ${limits.maxEntries} directory entries.`,
            limits.maxEntries,
            relativeDirectory || undefined
          )
          return null
        }
        entries.push(entry)
        if (entries.length > limits.maxEntriesPerDirectory) {
          diagnostics.add(
            'scan-directory-entry-limit',
            'warning',
            `Skipped a directory with more than ${limits.maxEntriesPerDirectory} entries.`,
            relativeDirectory || undefined,
            limits.maxEntriesPerDirectory
          )
          return null
        }
      }
      return entries
    } catch {
      diagnostics.add(
        'scan-read-error',
        'warning',
        'Unable to enumerate a directory.',
        relativeDirectory || undefined
      )
      return null
    } finally {
      await directory?.close().catch(() => undefined)
    }
  }

  const scanDirectory = async (
    absoluteDirectory: string,
    relativeDirectory: string,
    depth: number
  ): Promise<void> => {
    if (stopped) return
    if (depth > limits.maxDepth) {
      diagnostics.add(
        'scan-depth-limit',
        'warning',
        `Skipped a directory beyond depth ${limits.maxDepth}.`,
        relativeDirectory,
        limits.maxDepth
      )
      return
    }
    const entries = await readDirectory(absoluteDirectory, relativeDirectory)
    if (!entries || stopped) return
    entries.sort((left, right) => {
      const lower = left.name.toLowerCase().localeCompare(right.name.toLowerCase(), 'en', {
        numeric: true
      })
      return lower || left.name.localeCompare(right.name, 'en', { numeric: true })
    })

    for (const entry of entries) {
      if (stopped) break
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (SUMMARY_NAMES.includes(relativePath as (typeof SUMMARY_NAMES)[number])) continue
      if (shouldExclude(relativePath, entry.name, excludes)) continue
      const absolutePath = path.join(absoluteDirectory, entry.name)

      let entryStat
      try {
        entryStat = await fs.lstat(absolutePath)
      } catch {
        diagnostics.add(
          'scan-read-error',
          'warning',
          'Unable to inspect a directory entry.',
          relativePath
        )
        continue
      }
      if (entryStat.isSymbolicLink()) {
        let resolved: string | null = null
        try {
          resolved = await fs.realpath(absolutePath)
        } catch {
          // Broken links are rejected below.
        }
        let directoryLink = false
        if (resolved && isWithinRoot(realRoot, resolved)) {
          try {
            directoryLink = (await fs.stat(resolved)).isDirectory()
          } catch {
            // A changing link remains unsafe.
          }
        }
        diagnostics.add(
          resolved && !isWithinRoot(realRoot, resolved)
            ? 'symlink-escape'
            : directoryLink
              ? 'symlink-directory'
              : 'scan-identity-mismatch',
          resolved && !isWithinRoot(realRoot, resolved) ? 'error' : 'warning',
          directoryLink
            ? 'Skipped a directory symlink; directory links are never traversed.'
            : 'Skipped an unsafe or changing symbolic link.',
          relativePath
        )
        continue
      }
      if (entryStat.isDirectory()) {
        if (++directoryCount > limits.maxDirectories) {
          stop(
            'scan-directory-limit',
            `Stopped scanning at ${limits.maxDirectories} directories.`,
            limits.maxDirectories,
            relativePath
          )
          break
        }
        await scanDirectory(absolutePath, relativePath, depth + 1)
        continue
      }
      if (!entryStat.isFile() || !isMarkdownBookPath(relativePath)) continue
      if (fileCount >= limits.maxFiles) {
        stop(
          'scan-file-limit',
          `Stopped collecting Markdown files at ${limits.maxFiles}.`,
          limits.maxFiles,
          relativePath
        )
        break
      }
      if (entryStat.size > limits.maxFileBytes) {
        diagnostics.add(
          'scan-file-bytes-limit',
          'warning',
          `Skipped a Markdown file larger than ${limits.maxFileBytes} bytes.`,
          relativePath,
          limits.maxFileBytes
        )
        continue
      }
      if (totalBytes + entryStat.size > limits.maxTotalBytes) {
        stop(
          'scan-total-bytes-limit',
          `Stopped at ${limits.maxTotalBytes} bytes of Markdown content.`,
          limits.maxTotalBytes,
          relativePath
        )
        break
      }
      const result = await safelyReadFile(
        absolutePath,
        relativePath,
        realRoot,
        limits.maxFileBytes,
        diagnostics,
        hooks
      )
      if (!result) continue
      if (totalBytes + result.bytes > limits.maxTotalBytes) {
        stop(
          'scan-total-bytes-limit',
          `Stopped at ${limits.maxTotalBytes} bytes of Markdown content.`,
          limits.maxTotalBytes,
          relativePath
        )
        break
      }
      files.push({ path: relativePath.split(path.sep).join('/'), content: result.content })
      fileCount++
      totalBytes += result.bytes
    }
  }

  await scanDirectory(realRoot, '', 0)
  return buildBook({
    rootName: path.basename(realRoot),
    files,
    summary,
    diagnostics: diagnostics.values,
    limits: {
      maxFiles: limits.maxFiles + (summary ? 1 : 0),
      maxContentBytes: limits.maxTotalBytes + (summary ? Buffer.byteLength(summary.content) : 0),
      maxContentCharacters: limits.maxTotalBytes + (summary ? summary.content.length : 0),
      maxDiagnostics: limits.maxDiagnostics
    }
  })
}
