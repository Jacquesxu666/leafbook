/* eslint-disable @stylistic/space-before-function-paren */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { BookReaderResult, BookResourceDto } from '@shared/types/bookReader'
import { BookImageHydrator, isValidBookResourceResponse } from '@/book/hydrateBookImages'
import { renderBookMarkdown } from '@/book/renderMarkdown'
import { BOOK_SVG_MAX_CANONICAL_BYTES, BOOK_SVG_MAX_DIMENSION } from 'common/book/svgPolicy'

const responseValue = (
  mediaType: BookResourceDto['mediaType'],
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
  metadata: Partial<Pick<BookResourceDto, 'width' | 'height' | 'frameCount' | 'decodePixels'>> = {}
): BookResourceDto => ({
  mediaType,
  byteLength: bytes.byteLength,
  width: metadata.width ?? 1,
  height: metadata.height ?? 1,
  frameCount: metadata.frameCount ?? 1,
  decodePixels: metadata.decodePixels ?? 1,
  bytes
})

const response = (
  mediaType: BookResourceDto['mediaType'],
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
  metadata: Parameters<typeof responseValue>[2] = {}
): BookReaderResult<BookResourceDto> => ({
  ok: true,
  value: responseValue(mediaType, bytes, metadata)
})

const deferred = <T>() => {
  let resolveValue!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

let originalCreateObjectUrl: PropertyDescriptor | undefined
let originalRevokeObjectUrl: PropertyDescriptor | undefined
const createObjectUrl = vi.fn<(blob: Blob) => string>()
const revokeObjectUrl = vi.fn<(url: string) => void>()

beforeEach(() => {
  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  let index = 0
  createObjectUrl.mockReset()
  createObjectUrl.mockImplementation(() => `blob:leafbook-${++index}`)
  revokeObjectUrl.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl
  })
})

