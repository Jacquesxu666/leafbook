/* eslint-disable @stylistic/space-before-function-paren */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { uploadImage } from '@/util/fileSystem'

// uploadImage forwards to the preload contextBridge surface
// (window.uploader.uploadImage). Uploader configuration is main-owned persisted
// state and must never cross this renderer IPC boundary.
const uploadImageFn = vi.fn((_payload?: unknown) => Promise.resolve('https://cdn/x.png'))

const win = window as unknown as {
  uploader: { uploadImage: typeof uploadImageFn }
}

beforeEach(() => {
  uploadImageFn.mockClear()
  win.uploader = { uploadImage: uploadImageFn }
})

describe('uploadImage IPC payload shape', () => {
  const docPath = '/tmp/notes/a.md'

  it('forwards a local path string with isPath:true and no uploader configuration', async () => {
    const source = '/Users/someone/pictures/pic.png'
    const result = await uploadImage(docPath, source, {
      currentUploader: 'picgo',
      cliScript: ''
    })

    expect(uploadImageFn).toHaveBeenCalledTimes(1)
    const payload = uploadImageFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload.pathname).toBe(docPath)
    expect(payload.image).toBe(source)
    expect(payload.isPath).toBe(true)
    expect(payload).not.toHaveProperty('preferences')
    expect(result).toBe('https://cdn/x.png')
  })

  it('forwards a binary File with isPath:false and a Uint8Array + name', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
    await uploadImage(docPath, file, { currentUploader: 'picgo', cliScript: '' })

    expect(uploadImageFn).toHaveBeenCalledTimes(1)
    const payload = uploadImageFn.mock.calls[0][0] as {
      pathname: string
      image: { data: Uint8Array; name: string }
      isPath: boolean
    }
    expect(payload.pathname).toBe(docPath)
    expect(payload.isPath).toBe(false)
    expect(payload.image.name).toBe('pic.png')
    expect(payload.image.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(payload.image.data)).toEqual([1, 2, 3])
    expect(payload).not.toHaveProperty('preferences')
  })

  it('drops every renderer-supplied preference key', async () => {
    const fatPrefs = {
      currentUploader: 'picgo',
      cliScript: '/usr/local/bin/upload.sh',
      imageInsertAction: 'folder',
      autoGuessEncoding: true,
      nested: { foo: 'bar' }
    } as unknown as { currentUploader: string; cliScript?: string }

    await uploadImage(docPath, '/x/y.png', fatPrefs)

    const payload = uploadImageFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('preferences')
  })

  it('does not synthesize renderer uploader configuration when cliScript is absent', async () => {
    await uploadImage(docPath, '/x/y.png', { currentUploader: 'picgo' })

    const payload = uploadImageFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('preferences')
  })

  it('returns the uploader-provided URL', async () => {
    uploadImageFn.mockResolvedValueOnce('https://cdn/custom.png')
    const result = await uploadImage(docPath, '/x/y.png', { currentUploader: 'github' })
    expect(result).toBe('https://cdn/custom.png')
  })
})
