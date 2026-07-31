import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const semver =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export const validateReleaseTag = ({ tag, desktopVersion }) => {
  if (typeof tag !== 'string' || !tag.startsWith('v')) {
    throw new Error(`Release tag must start with v; received ${String(tag)}`)
  }
  const tagVersion = tag.slice(1)
  const tagMatch = semver.exec(tagVersion)
  if (!tagMatch) {
    throw new Error(`Release tag ${tag} is not valid SemVer 2.0.0`)
  }
  if (!semver.test(desktopVersion)) {
    throw new Error(`Desktop package version ${desktopVersion} is not valid SemVer 2.0.0`)
  }
  if (tag !== `v${desktopVersion}`) {
    throw new Error(`Release tag ${tag} does not match desktop version v${desktopVersion}`)
  }

  // SemVer prerelease identifiers are the only source of channel truth.
  // Build metadata may legally contain hyphens and never makes a stable
  // version a prerelease.
  return {
    tag,
    version: tagVersion,
    isPrerelease: tagMatch.groups?.prerelease !== undefined
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const desktopPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'packages/desktop/package.json'), 'utf8')
  )
  const result = validateReleaseTag({
    tag: process.argv[2] ?? process.env.GITHUB_REF_NAME,
    desktopVersion: desktopPackage.version
  })
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `is_prerelease=${result.isPrerelease ? 'true' : 'false'}\n`,
      'utf8'
    )
  }
  console.log(
    `Release tag ${result.tag} matches LeafBook ${result.version} (${result.isPrerelease ? 'prerelease' : 'stable'}).`
  )
}
