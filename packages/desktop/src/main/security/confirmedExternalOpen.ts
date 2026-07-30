/* eslint-disable @stylistic/space-before-function-paren */
import { BrowserWindow, dialog, shell, type WebContents } from 'electron'

export interface ConfirmedExternalOpenDependencies {
  confirm: (sender: WebContents, target: string) => Promise<boolean>
  openExternal: (target: string) => Promise<void>
}

export const validateExternalTarget = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

const confirm = async (sender: WebContents, target: string): Promise<boolean> => {
  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner || owner.isDestroyed() || sender.isDestroyed()) return false
  const parsed = new URL(target)
  const origin = parsed.protocol === 'mailto:' ? 'Email client' : parsed.origin
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: ['Cancel', 'Open'],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
    message: `Open this target outside LeafBook?\n${origin}`,
    detail: target
  })
  return result.response === 1
}

const defaults: ConfirmedExternalOpenDependencies = {
  confirm,
  openExternal: async (target) => {
    await shell.openExternal(target)
  }
}

export const confirmAndOpenExternal = async (
  sender: WebContents,
  value: unknown,
  dependencies: ConfirmedExternalOpenDependencies = defaults
): Promise<boolean> => {
  const target = validateExternalTarget(value)
  if (!target || sender.isDestroyed() || !(await dependencies.confirm(sender, target))) return false
  if (sender.isDestroyed()) return false
  await dependencies.openExternal(target)
  return true
}
