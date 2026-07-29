import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { BookSessionManager } from '../book/sessionManager'
import type { BookReaderResult } from '@shared/types/bookReader'

let manager: BookSessionManager | null = null
const getManager = (): BookSessionManager => {
  manager ??= new BookSessionManager(app.getPath('userData'))
  return manager
}

const observedOwners = new Set<number>()
const isTrustedEditorSender = (event: IpcMainInvokeEvent): boolean => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed() || event.sender.isDestroyed()) return false
  // EditorWindow assigns this main-only marker before loading its renderer.
  // Settings/other windows never receive it; a compromised renderer cannot
  // forge a property held on the main-process BrowserWindow instance.
  if (
    typeof (window as BrowserWindow & { restoreBufferId?: unknown }).restoreBufferId !== 'string'
  ) {
    return false
  }
  try {
    const url = new URL(event.sender.getURL())
    if (url.searchParams.get('type') !== 'editor') return false
  } catch {
    return false
  }
  if (!observedOwners.has(event.sender.id)) {
    observedOwners.add(event.sender.id)
    event.sender.once('destroyed', () => {
      getManager().cleanupOwner(event.sender.id)
      observedOwners.delete(event.sender.id)
    })
  }
  return true
}

const rejected = <T>(): BookReaderResult<T> => ({
  ok: false,
  error: { code: 'invalid-request', message: 'This request did not come from an editor window.' }
})

export const registerBookHandlers = (): void => {
  ipcMain.handle('lb::books::list', () => getManager().listLibraries())
  ipcMain.handle('lb::books::open-picker', (event) =>
    isTrustedEditorSender(event) ? getManager().openPicker(event) : rejected()
  )
  ipcMain.handle('lb::books::open-library', (event, libraryId) =>
    isTrustedEditorSender(event) ? getManager().openLibrary(libraryId, event.sender.id) : rejected()
  )
  ipcMain.handle('lb::books::remove', (event, libraryId) =>
    isTrustedEditorSender(event) ? getManager().removeLibrary(libraryId) : rejected()
  )
  ipcMain.handle('lb::books::refresh', (event, sessionId) =>
    isTrustedEditorSender(event) ? getManager().refresh(sessionId, event.sender.id) : rejected()
  )
  ipcMain.handle('lb::books::close-session', (event, sessionId) =>
    isTrustedEditorSender(event)
      ? getManager().closeSession(sessionId, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::read-chapter', (event, sessionId, nodeId) =>
    isTrustedEditorSender(event)
      ? getManager().readChapter(sessionId, nodeId, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::follow-link', (event, sessionId, nodeId, href) =>
    isTrustedEditorSender(event)
      ? getManager().followLink(sessionId, nodeId, href, event.sender.id)
      : rejected()
  )
}
