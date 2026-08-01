#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'
import { LINUX_MARKDOWN_FILE_ASSOCIATIONS } from './linux-file-associations.mjs'

const require = createRequire(import.meta.url)
const { generateAppRunScript } = require('app-builder-lib/out/targets/appimage/appImageUtil.js')
const { buildCommandShContent } = require('app-builder-lib/out/targets/snap/coreLegacy.js')
const { LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper.js')
const { version: DEFAULT_VERSION } = require('../packages/desktop/package.json')

const MAX_ENTRIES = 100_000
const MAX_DEPTH = 128
const MAX_PATH_BYTES = 4096
const MAX_FILE_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

const sha256 = async (file) => {
  const hash = createHash('sha256')
  const handle = await fs.open(file, 'r')
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

export const binaryIdentity = async (file) => {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const data = buffer.subarray(0, bytesRead)
    if (data.length >= 20 && data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      if (data[4] !== 2 || data[5] !== 1) throw new Error('native ELF must be little-endian ELF64')
      const machine = data.readUInt16LE(18)
      return {
        format: 'elf',
        architectures: machine === 62 ? ['x64'] : machine === 183 ? ['arm64'] : []
      }
    }
    if (data.length >= 64 && data[0] === 0x4d && data[1] === 0x5a) {
      const offset = data.readUInt32LE(0x3c)
      if (
        offset + 6 <= data.length &&
        data.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))
      ) {
        const machine = data.readUInt16LE(offset + 4)
        return {
          format: 'pe',
          architectures: machine === 0x8664 ? ['x64'] : machine === 0xaa64 ? ['arm64'] : []
        }
      }
    }
    const magic = data.length >= 4 ? data.readUInt32BE(0) : 0
    if (magic === 0xfeedfacf || magic === 0xcffaedfe) {
      const little = magic === 0xcffaedfe
      const cpu = little ? data.readUInt32LE(4) : data.readUInt32BE(4)
      return {
        format: 'macho',
        architectures: cpu === 0x01000007 ? ['x64'] : cpu === 0x0100000c ? ['arm64'] : []
      }
    }
    if (
      magic === 0xcafebabe ||
      magic === 0xbebafeca ||
      magic === 0xcafebabf ||
      magic === 0xbfbafeca
    ) {
      const little = magic === 0xbebafeca || magic === 0xbfbafeca
      const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca
      const count = little ? data.readUInt32LE(4) : data.readUInt32BE(4)
      const recordSize = fat64 ? 32 : 20
      if (count < 1 || count > 32 || 8 + count * recordSize > data.length) {
        throw new Error('invalid universal Mach-O header')
      }
      const architectures = []
      for (let index = 0; index < count; index++) {
        const offset = 8 + index * recordSize
        const cpu = little ? data.readUInt32LE(offset) : data.readUInt32BE(offset)
        if (cpu === 0x01000007) architectures.push('x64')
        else if (cpu === 0x0100000c) architectures.push('arm64')
        else architectures.push('unknown')
      }
      return { format: 'macho', architectures: [...new Set(architectures)] }
    }
    return null
  } finally {
    await handle.close()
  }
}

