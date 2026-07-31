/* eslint-disable @stylistic/space-before-function-paren */
import type {
  BookReaderResult,
  BookResourceDto,
  BookResourceRequestDto
} from '@shared/types/bookReader'
import {
  BOOK_IMAGE_GENERATION_MAX_BYTES,
  BOOK_IMAGE_GENERATION_MAX_DECODE_PIXELS,
  BOOK_IMAGE_GENERATION_MAX_FRAMES,
  BOOK_IMAGE_MAX_UNIQUE,
  BOOK_IMAGE_MEDIA_TYPES,
  isValidBookImageResourceMetrics
} from 'common/book/imagePolicy'
import type { ReaderImageResource } from './renderMarkdown'

const MAX_CONCURRENT_RESOURCE_READS = 2
const RESOURCE_BUSY_RETRY_DELAYS_MS = [20, 40, 80, 160, 320] as const
const RESOURCE_SELECTOR = 'img[data-leafbook-resource]'
const ALLOWED_MEDIA_TYPES = new Set<BookResourceDto['mediaType']>(BOOK_IMAGE_MEDIA_TYPES)

export interface BookImageHydrationContext {
  container: HTMLElement
  sessionId: string
  resourceToken: string
  nodeId: string
  resources: readonly ReaderImageResource[]
  readResource: (request: BookResourceRequestDto) => Promise<BookReaderResult<BookResourceDto>>
  isCurrent: () => boolean
}

interface PendingImageGroup {
  resource: ReaderImageResource
  images: HTMLImageElement[]
}

const isUint8Array = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) &&
  Object.prototype.toString.call(value) === '[object Uint8Array]' &&
  (value as Uint8Array).BYTES_PER_ELEMENT === 1

export const isValidBookResourceResponse = (
  value: unknown,
  reference: string
): value is BookResourceDto => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BookResourceDto>
  return (
    typeof candidate.mediaType === 'string' &&
    ALLOWED_MEDIA_TYPES.has(candidate.mediaType as BookResourceDto['mediaType']) &&
    isValidBookImageResourceMetrics(candidate as BookResourceDto, reference) &&
    isUint8Array(candidate.bytes) &&
    candidate.bytes.byteLength === candidate.byteLength
  )
}

const unavailableLabel = (alt: string): string =>
  alt ? `Image unavailable: ${alt}` : 'Image unavailable'

const replaceWithUnavailable = (image: HTMLImageElement, alt: string): void => {
  if (!image.isConnected) return
  const placeholder = document.createElement('span')
  placeholder.className = 'leafbook-media-placeholder'
  placeholder.setAttribute('role', 'img')
  placeholder.setAttribute('aria-label', unavailableLabel(alt))
  placeholder.textContent = `[${unavailableLabel(alt)}]`
  image.replaceWith(placeholder)
}

export class BookImageHydrator {
  private generation = 0
  private readonly objectUrls = new Set<string>()
  private readonly retryWaiters = new Set<() => void>()

  cancel(): void {
    this.generation += 1
    for (const cancelWait of [...this.retryWaiters]) cancelWait()
    for (const objectUrl of this.objectUrls) URL.revokeObjectURL(objectUrl)
    this.objectUrls.clear()
  }

