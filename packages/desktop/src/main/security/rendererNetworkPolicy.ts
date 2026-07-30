import type { OnBeforeRequestListenerDetails, Session } from 'electron'

const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])
const installedSessions = new WeakSet<Session>()

export interface RendererNetworkDecision {
  allow: boolean
  reason: 'non-network' | 'development-origin' | 'renderer-network-denied'
}

function developmentHost(rendererUrl: string | undefined): string | null {
  if (process.env.NODE_ENV !== 'development' || !rendererUrl) return null
  try {
    const url = new URL(rendererUrl)
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (!loopback || url.protocol !== 'http:' || url.username || url.password) return null
    return url.host
  } catch {
    return null
  }
}

/**
 * Pure request policy used by Electron's webRequest guard and unit tests.
 *
 * Production renderer sessions have no ambient network capability. Development
 * permits only the exact loopback Vite origin supplied by electron-vite,
 * including its same-origin WebSocket. shell.openExternal and explicit
 * main-process upload capabilities do not use renderer webRequest and remain
 * available.
 */
export function decideRendererRequest(
  requestUrl: string,
  rendererUrl = process.env.ELECTRON_RENDERER_URL,
  webContentsId?: number
): RendererNetworkDecision {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return { allow: true, reason: 'non-network' }
  }
  if (!NETWORK_SCHEMES.has(url.protocol)) return { allow: true, reason: 'non-network' }
  // Session traffic without a positive renderer identity is ambiguous and
  // therefore denied. Explicit main-process Node/child-process capabilities do
  // not pass through this renderer-session policy.
  if (!Number.isInteger(webContentsId) || (webContentsId ?? 0) <= 0) {
    return { allow: false, reason: 'renderer-network-denied' }
  }

  const allowedDevelopmentHost = developmentHost(rendererUrl)
  if (
    allowedDevelopmentHost &&
    !url.username &&
    !url.password &&
    url.host === allowedDevelopmentHost &&
    (url.protocol === 'http:' || url.protocol === 'ws:')
  ) {
    return { allow: true, reason: 'development-origin' }
  }
  return { allow: false, reason: 'renderer-network-denied' }
}

export function installRendererNetworkPolicy(targetSession: Session): void {
  if (installedSessions.has(targetSession)) return
  installedSessions.add(targetSession)
  targetSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details: OnBeforeRequestListenerDetails, callback) => {
      callback({
        cancel: !decideRendererRequest(
          details.url,
          process.env.ELECTRON_RENDERER_URL,
          details.webContentsId
        ).allow
      })
    }
  )
}
