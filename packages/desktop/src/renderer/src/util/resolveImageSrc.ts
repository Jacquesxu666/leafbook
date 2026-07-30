import { isSafeLocalResource } from '@muyajs/core'

// Resolve an <img>'s src for export / static print (GH#678): a relative local
// path is resolved to an absolute `file://` URL against the current document
// directory; URLs, `data:` URIs, and already-absolute / `file://` srcs are left
// untouched. Ported from the legacy muyajs `getImageInfo(src)` so a saved
// styled-HTML / PDF document keeps rendering its images after it is moved out of
// the source folder.
const IMAGE_EXT_REG = /\.(?:jpeg|jpg|png|gif|svg|webp)(?=\?|$)/i

export function resolveLocalImageSrc(src: string): string {
  if (!src) return src
  if (!isSafeLocalResource(src)) return ''
  // Already a URL or data: URI — leave as-is (avoids `file://file://…`).
  if (/^(?:https?:|file:|data:)/i.test(src)) return src
  // Only rewrite recognised local image paths (mirrors muyajs's IMAGE_EXT_REG
  // gate) — leave anything else untouched, e.g. an extensionless absolute
  // server path `/api/image?id=…` must not become `file:///api/image…`.
  if (!IMAGE_EXT_REG.test(src)) return src
  // Absolute local image path (POSIX / UNC / Windows drive) → file://.
  if (/^[a-zA-Z]:[\\/]/.test(src)) return `file:///${src.replace(/\\/g, '/')}`
  if (/^\//.test(src)) return `file://${src}`
  // Relative local image path — resolve against the document directory.
  if (window.DIRNAME && isSafeLocalResource(window.DIRNAME)) {
    const resolved = window.path.resolve(window.DIRNAME, src)
    if (!isSafeLocalResource(resolved)) return ''
    return /^[a-zA-Z]:[\\/]/.test(resolved)
      ? `file:///${resolved.replace(/\\/g, '/')}`
      : `file://${resolved}`
  }
  return src
}

export const createInertImagePlaceholder = (): HTMLSpanElement => {
  const placeholder = document.createElement('span')
  placeholder.className = 'leafbook-image-placeholder'
  placeholder.setAttribute('role', 'img')
  placeholder.setAttribute('aria-label', 'Image unavailable')
  placeholder.textContent = '[Image unavailable]'
  return placeholder
}
