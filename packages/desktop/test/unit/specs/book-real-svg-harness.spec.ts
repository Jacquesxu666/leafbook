import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../..')
const harnessPath = path.join(desktopRoot, 'scripts/run-real-book-svg-harness.mjs')

describe('privacy-safe real-book SVG harness', () => {
  it('keeps its public receipt aggregate-only and cleanup/source checks mandatory', () => {
    const source = fs.readFileSync(harnessPath, 'utf8')
    expect(source).toContain("await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-svg-harness-'))")
    expect(source).toContain('sameSourceSnapshot(after, before)')
    expect(source).toContain('sameManifest(copyManifest, before)')
    expect(source).toContain('left.mtimeNs === right.mtimeNs')
    expect(source).toContain('left.ctimeNs === right.ctimeNs')
    expect(source).toContain('entries.length > maxEntriesPerDirectory')
    expect(source).toContain('temporaryCopyRemoved: true')
    expect(source).toContain('offlineExportResources: true')
    expect(source).toContain('websiteManifestBound: true')
    expect(source).toContain('preparationDraftIsolation: true')
    expect(source).toContain('manifest?.schemaVersion !== 2')
    expect(source).toContain('data:image\\/svg\\+xml;base64,')
    expect(source).toContain('privateDetailsSuppressed: true')
    expect(source).toContain("mode = binding ? 'packaged' : 'source'")
    expect(source).toContain("argument('--audit-receipt')")
    expect(source).toContain("argument('--audit-receipt-sha256')")
    expect(source).not.toContain('digest: before.digest')
    expect(source).not.toContain('count: before.count')
    expect(source).not.toContain('bytes: before.bytes')
    expect(source).not.toContain('console.')
    expect(source).not.toMatch(/JSON\.stringify\([^)]*(?:relative|absolute|root|markdown)/u)
  })

  it('rejects a broad source root without disclosing its path', () => {
    const child = spawnSync(process.execPath, [harnessPath, '--book-path', os.homedir()], {
      cwd: desktopRoot,
      encoding: 'utf8'
    })
    expect(child.status).toBe(1)
    expect(child.stdout).toBe(
      '{"status":"fail","schema":2,"mode":"source","privateDetailsSuppressed":true}\n'
    )
    expect(child.stderr).toBe('')
    expect(child.stdout).not.toContain(os.homedir())
  })

  it('does not permit packaged mode without an explicit audit receipt binding', () => {
    const child = spawnSync(
      process.execPath,
      [harnessPath, '--book-path', os.homedir(), '--executable', '/tmp/not-a-package'],
      { cwd: desktopRoot, encoding: 'utf8' }
    )
    expect(child.status).toBe(1)
    expect(child.stdout).toBe(
      '{"status":"fail","schema":2,"mode":"packaged","privateDetailsSuppressed":true}\n'
    )
    expect(child.stderr).toBe('')
  })

  it('rejects an empty-directory fanout attack before Electron launch', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-empty-fanout-test-'))
    const book = path.join(temporary, 'book')
    fs.mkdirSync(book)
    try {
      for (let index = 0; index < 2_049; index++) {
        fs.mkdirSync(path.join(book, `d-${String(index).padStart(4, '0')}`))
      }
      const child = spawnSync(process.execPath, [harnessPath, '--book-path', book], {
        cwd: desktopRoot,
        encoding: 'utf8'
      })
      expect(child.status).toBe(1)
      expect(child.stdout).toBe(
        '{"status":"fail","schema":2,"mode":"source","privateDetailsSuppressed":true}\n'
      )
      expect(child.stderr).toBe('')
      expect(child.stdout).not.toContain(book)
    } finally {
      fs.rmSync(temporary, { recursive: true })
    }
  })
})