const walk = async (root) => {
  const entries = []
  let totalBytes = 0
  const visit = async (absolute, relative, depth) => {
    if (depth > MAX_DEPTH) throw new Error('Carrier tree exceeds maximum depth')
    if (Buffer.byteLength(relative) > MAX_PATH_BYTES) {
      throw new Error('Carrier path exceeds byte budget')
    }
    const stat = await fs.lstat(absolute)
    if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory', mode: stat.mode & 0o7777 })
      const names = await fs.readdir(absolute)
      names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      for (const name of names) {
        if (
          [...name].some((character) => {
            const code = character.charCodeAt(0)
            return code <= 0x1f || code === 0x7f
          }) ||
          name === '.' ||
          name === '..'
        ) {
          throw new Error('Carrier tree contains an unsafe path component')
        }
        await visit(path.join(absolute, name), relative ? `${relative}/${name}` : name, depth + 1)
      }
    } else if (stat.isFile()) {
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`Carrier file exceeds size budget: ${relative}`)
      }
      totalBytes += stat.size
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Carrier tree exceeds total byte budget')
      entries.push({
        path: relative,
        type: 'file',
        mode: stat.mode & 0o7777,
        size: stat.size,
        sha256: await sha256(absolute)
      })
    } else if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolute)
      if (Buffer.byteLength(target) > MAX_PATH_BYTES || target.includes('\0')) {
        throw new Error(`Carrier symlink target is unsafe: ${relative}`)
      }
      entries.push({ path: relative, type: 'symlink', mode: stat.mode & 0o7777, target })
    } else {
      throw new Error(`Unsupported carrier tree entry: ${relative}`)
    }
    if (entries.length > MAX_ENTRIES) throw new Error('Carrier tree exceeds entry budget')
  }
  const names = await fs.readdir(root)
  names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  for (const name of names) await visit(path.join(root, name), name, 1)
  return entries
}

const expectedAppRoot = (platform, carrierKind) => {
  if (platform === 'linux' && ['deb', 'rpm'].includes(carrierKind)) return 'opt/LeafBook'
  return '.'
}

const isCarrierMetadataPath = (carrierKind, relative) => {
  if (carrierKind === 'appimage') {
    return (
      ['.DirIcon', 'AppRun', 'leafbook.desktop', 'leafbook.png'].includes(relative) ||
      relative === 'usr' ||
      relative.startsWith('usr/')
    )
  }
  if (carrierKind === 'snap') {
    return relative === 'command.sh' || relative === 'meta' || relative.startsWith('meta/')
  }
  return false
}

const allowedRoot = (platform, carrierKind, name) => {
  if (carrierKind === 'deb' || carrierKind === 'rpm') return name === 'opt' || name === 'usr'
  const common =
    /^(leafbook(?:\.exe)?|resources|resources\.pak|locales|chrome-sandbox|chrome_crashpad_handler(?:\.exe)?|chrome_[^/]+|icudtl\.dat|snapshot_blob\.bin|v8_context_snapshot\.bin|vk_swiftshader_icd\.json|d3dcompiler_47\.dll|ffmpeg\.dll|lib[^/]+|LICENSE(?:\.electron\.txt|S\.chromium\.html)?)$/i
  if (common.test(name) || name === 'command.sh') return true
  if (
    platform === 'windows' &&
    /^(dxcompiler\.dll|dxil\.dll|resources\.pak|version|vk_swiftshader\.dll|vulkan-1\.dll)$/i.test(
      name
    )
  ) {
    return true
  }
  if (
    carrierKind === 'appimage' &&
    (/^(\.DirIcon|AppRun|leafbook\.(desktop|png))$/.test(name) || name === 'usr')
  ) {
    return true
  }
  if (carrierKind === 'snap' && name === 'meta') return true
  return false
}

const allowedNative = (relative, platform, architecture) => {
  const name = path.posix.basename(relative)
  const ripgrepPackage =
    platform === 'linux'
      ? `@vscode/ripgrep-linux-${architecture}/bin/rg`
      : `@vscode/ripgrep-win32-${architecture}/bin/rg.exe`
  if (
    relative.endsWith(`/resources/app.asar.unpacked/node_modules/${ripgrepPackage}`) ||
    relative === `resources/app.asar.unpacked/node_modules/${ripgrepPackage}`
  ) {
    return true
  }
  if (platform === 'linux') {
    return (
      name === 'leafbook' ||
      name === 'chrome-sandbox' ||
      name === 'chrome_crashpad_handler' ||
      /\.node$/i.test(name) ||
      /^lib.+\.so(?:\.\d+)*$/i.test(name)
    )
  }
  return (
    name.toLowerCase() === 'leafbook.exe' ||
    name.toLowerCase() === 'chrome_crashpad_handler.exe' ||
    /helper.*\.exe$/i.test(name) ||
    /\.(dll|node)$/i.test(name)
  )
}

