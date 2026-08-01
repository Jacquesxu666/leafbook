interface BookPreparationFocusTargets {
  root?: ParentNode
  contentsButton: HTMLButtonElement | null
  arrangeButton: HTMLButtonElement | null
}

const visible = (element: HTMLElement | null): element is HTMLElement => {
  if (!element?.isConnected || element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false
  }
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

export const focusAfterBookPreparation = ({
  root = document,
  contentsButton,
  arrangeButton
}: BookPreparationFocusTargets): boolean => {
  const currentChapter = root.querySelector<HTMLElement>(
    '#book-contents .tree-label[aria-current="page"]'
  )
  for (const target of [currentChapter, contentsButton, arrangeButton]) {
    if (!visible(target)) continue
    target.focus({ preventScroll: true })
    if (document.activeElement === target) return true
  }
  return false
}
