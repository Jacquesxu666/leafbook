import type { BookDiagnostic } from '../../common/book/model'

export type BookReaderErrorCode =
  | 'invalid-request'
  | 'cancelled'
  | 'library-not-found'
  | 'book-unavailable'
  | 'session-not-found'
  | 'node-not-found'
  | 'node-not-readable'
  | 'chapter-read-failed'
  | 'unsafe-link'
  | 'link-not-found'
  | 'search-cancelled'
  | 'search-busy'
  | 'search-unavailable'
  | 'edit-not-found'
  | 'edit-read-only'
  | 'edit-conflict'
  | 'edit-encoding'
  | 'edit-too-large'
  | 'edit-mixed-line-endings'
  | 'edit-commit-uncertain'
  | 'edit-write-failed'
  | 'arrangement-not-found'
  | 'arrangement-read-only'
  | 'arrangement-conflict'
  | 'arrangement-encoding'
  | 'arrangement-too-large'
  | 'arrangement-commit-uncertain'
  | 'arrangement-write-failed'
  | 'preparation-not-found'
  | 'preparation-not-available'
  | 'preparation-source-required'
  | 'preparation-source-changed'
  | 'preparation-too-large'
  | 'preparation-invalid-headings'
  | 'preparation-conflict'
  | 'preparation-commit-uncertain'
  | 'preparation-write-failed'
  | 'export-busy'
  | 'export-too-large'
  | 'export-source-changed'
  | 'export-invalid-output'
  | 'export-write-failed'
  | 'website-busy'
  | 'website-too-large'
  | 'website-source-changed'
  | 'website-invalid-output'
  | 'website-unsafe-target'
  | 'website-commit-uncertain'
  | 'website-write-failed'

export interface BookReaderError {
  code: BookReaderErrorCode
  message: string
  overwriteToken?: string
  committed?: boolean
}

export type BookReaderResult<T> = { ok: true; value: T } | { ok: false; error: BookReaderError }

export interface BookshelfEntryDto {
  libraryId: string
  title: string
  lastOpenedAt: string
  available: boolean
  readingProgress: number
  lastChapterTitle?: string
  readingUpdatedAt?: string
  error?: BookReaderError
}

export interface BookReadingProgressDto {
  chapterProgress: number
  overallProgress: number
  updatedAt: string
}

export interface BookReaderNodeDto {
  nodeId: string
  type: 'chapter' | 'group' | 'external'
  title: string
  children: BookReaderNodeDto[]
  landingNodeId?: string
}

export interface BookSessionDto {
  libraryId: string
  sessionId: string
  title: string
  navigationSource: 'summary' | 'inferred'
  nodes: BookReaderNodeDto[]
  entryNodeId: string | null
  landingNodeId: string | null
  resumeNodeId: string | null
  readingProgress: number
  diagnostics: BookDiagnostic[]
}

export interface BookChapterDto {
  nodeId: string
  title: string
  markdown: string
  fragment: string | null
  readingPosition: number
  hasReadingPosition: boolean
}

export interface BookEditFormatDto {
  bom: boolean
  lineEnding: 'lf' | 'crlf'
  mixedLineEndings: boolean
}

export interface BookEditDto {
  editId: string
  sessionId: string
  nodeId: string
  title: string
  markdown: string
  revision: string
  format: BookEditFormatDto
}

export interface BookEditSaveRequestDto {
  editId: string
  revision: string
  markdown: string
  confirmMixedLineEndings?: boolean
  overwriteToken?: string
}

export interface BookEditSaveDto {
  editId: string
  revision: string
  markdown: string
  format: BookEditFormatDto
  session: BookSessionDto | null
  nodeId: string | null
  readOnly: boolean
  durabilityUncertain: boolean
}

export interface BookArrangementNodeDto {
  nodeId: string
  kind: 'heading' | 'list'
  title: string
  depth: number
  children: BookArrangementNodeDto[]
  canIndent: boolean
  canOutdent: boolean
}

export type BookArrangementOperationDto =
  | { type: 'move-before'; nodeId: string; targetNodeId: string }
  | { type: 'move-after'; nodeId: string; targetNodeId: string }
  | { type: 'indent'; nodeId: string }
  | { type: 'outdent'; nodeId: string }

