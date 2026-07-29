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
