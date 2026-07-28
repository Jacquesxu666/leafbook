import fs from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const desktopPackage = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'packages/desktop/package.json'), 'utf8')
) as { version: string }

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const expectedPlaceholder = `e.g. ${desktopPackage.version}`

const appdata = read('packages/desktop/build/linux/leafbook.appdata.xml')
const builder = read('packages/desktop/electron-builder.yml')
const releaseVersions = [...appdata.matchAll(/<release\b[^>]*\bversion="([^"]+)"/g)].map(
  (match) => match[1]
)
if (releaseVersions.length === 0) {
  throw new Error('Linux AppStream metadata has no release version')
}
if (releaseVersions[0] !== desktopPackage.version) {
  throw new Error(
    `Linux AppStream version ${releaseVersions[0]} does not match ${desktopPackage.version}`
  )
}
const linuxBuilder = builder.slice(builder.indexOf('\nlinux:'))
if (!linuxBuilder.match(/^\s{4}- ext: 'mdx'$/m)) {
  throw new Error('Linux electron-builder associations must include mdx')
}

for (const template of [
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/DISCUSSION_TEMPLATE/q-and-a.yml'
]) {
  const content = read(template)
  if (!content.includes(expectedPlaceholder)) {
    throw new Error(`${template} must use desktop version placeholder "${expectedPlaceholder}"`)
  }
}

console.log(`LeafBook Linux and community metadata match version ${desktopPackage.version}.`)
