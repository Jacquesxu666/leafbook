export interface ReadingPositionRestorationOptions<T> {
  render: () => Promise<T>
  isCurrent: () => boolean
  mount: (result: T) => void
  waitForMount: () => Promise<void>
  waitForPaint: () => Promise<void>
  position: (result: T) => void
  sample: () => number
  complete: (ratio: number) => void
  release: () => void
  fail: () => void
}

export const PAINT_WAIT_TIMEOUT_MS = 180

export const waitForPaint = (
  signal?: AbortSignal,
  timeoutMs = PAINT_WAIT_TIMEOUT_MS
): Promise<void> =>
  new Promise((resolve) => {
    const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis)
    const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis)
    const frameIds = new Set<number>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false

    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (cancelFrame) {
        for (const frameId of frameIds) cancelFrame(frameId)
      }
      frameIds.clear()
      signal?.removeEventListener('abort', finish)
    }
    const finish = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const trackFrame = (frameId: number): void => {
      if (settled) cancelFrame?.(frameId)
      else frameIds.add(frameId)
    }
    const requestNextFrame = (): void => {
      if (!requestFrame || settled) return
      let frameId = 0
      frameId = requestFrame(() => {
        frameIds.delete(frameId)
        finish()
      })
      trackFrame(frameId)
    }

    if (signal?.aborted) {
      finish()
      return
    }
    signal?.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, Math.max(0, timeoutMs))
    if (!requestFrame) return

    let frameId = 0
    frameId = requestFrame(() => {
      frameIds.delete(frameId)
      requestNextFrame()
    })
    trackFrame(frameId)
  })

export const restoreReadingPosition = async <T>(
  options: ReadingPositionRestorationOptions<T>
): Promise<void> => {
  let completed = false
  try {
    const result = await options.render()
    if (!options.isCurrent()) return
    options.mount(result)
    await options.waitForMount()
    await options.waitForPaint()
    if (!options.isCurrent()) return
    options.position(result)
    await options.waitForPaint()
    if (!options.isCurrent()) return
    options.complete(options.sample())
    completed = true
  } catch {
    if (options.isCurrent()) options.fail()
  } finally {
    if (!completed && options.isCurrent()) options.release()
  }
}
