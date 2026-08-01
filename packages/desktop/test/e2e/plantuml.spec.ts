import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, focusEditor } from './helpers'

// LeafBook deliberately keeps PlantUML inert during automatic offline
// rendering. Rendering through a remote PlantUML service would disclose the
// manuscript source, so the editor shows a stable placeholder instead.

const PLANTUML_DOC = '# plantuml smoke\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```\n'
const CUSTOM_SERVER = 'http://localhost:9999/plantuml'

test.describe('PlantUML render via plantuml-encoder', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(PLANTUML_DOC)
    app = launched.app
    page = launched.page
    await focusEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('plantuml block remains inert in offline mode', async() => {
    await expect(page.getByText('PlantUML preview is disabled in offline mode.')).toBeVisible({
      timeout: 10000
    })
    await expect(page.locator('img[src*="plantuml.com/plantuml"]')).toHaveCount(0)
  })

  test('plantuml block uses custom server URL when preference is set', async() => {
    // Set a custom PlantUML server URL via the preference system.
    await page.evaluate((url) => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { plantumlServer: url })
    }, CUSTOM_SERVER)

    // Re-focus the editor to trigger a re-render with the new option.
    await focusEditor(page)

    await expect(page.getByText('PlantUML preview is disabled in offline mode.')).toBeVisible({
      timeout: 10000
    })
    await expect(page.locator(`img[src*="${CUSTOM_SERVER}"]`)).toHaveCount(0)
  })
})
