export type BookDiagnosticSeverity = 'info' | 'warning' | 'error'

export type BookDiagnosticCode =
  | 'invalid-summary'
  | 'invalid-summary-item'
  | 'invalid-path'
  | 'unsafe-path'
  | 'unsafe-external-url'
  | 'non-markdown-target'
  | 'duplicate-chapter'
  | 'missing-chapter'
  | 'orphaned-chapters'
  | 'path-identity-collision'
  | 'build-file-limit'
  | 'build-node-limit'
  | 'build-depth-limit'
  | 'build-content-limit'
  | 'diagnostic-limit'
  | 'summary-character-limit'
  | 'summary-line-limit'
  | 'summary-list-item-limit'
  | 'summary-link-limit'
  | 'scan-depth-limit'
  | 'scan-file-limit'
  | 'scan-directory-limit'
  | 'scan-entry-limit'
  | 'scan-file-bytes-limit'
  | 'scan-total-bytes-limit'
  | 'scan-summary-bytes-limit'
  | 'scan-directory-entry-limit'
  | 'scan-exclude-limit'
  | 'scan-root-error'
  | 'scan-read-error'
  | 'scan-file-changed'
  | 'scan-identity-mismatch'
  | 'symlink-escape'
  | 'symlink-directory'

export interface BookSourceLocation {
  /** POSIX path relative to the book root. */
  path: string
  line?: number
}

export interface BookDiagnostic {
  code: BookDiagnosticCode
  severity: BookDiagnosticSeverity
  message: string
  source?: BookSourceLocation
  relatedPath?: string
  count?: number
}

export interface BookNodeBase {
  id: string
  title: string
  order: number
  source: BookSourceLocation
}

export interface BookChapter extends BookNodeBase {
  type: 'chapter'
  path: string
  /** Decoded heading fragment without "#"; path + fragment is navigation identity. */
  fragment: string | null
  children: BookNavigationNode[]
}

export interface BookGroup extends BookNodeBase {
  type: 'group'
  children: BookNavigationNode[]
  landingPath: string | null
}

export interface BookExternalLink extends BookNodeBase {
  type: 'external'
  url: string
  children: BookNavigationNode[]
}

export type BookNavigationNode = BookChapter | BookGroup | BookExternalLink

export interface BookNavigation {
  source: 'summary' | 'inferred'
  summaryPath: string | null
  nodes: BookNavigationNode[]
  entryPath: string | null
  landingPath: string | null
  /** File identities only. Different anchors in one file appear once here. */
  chapterPaths: string[]
}

export interface BookMetadata {
  title: string
  titleSource: 'document-h1' | 'directory-name'
}

export interface Book {
  metadata: BookMetadata
  navigation: BookNavigation
}

export interface BookFile {
  path: string
  content: string
}

export interface BookBuildLimits {
  maxFiles?: number
  maxNodes?: number
  maxDepth?: number
  maxContentBytes?: number
  maxContentCharacters?: number
  maxDiagnostics?: number
}

export interface BookSummaryLimits {
  maxCharacters?: number
  maxLines?: number
  maxNodes?: number
  maxDepth?: number
  maxDiagnostics?: number
  maxListItems?: number
  maxLinkDestinationLength?: number
  maxFragmentLength?: number
}

export interface BookBuildInput {
  /** A single safe display segment, not a path. */
  rootName: string
  files: readonly BookFile[]
  summary?: BookFile | null
  diagnostics?: readonly BookDiagnostic[]
  limits?: BookBuildLimits
}

export interface BookBuildResult {
  book: Book
  diagnostics: BookDiagnostic[]
}

export interface BookScanOptions {
  exclude?: readonly string[]
  maxDepth?: number
  maxFiles?: number
  maxDirectories?: number
  maxEntries?: number
  maxEntriesPerDirectory?: number
  maxDiagnostics?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  maxSummaryBytes?: number
  maxExcludePatterns?: number
  maxExcludePatternLength?: number
  maxExcludeTotalCharacters?: number
}
