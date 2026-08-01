/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const root = path.resolve(__dirname, '../../../../..')
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
const desktopVersion = (JSON.parse(read('packages/desktop/package.json')) as { version: string })
  .version
const runNode = (script: string, args: string[] = [], env?: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: env ?? process.env
  })
const fixedSourceDateEpoch = '1767225600'
const sourceDateEnv = (value?: string): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  if (value === undefined) delete env.SOURCE_DATE_EPOCH
  else env.SOURCE_DATE_EPOCH = value
  return env
}
const releaseCarrierNames = (version: string): string[] => [
  `leafbook-linux-x64-${version}.AppImage`,
  `leafbook-linux-x64-${version}.deb`,
  `leafbook-linux-x64-${version}.rpm`,
  `leafbook-linux-x64-${version}.tar.gz`,
  `leafbook-linux-arm64-${version}.AppImage`,
  `leafbook-linux-arm64-${version}.deb`,
  `leafbook-linux-arm64-${version}.rpm`,
  `leafbook-linux-arm64-${version}.tar.gz`,
  `leafbook-win-x64-${version}-setup.exe`,
  `leafbook-win-x64-${version}.zip`,
  `leafbook-win-arm64-${version}-setup.exe`,
  `leafbook-win-arm64-${version}.zip`,
  `leafbook-mac-x64-${version}.dmg`,
  `leafbook-mac-x64-${version}.zip`,
  `leafbook-mac-arm64-${version}.dmg`,
  `leafbook-mac-arm64-${version}.zip`
]
const removeFinalSnapshot = (directory: string): void => {
  const snapshot = path.join(directory, 'final-release')
  for (const relative of ['assets', 'evidence', '']) {
    const target = path.join(snapshot, relative)
    if (fs.existsSync(target)) fs.chmodSync(target, 0o700)
  }
  fs.rmSync(snapshot, { recursive: true, force: true })
  fs.rmSync(path.join(directory, 'final-release-state.json'), { force: true })
}

interface WorkflowStep {
  id?: string
  name?: string
  uses?: string
  run?: string
  shell?: string
  env?: Record<string, string>
  with?: Record<string, string>
  'continue-on-error'?: boolean
}

interface WorkflowValue {
  on: Record<string, unknown>
  jobs: Record<
    string,
    {
      env?: Record<string, string>
      permissions: Record<string, string>
      steps: WorkflowStep[]
    }
  >
}

