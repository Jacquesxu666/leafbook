/* eslint-disable @stylistic/space-before-function-paren */
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error The release receipt is an executable ESM script without declarations.
import * as receiptModule from '../../../../../scripts/mac-audit-receipt.mjs'
// @ts-expect-error The production harness is an executable ESM script without declarations.
import { verifyPackagedBinding } from '../../../scripts/run-real-book-svg-harness.mjs'

const { buildReceipt, verifyReceipt, writeReceipt } = receiptModule
const repositoryRoot = path.resolve(__dirname, '../../../../..')
const snapshotScript = path.join(repositoryRoot, 'scripts/package-private-snapshot.mjs')
const temporaryRoots: string[] = []

const makeTemporary = async (): Promise<string> => {
  const created = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'leafbook-security-test-'))
  const canonical = await fsPromises.realpath(created)
  temporaryRoots.push(canonical)
  return canonical
}

const makeBundle = async (root: string): Promise<{ distRoot: string; appRelative: string }> => {
  const distRoot = path.join(root, 'dist')
  const appRelative = 'mac-arm64/LeafBook.app'
  const app = path.join(distRoot, appRelative)
  await fsPromises.mkdir(path.join(app, 'Contents/MacOS'), { recursive: true })
  await fsPromises.mkdir(path.join(app, 'Contents/Resources/licenses'), { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jacquesxu.leafbook</string>
<key>CFBundleDisplayName</key><string>LeafBook</string>
<key>CFBundleExecutable</key><string>LeafBook</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
</dict></plist>`
  const executable = Buffer.alloc(32)
  executable.writeUInt32BE(0xfeedfacf, 0)
  executable.writeUInt32BE(0x0100000c, 4)
  await Promise.all([
    fsPromises.writeFile(path.join(app, 'Contents/Info.plist'), plist),
    fsPromises.writeFile(path.join(app, 'Contents/MacOS/LeafBook'), executable, {
      mode: 0o755
    }),
    fsPromises.writeFile(path.join(app, 'Contents/Resources/app.asar'), 'aaaa'),
    ...['LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.txt'].map((name) =>
      fsPromises.writeFile(path.join(app, 'Contents/Resources/licenses', name), name)
    )
  ])
  return { distRoot, appRelative }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporary) => fsPromises.rm(temporary, { recursive: true, force: true }))
  )
})

describe('macOS package adversarial bindings', () => {
  it('keeps receipt snapshot fault injection module-only and import-safe', () => {
    const modulePath = path.join(repositoryRoot, 'scripts/mac-audit-receipt.mjs')
    const source = fs.readFileSync(modulePath, 'utf8')
    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'await import(process.argv[2])',
        'receipt-import-probe',
        modulePath
      ],
      { encoding: 'utf8' }
    )

    expect(imported.status, imported.stderr).toBe(0)
    expect(imported.stdout).toBe('')
    expect(imported.stderr).toBe('')
    expect(source).toContain('export const collectBundleTree')
    expect(source).toContain('{ onSnapshotFile, onStableReadChunk } = {}')
    expect(source).not.toContain('process.env')
    expect(source).toContain('argv.length !== 3')
    expect(source).toContain('path.resolve(process.argv[1]) === modulePath')
  })

  it('rejects a same-size app write after receipt creation', async () => {
    const fixture = await makeBundle(await makeTemporary())
    await writeReceipt({ ...fixture, architecture: 'arm64', version: '0.1.0' })
    await fsPromises.writeFile(
      path.join(fixture.distRoot, fixture.appRelative, 'Contents/Resources/app.asar'),
      'bbbb'
    )
    await expect(
      verifyReceipt({ ...fixture, architecture: 'arm64', version: '0.1.0' })
    ).rejects.toThrow(/stale|content tree/u)
  })

  it('rejects an identical receipt inode replacement between packaged checks', async () => {
    const fixture = await makeBundle(await makeTemporary())
    const receiptPath = await writeReceipt({
      ...fixture,
      architecture: 'arm64',
      version: '0.1.0'
    })
    const bytes = await fsPromises.readFile(receiptPath)
    const receipt = JSON.parse(bytes.toString('utf8'))
    const binding = {
      receiptPath,
      expectedHash: createHash('sha256').update(bytes).digest('hex'),
      distRoot: fixture.distRoot,
      executableArgument: path.join(
        fixture.distRoot,
        fixture.appRelative,
        'Contents/MacOS/LeafBook'
      )
    }
    const baseline = await verifyPackagedBinding(binding)
    const replacement = `${receiptPath}.${randomBytes(8).toString('hex')}`
    await fsPromises.writeFile(replacement, bytes, { flag: 'wx', mode: 0o600 })
    await fsPromises.rename(replacement, receiptPath)
    expect(receipt.schema).toBeTruthy()
    await expect(verifyPackagedBinding(binding, baseline)).rejects.toThrow(/binding-changed/u)
  })

  it('rejects an identical Electron archive inode replacement', async () => {
    const root = await makeTemporary()
    const source = path.join(root, 'electron-v1.2.3-darwin-arm64.zip')
    const destination = path.join(root, 'copy.zip')
    const state = path.join(root, 'state.json')
    const bytes = Buffer.from('archive fixture')
    await fsPromises.writeFile(source, bytes)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const copied = spawnSync(
      process.execPath,
      [
        snapshotScript,
        'archive-copy',
        source,
        destination,
        path.basename(source),
        digest,
        '1.2.3',
        'arm64',
        state
      ],
      { encoding: 'utf8' }
    )
    expect(copied.status, copied.stderr).toBe(0)
    const stateHash = copied.stdout.trim()
    const replacement = path.join(root, 'replacement.zip')
    await fsPromises.writeFile(replacement, bytes)
    await fsPromises.rename(replacement, destination)
    const verified = spawnSync(
      process.execPath,
      [snapshotScript, 'archive-verify', state, stateHash],
      { encoding: 'utf8' }
    )
    expect(verified.status).not.toBe(0)
  })

  it('rejects a same-content carrier app file replacement', async () => {
    const root = await makeTemporary()
    const fixture = await makeBundle(root)
    const destination = path.join(root, 'private/app-snapshot/LeafBook.app')
    const state = path.join(root, 'private/state.json')
    const copied = spawnSync(
      process.execPath,
      [
        snapshotScript,
        'app-copy',
        fixture.distRoot,
        fixture.appRelative,
        'arm64',
        '0.1.0',
        destination,
        state
      ],
      { encoding: 'utf8' }
    )
    expect(copied.status, copied.stderr).toBe(0)
    const stateHash = copied.stdout.trim()
    const target = path.join(destination, 'Contents/Resources/app.asar')
    const replacement = path.join(path.dirname(target), '.app.asar-replacement')
    await fsPromises.copyFile(target, replacement)
    await fsPromises.rename(replacement, target)
    const verified = spawnSync(process.execPath, [snapshotScript, 'app-verify', state, stateHash], {
      encoding: 'utf8'
    })
    expect(verified.status).not.toBe(0)
  })

  it('rejects a same-size write after the first stable-read chunk', async () => {
    const fixture = await makeBundle(await makeTemporary())
    const target = path.join(fixture.distRoot, fixture.appRelative, 'Contents/Resources/app.asar')
    const replacement = Buffer.alloc(16 * 1024, 0x62)
    await fsPromises.writeFile(target, Buffer.alloc(replacement.byteLength, 0x61))
    let mutationCount = 0

    await expect(
      buildReceipt(
        { ...fixture, architecture: 'arm64', version: '0.1.0' },
        {
          onStableReadChunk: async (passIndex: number, relativePath: string, bytesRead: number) => {
            if (
              mutationCount === 0 &&
              passIndex === 1 &&
              relativePath === 'Contents/Resources/app.asar' &&
              bytesRead > 0
            ) {
              const descriptor = await fsPromises.open(target, 'r+')
              try {
                await descriptor.write(replacement, 0, replacement.byteLength, 0)
                await descriptor.sync()
              } finally {
                await descriptor.close()
              }
              mutationCount += 1
            }
          }
        }
      )
    ).rejects.toThrow(/regular file changed during receipt hashing/u)
    expect(mutationCount).toBe(1)
    await expect(fsPromises.readFile(target)).resolves.toEqual(replacement)
  })

  it('rejects a persistent AA-target write hidden behind a slow final file', async () => {
    const fixture = await makeBundle(await makeTemporary())
    const resources = path.join(fixture.distRoot, fixture.appRelative, 'Contents/Resources')
    const target = path.join(resources, 'AA-target.dat')
    await fsPromises.writeFile(target, 'before')
    await fsPromises.writeFile(path.join(resources, 'zz-slow.dat'), Buffer.alloc(128 * 1024 * 1024))
    let mutationCount = 0
    await expect(
      buildReceipt(
        { ...fixture, architecture: 'arm64', version: '0.1.0' },
        {
          onSnapshotFile: async (passIndex: number, relativePath: string) => {
            if (passIndex === 1 && relativePath === 'Contents/Resources/AA-target.dat') {
              await fsPromises.writeFile(target, 'after!')
              mutationCount += 1
            }
          }
        }
      )
    ).rejects.toThrow(/complete receipt snapshots|terminal full-tree|changed/u)
    expect(mutationCount).toBe(1)
    await expect(fsPromises.readFile(target, 'utf8')).resolves.toBe('after!')
  })

  it('rejects a copied-token private-root replacement inode', async () => {
    const rootCreated = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'leafbook-package-cleanup-test-')
    )
    const root = await fsPromises.realpath(rootCreated)
    const token = randomBytes(32).toString('hex')
    const marker = path.join(root, '.leafbook-package-owner')
    const state = path.join(await makeTemporary(), 'root-state.json')
    await fsPromises.chmod(root, 0o700)
    await fsPromises.writeFile(marker, token, { flag: 'wx', mode: 0o600 })
    const created = spawnSync(
      process.execPath,
      [snapshotScript, 'root-state-create', root, token, state],
      { encoding: 'utf8' }
    )
    expect(created.status, created.stderr).toBe(0)
    const [stateHash, dev, ino, uid, mode] = created.stdout.trim().split('\t')
    const original = `${root}.original`
    await fsPromises.rename(root, original)
    await fsPromises.mkdir(root, { mode: 0o700 })
    await fsPromises.writeFile(path.join(root, '.leafbook-package-owner'), token, {
      mode: 0o600
    })
    const cleaned = spawnSync(
      process.execPath,
      [snapshotScript, 'cleanup', root, token, dev, ino, uid, mode, state, stateHash],
      { encoding: 'utf8' }
    )
    expect(cleaned.status).not.toBe(0)
    expect(fs.existsSync(root)).toBe(true)
    await fsPromises.rm(root, { recursive: true })
    await fsPromises.rm(original, { recursive: true })
  })

  it('uses identity-bound private roots in both macOS audit scripts', () => {
    for (const relative of ['scripts/audit-mac-artifact.sh', 'scripts/audit-mac-unpacked.sh']) {
      const source = fs.readFileSync(path.join(repositoryRoot, relative), 'utf8')
      expect(source).toContain('source "$repository_root/scripts/private-root.sh"')
      expect(source).toContain('leafbook_private_root_create')
      expect(source).toContain('leafbook_private_root_cleanup')
      expect(source).not.toMatch(/trap ['"][^'"]*rm -rf/u)
    }
  })
})
