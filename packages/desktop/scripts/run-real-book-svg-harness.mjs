import { createHash, createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { buildReceipt, RECEIPT_SCHEMA } from '../../../scripts/mac-audit-receipt.mjs'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const maxDepth = 64
const maxEntries = 10_000
const maxEntriesPerDirectory = 2_048
const maxFileBytes = 64 * 1024 * 1024
const maxTotalBytes = 512 * 1024 * 1024
const fixtureSuffix = randomBytes(12).toString('hex')
const safeName = `.leafbook-safe-${fixtureSuffix}.svg`
const maliciousName = `.leafbook-malicious-${fixtureSuffix}.svg`
const cleanupMarkerName = '.leafbook-svg-harness-owner'
let diagnosticStage = 'startup'

const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const asciiCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const sameStableStat = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const stableStatRecord = (relative, type, stat) => ({
  relative,
  type,
  dev: String(stat.dev),
  ino: String(stat.ino),
  mode: String(stat.mode),
  nlink: String(stat.nlink),
  size: String(stat.size),
  mtimeNs: String(stat.mtimeNs),
  ctimeNs: String(stat.ctimeNs)
})

const digestRecords = (records) => {
  const hash = createHash('sha256')
  for (const record of records) {
    for (const value of Object.values(record)) {
      hash.update(String(value))
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}

const readStableFile = async (absolute) => {
  const handle = await fs.open(
    absolute,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  )
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maxFileBytes)) {
      throw new Error('source-file-policy')
    }
    const bytes = await handle.readFile()
    const [after, pathname] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(absolute, { bigint: true })
    ])
    if (
      !after.isFile() ||
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      !sameStableStat(after, before) ||
      !sameStableStat(pathname, before) ||
      BigInt(bytes.byteLength) !== before.size
    ) {
      throw new Error('source-file-changed')
    }
    return { bytes, stat: before }
  } finally {
    await handle.close()
  }
}

const inspectBook = async (root, copyRoot = null) => {
  const records = []
  const identityRecords = []
  const inodes = new Set()
  let entryCount = 0
  let bytes = 0
  const walk = async (directory, relativeDirectory, depth) => {
    if (depth > maxDepth) throw new Error('source-depth')
    const beforeDirectory = await fs.lstat(directory, { bigint: true })
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink()) {
      throw new Error('source-directory-policy')
    }
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      asciiCompare(left.name, right.name)
    )
    if (entries.length > maxEntriesPerDirectory) throw new Error('source-directory-budget')
    for (const entry of entries) {
      entryCount += 1
      if (entryCount > maxEntries) throw new Error('source-entry-budget')
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name
      const absolute = path.join(directory, entry.name)
      const pathname = await fs.lstat(absolute, { bigint: true })
      if (pathname.isSymbolicLink()) throw new Error('source-link')
      if (pathname.isDirectory()) {
        if (copyRoot) await fs.mkdir(path.join(copyRoot, relative), { mode: 0o700 })
        records.push({ relative, type: 'directory', size: 0, digest: '' })
        await walk(absolute, relative, depth + 1)
        continue
      }
      if (!pathname.isFile()) throw new Error('source-special')
      const inode = `${pathname.dev}:${pathname.ino}`
      if (pathname.nlink !== 1n || inodes.has(inode)) throw new Error('source-hardlink')
      inodes.add(inode)
      const stable = await readStableFile(absolute)
      if (!sameStableStat(stable.stat, pathname)) throw new Error('source-file-changed')
      identityRecords.push(stableStatRecord(relative, 'file', stable.stat))
      bytes += stable.bytes.byteLength
      if (bytes > maxTotalBytes) throw new Error('source-budget')
      const digest = createHash('sha256').update(stable.bytes).digest('hex')
      records.push({ relative, type: 'file', size: stable.bytes.byteLength, digest })
      if (copyRoot) {
        await fs.writeFile(path.join(copyRoot, relative), stable.bytes, {
          flag: 'wx',
          mode: 0o600
        })
      }
    }
    const afterDirectory = await fs.lstat(directory, { bigint: true })
    if (!sameStableStat(afterDirectory, beforeDirectory)) {
      throw new Error('source-directory-changed')
    }
    identityRecords.push(stableStatRecord(relativeDirectory || '.', 'directory', afterDirectory))
  }
  await walk(root, '', 0)
  const hash = createHash('sha256')
  for (const record of records) {
    hash.update(record.type)
    hash.update('\0')
    hash.update(record.relative)
    hash.update('\0')
    hash.update(String(record.size))
    hash.update('\0')
    hash.update(record.digest)
    hash.update('\0')
  }
  identityRecords.sort((left, right) => asciiCompare(left.relative, right.relative))
  return {
    digest: hash.digest('hex'),
    identityDigest: digestRecords(identityRecords),
    count: records.length,
    bytes,
    records
  }
}