afterEach(() => {
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  } else {
    delete (URL as Partial<typeof URL>).createObjectURL
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  } else {
    delete (URL as Partial<typeof URL>).revokeObjectURL
  }
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('reader Markdown image provenance', () => {
  it('emits path-free slots only for supported Markdown image tokens', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const rendered = await renderBookMarkdown(`
![PNG](images/private-name.png "PNG title")
![JPEG](images/photo.jpeg)
![GIF](../media/animation.gif)
![WebP](media/picture.webp)
![Remote](https://example.invalid/tracker.png)
![Data](data:image/png;base64,AAAA)
![File](file:///tmp/private.png)
![SVG](private.svg)
<img src="raw.png" alt="Raw">
`)
    const document = new DOMParser().parseFromString(rendered.html, 'text/html')
    const images = [...document.querySelectorAll<HTMLImageElement>('img')]

    expect(rendered.resources.map(({ reference }) => reference)).toEqual([
      'images/private-name.png',
      'images/photo.jpeg',
      '../media/animation.gif',
      'media/picture.webp',
      'private.svg'
    ])
    expect(images).toHaveLength(5)
    expect(images.map((image) => image.dataset.leafbookResource)).toEqual([
      'image-0',
      'image-1',
      'image-2',
      'image-3',
      'image-4'
    ])
    expect(images.every((image) => !image.hasAttribute('src'))).toBe(true)
    expect(rendered.html).not.toMatch(
      /private-name|photo\.jpeg|animation\.gif|picture\.webp|https:|data:|file:|raw\.png|private\.svg/i
    )
    expect(document.querySelectorAll('.leafbook-media-placeholder')).toHaveLength(4)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('caps image occurrences independently from unique references', async () => {
    const rendered = await renderBookMarkdown(
      Array.from({ length: 1_000 }, (_, index) => `![Duplicate ${index}](shared.png)`).join('\n\n')
    )
    const document = new DOMParser().parseFromString(rendered.html, 'text/html')

    expect(rendered.resources).toHaveLength(1)
    expect(document.querySelectorAll('img[data-leafbook-resource]')).toHaveLength(256)
    expect(document.querySelectorAll('.leafbook-media-placeholder')).toHaveLength(744)

    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const readResource = vi.fn(async () => response('image/png'))
    await new BookImageHydrator().hydrate({
      container,
      sessionId: 'session-occurrence-cap',
      resourceToken: 'resource-occurrence-cap',
      nodeId: 'node-occurrence-cap',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })

    expect(readResource).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('img[src="blob:leafbook-1"]')).toHaveLength(256)
  })
})

describe('reader image hydration', () => {
  it('bounds reads to two, validates DTOs, and assigns only object URLs', async () => {
    const rendered = await renderBookMarkdown(
      ['![One](one.png)', '![Two](two.jpg)', '![Three](three.gif)', '![Four](four.webp)'].join(
        '\n\n'
      )
    )
    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const waits = rendered.resources.map(() => deferred<BookReaderResult<BookResourceDto>>())
    const readResource = vi.fn(
      async (request: { reference: string }) =>
        waits[rendered.resources.findIndex((item) => item.reference === request.reference)].promise
    )
    const hydrator = new BookImageHydrator()
    const hydration = hydrator.hydrate({
      container,
      sessionId: 'session-0001',
      resourceToken: 'resource-0001',
      nodeId: 'node-0001',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })
    await Promise.resolve()
    expect(readResource).toHaveBeenCalledTimes(2)
    expect(
      [...container.querySelectorAll('img')].every(
        (image) => !image.hasAttribute('data-leafbook-resource') && !image.hasAttribute('src')
      )
    ).toBe(true)

    waits[0].resolve(response('image/png'))
    await vi.waitFor(() => expect(readResource).toHaveBeenCalledTimes(3))
    waits[1].resolve(response('image/jpeg'))
    await vi.waitFor(() => expect(readResource).toHaveBeenCalledTimes(4))
    waits[2].resolve(response('image/gif'))
    waits[3].resolve(response('image/webp'))
    await hydration

    expect([...container.querySelectorAll('img')].map((image) => image.src)).toEqual([
      'blob:leafbook-1',
      'blob:leafbook-2',
      'blob:leafbook-3',
      'blob:leafbook-4'
    ])
    expect(readResource.mock.calls.map(([request]) => request)).toEqual(
      rendered.resources.map((resource) => ({
        sessionId: 'session-0001',
        resourceToken: 'resource-0001',
        nodeId: 'node-0001',
        reference: resource.reference
      }))
    )
  })

  it('fails malformed responses closed and revokes renderer decode errors', async () => {
    const rendered = await renderBookMarkdown('![Bad](bad.png)\n\n![Decode](decode.png)')
    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const readResource = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          mediaType: 'image/png',
          byteLength: 4,
          bytes: new Uint8Array([1])
        }
      })
      .mockResolvedValueOnce(response('image/png'))
    const hydrator = new BookImageHydrator()
    await hydrator.hydrate({
      container,
      sessionId: 'session-0002',
      resourceToken: 'resource-0002',
      nodeId: 'node-0002',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })

    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Image unavailable: Bad'
    )
    const image = container.querySelector<HTMLImageElement>('img')
    expect(image?.src).toBe('blob:leafbook-1')
    image?.dispatchEvent(new Event('error'))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:leafbook-1')
    expect(container.textContent).toContain('Image unavailable: Decode')
  })

  it('ignores unmounted and stale responses and revokes every owned URL', async () => {
    const first = await renderBookMarkdown('![First](first.png)')
    const second = await renderBookMarkdown('![Second](second.png)')
    const container = document.createElement('main')
    container.innerHTML = first.html
    document.body.append(container)
    const late = deferred<BookReaderResult<BookResourceDto>>()
    const hydrator = new BookImageHydrator()
    let current = true
    const staleHydration = hydrator.hydrate({
      container,
      sessionId: 'session-old',
      resourceToken: 'resource-old',
      nodeId: 'node-old',
      resources: first.resources,
      readResource: async () => late.promise,
      isCurrent: () => current
    })
    await Promise.resolve()
    current = false
    hydrator.cancel()
    container.innerHTML = second.html
    await hydrator.hydrate({
      container,
      sessionId: 'session-new',
      resourceToken: 'resource-new',
      nodeId: 'node-new',
      resources: second.resources,
      readResource: async () => response('image/png'),
      isCurrent: () => true
    })
    expect(container.querySelector('img')?.src).toBe('blob:leafbook-1')
    late.resolve(response('image/png'))
    await staleHydration
    expect(createObjectUrl).toHaveBeenCalledOnce()
    hydrator.cancel()
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:leafbook-1')
  })

  it('revokes object URLs when a fully mounted Vue owner unmounts', async () => {
    const rendered = await renderBookMarkdown('![Mounted](mounted.png)')
    const hydrator = new BookImageHydrator()
    const component = defineComponent({
      setup() {
        const element = ref<HTMLElement | null>(null)
        onMounted(async () => {
          if (!element.value) return
          await hydrator.hydrate({
            container: element.value,
            sessionId: 'session-mounted',
            resourceToken: 'resource-mounted',
            nodeId: 'node-mounted',
            resources: rendered.resources,
            readResource: async () => response('image/png'),
            isCurrent: () => true
          })
        })
        onBeforeUnmount(() => hydrator.cancel())
        return () =>
          h('article', {
            ref: element,
            innerHTML: rendered.html
          })
      }
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(component)
    app.mount(host)
    await nextTick()
    await vi.waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce())
    app.unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:leafbook-1')
  })

  it('deduplicates identical references into one IPC read, Blob URL, and revoke', async () => {
    const rendered = await renderBookMarkdown(
      '![First alt](shared.png)\n\n![Second alt](shared.png)'
    )
    expect(rendered.resources).toHaveLength(1)
    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const readResource = vi.fn(async () => response('image/png'))
    const hydrator = new BookImageHydrator()

    await hydrator.hydrate({
      container,
      sessionId: 'session-deduplicated',
      resourceToken: 'resource-deduplicated',
      nodeId: 'node-deduplicated',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })

    const images = [...container.querySelectorAll<HTMLImageElement>('img')]
    expect(readResource).toHaveBeenCalledOnce()
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(images.map(({ src }) => src)).toEqual(['blob:leafbook-1', 'blob:leafbook-1'])
    hydrator.cancel()
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
  })

  it('hydrates sanitized SVG bytes only through an image Blob URL without inline DOM', async () => {
    const rendered = await renderBookMarkdown('![Safe vector](safe.svg)')
    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const svgBytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" height="8" width="16"><rect height="8" width="16"></rect></svg>'
    )
    const readResource = vi.fn(async () =>
      response('image/svg+xml', svgBytes, {
        width: 16,
        height: 8,
        frameCount: 1,
        decodePixels: 128
      })
    )
    const hydrator = new BookImageHydrator()

    await hydrator.hydrate({
      container,
      sessionId: 'session-svg',
      resourceToken: 'resource-svg',
      nodeId: 'node-svg',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })

    expect(readResource).toHaveBeenCalledOnce()
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(createObjectUrl.mock.calls[0]?.[0].type).toBe('image/svg+xml')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:leafbook-1')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('enforces unique-image and aggregate decode budgets per generation', async () => {
    const markdown = Array.from(
      { length: 65 },
      (_, index) => `![Image ${index}](${index}.png)`
    ).join('\n\n')
    const rendered = await renderBookMarkdown(markdown)
    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const readResource = vi.fn(async () =>
      response('image/png', new Uint8Array([1]), {
        width: 6000,
        height: 5000,
        decodePixels: 30_000_000
      })
    )
    const hydrator = new BookImageHydrator()

    await hydrator.hydrate({
      container,
      sessionId: 'session-budget',
      resourceToken: 'resource-budget',
      nodeId: 'node-budget',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })

    expect(readResource.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(readResource.mock.calls.length).toBeLessThanOrEqual(6)
    expect(createObjectUrl).toHaveBeenCalledTimes(4)
    expect(container.querySelectorAll('img[src^="blob:"]')).toHaveLength(4)
    expect(container.querySelectorAll('.leafbook-media-placeholder')).toHaveLength(61)
  })

  it('enforces aggregate compressed-byte and frame budgets', async () => {
    const compressed = await renderBookMarkdown(
      Array.from({ length: 5 }, (_, index) => `![Compressed ${index}](${index}.png)`).join('\n\n')
    )
    const container = document.createElement('main')
    container.innerHTML = compressed.html
    document.body.append(container)
    const largeBytes = new Uint8Array(8 * 1024 * 1024)
    const hydrator = new BookImageHydrator()
    let compressedRead = 0
    await hydrator.hydrate({
      container,
      sessionId: 'session-compressed-budget',
      resourceToken: 'resource-compressed-budget',
      nodeId: 'node-compressed-budget',
      resources: compressed.resources,
      readResource: async () =>
        response('image/png', compressedRead++ < 4 ? largeBytes : new Uint8Array([1])),
      isCurrent: () => true
    })
    expect(container.querySelectorAll('img[src^="blob:"]')).toHaveLength(4)
    expect(container.querySelectorAll('.leafbook-media-placeholder')).toHaveLength(1)

    hydrator.cancel()
    const framed = await renderBookMarkdown(
      Array.from({ length: 3 }, (_, index) => `![Frames ${index}](frame-${index}.gif)`).join('\n\n')
    )
    container.innerHTML = framed.html
    await hydrator.hydrate({
      container,
      sessionId: 'session-frame-budget',
      resourceToken: 'resource-frame-budget',
      nodeId: 'node-frame-budget',
      resources: framed.resources,
      readResource: async () =>
        response('image/gif', new Uint8Array([1]), {
          frameCount: 200,
          decodePixels: 200
        }),
      isCurrent: () => true
    })
    expect(container.querySelectorAll('img[src^="blob:"]')).toHaveLength(2)
    expect(container.querySelectorAll('.leafbook-media-placeholder')).toHaveLength(1)
  })

  it('retries only resource-busy so two stale reads cannot starve the next chapter', async () => {
    const oldChapter = await renderBookMarkdown('![Old one](old-1.png)\n\n![Old two](old-2.png)')
    const newChapter = await renderBookMarkdown('![New one](new-1.png)\n\n![New two](new-2.png)')
    const container = document.createElement('main')
    container.innerHTML = oldChapter.html
    document.body.append(container)
    const oldReads = [
      deferred<BookReaderResult<BookResourceDto>>(),
      deferred<BookReaderResult<BookResourceDto>>()
    ]
    let activeReads = 0
    const attempts = new Map<string, number>()
    const readResource = vi.fn(
      async ({ reference }: { reference: string }): Promise<BookReaderResult<BookResourceDto>> => {
        attempts.set(reference, (attempts.get(reference) ?? 0) + 1)
        if (reference.startsWith('old-')) {
          const index = reference === 'old-1.png' ? 0 : 1
          activeReads += 1
          try {
            return await oldReads[index].promise
          } finally {
            activeReads -= 1
          }
        }
        if (activeReads >= 2) {
          return {
            ok: false,
            error: { code: 'resource-busy', message: 'busy' }
          } satisfies BookReaderResult<BookResourceDto>
        }
        return response('image/png')
      }
    )
    const hydrator = new BookImageHydrator()
    const stale = hydrator.hydrate({
      container,
      sessionId: 'session-old',
      resourceToken: 'resource-old',
      nodeId: 'node-old',
      resources: oldChapter.resources,
      readResource,
      isCurrent: () => true
    })
    await vi.waitFor(() => expect(activeReads).toBe(2))

    container.innerHTML = newChapter.html
    const current = hydrator.hydrate({
      container,
      sessionId: 'session-new',
      resourceToken: 'resource-new',
      nodeId: 'node-new',
      resources: newChapter.resources,
      readResource,
      isCurrent: () => true
    })
    await vi.waitFor(() => {
      expect(attempts.get('new-1.png')).toBe(1)
      expect(attempts.get('new-2.png')).toBe(1)
    })
    oldReads[0].resolve(response('image/png'))
    oldReads[1].resolve(response('image/png'))
    await stale
    await current

    expect(attempts.get('new-1.png')).toBeGreaterThan(1)
    expect(attempts.get('new-2.png')).toBeGreaterThan(1)
    expect([...container.querySelectorAll<HTMLImageElement>('img')].map(({ src }) => src)).toEqual([
      'blob:leafbook-1',
      'blob:leafbook-2'
    ])
  })

  it('does not retry non-busy resource failures', async () => {
    const rendered = await renderBookMarkdown('![Missing](missing.png)')
    const container = document.createElement('main')
    container.innerHTML = rendered.html
    document.body.append(container)
    const readResource = vi.fn(
      async (): Promise<BookReaderResult<BookResourceDto>> => ({
        ok: false,
        error: { code: 'resource-not-found', message: 'missing' }
      })
    )

    await new BookImageHydrator().hydrate({
      container,
      sessionId: 'session-no-retry',
      resourceToken: 'resource-no-retry',
      nodeId: 'node-no-retry',
      resources: rendered.resources,
      readResource,
      isCurrent: () => true
    })

    expect(readResource).toHaveBeenCalledOnce()
    expect(container.querySelector('.leafbook-media-placeholder')).not.toBeNull()
  })

  it('cancels pending busy-retry timers when hydration is superseded', async () => {
    vi.useFakeTimers()
    try {
      const rendered = await renderBookMarkdown('![One](one.png)\n\n![Two](two.png)')
      const container = document.createElement('main')
      container.innerHTML = rendered.html
      document.body.append(container)
      const readResource = vi.fn(
        async (): Promise<BookReaderResult<BookResourceDto>> => ({
          ok: false,
          error: { code: 'resource-busy', message: 'busy' }
        })
      )
      const hydrator = new BookImageHydrator()
      const hydration = hydrator.hydrate({
        container,
        sessionId: 'session-cancel-backoff',
        resourceToken: 'resource-cancel-backoff',
        nodeId: 'node-cancel-backoff',
        resources: rendered.resources,
        readResource,
        isCurrent: () => true
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(readResource).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(2)

      hydrator.cancel()
      await hydration

      expect(vi.getTimerCount()).toBe(0)
      expect(readResource).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects wrong media, byte lengths, views, and payload budgets', () => {
    expect(isValidBookResourceResponse(responseValue('image/png'), 'x.png')).toBe(true)
    expect(
      isValidBookResourceResponse(
        responseValue('image/svg+xml', new Uint8Array([1]), {
          width: 1,
          height: 1,
          frameCount: 1,
          decodePixels: 1
        }),
        'x.svg'
      )
    ).toBe(true)
    expect(isValidBookResourceResponse(responseValue('image/svg+xml'), 'x.png')).toBe(false)
    expect(isValidBookResourceResponse(responseValue('image/jpeg'), 'x.png')).toBe(false)
    expect(
      isValidBookResourceResponse({ mediaType: 'image/png', byteLength: 1, bytes: [1] }, 'x.png')
    ).toBe(false)
    expect(
      isValidBookResourceResponse(
        { mediaType: 'image/png', byteLength: 1, bytes: new DataView(new ArrayBuffer(1)) },
        'x.png'
      )
    ).toBe(false)
    expect(
      isValidBookResourceResponse(
        { mediaType: 'image/png', byteLength: 8 * 1024 * 1024 + 1, bytes: new Uint8Array(1) },
        'x.png'
      )
    ).toBe(false)
    expect(
      isValidBookResourceResponse(
        responseValue('image/png', new Uint8Array([1]), { decodePixels: 0 }),
        'x.png'
      )
    ).toBe(false)
    for (const impossible of [
      responseValue('image/svg+xml', new Uint8Array([1]), {
        width: 1,
        height: 1,
        frameCount: 2,
        decodePixels: 2
      }),
      responseValue('image/svg+xml', new Uint8Array([1]), {
        width: 2,
        height: 3,
        frameCount: 1,
        decodePixels: 5
      }),
      responseValue('image/svg+xml', new Uint8Array([1]), {
        width: BOOK_SVG_MAX_DIMENSION + 1,
        height: 1,
        frameCount: 1,
        decodePixels: BOOK_SVG_MAX_DIMENSION + 1
      }),
      responseValue('image/svg+xml', new Uint8Array([1]), {
        width: 10_000,
        height: 5_000,
        frameCount: 1,
        decodePixels: 50_000_000
      }),
      responseValue('image/svg+xml', new Uint8Array(BOOK_SVG_MAX_CANONICAL_BYTES + 1), {
        width: 1,
        height: 1,
        frameCount: 1,
        decodePixels: 1
      })
    ]) {
      expect(isValidBookResourceResponse(impossible, 'x.svg')).toBe(false)
    }
  })
})