export interface BookArrangementDto {
  arrangementId: string
  sessionId: string
  revision: string
  candidateRevision: string
  nodes: BookArrangementNodeDto[]
  dirty: boolean
  canUndo: boolean
  preview: {
    operationCount: number
    byteLength: number
  }
}

export interface BookArrangementApplyRequestDto {
  arrangementId: string
  operation: BookArrangementOperationDto
}

export interface BookArrangementSaveRequestDto {
  arrangementId: string
  revision: string
  overwriteToken?: string
}

export interface BookArrangementSaveDto {
  arrangementId: string
  revision: string
  session: BookSessionDto | null
  durabilityUncertain: boolean
}

export interface BookPreparationCandidateDto {
  nodeId: string
  title: string
  displayLabel: string
}

export interface BookPreparationChapterDto {
  ordinal: number
  line: number
  title: string
  fragment: string
}

export interface BookPreparationDto {
  preparationId: string
  sessionId: string
  revision: string | null
  sourceNodeId: string | null
  sourceTitle: string | null
  candidates: BookPreparationCandidateDto[]
  chapters: BookPreparationChapterDto[]
  summaryPreview: string | null
  requiresSelection: boolean
}

export interface BookPreparationCommitRequestDto {
  preparationId: string
  revision: string
}

export interface BookPreparationSaveDto {
  preparationId: string
  sourceNodeId: string | null
  session: BookSessionDto | null
  committed: boolean
  durabilityUncertain: boolean
}

export interface BookExportLinkTargetDto {
  documentId: string
  fragment: string | null
}

export interface BookExportDocumentDto {
  documentId: string
  nodeIds: string[]
  title: string
  markdown: string | null
  linkTargets: Record<string, BookExportLinkTargetDto>
}

export interface BookExportSnapshotDto {
  exportId: string
  title: string
  nodes: BookReaderNodeDto[]
  landingNodeId: string | null
  navigationTargets: Record<string, { documentId: string; fragment: string | null }>
  documents: BookExportDocumentDto[]
}

export interface BookExportCommitRequestDto {
  exportId: string
  html: string
}

export interface BookExportSaveDto {
  fileName: string
  byteLength: number
  durabilityUncertain: boolean
}

export interface BookWebsiteSnapshotDto extends Omit<BookExportSnapshotDto, 'exportId'> {
  websiteId: string
}

export interface BookWebsiteCommitRequestDto {
  websiteId: string
  html: string
}

export interface BookWebsiteSaveDto {
  directoryName: string
  files: ['index.html', 'leafbook-manifest.json']
  byteLength: number
  durabilityUncertain: boolean
}

export interface BookWebsiteManifestFileDto {
  path: 'index.html'
  size: number
  sha256: string
}

export interface BookWebsiteManifestDto {
  schemaVersion: 1
  generator: 'LeafBook'
  files: [BookWebsiteManifestFileDto]
}

export interface BookLinkNavigationDto {
  nodeId: string
  fragment: string | null
}

export type BookSearchMatchKind = 'title' | 'filename' | 'tag' | 'heading' | 'body' | 'code'

export interface BookSearchHighlightDto {
  start: number
  end: number
}

export interface BookSearchMatchDto {
  kind: BookSearchMatchKind
  snippet: string
  highlights: BookSearchHighlightDto[]
  fragment: string | null
}

export interface BookSearchResultDto {
  nodeId: string
  title: string
  breadcrumbs: string[]
  matches: BookSearchMatchDto[]
}

export interface BookSearchRequestDto {
  searchId: string
  query: string
  limit?: number
}

export interface BookSearchIndexStatusDto {
  eligibleDocuments: number
  indexedDocuments: number
  omittedDocuments: number
  partial: boolean
}

export interface BookSearchResponseDto {
  searchId: string
  query: string
  results: BookSearchResultDto[]
  totalResults: number
  truncated: boolean
  index: BookSearchIndexStatusDto
}

export interface BookSearchProgressDto {
  searchId: string
  phase: 'indexing' | 'matching'
  completed: number
  total: number
}