const allowedScriptExecutable = (relative, carrierKind) =>
  (carrierKind === 'appimage' && relative === 'AppRun') ||
  (carrierKind === 'snap' && relative === 'command.sh')

const requireRegular = (entries, name, message) => {
  const entry = entries.find((candidate) => candidate.path === name)
  if (!entry || entry.type !== 'file') throw new Error(message)
  return entry
}

const expectedDesktopFile = async (carrierKind, version) => {
  const targetSpecificOptions = {
    description: 'A local-first Markdown book reader and editor.',
    category: 'Office;TextEditor;Utility',
    desktop: {
      entry: {
        StartupWMClass: 'leafbook',
        Keywords: 'leafbook;markdown;book;'
      }
    }
  }
  const packager = {
    appInfo: {
      productName: 'LeafBook',
      sanitizedProductName: 'LeafBook',
      description: 'LeafBook — a local-first Markdown book reader and editor',
      buildVersion: version
    },
    executableName: 'leafbook',
    info: { metadata: { desktopName: 'leafbook' } },
    fileAssociations: LINUX_MARKDOWN_FILE_ASSOCIATIONS,
    config: { protocols: [], mac: {} },
    platformSpecificBuildOptions: { protocols: [] }
  }
  const helper = new LinuxTargetHelper(packager)
  if (carrierKind === 'appimage') {
    return helper.computeDesktopEntry(targetSpecificOptions, 'AppRun --no-sandbox %U', {
      'X-AppImage-Version': version
    })
  }
  if (carrierKind === 'snap') {
    return helper.computeDesktopEntry(targetSpecificOptions, 'leafbook %U', {
      Icon: `${String.fromCharCode(36)}{SNAP}/meta/gui/icon.png`
    })
  }
  return helper.computeDesktopEntry(targetSpecificOptions)
}

const validateDesktopFile = async (root, relative, expectedBody) => {
  const body = await fs.readFile(path.join(root, ...relative.split('/')), 'utf8')
  if (/[\0\r]/.test(body) || Buffer.byteLength(body) > 64 * 1024) {
    throw new Error(`Desktop metadata is malformed: ${relative}`)
  }
  if (body !== expectedBody) {
    const actualLines = body.split('\n')
    const expectedLines = expectedBody.split('\n')
    let differingLine = 0
    while (
      differingLine < Math.max(actualLines.length, expectedLines.length) &&
      actualLines[differingLine] === expectedLines[differingLine]
    ) {
      differingLine += 1
    }
    throw new Error(
      `Desktop metadata differs from the pinned electron-builder 26.15.3 output at line ${
        (differingLine ?? 0) + 1
      } (${JSON.stringify(actualLines[differingLine])} != ${JSON.stringify(
        expectedLines[differingLine]
      )}): ${relative}`
    )
  }
}

const validateExactWrapper = async (root, relative, approvedBodies) => {
  const body = await fs.readFile(path.join(root, ...relative.split('/')), 'utf8')
  if (/[\0\r]/.test(body) || Buffer.byteLength(body) > 64 * 1024) {
    throw new Error(`${relative} launcher is malformed`)
  }
  if (!approvedBodies.includes(body)) {
    throw new Error(`${relative} launcher differs from the pinned electron-builder template`)
  }
}

const expectedAppRun = () =>
  generateAppRunScript({
    ExecutableName: 'leafbook',
    DesktopFileName: 'leafbook.desktop',
    ProductFilename: 'LeafBook',
    ProductName: 'LeafBook',
    ResourceName: 'appimagekit-leafbook',
    MimeTypeFile: 'usr/share/mime/packages/leafbook.xml'
  })

const expectedAppArmorProfile = async () =>
  (
    await fs.readFile(
      require.resolve('app-builder-lib/templates/linux/apparmor-profile.tpl'),
      'utf8'
    )
  )
    .replaceAll('$' + '{executable}', 'leafbook')
    .replaceAll('$' + '{sanitizedProductName}', 'LeafBook')
    .replaceAll('$' + '{productFilename}', 'LeafBook')

