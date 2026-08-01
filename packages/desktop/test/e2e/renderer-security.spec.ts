/* eslint-disable @stylistic/space-before-function-paren */
import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { clickMenuById, expectNoRendererErrors, launchElectron, waitForEditor } from './helpers'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nF8AAAAASUVORK5CYII=',
  'base64'
)

test('opening untrusted Markdown stays offline, renders local images, and does not execute HTML', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-renderer-security-'))
  const localImage = path.join(root, 'local.png')
  const markdown = path.join(root, 'untrusted.md')
  await fs.writeFile(localImage, ONE_PIXEL_PNG)

  let networkHits = 0
  const server = http.createServer((_request, response) => {
    networkHits += 1
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(ONE_PIXEL_PNG)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.')

  await fs.writeFile(
    markdown,
    `# Renderer security

![local](local.png)
![remote](http://127.0.0.1:${address.port}/remote.png)

\`\`\`plantuml
@startuml
Alice -> Bob
@enduml
\`\`\`

<img src="x" onerror="document.body.dataset.leafbookXss='executed'">
<script>document.body.dataset.leafbookScript='executed'</script>
`
  )

  const { app, page } = await launchElectron([markdown], { suppressErrorDialog: true })
  try {
    await waitForEditor(page)
    await expect(page.locator('.mu-image-success img[src^="file:"]')).toHaveCount(1, {
      timeout: 15000
    })
    await expect(page.getByText('PlantUML preview is disabled in offline mode.')).toBeVisible()
    await page.waitForTimeout(500)

    const securityState = await page.evaluate(() => ({
      xss: document.body.dataset.leafbookXss ?? null,
      script: document.body.dataset.leafbookScript ?? null,
      remoteImages: [...document.images].filter((image) =>
        /^https?:/i.test(image.getAttribute('src') ?? '')
      ).length
    }))
    expect(securityState).toEqual({ xss: null, script: null, remoteImages: 0 })
    expect(networkHits).toBe(0)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Reader keeps local and remote images as inert placeholders without filesystem or network loads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-reader-security-'))
  const imageName = '空 格#图片.png'
  await fs.writeFile(path.join(root, imageName), ONE_PIXEL_PNG)

  let networkHits = 0
  const server = http.createServer((_request, response) => {
    networkHits += 1
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(ONE_PIXEL_PNG)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.')

  await fs.writeFile(path.join(root, 'SUMMARY.md'), '- [安全章节](chapter.md)\n')
  await fs.writeFile(
    path.join(root, 'chapter.md'),
    `# 安全章节

![本地图](%E7%A9%BA%20%E6%A0%BC%23%E5%9B%BE%E7%89%87.png)
![远程图](http://127.0.0.1:${address.port}/remote.png)
`
  )

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
    await expect(page.locator('.leafbook-media-placeholder')).toHaveCount(2)
    await expect(page.locator('.leafbook-markdown img')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(networkHits).toBe(0)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await fs.rm(root, { recursive: true, force: true })
  }
})
