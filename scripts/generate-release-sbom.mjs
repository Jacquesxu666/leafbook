#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SBOM_GENERATOR_VERSION = 3
export const MAX_SOURCE_DATE_EPOCH = 253402300799

const allowedLicenseValues = Object.freeze([
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  '(ISC AND Apache-2.0)',
  '(MIT AND Zlib)',
  '(MIT OR CC0-1.0)',
  '(MIT OR WTFPL)',
  '(MPL-2.0 OR Apache-2.0)',
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
  'Unlicense',
  'WTFPL'
])
const allowedLicenses = new Set(allowedLicenseValues)

// pnpm reports two packages as Unknown and one as ambiguous BSD because their
// package metadata is incomplete. Bind each reviewed override to the exact
// installed license bytes so an upstream change fails closed.
const reviewedLicenseOverrideValues = Object.freeze([
  {
    package: 'eve-raphael@0.5.0',
    license: 'Apache-2.0',
    fileName: 'LICENSE',
    sha256: '277b9ae7fa1d2acd7f708b859f9f771cf71e785091b6f82caa473cac241853c4'
  },
  {
    package: 'khroma@2.1.0',
    license: 'MIT',
    fileName: 'license',
    sha256: '66b333b0f66759a0b710459e03f7029abe17f4358114a128d2c972e642961b49'
  },
  {
    package: 'speakingurl@14.0.1',
    license: 'BSD-3-Clause',
    fileName: 'LICENSE',
    sha256: '4cf85d9fa395446ce467f60711fe8154a374bd6c86e3fd44b847bcadec86fe33'
  }
])
const reviewedLicenseOverrides = new Map(
  reviewedLicenseOverrideValues.map(({ package: packageKey, ...override }) => [
    packageKey,
    override
  ])
)

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const readJson = async (relative) =>
  JSON.parse(await readFile(path.join(repositoryRoot, relative), 'utf8'))
const spdxId = (name, version) => `SPDXRef-Package-${sha256(`${name}@${version}`).slice(0, 20)}`
const purlName = (name) => (name.startsWith('@') ? `%40${name.slice(1)}` : name)

export const parseSourceDateEpoch = (value) => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error('SOURCE_DATE_EPOCH must be a positive integer in canonical decimal form')
  }
  const epoch = Number(value)
  if (!Number.isSafeInteger(epoch) || epoch > MAX_SOURCE_DATE_EPOCH) {
    throw new Error('SOURCE_DATE_EPOCH is outside the supported UTC range')
  }
  return epoch
}

export const buildNormalizedPolicy = () => ({
  generator: 'LeafBook generate-release-sbom.mjs',
  generatorVersion: SBOM_GENERATOR_VERSION,
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  minimumPackageCount: 100,
  relationshipType: 'DEPENDS_ON'
})

export const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SBOM payload contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new Error('SBOM payload contains a non-JSON value')
  const keys = Object.keys(value).sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right))
  )
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export const digestSbomPayload = (payload) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.hasOwn(payload, 'documentNamespace')
  ) {
    throw new Error('SBOM namespace payload must exclude documentNamespace')
  }
  return createHash('sha256')
    .update('leafbook-spdx-document-payload-v3\0')
    .update(canonicalJson(payload), 'utf8')
    .digest('hex')
}

export const buildSbomDocument = ({ version, payload }) => {
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('SBOM document version is required')
  }
  const documentNamespace = `https://github.com/Jacquesxu666/leafbook/sbom/leafbook-${version}/${digestSbomPayload(payload)}`
  return {
    spdxVersion: payload.spdxVersion,
    dataLicense: payload.dataLicense,
    SPDXID: payload.SPDXID,
    name: payload.name,
    documentNamespace,
    creationInfo: payload.creationInfo,
    documentDescribes: payload.documentDescribes,
    packages: payload.packages,
    relationships: payload.relationships
  }
}

