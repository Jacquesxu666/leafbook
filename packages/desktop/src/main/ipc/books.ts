/* eslint-disable @stylistic/indent */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { BookSessionManager } from '../book/sessionManager'
import type { BookReaderResult } from '@shared/types/bookReader'

let manager: BookSessionManager | null = null
const getManager = (): BookSessionManager => {
  manager ??= new BookSessionManager(app.getPath('userData'))
  return manager
}

const observedOwners = new Set<number>()
export const isTrustedEditorSender = (event: IpcMainInvokeEvent): boolean => {
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

const MAX_EDIT_BYTES = 8 * 1024 * 1024
const boundedId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128
const boundedSaveRequest = (value: unknown): boolean => {
  const request = value as {
    editId?: unknown
    revision?: unknown
    markdown?: unknown
    overwriteToken?: unknown
  } | null
  return Boolean(
    request &&
    boundedId(request.editId) &&
    typeof request.revision === 'string' &&
    request.revision.length === 64 &&
    typeof request.markdown === 'string' &&
    request.markdown.length <= MAX_EDIT_BYTES &&
    !/\r(?!\n)/.test(request.markdown) &&
    Buffer.byteLength(request.markdown, 'utf8') <= MAX_EDIT_BYTES &&
    (request.overwriteToken === undefined || boundedId(request.overwriteToken))
  )
}

export const registerBookHandlers = (): void => {
  ipcMain.handle('lb::books::list', (event) =>
    isTrustedEditorSender(event) ? getManager().listLibraries() : []
  )
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
  ipcMain.handle('lb::books::begin-edit', (event, sessionId, nodeId) =>
    isTrustedEditorSender(event) && boundedId(sessionId) && boundedId(nodeId)
      ? getManager().beginEdit(sessionId, nodeId, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::save-edit', (event, request) =>
    isTrustedEditorSender(event) && boundedSaveRequest(request)
      ? getManager().saveEdit(request, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::reload-edit', (event, editId) =>
    isTrustedEditorSender(event) && boundedId(editId)
      ? getManager().reloadEdit(editId, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::close-edit', (event, editId) =>
    isTrustedEditorSender(event) && boundedId(editId)
      ? getManager().closeEdit(editId, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::save-reading-position', (event, sessionId, nodeId, chapterProgress) =>
    isTrustedEditorSender(event)
      ? getManager().saveReadingPosition(sessionId, nodeId, chapterProgress, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::follow-link', (event, sessionId, nodeId, href) =>
    isTrustedEditorSender(event)
      ? getManager().followLink(sessionId, nodeId, href, event.sender.id)
      : rejected()
  )
  ipcMain.handle('lb::books::search', (event, sessionId, request) =>
    isTrustedEditorSender(event)
      ? getManager().search(sessionId, request, event.sender.id, (progress) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('lb::books::search-progress', progress)
            }
          } catch {
            // The sender can be destroyed between the check and send.
          }
        })
      : rejected()
  )
  ipcMain.handle('lb::books::cancel-search', (event, sessionId, searchId) =>
    isTrustedEditorSender(event)
      ? getManager().cancelSearch(sessionId, searchId, event.sender.id)
      : rejected()
  )
}