const validateSourcePath = async (requested) => {
  if (!requested || !path.isAbsolute(requested)) throw new Error('source-argument')
  const [sourcePath, home, temporary] = await Promise.all([
    fs.realpath(requested),
    fs.realpath(os.homedir()),
    fs.realpath(os.tmpdir())
  ])
  const stat = await fs.lstat(sourcePath, { bigint: true })
  if (
    sourcePath === home ||
    sourcePath === temporary ||
    sourcePath === path.parse(sourcePath).root ||
    (!stat.isDirectory() && !stat.isFile()) ||
    stat.isSymbolicLink() ||
    (stat.isFile() && stat.nlink !== 1n) ||
    ('uid' in stat && typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))
  ) {
    throw new Error('source-root-policy')
  }
  return {
    sourcePath,
    kind: stat.isDirectory() ? 'directory' : 'file',
    identity: stat
  }
}

const inspectSource = async (source, copyRoot = null) => {
  if (source.kind === 'directory') return inspectBook(source.sourcePath, copyRoot)
  const stable = await readStableFile(source.sourcePath)
  const relative = path.basename(source.sourcePath)
  const fileDigest = createHash('sha256').update(stable.bytes).digest('hex')
  const hash = createHash('sha256')
  hash.update('file\0')
  hash.update(relative)
  hash.update('\0')
  hash.update(String(stable.bytes.byteLength))
  hash.update('\0')
  hash.update(fileDigest)
  hash.update('\0')
  if (copyRoot) {
    await fs.writeFile(path.join(copyRoot, relative), stable.bytes, {
      flag: 'wx',
      mode: 0o600
    })
  }
  return {
    digest: hash.digest('hex'),
    identityDigest: digestRecords([stableStatRecord(relative, 'file', stable.stat)]),
    count: 1,
    bytes: stable.bytes.byteLength,
    records: [{ relative, type: 'file', size: stable.bytes.byteLength, digest: fileDigest }]
  }
}

const sameManifest = (left, right) =>
  left.digest === right.digest &&
  left.count === right.count &&
  left.bytes === right.bytes &&
  JSON.stringify(left.records) === JSON.stringify(right.records)

const sameSourceSnapshot = (left, right) =>
  sameManifest(left, right) && left.identityDigest === right.identityDigest

