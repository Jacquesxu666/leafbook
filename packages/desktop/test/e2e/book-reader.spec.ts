/* eslint-disable @stylistic/space-before-function-paren */
import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
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

test('exports one offline HTML book with scoped Chinese heading navigation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-html-book-'))
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-html-output-'))
  const output = path.join(destination, '离线书.html')
  await fs.writeFile(
    path.join(root, 'SUMMARY.md'),
    '- [第一章](one.md)\n- [第一章别名](one.md#重复标题)\n- [不存在的小节](one.md#不存在)\n- [缺失章节](missing.md)\n- [第二章](two.md)\n'
  )
  await fs.writeFile(
    path.join(root, 'one.md'),
    '# 重复标题\n\n[跳到第二章标题](two.md#重复标题)\n\n[缺失正文](missing.md)\n\n# 重复标题\n'
  )
  await fs.writeFile(
    path.join(root, 'two.md'),
    '# 重复标题\n\n![本地图](private.png)\n\n[外网](https://example.invalid/x)\n'
  )
  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(
      ({ dialog }, values) => {
        dialog.showOpenDialog = async () =>
          ({
            canceled: false,
            filePaths: [values.root],
            bookmarks: []
          }) as Electron.OpenDialogReturnValue
        dialog.showSaveDialog = async () =>
          ({ canceled: false, filePath: values.output }) as Electron.SaveDialogReturnValue
        dialog.showMessageBox = async () =>
          ({ response: 1, checkboxChecked: false }) as Electron.MessageBoxReturnValue
      },
      { root, output }
    )
    await clickMenuById(app, 'leafbookOpenBook')
    await page.getByRole('button', { name: 'Export…' }).click()
    await expect(page.getByRole('status')).toContainText('Exported 离线书.html')
    const html = await fs.readFile(output, 'utf8')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('第一章别名')
    expect(html.match(/id="leafbook-chapter-1"/g)).toHaveLength(1)
    expect(html).not.toMatch(/\s(?:href|src)=["'](?:https?:|file:|\/)/i)
    expect(html).not.toMatch(/<script|\son[a-z]+=|\sstyle=|data-book-href=/i)
    expect(html).not.toContain(root)
    const result = await app.evaluate(async ({ BrowserWindow, session }, filePath) => {
      const partition = `leafbook-export-e2e-${Date.now()}`
      const isolatedSession = session.fromPartition(partition)
      const requests: string[] = []
      isolatedSession.webRequest.onBeforeRequest((details, callback) => {
        requests.push(details.url)
        callback({})
      })
      const consoleMessages: string[] = []
      const window = new BrowserWindow({
        show: false,
        webPreferences: { partition }
      })
      window.webContents.on('console-message', (_event, _level, message) => {
        consoleMessages.push(message)
      })
      try {
        await window.loadFile(filePath)
        const inspected = await window.webContents.executeJavaScript(`
          (() => {
            const link = [...document.querySelectorAll('.leafbook-book a')]
              .find((anchor) => anchor.textContent.includes('跳到第二章标题'))
            if (!(link instanceof HTMLAnchorElement)) {
              return {
                chapters: 0, hash: '', text: '', unsafeAnchors: 1,
                resourceAttributes: 1, styleAttributes: 1, targetReached: false
              }
            }
            link.click()
            return {
              chapters: document.querySelectorAll('.leafbook-chapter').length,
              hash: location.hash,
              text: document.body.textContent || '',
              unsafeAnchors: [...document.querySelectorAll('a[href]')]
                .filter((anchor) => !anchor.getAttribute('href').startsWith('#leafbook-')).length,
              resourceAttributes: document.querySelectorAll(
                '[src],[srcset],[poster],[background],[xlink\\\\:href]'
              ).length,
              styleAttributes: document.querySelectorAll('[style]').length,
              missingFragmentLinks: [...document.querySelectorAll('.leafbook-toc a')]
                .filter((anchor) => anchor.textContent.includes('不存在的小节')).length,
              missingFragmentPlaceholders: [...document.querySelectorAll(
                '.leafbook-toc .leafbook-broken-link'
              )].filter((node) => node.textContent.includes('不存在的小节')).length,
              missingBodyLinks: [...document.querySelectorAll('.leafbook-book a')]
                .filter((anchor) => anchor.textContent.includes('缺失正文')).length,
              missingBodyPlaceholders: [...document.querySelectorAll(
                '.leafbook-book .leafbook-broken-link'
              )].filter((node) => node.textContent.includes('缺失正文')).length,
              missingChapterSections: [...document.querySelectorAll('.leafbook-chapter')]
                .filter((section) => section.textContent.includes('缺失章节')).length,
              targetReached: Boolean(document.querySelector(location.hash))
            }
          })()
        `)
        return { ...inspected, requests, consoleMessages }
      } finally {
        window.destroy()
      }
    }, output)
    expect(result.chapters).toBe(2)
    expect(result.hash).toBe('#leafbook-heading-3-1')
    expect(result.targetReached).toBe(true)
    expect(result.unsafeAnchors).toBe(0)
    expect(result.resourceAttributes).toBe(0)
    expect(result.styleAttributes).toBe(0)
    expect(result.missingFragmentLinks).toBe(0)
    expect(result.missingFragmentPlaceholders).toBe(1)
    expect(result.missingBodyLinks).toBe(0)
    expect(result.missingBodyPlaceholders).toBe(1)
    expect(result.missingChapterSections).toBe(0)
    expect(result.requests.filter((url: string) => /^https?:/i.test(url))).toEqual([])
    expect(result.consoleMessages.filter((message: string) => /Refused to/i.test(message))).toEqual(
      []
    )
    expect(result.text).toContain('本地图')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(destination, { recursive: true, force: true })
  }
})

