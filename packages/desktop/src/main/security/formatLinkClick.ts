/* eslint-disable @stylistic/space-before-function-paren */
import type { BrowserWindow, WebContents } from 'electron'

export interface FormatLinkPayload {
  data?: { href?: unknown; text?: unknown }
  dirname?: unknown
}

interface FormatLinkDependencies {
  trusted: (event: { sender: WebContents }) => boolean
  owner: (sender: WebContents) => BrowserWindow | null
  openExternal: (sender: WebContents, target: string) => Promise<boolean>
  invalidSpace: (owner: BrowserWindow) => void
}

const boundedString = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')

const unsafeDirectPath = (value: string): boolean =>
  value.startsWith('/') ||
  /^[a-z]:[\\/]/i.test(value) ||
  /^[\\/]{2}/.test(value) ||
  /^file:/i.test(value)

export const handleFormatLinkClick = async (
  event: { sender: WebContents },
  payload: unknown,
  dependencies: FormatLinkDependencies
): Promise<boolean> => {
  if (!dependencies.trusted(event)) return false
  const request = payload as FormatLinkPayload | null
  const raw = request?.data?.href || request?.data?.text
  if (!boundedString(raw)) return false
  const owner = dependencies.owner(event.sender)
  if (!owner || owner.isDestroyed() || event.sender.isDestroyed()) return false

  const wrapped = /^<([\s\S]+)>$/.exec(raw)
  const candidate = wrapped?.[1] ?? raw
  if (!wrapped && /\s/.test(candidate)) {
    dependencies.invalidSpace(owner)
    return false
  }

  if (/^(?:https?|mailto):/i.test(candidate)) {
    return dependencies.openExternal(event.sender, candidate)
  }
  // Every other explicit scheme, direct absolute/local path and UNC authority is
  // rejected. Renderer-originated paths are not filesystem capabilities.
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || unsafeDirectPath(candidate)) return false
  // Legacy editor link payloads carry a renderer-controlled dirname, so even
  // relative Markdown paths fail closed until main issues a document capability.
  return false
}