const removeTemporary = async (temporary, identity, marker) => {
  const [real, canonicalTemp, stat, markerFile] = await Promise.all([
    fs.realpath(temporary),
    fs.realpath(os.tmpdir()),
    fs.lstat(temporary),
    readStableFile(path.join(temporary, cleanupMarkerName))
  ])
  if (
    real !== temporary ||
    !real.startsWith(path.join(canonicalTemp, 'leafbook-svg-harness-')) ||
    !stat.isDirectory() ||
    stat.dev !== identity.dev ||
    stat.ino !== identity.ino ||
    ('uid' in stat && typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
    !markerFile.bytes.equals(marker)
  ) {
    throw new Error('cleanup-validation')
  }
  await fs.rm(temporary, { recursive: true })
}

export const verifyPackagedBinding = async (binding, baseline = null) => {
  const receiptFile = await readStableFile(binding.receiptPath)
  const actualHash = createHash('sha256').update(receiptFile.bytes).digest('hex')
  if (actualHash !== binding.expectedHash) throw new Error('audit-receipt-hash')
  const actual = JSON.parse(receiptFile.bytes.toString('utf8'))
  if (
    actual?.schema !== RECEIPT_SCHEMA ||
    !['arm64', 'x64'].includes(actual?.architecture) ||
    typeof actual?.identity?.version !== 'string' ||
    typeof actual?.identity?.executable !== 'string' ||
    typeof actual?.bundle?.relativePath !== 'string'
  ) {
    throw new Error('audit-receipt-schema')
  }
  const expected = await buildReceipt({
    distRoot: binding.distRoot,
    appRelative: actual.bundle.relativePath,
    architecture: actual.architecture,
    version: actual.identity.version
  })
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('audit-receipt-stale')
  const executablePath = await fs.realpath(binding.executableArgument)
  const expectedExecutable = path.join(
    binding.distRoot,
    actual.bundle.relativePath,
    'Contents',
    'MacOS',
    actual.identity.executable
  )
  if (executablePath !== expectedExecutable) throw new Error('packaged-executable-identity')
  const executableStat = await fs.lstat(executablePath, { bigint: true })
  if (!executableStat.isFile() || executableStat.isSymbolicLink() || executableStat.nlink !== 1n) {
    throw new Error('packaged-executable-policy')
  }
  if (
    baseline &&
    (!sameStableStat(receiptFile.stat, baseline.receiptStat) ||
      !sameStableStat(executableStat, baseline.executableStat) ||
      JSON.stringify(actual) !== baseline.receiptJson ||
      executablePath !== baseline.executablePath)
  ) {
    throw new Error('packaged-binding-changed')
  }
  return {
    receiptStat: receiptFile.stat,
    executableStat,
    receiptJson: JSON.stringify(actual),
    executablePath,
    artifactAuditDigest: actualHash
  }
}

const packagedBinding = async () => {
  const executableArgument = argument('--executable')
  const receiptArgument = argument('--audit-receipt')
  const expectedHash = argument('--audit-receipt-sha256')
  if (!executableArgument && !receiptArgument && !expectedHash) return null
  if (
    !executableArgument ||
    !receiptArgument ||
    !path.isAbsolute(executableArgument) ||
    !path.isAbsolute(receiptArgument) ||
    !/^[0-9a-f]{64}$/u.test(expectedHash ?? '')
  ) {
    throw new Error('packaged-binding-arguments')
  }
  const receiptPath = await fs.realpath(receiptArgument)
  if (receiptPath !== path.resolve(receiptArgument)) throw new Error('audit-receipt-canonical')
  const auditDirectory = path.dirname(receiptPath)
  if (path.basename(auditDirectory) !== 'audit') throw new Error('audit-receipt-location')
  const distRoot = path.dirname(auditDirectory)
  const binding = {
    executableArgument,
    receiptPath,
    expectedHash,
    distRoot
  }
  return { ...binding, ...(await verifyPackagedBinding(binding)) }
}

const electronExecutable = async () => {
  const relative = (
    await fs.readFile(path.join(desktopRoot, 'node_modules/electron/path.txt'), 'utf8')
  ).trim()
  return path.join(desktopRoot, 'node_modules/electron/dist', relative)
}

const openBook = async (app, copyRoot, htmlOutput, websiteOutput) => {
  await app.evaluate(
    ({ dialog, ipcMain, session }, outputs) => {
      const state = global
      state.__leafbook_svg_harness_network__ = 0
      state.__leafbook_svg_harness_errors__ = 0
      let saveCount = 0
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/i.test(details.url)) state.__leafbook_svg_harness_network__ += 1
        callback({})
      })
      ipcMain.on('mt::handle-renderer-error', () => {
        state.__leafbook_svg_harness_errors__ += 1
      })
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [outputs.copyRoot],
        bookmarks: []
      })
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: saveCount++ === 0 ? outputs.htmlOutput : outputs.websiteOutput
      })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    },
    { copyRoot, htmlOutput, websiteOutput }
  )
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const find = (items) => {
      for (const item of items) {
        if (item.id === 'leafbookOpenBook') return item
        const nested = item.submenu ? find(item.submenu.items) : null
        if (nested) return nested
      }
      return null
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    if (!item) throw new Error('menu')
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    item.click(undefined, window, window?.webContents)
  })
}

