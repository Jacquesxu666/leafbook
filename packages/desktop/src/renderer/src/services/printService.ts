import { createInertImagePlaceholder, resolveLocalImageSrc } from '../util/resolveImageSrc'

class MarkdownPrint {
  private container: HTMLElement | null = null

  /**
   * Prepare document export and append a hidden print container to the window.
   * Everything outside of this hidden print container will be hidden with display: none.
   *
   * @param html HTML string
   * @param renderStatic Render for static files like PDF documents
   * @param dir Text direction to mirror onto the container. `innerHTML` drops
   *   the exporter's outer `<html dir=…>` shell and the container is a sibling
   *   of `.editor-wrapper`, so RTL documents print LTR unless we set it here
   *   (#4833). LTR is the default and stays implicit.
   */
  renderMarkdown(html: string, renderStatic?: boolean, dir?: string): void {
    this.clearup()
    const printContainer = document.createElement('article')
    printContainer.classList.add('print-container')
    if (dir === 'rtl' || dir === 'auto') {
      printContainer.setAttribute('dir', dir)
    }
    this.container = printContainer

    // Fix images when rendering for static files like PDF (GH#678).
    if (renderStatic) {
      // Parse inside an inert template so unsafe image sources are never
      // connected to a document and cannot trigger SMB/network access before
      // validation replaces them.
      const template = document.createElement('template')
      template.innerHTML = html
      const images = template.content.querySelectorAll('img')
      for (const image of Array.from(images)) {
        const rawSrc = image.getAttribute('src') ?? ''
        const resolved = resolveLocalImageSrc(rawSrc)
        if (rawSrc && !resolved) {
          image.replaceWith(createInertImagePlaceholder())
        } else {
          image.src = resolved
        }
      }
      printContainer.append(template.content)
    } else {
      printContainer.innerHTML = html
    }

    document.body.appendChild(printContainer)
  }

  /**
   * Remove the print container from the window.
   */
  clearup(): void {
    if (this.container) {
      this.container.remove()
    }
  }
}

export default MarkdownPrint
