/* eslint-disable @stylistic/space-before-function-paren */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const root = path.resolve(__dirname, '../../../../..')
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
const parseWorkflow = (relative: string) => {
  const document = parseDocument(read(relative), { merge: false, strict: true, uniqueKeys: true })
  expect(document.errors, relative).toEqual([])
  return document.toJS({ maxAliasCount: 0 }) as {
    on: Record<string, unknown>
    permissions: Record<string, string>
    jobs: Record<
      string,
      {
        environment?: string
        needs?: string | string[]
        permissions?: Record<string, string>
        'runs-on': string
        'timeout-minutes'?: number
        steps: Array<{
          name?: string
          uses?: string
          run?: string
          env?: Record<string, string>
          with?: Record<string, string | boolean>
        }>
      }
    >
  }
}

describe('Phase 10D native release evidence', () => {
  it('defines the exact 16-carrier contract with architecture-qualified Linux names and no Snap', () => {
    const builder = read('packages/desktop/electron-builder.yml')
    const release = read('.github/workflows/release.yml')
    const supplyChain = read('.github/workflows/supply-chain-evidence.yml')
    const prBuild = read('.github/workflows/build.yml')
    const audit = read('scripts/audit-release-files.sh')
    const staging = read('scripts/stage-release-evidence.mjs')
    expect(builder).toContain(
      ["artifactName: 'leafbook-linux-", '$', '{arch}-', '$', '{version}.', '$', "{ext}'"].join('')
    )
    expect(builder).not.toMatch(/^\s+- snap$/mu)
    for (const arch of ['x64', 'arm64']) {
      for (const extension of ['AppImage', 'deb', 'rpm', 'tar.gz']) {
        const releaseName = `leafbook-linux-${arch}-{version}.${extension}`
        expect(release).toContain(`f'${releaseName}'`)
        expect(supplyChain).toContain(`f'${releaseName}'`)
        expect(audit).toContain(`"leafbook-linux-${arch}-$version.${extension}"`)
      }
    }
    expect(release).toContain('if len(expected_subjects) != 16:')
    expect(supplyChain).toContain('len(manifest) != 16 or declared != expected')
    expect(prBuild).toContain(['pnpm run build:linux:', '$', '{{ matrix.arch }}'].join(''))
    expect(prBuild).toContain('ubuntu-24.04-arm')
    for (const value of [release, supplyChain, audit, staging, prBuild]) {
      expect(value).not.toMatch(/leafbook-linux-[^\n'"`]*\.snap/u)
    }
  })

  it('keeps protected Windows signing in build jobs and validation on fresh unprivileged jobs', () => {
    const workflow = parseWorkflow('.github/workflows/windows-signed-evidence.yml')
    expect(workflow.permissions).toEqual({ contents: 'read' })
    const workflowCall = workflow.on.workflow_call as Record<string, unknown>
    expect(workflowCall).not.toHaveProperty('secrets')
    const build = workflow.jobs['signed-build']
    const validation = workflow.jobs['fresh-runtime-validation']
    expect(
      Object.values(workflow.jobs).filter((job) => job.permissions?.contents === 'write')
    ).toEqual([])
    expect(build.environment).toBe('windows-signing')
    expect(validation.environment).toBeUndefined()
    expect(validation.needs).toBe('signed-build')
    expect(build['timeout-minutes']).toBeGreaterThan(0)
    expect(validation['timeout-minutes']).toBeGreaterThan(0)
    const secretSteps = build.steps.filter((step) =>
      JSON.stringify(step.env ?? {}).includes('secrets.WIN_CSC_')
    )
    expect(secretSteps.map(({ name }) => name)).toEqual([
      'Build signed Windows carriers without publishing'
    ])
    expect(secretSteps[0]?.env).toEqual({
      WIN_CSC_LINK: '$' + '{{ secrets.WIN_CSC_LINK }}',
      WIN_CSC_KEY_PASSWORD: '$' + '{{ secrets.WIN_CSC_KEY_PASSWORD }}'
    })
    const allSecretReferences = Object.entries(workflow.jobs).flatMap(([jobName, job]) =>
      job.steps
        .filter((step) => JSON.stringify(step).includes('secrets.'))
        .map((step) => `${jobName}:${step.name ?? ''}`)
    )
    expect(allSecretReferences).toEqual([
      'signed-build:Build signed Windows carriers without publishing'
    ])
    expect(JSON.stringify(validation)).not.toContain('secrets.')
    const definition = read('.github/workflows/windows-signed-evidence.yml')
    expect(definition.match(/\$\{\{ secrets\./gu)).toHaveLength(2)
    expect(read('scripts/verify-windows-authenticode.ps1')).toContain(
      "policy = 'authenticode-valid-v1'"
    )
    expect(definition).toContain("@('md','markdown','mmd','mdown','mdtxt','mdtext','mdx')")
    expect(definition).toContain("@('leafbook','com.jacquesxu.leafbook')")
    expect(definition).toContain('ArgumentList @(\'/S\', "/D=$install")')
    expect(definition).toContain("ArgumentList '/S'")
    expect(definition).toContain('Start-Process -FilePath $executable')
    expect(definition).toContain('Expected per-user shortcuts are missing.')
    expect(definition).toContain(
      'Executable, install directory, or shortcuts remain after uninstall.'
    )
    expect(definition).not.toMatch(/--publish\s+(?:always|onTagOrDraft|onTag)/u)
    expect(definition).toContain('image = $env:ImageOS')
    expect(definition).toContain('imageId = $env:ImageVersion')
    expect(definition).toContain("Write-Observation 'install'")
    expect(definition).toContain("Write-Observation 'residue'")
  })

  it('builds Linux once and performs the RPM lifecycle in pinned Fedora', () => {
    const workflow = parseWorkflow('.github/workflows/platform-evidence.yml')
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch', 'workflow_call'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    const build = workflow.jobs['build-once']
    const fresh = workflow.jobs['fresh-portable-and-deb-validation']
    const rpm = workflow.jobs['rpm-native-validation']
    const finalReceipt = workflow.jobs['final-native-receipt']
    expect(JSON.stringify(build)).toContain('ubuntu-24.04')
    expect(JSON.stringify(build)).toContain('ubuntu-24.04-arm')
    expect(fresh.needs).toBe('build-once')
    expect(JSON.stringify(fresh)).toContain('APPIMAGE_EXTRACT_AND_RUN=1')
    expect(JSON.stringify(fresh)).toContain('tar -xzf')
    expect(JSON.stringify(fresh)).toContain('sudo apt-get purge -y leafbook')
    expect(JSON.stringify(rpm)).toContain(
      'fedora@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814'
    )
    expect(JSON.stringify(rpm)).toContain('dnf install -y')
    expect(JSON.stringify(rpm)).toContain('dnf remove -y leafbook')
    expect(JSON.stringify(rpm)).toContain('lifecycle-write')
    expect(JSON.stringify(rpm)).toContain('rpm-lifecycle.json')
    expect(JSON.stringify(rpm)).not.toContain('rpm --nodeps')
    const freshCommands = fresh.steps.findIndex(
      ({ name }) => name === 'Install, run, integrate, and purge the exact deb bytes'
    )
    const freshReport = fresh.steps.findIndex(
      ({ name }) => name === 'Generate strict portable and deb lifecycle reports on this runner'
    )
    const freshUpload = fresh.steps.findIndex(
      ({ name }) => name === 'Upload runner-bound portable and deb lifecycle evidence'
    )
    expect(freshCommands).toBeGreaterThanOrEqual(0)
    expect(freshReport).toBeGreaterThan(freshCommands)
    expect(freshUpload).toBeGreaterThan(freshReport)
    const portableRun = fresh.steps.find(
      ({ name }) => name === 'Observe each portable lifecycle stage after its checks'
    )?.run
    expect(portableRun?.indexOf('tar -xzf')).toBeLessThan(
      portableRun?.indexOf('record_stage install') ?? -1
    )
    expect(portableRun?.lastIndexOf('kill -0 "$pid"')).toBeLessThan(
      portableRun?.indexOf('record_stage smoke') ?? -1
    )
    expect(portableRun?.indexOf('rm -rf "$root"')).toBeLessThan(
      portableRun?.indexOf('record_stage uninstall') ?? -1
    )
    expect(portableRun?.indexOf('[[ ! -e "$root" ]]')).toBeLessThan(
      portableRun?.indexOf('record_stage residue') ?? -1
    )
    const rpmCommands = rpm.steps.findIndex(
      ({ name }) => name === 'Observe each RPM lifecycle stage inside fresh Fedora'
    )
    const rpmReport = rpm.steps.findIndex(
      ({ name }) => name === 'Generate strict RPM lifecycle report after dnf removal'
    )
    const rpmUpload = rpm.steps.findIndex(
      ({ name }) => name === 'Upload runner-bound Fedora RPM lifecycle evidence'
    )
    expect(rpmCommands).toBeGreaterThanOrEqual(0)
    expect(rpmReport).toBeGreaterThan(rpmCommands)
    expect(rpmUpload).toBeGreaterThan(rpmReport)
    const rpmRun = rpm.steps[rpmCommands]?.run
    expect(rpmRun?.indexOf('dnf install -y')).toBeLessThan(
      rpmRun?.indexOf('record_stage install') ?? -1
    )
    expect(rpmRun?.indexOf('kill -0 "$app_pid"')).toBeLessThan(
      rpmRun?.indexOf('record_stage smoke') ?? -1
    )
    expect(rpmRun?.indexOf('dnf remove -y leafbook')).toBeLessThan(
      rpmRun?.indexOf('record_stage uninstall') ?? -1
    )
    expect(rpmRun?.indexOf('test ! -e /opt/LeafBook')).toBeLessThan(
      rpmRun?.indexOf('record_stage residue') ?? -1
    )
    expect(JSON.stringify(finalReceipt.needs)).toContain('rpm-native-validation')
    expect(JSON.stringify(finalReceipt)).toContain('portable-lifecycle.json')
    expect(JSON.stringify(finalReceipt)).toContain('deb-lifecycle.json')
    expect(JSON.stringify(finalReceipt)).toContain('rpm-lifecycle.json')
    expect(JSON.stringify(finalReceipt)).not.toContain('--runner-label')
    expect(read('.github/workflows/platform-evidence.yml')).not.toContain('GITHUB_TOKEN:')
    expect(read('scripts/native-evidence-receipt.mjs')).not.toContain('passedPhases')
    expect(read('.github/workflows/windows-signed-evidence.yml')).not.toContain(
      'windows-native-runner'
    )
  })

  it('pins every third-party workflow action and gives every native job a timeout', () => {
    const officialAction = /^[a-z0-9_.-]+\/[a-z0-9_.-]+@[0-9a-f]{40}$/iu
    for (const relative of [
      '.github/workflows/platform-evidence.yml',
      '.github/workflows/windows-signed-evidence.yml',
      '.github/workflows/build.yml'
    ]) {
      const workflow = parseWorkflow(relative)
      for (const job of Object.values(workflow.jobs)) {
        expect(job['timeout-minutes'], `${relative}:${job['runs-on']}`).toBeGreaterThan(0)
        for (const step of job.steps) {
          if (step.uses?.startsWith('actions/')) expect(step.uses).toMatch(officialAction)
          if (step.uses?.startsWith('actions/checkout@')) {
            expect(step.with?.['persist-credentials']).toBe(false)
          }
        }
      }
    }
    const prBuild = read('.github/workflows/build.yml')
    expect(prBuild).toContain('peter-evans/find-comment@3eae4d37986fb5a8592848f6a574fdf654e61f9e')
    expect(prBuild).toContain(
      'peter-evans/create-or-update-comment@71345be0265236311c031f5c7866368bd1eff043'
    )
  })

  it('keeps macOS signing build-only and consumes only fresh-validated signed bytes', () => {
    const workflow = parseWorkflow('.github/workflows/macos-signed-evidence.yml')
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch', 'workflow_call'])
    const workflowCall = workflow.on.workflow_call as Record<string, unknown>
    expect(workflowCall).not.toHaveProperty('secrets')
    const build = workflow.jobs['signed-notarized-candidate']
    const validation = workflow.jobs['fresh-native-validation']
    expect(
      Object.values(workflow.jobs).filter((job) => job.permissions?.contents === 'write')
    ).toEqual([])
    expect(build.environment).toBe('macos-signing')
    expect(validation.environment).toBeUndefined()
    expect(validation.needs).toBe('signed-notarized-candidate')
    expect(build['timeout-minutes']).toBeGreaterThan(0)
    expect(validation['timeout-minutes']).toBeGreaterThan(0)
    expect(JSON.stringify(build)).not.toContain('/Applications/LeafBook.app')
    expect(JSON.stringify(build)).not.toContain('open -n')
    expect(JSON.stringify(build)).not.toContain('codesign --verify')
    expect(JSON.stringify(validation)).not.toContain('secrets.')
    expect(JSON.stringify(validation)).toContain('codesign --verify')
    expect(JSON.stringify(validation)).toContain('xcrun stapler validate')
    expect(JSON.stringify(validation)).toContain('spctl --assess')
    expect(JSON.stringify(validation)).toContain('/Applications/LeafBook.app')
    expect(JSON.stringify(validation)).toContain('macos-native-evidence.mjs write')
    expect(read('.github/workflows/macos-signed-evidence.yml')).not.toContain('GITHUB_TOKEN:')
    const allSecretReferences = Object.entries(workflow.jobs).flatMap(([jobName, job]) =>
      job.steps
        .filter((step) => JSON.stringify(step).includes('secrets.'))
        .map((step) => `${jobName}:${step.name ?? ''}`)
    )
    expect(allSecretReferences).toEqual([
      'signed-notarized-candidate:Block when protected signing inputs are unavailable',
      'signed-notarized-candidate:Build signed and notarized carriers without publishing'
    ])
    expect(
      read('.github/workflows/macos-signed-evidence.yml').match(/\$\{\{ secrets\./gu)
    ).toHaveLength(10)

    const release = parseDocument(read('.github/workflows/release.yml')).toJS({
      maxAliasCount: 0
    }) as {
      jobs: Record<
        string,
        {
          uses?: string
          with?: Record<string, string>
          secrets?: Record<string, string>
          steps?: unknown[]
        }
      >
    }
    for (const architecture of ['x64', 'arm64']) {
      const job = release.jobs[`macos-${architecture}-native-evidence`]
      expect(job?.uses).toBe('./.github/workflows/macos-signed-evidence.yml')
      expect(job?.with?.architecture).toBe(architecture)
      expect(job?.secrets).toBeUndefined()
    }
    expect(release.jobs['unsigned-mac-validation']).toBeUndefined()
    const releaseText = read('.github/workflows/release.yml')
    expect(releaseText).toContain('leafbook-macos-x64-signed-candidate')
    expect(releaseText).toContain('leafbook-macos-arm64-signed-candidate')
    expect(releaseText).toContain('leafbook-macos-native-evidence-v1')
    expect(releaseText).not.toContain('name: leafbook-macos-x64\n')
    expect(releaseText).not.toContain('name: leafbook-macos-arm64\n')
  })

  it('expands dependency setup and proves frozen install receives no GitHub token', () => {
    const document = parseDocument(read('.github/actions/setup/action.yml'), {
      merge: false,
      strict: true,
      uniqueKeys: true
    })
    expect(document.errors).toEqual([])
    const action = document.toJS({ maxAliasCount: 0 }) as {
      runs: {
        using: string
        steps: Array<{
          name?: string
          run?: string
          env?: Record<string, string>
          uses?: string
          shell?: string
          with?: Record<string, string>
        }>
      }
    }
    expect(action.runs.using).toBe('composite')
    const setupNodeSteps = action.runs.steps.filter(({ uses }) =>
      uses?.startsWith('actions/setup-node@')
    )
    expect(setupNodeSteps.length).toBeGreaterThan(0)
    for (const step of setupNodeSteps) {
      expect(step.with?.token).toBe('')
    }
    const setupText = read('.github/actions/setup/action.yml')
    expect(setupText).not.toMatch(/github\.token|GITHUB_TOKEN/u)
    const install = action.runs.steps.find(({ name }) => name === 'Install Dependencies')
    expect(install?.name).toBe('Install Dependencies')
    expect(install?.shell).toBe('bash')
    expect(install?.run).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(install?.run).toContain('pnpm config set store-dir "$RUNNER_TEMP/leafbook-pnpm-store"')
    expect(JSON.stringify(install)).not.toContain('GITHUB_TOKEN')
    for (const workflow of [
      '.github/workflows/build.yml',
      '.github/workflows/release.yml',
      '.github/workflows/platform-evidence.yml',
      '.github/workflows/windows-signed-evidence.yml',
      '.github/workflows/supply-chain-evidence.yml'
    ]) {
      expect(read(workflow), workflow).not.toMatch(
        /name: Setup[^\n]*\n(?:[^\n]*\n){0,8}\s+GITHUB_TOKEN:/u
      )
    }
  })

  it('generates a canonical fixed receipt bound to tag, commit, runner, carriers, and lifecycle', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/native-evidence-receipt.mjs')).href
    )) as {
      buildNativeEvidenceReceipt: (
        options: Record<string, unknown>
      ) => Promise<Record<string, unknown>>
      buildLinuxLifecycleReport: (options: Record<string, unknown>) => Record<string, unknown>
      buildLinuxStageObservation: (
        options: Record<string, unknown>
      ) => Promise<Record<string, unknown>>
      verifyNativeEvidenceReceipt: (options: Record<string, unknown>) => Promise<void>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-native-receipt-'))
    try {
      const version = '0.1.0'
      const names = ['AppImage', 'deb', 'rpm', 'tar.gz'].map(
        (extension) => `leafbook-linux-x64-${version}.${extension}`
      )
      for (const name of names) fs.writeFileSync(path.join(temporary, name), `carrier:${name}`)
      fs.writeFileSync(
        path.join(temporary, 'SHA256SUMS.txt'),
        `${names
          .sort()
          .map((name) => `${createHash('sha256').update(`carrier:${name}`).digest('hex')}  ${name}`)
          .join('\n')}\n`
      )
      const runner = {
        label: 'Hosted Agent 1',
        os: 'Linux',
        arch: 'X64',
        imageOs: 'ubuntu24',
        imageVersion: '20260731.1'
      }
      const hostEnvironment = {
        kind: 'host',
        image: 'ubuntu24',
        imageDigest: 'not-applicable',
        imageId: '20260731.1'
      }
      const rpmEnvironment = {
        kind: 'fedora-container',
        image: 'fedora@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814',
        imageDigest: 'sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814',
        imageId: `sha256:${'b'.repeat(64)}`
      }
      const linuxLifecycles = await Promise.all(
        ['portable', 'deb', 'rpm'].map(async (category) => {
          const observations = await Promise.all(
            ['install', 'smoke', 'uninstall', 'residue'].map((stage) =>
              module.buildLinuxStageObservation({
                category,
                stage,
                architecture: 'x64',
                tag: 'v0.1.0',
                commit: 'a'.repeat(40),
                runner: { ...runner, label: `runner-${category}` },
                environment: category === 'rpm' ? rpmEnvironment : hostEnvironment,
                carrierDirectory: temporary
              })
            )
          )
          return module.buildLinuxLifecycleReport({
            category,
            architecture: 'x64',
            tag: 'v0.1.0',
            commit: 'a'.repeat(40),
            observations
          })
        })
      )
      const options = {
        platform: 'linux',
        architecture: 'x64',
        tag: 'v0.1.0',
        commit: 'a'.repeat(40),
        carrierDirectory: temporary,
        signature: { policy: 'not-applicable', subjects: [] },
        windowsEvidence: null,
        linuxLifecycles
      }
      const receipt = await module.buildNativeEvidenceReceipt(options)
      expect(receipt).toMatchObject({
        schema: 'leafbook-native-evidence-v2',
        tag: 'v0.1.0',
        commit: 'a'.repeat(40),
        platform: 'linux',
        architecture: 'x64'
      })
      await expect(
        module.verifyNativeEvidenceReceipt({ receipt, carrierDirectory: temporary })
      ).resolves.toBeUndefined()
      fs.appendFileSync(path.join(temporary, names[0] ?? ''), 'changed')
      await expect(
        module.verifyNativeEvidenceReceipt({ receipt, carrierDirectory: temporary })
      ).rejects.toThrow()
      fs.writeFileSync(path.join(temporary, names[0] ?? ''), `carrier:${names[0]}`)
      const tamperedLifecycles = [...linuxLifecycles]
      const portableReport = linuxLifecycles[0]
      const observations = structuredClone(portableReport?.observations) as Array<
        Record<string, unknown>
      >
      observations[3] = {
        ...observations[3],
        result: { passed: false }
      }
      tamperedLifecycles[0] = {
        ...portableReport,
        observations
      }
      await expect(
        module.buildNativeEvidenceReceipt({
          ...options,
          linuxLifecycles: tamperedLifecycles
        })
      ).rejects.toThrow('residue')
      const missingStage = structuredClone(linuxLifecycles)
      const missingObservations = missingStage[0]?.observations as unknown[]
      missingObservations.pop()
      await expect(
        module.buildNativeEvidenceReceipt({
          ...options,
          linuxLifecycles: missingStage
        })
      ).rejects.toThrow('four stage')
      const duplicateStage = structuredClone(linuxLifecycles)
      const duplicateObservations = duplicateStage[0]?.observations as Array<
        Record<string, unknown>
      >
      duplicateObservations[3] = structuredClone(duplicateObservations[2] ?? {})
      await expect(
        module.buildNativeEvidenceReceipt({
          ...options,
          linuxLifecycles: duplicateStage
        })
      ).rejects.toThrow('duplicate')
      const duplicateCategory = structuredClone(linuxLifecycles)
      duplicateCategory[2] = structuredClone(linuxLifecycles[1])
      await expect(
        module.buildNativeEvidenceReceipt({
          ...options,
          linuxLifecycles: duplicateCategory
        })
      ).rejects.toThrow('duplicate')
      const wrongHostImage = structuredClone(linuxLifecycles)
      const portableEnvironment = wrongHostImage[0]?.environment as Record<string, unknown>
      portableEnvironment.imageId = 'fabricated-runner-image'
      await expect(
        module.buildNativeEvidenceReceipt({
          ...options,
          linuxLifecycles: wrongHostImage
        })
      ).rejects.toThrow('host image')
      const wrongRpmImage = structuredClone(linuxLifecycles)
      const rpmEnvironmentReport = wrongRpmImage[2]?.environment as Record<string, unknown>
      rpmEnvironmentReport.imageDigest = `sha256:${'c'.repeat(64)}`
      await expect(
        module.buildNativeEvidenceReceipt({
          ...options,
          linuxLifecycles: wrongRpmImage
        })
      ).rejects.toThrow('Fedora digest')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('rejects spoofed Windows hosted runner and image evidence', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/native-evidence-receipt.mjs')).href
    )) as {
      buildNativeEvidenceReceipt: (
        options: Record<string, unknown>
      ) => Promise<Record<string, unknown>>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-windows-receipt-'))
    try {
      const names = ['leafbook-win-x64-0.1.0-setup.exe', 'leafbook-win-x64-0.1.0.zip']
      for (const name of names) fs.writeFileSync(path.join(temporary, name), `carrier:${name}`)
      const digests = Object.fromEntries(
        names.map((name) => [name, createHash('sha256').update(`carrier:${name}`).digest('hex')])
      )
      fs.writeFileSync(
        path.join(temporary, 'SHA256SUMS.txt'),
        `${names
          .sort()
          .map((name) => `${digests[name]}  ${name}`)
          .join('\n')}\n`
      )
      const options = {
        platform: 'windows',
        architecture: 'x64',
        tag: 'v0.1.0',
        commit: 'a'.repeat(40),
        carrierDirectory: temporary,
        signature: {
          policy: 'authenticode-valid-v1',
          subjects: [
            {
              name: 'leafbook-win-x64-0.1.0-setup.exe',
              role: 'setup',
              sha256: digests['leafbook-win-x64-0.1.0-setup.exe'],
              signerThumbprint: 'B'.repeat(40),
              status: 'Valid'
            },
            {
              name: 'leafbook.exe',
              role: 'installed-executable',
              sha256: 'c'.repeat(64),
              signerThumbprint: 'B'.repeat(40),
              status: 'Valid'
            }
          ]
        },
        windowsEvidence: {
          runner: {
            label: 'Hosted Agent',
            os: 'Windows',
            arch: 'X64',
            imageOs: 'win25',
            imageVersion: '20260731.1'
          },
          environment: {
            kind: 'host',
            image: 'win25',
            imageDigest: 'not-applicable',
            imageId: '20260731.1'
          },
          runtime: {
            associations: {
              defaultNo: true,
              extensionsUnchanged: true,
              protocolsAbsent: true
            },
            install: { passed: true },
            residue: { passed: true },
            shortcuts: { passed: true },
            smoke: { passed: true },
            uninstall: { passed: true }
          }
        },
        linuxLifecycles: []
      }
      await expect(module.buildNativeEvidenceReceipt(options)).resolves.toBeDefined()
      const wrongImage = structuredClone(options)
      wrongImage.windowsEvidence.environment.imageId = 'not-applicable'
      await expect(module.buildNativeEvidenceReceipt(wrongImage)).rejects.toThrow(
        'environment is invalid'
      )
      const wrongArchitecture = structuredClone(options)
      wrongArchitecture.windowsEvidence.runner.arch = 'ARM64'
      await expect(module.buildNativeEvidenceReceipt(wrongArchitecture)).rejects.toThrow(
        'platform and architecture'
      )
      const fakeLabel = structuredClone(options)
      fakeLabel.windowsEvidence.runner.label = ''
      await expect(module.buildNativeEvidenceReceipt(fakeLabel)).rejects.toThrow('runner label')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('requires every fresh-runner macOS observation and exact signed carrier bytes', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/macos-native-evidence.mjs')).href
    )) as {
      buildObservation: (options: Record<string, unknown>) => Promise<Record<string, unknown>>
      buildReceipt: (options: Record<string, unknown>) => Promise<Record<string, unknown>>
      verifyReceipt: (options: Record<string, unknown>) => Promise<void>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-macos-receipt-'))
    try {
      const names = ['leafbook-mac-arm64-0.1.0.dmg', 'leafbook-mac-arm64-0.1.0.zip']
      for (const name of names) fs.writeFileSync(path.join(temporary, name), `carrier:${name}`)
      fs.writeFileSync(
        path.join(temporary, 'SHA256SUMS.txt'),
        `${names
          .sort()
          .map((name) => `${createHash('sha256').update(`carrier:${name}`).digest('hex')}  ${name}`)
          .join('\n')}\n`
      )
      const runner = {
        label: 'Mac Hosted Agent',
        os: 'macOS',
        arch: 'ARM64',
        imageOs: 'macos15',
        imageVersion: '20260731.1'
      }
      const environment = {
        kind: 'host',
        image: 'macos15',
        imageDigest: 'not-applicable',
        imageId: '20260731.1'
      }
      const stages = [
        'signature',
        'notarization',
        'gatekeeper',
        'carrier-audit',
        'unpacked-audit',
        'packaged-smoke',
        'install',
        'applications-smoke',
        'residue'
      ]
      const observations = await Promise.all(
        stages.map((stage) =>
          module.buildObservation({
            stage,
            architecture: 'arm64',
            tag: 'v0.1.0',
            commit: 'a'.repeat(40),
            runner,
            environment,
            carrierDirectory: temporary
          })
        )
      )
      const options = {
        architecture: 'arm64',
        tag: 'v0.1.0',
        commit: 'a'.repeat(40),
        carrierDirectory: temporary,
        observations
      }
      const receipt = await module.buildReceipt(options)
      await expect(module.verifyReceipt({ receipt, carrierDirectory: temporary })).resolves.toBe(
        undefined
      )
      await expect(
        module.buildReceipt({ ...options, observations: observations.slice(1) })
      ).rejects.toThrow('every stage')
      const duplicate = structuredClone(observations)
      duplicate[8] = structuredClone(duplicate[7] ?? {})
      await expect(module.buildReceipt({ ...options, observations: duplicate })).rejects.toThrow(
        'duplicate'
      )
      const spoofedImage = structuredClone(observations)
      const spoofedEnvironment = spoofedImage[0]?.environment as Record<string, unknown>
      spoofedEnvironment.imageId = 'not-the-runner-image'
      await expect(module.buildReceipt({ ...options, observations: spoofedImage })).rejects.toThrow(
        'runner image'
      )
      const mixedRunner = structuredClone(observations)
      const secondObservation = mixedRunner[1] as Record<string, unknown>
      mixedRunner[1] = {
        ...secondObservation,
        runner: {
          ...(secondObservation.runner as Record<string, unknown>),
          label: 'Different Hosted Agent'
        }
      }
      await expect(module.buildReceipt({ ...options, observations: mixedRunner })).rejects.toThrow(
        'disagree on runner'
      )
      fs.appendFileSync(path.join(temporary, names[0] ?? ''), 'tampered')
      await expect(module.verifyReceipt({ receipt, carrierDirectory: temporary })).rejects.toThrow()
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('keeps stable release blocked until trusted native receipts are consumed', () => {
    const release = read('.github/workflows/release.yml')
    const releaseDocument = parseDocument(release, {
      merge: false,
      strict: true,
      uniqueKeys: true
    })
    expect(releaseDocument.errors).toEqual([])
    const releaseDefinition = releaseDocument.toJS({ maxAliasCount: 0 }) as {
      jobs: Record<string, { secrets?: Record<string, string> }>
    }
    expect(releaseDefinition.jobs['windows-native-evidence']?.secrets).toBeUndefined()
    expect(releaseDefinition.jobs['macos-x64-native-evidence']?.secrets).toBeUndefined()
    expect(releaseDefinition.jobs['macos-arm64-native-evidence']?.secrets).toBeUndefined()
    expect(release).not.toMatch(
      /secrets\.(?:WIN_CSC_LINK|WIN_CSC_KEY_PASSWORD|CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID)/u
    )
    expect(release).not.toContain('secrets: inherit')
    expect(release).toContain('uses: ./.github/workflows/windows-signed-evidence.yml')
    expect(release).toContain('uses: ./.github/workflows/platform-evidence.yml')
    expect(release).toContain('node scripts/native-evidence-receipt.mjs verify')
    expect(release).toContain('receipt.tag !== tag || receipt.commit !== commit')
    expect(release).toContain('Verify and stage only receipt-bound native carrier bytes')
    expect(read('docs/RELEASE_GATE.md')).toContain('stable')
  })
})