describe('Phase 10C release-readiness definitions', () => {
  it('generates a deterministic transitive SPDX 2.3 inventory at the exact source time', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-sbom-test-'))
    try {
      const first = path.join(temporary, 'first.json')
      const second = path.join(temporary, 'second.json')
      expect(
        runNode('scripts/generate-release-sbom.mjs', [first], sourceDateEnv(fixedSourceDateEpoch))
          .status
      ).toBe(0)
      expect(
        runNode('scripts/generate-release-sbom.mjs', [second], sourceDateEnv(fixedSourceDateEpoch))
          .status
      ).toBe(0)
      expect(fs.readFileSync(first)).toEqual(fs.readFileSync(second))
      const sbom = JSON.parse(fs.readFileSync(first, 'utf8')) as {
        spdxVersion: string
        documentNamespace: string
        creationInfo: { created: string; creators: string[] }
        documentDescribes: string[]
        packages: Array<{ SPDXID: string; name: string; licenseDeclared: string }>
        relationships: unknown[]
      }
      expect(sbom.spdxVersion).toBe('SPDX-2.3')
      expect(sbom.creationInfo.created).toBe('2026-01-01T00:00:00Z')
      expect(sbom.creationInfo.creators).toEqual(['Tool: LeafBook generate-release-sbom.mjs/3'])
      expect(sbom.documentNamespace).toMatch(/\/sbom\/leafbook-[^/]+\/[a-f0-9]{64}$/u)
      expect(sbom.packages.length).toBeGreaterThan(100)
      expect(sbom.relationships).toHaveLength(sbom.packages.length - 1)
      expect(sbom.packages.some(({ name }) => name === 'leafbook')).toBe(true)
      expect(sbom.packages.some(({ licenseDeclared }) => licenseDeclared === 'Unknown')).toBe(false)
      expect(sbom.documentDescribes).toHaveLength(1)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('fails closed for missing, non-canonical, and out-of-range source epochs', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/generate-release-sbom.mjs')).href
    )) as {
      MAX_SOURCE_DATE_EPOCH: number
      parseSourceDateEpoch: (value: unknown) => number
    }
    expect(module.parseSourceDateEpoch('1')).toBe(1)
    expect(module.parseSourceDateEpoch(String(module.MAX_SOURCE_DATE_EPOCH))).toBe(
      module.MAX_SOURCE_DATE_EPOCH
    )
    for (const invalid of [
      undefined,
      '',
      '0',
      '-1',
      '+1',
      '01',
      '1.5',
      'not-a-time',
      String(module.MAX_SOURCE_DATE_EPOCH + 1),
      String(Number.MAX_SAFE_INTEGER + 1)
    ]) {
      expect(() => module.parseSourceDateEpoch(invalid), String(invalid)).toThrow()
      const temporary = path.join(os.tmpdir(), `leafbook-invalid-epoch-${process.pid}.json`)
      fs.rmSync(temporary, { force: true })
      const result = runNode(
        'scripts/generate-release-sbom.mjs',
        [temporary],
        sourceDateEnv(invalid)
      )
      expect(result.status, String(invalid)).not.toBe(0)
      expect(fs.existsSync(temporary), String(invalid)).toBe(false)
    }
  })

  it('binds the namespace to the complete canonical output payload without self-reference', async () => {
    type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/generate-release-sbom.mjs')).href
    )) as {
      canonicalJson: (value: JsonValue) => string
      digestSbomPayload: (payload: Record<string, JsonValue>) => string
      buildSbomDocument: (options: {
        version: string
        payload: Record<string, JsonValue>
      }) => Record<string, JsonValue>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-sbom-payload-test-'))
    try {
      const output = path.join(temporary, 'sbom.json')
      expect(
        runNode('scripts/generate-release-sbom.mjs', [output], sourceDateEnv(fixedSourceDateEpoch))
          .status
      ).toBe(0)
      const document = JSON.parse(fs.readFileSync(output, 'utf8')) as Record<string, JsonValue>
      const namespace = document.documentNamespace
      expect(typeof namespace).toBe('string')
      const { documentNamespace: ignored, ...payload } = document
      expect(ignored).toBe(namespace)
      const baseline = module.digestSbomPayload(payload)
      expect(namespace).toBe(
        `https://github.com/Jacquesxu666/leafbook/sbom/leafbook-${desktopVersion}/${baseline}`
      )
      expect(module.digestSbomPayload(structuredClone(payload))).toBe(baseline)
      expect(module.canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
        module.canonicalJson({ a: { b: 3, y: 2 }, z: 1 })
      )

      for (const [field, mutate] of [
        ['spdxVersion', (copy: Record<string, JsonValue>) => (copy.spdxVersion = 'SPDX-9.9')],
        ['dataLicense', (copy: Record<string, JsonValue>) => (copy.dataLicense = 'MIT')],
        ['SPDXID', (copy: Record<string, JsonValue>) => (copy.SPDXID = 'SPDXRef-Changed')],
        ['name', (copy: Record<string, JsonValue>) => (copy.name = 'LeafBook-changed')],
        [
          'creationInfo',
          (copy: Record<string, JsonValue>) => {
            const info = copy.creationInfo as Record<string, JsonValue>
            info.created = '2026-01-01T00:00:01Z'
          }
        ],
        [
          'documentDescribes',
          (copy: Record<string, JsonValue>) =>
            ((copy.documentDescribes as JsonValue[])[0] = 'SPDXRef-Changed')
        ],
        [
          'packages/injected inventory',
          (copy: Record<string, JsonValue>) => {
            const packages = copy.packages as Array<Record<string, JsonValue>>
            packages[0].licenseDeclared = 'LicenseRef-Injected'
          }
        ],
        [
          'relationships',
          (copy: Record<string, JsonValue>) => {
            const relationships = copy.relationships as Array<Record<string, JsonValue>>
            relationships[0].relationshipType = 'CONTAINS'
          }
        ]
      ] as Array<[string, (copy: Record<string, JsonValue>) => void]>) {
        const changed = structuredClone(payload)
        mutate(changed)
        expect(module.digestSbomPayload(changed), field).not.toBe(baseline)
        expect(
          module.buildSbomDocument({ version: desktopVersion, payload: changed }).documentNamespace,
          field
        ).not.toBe(namespace)
      }
      expect(() => module.digestSbomPayload(document)).toThrow('exclude documentNamespace')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('injects the exact checked-out commit timestamp before every workflow SBOM build', () => {
    for (const [relative, jobName] of [
      ['.github/workflows/release.yml', 'quality-gate'],
      ['.github/workflows/supply-chain-evidence.yml', 'attest-candidate'],
      ['.github/workflows/validate-licenses.yml', 'validate-licenses']
    ] as const) {
      const parsed = parseDocument(read(relative))
      expect(parsed.errors, relative).toEqual([])
      const steps = (parsed.toJS() as WorkflowValue).jobs[jobName]?.steps
      expect(steps, relative).toBeDefined()
      if (!steps) throw new Error(`Missing workflow job: ${relative}:${jobName}`)
      const bindingIndex = steps.findIndex(
        ({ name }) => name === 'Bind SBOM time to exact source commit'
      )
      const generationIndex = steps.findIndex(({ run }) => run?.includes('release-sbom'))
      expect(bindingIndex, relative).toBeGreaterThanOrEqual(0)
      expect(generationIndex, relative).toBeGreaterThan(bindingIndex)
      const binding = steps[bindingIndex]
      expect(binding?.shell, relative).toBe('bash')
      expect(binding?.run, relative).toContain(
        'git show -s --format=%ct "$' + '{GITHUB_SHA}^{commit}"'
      )
      expect(binding?.run, relative).toContain(
        'printf \'SOURCE_DATE_EPOCH=%s\\n\' "$source_date_epoch" >> "$GITHUB_ENV"'
      )
    }
  })

  it('writes and strictly verifies the complete top-level checksum set', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-checksum-test-'))
    try {
      fs.writeFileSync(path.join(temporary, 'b.zip'), 'b')
      fs.writeFileSync(path.join(temporary, 'a.dmg'), 'a')
      expect(runNode('scripts/release-checksums.mjs', ['write', temporary]).status).toBe(0)
      const manifest = fs.readFileSync(path.join(temporary, 'SHA256SUMS.txt'), 'utf8')
      expect(
        manifest
          .split('\n')
          .filter(Boolean)
          .map((line) => line.slice(66))
      ).toEqual(['a.dmg', 'b.zip'])
      expect(runNode('scripts/release-checksums.mjs', ['verify', temporary]).status).toBe(0)
      fs.writeFileSync(path.join(temporary, 'unmanifested.txt'), 'extra')
      expect(runNode('scripts/release-checksums.mjs', ['verify', temporary]).status).not.toBe(0)
      fs.rmSync(path.join(temporary, 'unmanifested.txt'))
      fs.mkdirSync(path.join(temporary, 'unexpected-directory'))
      expect(runNode('scripts/release-checksums.mjs', ['verify', temporary]).status).not.toBe(0)
      fs.rmSync(path.join(temporary, 'unexpected-directory'), { recursive: true })
      fs.writeFileSync(path.join(temporary, 'a.dmg'), 'changed')
      expect(runNode('scripts/release-checksums.mjs', ['verify', temporary]).status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('never follows a checksum-manifest symlink for write or verification', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-manifest-link-test-'))
    try {
      const evidence = path.join(temporary, 'evidence')
      const outside = path.join(temporary, 'outside-manifest.txt')
      const manifest = path.join(evidence, 'SHA256SUMS.txt')
      fs.mkdirSync(evidence)
      fs.writeFileSync(path.join(evidence, 'leafbook.zip'), 'carrier')
      expect(runNode('scripts/release-checksums.mjs', ['write', evidence]).status).toBe(0)
      const validManifest = fs.readFileSync(manifest, 'utf8')
      fs.rmSync(manifest)
      fs.writeFileSync(outside, validManifest)
      fs.symlinkSync('../outside-manifest.txt', manifest)

      expect(runNode('scripts/release-checksums.mjs', ['verify', evidence]).status).not.toBe(0)
      expect(runNode('scripts/release-checksums.mjs', ['write', evidence]).status).not.toBe(0)
      expect(fs.readFileSync(outside, 'utf8')).toBe(validManifest)

      const checksumScript = read('scripts/release-checksums.mjs')
      expect(checksumScript).toContain('constants.O_NOFOLLOW')
      expect(checksumScript).toContain('constants.O_EXCL')
      expect(checksumScript).toContain('await rename(temporaryPath, manifestPath)')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('never follows a checksum-subject symlink after manifest creation', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-subject-link-test-'))
    try {
      const evidence = path.join(temporary, 'evidence')
      const subject = path.join(evidence, 'leafbook.zip')
      const outside = path.join(temporary, 'outside.zip')
      fs.mkdirSync(evidence)
      fs.writeFileSync(subject, 'same-size')
      fs.writeFileSync(outside, 'same-size')
      expect(runNode('scripts/release-checksums.mjs', ['write', evidence]).status).toBe(0)
      fs.rmSync(subject)
      fs.symlinkSync('../outside.zip', subject)
      expect(runNode('scripts/release-checksums.mjs', ['verify', evidence]).status).not.toBe(0)
      expect(fs.readFileSync(outside, 'utf8')).toBe('same-size')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('stages an exact bounded carrier set before checksumming and uploading', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-evidence-test-'))
    try {
      const source = path.join(temporary, 'source')
      const evidence = path.join(temporary, 'evidence')
      fs.mkdirSync(source)
      const version = JSON.parse(read('packages/desktop/package.json')).version as string
      for (const name of [
        `leafbook-mac-arm64-${version}.dmg`,
        `leafbook-mac-arm64-${version}.zip`
      ]) {
        fs.writeFileSync(path.join(source, name), name)
      }
      fs.writeFileSync(path.join(source, 'not-uploaded.txt'), 'not evidence')
      expect(
        runNode('scripts/stage-release-evidence.mjs', ['macos', 'arm64', source, evidence]).status
      ).toBe(0)
      expect(runNode('scripts/release-checksums.mjs', ['verify', evidence]).status).toBe(0)
      expect(fs.readdirSync(evidence).sort()).toEqual([
        'SHA256SUMS.txt',
        `leafbook-mac-arm64-${version}.dmg`,
        `leafbook-mac-arm64-${version}.zip`
      ])
      expect(
        runNode('scripts/stage-release-evidence.mjs', [
          'macos',
          'x64',
          source,
          path.join(temporary, 'missing')
        ]).status
      ).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('uses no-follow descriptor streaming for staging and subject hashing', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-stage-link-test-'))
    try {
      const source = path.join(temporary, 'source')
      const destination = path.join(temporary, 'evidence')
      const outside = path.join(temporary, 'outside.dmg')
      const version = JSON.parse(read('packages/desktop/package.json')).version as string
      fs.mkdirSync(source)
      fs.writeFileSync(outside, 'outside')
      fs.symlinkSync(outside, path.join(source, `leafbook-mac-arm64-${version}.dmg`))
      fs.writeFileSync(path.join(source, `leafbook-mac-arm64-${version}.zip`), 'zip')
      expect(
        runNode('scripts/stage-release-evidence.mjs', ['macos', 'arm64', source, destination])
          .status
      ).not.toBe(0)
      expect(fs.readFileSync(outside, 'utf8')).toBe('outside')

      const stage = read('scripts/stage-release-evidence.mjs')
      const checksums = read('scripts/release-checksums.mjs')
      expect(stage).not.toContain('copyFile')
      expect(stage).toContain('constants.O_NOFOLLOW')
      expect(stage).toContain('constants.O_EXCL')
      expect(stage).toContain('sourceHandle.read(buffer')
      expect(checksums).not.toContain('readFile(')
      expect(checksums).toContain('handle.read(buffer')
      expect(checksums).toContain('Checksum subject set changed during verification')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('fails staging when a destination changes after its stable rehash', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-stage-race-test-'))
    try {
      const source = path.join(temporary, 'source')
      const destination = path.join(temporary, 'evidence')
      const version = JSON.parse(read('packages/desktop/package.json')).version as string
      fs.mkdirSync(source)
      for (const extension of ['dmg', 'zip']) {
        fs.writeFileSync(
          path.join(source, `leafbook-mac-arm64-${version}.${extension}`),
          `${extension}-carrier`
        )
      }
      const module = (await import(
        pathToFileURL(path.join(root, 'scripts/stage-release-evidence.mjs')).href
      )) as {
        stageReleaseEvidence: (options: {
          platform: string
          architecture: string
          sourceArgument: string
          destinationArgument: string
          afterDestinationHash: (state: { destination: string; expected: string[] }) => void
        }) => Promise<unknown>
      }
      await expect(
        module.stageReleaseEvidence({
          platform: 'macos',
          architecture: 'arm64',
          sourceArgument: source,
          destinationArgument: destination,
          afterDestinationHash: ({ destination: staged, expected }) => {
            const target = path.join(staged, expected[0])
            const before = fs.statSync(target)
            const descriptor = fs.openSync(target, 'r+')
            try {
              fs.writeSync(descriptor, Buffer.from('X'), 0, 1, 0)
            } finally {
              fs.closeSync(descriptor)
            }
            fs.utimesSync(target, before.atime, before.mtime)
          }
        })
      ).rejects.toThrow('Staged evidence changed after hashing')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('keeps attestation definition callable-only, least-privilege, and SHA-pinned', () => {
    const workflow = parseDocument(read('.github/workflows/supply-chain-evidence.yml'))
    expect(workflow.errors).toEqual([])
    const value = workflow.toJS() as WorkflowValue
    expect(Object.keys(value.on)).toEqual(['workflow_call'])
    const job = value.jobs['attest-candidate']
    expect(job.permissions).toEqual({
      contents: 'read',
      'id-token': 'write',
      attestations: 'write'
    })
    const attest = job.steps.filter((step) => step.uses?.startsWith('actions/attest@'))
    expect(attest).toHaveLength(2)
    for (const step of attest) {
      expect(step.uses).toBe('actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d')
      expect(step.with).toBeDefined()
      if (!step.with) throw new Error('Attestation step inputs are missing')
      expect(step['continue-on-error']).toBeUndefined()
    }
    expect(attest[0]?.with?.['subject-checksums']).toBe('candidate/dist/SHA256SUMS.txt')
    const sbomAttestation = attest[1]
    expect(sbomAttestation).toBeDefined()
    if (!sbomAttestation?.with) throw new Error('SBOM attestation inputs are missing')
    expect(sbomAttestation.with['subject-checksums']).toBe('evidence/SBOM-SUBJECTS.sha256')
    expect(sbomAttestation.with['sbom-path']).toBe('evidence/leafbook.spdx.json')
    const evidence = read('.github/workflows/supply-chain-evidence.yml')
    expect(evidence).toContain('len(manifest) != 16 or declared != expected')
    expect(evidence).not.toContain('candidate/dist/leafbook.spdx.json')
    expect(evidence).not.toContain('candidate/dist/RELEASE_NOTES.md')
  })

  it('accepts only the exact 16 carrier subjects for SBOM attestation', () => {
    const workflow = parseDocument(
      read('.github/workflows/supply-chain-evidence.yml')
    ).toJS() as WorkflowValue
    const gate = workflow.jobs['attest-candidate'].steps.find(
      ({ name }) => name === 'Verify audited carrier checksum set'
    )
    expect(gate?.run).toBeDefined()
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-sbom-subjects-test-'))
    try {
      const version = '0.1.0'
      const dist = path.join(temporary, 'candidate', 'dist')
      const desktop = path.join(temporary, 'packages', 'desktop')
      fs.mkdirSync(dist, { recursive: true })
      fs.mkdirSync(desktop, { recursive: true })
      fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ version }))
      for (const name of releaseCarrierNames(version)) {
        fs.writeFileSync(path.join(dist, name), `carrier:${name}`)
      }
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const trustedChecksums = path.join(root, 'scripts', 'release-checksums.mjs')
      const command = (gate?.run ?? '').replace(
        'node scripts/release-checksums.mjs',
        `node '${trustedChecksums}'`
      )
      const run = () => spawnSync('bash', ['-c', command], { cwd: temporary, encoding: 'utf8' })
      expect(run().status).toBe(0)

      fs.writeFileSync(path.join(dist, 'leafbook.spdx.json'), '{}')
      fs.writeFileSync(path.join(dist, 'RELEASE_NOTES.md'), '# injected')
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      expect(run().status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('defines fail-closed native workflows without claiming they ran', () => {
    for (const relative of [
      '.github/workflows/platform-evidence.yml',
      '.github/workflows/macos-signed-evidence.yml'
    ]) {
      const document = parseDocument(read(relative))
      expect(document.errors, relative).toEqual([])
      const triggers = Object.keys((document.toJS() as WorkflowValue).on)
      expect(triggers, relative).toContain('workflow_dispatch')
      expect(read(relative)).not.toContain('continue-on-error')
    }
    const platform = read('.github/workflows/platform-evidence.yml')
    expect(platform).toContain('ubuntu-24.04-arm')
    expect(platform).toContain('audit:platform-artifacts -- linux')
    expect(platform).toContain(
      'fedora@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814'
    )
    expect(platform).toContain('dnf install -y')
    expect(platform).toContain('stage-release-evidence.mjs')
    expect(platform).toContain('path: evidence/*')
    const mac = read('.github/workflows/macos-signed-evidence.yml')
    expect(mac).toContain('node scripts/preflight-mac-signing.mjs')
    expect(mac).toContain('--publish never -c.mac.notarize=true')
    expect(mac).toContain('xcrun stapler validate')
    expect(mac).toContain('spctl --assess')
    expect(mac).toContain('/Applications/LeafBook.app')
    expect(mac).toContain('open -n /Applications/LeafBook.app')
    expect(mac).toContain('stage-release-evidence.mjs')
    expect(mac).toContain('path: evidence/*')
  })

  it('keeps release metadata outside the explicitly enumerated build-carrier merge', () => {
    const workflow = parseDocument(read('.github/workflows/release.yml')).toJS() as WorkflowValue
    const assemble = workflow.jobs['assemble-release']
    const downloadAction = 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'
    const downloads = assemble.steps.filter(({ uses }) => uses === downloadAction)
    const buildArtifacts = [
      'leafbook-linux-x64-native-candidate',
      'leafbook-linux-arm64-native-candidate',
      'leafbook-windows-x64-signed-candidate',
      'leafbook-windows-arm64-signed-candidate',
      'leafbook-macos-x64-signed-candidate',
      'leafbook-macos-arm64-signed-candidate'
    ]
    expect(downloads.map((step) => step.with)).toEqual([
      { name: 'leafbook-linux-x64-native-candidate', path: 'native/linux-x64' },
      { name: 'leafbook-linux-x64-native-receipt', path: 'native-receipts/linux-x64' },
      { name: 'leafbook-linux-arm64-native-candidate', path: 'native/linux-arm64' },
      { name: 'leafbook-linux-arm64-native-receipt', path: 'native-receipts/linux-arm64' },
      { name: 'leafbook-windows-x64-signed-candidate', path: 'native/windows-x64' },
      { name: 'leafbook-windows-x64-native-receipt', path: 'native-receipts/windows-x64' },
      { name: 'leafbook-windows-arm64-signed-candidate', path: 'native/windows-arm64' },
      { name: 'leafbook-windows-arm64-native-receipt', path: 'native-receipts/windows-arm64' },
      { name: 'leafbook-macos-x64-signed-candidate', path: 'native/macos-x64' },
      { name: 'leafbook-macos-x64-native-receipt', path: 'native-receipts/macos-x64' },
      { name: 'leafbook-macos-arm64-signed-candidate', path: 'native/macos-arm64' },
      { name: 'leafbook-macos-arm64-native-receipt', path: 'native-receipts/macos-arm64' },
      { name: 'leafbook-release-metadata', path: 'release-metadata' }
    ])
    expect(downloads.some((step) => 'pattern' in (step.with ?? {}))).toBe(false)
    expect(downloads.some((step) => 'merge-multiple' in (step.with ?? {}))).toBe(false)

    const quality = workflow.jobs['quality-gate']
    const metadataUpload = quality.steps.find(({ name }) => name === 'Upload release metadata')
    expect(metadataUpload?.with).toMatchObject({
      name: 'leafbook-release-metadata',
      path:
        'release-evidence/METADATA_SHA256SUMS.txt\n' +
        'release-evidence/RELEASE_NOTES.md\n' +
        'release-evidence/leafbook.spdx.json\n'
    })

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-artifact-merge-test-'))
    try {
      const artifactStore = path.join(temporary, 'artifacts')
      const dist = path.join(temporary, 'dist')
      fs.mkdirSync(artifactStore)
      fs.mkdirSync(dist)
      const version = JSON.parse(read('packages/desktop/package.json')).version as string
      const carriersByArtifact: Record<string, string[]> = {
        'leafbook-linux-x64-native-candidate': [
          `leafbook-linux-x64-${version}.AppImage`,
          `leafbook-linux-x64-${version}.deb`,
          `leafbook-linux-x64-${version}.rpm`,
          `leafbook-linux-x64-${version}.tar.gz`
        ],
        'leafbook-linux-arm64-native-candidate': [
          `leafbook-linux-arm64-${version}.AppImage`,
          `leafbook-linux-arm64-${version}.deb`,
          `leafbook-linux-arm64-${version}.rpm`,
          `leafbook-linux-arm64-${version}.tar.gz`
        ],
        'leafbook-windows-x64-signed-candidate': [
          `leafbook-win-x64-${version}-setup.exe`,
          `leafbook-win-x64-${version}.zip`
        ],
        'leafbook-windows-arm64-signed-candidate': [
          `leafbook-win-arm64-${version}-setup.exe`,
          `leafbook-win-arm64-${version}.zip`
        ],
        'leafbook-macos-x64-signed-candidate': [
          `leafbook-mac-x64-${version}.dmg`,
          `leafbook-mac-x64-${version}.zip`
        ],
        'leafbook-macos-arm64-signed-candidate': [
          `leafbook-mac-arm64-${version}.dmg`,
          `leafbook-mac-arm64-${version}.zip`
        ]
      }
      for (const [artifact, carriers] of Object.entries(carriersByArtifact)) {
        const artifactDirectory = path.join(artifactStore, artifact)
        fs.mkdirSync(artifactDirectory)
        for (const carrier of carriers) {
          fs.writeFileSync(path.join(artifactDirectory, carrier), carrier)
        }
      }
      const metadataDirectory = path.join(artifactStore, 'leafbook-release-metadata')
      fs.mkdirSync(metadataDirectory)
      fs.writeFileSync(path.join(metadataDirectory, 'leafbook.spdx.json'), '{}')
      fs.writeFileSync(path.join(metadataDirectory, 'RELEASE_NOTES.md'), '# Notes')
      expect(
        runNode('scripts/release-checksums.mjs', [
          'write',
          metadataDirectory,
          'METADATA_SHA256SUMS.txt'
        ]).status
      ).toBe(0)
      expect(fs.readdirSync(metadataDirectory).sort()).toEqual([
        'METADATA_SHA256SUMS.txt',
        'RELEASE_NOTES.md',
        'leafbook.spdx.json'
      ])

      for (const artifact of buildArtifacts) {
        for (const carrier of fs.readdirSync(path.join(artifactStore, artifact))) {
          fs.copyFileSync(path.join(artifactStore, artifact, carrier), path.join(dist, carrier))
        }
      }
      const expectedCarriers = Object.values(carriersByArtifact).flat().sort()
      expect(expectedCarriers).toHaveLength(16)
      expect(fs.readdirSync(dist).sort()).toEqual(expectedCarriers)
      expect(fs.existsSync(path.join(dist, 'leafbook.spdx.json'))).toBe(false)
      expect(fs.existsSync(path.join(dist, 'RELEASE_NOTES.md'))).toBe(false)

      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      expect(runNode('scripts/release-checksums.mjs', ['verify', dist]).status).toBe(0)
      const checksumSubjects = fs
        .readFileSync(path.join(dist, 'SHA256SUMS.txt'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.slice(66))
        .sort()
      expect(checksumSubjects).toEqual(expectedCarriers)
      expect(fs.readdirSync(dist).sort()).toEqual([...expectedCarriers, 'SHA256SUMS.txt'].sort())
      const audit = read('scripts/audit-release-files.sh')
      const auditedCarriers = [...audit.matchAll(/^\s+"([^"]*\$version[^"]*)"$/gm)]
        .map((match) => match[1]?.replace('$version', version))
        .filter((carrier): carrier is string => carrier !== undefined)
        .sort()
      expect(auditedCarriers).toEqual(expectedCarriers)
      const draft = workflow.jobs['create-release'].steps.find(
        ({ name }) => name === 'Create draft release with assets'
      )
      expect(draft?.run).toContain('final-release/assets/*')
      expect(draft?.run).not.toContain('candidate/dist/*')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('keeps the license workflow read-only and watches every manifest it inventories', () => {
    const document = parseDocument(read('.github/workflows/validate-licenses.yml'))
    expect(document.errors).toEqual([])
    const workflow = document.toJS() as {
      on: {
        pull_request: { paths: string[] }
        push: { paths: string[] }
      }
      permissions: Record<string, string>
      jobs: Record<string, { 'timeout-minutes'?: number }>
    }
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs['validate-licenses']?.['timeout-minutes']).toBe(20)
    const requiredPaths = [
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'packages/desktop/package.json',
      'packages/muyajs/package.json',
      'packages/muya/package.json',
      'scripts/generate-release-sbom.mjs',
      'scripts/thirdPartyChecker.ts',
      'scripts/validateLicenses.ts',
      'scripts/verify-release-notes.mjs',
      'docs/RELEASE_NOTES.md'
    ]
    expect(workflow.on.pull_request.paths).toEqual(requiredPaths)
    expect(workflow.on.push.paths).toEqual(requiredPaths)
  })

  it('binds platform evidence to an exact tag and derives its channel', () => {
    const parsed = parseDocument(
      read('.github/workflows/platform-evidence.yml')
    ).toJS() as WorkflowValue & {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } }
    }
    expect(Object.keys(parsed.on.workflow_dispatch.inputs)).toEqual(['expected-commit'])
    expect(Object.keys(parsed.on)).toEqual(['workflow_dispatch', 'workflow_call'])
    const job = parsed.jobs['build-once']
    expect(job.env).toBeUndefined()
    const binding = job.steps[0]
    expect(binding?.name).toBe('Bind invocation to an exact release tag commit')
    expect(binding?.run).toBeDefined()
    const sha = 'c'.repeat(40)
    const runBinding = (overrides: NodeJS.ProcessEnv) =>
      spawnSync('bash', ['-c', binding?.run ?? 'exit 99'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REF_TYPE: 'tag',
          GITHUB_REF_NAME: 'v0.1.0',
          GITHUB_SHA: sha,
          EXPECTED_COMMIT: sha,
          ...overrides
        }
      })
    expect(runBinding({}).status).toBe(0)
    expect(runBinding({ GITHUB_REF_TYPE: 'branch' }).status).not.toBe(0)
    expect(runBinding({ GITHUB_SHA: 'd'.repeat(40) }).status).not.toBe(0)
    const metadata = job.steps.find(({ name }) => name === 'Validate exact tag and package version')
    expect(metadata?.run).toBe('node scripts/validate-release-tag.mjs "$GITHUB_REF_NAME"')
    expect(read('.github/workflows/platform-evidence.yml')).not.toContain('GITHUB_TOKEN:')
  })

  it('scopes signing secrets and binds manual mac evidence to the selected tag commit', () => {
    const workflow = parseDocument(
      read('.github/workflows/macos-signed-evidence.yml')
    ).toJS() as WorkflowValue
    const job = workflow.jobs['signed-notarized-candidate']
    expect(job.env).toBeUndefined()
    const secretSteps = job.steps.filter((step) =>
      JSON.stringify(step.env ?? {}).includes('secrets.CSC_LINK')
    )
    expect(secretSteps.map(({ name }) => name)).toEqual([
      'Block when protected signing inputs are unavailable',
      'Build signed and notarized carriers without publishing'
    ])
    for (const step of job.steps.filter((candidate) => !secretSteps.includes(candidate))) {
      expect(JSON.stringify(step)).not.toMatch(
        /secrets\.(?:CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID)/
      )
    }
    const binding = job.steps.find(
      ({ name }) => name === 'Bind invocation to an exact release tag commit'
    )
    expect(binding).toBeDefined()
    if (!binding) throw new Error('Manual ref binding step is missing')
    const bindingIndex = job.steps.indexOf(binding)
    const checkoutIndex = job.steps.findIndex(
      ({ name }) => name === 'Check out exact source revision'
    )
    const tagValidationIndex = job.steps.findIndex(
      ({ name }) => name === 'Validate exact tag and package version'
    )
    const setupIndex = job.steps.findIndex(
      ({ name }) => name === 'Setup frozen dependency graph without repository credentials'
    )
    expect(bindingIndex).toBe(0)
    expect(checkoutIndex).toBeGreaterThan(bindingIndex)
    expect(tagValidationIndex).toBeGreaterThan(checkoutIndex)
    expect(setupIndex).toBeGreaterThan(tagValidationIndex)
    expect(job.steps[checkoutIndex]?.with?.ref).toBe('$' + '{{ inputs.expected-commit }}')
    expect(binding.run).toBeDefined()
    const sha = 'a'.repeat(40)
    const runBinding = (overrides: NodeJS.ProcessEnv) =>
      spawnSync('bash', ['-c', binding.run ?? 'exit 99'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REF_TYPE: 'tag',
          GITHUB_REF_NAME: 'v0.1.0',
          GITHUB_SHA: sha,
          EXPECTED_COMMIT: sha,
          ARCHITECTURE: 'arm64',
          ...overrides
        }
      })
    expect(runBinding({}).status).toBe(0)
    expect(runBinding({ GITHUB_REF_TYPE: 'branch' }).status).not.toBe(0)
    expect(runBinding({ EXPECTED_COMMIT: 'b'.repeat(40) }).status).not.toBe(0)
  })

  it('blocks absent mac credentials without printing values', () => {
    const env = { ...process.env }
    for (const name of [
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID'
    ]) {
      delete env[name]
    }
    const result = runNode('scripts/preflight-mac-signing.mjs', [], env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'BLOCKED: missing macOS signing/notarization credential variables'
    )
    expect(result.stderr).toContain('CSC_LINK')
  })

  it('gates release notes and documents evidence boundaries and lifecycle', () => {
    expect(runNode('scripts/verify-release-notes.mjs').status).toBe(0)
    const installation = read('docs/INSTALLATION.md')
    const privacy = read('docs/PRIVACY_SECURITY.md')
    const checklist = read('docs/RELEASE_CHECKLIST.md')
    const gate = read('docs/RELEASE_GATE.md')
    const notes = read('docs/RELEASE_NOTES.md')
    const websiteRelease = read('packages/website/content/docs/dev/RELEASE.md')
    for (const phrase of ['upgrade', 'Uninstall', 'User-data locations', 'SHA256SUMS.txt']) {
      expect(installation).toContain(phrase)
    }
    expect(privacy).toContain('Workflow files are executable definitions')
    expect(privacy).toContain('not proof that a workflow ran')
    expect(checklist).toContain('Native platform evidence')
    expect(checklist).toContain('Environment-level secrets')
    expect(checklist).toContain('not repository-level')
    expect(checklist).toContain('cannot be passed')
    expect(checklist).toContain('`release` GitHub Environment')
    expect(checklist).toContain('each have `Jacquesxu666` configured as a required reviewer')
    expect(checklist).toContain('`prevent_self_review=false`')
    expect(checklist).toContain('owner can approve the deployment')
    expect(checklist).toContain('deployment branch/tag policy')
    expect(checklist).toContain(
      'If the project becomes multi-person, enable **Prevent self-review**'
    )
    expect(checklist).toContain('at least one independent required\n      reviewer')
    expect(checklist).toMatch(
      /selected tags matching\s+`v\*`,\s+with\s+branch\s+deployment\s+denied/u
    )
    expect(gate).toContain('provide no native, signing')
    expect(gate).toContain('declares no\n`workflow_call.secrets` contract')
    expect(gate).toContain('sole `contents: write` job declares `environment: release`')
    expect(gate).toContain('`Jacquesxu666` as a required reviewer on all three')
    expect(gate).toContain('`windows-signing`, `macos-signing`, and `release`')
    expect(gate).toContain('`prevent_self_review=false`')
    expect(gate).toContain('permits owner approval')
    expect(gate).toContain('If the project becomes multi-person, enable **Prevent self-review**')
    expect(gate).toContain('at least one independent reviewer')
    expect(gate).toMatch(/Environment existence alone is not a\s+protection boundary/u)
    expect(gate).toMatch(/selected tags matching\s+`v\*`,\s+with\s+branch\s+deployment\s+denied/u)
    expect(websiteRelease).toContain('Reusable-workflow callers cannot pass Environment\n  secrets')
    for (const field of [
      'macOS signing: required before draft',
      'macOS notarization: required before draft',
      'Windows native evidence: required before draft',
      'Linux native evidence: required before draft',
      'Hosted evidence review: required before publication'
    ]) {
      expect(notes).toContain(field)
    }
    expect(notes).toContain(
      'Workflow definitions and local test results are not retained hosted evidence'
    )
    expect(websiteRelease).toContain('macOS 4 + Windows 4 + Linux 8 carriers')
    expect(websiteRelease).toContain('It does not\npublish the draft')
    expect(websiteRelease).toContain('release drafts are created')
    expect(websiteRelease).not.toContain('The build matrix contains six jobs')
    expect(websiteRelease).not.toContain('merges\nthe six CI artifacts')
    expect(websiteRelease).not.toContain('published as a stable release')
  })

  it('rejects fake, empty, unstructured, and oversized release-note evidence', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-notes-test-'))
    const check = (name: string, contents: string) => {
      const file = path.join(temporary, name)
      fs.writeFileSync(file, contents)
      return runNode('scripts/verify-release-notes.mjs', [file])
    }
    try {
      const valid = read('docs/RELEASE_NOTES.md')
      expect(check('valid.md', valid).status).toBe(0)
      const demoted = valid.replace(/^# /gm, '### ')
      expect(check('fenced.md', `\`\`\`markdown\n${valid}\n\`\`\`\n${demoted}`).status).not.toBe(0)
      expect(check('commented.md', `<!--\n${valid}\n-->\n${demoted}`).status).not.toBe(0)
      expect(
        check(
          'empty.md',
          valid.replace(/## Highlights\n[\s\S]*?(?=## Security and privacy)/, '## Highlights\n\n')
        ).status
      ).not.toBe(0)
      expect(
        check(
          'wrong-field.md',
          valid.replace('- Public release approval: blocked', '- Public release approval: approved')
        ).status
      ).not.toBe(0)
      expect(check('oversized.md', `${valid}\n${'x'.repeat(128 * 1024)}`).status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('uses exact-set verification immediately before the draft write boundary', () => {
    const release = read('.github/workflows/release.yml')
    expect(release).toContain('scripts/release-checksums.mjs')
    expect(release).not.toContain('candidate/release-checksums.mjs')
    expect(release).toContain("root = 'candidate/dist'")
    expect(release).toContain("tag = os.environ.get('GITHUB_REF_NAME', '')")
    expect(release).toContain('if len(expected_subjects) != 16:')
    expect(release).toContain('if set(declared) != expected_subjects:')
    expect(release).toContain('root_before = os.lstat(root)')
    expect(release).toContain('entry.is_file(follow_symlinks=False)')
    expect(release).toContain('before.st_nlink != 1')
    expect(release).toContain("if name.endswith('.dmg'):")
    expect(release).toContain('carrier_limits[name] = 512 * 1024 * 1024')
    expect(release).toContain("snapshot_root = 'final-release'")
    expect(release).toContain('os.O_CREAT | os.O_EXCL | os.O_WRONLY')
    expect(release).toContain('while chunk := os.read(subject, 1024 * 1024):')
    expect(release).not.toContain('sha256sum --check --strict SHA256SUMS.txt')
  })

  it('runs the fixed write-job verifier without executing candidate code', () => {
    const workflow = parseDocument(read('.github/workflows/release.yml')).toJS() as WorkflowValue
    const verify = workflow.jobs['create-release'].steps.find(
      ({ name }) => name === 'Verify downloaded candidate checksums'
    )
    expect(verify?.run).toBeDefined()
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-write-job-verify-'))
    try {
      const version = '0.1.0'
      const dist = path.join(temporary, 'candidate', 'dist')
      fs.mkdirSync(dist, { recursive: true })
      for (const name of releaseCarrierNames(version)) {
        fs.writeFileSync(path.join(dist, name), `candidate:${name}`)
      }
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const snapshot = path.join(temporary, 'final-release')
      const resetSnapshot = () => removeFinalSnapshot(temporary)
      const run = (tag = `v${version}`) => {
        resetSnapshot()
        return spawnSync('bash', ['-c', verify?.run ?? 'exit 99'], {
          cwd: temporary,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_REF_NAME: tag }
        })
      }
      expect(run().status).toBe(0)
      const snapshotSubject = path.join(snapshot, 'assets', releaseCarrierNames(version)[0] ?? '')
      const snapshottedBytes = fs.readFileSync(snapshotSubject)
      fs.writeFileSync(path.join(dist, releaseCarrierNames(version)[0] ?? ''), 'post-copy mutation')
      expect(fs.readFileSync(snapshotSubject)).toEqual(snapshottedBytes)
      fs.writeFileSync(
        path.join(dist, releaseCarrierNames(version)[0] ?? ''),
        `candidate:${releaseCarrierNames(version)[0] ?? ''}`
      )
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      expect(run('vnot-semver').status).not.toBe(0)

      fs.writeFileSync(path.join(dist, 'unmanifested.bin'), 'extra')
      expect(run().status).not.toBe(0)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      expect(run().status).not.toBe(0)
      fs.rmSync(path.join(dist, 'unmanifested.bin'), { force: true })
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)

      const subjectName = releaseCarrierNames(version)[0]
      if (!subjectName) throw new Error('Missing release carrier fixture')
      const subject = path.join(dist, subjectName)
      const hardLink = path.join(temporary, 'carrier-hard-link')
      fs.linkSync(subject, hardLink)
      expect(run().status).not.toBe(0)
      fs.rmSync(hardLink)

      const original = fs.readFileSync(subject)
      fs.writeFileSync(subject, '')
      expect(run().status).not.toBe(0)
      fs.writeFileSync(subject, original)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)

      fs.truncateSync(subject, 8 * 1024 * 1024)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const sparseCarrier = fs.statSync(subject)
      if (sparseCarrier.blocks * 512 < sparseCarrier.size / 2) {
        expect(run().status).not.toBe(0)
      }
      fs.writeFileSync(subject, original)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)

      fs.truncateSync(subject, 512 * 1024 * 1024 + 1)
      expect(run().status).not.toBe(0)
      fs.writeFileSync(subject, original)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)

      const realDist = path.join(temporary, 'candidate', 'real-dist')
      fs.renameSync(dist, realDist)
      fs.symlinkSync('real-dist', dist)
      expect(run().status).not.toBe(0)
      fs.rmSync(dist)
      fs.renameSync(realDist, dist)

      const ctimeRace = (verify?.run ?? '').replace(
        '    final = os.lstat(subject_path)',
        `    if name == '${subjectName}':
        race_mtime = opened.st_mtime_ns
        race_atime = opened.st_atime_ns
        with open(subject_path, 'r+b') as race_file:
            race_file.write(b'X')
        os.utime(subject_path, ns=(race_atime, race_mtime))
    final = os.lstat(subject_path)`
      )
      expect(ctimeRace).not.toBe(verify?.run)
      resetSnapshot()
      expect(
        spawnSync('bash', ['-c', ctimeRace], {
          cwd: temporary,
          env: { ...process.env, GITHUB_REF_NAME: `v${version}` }
        }).status
      ).not.toBe(0)

      fs.writeFileSync(subject, original)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const lateCarrierRace = (verify?.run ?? '').replace(
        'final_actual = set()',
        `late_path = os.path.join(root, '${subjectName}')
late_before = os.lstat(late_path)
with open(late_path, 'r+b') as race_file:
    race_file.write(b'X')
os.utime(late_path, ns=(late_before.st_atime_ns, late_before.st_mtime_ns))
final_actual = set()`
      )
      expect(lateCarrierRace).not.toBe(verify?.run)
      resetSnapshot()
      expect(
        spawnSync('bash', ['-c', lateCarrierRace], {
          cwd: temporary,
          env: { ...process.env, GITHUB_REF_NAME: `v${version}` }
        }).status
      ).not.toBe(0)

      fs.writeFileSync(subject, original)
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const lateManifestRace = (verify?.run ?? '').replace(
        'final_actual = set()',
        `late_before = os.lstat(manifest_path)
with open(manifest_path, 'r+b') as race_file:
    race_file.write(b'X')
os.utime(manifest_path, ns=(late_before.st_atime_ns, late_before.st_mtime_ns))
final_actual = set()`
      )
      expect(lateManifestRace).not.toBe(verify?.run)
      resetSnapshot()
      expect(
        spawnSync('bash', ['-c', lateManifestRace], {
          cwd: temporary,
          env: { ...process.env, GITHUB_REF_NAME: `v${version}` }
        }).status
      ).not.toBe(0)

      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const setRace = (verify?.run ?? '').replace(
        'final_actual = set()',
        `with open(os.path.join(root, 'unmanifested.bin'), 'wb') as race_file:
    race_file.write(b'extra')
final_actual = set()`
      )
      expect(setRace).not.toBe(verify?.run)
      resetSnapshot()
      expect(
        spawnSync('bash', ['-c', setRace], {
          cwd: temporary,
          env: { ...process.env, GITHUB_REF_NAME: `v${version}` }
        }).status
      ).not.toBe(0)
      expect(verify?.run).not.toMatch(/(?:node|python3)\s+candidate\//)
    } finally {
      removeFinalSnapshot(temporary)
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('reverifies exact metadata checksums and the formal notes used by the draft', () => {
    const workflow = parseDocument(read('.github/workflows/release.yml')).toJS() as WorkflowValue
    const create = workflow.jobs['create-release']
    const verifyCarriers = create.steps.find(
      ({ name }) => name === 'Verify downloaded candidate checksums'
    )
    const verify = create.steps.find(
      ({ name }) => name === 'Reverify exact metadata and formal draft notes'
    )
    expect(verify?.run).toBeDefined()
    expect(verifyCarriers?.run).toBeDefined()
    expect(verify?.id).toBe('final-snapshot')
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-draft-notes-test-'))
    try {
      const metadata = path.join(temporary, 'candidate', 'release-metadata')
      const dist = path.join(temporary, 'candidate', 'dist')
      fs.mkdirSync(metadata, { recursive: true })
      fs.mkdirSync(dist, { recursive: true })
      const version = '0.1.0'
      const commit = 'a'.repeat(40)
      for (const name of releaseCarrierNames(version)) {
        fs.writeFileSync(path.join(dist, name), `candidate:${name}`)
      }
      expect(runNode('scripts/release-checksums.mjs', ['write', dist]).status).toBe(0)
      const notes = read('docs/RELEASE_NOTES.md')
      fs.writeFileSync(path.join(metadata, 'RELEASE_NOTES.md'), notes)
      fs.writeFileSync(path.join(metadata, 'leafbook.spdx.json'), '{"spdxVersion":"SPDX-2.3"}\n')
      expect(
        runNode('scripts/release-checksums.mjs', ['write', metadata, 'METADATA_SHA256SUMS.txt'])
          .status
      ).toBe(0)
      const banner =
        '## Pre-release candidate\n\nThis draft is not approved for public release.\n\n'
      const body = path.join(temporary, 'candidate', 'release_body.md')
      const githubOutput = path.join(temporary, 'github-output.txt')
      fs.writeFileSync(githubOutput, '')
      fs.writeFileSync(body, `${banner}${notes}`)
      const resetSnapshot = () => {
        removeFinalSnapshot(temporary)
      }
      const prepareSnapshot = () => {
        resetSnapshot()
        return spawnSync('bash', ['-c', verifyCarriers?.run ?? 'exit 99'], {
          cwd: temporary,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_REF_NAME: `v${version}`, GITHUB_SHA: commit }
        })
      }
      const run = () => {
        fs.writeFileSync(githubOutput, '')
        return spawnSync('bash', ['-c', verify?.run ?? 'exit 99'], {
          cwd: temporary,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_REF_NAME: `v${version}`,
            GITHUB_SHA: commit,
            GITHUB_OUTPUT: githubOutput,
            IS_PRERELEASE: 'true'
          }
        })
      }
      const outputDigest = () => {
        const match = /^state_sha256=([0-9a-f]{64})$/m.exec(fs.readFileSync(githubOutput, 'utf8'))
        if (!match?.[1]) throw new Error('Missing trusted snapshot digest output')
        return match[1]
      }
      expect(prepareSnapshot().status).toBe(0)
      expect(run().status).toBe(0)
      const trustedStateDigest = outputDigest()
      const snapshotBody = path.join(temporary, 'final-release', 'release_body.md')
      const snapshottedBody = fs.readFileSync(snapshotBody)
      fs.appendFileSync(body, 'injected')
      expect(fs.readFileSync(snapshotBody)).toEqual(snapshottedBody)
      const createDraft = create.steps.find(
        ({ name }) => name === 'Create draft release with assets'
      )
      const finalVerifier = (createDraft?.run ?? '').split(
        '# Fixed remote preflight immediately before the repository write.'
      )[0]
      expect(finalVerifier).toContain('Final release snapshot fully reverified')
      const finalResult = spawnSync('bash', ['-c', finalVerifier], {
        cwd: temporary,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REF_NAME: `v${version}`,
          GITHUB_SHA: commit,
          EXPECTED_STATE_SHA256: trustedStateDigest,
          IS_PRERELEASE: 'true'
        }
      })
      expect(finalResult.status, finalResult.stderr).toBe(0)
      fs.chmodSync(snapshotBody, 0o600)
      fs.appendFileSync(snapshotBody, 'snapshot mutation')
      expect(
        spawnSync('bash', ['-c', finalVerifier], {
          cwd: temporary,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_REF_NAME: `v${version}`,
            GITHUB_SHA: commit,
            EXPECTED_STATE_SHA256: trustedStateDigest,
            IS_PRERELEASE: 'true'
          }
        }).status
      ).not.toBe(0)

      fs.writeFileSync(body, `${banner}${notes}`)
      expect(prepareSnapshot().status).toBe(0)
      expect(run().status).toBe(0)
      const replacementStateDigest = outputDigest()
      expect(replacementStateDigest).not.toBe(trustedStateDigest)
      const verifyReplacement = (expectedDigest: string) =>
        spawnSync('bash', ['-c', finalVerifier], {
          cwd: temporary,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_REF_NAME: `v${version}`,
            GITHUB_SHA: commit,
            EXPECTED_STATE_SHA256: expectedDigest,
            IS_PRERELEASE: 'true'
          }
        })
      expect(verifyReplacement(replacementStateDigest).status).toBe(0)
      expect(verifyReplacement(trustedStateDigest).status).not.toBe(0)

      fs.appendFileSync(body, 'injected')
      expect(prepareSnapshot().status).toBe(0)
      expect(run().status).not.toBe(0)
      fs.writeFileSync(body, `${banner}${notes}`)

      expect(prepareSnapshot().status).toBe(0)
      fs.writeFileSync(path.join(metadata, 'unexpected.txt'), 'extra')
      expect(run().status).not.toBe(0)
      fs.rmSync(path.join(metadata, 'unexpected.txt'))

      expect(prepareSnapshot().status).toBe(0)
      const notesLink = path.join(temporary, 'notes-hard-link')
      fs.linkSync(path.join(metadata, 'RELEASE_NOTES.md'), notesLink)
      expect(run().status).not.toBe(0)
      fs.rmSync(notesLink)

      expect(prepareSnapshot().status).toBe(0)
      fs.truncateSync(path.join(metadata, 'leafbook.spdx.json'), 8 * 1024 * 1024)
      expect(
        runNode('scripts/release-checksums.mjs', ['write', metadata, 'METADATA_SHA256SUMS.txt'])
          .status
      ).toBe(0)
      const sparseSbom = fs.statSync(path.join(metadata, 'leafbook.spdx.json'))
      if (sparseSbom.blocks * 512 < sparseSbom.size / 2) {
        expect(run().status).not.toBe(0)
      }

      expect(prepareSnapshot().status).toBe(0)
      fs.truncateSync(path.join(metadata, 'leafbook.spdx.json'), 16 * 1024 * 1024 + 1)
      expect(
        runNode('scripts/release-checksums.mjs', ['write', metadata, 'METADATA_SHA256SUMS.txt'])
          .status
      ).toBe(0)
      expect(run().status).not.toBe(0)
      expect(verify?.run).not.toMatch(/(?:node|python3)\s+candidate\//)

      expect(createDraft?.run).toContain('--notes-file final-release/release_body.md')
      expect(createDraft?.env?.EXPECTED_STATE_SHA256).toBe(
        '$' + '{{ steps.final-snapshot.outputs.state_sha256 }}'
      )
      expect(createDraft?.run).toContain('hmac.compare_digest(actual_state_digest')
      expect(createDraft?.run).toContain('set(carrier_manifest) != expected_carriers')
      expect(createDraft?.run).toContain(
        "set(metadata_manifest) != {'RELEASE_NOTES.md', 'leafbook.spdx.json'}"
      )
      expect(createDraft?.run).toContain('expected_body =')
      expect(createDraft?.run).not.toContain('--generate-notes')
      expect(createDraft?.run).toContain('final-release/assets/*')
      expect(createDraft?.run).not.toContain('candidate/dist/*')
      expect(read('.github/workflows/release.yml')).not.toContain('xattr -cr')
    } finally {
      removeFinalSnapshot(temporary)
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