const validateSnapMetadata = async (root, architecture) => {
  const yaml = await fs.readFile(path.join(root, 'meta/snap.yaml'), 'utf8')
  if (/[\0\r]/.test(yaml) || Buffer.byteLength(yaml) > 256 * 1024) {
    throw new Error('snap.yaml is malformed or exceeds its byte budget')
  }
  const document = parseDocument(yaml, {
    merge: false,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true
  })
  if (document.errors.length) throw new Error(`snap.yaml is invalid: ${document.errors[0].message}`)
  const metadata = document.toJS({ maxAliasCount: 0 })
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('snap.yaml must contain one mapping')
  }
  const approvedTopLevel = new Set([
    'name',
    'version',
    'summary',
    'description',
    'architectures',
    'base',
    'confinement',
    'grade',
    'apps',
    'plugs',
    'slots',
    'assumes',
    'title',
    'icon',
    'compression'
  ])
  for (const key of Object.keys(metadata)) {
    if (!approvedTopLevel.has(key)) throw new Error(`snap.yaml contains unapproved key: ${key}`)
  }
  if (
    metadata.name !== 'leafbook' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version) ||
    metadata.base !== 'core20' ||
    metadata.confinement !== 'strict' ||
    metadata.grade !== 'stable'
  ) {
    throw new Error('snap.yaml has a non-canonical identity or confinement')
  }
  if (!metadata.apps || Object.keys(metadata.apps).length !== 1 || !metadata.apps.leafbook) {
    throw new Error('snap.yaml must contain exactly the leafbook app')
  }
  const app = metadata.apps.leafbook
  const approvedAppKeys = new Set(['command', 'plugs', 'slots', 'desktop', 'common-id'])
  for (const key of Object.keys(app)) {
    if (!approvedAppKeys.has(key)) throw new Error(`snap.yaml app contains unapproved key: ${key}`)
  }
  if (app.command !== 'command.sh') {
    throw new Error('snap command does not bind the audited executable')
  }
  if (app.desktop !== undefined && app.desktop !== 'meta/gui/leafbook.desktop') {
    throw new Error('snap desktop metadata path is not canonical')
  }
  const expectedSnapArchitecture = architecture === 'x64' ? 'amd64' : 'arm64'
  if (
    metadata.architectures !== undefined &&
    (!Array.isArray(metadata.architectures) ||
      metadata.architectures.length !== 1 ||
      metadata.architectures[0] !== expectedSnapArchitecture)
  ) {
    throw new Error('snap architecture does not bind the audited matrix architecture')
  }
  const safePlugs = new Set([
    'desktop',
    'desktop-legacy',
    'home',
    'x11',
    'wayland',
    'unity7',
    'network',
    'gsettings',
    'audio-playback',
    'pulseaudio',
    'opengl',
    'browser-support',
    'gtk-3-themes',
    'icon-themes',
    'sound-themes',
    'gnome-3-28-1804',
    'gnome-46-2404',
    'gpu-2404'
  ])
  if (
    app.plugs !== undefined &&
    (!Array.isArray(app.plugs) ||
      app.plugs.some((plug) => typeof plug !== 'string' || !safePlugs.has(plug)))
  ) {
    throw new Error('snap app contains an unapproved plug')
  }
  if (metadata.plugs !== undefined) {
    if (!metadata.plugs || typeof metadata.plugs !== 'object' || Array.isArray(metadata.plugs)) {
      throw new Error('snap top-level plugs must be a mapping')
    }
    const approvedDescriptors = {
      'browser-support': { interface: 'browser-support', 'allow-sandbox': true },
      'gnome-3-28-1804': {
        interface: 'content',
        target: '$SNAP/gnome-platform',
        'default-provider': 'gnome-3-28-1804'
      },
      'gtk-3-themes': {
        interface: 'content',
        target: '$SNAP/data-dir/themes',
        'default-provider': 'gtk-common-themes'
      },
      'icon-themes': {
        interface: 'content',
        target: '$SNAP/data-dir/icons',
        'default-provider': 'gtk-common-themes'
      },
      'sound-themes': {
        interface: 'content',
        target: '$SNAP/data-dir/sounds',
        'default-provider': 'gtk-common-themes'
      }
    }
    for (const [name, descriptor] of Object.entries(metadata.plugs)) {
      if (
        !safePlugs.has(name) ||
        !descriptor ||
        typeof descriptor !== 'object' ||
        JSON.stringify(descriptor) !== JSON.stringify(approvedDescriptors[name])
      ) {
        throw new Error(`snap contains an unapproved plug definition: ${name}`)
      }
    }
  }
  if (
    (metadata.slots !== undefined &&
      (!metadata.slots ||
        typeof metadata.slots !== 'object' ||
        Object.keys(metadata.slots).length !== 0)) ||
    (app.slots !== undefined && (!Array.isArray(app.slots) || app.slots.length !== 0))
  ) {
    throw new Error('snap slots are not approved')
  }
  return app.command
}