  private waitForRetry(delay: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        globalThis.clearTimeout(timer)
        this.retryWaiters.delete(finish)
        resolve()
      }
      const timer = globalThis.setTimeout(finish, delay)
      this.retryWaiters.add(finish)
    })
  }

  async hydrate(context: BookImageHydrationContext): Promise<void> {
    this.cancel()
    const generation = this.generation
    const byKey = new Map(context.resources.map((resource) => [resource.key, resource]))
    const pendingByReference = new Map<string, PendingImageGroup>()

    for (const image of context.container.querySelectorAll<HTMLImageElement>(RESOURCE_SELECTOR)) {
      const key = image.getAttribute('data-leafbook-resource')
      image.removeAttribute('data-leafbook-resource')
      const resource = key ? byKey.get(key) : undefined
      if (!resource) {
        replaceWithUnavailable(image, image.alt)
        continue
      }
      const existing = pendingByReference.get(resource.reference)
      if (existing) {
        existing.images.push(image)
      } else if (pendingByReference.size < BOOK_IMAGE_MAX_UNIQUE) {
        pendingByReference.set(resource.reference, { resource, images: [image] })
      } else {
        replaceWithUnavailable(image, resource.alt)
      }
    }

    const pending = [...pendingByReference.values()]
    let cursor = 0
    let totalCompressedBytes = 0
    let totalDecodePixels = 0
    let totalFrames = 0
    let budgetFailed = false
    const current = (): boolean => generation === this.generation && context.isCurrent()
    const groupIsCurrent = (group: PendingImageGroup): boolean =>
      current() && group.images.some((image) => context.container.contains(image))
    const markUnavailable = (group: PendingImageGroup): void => {
      for (const image of group.images) {
        replaceWithUnavailable(image, image.alt || group.resource.alt)
      }
    }
    const failBudget = (): void => {
      if (budgetFailed) return
      budgetFailed = true
      while (cursor < pending.length) {
        const group = pending[cursor++]
        if (group) markUnavailable(group)
      }
    }
    const readWithBusyRetry = async (
      group: PendingImageGroup
    ): Promise<BookReaderResult<BookResourceDto> | null> => {
      for (let attempt = 0; ; attempt += 1) {
        if (!groupIsCurrent(group)) return null
        const result = await context.readResource({
          sessionId: context.sessionId,
          resourceToken: context.resourceToken,
          nodeId: context.nodeId,
          reference: group.resource.reference
        })
        if (result.ok || result.error.code !== 'resource-busy') return result
        const delay = RESOURCE_BUSY_RETRY_DELAYS_MS[attempt]
        if (delay === undefined) return result
        await this.waitForRetry(delay)
      }
    }
    const worker = async (): Promise<void> => {
      while (current()) {
        if (budgetFailed) return
        const group = pending[cursor++]
        if (!group) return
        const { resource, images } = group
        try {
          const result = await readWithBusyRetry(group)
          if (!result || !groupIsCurrent(group)) continue
          if (budgetFailed) {
            markUnavailable(group)
            return
          }
          if (!result.ok) {
            markUnavailable(group)
            if (result.error.code === 'resource-too-large') failBudget()
            continue
          }
          if (!isValidBookResourceResponse(result.value, resource.reference)) {
            markUnavailable(group)
            continue
          }
          const nextCompressedBytes = totalCompressedBytes + result.value.byteLength
          const nextDecodePixels = totalDecodePixels + result.value.decodePixels
          const nextFrames = totalFrames + result.value.frameCount
          if (
            nextCompressedBytes > BOOK_IMAGE_GENERATION_MAX_BYTES ||
            nextDecodePixels > BOOK_IMAGE_GENERATION_MAX_DECODE_PIXELS ||
            nextFrames > BOOK_IMAGE_GENERATION_MAX_FRAMES
          ) {
            markUnavailable(group)
            failBudget()
            continue
          }
          totalCompressedBytes = nextCompressedBytes
          totalDecodePixels = nextDecodePixels
          totalFrames = nextFrames
          const payload = new ArrayBuffer(result.value.byteLength)
          new Uint8Array(payload).set(result.value.bytes)
          const objectUrl = URL.createObjectURL(
            new Blob([payload], { type: result.value.mediaType })
          )
          if (!groupIsCurrent(group)) {
            URL.revokeObjectURL(objectUrl)
            continue
          }
          this.objectUrls.add(objectUrl)
          const handleDecodeError = (): void => {
            if (!this.objectUrls.delete(objectUrl)) return
            URL.revokeObjectURL(objectUrl)
            markUnavailable(group)
          }
          for (const image of images) {
            if (!context.container.contains(image)) continue
            image.decoding = 'async'
            image.loading = 'lazy'
            image.addEventListener('error', handleDecodeError, { once: true })
            image.src = objectUrl
          }
        } catch {
          if (current()) markUnavailable(group)
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_RESOURCE_READS, pending.length) }, () =>
        worker()
      )
    )
  }
}
