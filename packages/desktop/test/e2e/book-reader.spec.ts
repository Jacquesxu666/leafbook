/* eslint-disable @stylistic/space-before-function-paren */
import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clickMenuById,
  expectNoRendererErrors,
  getMarkdownContent,
  launchElectron,
  sendIpcToRenderer,
  setSourceMarkdown,
  typeIntoEditor,
  waitForEditor
} from './helpers'

test('open book, navigate chapters, return to bookshelf, and preserve editor flow', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-book-'))
  const movedRoot = `${root}-moved`
  await fs.mkdir(path.join(root, 'guide'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'SUMMARY.md'),
    '# Summary\n\n- [Welcome](README.md)\n- [Second chapter](guide/second.md)\n'
  )
  await fs.writeFile(
    path.join(root, 'README.md'),
    '# Welcome\n\nA local-first book.\n\n[Read the second chapter](guide/second.md)'
  )
  await fs.writeFile(path.join(root, 'guide/second.md'), '# Second chapter\n\nThe next page works.')

  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () =>
        ({
          canceled: false,
          filePaths: [selectedRoot],
          bookmarks: []
        }) as Electron.OpenDialogReturnValue
    }, root)

    await clickMenuById(app, 'leafbookOpenBook')
    const visibleTitlebar = page.locator('.title-bar:visible')
    await expect(visibleTitlebar).toHaveCount(1)
    const titlebarBox = await visibleTitlebar.boundingBox()
    const workspaceBox = await page.locator('.book-workspace').boundingBox()
    expect(titlebarBox).not.toBeNull()
    expect(workspaceBox).not.toBeNull()
    if (!titlebarBox || !workspaceBox) throw new Error('Reader titlebar layout was unavailable.')
    expect(workspaceBox.y).toBeGreaterThanOrEqual(titlebarBox.y + titlebarBox.height - 1)
    if (process.platform !== 'darwin') {
      await expect(page.locator('.frameless-titlebar-close:visible')).toHaveCount(1)
    }
    await expect(page.getByRole('button', { name: 'Book home' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Contents' })).toHaveAttribute(
      'aria-controls',
      'book-contents'
    )
    await expect(page.locator('.reader-header strong')).toHaveText('Welcome')
    await expect(page.locator('.leafbook-markdown')).toContainText('A local-first book.')
    await page.locator('.book-content').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('a[data-book-href]')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.leafbook-markdown')).toContainText('The next page works.')
    await page.getByRole('button', { name: '← Previous' }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('A local-first book.')
    await page.getByRole('button', { name: 'Next →' }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('The next page works.')
    if (process.env.LEAFBOOK_SMOKE_SCREENSHOT) {
      await page.locator('.book-content').focus()
      await page.screenshot({ path: process.env.LEAFBOOK_SMOKE_SCREENSHOT })
    }
    await fs.rename(root, movedRoot)
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'README.md'), '# Replacement must not load')
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('alert')).toContainText('session was invalidated')
    await expect(page.locator('.leafbook-markdown')).not.toContainText('Replacement must not load')
    await page.getByRole('button', { name: '← Bookshelf' }).click()
    await expect(page.getByRole('heading', { name: 'Your Markdown books' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to editor' }).click()
    await page.getByRole('button', { name: 'New File' }).click()
    await waitForEditor(page)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(movedRoot, { recursive: true, force: true })
  }
})

test('Escape closes the mobile contents drawer from a focused tree button', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-mobile-book-'))
  await fs.writeFile(
    path.join(root, 'SUMMARY.md'),
    '# Summary\n\n- [Welcome](README.md)\n- [Second chapter](second.md)\n'
  )
  await fs.writeFile(path.join(root, 'README.md'), '# Welcome\n\nMobile reader.')
  await fs.writeFile(path.join(root, 'second.md'), '# Second chapter\n\nMore text.')

  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Editor window was unavailable.')
      window.setContentSize(650, 800)
    })
    await expect
      .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
      .toEqual({ width: 650, height: 800 })
    await app.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () =>
        ({
          canceled: false,
          filePaths: [selectedRoot],
          bookmarks: []
        }) as Electron.OpenDialogReturnValue
    }, root)

    await clickMenuById(app, 'leafbookOpenBook')
    const contents = page.getByRole('button', { name: 'Contents' })
    await expect(contents).toHaveAttribute('aria-expanded', 'true')
    await contents.click()
    await expect(contents).toHaveAttribute('aria-expanded', 'false')
    await contents.click()
    await expect(contents).toHaveAttribute('aria-expanded', 'true')

    const treeLabel = page.locator('.tree-label', { hasText: 'Welcome' })
    await treeLabel.focus()
    await expect(treeLabel).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(page.locator('#book-contents')).toHaveCount(0)
    await expect(contents).toHaveAttribute('aria-expanded', 'false')
    await expect(contents).toBeFocused()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await waitForEditor(page)
    await expect(page.getByRole('button', { name: 'Back to Book' })).toBeVisible()
    await expect(page.locator('.editor-component')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = document.querySelector('.editor-component')
          return Boolean(
            editor && document.activeElement && editor.contains(document.activeElement)
          )
        })
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Back to Book' }).click()
    await expect(page.locator('.book-content')).toHaveAttribute('data-reading-ready', 'true')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edits the current chapter, resolves conflicts, and returns with reading progress', async () => {
  test.setTimeout(60_000)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-edit-book-'))
  const filler = Array.from(
    { length: 90 },
    (_, index) => `## Section ${index + 1}\n\nOriginal paragraph ${index + 1}.`
  ).join('\n\n')
  const chapterPath = path.join(root, 'README.md')
  await fs.writeFile(path.join(root, 'SUMMARY.md'), '# Summary\n\n- [Editable](README.md)\n')
  await fs.writeFile(chapterPath, `# Editable\n\n${filler}\n`)

  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600)
    })
    await app.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () =>
        ({
          canceled: false,
          filePaths: [selectedRoot],
          bookmarks: []
        }) as Electron.OpenDialogReturnValue
    }, root)
    await clickMenuById(app, 'leafbookOpenBook')
    const readingSurface = page.locator('.book-content')
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await readingSurface.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.58
      element.dispatchEvent(new Event('scroll'))
    })
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await waitForEditor(page)
    await setSourceMarkdown(
      page,
      app,
      `# Edited heading\n\nSaved from LeafBook editor.\n\n${filler}\n`
    )
    await typeIntoEditor(page, ' Muya-token')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect
      .poll(() => fs.readFile(chapterPath, 'utf8'))
      .toContain('Saved from LeafBook editor.')

    await page.getByRole('button', { name: 'Back to Book' }).click()
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expect(page.locator('.leafbook-markdown h1')).toHaveText('Edited heading')
    await expect(page.locator('.leafbook-markdown')).toContainText('Muya-token')
    await expect
      .poll(() =>
        readingSurface.evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeGreaterThan(0.45)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await setSourceMarkdown(page, app, '# Mine\n\nCancel must keep external bytes.\n')
    await fs.writeFile(chapterPath, '# External\n\nExternal version stays.\n')
    const backToBook = page.getByRole('button', { name: 'Back to Book' })
    await backToBook.focus()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    const conflictDialog = page.getByRole('dialog', { name: 'Chapter changed on disk' })
    await expect(conflictDialog).toBeVisible()
    await expect(conflictDialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await expect(conflictDialog.getByRole('button')).toHaveCount(3)
    await page.keyboard.press('Shift+Tab')
    await expect(conflictDialog.getByRole('button', { name: 'Overwrite' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(conflictDialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await backToBook.evaluate((element: HTMLElement) => element.focus())
    await expect(backToBook).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(conflictDialog).toBeHidden()
    await expect(backToBook).toBeFocused()
    await expect.poll(() => fs.readFile(chapterPath, 'utf8')).toContain('External version stays.')

    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await conflictDialog.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => getMarkdownContent(page, app)).toContain('External version stays.')

    await setSourceMarkdown(page, app, '# Overwritten\n\nExplicit overwrite wins.\n')
    await fs.writeFile(chapterPath, '# External again\n\nSecond conflict.\n')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await conflictDialog.getByRole('button', { name: 'Overwrite' }).click()
    await expect.poll(() => fs.readFile(chapterPath, 'utf8')).toContain('Explicit overwrite wins.')

    await setSourceMarkdown(page, app, '# Dirty\n\nBack guard must not lose this silently.\n')
    await backToBook.click()
    const dirtyDialog = page.getByRole('dialog', { name: 'Unsaved chapter changes' })
    await expect(dirtyDialog).toBeVisible()
    await dirtyDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.editor-component')).toBeVisible()
    await backToBook.click()
    await dirtyDialog.getByRole('button', { name: 'Discard' }).click()
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expect(page.locator('.leafbook-markdown')).toContainText('Explicit overwrite wins.')

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await waitForEditor(page)
    await setSourceMarkdown(page, app, '# Window dirty\n\nWindow close guard.\n')
    await typeIntoEditor(page, ' window-dirty-token')
    await sendIpcToRenderer(app, 'mt::ask-for-close')
    await expect(dirtyDialog).toBeVisible()
    await dirtyDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.editor-component')).toBeVisible()
    await backToBook.click()
    await dirtyDialog.getByRole('button', { name: 'Discard' }).click()
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('searches the whole book, opens a matched heading, and rebuilds after refresh', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-search-book-'))
  const nfdHeading = 'Café Target heading'.normalize('NFD')
  const nfdBody = 'Résumé body needle'.normalize('NFD')
  const filler = Array.from(
    { length: 40 },
    (_, index) => `Paragraph ${index + 1} keeps the target below the fold.`
  ).join('\n\n')
  const tail = Array.from(
    { length: 40 },
    (_, index) => `Trailing paragraph ${index + 1} leaves room after the target.`
  ).join('\n\n')
  await fs.writeFile(
    path.join(root, 'SUMMARY.md'),
    '# Summary\n\n- [Welcome](README.md)\n- [Search chapter](search.md)\n- [Partial chapter](partial.md)\n'
  )
  await fs.writeFile(path.join(root, 'README.md'), '# Welcome\n\nOpen search with slash.')
  await fs.writeFile(
    path.join(root, 'search.md'),
    `---\ntags: [phase-six]\n---\n# Search chapter\n\n${filler}\n\n## ΟΣ ${nfdHeading}\n\nΟΣ ${nfdBody}\n\n\`\`\`ts\nconst codeNeedle = true\n\`\`\`\n\n${tail}\n`
  )
  await fs.writeFile(path.join(root, 'partial.md'), `# Partial chapter\n\n${'x'.repeat(1_100_000)}`)

  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Editor window was unavailable.')
      window.setContentSize(650, 800)
    })
    await app.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () =>
        ({
          canceled: false,
          filePaths: [selectedRoot],
          bookmarks: []
        }) as Electron.OpenDialogReturnValue
    }, root)
    await clickMenuById(app, 'leafbookOpenBook')

    await page.locator('.book-content').focus()
    await page.keyboard.press('/')
    const searchButton = page.getByRole('button', { name: 'Search', exact: true })
    await expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    const input = page.getByRole('searchbox', { name: 'Search this book' })
    await expect(input).toBeFocused()
    const panelBox = await page.locator('#book-search-panel').boundingBox()
    const inputBox = await input.boundingBox()
    expect(panelBox?.width).toBe(650)
    expect(panelBox?.height).toBeGreaterThan(500)
    expect(inputBox?.height).toBe(42)
    const closeSearch = page.getByRole('button', { name: 'Close search' })
    await expect(closeSearch).toHaveCSS('appearance', 'none')
    await expect(closeSearch).toHaveCSS('border-top-width', '1px')
    await expect(closeSearch).toHaveCSS('border-top-left-radius', '7px')
    await input.fill('ος')
    const result = page.getByRole('option').first()
    await expect(result).toContainText('Search chapter')
    await expect.poll(() => result.locator('mark').first().textContent()).toBe('ΟΣ')
    await expect(
      page.getByText('Some document content was truncated to keep search bounded.')
    ).toBeVisible()
    await expect(result).toHaveCSS('border-top-width', '1px')
    const resultBox = await result.boundingBox()
    expect(resultBox?.height).toBeGreaterThanOrEqual(68)
    expect(resultBox?.height).toBeLessThanOrEqual(160)
    expect((await page.screenshot()).byteLength).toBeGreaterThan(10_000)
    await expect(page.getByRole('option')).toHaveCount(2)
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option').nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(result).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#book-search-panel')).toHaveCount(0)
    const targetHeading = page
      .locator('.leafbook-markdown h2')
      .filter({ hasText: 'Target heading' })
    await expect
      .poll(() => targetHeading.textContent().then((text) => text?.normalize('NFC')))
      .toBe('ΟΣ Café Target heading')
    await expect
      .poll(() =>
        targetHeading.evaluate((heading) => {
          const container = heading.closest('.book-content')
          if (!container) return Number.POSITIVE_INFINITY
          return Math.abs(
            heading.getBoundingClientRect().top - container.getBoundingClientRect().top
          )
        })
      )
      .toBeLessThan(20)

    await searchButton.click()
    await input.fill('Café')
    await expect
      .poll(() => page.getByRole('option').first().locator('mark').textContent())
      .toBe('Cafe\u0301')
    await input.fill('Résumé')
    await expect
      .poll(() =>
        page
          .getByRole('option')
          .first()
          .textContent()
          .then((text) => text?.normalize('NFC'))
      )
      .toContain('Résumé body needle')
    await input.fill('codeneedle')
    await expect(page.getByRole('option').first()).toContainText('codeNeedle')
    await page.keyboard.press('Escape')

    await fs.writeFile(
      path.join(root, 'search.md'),
      '# Search chapter\n\n## Refreshed heading\n\nA freshIndexNeedle appears now.\n'
    )
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('freshIndexNeedle')
    await searchButton.click()
    await input.fill('codeneedle')
    await expect(page.getByText('0 results', { exact: true })).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)
    await input.fill('freshindexneedle')
    await expect(page.getByRole('option').first()).toContainText('freshIndexNeedle')
    await page.keyboard.press('Escape')
    await expect(page.locator('#book-search-panel')).toHaveCount(0)
    await expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    await expect(searchButton).toBeFocused()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('persists reading progress and restores the last chapter scroll position', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-progress-book-'))
  const longChapter = Array.from(
    { length: 100 },
    (_, index) =>
      `## Section ${index + 1}\n\nParagraph ${index + 1}. This makes the chapter independently scrollable.`
  ).join('\n\n')
  await fs.writeFile(
    path.join(root, 'SUMMARY.md'),
    '# Summary\n\n- [Welcome](README.md)\n- [Long chapter](long.md)\n'
  )
  await fs.writeFile(
    path.join(root, 'README.md'),
    '# Welcome\n\nStart reading.\n\n[Jump to section 80](long.md#section-80)'
  )
  await fs.writeFile(path.join(root, 'long.md'), `# Long chapter\n\n${longChapter}`)

  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Editor window was unavailable.')
      window.setContentSize(900, 600)
    })
    await app.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () =>
        ({
          canceled: false,
          filePaths: [selectedRoot],
          bookmarks: []
        }) as Electron.OpenDialogReturnValue
    }, root)
    await clickMenuById(app, 'leafbookOpenBook')
    const readingSurface = page.locator('.book-content')
    await expect(readingSurface).toBeVisible()
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await page.getByRole('link', { name: 'Jump to section 80' }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('Paragraph 100.')
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')

    await expect
      .poll(() =>
        page
          .locator('.reader-title progress')
          .evaluate((element: HTMLProgressElement) => element.value)
      )
      .toBeGreaterThanOrEqual(0.5)
    await expect
      .poll(() =>
        page.locator('.book-content').evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeGreaterThan(0.65)

    await page.getByRole('button', { name: '← Bookshelf' }).click()
    await expect(page.getByText('Continue from Long chapter')).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('.book-card progress')
          .evaluate((element: HTMLProgressElement) => element.value)
      )
      .toBeGreaterThan(0.8)
    await page.getByRole('button', { name: 'Read', exact: true }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('Paragraph 100.')
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expect
      .poll(() =>
        page.locator('.book-content').evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeGreaterThan(0.65)

    const savedMetrics = await page.locator('.book-content').evaluate((element) => {
      const scrollable = element.scrollHeight - element.clientHeight
      element.scrollTop = scrollable * 0.2
      element.dispatchEvent(new Event('scroll'))
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        ratio: scrollable > 0 ? element.scrollTop / scrollable : 0
      }
    })
    expect(savedMetrics.scrollHeight).toBeGreaterThan(savedMetrics.clientHeight)
    expect(savedMetrics.ratio).toBeGreaterThan(0.15)
    await expect
      .poll(() =>
        page
          .locator('.reader-title progress')
          .evaluate((element: HTMLProgressElement) => element.value)
      )
      .toBeLessThan(0.65)

    await page.getByRole('button', { name: '← Bookshelf' }).click()
    await expect(page.getByText('Continue from Long chapter')).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('.book-card progress')
          .evaluate((element: HTMLProgressElement) => element.value)
      )
      .toBeGreaterThan(0.55)
    await expect
      .poll(() =>
        page
          .locator('.book-card progress')
          .evaluate((element: HTMLProgressElement) => element.value)
      )
      .toBeLessThan(0.7)

    await page.getByRole('button', { name: 'Read', exact: true }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('Paragraph 100.')
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expect
      .poll(() =>
        page.locator('.book-content').evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeLessThan(0.35)

    await page.locator('.book-content').evaluate((element) => {
      const scrollable = element.scrollHeight - element.clientHeight
      element.scrollTop = scrollable * 0.82
      element.dispatchEvent(new Event('scroll'))
    })
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'false')
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expect
      .poll(() =>
        page.locator('.book-content').evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeGreaterThan(0.75)
    await page.getByRole('button', { name: '← Bookshelf' }).click()
    await page.getByRole('button', { name: 'Read', exact: true }).click()
    await expect(page.locator('.leafbook-markdown')).toContainText('Paragraph 100.')
    await expect(readingSurface).toHaveAttribute('data-reading-ready', 'true')
    await expect
      .poll(() =>
        readingSurface.evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeGreaterThan(0.75)
    await page.waitForTimeout(2_200)
    await expect
      .poll(() =>
        page.locator('.book-content').evaluate((element) => {
          const scrollable = element.scrollHeight - element.clientHeight
          return scrollable > 0 ? element.scrollTop / scrollable : 0
        })
      )
      .toBeGreaterThan(0.75)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
