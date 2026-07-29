/* eslint-disable @stylistic/indent */
import path from 'path'

const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const URI_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i
const WINDOWS_ABSOLUTE_RE = /^[a-z]:[\\/]/i
const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })

export const isMarkdownBookPath = (pathname: string): boolean =>
  /\.(?:md|markdown)$/i.test(pathname)

export type BookTargetResolution =
  | { kind: 'local'; path: string; fragment: string | null }
  | { kind: 'external'; url: string }
  | {
      kind: 'invalid'
      reason: 'invalid-path' | 'unsafe-path' | 'unsafe-external-url' | 'non-markdown-target'
      message: string
    }

const invalid = (
  reason: Extract<BookTargetResolution, { kind: 'invalid' }>['reason'],
  message: string
): BookTargetResolution => ({ kind: 'invalid', reason, message })

const decodeOnce = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Validate a physical catalog path. Filesystem names are never URL-decoded:
 * `a%20b.md` and `a b.md` are different files.
 */
export const normalizeBookFilePath = (rawPath: string): string | null => {
  if (
    !rawPath ||
    rawPath.length > 4_096 ||
    hasControlCharacters(rawPath) ||
    rawPath.includes('\\')
  ) {
    return null
  }
  if (rawPath.startsWith('/') || WINDOWS_ABSOLUTE_RE.test(rawPath)) return null
  const normalized = path.posix.normalize(rawPath)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized) ||
    normalized !== rawPath
  ) {
    return null
  }
  return normalized
}

export const normalizeBookRootName = (value: string): string => {
  if (typeof value !== 'string' || value.length > 4_096) return 'Untitled Book'
  const candidate = typeof value === 'string' ? value.trim() : ''
  return !candidate || hasControlCharacters(candidate) || /[\\/]/.test(candidate)
    ? 'Untitled Book'
    : candidate.slice(0, 255)
}

const resolveExternal = (target: string): BookTargetResolution => {
  if (target.startsWith('//')) {
    return invalid('unsafe-external-url', 'Protocol-relative URLs are not allowed.')
  }
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return invalid('unsafe-external-url', 'The external URL is malformed.')
  }
  if (!SAFE_EXTERNAL_SCHEMES.has(url.protocol)) {
    return invalid(
      url.protocol === 'file:' ? 'unsafe-path' : 'unsafe-external-url',
      'The external URL scheme is not allowed.'
    )
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.username || url.password)) {
    return invalid('unsafe-external-url', 'Credentials are not allowed in external URLs.')
  }
  return { kind: 'external', url: url.href }
}

/**
 * Resolve one URL-encoded SUMMARY destination. Only SUMMARY destinations use
 * URL decoding, exactly once. The resulting physical path is not decoded again.
 */
export const resolveBookTarget = (rawTarget: string): BookTargetResolution => {
  if (typeof rawTarget !== 'string' || rawTarget.length > 65_536) {
    return invalid('invalid-path', 'The chapter target exceeds its safety limit.')
  }
  if (hasControlCharacters(rawTarget)) {
    return invalid('unsafe-path', 'Control characters are not allowed.')
  }
  const target = rawTarget.trim()
  if (!target) return invalid('invalid-path', 'The chapter target is empty.')
  if (WINDOWS_ABSOLUTE_RE.test(target) || target.startsWith('\\\\')) {
    return invalid('unsafe-path', 'Absolute chapter paths are not allowed.')
  }
  if (target.startsWith('//') || URI_SCHEME_RE.test(target)) return resolveExternal(target)

  const hashIndex = target.indexOf('#')
  const encodedPath = hashIndex === -1 ? target : target.slice(0, hashIndex)
  const encodedFragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1)
  if (!encodedPath) {
    return invalid('invalid-path', 'A chapter link must name a Markdown file.')
  }
  if (encodedPath.includes('?')) {
    return invalid('invalid-path', 'Query strings are not supported for local chapters.')
  }

  const decodedPath = decodeOnce(encodedPath)
  const decodedFragment = decodeOnce(encodedFragment)
  if (decodedPath === null || decodedFragment === null) {
    return invalid('invalid-path', 'The chapter target contains malformed URL encoding.')
  }
  if (hasControlCharacters(decodedPath) || hasControlCharacters(decodedFragment)) {
    return invalid('unsafe-path', 'Control characters are not allowed.')
  }

  const slashPath = decodedPath.replaceAll('\\', '/')
  if (slashPath.startsWith('/') || WINDOWS_ABSOLUTE_RE.test(slashPath)) {
    return invalid('unsafe-path', 'Absolute chapter paths are not allowed.')
  }
  const normalized = path.posix.normalize(slashPath)
  if (normalized === '..' || normalized.startsWith('../')) {
    return invalid('unsafe-path', 'Chapter paths may not escape the book root.')
  }
  if (normalized === '.' || !isMarkdownBookPath(normalized)) {
    return invalid(
      normalized === '.' ? 'invalid-path' : 'non-markdown-target',
      normalized === '.'
        ? 'The chapter target does not name a file.'
        : 'Local chapters must use a .md or .markdown extension.'
    )
  }
  return { kind: 'local', path: normalized, fragment: decodedFragment || null }
}

export const bookPathIdentity = (pathname: string): string =>
  pathname.normalize('NFC').toLocaleLowerCase('en-US')