const validateCarrierShape = async ({ root, entries, carrierKind, version }) => {
  if (carrierKind === 'archive') return
  let extra
  if (carrierKind === 'deb' || carrierKind === 'rpm') {
    extra = entries.filter(
      (entry) => entry.path !== 'opt/LeafBook' && !entry.path.startsWith('opt/LeafBook/')
    )
  } else {
    extra = entries.filter((entry) => isCarrierMetadataPath(carrierKind, entry.path))
  }

  if (carrierKind === 'deb' || carrierKind === 'rpm') {
    const allowed = [
      /^opt$/,
      /^usr$/,
      /^usr\/share$/,
      /^usr\/share\/applications$/,
      /^usr\/share\/applications\/leafbook\.desktop$/,
      /^usr\/share\/doc$/,
      /^usr\/share\/doc\/leafbook$/,
      /^usr\/share\/doc\/leafbook\/(?:copyright|changelog(?:\.gz)?)$/,
      /^usr\/share\/icons$/,
      /^usr\/share\/icons\/hicolor$/,
      /^usr\/share\/icons\/hicolor\/(?:16x16|32x32|48x48|64x64|128x128|256x256|512x512|1024x1024|scalable)$/,
      /^usr\/share\/icons\/hicolor\/(?:16x16|32x32|48x48|64x64|128x128|256x256|512x512|1024x1024|scalable)\/apps$/,
      /^usr\/share\/icons\/hicolor\/(?:16x16|32x32|48x48|64x64|128x128|256x256|512x512|1024x1024|scalable)\/apps\/leafbook\.(?:png|svg)$/,
      /^usr\/share\/mime$/,
      /^usr\/share\/mime\/packages$/,
      /^usr\/share\/mime\/packages\/leafbook\.xml$/
    ]
    for (const entry of extra) {
      if (!allowed.some((pattern) => pattern.test(entry.path))) {
        throw new Error(`${carrierKind} carrier contains unapproved metadata: ${entry.path}`)
      }
      if (entry.type === 'symlink') {
        throw new Error(`${carrierKind} carrier contains an unapproved symlink: ${entry.path}`)
      }
    }
    requireRegular(
      entries,
      'usr/share/applications/leafbook.desktop',
      `${carrierKind} carrier is missing canonical desktop metadata`
    )
    await validateDesktopFile(
      root,
      'usr/share/applications/leafbook.desktop',
      await expectedDesktopFile(carrierKind, version)
    )
    const appArmorPath = 'opt/LeafBook/resources/apparmor-profile'
    requireRegular(entries, appArmorPath, `${carrierKind} carrier is missing its AppArmor profile`)
    if (
      (await fs.readFile(path.join(root, ...appArmorPath.split('/')), 'utf8')) !==
      (await expectedAppArmorProfile())
    ) {
      throw new Error(`${carrierKind} carrier AppArmor profile differs from the pinned template`)
    }
    return
  }

  if (carrierKind === 'appimage') {
    const expected = new Set(['.DirIcon', 'AppRun', 'leafbook.desktop', 'leafbook.png', 'usr'])
    for (const entry of extra) expected.delete(entry.path)
    if (expected.size) {
      throw new Error(`AppImage carrier is missing metadata: ${[...expected].join(', ')}`)
    }
    for (const entry of extra) {
      const accepted =
        entry.path === '.DirIcon' || entry.path === 'leafbook.png'
          ? entry.type === 'symlink'
          : entry.path === 'AppRun'
            ? entry.type === 'file'
            : entry.path === 'leafbook.desktop'
              ? entry.type === 'file'
              : entry.path === 'usr' || entry.path.startsWith('usr/')
      if (!accepted) {
        throw new Error(`AppImage metadata has unexpected type: ${entry.path}`)
      }
    }
    const dirIcon = entries.find((entry) => entry.path === '.DirIcon')
    const rootIcon = entries.find((entry) => entry.path === 'leafbook.png')
    const iconTarget = /^usr\/share\/icons\/hicolor\/(?:\d+x\d+|scalable)\/apps\/leafbook\.png$/
    if (
      !dirIcon ||
      !rootIcon ||
      dirIcon.target !== rootIcon.target ||
      !iconTarget.test(dirIcon.target) ||
      !entries.some((entry) => entry.path === dirIcon.target && entry.type === 'file')
    ) {
      throw new Error('AppImage root icon symlinks are not canonical')
    }
    requireRegular(
      entries,
      'usr/share/mime/packages/leafbook.xml',
      'AppImage carrier is missing canonical MIME metadata'
    )
    for (const entry of entries.filter((candidate) => candidate.path.startsWith('usr/share/'))) {
      if (
        !/^usr\/share(?:\/(?:icons(?:\/hicolor(?:\/(?:\d+x\d+|scalable)(?:\/apps(?:\/leafbook\.png)?)?)?)?|mime(?:\/packages(?:\/leafbook\.xml)?)?))?$/.test(
          entry.path
        )
      ) {
        throw new Error(`AppImage carrier contains unapproved integration metadata: ${entry.path}`)
      }
    }
    const paths = new Set(entries.map((entry) => entry.path))
    for (const entry of entries.filter(
      (candidate) => candidate.type === 'symlink' && candidate.path.startsWith('usr/')
    )) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(entry.path), entry.target.replaceAll('\\', '/'))
      )
      if (
        path.posix.isAbsolute(entry.target) ||
        resolved === '..' ||
        resolved.startsWith('../') ||
        !paths.has(resolved)
      ) {
        throw new Error(`AppImage integration symlink escapes or is unmanifested: ${entry.path}`)
      }
    }
    await validateDesktopFile(
      root,
      'leafbook.desktop',
      await expectedDesktopFile('appimage', version)
    )
    return
  }

  const approved = [
    /^command\.sh$/,
    /^meta$/,
    /^meta\/snap\.yaml$/,
    /^meta\/gui$/,
    /^meta\/gui\/leafbook\.desktop$/,
    /^meta\/gui\/icon\.(?:png|svg)$/
  ]
  for (const entry of extra) {
    if (!approved.some((pattern) => pattern.test(entry.path))) {
      throw new Error(`snap carrier contains unapproved metadata: ${entry.path}`)
    }
    if (entry.type === 'symlink') {
      throw new Error(`snap metadata must not be a symlink: ${entry.path}`)
    }
  }
  requireRegular(entries, 'meta/snap.yaml', 'snap carrier is missing meta/snap.yaml')
  requireRegular(
    entries,
    'meta/gui/leafbook.desktop',
    'snap carrier is missing canonical desktop metadata'
  )
  await validateDesktopFile(
    root,
    'meta/gui/leafbook.desktop',
    await expectedDesktopFile('snap', version)
  )
}

