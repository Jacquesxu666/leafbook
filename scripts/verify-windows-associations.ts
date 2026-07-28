import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const builder = fs.readFileSync(path.join(root, 'packages/desktop/electron-builder.yml'), 'utf8')
const installer = fs.readFileSync(
  path.join(root, 'packages/desktop/build/windows/installer.nsh'),
  'utf8'
)
const extensions = ['md', 'markdown', 'mmd', 'mdown', 'mdtxt', 'mdtext', 'mdx']
const extensionVariable = '$' + '{EXTENSION}'

if (/^fileAssociations:/m.test(builder)) {
  throw new Error('Top-level electron-builder fileAssociations bypass the NSIS consent prompt')
}
const promptIndex = installer.indexOf('MessageBox MB_YESNO')
const firstWriteIndex = installer.indexOf('WriteRegStr HKCU')
if (promptIndex < 0 || firstWriteIndex <= promptIndex) {
  throw new Error('NSIS must ask for consent before writing file associations')
}
for (const extension of extensions) {
  const key = `Software\\Classes\\.${extension}`
  if (!installer.includes(`WriteRegStr HKCU "${key}"`)) {
    throw new Error(`NSIS does not register .${extension}`)
  }
  if (!installer.includes(`!insertmacro LeafBookUnassociateExtension ".${extension}"`)) {
    throw new Error(`NSIS does not ownership-check .${extension} on uninstall`)
  }
}
if (!installer.includes(`DeleteRegValue HKCU "Software\\Classes\\${extensionVariable}" ""`)) {
  throw new Error('NSIS must remove only LeafBook-owned extension default values')
}
if (!installer.includes(`DeleteRegKey /ifempty HKCU "Software\\Classes\\${extensionVariable}"`)) {
  throw new Error('NSIS must preserve extension keys that contain shared subkeys')
}
if (installer.includes(`DeleteRegKey HKCU "Software\\Classes\\${extensionVariable}"`)) {
  throw new Error('NSIS must never recursively delete shared extension keys')
}
for (const required of [
  'Software\\Classes\\LeafBook.Document',
  'LeafBook.Document\\DefaultIcon',
  'LeafBook.Document\\shell\\open\\command',
  '\'"$INSTDIR\\leafbook.exe" "%1"\'',
  'ReadRegStr $0 HKCU',
  'StrCmp $0 \'"$INSTDIR\\leafbook.exe" "%1"\' 0 KeepProgId'
]) {
  if (!installer.includes(required)) {
    throw new Error(`NSIS association definition is incomplete: ${required}`)
  }
}

console.log('LeafBook Windows associations are consent-gated and ownership-safe.')