const run = async () => {
  const runId = randomBytes(16).toString('hex')
  const binding = await packagedBinding()
  const mode = binding ? 'packaged' : 'source'
  diagnosticStage = 'source-validation'
  const source = await validateSourcePath(argument('--book-path') ?? argument('--book-root'))

  const createdTemporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leafbook-svg-harness-'))
  const temporary = await fs.realpath(createdTemporary)
  const temporaryStat = await fs.lstat(temporary)
  const cleanupMarker = randomBytes(32)
  await fs.writeFile(path.join(temporary, cleanupMarkerName), cleanupMarker, {
    flag: 'wx',
    mode: 0o600
  })
  const sourceCopy = path.join(temporary, 'source-copy')
  const copyRoot = path.join(temporary, 'book-under-test')
  const userData = path.join(temporary, 'userData')
  const htmlOutput = path.join(temporary, 'offline.html')
  const websiteOutput = path.join(temporary, 'offline-site')
  let before = null
  let app = null
  let sourceUnchanged = false
  let packageUnchanged = binding === null
  let cleanupVerified = false
  let preparationDraftIsolation = false
  try {
    diagnosticStage = 'isolated-copy'
    await fs.mkdir(sourceCopy, { mode: 0o700 })
    await fs.mkdir(copyRoot, { mode: 0o700 })
    before = await inspectSource(source, sourceCopy)
    const copyManifest = await inspectSource({
      sourcePath: sourceCopy,
      kind: 'directory',
      identity: await fs.lstat(sourceCopy, { bigint: true })
    })
    if (!sameManifest(copyManifest, before)) throw new Error('source-copy-mismatch')
    const markdown = before.records
      .filter(
        (record) =>
          record.type === 'file' &&
          /\.(?:md|markdown)$/i.test(record.relative) &&
          record.size <= 16 * 1024 * 1024
      )
      .sort(
        (left, right) => right.size - left.size || asciiCompare(left.relative, right.relative)
      )[0]
    if (!markdown) throw new Error('source-markdown')
    const selected = await fs.readFile(path.join(sourceCopy, markdown.relative))
    await fs.writeFile(
      path.join(copyRoot, 'README.md'),
      Buffer.concat([
        selected,
        Buffer.from(
          `\n\n![LeafBook safe SVG](${safeName})\n\n![LeafBook malicious SVG](${maliciousName})\n`,
          'utf8'
        )
      ]),
      { flag: 'w', mode: 0o600 }
    )
    await fs.writeFile(
      path.join(copyRoot, safeName),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#369"/></svg>',
      { flag: 'wx', mode: 0o600 }
    )
    await fs.writeFile(
      path.join(copyRoot, maliciousName),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><image href="http://127.0.0.1:9/private"/><script>document.body.dataset.leafbookSvgHarness="executed"</script></svg>',
      { flag: 'wx', mode: 0o600 }
    )

    diagnosticStage = 'electron-launch'
    const executablePath = binding?.executablePath ?? (await electronExecutable())
    app = await _electron.launch({
      executablePath,
      args: binding ? ['--user-data-dir', userData] : [desktopRoot, '--user-data-dir', userData],
      cwd: desktopRoot,
      env: {
        ...process.env,
        PERF_TESTING: 'true',
        MARKTEXT_ERROR_INTERACTION: '1'
      },
      timeout: 30_000
    })
    diagnosticStage = 'book-open'
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await openBook(app, copyRoot, htmlOutput, websiteOutput)
    diagnosticStage = 'svg-wait'
    const safeImage = page.locator(
      'img.leafbook-local-image[alt="LeafBook safe SVG"][src^="blob:"]'
    )
    if (process.env.LEAFBOOK_SVG_HARNESS_DIAGNOSTIC === '1') {
      await page.waitForTimeout(1_000)
      const counts = await page.evaluate(() => ({
        workspace: document.querySelectorAll('.book-workspace').length,
        localImages: document.querySelectorAll('img.leafbook-local-image').length,
        resourceSlots: document.querySelectorAll('img[data-leafbook-resource]').length,
        placeholders: document.querySelectorAll('.leafbook-media-placeholder').length
      }))
      diagnosticStage = `svg-wait-${counts.workspace}-${counts.localImages}-${counts.resourceSlots}-${counts.placeholders}`
    }
    await safeImage.waitFor({ state: 'attached', timeout: 30_000 })
    await safeImage.scrollIntoViewIfNeeded()
    diagnosticStage = 'svg-decode'
    const result = await safeImage.evaluate(async (image) => {
      await image.decode()
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        placeholders: document.querySelectorAll('.leafbook-media-placeholder').length,
        activeSvg: document.querySelectorAll('.leafbook-markdown svg, .leafbook-markdown script')
          .length,
        executed: document.body.dataset.leafbookSvgHarness === 'executed'
      }
    })
    const mainEvidence = await app.evaluate(() => ({
      network: global.__leafbook_svg_harness_network__,
      errors: global.__leafbook_svg_harness_errors__
    }))
    diagnosticStage = 'svg-assert'
    if (
      result.width !== 32 ||
      result.height !== 16 ||
      result.placeholders < 1 ||
      result.activeSvg !== 0 ||
      result.executed ||
      mainEvidence.network !== 0 ||
      mainEvidence.errors !== 0
    ) {
      throw new Error('e2e-evidence')
    }
    diagnosticStage = 'offline-export'
    await page.getByRole('button', { name: 'Export…' }).click()
    await page.getByRole('status').filter({ hasText: 'Exported offline.html' }).waitFor({
      timeout: 30_000
    })
    await page.getByRole('button', { name: 'Generate Website…' }).click()
    await page.getByRole('status').filter({ hasText: 'Generated offline-site' }).waitFor({
      timeout: 30_000
    })
    const singleHtml = await readStableFile(htmlOutput)
    const singleText = singleHtml.bytes.toString('utf8')
    const rootEntries = (await fs.readdir(websiteOutput)).sort(asciiCompare)
    const expectedRootEntries = ['assets', 'index.html', 'leafbook-manifest.json']
    if (
      rootEntries.length !== expectedRootEntries.length ||
      rootEntries.some((entry, index) => entry !== expectedRootEntries[index])
    ) {
      throw new Error('website-entry-set')
    }
    const assetNames = (await fs.readdir(path.join(websiteOutput, 'assets'))).sort(asciiCompare)
    if (assetNames.length !== 1 || !/^[a-f0-9]{64}\.svg$/u.test(assetNames[0] ?? '')) {
      throw new Error('website-asset-set')
    }
    const relativeAsset = `assets/${assetNames[0]}`
    const [websiteHtml, websiteAsset, websiteManifest] = await Promise.all([
      readStableFile(path.join(websiteOutput, 'index.html')),
      readStableFile(path.join(websiteOutput, 'assets', assetNames[0])),
      readStableFile(path.join(websiteOutput, 'leafbook-manifest.json'))
    ])
    const manifest = JSON.parse(websiteManifest.bytes.toString('utf8'))
    const expectedFiles = [
      {
        path: relativeAsset,
        size: websiteAsset.bytes.byteLength,
        sha256: createHash('sha256').update(websiteAsset.bytes).digest('hex')
      },
      {
        path: 'index.html',
        size: websiteHtml.bytes.byteLength,
        sha256: createHash('sha256').update(websiteHtml.bytes).digest('hex')
      }
    ]
    const websiteText = websiteHtml.bytes.toString('utf8')
    if (
      (singleText.match(/data:image\/svg\+xml;base64,/gu) ?? []).length !== 1 ||
      websiteText.split(relativeAsset).length - 1 !== 1 ||
      singleText.includes(copyRoot) ||
      websiteText.includes(copyRoot) ||
      singleText.includes(safeName) ||
      websiteText.includes(safeName) ||
      singleText.includes(maliciousName) ||
      websiteText.includes(maliciousName) ||
      manifest?.schemaVersion !== 2 ||
      manifest?.generator !== 'LeafBook' ||
      JSON.stringify(manifest?.files) !== JSON.stringify(expectedFiles)
    ) {
      throw new Error('offline-export-evidence')
    }
    diagnosticStage = 'offline-export-final'
    const finalMainEvidence = await app.evaluate(() => ({
      network: global.__leafbook_svg_harness_network__,
      errors: global.__leafbook_svg_harness_errors__
    }))
    if (finalMainEvidence.network !== 0 || finalMainEvidence.errors !== 0) {
      throw new Error('offline-final-evidence')
    }
  } finally {
    if (app) await app.close().catch(() => undefined)
    if (binding) {
      diagnosticStage = 'packaged-binding-final'
      try {
        await verifyPackagedBinding(binding, binding)
        packageUnchanged = true
      } catch {
        packageUnchanged = false
      }
    }
    try {
      const rootAfter = await fs.lstat(source.sourcePath, { bigint: true })
      const after = await inspectSource(source)
      sourceUnchanged =
        before !== null &&
        sameStableStat(rootAfter, source.identity) &&
        sameSourceSnapshot(after, before)
    } catch {
      sourceUnchanged = false
    }
    try {
      const draftDirectory = path.join(userData, 'leafbook-preparation-drafts')
      const [directory, key, copyCanonical] = await Promise.all([
        fs.lstat(draftDirectory, { bigint: true }),
        readStableFile(path.join(draftDirectory, '.root-hmac-key')),
        fs.realpath(copyRoot)
      ])
      const entries = (await fs.readdir(draftDirectory)).sort(asciiCompare)
      const sourceRootHmac = createHmac('sha256', key.bytes)
        .update(source.sourcePath, 'utf8')
        .digest('hex')
      const copyRootHmac = createHmac('sha256', key.bytes)
        .update(copyCanonical, 'utf8')
        .digest('hex')
      preparationDraftIsolation =
        directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        (Number(directory.mode) & 0o077) === 0 &&
        key.bytes.byteLength === 32 &&
        (Number(key.stat.mode) & 0o077) === 0 &&
        sourceRootHmac !== copyRootHmac &&
        entries.length === 1 &&
        entries[0] === '.root-hmac-key'
    } catch {
      preparationDraftIsolation = false
    }
    await removeTemporary(
      temporary,
      { dev: temporaryStat.dev, ino: temporaryStat.ino },
      cleanupMarker
    )
    try {
      await fs.lstat(temporary)
    } catch (error) {
      cleanupVerified = error?.code === 'ENOENT'
    }
  }
  if (!sourceUnchanged) throw new Error('source-changed')
  if (!packageUnchanged) throw new Error('packaged-binding-changed')
  if (!preparationDraftIsolation) throw new Error('preparation-draft-isolation')
  if (!cleanupVerified) throw new Error('cleanup')
  return {
    status: 'pass',
    schema: 2,
    mode,
    runId,
    productionE2E: true,
    sourceUnchanged: true,
    packageUnchanged: true,
    safeSvg: true,
    maliciousSvgInert: true,
    offlineExportResources: true,
    websiteManifestBound: true,
    preparationDraftIsolation: true,
    networkRequests: 0,
    temporaryCopyRemoved: true,
    ...(binding ? { artifactAuditDigest: binding.artifactAuditDigest } : {})
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const diagnosticTimer =
    process.env.LEAFBOOK_SVG_HARNESS_DIAGNOSTIC === '1'
      ? setInterval(() => {
        process.stderr.write(`${JSON.stringify({ stage: diagnosticStage })}\n`)
      }, 10_000)
      : null
  diagnosticTimer?.unref()
  try {
    process.stdout.write(`${JSON.stringify(await run())}\n`)
  } catch {
    if (process.env.LEAFBOOK_SVG_HARNESS_DIAGNOSTIC === '1') {
      process.stderr.write(`${JSON.stringify({ stage: diagnosticStage })}\n`)
    }
    process.stdout.write(
      `${JSON.stringify({
        status: 'fail',
        schema: 2,
        mode: argument('--executable') ? 'packaged' : 'source',
        privateDetailsSuppressed: true
      })}\n`
    )
    process.exitCode = 1
  } finally {
    if (diagnosticTimer) clearInterval(diagnosticTimer)
  }
}
