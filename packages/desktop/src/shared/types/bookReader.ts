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

export interface BookReaderError {
  code: BookReaderErrorCode
  message: string
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
