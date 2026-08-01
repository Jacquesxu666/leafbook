import { afterEach, describe, expect, it } from 'vitest'
import { decideRendererRequest } from '../../../src/main/security/rendererNetworkPolicy'

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
})

describe('renderer network policy', () => {
  it.each(['http:', 'https:', 'ws:', 'wss:'])(
    'denies %s renderer requests in production',
    (scheme) => {
      process.env.NODE_ENV = 'production'
      expect(decideRendererRequest(`${scheme}//example.invalid/pixel`, undefined, 1)).toEqual({
        allow: false,
        reason: 'renderer-network-denied'
      })
    }
  )

  it('allows non-network schemes used by the packaged renderer and local images', () => {
    process.env.NODE_ENV = 'production'
    for (const url of [
      'file:///Applications/LeafBook.app/Contents/Resources/app.asar/index.html',
      'data:image/png;base64,AAAA',
      'blob:file:///image'
    ]) {
      expect(decideRendererRequest(url, undefined, 1)).toEqual({
        allow: true,
        reason: 'non-network'
      })
    }
  })

  it('allows only the exact loopback development origin', () => {
    process.env.NODE_ENV = 'development'
    const rendererUrl = 'http://127.0.0.1:5173'
    expect(decideRendererRequest('http://127.0.0.1:5173/src/main.ts', rendererUrl, 1).allow).toBe(
      true
    )
    expect(decideRendererRequest('ws://127.0.0.1:5173/', rendererUrl, 1).allow).toBe(true)
    expect(decideRendererRequest('http://127.0.0.1:5174/', rendererUrl, 1).allow).toBe(false)
    expect(decideRendererRequest('https://example.invalid/', rendererUrl, 1).allow).toBe(false)
  })

  it('rejects lookalike hosts, credentials, other loopback forms, and redirected destinations', () => {
    process.env.NODE_ENV = 'development'
    const rendererUrl = 'http://localhost:5173'
    for (const url of [
      'http://localhost.evil.invalid:5173/',
      'http://user:password@localhost:5173/',
      'http://127.0.0.1:5173/',
      'http://[::1]:5173/',
      'ws://localhost.evil.invalid:5173/',
      'https://redirected.example.invalid/final'
    ]) {
      expect(decideRendererRequest(url, rendererUrl, 1).allow).toBe(false)
    }
  })

  it('fails closed when session traffic has no renderer owner', () => {
    process.env.NODE_ENV = 'production'
    expect(decideRendererRequest('https://ambiguous.example.invalid/image', undefined, -1)).toEqual({
      allow: false,
      reason: 'renderer-network-denied'
    })
    expect(
      decideRendererRequest('https://ambiguous.example.invalid/image', undefined, undefined)
    ).toEqual({ allow: false, reason: 'renderer-network-denied' })
  })

  it('does not trust a non-loopback development URL', () => {
    process.env.NODE_ENV = 'development'
    expect(
      decideRendererRequest('https://dev.example.invalid/app', 'https://dev.example.invalid/app', 1)
        .allow
    ).toBe(false)
  })

  it('allows only http plus corresponding ws for the exact development host', () => {
    process.env.NODE_ENV = 'development'
    const rendererUrl = 'http://localhost:5173'
    expect(decideRendererRequest('http://localhost:5173/app', rendererUrl, 1).allow).toBe(true)
    expect(decideRendererRequest('ws://localhost:5173/hmr', rendererUrl, 1).allow).toBe(true)
    expect(decideRendererRequest('https://localhost:5173/app', rendererUrl, 1).allow).toBe(false)
    expect(decideRendererRequest('wss://localhost:5173/hmr', rendererUrl, 1).allow).toBe(false)
  })
})
