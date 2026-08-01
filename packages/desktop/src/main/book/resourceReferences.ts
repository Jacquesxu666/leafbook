import { Marked, type Tokens } from 'marked'
import { leafBookTokenizerContract } from 'leafbook-markdown-tokenizer-contract'
import {
  BOOK_IMAGE_MAX_OCCURRENCES,
  BOOK_IMAGE_MAX_UNIQUE,
  isSupportedBookImageReference
} from 'common/book/imagePolicy'

export const extractBookImageOccurrencePlan = (markdown: string): readonly string[] => {
  const occurrences: string[] = []
  const unique = new Set<string>()
  try {
    const marked = new Marked()
    marked.use(leafBookTokenizerContract({ math: true, superSubScript: true }))
    marked.use({
      renderer: {
        image(token: Tokens.Image): string {
          if (
            occurrences.length < BOOK_IMAGE_MAX_OCCURRENCES &&
            isSupportedBookImageReference(token.href) &&
            (unique.has(token.href) || unique.size < BOOK_IMAGE_MAX_UNIQUE)
          ) {
            unique.add(token.href)
            occurrences.push(token.href)
          }
          return ''
        }
      }
    })
    marked.parse(markdown, { async: false, gfm: true })
  } catch {
    return []
  }
  return occurrences
}

/**
 * Extract exactly the image destinations observed by Muya's Reader parser.
 * The shared pure tokenizer contract prevents math/sub/sup recognition from
 * drifting, while the image renderer callback excludes raw HTML by design.
 */
export const extractBookImageReferences = (markdown: string): ReadonlySet<string> => {
  return new Set(extractBookImageOccurrencePlan(markdown))
}