const generate = async () => {
  const sourceDateEpoch = parseSourceDateEpoch(process.env.SOURCE_DATE_EPOCH)
  const outputArgument = process.argv[2] === '--' ? process.argv[3] : process.argv[2]
  const outputPath = path.resolve(outputArgument ?? path.join(repositoryRoot, 'leafbook.spdx.json'))
  const policy = buildNormalizedPolicy()

  const licenseResult = spawnSync(
    'pnpm',
    [
      '--filter',
      'leafbook...',
      '--filter',
      '!@marktext/file-icons',
      'licenses',
      'list',
      '--prod',
      '--json'
    ],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  if (licenseResult.status !== 0) {
    process.stderr.write(
      licenseResult.stderr ||
        `pnpm license inventory failed (status=${licenseResult.status}, signal=${licenseResult.signal ?? 'none'}).\n${licenseResult.stdout ?? ''}`
    )
    process.exitCode = 1
    return
  }

  let inventory
  try {
    inventory = JSON.parse(licenseResult.stdout)
  } catch {
    throw new Error('pnpm returned an invalid JSON license inventory')
  }

  const packagesByKey = new Map()
  for (const [reportedLicense, entries] of Object.entries(inventory)) {
    if (!Array.isArray(entries)) throw new Error(`Invalid pnpm license group: ${reportedLicense}`)
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !Array.isArray(entry.versions)) {
        throw new Error(`Invalid pnpm license entry in ${reportedLicense}`)
      }
      for (const version of entry.versions) {
        if (typeof version !== 'string' || version.length === 0) {
          throw new Error(`Invalid version for ${entry.name}`)
        }
        const key = `${entry.name}@${version}`
        let license = reportedLicense
        const override = reviewedLicenseOverrides.get(key)
        if (license === 'Unknown' || override) {
          if (!override) throw new Error(`Unreviewed transitive license: ${key}`)
          const packagePath = (entry.paths ?? []).find((candidate) =>
            candidate.endsWith(`/node_modules/${entry.name}`)
          )
          if (!packagePath) throw new Error(`Cannot locate reviewed license override: ${key}`)
          const licenseBytes = await readFile(path.join(packagePath, override.fileName))
          if (sha256(licenseBytes) !== override.sha256) {
            throw new Error(`Reviewed license bytes changed: ${key}`)
          }
          license = override.license
        }
        if (!allowedLicenses.has(license)) {
          throw new Error(`Disallowed transitive license ${license}: ${key}`)
        }
        const existing = packagesByKey.get(key)
        if (existing && existing.license !== license) {
          throw new Error(`Conflicting licenses for ${key}`)
        }
        packagesByKey.set(key, { name: entry.name, version, license })
      }
    }
  }

  // pnpm cannot read the index for the git-hosted implementation nested under
  // @marktext/file-icons on a clean GitHub runner. Its reviewed package
  // metadata and MIT license are checked into the repository's third-party
  // inventory, so bind the exact workspace package explicitly after excluding
  // the broken index from pnpm's traversal above.
  packagesByKey.set('@marktext/file-icons@1.0.6', {
    name: '@marktext/file-icons',
    version: '1.0.6',
    license: 'MIT'
  })

  for (const [relative, expectedName] of [
    ['packages/desktop/package.json', 'leafbook'],
    ['packages/muyajs/package.json', '@marktext/muyajs'],
    ['packages/muya/package.json', '@muyajs/core']
  ]) {
    const metadata = await readJson(relative)
    if (metadata.name !== expectedName || typeof metadata.version !== 'string') {
      throw new Error(`Unexpected workspace package identity: ${relative}`)
    }
    packagesByKey.set(`${metadata.name}@${metadata.version}`, {
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? 'MIT'
    })
  }

  const desktop = await readJson('packages/desktop/package.json')
  const packages = [...packagesByKey.values()]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'en') || left.version.localeCompare(right.version, 'en')
    )
    .map(({ name, version, license }) => ({
      SPDXID: spdxId(name, version),
      name,
      versionInfo: version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: license,
      copyrightText: 'NOASSERTION',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:npm/${purlName(name)}@${encodeURIComponent(version)}`
        }
      ]
    }))

  if (packages.length < policy.minimumPackageCount) {
    throw new Error(`Unexpectedly small transitive inventory: ${packages.length}`)
  }
  const rootId = spdxId(desktop.name, desktop.version)
  const relationships = packages
    .filter((pkg) => pkg.SPDXID !== rootId)
    .map((pkg) => ({
      spdxElementId: rootId,
      relationshipType: policy.relationshipType,
      relatedSpdxElement: pkg.SPDXID
    }))

  const payload = {
    spdxVersion: policy.spdxVersion,
    dataLicense: policy.dataLicense,
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `LeafBook-${desktop.version}`,
    creationInfo: {
      created: new Date(sourceDateEpoch * 1000).toISOString().replace('.000Z', 'Z'),
      creators: [`Tool: LeafBook generate-release-sbom.mjs/${SBOM_GENERATOR_VERSION}`]
    },
    documentDescribes: [rootId],
    packages,
    relationships
  }
  const sbom = buildSbomDocument({ version: desktop.version, payload })

  await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, { flag: 'w' })
  console.log(`Wrote SPDX 2.3 SBOM with ${packages.length} packages: ${outputPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate()
}
