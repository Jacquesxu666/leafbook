/* eslint-disable @stylistic/space-before-function-paren */
import type {
  BookExportLinkTargetDto,
  BookExportSnapshotDto,
  BookReaderNodeDto
} from '@shared/types/bookReader'
import { renderBookMarkdown } from './renderMarkdown'
import { BOOK_EXPORT_CSP, BOOK_EXPORT_STYLE } from 'common/book/exportPolicy'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character] as string
  })

const fragmentKey = (value: string): string =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

interface GeneratedDocument {
  documentId: string
  html: string
  headingByFragment: Map<string, string>
  available: boolean
}

const chapterAnchor = (documentId: string): string => `leafbook-chapter-${documentId}`

const renderNavigation = (
  nodes: readonly BookReaderNodeDto[],
  snapshot: BookExportSnapshotDto,
  generated: Map<string, GeneratedDocument>,
  includeBookHome = true
): string => {
  const renderTarget = (
    title: string,
    target: BookExportLinkTargetDto | undefined,
    unavailableSuffix = ''
  ): string => {
    if (target) {
      const document = generated.get(target.documentId)
      const headingId =
        target.fragment && document
          ? document.headingByFragment.get(fragmentKey(target.fragment))
          : undefined
      if (document?.available && (!target.fragment || headingId)) {
        const href = headingId ?? chapterAnchor(target.documentId)
        return `<a href="#${href}">${escapeHtml(title)}</a>`
      }
      return `<span class="unavailable leafbook-broken-link">${escapeHtml(
        `${title} (${target.fragment ? 'section unavailable' : 'chapter unavailable'})`
      )}</span>`
    }
    return `<span class="unavailable">${escapeHtml(title + unavailableSuffix)}</span>`
  }
  const items = nodes
    .map((node) => {
      const target =
        snapshot.navigationTargets[node.nodeId] ??
        (node.landingNodeId ? snapshot.navigationTargets[node.landingNodeId] : undefined)
      const label = renderTarget(
        node.title,
        target,
        node.type === 'external' ? ' (external link)' : ''
      )
      const children = node.children.length
        ? renderNavigation(node.children, snapshot, generated, false)
        : ''
      return `<li>${label}${children}</li>`
    })
    .join('')
  const homeTarget = snapshot.landingNodeId
    ? snapshot.navigationTargets[snapshot.landingNodeId]
    : undefined
  const home =
    includeBookHome && snapshot.landingNodeId
      ? `<li>${renderTarget('Book home', homeTarget)}</li>`
      : ''
  return `<ul>${home}${items}</ul>`
}

export const generateBookExportHtml = async (snapshot: BookExportSnapshotDto): Promise<string> => {
  const generated = new Map<string, GeneratedDocument>()
  for (const source of snapshot.documents) {
    if (source.markdown === null) {
      generated.set(source.documentId, {
        documentId: source.documentId,
        html: '<p class="leafbook-placeholder">This chapter was unavailable during export.</p>',
        headingByFragment: new Map(),
        available: false
      })
      continue
    }
    const rendered = await renderBookMarkdown(source.markdown)
    const document = new DOMParser().parseFromString(rendered.html, 'text/html')
    const headingByFragment = new Map<string, string>()
    document.querySelectorAll<HTMLHeadingElement>('h1,h2,h3,h4,h5,h6').forEach((heading, index) => {
      const originalId = heading.id
      const text = heading.textContent?.trim() ?? ''
      const id = `leafbook-heading-${source.documentId}-${index + 1}`
      heading.id = id
      for (const candidate of [originalId, text]) {
        const key = fragmentKey(candidate)
        if (key && !headingByFragment.has(key)) headingByFragment.set(key, id)
      }
    })
    generated.set(source.documentId, {
      documentId: source.documentId,
      html: document.body.innerHTML,
      headingByFragment,
      available: true
    })
  }

  for (const source of snapshot.documents) {
    const current = generated.get(source.documentId)
    if (!current || source.markdown === null) continue
    const document = new DOMParser().parseFromString(current.html, 'text/html')
    document.querySelectorAll<HTMLAnchorElement>('a[data-book-href]').forEach((anchor) => {
      const raw = anchor.dataset.bookHref ?? ''
      let target: BookExportLinkTargetDto | undefined = source.linkTargets[raw]
      if (!target) {
        try {
          target = source.linkTargets[decodeURI(raw)]
        } catch {
          target = undefined
        }
      }
      const targetDocument = target ? generated.get(target.documentId) : undefined
      const headingId =
        target?.fragment && targetDocument
          ? targetDocument.headingByFragment.get(fragmentKey(target.fragment))
          : undefined
      if (target && targetDocument?.available && (!target.fragment || headingId)) {
        anchor.setAttribute('href', `#${headingId ?? chapterAnchor(targetDocument.documentId)}`)
        anchor.removeAttribute('data-book-href')
        anchor.removeAttribute('role')
        anchor.removeAttribute('tabindex')
      } else {
        const replacement = document.createElement('span')
        replacement.className =
          raw.startsWith('http:') || raw.startsWith('https:')
            ? 'leafbook-external-link'
            : 'leafbook-broken-link'
        replacement.append(...Array.from(anchor.childNodes))
        anchor.replaceWith(replacement)
      }
    })
    current.html = document.body.innerHTML
  }

  const chapters = snapshot.documents
    .filter((source) => source.markdown !== null)
    .map((source) => {
      const document = generated.get(source.documentId)
      return `<section class="leafbook-chapter" id="${chapterAnchor(source.documentId)}"><header><h1>${escapeHtml(source.title)}</h1></header>${document?.html ?? '<p class="leafbook-placeholder">This chapter was unavailable during export.</p>'}</section>`
    })
    .join('')
  const navigation = renderNavigation(snapshot.nodes, snapshot, generated)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BOOK_EXPORT_CSP}"><title>${escapeHtml(snapshot.title)}</title><style>${BOOK_EXPORT_STYLE}</style></head><body><div class="leafbook-shell"><nav class="leafbook-toc" aria-label="Table of contents"><h2>Contents</h2>${navigation}</nav><main class="leafbook-book"><header><p>LeafBook offline export</p><h1>${escapeHtml(snapshot.title)}</h1></header>${chapters}</main></div></body></html>`
}
