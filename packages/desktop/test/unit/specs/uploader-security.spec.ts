/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog } from 'electron'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../../../src/main/ipc/books', () => ({
  isTrustedEditorSender: vi.fn(() => true)
}))

import {
  confirmUploader,
  handleUpload,
  validateCustomUploader
} from '../../../src/main/ipc/uploader'

const temporaryRoots: string[] = []
const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'leafbook-uploader-test-'))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('uploader IPC security', () => {
  it('shows the exact uploader, canonical image, and destination concept in native confirmation', async () => {
    const owner = {} as never
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner)
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 } as never)

    expect(
      await confirmUploader({} as never, '/canonical/bin/picgo', '/canonical/book/cover.png')
    ).toBe(false)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        detail:
          'Uploader: /canonical/bin/picgo\nImage: /canonical/book/cover.png\nDestination: configured uploader service'
      })
    )
  })

  it('rejects an untrusted sender before preferences or process dispatch', async () => {
    const getPreferences = vi.fn()
    const run = vi.fn()
    await expect(
      handleUpload(
        { sender: {} as never },
        { pathname: '/tmp/document.md', image: 'image.png', isPath: true },
        getPreferences,
        {
          trusted: () => false,
          resolvePicgo: () => '/usr/bin/picgo',
          run,
          confirmUploader: vi.fn()
        }
      )
    ).rejects.toThrow('Untrusted')
    expect(getPreferences).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('uses stored configuration and passes quote/metacharacter filenames as one argv item', async () => {
    const root = makeRoot()
    const documentPath = path.join(root, 'document.md')
    const imageName = 'quote";$(touch injected).png'
    const imagePath = path.join(root, imageName)
    const uploaderPath = path.join(root, 'trusted uploader')
    fs.writeFileSync(documentPath, '# test')
    fs.writeFileSync(imagePath, 'image bytes')
    fs.writeFileSync(uploaderPath, '#!/bin/sh\n')
    fs.chmodSync(uploaderPath, 0o700)
    const calls: Array<{ executable: string; args: readonly string[] }> = []

    const result = await handleUpload(
      { sender: {} as never },
      {
        pathname: documentPath,
        image: imageName,
        isPath: true,
        preferences: { currentUploader: 'picgo', cliScript: '/tmp/attacker' }
      } as never,
      () => ({ currentUploader: 'cliScript', cliScript: uploaderPath }),
      {
        trusted: () => true,
        resolvePicgo: () => null,
        run: (executable, args, callback) => {
          calls.push({ executable, args })
          callback(null, 'https://cdn.invalid/image.png\n', '')
        },
        confirmUploader: async () => true
      }
    )

    expect(result).toBe('https://cdn.invalid/image.png')
    expect(calls).toEqual([{ executable: uploaderPath, args: [imagePath] }])
  })

  it('requires native confirmation for every custom invocation and dispatches nothing on cancel', async () => {
    const root = makeRoot()
    const documentPath = path.join(root, 'document.md')
    const imagePath = path.join(root, 'image.png')
    const uploaderPath = path.join(root, 'uploader')
    fs.writeFileSync(documentPath, '# test')
    fs.writeFileSync(imagePath, 'image bytes')
    fs.writeFileSync(uploaderPath, '#!/bin/sh\n')
    fs.chmodSync(uploaderPath, 0o700)
    const run = vi.fn()
    const confirmUploader = vi.fn(async () => false)

    await expect(
      handleUpload(
        { sender: {} as never },
        { pathname: documentPath, image: 'image.png', isPath: true },
        () => ({ currentUploader: 'cliScript', cliScript: uploaderPath }),
        {
          trusted: () => true,
          resolvePicgo: () => null,
          run,
          confirmUploader
        }
      )
    ).rejects.toThrow('not approved')
    expect(confirmUploader).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('requires confirmation for PicGo and a compromised renderer cannot silently upload a known image', async () => {
    const root = makeRoot()
    const documentPath = path.join(root, 'document.md')
    const imagePath = path.join(root, 'known-image.png')
    const picgoPath = path.join(root, 'picgo')
    fs.writeFileSync(documentPath, '# test')
    fs.writeFileSync(imagePath, 'known image bytes')
    fs.writeFileSync(picgoPath, '#!/bin/sh\n', { mode: 0o700 })
    const run = vi.fn()
    const confirmUploader = vi.fn(async () => false)

    await expect(
      handleUpload(
        { sender: {} as never },
        { pathname: documentPath, image: 'known-image.png', isPath: true },
        () => ({ currentUploader: 'picgo', cliScript: '/renderer/cannot-select-this' }),
        {
          trusted: () => true,
          resolvePicgo: () => picgoPath,
          run,
          confirmUploader
        }
      )
    ).rejects.toThrow('not approved')
    expect(confirmUploader).toHaveBeenCalledWith({}, picgoPath, imagePath)
    expect(run).not.toHaveBeenCalled()
  })

  it('re-fstats the confirmed image immediately before dispatch', async () => {
    const root = makeRoot()
    const documentPath = path.join(root, 'document.md')
    const imagePath = path.join(root, 'image.png')
    const picgoPath = path.join(root, 'picgo')
    fs.writeFileSync(documentPath, '# test')
    fs.writeFileSync(imagePath, 'first identity')
    fs.writeFileSync(picgoPath, '#!/bin/sh\n', { mode: 0o700 })
    const run = vi.fn()

    await expect(
      handleUpload(
        { sender: {} as never },
        { pathname: documentPath, image: 'image.png', isPath: true },
        () => ({ currentUploader: 'picgo', cliScript: '' }),
        {
          trusted: () => true,
          resolvePicgo: () => picgoPath,
          run,
          confirmUploader: async () => {
            fs.rmSync(imagePath)
            fs.writeFileSync(imagePath, 'swapped identity')
            return true
          }
        }
      )
    ).rejects.toThrow('changed after confirmation')
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a symlink custom executable', async () => {
    if (process.platform === 'win32') return
    const root = makeRoot()
    const target = path.join(root, 'target')
    const link = path.join(root, 'uploader')
    fs.writeFileSync(target, '#!/bin/sh\n', { mode: 0o700 })
    fs.symlinkSync(target, link)
    await expect(validateCustomUploader(link)).rejects.toThrow('non-symlink')
  })
})
