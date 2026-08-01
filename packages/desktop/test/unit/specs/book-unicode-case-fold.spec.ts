import { describe, expect, it } from 'vitest'
import {
  UNICODE_CASE_FOLD_VERSION,
  unicodeDefaultCaseFold
} from '../../../src/common/book/unicodeCaseFold'

describe('Unicode Default Case Folding', () => {
  it('uses the pinned full non-Turkic Unicode mapping', () => {
    expect(UNICODE_CASE_FOLD_VERSION).toBe('16.0.0')
    expect(unicodeDefaultCaseFold('SUMMARY.md')).toBe('summary.md')
    expect(unicodeDefaultCaseFold('ſummary.md')).toBe('summary.md')
    expect(unicodeDefaultCaseFold('Straße')).toBe('strasse')
    expect(unicodeDefaultCaseFold('STRASSE')).toBe('strasse')
    expect(unicodeDefaultCaseFold('ΟΣ')).toBe(unicodeDefaultCaseFold('ος'))
    expect(unicodeDefaultCaseFold('οσ')).toBe(unicodeDefaultCaseFold('ος'))
    expect(unicodeDefaultCaseFold('Kelvin')).toBe('kelvin')
    expect(unicodeDefaultCaseFold('İ')).toBe('i\u0307')
  })

  it('normalizes canonically equivalent input before folding and rejects ill-formed UTF-16', () => {
    expect(unicodeDefaultCaseFold('CAFÉ')).toBe(unicodeDefaultCaseFold('cafe\u0301'))
    expect(unicodeDefaultCaseFold('\ud800')).toBeNull()
    expect(unicodeDefaultCaseFold('ASCII-123')).toBe('ascii-123')
  })
})
