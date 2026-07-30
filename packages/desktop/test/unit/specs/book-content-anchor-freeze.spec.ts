/* eslint-disable @stylistic/space-before-function-paren */
import { afterEach, describe, expect, it } from 'vitest'
import { renderBookMarkdown } from '@/book/renderMarkdown'
import {
  blockFrozenBookAnchorInteraction,
  createBookContentAnchorFreeze,
  redirectFrozenBookAnchorFocus
} from '@/components/bookWorkspace/bookContentAnchorFreeze'

const mounted: HTMLElement[] = []

const renderLinks = async (markdown: string): Promise<HTMLElement> => {
  const rendered = await renderBookMarkdown(markdown)
  const root = document.createElement('article')
  root.innerHTML = rendered.html
  document.body.append(root)
  mounted.push(root)
  return root
}

const dispatchInteraction = (
  root: HTMLElement,
  anchor: HTMLAnchorElement,
  event: Event,
  frozen = true
): boolean => {
  let activated = false
  anchor.addEventListener(
    event.type,
    (received) => {
      if (!blockFrozenBookAnchorInteraction(root, received, frozen)) activated = true
    },
    { once: true }
  )
  anchor.dispatchEvent(event)
  return activated
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove()
})

describe('rendered book anchor freeze', () => {
  it('freezes real external and fragment links, redirects focus, and restores exact attributes', async () => {
    const root = await renderLinks(`
[External](https://example.com/guide?q=one#start)
[Fragment](#section-two)

## Section two
`)
    const [external, fragment] = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[data-book-href]')
    )
    expect(external.dataset.bookHref).toBe('https://example.com/guide?q=one#start')
    expect(fragment.dataset.bookHref).toBe('#section-two')
    expect(external.hasAttribute('href')).toBe(false)
    expect(fragment.hasAttribute('href')).toBe(false)

    external.setAttribute('href', external.dataset.bookHref ?? '')
    fragment.setAttribute('href', fragment.dataset.bookHref ?? '')
    external.setAttribute('tabindex', '2')
    external.setAttribute('aria-disabled', 'false')
    external.setAttribute('aria-describedby', 'original-help')
    const originalTargets = [external.dataset.bookHref, fragment.dataset.bookHref]
    const originalHrefs = [external.getAttribute('href'), fragment.getAttribute('href')]
    const freeze = createBookContentAnchorFreeze()
    const fallback = document.createElement('button')
    fallback.textContent = 'Bookshelf'
    document.body.append(fallback)
    mounted.push(fallback)

    external.focus()
    expect(document.activeElement).toBe(external)
    freeze.sync(root, true, 'book-refresh-in-progress')
    redirectFrozenBookAnchorFocus(root, document.activeElement, true, () => fallback.focus())
    expect(document.activeElement).toBe(fallback)

    for (const anchor of [external, fragment]) {
      expect(anchor.getAttribute('tabindex')).toBe('-1')
      expect(anchor.getAttribute('aria-disabled')).toBe('true')
      expect(anchor.getAttribute('aria-describedby')).toBe('book-refresh-in-progress')
      expect(
        dispatchInteraction(
          root,
          anchor,
          new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
        )
      ).toBe(false)
      expect(
        dispatchInteraction(
          root,
          anchor,
          new MouseEvent('click', { bubbles: true, cancelable: true })
        )
      ).toBe(false)
      for (const key of ['Enter', ' ']) {
        expect(
          dispatchInteraction(
            root,
            anchor,
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
          )
        ).toBe(false)
      }
    }
    expect(root.querySelectorAll('a[data-book-href]:not([tabindex="-1"])')).toHaveLength(0)

    root.addEventListener('focusin', (event) => {
      redirectFrozenBookAnchorFocus(root, event.target, true, () => fallback.focus())
    })
    fragment.focus()
    expect(document.activeElement).toBe(fallback)

    freeze.sync(root, true, 'book-preparation-refresh-required')
    expect(external.getAttribute('aria-describedby')).toBe('book-preparation-refresh-required')
    expect(fragment.getAttribute('aria-describedby')).toBe('book-preparation-refresh-required')
    expect([external.dataset.bookHref, fragment.dataset.bookHref]).toEqual(originalTargets)
    expect([external.getAttribute('href'), fragment.getAttribute('href')]).toEqual(originalHrefs)

    freeze.sync(root, false, undefined)
    expect(external.getAttribute('tabindex')).toBe('2')
    expect(external.getAttribute('aria-disabled')).toBe('false')
    expect(external.getAttribute('aria-describedby')).toBe('original-help')
    expect(fragment.getAttribute('tabindex')).toBe('0')
    expect(fragment.hasAttribute('aria-disabled')).toBe(false)
    expect(fragment.hasAttribute('aria-describedby')).toBe(false)
    expect([external.dataset.bookHref, fragment.dataset.bookHref]).toEqual(originalTargets)
    expect([external.getAttribute('href'), fragment.getAttribute('href')]).toEqual(originalHrefs)
    expect(
      dispatchInteraction(
        root,
        fragment,
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        false
      )
    ).toBe(true)
  })

  it('restores detached snapshots and freezes replacement anchors after a frozen rerender', async () => {
    const root = await renderLinks('[First](first.md#one)')
    const first = root.querySelector<HTMLAnchorElement>('a[data-book-href]')
    if (!first) throw new Error('Expected rendered book link')
    first.setAttribute('tabindex', '4')
    first.setAttribute('aria-describedby', 'first-help')
    const freeze = createBookContentAnchorFreeze()
    freeze.sync(root, true, 'book-refresh-in-progress')
    expect(first.getAttribute('tabindex')).toBe('-1')

    const replacement = await renderBookMarkdown(`
[Second](https://example.com/two)
[Third](#three)
`)
    root.innerHTML = replacement.html
    freeze.sync(root, true, 'book-refresh-in-progress')
    expect(first.getAttribute('tabindex')).toBe('4')
    expect(first.getAttribute('aria-describedby')).toBe('first-help')

    const replacements = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[data-book-href]'))
    expect(replacements.map((anchor) => anchor.dataset.bookHref)).toEqual([
      'https://example.com/two',
      '#three'
    ])
    for (const anchor of replacements) {
      expect(anchor.getAttribute('tabindex')).toBe('-1')
      expect(anchor.getAttribute('aria-disabled')).toBe('true')
      expect(anchor.getAttribute('aria-describedby')).toBe('book-refresh-in-progress')
    }

    freeze.restoreAll()
    for (const anchor of replacements) {
      expect(anchor.getAttribute('tabindex')).toBe('0')
      expect(anchor.hasAttribute('aria-disabled')).toBe(false)
      expect(anchor.hasAttribute('aria-describedby')).toBe(false)
    }
  })
})
