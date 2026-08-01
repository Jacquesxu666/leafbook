/* eslint-disable @stylistic/space-before-function-paren */
import { describe, expect, it, vi } from 'vitest'
import { handleFormatLinkClick } from '../../../src/main/security/formatLinkClick'

const sender = { isDestroyed: () => false } as never
const owner = { isDestroyed: () => false } as never
const dependencies = () => ({
  trusted: vi.fn(() => true),
  owner: vi.fn(() => owner),
  openExternal: vi.fn(async () => true),
  invalidSpace: vi.fn()
})

describe('legacy format-link-click security', () => {
  it('rejects an untrusted sender without any dispatch', async () => {
    const deps = dependencies()
    deps.trusted.mockReturnValue(false)
    expect(
      await handleFormatLinkClick({ sender }, { data: { href: 'https://example.com/' } }, deps)
    ).toBe(false)
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('delegates allowed URLs to the centralized confirmation boundary', async () => {
    const deps = dependencies()
    expect(
      await handleFormatLinkClick({ sender }, { data: { href: 'https://example.com/docs' } }, deps)
    ).toBe(true)
    expect(deps.openExternal).toHaveBeenCalledWith(sender, 'https://example.com/docs')
  })

  it.each([
    'file:///tmp/private.md',
    '//server/share/book.md',
    '\\\\server\\share\\book.md',
    '/tmp/private.md',
    'C:\\private.md',
    './relative.md',
    '../outside.md',
    'javascript:alert(1)'
  ])('fails closed for local, UNC, relative, or unsafe link %s', async (href) => {
    const deps = dependencies()
    expect(
      await handleFormatLinkClick(
        { sender },
        { data: { href }, dirname: '/attacker/controlled' },
        deps
      )
    ).toBe(false)
    expect(deps.openExternal).not.toHaveBeenCalled()
  })
})
