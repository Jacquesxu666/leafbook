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
  error?: BookReaderError
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
  diagnostics: BookDiagnostic[]
}

export interface BookChapterDto {
  nodeId: string
  title: string
  markdown: string
  fragment: string | null
}

export interface BookLinkNavigationDto {
  nodeId: string
  fragment: string | null
}
