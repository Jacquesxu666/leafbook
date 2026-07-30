import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../../../..')
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 8D static release gate', () => {
  const runReceipt = (mode: 'writeReceipt' | 'verifyReceipt', options: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'const module = await import(process.argv[1]); await module[process.argv[2]](JSON.parse(process.argv[3]));',
        pathToFileURL(path.join(root, 'scripts/mac-audit-receipt.mjs')).href,
        mode,
        JSON.stringify(options)
      ],
      { cwd: root, encoding: 'utf8' }
    )

  it('keeps LeafBook package identity separate from MarkText', () => {
    const desktop = JSON.parse(read('packages/desktop/package.json')) as {
      name: string
      description: string
    }
    const builder = read('packages/desktop/electron-builder.yml')
    const main = read('packages/desktop/src/main/index.ts')
    expect(desktop.name).toBe('leafbook')
    expect(desktop.description).toContain('LeafBook')
    expect(builder).toContain('appId: com.jacquesxu.leafbook')
    expect(builder).toContain('productName: LeafBook')
    expect(main).toContain("app.setPath('userData', path.join(app.getPath('appData'), APP_SLUG))")
  })

  it('pins the local package command to no publish, signing, or notarization', () => {
    const script = read('scripts/package-mac-unsigned-dir.sh')
    expect(script).toContain('--publish')
    expect(script).toContain('never')
    expect(script).toContain('-c.mac.identity=null')
    expect(script).toContain('-c.mac.notarize=false')
    expect(script).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false')
    expect(script).not.toMatch(/\b(tag|notarytool|release create)\b/)
  })

  it('documents incomplete external evidence as release blockers', () => {
    const gate = read('docs/RELEASE_GATE.md')
    for (const blocker of [
      'real Windows and Linux',
      'notarization',
      'SBOM',
      'provenance',
      'explicit human approval'
    ]) {
      expect(gate).toContain(blocker)
    }
    expect(gate).toContain('unsigned and unnotarized')
    expect(gate).toContain('P3')
  })

  it('describes the generated dependency inventory without claiming SBOM completeness', () => {
    const notices = read('packages/desktop/build/THIRD-PARTY-LICENSES.txt')
    expect(notices).toContain('generated production dependency license inventory')
    expect(notices).toContain('not an SBOM')
    expect(notices).toContain('multiple versions are intentionally preserved')
    expect(notices).not.toContain('all third-party packages that are bundled')
  })

  it('fails closed when packaged smoke collection contains fewer than six tests', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-smoke-list-'))
    const fixture = path.join(temporary, 'playwright-list.txt')
    try {
      fs.writeFileSync(
        fixture,
        [
          'Listing tests:',
          '  [electron] › renderer-security.spec.ts:1:1 › opening untrusted Markdown stays offline, renders local images, and does not execute HTML',
          'Total: 5 tests in 2 files',
          ''
        ].join('\n')
      )
      const result = spawnSync('bash', ['scripts/smoke-mac-unpacked.sh', '--check-list', fixture], {
        cwd: root,
        encoding: 'utf8'
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('must resolve to exactly six tests')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('accepts a clean tree and rejects updater names for files, symlinks, and directories', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-updater-audit-'))
    const resources = path.join(temporary, 'LeafBook.app', 'Contents', 'Resources')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-updater-outside-'))
    fs.mkdirSync(resources, { recursive: true })
    const runAudit = () =>
      spawnSync('bash', ['scripts/check-no-updater-files.sh', temporary], {
        cwd: root,
        encoding: 'utf8'
      })
    try {
      expect(runAudit().status).toBe(0)
      const updater = path.join(resources, 'app-update.yml')
      fs.writeFileSync(updater, 'provider: github\n')
      expect(runAudit().status).not.toBe(0)
      fs.rmSync(updater)

      const symlinkTarget =
        process.platform === 'win32' ? outside : path.join(outside, 'innocent-target')
      if (process.platform !== 'win32') fs.writeFileSync(symlinkTarget, 'not updater metadata\n')
      fs.symlinkSync(symlinkTarget, updater, process.platform === 'win32' ? 'junction' : 'file')
      const symlinkRejected = runAudit()
      expect(symlinkRejected.status).not.toBe(0)
      expect(symlinkRejected.stderr).toContain('app-update.yml')
      fs.unlinkSync(updater)

      fs.mkdirSync(path.join(resources, 'pending-update.yml'))
      expect(runAudit().status).not.toBe(0)
      fs.rmSync(path.join(resources, 'pending-update.yml'), { recursive: true })

      const uppercase = path.join(resources, 'APP-UPDATE.YML')
      fs.symlinkSync(symlinkTarget, uppercase, process.platform === 'win32' ? 'junction' : 'file')
      const uppercaseRejected = runAudit()
      expect(uppercaseRejected.status).not.toBe(0)
      expect(uppercaseRejected.stderr).toContain('APP-UPDATE.YML')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it.each([
    '/resources/app-update.yml',
    '/nested/APP-UPDATE.YML',
    '/nested/dev-app-update.yml',
    '/nested/latest-mac.yml',
    '/nested/runtime.BLOCKMAP',
    '/nested/pending.yml',
    '/nested/PENDING-UPDATE.YML',
    '/node_modules/electron-updater/index.js'
  ])('rejects updater runtime or basename in an ASAR listing: %s', (entry) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-asar-listing-'))
    const listing = path.join(temporary, 'asar-list.txt')
    try {
      fs.writeFileSync(listing, `/package.json\n${entry}\n`)
      const result = spawnSync('bash', ['scripts/check-asar-listing-no-updater.sh', listing], {
        cwd: root,
        encoding: 'utf8'
      })
      expect(result.status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('binds packaged smoke to an exact canonical audited app and rejects swaps or stale receipts', () => {
    if (process.platform === 'win32') return
    const temporary = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'leafbook-receipt-test-')
    )
    const distRoot = path.join(temporary, 'dist')
    const appRelative = path.join('mac-arm64', 'LeafBook.app')
    const app = path.join(distRoot, appRelative)
    const files: Record<string, string> = {
      'Contents/MacOS/LeafBook': '#!/bin/sh\nexit 0\n',
      'Contents/Resources/app.asar': 'asar bytes',
      'Contents/Info.plist': '<plist>LeafBook</plist>',
      'Contents/Resources/licenses/LICENSE': 'MIT',
      'Contents/Resources/licenses/NOTICE': 'notice',
      'Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt': 'inventory',
      'Contents/Resources/app.asar.unpacked/native.node': 'native addon',
      'Contents/Frameworks/LeafBook Helper.app/Contents/MacOS/LeafBook Helper': 'helper executable',
      'Contents/Frameworks/Runtime.framework/Versions/A/Runtime': 'framework A',
      'Contents/Frameworks/Runtime.framework/Versions/B/Runtime': 'framework B'
    }
    const options = { distRoot, appRelative, architecture: 'arm64', version: '0.1.0' }
    try {
      for (const [relative, body] of Object.entries(files)) {
        const target = path.join(app, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, body)
      }
      fs.chmodSync(path.join(app, 'Contents/MacOS/LeafBook'), 0o700)
      fs.symlinkSync('Versions/A', path.join(app, 'Contents/Frameworks/Runtime.framework/Current'))
      const initialWrite = runReceipt('writeReceipt', options)
      expect(initialWrite.status, initialWrite.stderr).toBe(0)
      const initialVerify = runReceipt('verifyReceipt', options)
      expect(initialVerify.status, initialVerify.stderr).toBe(0)

      const executable = path.join(app, 'Contents/MacOS/LeafBook')
      fs.appendFileSync(executable, '# swapped\n')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)

      fs.writeFileSync(executable, files['Contents/MacOS/LeafBook'], { mode: 0o700 })
      expect(runReceipt('writeReceipt', options).status).toBe(0)

      const unbound = path.join(app, 'Contents/Resources/unbound-resource.dat')
      fs.writeFileSync(unbound, 'not in receipt')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.rmSync(unbound)

      const fifo = path.join(app, 'Contents/Resources/forbidden-fifo')
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.rmSync(fifo)

      const notice = path.join(app, 'Contents/Resources/licenses/NOTICE')
      fs.rmSync(notice)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.writeFileSync(notice, files['Contents/Resources/licenses/NOTICE'])

      const unpacked = path.join(app, 'Contents/Resources/app.asar.unpacked/native.node')
      fs.appendFileSync(unpacked, ' mutation')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.writeFileSync(unpacked, files['Contents/Resources/app.asar.unpacked/native.node'])

      const helper = path.join(
        app,
        'Contents/Frameworks/LeafBook Helper.app/Contents/MacOS/LeafBook Helper'
      )
      fs.appendFileSync(helper, ' mutation')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.writeFileSync(
        helper,
        files['Contents/Frameworks/LeafBook Helper.app/Contents/MacOS/LeafBook Helper']
      )

      const currentFramework = path.join(app, 'Contents/Frameworks/Runtime.framework/Current')
      fs.rmSync(currentFramework)
      fs.symlinkSync('Versions/B', currentFramework)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.rmSync(currentFramework)
      fs.symlinkSync('Versions/A', currentFramework)
      expect(runReceipt('verifyReceipt', options).status).toBe(0)

      const outsideWrapper = path.join(temporary, 'wrapper')
      fs.writeFileSync(outsideWrapper, '#!/bin/sh\n', { mode: 0o700 })
      fs.rmSync(executable)
      fs.symlinkSync(outsideWrapper, executable)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)

      fs.rmSync(executable)
      fs.writeFileSync(executable, files['Contents/MacOS/LeafBook'], { mode: 0o700 })
      expect(runReceipt('writeReceipt', options).status).toBe(0)
      const movedApp = `${app}.swapped`
      fs.renameSync(app, movedApp)
      fs.symlinkSync(movedApp, app, 'dir')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('rejects symlink, FIFO, and device nodes as release artifact paths', () => {
    if (process.platform === 'win32') return
    const temporary = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'leafbook-safe-artifact-test-')
    )
    const regular = path.join(temporary, 'artifact.zip')
    const symlink = path.join(temporary, 'symlink.zip')
    const fifo = path.join(temporary, 'fifo.zip')
    const check = (kind: string, target: string, containment = temporary) =>
      spawnSync('bash', ['scripts/check-safe-artifact-path.sh', kind, target, containment], {
        cwd: root,
        encoding: 'utf8'
      })
    try {
      fs.writeFileSync(regular, 'artifact')
      expect(check('regular', regular).status).toBe(0)
      fs.symlinkSync(regular, symlink)
      expect(check('regular', symlink).status).not.toBe(0)
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0)
      expect(check('regular', fifo).status).not.toBe(0)
      expect(check('regular', '/dev/null', '/dev').status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
