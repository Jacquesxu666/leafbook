/* eslint-disable @stylistic/space-before-function-paren */
import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clickMenuById, expectNoRendererErrors, launchElectron, waitForEditor } from './helpers'

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
