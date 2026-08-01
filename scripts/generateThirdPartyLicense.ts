'use strict'

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface LicensePackage {
  licenses: string
  licenseFile?: string
  licenseText?: string
}

type LicensePackages = Record<string, LicensePackage>
type GetLicenses = (
  root: string,
  callback: (error: Error | null, packages?: LicensePackages) => void
) => void

const require = createRequire(import.meta.url)
const thirdPartyChecker = require('./thirdPartyChecker.ts') as {
  getLicenses: GetLicenses
}
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDirectory, '..', 'packages/desktop')

export function renderThirdPartyNotices(packages: LicensePackages): string {
  const packageKeys = Object.keys(packages).sort((left, right) => left.localeCompare(right))
  if (packageKeys.length === 0) {
    throw new Error('No third-party packages were returned')
  }
  let summary = ''
  let licenseList = ''
  let index = 1

  packageKeys.forEach((key) => {
    const { licenses, licenseFile, licenseText } = packages[key]
    let body = ''
    if (typeof licenseFile === 'string' && fs.existsSync(licenseFile)) {
      body = fs.readFileSync(licenseFile, 'utf8').trim()
    }
    if (!body && typeof licenseText === 'string') {
      body = licenseText.trim()
    }
    if (!body) {
      // license-checker can identify an SPDX expression without finding a
      // physical license file. Preserve that auditable result without ever
      // serializing JavaScript's `undefined` into the shipped notices.
      body = `No license file was provided by this package. Declared license: ${licenses}.`
    }
    if (!body) {
      throw new Error(`Empty license body for ${key}`)
    }
    body = body.replace(/[ \t]+$/gm, '')
    summary += `${index++}. ${key} (${licenses})\n`
    licenseList += `# ${key} (${licenses})
-------------------------------------------------\

${body}
\n\n
`
  })

  return `# Third Party Notices
-------------------------------------------------

This file is a generated production dependency license inventory reported by
license-checker. Entries retain the package identity and version returned by
that tool; multiple versions are intentionally preserved.

It is not an SBOM. Package-manager resolution, optional or platform-specific
paths, bundled assets, and transitive completeness require independent release
review.

-------------------------------------------------
# Summary
-------------------------------------------------

${summary}

-------------------------------------------------
# Licenses
-------------------------------------------------

${licenseList}
`
}

export async function generateThirdPartyLicense(
  getLicenses: GetLicenses = thirdPartyChecker.getLicenses,
  outputPath = path.resolve(desktopRoot, 'build', 'THIRD-PARTY-LICENSES.txt')
): Promise<void> {
  const packages = await new Promise<LicensePackages>((resolve, reject) => {
    getLicenses(desktopRoot, (error, result) => {
      if (error) {
        reject(error)
      } else if (!result) {
        reject(new Error('Third-party license checker returned no package map'))
      } else {
        resolve(result)
      }
    })
  })
  const output = renderThirdPartyNotices(packages)
  fs.writeFileSync(outputPath, output)
  console.log('THIRD-PARTY-LICENSES.txt generated successfully.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateThirdPartyLicense().catch((error: unknown) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