test('generates an exact two-file offline website whose manifest hashes the loaded HTML', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-site-book-'))
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-site-output-'))
  const output = path.join(destination, 'LeafBook-site')
  await fs.writeFile(
    path.join(root, 'SUMMARY.md'),
    '- [第一章](one.md)\n- [别名](one.md#中文标题)\n- [缺失](missing.md)\n'
  )
  await fs.writeFile(
    path.join(root, 'one.md'),
    '# 中文标题\n\n[回到标题](one.md#中文标题)\n\n![本地图](private.png)\n'
  )
  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  try {
    await app.evaluate(
      ({ dialog }, values) => {
        dialog.showOpenDialog = async () =>
          ({
            canceled: false,
            filePaths: [values.root],
            bookmarks: []
          }) as Electron.OpenDialogReturnValue
        dialog.showSaveDialog = async () =>
          ({ canceled: false, filePath: values.output }) as Electron.SaveDialogReturnValue
        dialog.showMessageBox = async () =>
          ({ response: 1, checkboxChecked: false }) as Electron.MessageBoxReturnValue
      },
      { root, output }
    )
    await clickMenuById(app, 'leafbookOpenBook')
    await page.getByRole('button', { name: 'Generate Website…' }).click()
    await expect(page.getByRole('status')).toContainText('Generated LeafBook-site')
    expect((await fs.readdir(output)).sort()).toEqual(['index.html', 'leafbook-manifest.json'])
    const html = await fs.readFile(path.join(output, 'index.html'))
    const manifestBytes = await fs.readFile(path.join(output, 'leafbook-manifest.json'))
    const expectedManifest = {
      schemaVersion: 1,
      generator: 'LeafBook',
      files: [
        {
          path: 'index.html',
          size: html.byteLength,
          sha256: createHash('sha256').update(html).digest('hex')
        }
      ]
    }
    expect(JSON.parse(manifestBytes.toString('utf8'))).toEqual(expectedManifest)
    expect(manifestBytes.toString('utf8')).toBe(`${JSON.stringify(expectedManifest, null, 2)}\n`)
    expect(html.toString()).not.toContain(root)
    expect(html.toString().match(/id="leafbook-chapter-1"/g)).toHaveLength(1)
    const loaded = await app.evaluate(
      async ({ BrowserWindow, session }, filePath) => {
        const partition = `leafbook-site-e2e-${Date.now()}`
        const isolated = session.fromPartition(partition)
        const requests: string[] = []
        isolated.webRequest.onBeforeRequest((details, callback) => {
          requests.push(details.url)
          callback({})
        })
        const errors: string[] = []
        const window = new BrowserWindow({ show: false, webPreferences: { partition } })
        window.webContents.on('console-message', (_event, level, message) => {
          const knownNavigateWarning =
            message === "Unrecognized Content-Security-Policy directive 'navigate-to'."
          if (level >= 2 && !knownNavigateWarning) errors.push(message)
        })
        try {
          await window.loadFile(filePath)
          const inspected = await window.webContents.executeJavaScript(`
            (() => {
              const aliasLinks = [...document.querySelectorAll('.leafbook-toc a')]
                .filter((anchor) => anchor.textContent === '别名')
              const alias = aliasLinks[0]
              const aliasHref = alias?.getAttribute('href') || ''
              alias?.click()
              return {
                chapters: document.querySelectorAll('.leafbook-chapter').length,
                scripts: document.querySelectorAll('script').length,
                eventHandlerAttributes: [...document.querySelectorAll('*')]
                  .flatMap((element) => [...element.attributes])
                  .filter((attribute) => /^on/i.test(attribute.name)).length,
                unsafeAttrs: document.querySelectorAll(
                  '[src],[srcset],[poster],[background],[xlink\\\\:href],[style]'
                ).length,
                unsafeLinks: [...document.querySelectorAll('a[href]')]
                  .filter((anchor) => !anchor.getAttribute('href').startsWith('#leafbook-')).length,
                chinese: document.body.textContent.includes('中文标题'),
                missingDisabled: [...document.querySelectorAll(
                  '.leafbook-toc .leafbook-broken-link'
                )].some((node) => node.textContent.includes('缺失')),
                aliasLinks: aliasLinks.length,
                aliasHref,
                resolvedHash: location.hash,
                aliasTargetResolved: Boolean(document.querySelector(location.hash))
              }
            })()
          `)
          return { ...inspected, requests, errors }
        } finally {
          window.destroy()
        }
      },
      path.join(output, 'index.html')
    )
    expect(loaded).toMatchObject({
      chapters: 1,
      scripts: 0,
      eventHandlerAttributes: 0,
      unsafeAttrs: 0,
      unsafeLinks: 0,
      chinese: true,
      missingDisabled: true,
      aliasLinks: 1,
      aliasHref: '#leafbook-heading-1-1',
      resolvedHash: '#leafbook-heading-1-1',
      aliasTargetResolved: true,
      errors: []
    })
    expect(loaded.requests.filter((url: string) => /^https?:/i.test(url))).toEqual([])
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(destination, { recursive: true, force: true })
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

test('arranges an existing SUMMARY with keyboard, buttons, undo, save and zero-write cancel', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-arrange-book-'))
  const summaryPath = path.join(root, 'SUMMARY.md')
  const originalSummary = '# Summary\n\n- [One](one.md)\n- [Two](two.md)\n- [Three](three.md)\n'
  await fs.writeFile(summaryPath, originalSummary)
  await fs.writeFile(path.join(root, 'one.md'), '# One\n\nFirst chapter.')
  await fs.writeFile(path.join(root, 'two.md'), '# Two\n\nSecond chapter.')
  await fs.writeFile(path.join(root, 'three.md'), '# Three\n\nThird chapter.')

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
    const arrange = page.getByRole('button', { name: 'Arrange', exact: true })
    await expect(arrange).toBeVisible()
    await arrange.click()
    await expect(page.getByRole('heading', { name: 'Arrange book' })).toBeVisible()

    await expect(page.locator('.arrangement-tree [tabindex="0"]')).toHaveCount(1)
    await expect(page.locator('.arrangement-node-actions button:not([tabindex="-1"])')).toHaveCount(
      0
    )
    const two = page.getByRole('treeitem', { name: 'Two, chapter entry' })
    await two.focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect
      .poll(() => page.locator('.arrangement-label .arrangement-title').allTextContents())
      .toEqual(['Two', 'One', 'Three'])
    await expect(page.getByText('Two: up completed.', { exact: true })).toBeAttached()
    await expect(two).toBeFocused()
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(() => page.locator('.arrangement-label .arrangement-title').allTextContents())
      .toEqual(['One', 'Two', 'Three'])
    await expect(two).toBeFocused()

    await page.evaluate(() => {
      const source = document
        .querySelector<HTMLElement>('[aria-label="Two, chapter entry"]')
        ?.closest<HTMLElement>('.arrangement-node')
      if (!source) throw new Error('Arrangement drag source was unavailable.')
      const transfer = new DataTransfer()
      ;(
        window as typeof window & { __leafbookDragTransfer?: DataTransfer }
      ).__leafbookDragTransfer = transfer
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    })
    await page.evaluate(() => {
      const source = document
        .querySelector<HTMLElement>('[aria-label="Two, chapter entry"]')
        ?.closest<HTMLElement>('.arrangement-node')
      const target = document
        .querySelector<HTMLElement>('[aria-label="One, chapter entry"]')
        ?.closest<HTMLElement>('.arrangement-node')
      const transfer = (window as typeof window & { __leafbookDragTransfer?: DataTransfer })
        .__leafbookDragTransfer
      if (!source || !target || !transfer) {
        throw new Error('Arrangement drag endpoints were unavailable.')
      }
      for (const type of ['dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientY: target.getBoundingClientRect().top + 1
          })
        )
      }
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
      delete (window as typeof window & { __leafbookDragTransfer?: DataTransfer })
        .__leafbookDragTransfer
    })
    await expect
      .poll(() => page.locator('.arrangement-label .arrangement-title').allTextContents())
      .toEqual(['Two', 'One', 'Three'])
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(() => page.locator('.arrangement-label .arrangement-title').allTextContents())
      .toEqual(['One', 'Two', 'Three'])

    await page.getByRole('button', { name: 'Move Two up' }).click()
    await page.getByRole('button', { name: 'Save contents' }).click()
    await expect(page.getByRole('heading', { name: 'Arrange book' })).toHaveCount(0)
    await expect
      .poll(async () => {
        const saved = await fs.readFile(summaryPath, 'utf8')
        const twoIndex = saved.indexOf('- [Two](two.md)')
        const oneIndex = saved.indexOf('- [One](one.md)')
        const threeIndex = saved.indexOf('- [Three](three.md)')
        return twoIndex >= 0 && twoIndex < oneIndex && oneIndex < threeIndex
      })
      .toBe(true)
    await expect(page.locator('.leafbook-markdown')).toContainText('First chapter.')

    const savedSummary = await fs.readFile(summaryPath, 'utf8')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(650, 800)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(650)
    await arrange.click()
    await page.getByRole('button', { name: 'Move Three up' }).click()
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    await page.getByRole('treeitem', { name: 'Three, chapter entry' }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Arrange book' })).toHaveCount(0)
    expect(await fs.readFile(summaryPath, 'utf8')).toBe(savedSummary)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('announces a main-rejected arrangement without claiming success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-arrange-reject-'))
  const summaryPath = path.join(root, 'SUMMARY.md')
  const originalSummary =
    '# Summary\n\n- [One](one.md)\n- [Two](two.md)\n \t- [Mixed child](child.md)\n'
  await fs.writeFile(summaryPath, originalSummary)
  await fs.writeFile(path.join(root, 'one.md'), '# One')
  await fs.writeFile(path.join(root, 'two.md'), '# Two')
  await fs.writeFile(path.join(root, 'child.md'), '# Child')

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
    await page.getByRole('button', { name: 'Arrange', exact: true }).click()
    const two = page.getByRole('treeitem', { name: 'Two, chapter entry' })
    await two.focus()
    await page.keyboard.press('Alt+ArrowRight')

    await expect(page.getByRole('alert')).toContainText(
      'Mixed tab and space indentation cannot be reparented.'
    )
    await expect(page.locator('.arrangement-panel .sr-only')).toHaveText(
      'Mixed tab and space indentation cannot be reparented.'
    )
    await expect(page.getByText('Two: indent completed.', { exact: true })).toHaveCount(0)
    await expect(page.getByText('No changes', { exact: true })).toBeVisible()
    expect(await fs.readFile(summaryPath, 'utf8')).toBe(originalSummary)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('keeps nested arrangement keyboard and drag events scoped to their own treeitem row', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-e2e-arrange-nested-'))
  const summaryPath = path.join(root, 'SUMMARY.md')
  const originalSummary =
    '# Summary\n\n## Part\n\n- [Tail](tail.md)\n- [Parent](parent.md)\n  - [Child A](a.md)\n  - [Child B](b.md)\n'
  await fs.writeFile(summaryPath, originalSummary)
  for (const name of ['tail', 'parent', 'a', 'b']) {
    await fs.writeFile(path.join(root, `${name}.md`), `# ${name}`)
  }

  const { app, page } = await launchElectron([], { suppressErrorDialog: true })
  const titles = () => page.locator('.arrangement-label .arrangement-title').allTextContents()
  const drag = async (
    sourceLabel: string,
    targetLabel: string,
    placement: 'before' | 'after'
  ): Promise<void> => {
    await page.evaluate((sourceName) => {
      const source = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
        (element) => element.getAttribute('aria-label') === sourceName
      )
      if (!source) throw new Error('Nested arrangement drag source was unavailable.')
      const transfer = new DataTransfer()
      ;(window as typeof window & { __leafbookNestedDrag?: DataTransfer }).__leafbookNestedDrag =
        transfer
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    }, sourceLabel)
    await page.evaluate(
      ({ sourceName, targetName, dropPlacement }) => {
        const items = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')]
        const source = items.find((element) => element.getAttribute('aria-label') === sourceName)
        const target = items.find((element) => element.getAttribute('aria-label') === targetName)
        const row = target?.querySelector<HTMLElement>(':scope > .arrangement-row')
        const transfer = (window as typeof window & { __leafbookNestedDrag?: DataTransfer })
          .__leafbookNestedDrag
        if (!source || !target || !row || !transfer) {
          throw new Error('Nested arrangement drag target was unavailable.')
        }
        const bounds = row.getBoundingClientRect()
        const clientY = dropPlacement === 'before' ? bounds.top + 1 : bounds.bottom - 1
        for (const type of ['dragover', 'drop']) {
          target.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientY
            })
          )
        }
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
        delete (window as typeof window & { __leafbookNestedDrag?: DataTransfer })
          .__leafbookNestedDrag
      },
      { sourceName: sourceLabel, targetName: targetLabel, dropPlacement: placement }
    )
  }

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
    await page.getByRole('button', { name: 'Arrange', exact: true }).click()
    await expect.poll(titles).toEqual(['Part', 'Tail', 'Parent', 'Child A', 'Child B'])

    const childB = page.getByRole('treeitem', { name: 'Child B, chapter entry' })
    await childB.focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(titles).toEqual(['Part', 'Tail', 'Parent', 'Child B', 'Child A'])
    await expect(page.getByText('1 operations', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(titles).toEqual(['Part', 'Tail', 'Parent', 'Child A', 'Child B'])

    await drag('Child B, chapter entry', 'Child A, chapter entry', 'before')
    await expect.poll(titles).toEqual(['Part', 'Tail', 'Parent', 'Child B', 'Child A'])
    await expect(page.getByText('2 operations', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(titles).toEqual(['Part', 'Tail', 'Parent', 'Child A', 'Child B'])

    await drag('Tail, chapter entry', 'Parent, chapter entry', 'after')
    await expect.poll(titles).toEqual(['Part', 'Parent', 'Child A', 'Child B', 'Tail'])
    await expect(page.getByText('3 operations', { exact: true })).toBeVisible()
    await page.getByRole('treeitem', { name: 'Child A, chapter entry' }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Arrange book' })).toHaveCount(0)
    expect(await fs.readFile(summaryPath, 'utf8')).toBe(originalSummary)

    const arrange = page.getByRole('button', { name: 'Arrange', exact: true })
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await arrange.click()
      await expect(page.getByRole('heading', { name: 'Arrange book' })).toBeVisible()
      await page.getByRole('treeitem', { name: 'Parent, chapter entry' }).focus()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: 'Arrange book' })).toHaveCount(0)
    }
    expect(await fs.readFile(summaryPath, 'utf8')).toBe(originalSummary)
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
