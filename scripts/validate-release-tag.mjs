import fs from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const desktopPackage = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, 'packages/desktop/package.json'),
    'utf8'
  )
)
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

if (typeof tag !== 'string' || !tag.startsWith('v')) {
  throw new Error(`Release tag must start with v; received ${String(tag)}`)
}
const tagVersion = tag.slice(1)
if (!semver.test(tagVersion)) {
  throw new Error(`Release tag ${tag} is not valid SemVer 2.0.0`)
}
if (!semver.test(desktopPackage.version)) {
  throw new Error(
    `Desktop package version ${desktopPackage.version} is not valid SemVer 2.0.0`
  )
}
if (tag !== `v${desktopPackage.version}`) {
  throw new Error(
    `Release tag ${tag} does not match desktop version v${desktopPackage.version}`
  )
}

console.log(`Release tag ${tag} matches LeafBook ${desktopPackage.version}.`)
