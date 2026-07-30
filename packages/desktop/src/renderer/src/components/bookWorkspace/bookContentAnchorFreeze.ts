interface AnchorAttributeSnapshot {
  tabindex: string | null
  ariaDisabled: string | null
  ariaDescribedBy: string | null
}

const restoreAttribute = (anchor: HTMLAnchorElement, name: string, value: string | null): void => {
  if (value === null) anchor.removeAttribute(name)
  else anchor.setAttribute(name, value)
}

export const renderedBookAnchorAt = (
  root: HTMLElement | null,
  target: EventTarget | null
): HTMLAnchorElement | null => {
  if (!root || !(target instanceof Element)) return null
  const anchor = target.closest<HTMLAnchorElement>('a[data-book-href]')
  return anchor && root.contains(anchor) ? anchor : null
}

export const blockFrozenBookAnchorInteraction = (
  root: HTMLElement | null,
  event: Event,
  frozen: boolean
): boolean => {
  if (!frozen || !renderedBookAnchorAt(root, event.target)) return false
  event.preventDefault()
  return true
}

export const redirectFrozenBookAnchorFocus = (
  root: HTMLElement | null,
  target: EventTarget | null,
  frozen: boolean,
  focusFallback: () => void
): boolean => {
  if (!frozen || !renderedBookAnchorAt(root, target)) return false
  focusFallback()
  return true
}

export const createBookContentAnchorFreeze = () => {
  const snapshots = new Map<HTMLAnchorElement, AnchorAttributeSnapshot>()

  const restore = (anchor: HTMLAnchorElement): void => {
    const snapshot = snapshots.get(anchor)
    if (!snapshot) return
    restoreAttribute(anchor, 'tabindex', snapshot.tabindex)
    restoreAttribute(anchor, 'aria-disabled', snapshot.ariaDisabled)
    restoreAttribute(anchor, 'aria-describedby', snapshot.ariaDescribedBy)
    snapshots.delete(anchor)
  }

  const restoreAll = (): void => {
    for (const anchor of [...snapshots.keys()]) restore(anchor)
  }

  const sync = (
    root: HTMLElement | null,
    frozen: boolean,
    describedBy: string | undefined
  ): void => {
    if (!frozen || !root || !describedBy) {
      restoreAll()
      return
    }
    for (const anchor of [...snapshots.keys()]) {
      if (!root.contains(anchor)) restore(anchor)
    }
    root.querySelectorAll<HTMLAnchorElement>('a[data-book-href]').forEach((anchor) => {
      if (!snapshots.has(anchor)) {
        snapshots.set(anchor, {
          tabindex: anchor.getAttribute('tabindex'),
          ariaDisabled: anchor.getAttribute('aria-disabled'),
          ariaDescribedBy: anchor.getAttribute('aria-describedby')
        })
      }
      anchor.setAttribute('tabindex', '-1')
      anchor.setAttribute('aria-disabled', 'true')
      anchor.setAttribute('aria-describedby', describedBy)
    })
  }

  return { restoreAll, sync }
}
