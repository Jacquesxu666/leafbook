/* eslint-disable @stylistic/space-before-function-paren */
import { renderToStaticHTML } from '@muyajs/core'
import { sanitize } from '@/util/dompurify'
import type { Config } from 'dompurify'
import { bookFragmentKey } from 'common/book/heading'

export interface ReaderOutlineItem {
  id: string
  level: number
  text: string
  fragment: string
}

export interface RenderedBookChapter {
  html: string
  outline: ReaderOutlineItem[]
}

const READER_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    'svg',
    'math',
    'style',
    'link',
    'meta',
    'base',
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'video',
    'audio',
    'source',
    'track'
  ],
  FORBID_ATTR: [
    'src',
    'srcset',
    'poster',
    'background',
    'xlink:href',
    'style',
    'action',
    'formaction',
    'contenteditable',
    'srcdoc'
  ],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false
}

export const renderBookMarkdown = async (markdown: string): Promise<RenderedBookChapter> => {
  // The static Muya renderer deliberately leaves every diagram language as an
  // inert code block. Unlike MarkdownToHtml it cannot invoke Mermaid, Vega or
  // PlantUML and therefore cannot perform renderer-driven network/DOM work.
  const rendered = renderToStaticHTML(markdown)
  const clean = sanitize(rendered, READER_SANITIZE_CONFIG)
  const document = new DOMParser().parseFromString(clean, 'text/html')
  const semanticHeadingTitles = new Map<HTMLHeadingElement, string>()
  document.querySelectorAll<HTMLHeadingElement>('h1').forEach((heading) => {
    const semantic = heading.cloneNode(true) as HTMLHeadingElement
    semantic.querySelectorAll('img').forEach((image) => {
      image.replaceWith(document.createTextNode(image.alt))
    })
    semanticHeadingTitles.set(heading, semantic.textContent?.trim() ?? '')
  })

  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of [
      'src',
      'srcset',
      'poster',
      'background',
      'xlink:href',
      'style',
      'action',
      'formaction'
    ]) {
      element.removeAttribute(attribute)
    }
    if (element.tagName.toLocaleLowerCase() !== 'a') element.removeAttribute('href')
  })
  document.querySelectorAll('img').forEach((image) => {
    const placeholder = document.createElement('span')
    placeholder.className = 'leafbook-media-placeholder'
    placeholder.textContent = `[Local image unavailable in this reader version${
      image.alt ? `: ${image.alt}` : ''
    }]`
    image.replaceWith(placeholder)
  })
  document.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href')
    if (href) anchor.setAttribute('data-book-href', href)
    anchor.removeAttribute('href')
    if (href) {
      anchor.setAttribute('role', 'link')
      anchor.setAttribute('tabindex', '0')
    }
  })

  const outline: ReaderOutlineItem[] = []
  const usedHeadingIds = new Set<string>()
  const headingIdOccurrences = new Map<string, number>()
  document.querySelectorAll<HTMLHeadingElement>('h1,h2,h3,h4,h5,h6').forEach((heading, index) => {
    const semanticText =
      heading.tagName.toLocaleLowerCase() === 'h1' ? semanticHeadingTitles.get(heading) : undefined
    const text = semanticText || heading.textContent?.trim() || `Section ${index + 1}`
    const semanticFragment = semanticText ? bookFragmentKey(semanticText) : ''
    const baseId = semanticFragment || heading.id || `leafbook-heading-${index + 1}`
    let occurrence = (headingIdOccurrences.get(baseId) ?? 0) + 1
    let id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`
    while (usedHeadingIds.has(id)) {
      occurrence++
      id = `${baseId}-${occurrence}`
    }
    headingIdOccurrences.set(baseId, occurrence)
    usedHeadingIds.add(id)
    heading.id = id
    outline.push({
      id,
      level: Number(heading.tagName.slice(1)),
      text,
      fragment: bookFragmentKey(text)
    })
  })
  return { html: document.body.innerHTML, outline }
}
