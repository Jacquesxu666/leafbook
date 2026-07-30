import { afterEach, describe, expect, it } from 'vitest'
import { focusAfterBookPreparation } from '@/components/bookWorkspace/bookPreparationFocus'

afterEach(() => {
  document.body.replaceChildren()
})

const button = (text: string): HTMLButtonElement => {
  const element = document.createElement('button')
  element.textContent = text
  return element
}

describe('book preparation success focus', () => {
  it('prefers the visible current chapter after the panel unmounts', () => {
    const navigation = document.createElement('nav')
    navigation.id = 'book-contents'
    const current = button('Current chapter')
    current.className = 'tree-label'
    current.setAttribute('aria-current', 'page')
    navigation.append(current)
    const contents = button('Contents')
    const arrange = button('Arrange')
    document.body.append(contents, arrange, navigation)

    expect(focusAfterBookPreparation({ contentsButton: contents, arrangeButton: arrange })).toBe(
      true
    )
    expect(document.activeElement).toBe(current)
  })

  it('uses Contents when the navigation is collapsed and never leaves focus on body', () => {
    const contents = button('Contents')
    const arrange = button('Arrange')
    document.body.append(contents, arrange)
    document.body.focus()

    expect(focusAfterBookPreparation({ contentsButton: contents, arrangeButton: arrange })).toBe(
      true
    )
    expect(document.activeElement).toBe(contents)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('skips hidden controls and falls back to a visible Arrange button', () => {
    const contents = button('Contents')
    contents.hidden = true
    const arrange = button('Arrange')
    document.body.append(contents, arrange)

    expect(focusAfterBookPreparation({ contentsButton: contents, arrangeButton: arrange })).toBe(
      true
    )
    expect(document.activeElement).toBe(arrange)
  })
})
