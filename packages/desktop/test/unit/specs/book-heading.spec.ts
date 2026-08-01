import { describe, expect, it } from 'vitest'
import { bookFragmentKey, validateBookHeadingFragments } from 'common/book/heading'

describe('LeafBook heading fragments', () => {
  it('normalizes Unicode reader fragments with the shared semantics', () => {
    expect(bookFragmentKey('  Héllo，世界!  ')).toBe('héllo-世界')
    expect(bookFragmentKey('Ａ  B')).toBe('a-b')
  })

  it('rejects empty and duplicate normalized fragments', () => {
    expect(validateBookHeadingFragments(['!!!'])).toEqual({
      ok: false,
      error: 'empty-fragment',
      index: 0
    })
    expect(validateBookHeadingFragments(['Chapter One', 'chapter—one'])).toEqual({
      ok: false,
      error: 'duplicate-fragment',
      index: 1
    })
  })

  it('returns canonical fragments when every title is addressable', () => {
    expect(validateBookHeadingFragments(['第一章', 'Second chapter'])).toEqual({
      ok: true,
      fragments: ['第一章', 'second-chapter']
    })
  })
})
