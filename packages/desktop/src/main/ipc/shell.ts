/* eslint-disable @stylistic/space-before-function-paren */
import { clipboard, ipcMain, type WebContents } from 'electron'
import log from 'electron-log'
import * as plist from 'plist'
import { isTrustedEditorSender } from './books'
import {
  confirmAndOpenExternal,
  validateExternalTarget,
  type ConfirmedExternalOpenDependencies
} from '../security/confirmedExternalOpen'

interface ShellDependencies extends ConfirmedExternalOpenDependencies {
  trusted: (event: { sender: WebContents }) => boolean
}

export { validateExternalTarget }

const defaultDependencies: ShellDependencies = {
  trusted: isTrustedEditorSender,
  confirm: async (sender, target) =>
    confirmAndOpenExternal(sender, target, {
      confirm: async () => true,
      openExternal: async () => undefined
    }),
  openExternal: async () => undefined
}

export const handleOpenExternal = async (
  event: { sender: WebContents },
  value: unknown,
  dependencies: ShellDependencies = defaultDependencies
): Promise<boolean> => {
  if (!dependencies.trusted(event)) return false
  if (dependencies === defaultDependencies) return confirmAndOpenExternal(event.sender, value)
  return confirmAndOpenExternal(event.sender, value, dependencies)
}

const disabledPathOperation = (event: { sender: WebContents }): string => {
  if (!isTrustedEditorSender(event)) return 'Untrusted shell IPC sender'
  // Renderer-supplied filesystem paths are not capabilities. These legacy
  // bridges remain disabled until the main process can issue and consume an
  // opaque, single-purpose path capability.
  return 'Path shell operations are disabled in this release'
}

export const registerShellHandlers = (): void => {
  ipcMain.handle('mt::shell::open-external', async (event, url: unknown) => {
    try {
      return await handleOpenExternal(event, url)
    } catch (error) {
      log.error('shell.openExternal failed:', error)
      return false
    }
  })
  ipcMain.on('mt::shell::open-external', (event, url: unknown) => {
    handleOpenExternal(event, url).catch((error) => log.error('shell.openExternal failed:', error))
  })
  ipcMain.on('mt::shell::show-item', (event) => {
    log.warn(disabledPathOperation(event))
  })
  ipcMain.handle('mt::shell::open-path', async (event) => disabledPathOperation(event))

  ipcMain.on('mt::clipboard::write-text', (event, text: unknown) => {
    if (
      !isTrustedEditorSender(event) ||
      typeof text !== 'string' ||
      text.length > 16 * 1024 * 1024
    ) {
      return
    }
    try {
      clipboard.writeText(text)
    } catch (error) {
      log.error('clipboard.writeText failed:', error)
    }
  })
  ipcMain.handle('mt::clipboard::read-text', (event) => {
    if (!isTrustedEditorSender(event)) return ''
    try {
      return clipboard.readText()
    } catch {
      return ''
    }
  })

  ipcMain.handle('mt::clipboard::guess-file-path', (event) => {
    if (!isTrustedEditorSender(event)) return ''
    try {
      if (process.platform === 'darwin') {
        if (clipboard.has('NSFilenamesPboardType')) {
          const parsed = plist.parse(clipboard.read('NSFilenamesPboardType'))
          return Array.isArray(parsed) && parsed.length ? parsed[0] : ''
        }
        return ''
      }
      if (process.platform === 'win32') {
        const raw = clipboard.read('FileNameW')
        const filePath = raw ? raw.replace(new RegExp(String.fromCharCode(0), 'g'), '') : ''
        return typeof filePath === 'string' ? filePath : ''
      }
      return ''
    } catch (error) {
      log.error('clipboard.guess-file-path failed:', error)
      return ''
    }
  })
}
