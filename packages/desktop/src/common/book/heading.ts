export const bookFragmentKey = (value: string): string =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

export type BookHeadingFragmentValidation =
  | { ok: true; fragments: string[] }
  | { ok: false; error: 'empty-fragment' | 'duplicate-fragment'; index: number }

export const validateBookHeadingFragments = (
  titles: readonly string[]
): BookHeadingFragmentValidation => {
  const fragments: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < titles.length; index++) {
    const fragment = bookFragmentKey(titles[index])
    if (!fragment) return { ok: false, error: 'empty-fragment', index }
    if (seen.has(fragment)) return { ok: false, error: 'duplicate-fragment', index }
    seen.add(fragment)
    fragments.push(fragment)
  }
  return { ok: true, fragments }
}
