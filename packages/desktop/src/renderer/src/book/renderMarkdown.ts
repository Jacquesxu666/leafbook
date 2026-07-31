/* eslint-disable @stylistic/space-before-function-paren */
import { renderToStaticHTML } from '@muyajs/core'
import { sanitize } from '@/util/dompurify'
import type { Config } from 'dompurify'
import type { Tokens } from 'marked'
import { bookFragmentKey } from 'common/book/heading'
import {
  BOOK_IMAGE_MAX_OCCURRENCES,
  BOOK_IMAGE_MAX_UNIQUE,
  isSupportedBookImageReference
} from 'common/book/imagePolicy'

export interface ReaderOutlineItem {
  id: string
  level: number
  text: string
  fragment: string
}

export interface RenderedBookChapter {
  html: string
  outline: ReaderOutlineItem[]
  resources: ReaderImageResource[]
}

export interface ReaderImageResource {
  key: string
  reference: string
  alt: string
  title: string | null
}

const READER_IMAGE_MARKER_TAG = 'leafbook-reader-image'
const READER_IMAGE_MARKER_ATTRIBUTE = 'data-leafbook-marker'

export const isRenderableBookImageReference = isSupportedBookImageReference

const renderNonce = (): string => {
  const bytes = new Uint32Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((value) => value.toString(36)).join('')
}

const READER_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ADD_TAGS: [READER_IMAGE_MARKER_TAG],
  ADD_ATTR: [READER_IMAGE_MARKER_ATTRIBUTE],
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

export interface RenderBookMarkdownOptions {
  localImages?: boolean
}

export const renderBookMarkdown = async (
  markdown: string,
  options: RenderBookMarkdownOptions = {}
): Promise<RenderedBookChapter> => {
  // The static Muya renderer deliberately leaves every diagram language as an
  // inert code block. Unlike MarkdownToHtml it cannot invoke Mermaid, Vega or
  // PlantUML and therefore cannot perform renderer-driven network/DOM work.
  const nonce = renderNonce()
  const imageTokens: Array<{
    marker: string
    reference: string
    alt: string
    title: string | null
    supported: boolean
  }> = []
  const acceptedImageReferences = new Set<string>()
  let acceptedImageOccurrences = 0
  const rendered = renderToStaticHTML(markdown, {
    // Reader performs its own stricter sanitization below. Disabling the
    // generic first pass preserves the unforgeable per-render marker long
    // enough to distinguish Markdown image tokens from raw HTML `<img>`.
    sanitize: false,
    imageRenderer: ({ href, text, title }: Tokens.Image) => {
      const index = imageTokens.length
      const marker = `${nonce}-${index}`
      const renderable = options.localImages !== false && isRenderableBookImageReference(href)
      const supported =
        renderable &&
        acceptedImageOccurrences < BOOK_IMAGE_MAX_OCCURRENCES &&
        (acceptedImageReferences.has(href) || acceptedImageReferences.size < BOOK_IMAGE_MAX_UNIQUE)
      if (supported) {
        acceptedImageOccurrences += 1
        acceptedImageReferences.add(href)
      }
      imageTokens.push({
        marker,
        reference: href,
        alt: text,
        title: title ?? null,
        supported
      })
      return `<${READER_IMAGE_MARKER_TAG} ${READER_IMAGE_MARKER_ATTRIBUTE}="${marker}"></${READER_IMAGE_MARKER_TAG}>`
    }
  })
  const clean = sanitize(rendered, READER_SANITIZE_CONFIG)
  const document = new DOMParser().parseFromString(clean, 'text/html')
  const resources: ReaderImageResource[] = []
  const resourceByReference = new Map<string, ReaderImageResource>()
  const imageTokenByMarker = new Map(imageTokens.map((token) => [token.marker, token]))
  document.querySelectorAll(READER_IMAGE_MARKER_TAG).forEach((markerElement) => {
    const marker = markerElement.getAttribute(READER_IMAGE_MARKER_ATTRIBUTE)
    const token = marker ? imageTokenByMarker.get(marker) : undefined
    if (!token) {
      markerElement.replaceWith(document.createTextNode(''))
      return
    }
    if (!token.supported) {
      const image = document.createElement('img')
      image.alt = token.alt
      if (token.title) image.title = token.title
      markerElement.replaceWith(image)
      return
    }
    let resource = resourceByReference.get(token.reference)
    if (!resource) {
      resource = {
        key: `image-${resources.length}`,
        reference: token.reference,
        alt: token.alt,
        title: token.title
      }
      resourceByReference.set(token.reference, resource)
      resources.push(resource)
    }
    const image = document.createElement('img')
    image.className = 'leafbook-local-image'
    image.alt = token.alt
    if (token.title) image.title = token.title
    image.decoding = 'async'
    image.loading = 'lazy'
    image.setAttribute('data-leafbook-resource', resource.key)
    markerElement.replaceWith(image)
  })
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
  document
    .querySelectorAll<HTMLImageElement>('img:not([data-leafbook-resource])')
    .forEach((image) => {
      const placeholder = document.createElement('span')
      placeholder.className = 'leafbook-media-placeholder'
      if (options.localImages !== false) {
        placeholder.setAttribute('role', 'img')
        placeholder.setAttribute(
          'aria-label',
          image.alt ? `Image unavailable: ${image.alt}` : 'Image unavailable'
        )
      }
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
  return { html: document.body.innerHTML, outline, resources }
}
