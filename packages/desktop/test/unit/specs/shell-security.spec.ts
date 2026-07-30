/* eslint-disable @stylistic/space-before-function-paren */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  clipboard: {},
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../../../src/main/ipc/books', () => ({
  isTrustedEditorSender: vi.fn(() => true)
}))

import { handleOpenExternal, validateExternalTarget } from '../../../src/main/ipc/shell'

const event = { sender: { isDestroyed: () => false } as never }

describe('shell IPC security', () => {
  it('rejects untrusted owners before confirmation or dispatch', async () => {
    const confirm = vi.fn()
    const openExternal = vi.fn()
    expect(
      await handleOpenExternal(event, 'https://example.com/', {
        trusted: () => false,
        confirm,
        openExternal
      })
    ).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    'file:///tmp/private',
    'javascript:alert(1)',
    'data:text/html,hello',
    'ftp://example.com/file',
    'https://user:password@example.com/'
  ])('rejects unsafe external target %s', (target) => {
    expect(validateExternalTarget(target)).toBeNull()
  })

  it('requires confirmation and never dispatches when cancelled', async () => {
    const openExternal = vi.fn()
    expect(
      await handleOpenExternal(event, 'https://example.com/path', {
        trusted: () => true,
        confirm: async () => false,
        openExternal
      })
    ).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('does not dispatch when the owner is destroyed during confirmation', async () => {
    let destroyed = false
    const openExternal = vi.fn()
    expect(
      await handleOpenExternal(
        { sender: { isDestroyed: () => destroyed } as never },
        'https://example.com/path',
        {
          trusted: () => true,
          confirm: async () => {
            destroyed = true
            return true
          },
          openExternal
        }
      )
    ).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each(['http://example.com/', 'https://example.com/', 'mailto:reader@example.com'])(
    'opens an allowlisted target only after confirmation: %s',
    async (target) => {
      const openExternal = vi.fn(async () => undefined)
      const confirm = vi.fn(async () => true)
      expect(
        await handleOpenExternal(event, target, {
          trusted: () => true,
          confirm,
          openExternal
        })
      ).toBe(true)
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(openExternal).toHaveBeenCalledTimes(1)
    }
  )
})