const validateLauncher = async ({ root, entries, carrierKind, platform, architecture }) => {
  if (platform === 'windows' || ['archive', 'deb', 'rpm'].includes(carrierKind)) return
  if (carrierKind === 'appimage') {
    const launcher = entries.find((entry) => entry.path === 'AppRun')
    if (!launcher) throw new Error('AppImage carrier is missing AppRun')
    if (launcher.type !== 'file') throw new Error('AppRun must be the pinned regular template')
    await validateExactWrapper(root, 'AppRun', [expectedAppRun()])
  } else if (carrierKind === 'snap') {
    const command = await validateSnapMetadata(root, architecture)
    if (command === 'command.sh') {
      const wrapper = entries.find((entry) => entry.path === 'command.sh')
      if (!wrapper || wrapper.type !== 'file' || (wrapper.mode & 0o111) === 0) {
        throw new Error('snap command wrapper is missing or not executable')
      }
      await validateExactWrapper(root, 'command.sh', [
        buildCommandShContent({
          isTemplate: true,
          executableName: 'leafbook',
          extraAppArgs: ['--no-sandbox']
        })
      ])
    }
  }
}

export const auditApplicationLayout = async ({
  tree,
  platform,
  architecture,
  carrierKind = 'archive',
  expectedVersion = DEFAULT_VERSION
}) => {
  if (!['linux', 'windows'].includes(platform)) throw new Error('Unsupported platform')
  if (!['x64', 'arm64'].includes(architecture)) throw new Error('Unsupported architecture')
  if (!['archive', 'deb', 'rpm', 'appimage', 'snap'].includes(carrierKind)) {
    throw new Error('Unsupported carrier kind')
  }
  const textualTreeStat = await fs.lstat(tree)
  const canonicalTree = await fs.realpath(tree)
  if (
    !textualTreeStat.isDirectory() ||
    textualTreeStat.isSymbolicLink() ||
    !(await fs.lstat(canonicalTree)).isDirectory()
  ) {
    throw new Error('Carrier extraction root must be a real directory')
  }

  const entries = await walk(canonicalTree)
  const entryPaths = new Set(entries.map((entry) => entry.path))
  const roots = new Set(entries.map((entry) => entry.path.split('/')[0]))
  for (const rootName of roots) {
    if (!allowedRoot(platform, carrierKind, rootName)) {
      throw new Error(`Carrier contains a non-canonical top-level entry: ${rootName}`)
    }
  }

  const appRootRelative = expectedAppRoot(platform, carrierKind)
  const resourcesRelative = appRootRelative === '.' ? 'resources' : `${appRootRelative}/resources`
  const asars = entries.filter(
    (entry) =>
      entry.type === 'file' &&
      (entry.path.endsWith('/resources/app.asar') || entry.path === 'resources/app.asar')
  )
  if (asars.length !== 1 || asars[0].path !== `${resourcesRelative}/app.asar`) {
    throw new Error('Carrier must contain exactly one app.asar at its canonical application root')
  }
  const executableName = platform === 'windows' ? 'leafbook.exe' : 'leafbook'
  const executableRelative =
    appRootRelative === '.' ? executableName : `${appRootRelative}/${executableName}`
  const executableEntry = entries.find((entry) => entry.path === executableRelative)
  if (!executableEntry || executableEntry.type !== 'file') {
    throw new Error(`Carrier is missing canonical ${executableName}`)
  }

  const appPrefix = appRootRelative === '.' ? '' : `${appRootRelative}/`
  for (const entry of entries.filter((candidate) => candidate.type === 'symlink')) {
    if (
      (appPrefix && !entry.path.startsWith(appPrefix)) ||
      (!appPrefix && isCarrierMetadataPath(carrierKind, entry.path))
    ) {
      continue
    }
    const absolute = path.join(canonicalTree, ...entry.path.split('/'))
    const resolved = path.resolve(path.dirname(absolute), entry.target)
    const appRoot =
      appRootRelative === '.'
        ? canonicalTree
        : path.join(canonicalTree, ...appRootRelative.split('/'))
    if (
      path.isAbsolute(entry.target) ||
      (resolved !== appRoot && !resolved.startsWith(`${appRoot}${path.sep}`))
    ) {
      throw new Error(`Application symlink escapes its app root: ${entry.path}`)
    }
    const targetRelative = path.relative(canonicalTree, resolved).split(path.sep).join('/')
    if (!entryPaths.has(targetRelative)) {
      throw new Error(
        `Application symlink target is not present in the carrier manifest: ${entry.path}`
      )
    }
  }

  const nativeFiles = []
  for (const entry of entries.filter((candidate) => candidate.type === 'file')) {
    const absolute = path.join(canonicalTree, ...entry.path.split('/'))
    const identity = await binaryIdentity(absolute)
    const nativeExtension = /\.(node|dll|exe|so(?:\.\d+)*)$/i.test(entry.path)
    if (!identity) {
      if (nativeExtension) {
        throw new Error(`Native-looking file has no recognized binary header: ${entry.path}`)
      }
      if ((entry.mode & 0o111) !== 0 && !allowedScriptExecutable(entry.path, carrierKind)) {
        throw new Error(`Carrier contains an unexpected executable file: ${entry.path}`)
      }
      continue
    }
    if (identity.format !== (platform === 'linux' ? 'elf' : 'pe')) {
      throw new Error(`Carrier contains a foreign native format: ${entry.path}`)
    }
    if (!identity.architectures.includes(architecture)) {
      throw new Error(`Native binary does not match ${architecture}: ${entry.path}`)
    }
    if (!allowedNative(entry.path, platform, architecture)) {
      throw new Error(`Carrier contains an unexpected native executable: ${entry.path}`)
    }
    nativeFiles.push(entry.path)
  }
  if (!nativeFiles.includes(executableRelative)) {
    throw new Error('Canonical executable is not a native binary')
  }

  await validateCarrierShape({
    root: canonicalTree,
    entries,
    carrierKind,
    version: expectedVersion
  })
  await validateLauncher({
    root: canonicalTree,
    entries,
    carrierKind,
    platform,
    architecture
  })

  const appManifest = entries
    .filter(
      (entry) =>
        (appRootRelative === '.' && !isCarrierMetadataPath(carrierKind, entry.path)) ||
        (appRootRelative !== '.' && entry.path.startsWith(appPrefix))
    )
    .map((entry) => ({
      ...entry,
      path: appRootRelative === '.' ? entry.path : entry.path.slice(appPrefix.length)
    }))
    .filter(
      (entry) =>
        !(['deb', 'rpm'].includes(carrierKind) && entry.path === 'resources/apparmor-profile')
    )
  const manifestDigest = createHash('sha256').update(JSON.stringify(appManifest)).digest('hex')
  const carrierManifestDigest = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  const appRoot =
    appRootRelative === '.'
      ? canonicalTree
      : path.join(canonicalTree, ...appRootRelative.split('/'))

  return {
    appRoot,
    resourcesRelative,
    resources: path.join(canonicalTree, ...resourcesRelative.split('/')),
    executable: path.join(canonicalTree, ...executableRelative.split('/')),
    manifest: appManifest,
    manifestDigest,
    carrierManifest: entries,
    carrierManifestDigest,
    nativeFiles
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    const [platform, architecture, tree, carrierKind = 'archive', expectedVersion] =
      process.argv.slice(2)
    const result = await auditApplicationLayout({
      platform,
      architecture,
      tree,
      carrierKind,
      expectedVersion
    })
    const resourcesRelative = result.resourcesRelative
    if (
      !resourcesRelative ||
      path.isAbsolute(resourcesRelative) ||
      resourcesRelative === '..' ||
      resourcesRelative.startsWith(`..${path.sep}`)
    ) {
      throw new Error('Audited resources directory is not relative to the carrier tree')
    }
    process.stdout.write(
      `${JSON.stringify({
        resourcesRelativeBase64: Buffer.from(resourcesRelative.split(path.sep).join('/')).toString(
          'base64'
        ),
        manifestDigest: result.manifestDigest,
        carrierManifestDigest: result.carrierManifestDigest,
        nativeFileCount: result.nativeFiles.length
      })}\n`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
