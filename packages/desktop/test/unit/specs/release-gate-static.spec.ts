/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const root = path.resolve(__dirname, '../../../../..')
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
const nodeRequire = createRequire(import.meta.url)

interface WorkflowStep {
  id?: string
  name?: string
  uses?: string
  run?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, string | boolean>
  env?: Record<string, string>
  shell?: string
}

interface WorkflowJob {
  environment?: string
  needs?: string | string[]
  permissions?: Record<string, string>
  outputs?: Record<string, string>
  env?: Record<string, string>
  steps?: WorkflowStep[]
}

interface ReleaseWorkflow {
  on?: {
    push?: {
      tags?: string[]
    }
  }
  permissions?: Record<string, string>
  jobs?: Record<string, WorkflowJob>
}

const parseWorkflow = (): ReleaseWorkflow => {
  const document = parseDocument(read('.github/workflows/release.yml'))
  expect(document.errors).toEqual([])
  return document.toJS() as ReleaseWorkflow
}

const normalizedRun = (run: string | undefined): string =>
  (run ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

const executableShellLines = (run: string | undefined): string[] =>
  normalizedRun(run)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

describe('Phase 8D static release gate', () => {
  const runReceipt = (mode: 'writeReceipt' | 'verifyReceipt', options: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'const module = await import(process.argv[1]); await module[process.argv[2]](JSON.parse(process.argv[3]));',
        pathToFileURL(path.join(root, 'scripts/mac-audit-receipt.mjs')).href,
        mode,
        JSON.stringify(options)
      ],
      { cwd: root, encoding: 'utf8' }
    )

  it('keeps LeafBook package identity separate from MarkText', () => {
    const desktop = JSON.parse(read('packages/desktop/package.json')) as {
      name: string
      description: string
    }
    const builder = read('packages/desktop/electron-builder.yml')
    const main = read('packages/desktop/src/main/index.ts')
    expect(desktop.name).toBe('leafbook')
    expect(desktop.description).toContain('LeafBook')
    expect(builder).toContain('appId: com.jacquesxu.leafbook')
    expect(builder).toContain('productName: LeafBook')
    expect(main).toContain("app.setPath('userData', path.join(app.getPath('appData'), APP_SLUG))")
  })

  it('keeps the seven Linux Markdown associations identical to the builder config', async () => {
    const associationModule = (await import(
      pathToFileURL(path.join(root, 'scripts/linux-file-associations.mjs')).href
    )) as {
      LINUX_MARKDOWN_FILE_ASSOCIATIONS: Array<{
        ext: string
        name: string
        description: string
        mimeType: string
      }>
    }
    const document = parseDocument(read('packages/desktop/electron-builder.yml'), {
      merge: false,
      strict: true,
      uniqueKeys: true
    })
    expect(document.errors).toEqual([])
    const builder = document.toJS({ maxAliasCount: 0 }) as {
      linux: { fileAssociations: Array<Record<string, string>> }
    }
    expect(builder.linux.fileAssociations).toEqual(
      associationModule.LINUX_MARKDOWN_FILE_ASSOCIATIONS
    )
    expect(builder.linux.fileAssociations.map(({ ext }) => ext)).toEqual([
      'md',
      'markdown',
      'mmd',
      'mdown',
      'mdtxt',
      'mdtext',
      'mdx'
    ])
  })

  it('pins the local package command to no publish, signing, or notarization', () => {
    const script = read('scripts/package-mac-unsigned-dir.sh')
    const builder = read('packages/desktop/electron-builder.yml')
    expect(script).toContain('--publish')
    expect(script).toContain('never')
    expect(script).toContain('-c.mac.identity=null')
    expect(script).toContain('-c.mac.notarize=false')
    expect(script).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false')
    expect(script).toContain('LEAFBOOK_ELECTRON_DIST')
    expect(script).toContain("require('electron/checksums.json')")
    expect(script).toContain('mac-audit-receipt.mjs" verify')
    expect(script).toContain('--prepackaged')
    expect(script).toContain('audit-copy')
    expect(script).toContain('audit-verify')
    expect(script).toContain('private-root.sh')
    expect(script).toContain('audit-mac-artifact.sh')
    expect(script).toContain('run_offline pnpm')
    expect(script).not.toMatch(/\b(tag|notarytool|release create)\b/)
    expect(builder).toMatch(/^publish: null$/m)
  })

  it('documents incomplete external evidence as release blockers', () => {
    const gate = read('docs/RELEASE_GATE.md')
    for (const blocker of [
      'real Windows, Linux, and macOS',
      'notarization',
      'SBOM',
      'provenance',
      'explicit human approval'
    ]) {
      expect(gate).toContain(blocker)
    }
    expect(gate).toContain('ad-hoc-signed Apple Silicon Beta')
    expect(gate).toContain('not the current candidate or public-release evidence')
    expect(gate).toContain('43e7771abebefb2a1339c8bc00e24d1af983b08422e302b8245b870cc2bfb8b1')
    expect(gate).toContain('post-review local')
    expect(gate).toContain('7778b0374a6f5bfb02d6836af85703dc51b179427c71ca5a7a8393f5b6e4d88d')
    expect(gate).toContain('third-review local checkpoint')
    expect(gate).toContain('ffe72c8d9ea498d5fcf8366d1e4e32a2e38fba5527088e67cf092ee5bf6ff4bc')
    expect(gate).toContain('final-P2 local checkpoint')
    expect(gate).toContain('2181a51d1542538aac637fc68ae67e23603b6388c30e6973dfd7de84768a9a3c')
    expect(gate).toContain('final-P1 local checkpoint')
    expect(gate).toContain('61e6e70a925933840945e188652bf643f29bde112b137532d6c97ac1a91cc13e')
    expect(gate).toContain('pre-third-review Phase 10B2 safe-SVG local checkpoint')
    expect(gate).toContain('f2a0a6ffb0c9b989dc92057177f65106c520fe52aa8b7a1e1325bbb755ee4082')
    expect(gate).toContain('faeec5a9bf3ed75b9232fc7e4fa18495175598c45c7576bb730e818f7efc7cec')
    expect(gate).toContain('initial third-review-remediated Phase 10B2 checkpoint')
    expect(gate).toContain('527c320f447db9a309820eca4f422183211c08a6bc5efc4573e256731af6a38b')
    expect(gate).toContain('800dfd068ed5f64bd3486c3040093013a666d23fa5f7f2c7a3209b39942880ac')
    expect(gate).toContain('reflected-control checkpoint additionally bounds reflected `S`/`T`')
    expect(gate).toContain('ae0d37038ff14bb83eeef81e1349db15acfbc8a40787e72480dd26232e511249')
    expect(gate).toContain('b182f9f35e694eb9cfebd0cad6485d04217591d33af87fb297eee5a20f9d894b')
    expect(gate).toContain('previous tree-CTM/privacy-contract candidate')
    expect(gate).toContain('d000f06d212f1cf1f6faed735e8719a38823f68ae4061f38cb636183180d2a6e')
    expect(gate).toContain('f0f6dcce31c68947054b7574e3a6b048b0665744d6bd9e3b16c668014e99b788')
    expect(gate).toContain('9195b68dac826ba8b2f5fc4a9594592a00d571a07aabb18f7e4e91a4ca0168dd')
    expect(gate).toContain('previous stable-read/private-snapshot candidate')
    expect(gate).toContain('a4a8bbe41926b11b07ee1ee6d200aa4108391f989c07e36a9a64debb05cf28d1')
    expect(gate).toContain('3a69be81e3866524e58a004ca8b09aee0ec4336cc1afb08a17fdf4cfa5e0a2d4')
    expect(gate).toContain('109042a9689b664c572c4e9b2a4173be6d6cf829836a096513c44e3cc2b331d1')
    expect(gate).toContain('previous triple-tree/public-dist-bound candidate')
    expect(gate).toContain('267d14d54d3c5ef9cbcad238ac598a0c6a7418d421cf22f50833bb610f8c0c6c')
    expect(gate).toContain('0865cdcfa0ad936e1f0cdae1f158a2f0698b204c9076101bc8f91cfe171c0e4a')
    expect(gate).toContain('42eb75a2bf70d8e37fa91ab4eb07bd9ac9c401b0d73b2dc1afcc0789d3ed8542')
    expect(gate).toContain('previous Phase 10B3 offline-export candidate')
    expect(gate).toContain('c584a90bc7b654ac5b937866ce90d2573a47408d848ec6411b982dd2586a2aad')
    expect(gate).toContain('328226d481bf4942f8e71404ecba4b97fd2b139500e5cbffc4cdc41924f57742')
    expect(gate).toContain('ec2b95f09eaaa1a8b16d77429c887b89dded43c9b471390df3ee2fb2cb53f9b3')
    expect(gate).toContain('previous third-review-remediated Phase 10B3 candidate')
    expect(gate).toContain('55f6db52b432c8050e058fd697f56f6bf991c2ccffe7828174574d41a2d0dc57')
    expect(gate).toContain('6caf12afcd89b803b08791db7f208cefe2d32f2932d710227c60ad9054210586')
    expect(gate).toContain('e2869ace7656a48db2de0e0cb9cbfa3f934812cdea71784df1bfcb840c8501e8')
    expect(gate).toContain('previous final-third-review Phase 10B3 candidate')
    expect(gate).toContain('fd5755d326706936f27de4f413112ead4e03c2987f26c1fe40544b3375963e7c')
    expect(gate).toContain('25e84eb7dbdd7dd72ac195edea64b99783fd0214bdb06f0c42afef94eaa2b086')
    expect(gate).toContain('0688ff8da2cefbf24da0a93cc5f3930ae79c9672ea9dcb3bf06575c5f1e26a12')
    expect(gate).toContain('previous staging-journal-final Phase 10B3 candidate')
    expect(gate).toContain('f21caea117a0ae6f5e12214f0174c5f97ed9d3e46f9aeb498a517b7a6083c99f')
    expect(gate).toContain('667989e14eb892ec92ee866b3490358914fc79768da413a6c926914e543cc13c')
    expect(gate).toContain('2c76e008dc7307c8f1947f5c5d03762d7d56302b48e6b3bebd44447dfe2c9d5d')
    expect(gate).toContain('previous negative-source-state-final Phase 10B3 candidate')
    expect(gate).toContain('9edf73bad24bab7243a05b8887a0181409cb5c2fb6208110f12892f0a2be654d')
    expect(gate).toContain('de24a3a644e420269215bed91d3eacb663b044f689038b19dfc0eebb94a74923')
    expect(gate).toContain('56a19194fee52a3791f4de81135a359247b797039beed451e84b0358de138cc8')
    expect(gate).toContain(
      'previous physical-source-budget-and-rollback-final Phase 10B3 candidate'
    )
    expect(gate).toContain('ed6bfc37b2fa8514d6c566b9bab307810d20e86c51fb4e53c796d71898f8ce56')
    expect(gate).toContain('6bc89caed789810cbf4513a4aa04dcd27bde3349aacf7a58ac801c15c3dffbb3')
    expect(gate).toContain('c49e9e8e9ad42f5d474cbd468a35485b21f82195b994a1d5aecf312c536cb592')
    expect(gate).toContain('previous preparation-draft-recovery-final Phase 10B3 candidate')
    expect(gate).toContain('29d71bd6a8f531fb44593d6d76b351ea4fa704188a04c3c866fb609230bf7227')
    expect(gate).toContain('202e6af585c725710387cd11da90db829bc5126d346d5c66cbb5065c3a3eeebc')
    expect(gate).toContain('7142eab68de12ff6fb988242973a5a709652459f1a485e332f3768b896c565ab')
    expect(gate).toContain('previous preparation-concurrency-final Phase 10B3 candidate')
    expect(gate).toContain('e0ab227ee8d61f8ede30f89f0cab26d833762e37615feba453e97626d54d8e76')
    expect(gate).toContain('516c79ab5b4518d3cb05c05735e05c0a9c91adf13fd29c2d24fdb049ba0b3c0b')
    expect(gate).toContain('facf3be0844838f90f0b9b3d3e0f81cc6bf8ac84121f60d0ca8454a62f714925')
    expect(gate).toContain('previous preparation-flush-failure-final Phase 10B3 candidate')
    expect(gate).toContain('45a19a624f914f7d7135bc19a19833fd3f56e350083ab7127723d13f7e4e088c')
    expect(gate).toContain('f42dd17a240cfce1887b9ce183bbd31d0495b0f59ad2726a537fd4d3f973b7f6')
    expect(gate).toContain('d3ee774d717f437b31d14476d54861b2a7d88121e98e6a5065ba9ec4009ec19b')
    expect(gate).toContain('current preparation-navigation-gate-final Phase 10B3 candidate')
    expect(gate).toContain('ab515a89b3dfee5ad131eeb53831f9c5ddc05ca34fb3011c646ff30aa3a6be85')
    expect(gate).toContain('ca2b6312a5028f6d89d71ff5d7cc9de381869b5eff395790d93306f66feb2c1f')
    expect(gate).toContain('e963b51fe7102c7784e2f1c609c9b6a6b4157185aadac5c981253d71702cb4fb')
    expect(gate).toContain('remains unsigned and unnotarized')
    expect(gate).toContain('P3')
  })

  it('keeps tag releases draft-only behind executable quality gates', () => {
    const workflow = parseWorkflow()
    const setup = read('.github/actions/setup/action.yml')
    const jobs = workflow.jobs ?? {}
    const qualityGate = jobs['quality-gate']
    const electronE2e = jobs['electron-e2e']
    const assemble = jobs['assemble-release']
    const release = jobs['create-release']
    const findStep = (job: WorkflowJob | undefined, name: string): WorkflowStep => {
      const matches = (job?.steps ?? []).filter((step) => step.name === name)
      expect(matches, `step ${name}`).toHaveLength(1)
      return matches[0] as WorkflowStep
    }
    const exactGate = (job: WorkflowJob | undefined, name: string, run: string): WorkflowStep => {
      const step = findStep(job, name)
      expect(normalizedRun(step.run), name).toBe(normalizedRun(run))
      expect(step.if, `${name} must be unconditional`).toBeUndefined()
      expect(step['continue-on-error'], `${name} must fail closed`).toBeUndefined()
      return step
    }
    const exactAction = (
      job: WorkflowJob | undefined,
      name: string,
      uses: string,
      inputs?: Record<string, string | boolean>
    ): WorkflowStep => {
      const step = findStep(job, name)
      expect(step.uses, name).toBe(uses)
      expect(step.run, `${name} must not hide a shell gate`).toBeUndefined()
      expect(step.if, `${name} must be unconditional`).toBeUndefined()
      expect(step['continue-on-error'], `${name} must fail closed`).toBeUndefined()
      expect(step.with).toEqual(inputs)
      return step
    }

    expect(Object.keys(workflow.on ?? {})).toEqual(['push'])
    expect(workflow.on?.push?.tags).toEqual(['v*'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(qualityGate).toBeDefined()
    expect(electronE2e).toBeDefined()
    expect(qualityGate?.outputs).toEqual({
      is_prerelease: '$' + '{{ steps.release-metadata.outputs.is_prerelease }}'
    })
    expect(assemble?.needs).toEqual([
      'quality-gate',
      'electron-e2e',
      'windows-native-evidence',
      'linux-native-evidence',
      'macos-x64-native-evidence',
      'macos-arm64-native-evidence'
    ])
    expect(assemble?.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(release?.needs).toEqual(['quality-gate', 'assemble-release', 'supply-chain-evidence'])
    expect(release?.permissions).toEqual({ contents: 'write', actions: 'read' })

    const checkoutSha = '34e114876b0b11c390a56381ad16ebd13914f8d5'
    const downloadSha = 'd3f86a106a0bac45b974a628896c90dbdf5c8093'
    exactAction(qualityGate, 'Check out Git repository', `actions/checkout@${checkoutSha}`, {
      'persist-credentials': false
    })
    exactAction(qualityGate, 'Setup pnpm + Node + frozen dependencies', './.github/actions/setup', {
      'node-version': '24.14.1'
    })
    const metadataStep = exactGate(
      qualityGate,
      'Validate tag against desktop package version',
      'node scripts/validate-release-tag.mjs "$' + '{GITHUB_REF_NAME}"'
    )
    expect(metadataStep.id).toBe('release-metadata')
    exactGate(qualityGate, 'Verify LeafBook generated metadata', 'pnpm verify-leafbook-metadata')
    exactGate(qualityGate, 'Verify Windows association policy', 'pnpm verify-windows-associations')
    exactGate(qualityGate, 'Validate dependency licenses', 'pnpm validate-licenses')
    exactGate(
      qualityGate,
      'Regenerate and verify third-party notices',
      `pnpm gen-third-party
git diff --exit-code -- packages/desktop/build/THIRD-PARTY-LICENSES.txt`
    )
    exactGate(qualityGate, 'Run ESLint', 'pnpm lint')
    exactGate(qualityGate, 'Run TypeScript typecheck', 'pnpm typecheck')
    exactGate(qualityGate, 'Run Muya TypeScript typecheck', 'pnpm -C packages/muya lint:types')
    exactGate(qualityGate, 'Run desktop unit tests', 'pnpm test:unit')
    exactGate(qualityGate, 'Run complete Muya unit suite', 'pnpm -C packages/muya test')
    exactGate(qualityGate, 'Build desktop application', 'pnpm build')
    exactAction(electronE2e, 'Check out Git repository', `actions/checkout@${checkoutSha}`, {
      'persist-credentials': false
    })
    exactGate(
      electronE2e,
      'Install System Dependencies',
      `sudo apt-get update
sudo apt-get install -y \\
  libx11-dev libxkbfile-dev libsecret-1-dev libfontconfig-dev \\
  xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \\
  libdrm2 libgtk-3-0 libgbm1 libasound2t64`
    )
    exactAction(electronE2e, 'Setup pnpm + Node + frozen dependencies', './.github/actions/setup', {
      'node-version': '24.14.1'
    })
    exactGate(electronE2e, 'Run postinstall', 'pnpm tsx scripts/postinstall.ts')
    exactGate(electronE2e, 'Build app', 'pnpm build')
    exactGate(electronE2e, 'Run Electron E2E tests', 'xvfb-run --auto-servernum pnpm test:e2e')
    expect(setup).toContain('pnpm install --frozen-lockfile --ignore-scripts')

    const assembleSteps = assemble?.steps ?? []
    const releaseSteps = release?.steps ?? []
    const initialTagCheckIndex = assembleSteps.findIndex(
      (step) => step.name === 'Verify server tag target before release assembly'
    )
    const createIndex = releaseSteps.findIndex(
      (step) => step.name === 'Create draft release with assets'
    )
    expect(initialTagCheckIndex).toBeGreaterThanOrEqual(0)
    expect(createIndex).toBeGreaterThanOrEqual(0)
    expect(
      releaseSteps.some((step) => step.name === 'Reverify server tag target and release absence')
    ).toBe(false)
    exactGate(
      assemble,
      'Verify server tag target before release assembly',
      'node scripts/verify-release-preconditions.mjs'
    )
    exactGate(
      assemble,
      'Reject updater metadata from release assets',
      'bash scripts/audit-release-files.sh dist'
    )

    const runCommands = Object.entries(jobs).flatMap(([jobName, job]) =>
      (job.steps ?? []).flatMap((step) =>
        executableShellLines(step.run).map((line) => ({
          jobName,
          stepName: step.name,
          line
        }))
      )
    )
    const releaseCreateCommands = runCommands.filter(({ line }) =>
      /^gh release create(?:\s|$)/.test(line)
    )
    expect(releaseCreateCommands).toHaveLength(1)
    expect(releaseCreateCommands[0]?.jobName).toBe('create-release')
    expect(releaseCreateCommands[0]?.stepName).toBe('Create draft release with assets')
    const createStep = findStep(release, 'Create draft release with assets')
    expect(createStep.if).toBeUndefined()
    expect(createStep['continue-on-error']).toBeUndefined()
    const createRun = normalizedRun(createStep.run)
    expect(createRun).toContain(
      'Final release snapshot fully reverified immediately before upload.'
    )
    const snapshotVerificationIndex = createRun.indexOf(
      'Final release snapshot fully reverified immediately before upload.'
    )
    const serverTagIndex = createRun.indexOf(
      'object="$(gh api --method GET',
      snapshotVerificationIndex
    )
    const releaseAbsenceIndex = createRun.indexOf('! grep -Fxq -- "$tag"', serverTagIndex)
    const releaseCreateIndex = createRun.indexOf('gh release create', releaseAbsenceIndex)
    expect(snapshotVerificationIndex).toBeGreaterThanOrEqual(0)
    expect(serverTagIndex).toBeGreaterThan(snapshotVerificationIndex)
    expect(releaseAbsenceIndex).toBeGreaterThan(serverTagIndex)
    expect(releaseCreateIndex).toBeGreaterThan(releaseAbsenceIndex)
    expect(createRun).toContain('[[ "$object_type" == "commit"')
    expect(createRun.slice(createRun.indexOf('release_flags=('))).toBe(
      normalizedRun(`release_flags=(
  --repo "\${GITHUB_REPOSITORY}"
  --draft
  --verify-tag
  --title "\${GITHUB_REF_NAME}"
  --notes-file final-release/release_body.md
)
if [[ "\${{ needs.quality-gate.outputs.is_prerelease }}" == "true" ]]; then
  release_flags+=(--prerelease)
fi
gh release create "\${GITHUB_REF_NAME}" final-release/assets/* "\${release_flags[@]}"`)
    )
    expect(createRun).not.toContain('candidate/dist/*')

    const executableCommands = runCommands.map(({ line }) => line).join('\n')
    expect(executableCommands).not.toMatch(/^gh release edit(?:\s|$)/m)
    expect(executableCommands).not.toMatch(/--draft(?:=false|\s+false)\b/)
    expect(
      Object.values(jobs)
        .flatMap((job) => job.steps ?? [])
        .filter((step) => step.uses?.includes('action-gh-release'))
    ).toEqual([])
    exactAction(
      release,
      'Download assembled candidate',
      `actions/download-artifact@${downloadSha}`,
      { name: 'leafbook-release-candidate', path: 'candidate' }
    )

    const finalSteps = release?.steps ?? []
    expect(finalSteps.some((step) => step.uses?.startsWith('./'))).toBe(false)
    expect(finalSteps.some((step) => step.uses?.startsWith('actions/checkout@'))).toBe(false)
    expect(
      finalSteps.some((step) => /\bnode\s+(?:\.\/)?scripts\//.test(normalizedRun(step.run)))
    ).toBe(false)
    expect(
      finalSteps.filter((step) => step.env?.GH_TOKEN === '$' + '{{ secrets.GITHUB_TOKEN }}')
    ).toHaveLength(1)

    const contentsWriteJobs = Object.entries(jobs)
      .filter(([, job]) => job.permissions?.contents === 'write')
      .map(([name]) => name)
    expect(contentsWriteJobs).toEqual(['create-release'])
    expect(release?.environment).toBe('release')
    const officialAction = /^[a-z0-9_.-]+\/[a-z0-9_.-]+@([0-9a-f]{40})$/i
    const workflowActionPins = new Set<string>()
    for (const job of Object.values(jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/')) {
          expect(step.uses).toMatch(officialAction)
          workflowActionPins.add(step.uses)
        }
        if (step.uses?.startsWith('actions/checkout@')) {
          expect(step.with?.['persist-credentials']).toBe(false)
        }
      }
    }
    expect(workflowActionPins).toEqual(
      new Set([
        `actions/checkout@${checkoutSha}`,
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        `actions/download-artifact@${downloadSha}`
      ])
    )
    for (const uses of setup.matchAll(/uses:\s+(\S+)/g)) {
      expect(uses[1]).toMatch(officialAction)
    }
    expect(setup).toContain('pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320')
    expect(setup).toContain('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')
    expect(read('.github/workflows/release.yml')).not.toContain('contains(')
  })

  it('peels lightweight and annotated server tags and fails closed on mismatch or API errors', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/verify-release-preconditions.mjs')).href
    )) as {
      verifyReleasePreconditions(options: {
        repository: string
        tag: string
        expectedSha: string
        api: (endpoint: string, options?: unknown) => Promise<unknown>
      }): Promise<string>
    }
    const commit = '1'.repeat(40)
    const annotation = '2'.repeat(40)
    const repository = 'owner/repository'
    const tag = 'v0.1.0'

    const lightweightApi = async (endpoint: string): Promise<unknown> => {
      if (endpoint.endsWith('/git/ref/tags/v0.1.0')) {
        return { object: { type: 'commit', sha: commit } }
      }
      if (endpoint.endsWith('/releases?per_page=100')) return [[]]
      throw new Error(`Unexpected endpoint ${endpoint}`)
    }
    await expect(
      module.verifyReleasePreconditions({
        repository,
        tag,
        expectedSha: commit,
        api: lightweightApi
      })
    ).resolves.toBe(commit)

    const annotatedApi = async (endpoint: string): Promise<unknown> => {
      if (endpoint.endsWith('/git/ref/tags/v0.1.0')) {
        return { object: { type: 'tag', sha: annotation } }
      }
      if (endpoint.endsWith(`/git/tags/${annotation}`)) {
        return { object: { type: 'commit', sha: commit } }
      }
      if (endpoint.endsWith('/releases?per_page=100')) return [[]]
      throw new Error(`Unexpected endpoint ${endpoint}`)
    }
    await expect(
      module.verifyReleasePreconditions({
        repository,
        tag,
        expectedSha: commit,
        api: annotatedApi
      })
    ).resolves.toBe(commit)

    await expect(
      module.verifyReleasePreconditions({
        repository,
        tag,
        expectedSha: '3'.repeat(40),
        api: annotatedApi
      })
    ).rejects.toThrow('not triggering commit')
    await expect(
      module.verifyReleasePreconditions({
        repository,
        tag,
        expectedSha: commit,
        api: async () => {
          throw new Error('simulated API failure')
        }
      })
    ).rejects.toThrow('simulated API failure')
    await expect(
      module.verifyReleasePreconditions({
        repository,
        tag,
        expectedSha: commit,
        api: async (endpoint: string) =>
          endpoint.endsWith('/releases?per_page=100')
            ? [[{ tag_name: tag }]]
            : { object: { type: 'commit', sha: commit } }
      })
    ).rejects.toThrow('already exists')
  })

  it('derives the release channel only from a validated SemVer prerelease component', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/validate-release-tag.mjs')).href
    )) as {
      validateReleaseTag(options: { tag: string; desktopVersion: string }): {
        isPrerelease: boolean
      }
    }
    expect(
      module.validateReleaseTag({
        tag: 'v1.2.3+stable-build-with-hyphens',
        desktopVersion: '1.2.3+stable-build-with-hyphens'
      }).isPrerelease
    ).toBe(false)
    expect(
      module.validateReleaseTag({
        tag: 'v1.2.3-rc.1+build-with-hyphens',
        desktopVersion: '1.2.3-rc.1+build-with-hyphens'
      }).isPrerelease
    ).toBe(true)
    expect(
      module.validateReleaseTag({
        tag: 'v1.2.3-1a',
        desktopVersion: '1.2.3-1a'
      }).isPrerelease
    ).toBe(true)
    for (const invalid of ['v1.2', 'v01.2.3', 'v1.2.3-01', 'v1.2.3+bad..metadata']) {
      expect(() =>
        module.validateReleaseTag({ tag: invalid, desktopVersion: invalid.slice(1) })
      ).toThrow('not valid SemVer')
    }
  })

  it('keeps ordinary unsigned macOS builds outside the tag release workflow', () => {
    const workflow = parseWorkflow()
    expect(workflow.jobs?.['unsigned-mac-validation']).toBeUndefined()
    const release = read('.github/workflows/release.yml')
    expect(release).not.toContain('pnpm run build:mac:')
    expect(release).not.toContain(['name: leafbook-macos-', '$', '{{ matrix.arch }}'].join(''))
  })

  it('audits all four Linux carriers and blocks stable Windows without installed NSIS evidence', () => {
    const audit = read('scripts/audit-platform-artifacts.sh')
    for (const carrierAudit of [
      'tar -xzf',
      'dpkg-deb --extract',
      'rpm2cpio',
      'unsquashfs -s',
      'unsquashfs -no-progress'
    ]) {
      expect(audit).toContain(carrierAudit)
    }
    expect(audit.match(/audit_extracted_tree /g)?.length).toBeGreaterThanOrEqual(5)
    expect(audit).not.toContain('leafbook-linux-$architecture-$version.snap')
    expect(audit).toContain('Windows setup carrier is not a valid PE file')
    expect(audit).toContain('7z t "$dist_dir/$setup"')
    expect(audit).toContain('if [[ "$is_prerelease" == "false" ]]')
    expect(audit).toContain('Stable release blocked:')
    const gate = read('docs/RELEASE_GATE.md')
    expect(gate).toContain('prerelease NSIS setup')
    expect(gate).toContain('Windows packaging fails closed')
  })

  it('binds each extracted carrier to one colocated app root and its declared architecture', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/audit-application-layout.mjs')).href
    )) as {
      auditApplicationLayout(options: {
        tree: string
        platform: 'linux' | 'windows'
        architecture: 'x64' | 'arm64'
        carrierKind?: 'archive' | 'deb' | 'rpm' | 'appimage' | 'snap'
      }): Promise<{ manifestDigest: string; carrierManifestDigest: string }>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-layout-fixture-'))
    const createTree = (
      name: string,
      platform: 'linux' | 'windows',
      architecture: 'x64' | 'arm64'
    ): string => {
      const tree = path.join(temporary, name)
      const resources = path.join(tree, 'resources')
      fs.mkdirSync(resources, { recursive: true })
      fs.writeFileSync(path.join(resources, 'app.asar'), 'fixture')
      const executable = path.join(tree, platform === 'windows' ? 'leafbook.exe' : 'leafbook')
      const header = Buffer.alloc(512)
      if (platform === 'linux') {
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header)
        header.writeUInt16LE(architecture === 'x64' ? 62 : 183, 18)
      } else {
        header.write('MZ')
        header.writeUInt32LE(128, 0x3c)
        header.write('PE\0\0', 128, 'binary')
        header.writeUInt16LE(architecture === 'x64' ? 0x8664 : 0xaa64, 132)
      }
      fs.writeFileSync(executable, header, { mode: 0o755 })
      return tree
    }
    try {
      for (const [platform, architecture] of [
        ['linux', 'x64'],
        ['linux', 'arm64'],
        ['windows', 'x64'],
        ['windows', 'arm64']
      ] as const) {
        await expect(
          module.auditApplicationLayout({
            tree: createTree(`${platform}-${architecture}`, platform, architecture),
            platform,
            architecture
          })
        ).resolves.toMatchObject({ manifestDigest: expect.stringMatching(/^[0-9a-f]{64}$/) })
      }

      const decoy = createTree('decoy', 'linux', 'x64')
      fs.mkdirSync(path.join(decoy, 'decoy', 'resources'), { recursive: true })
      fs.writeFileSync(path.join(decoy, 'decoy', 'resources', 'app.asar'), 'decoy')
      fs.writeFileSync(path.join(decoy, 'decoy', 'leafbook'), Buffer.alloc(512), { mode: 0o755 })
      await expect(
        module.auditApplicationLayout({
          tree: decoy,
          platform: 'linux',
          architecture: 'x64'
        })
      ).rejects.toThrow(/non-canonical top-level entry|exactly one app\.asar/)

      const wrongArchitecture = createTree('wrong-architecture', 'windows', 'arm64')
      await expect(
        module.auditApplicationLayout({
          tree: wrongArchitecture,
          platform: 'windows',
          architecture: 'x64'
        })
      ).rejects.toThrow('does not match x64')

      const siblingExecutable = createTree('sibling-executable', 'linux', 'x64')
      const siblingHeader = Buffer.alloc(512)
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(siblingHeader)
      siblingHeader.writeUInt16LE(62, 18)
      fs.writeFileSync(path.join(siblingExecutable, 'decoy'), siblingHeader, { mode: 0o755 })
      await expect(
        module.auditApplicationLayout({
          tree: siblingExecutable,
          platform: 'linux',
          architecture: 'x64'
        })
      ).rejects.toThrow(/non-canonical top-level entry|unexpected native executable/)

      const mixedHelper = createTree('mixed-helper', 'linux', 'x64')
      const armHelper = Buffer.alloc(512)
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(armHelper)
      armHelper.writeUInt16LE(183, 18)
      fs.writeFileSync(path.join(mixedHelper, 'resources', 'native.node'), armHelper)
      await expect(
        module.auditApplicationLayout({
          tree: mixedHelper,
          platform: 'linux',
          architecture: 'x64'
        })
      ).rejects.toThrow('does not match x64')

      if (process.platform !== 'win32') {
        const escapingSymlink = createTree('escaping-symlink', 'linux', 'x64')
        fs.symlinkSync('../../outside', path.join(escapingSymlink, 'resources', 'escape'))
        await expect(
          module.auditApplicationLayout({
            tree: escapingSymlink,
            platform: 'linux',
            architecture: 'x64'
          })
        ).rejects.toThrow('escapes its app root')
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  }, 30_000)

  it('compares the same Linux app payload across real carrier shapes and rejects carrier additions', async () => {
    if (process.platform === 'win32') return
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/audit-application-layout.mjs')).href
    )) as {
      auditApplicationLayout(options: {
        tree: string
        platform: 'linux'
        architecture: 'x64'
        carrierKind: 'archive' | 'deb' | 'rpm' | 'appimage' | 'snap'
      }): Promise<{ manifestDigest: string; carrierManifestDigest: string }>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-linux-carriers-'))
    const writePayload = (target: string) => {
      fs.mkdirSync(path.join(target, 'resources'), { recursive: true })
      fs.writeFileSync(path.join(target, 'resources', 'app.asar'), 'same payload')
      const elf = Buffer.alloc(512)
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf)
      elf.writeUInt16LE(62, 18)
      fs.writeFileSync(path.join(target, 'leafbook'), elf, { mode: 0o755 })
    }
    const { LinuxTargetHelper } = nodeRequire(
      'app-builder-lib/out/targets/LinuxTargetHelper.js'
    ) as {
      LinuxTargetHelper: new (packager: object) => {
        computeDesktopEntry(
          options: object,
          exec?: string,
          extra?: Record<string, string>
        ): Promise<string>
      }
    }
    const desktopOptions = () => ({
      description: 'A local-first Markdown book reader and editor.',
      category: 'Office;TextEditor;Utility',
      mimeTypes: ['text/markdown'],
      desktop: {
        entry: {
          StartupWMClass: 'leafbook',
          Keywords: 'leafbook;markdown;book;'
        }
      }
    })
    const associationModule = (await import(
      pathToFileURL(path.join(root, 'scripts/linux-file-associations.mjs')).href
    )) as {
      LINUX_MARKDOWN_FILE_ASSOCIATIONS: Array<{
        ext: string
        mimeType: string
      }>
    }
    const createDesktopHelper = (
      fileAssociations = associationModule.LINUX_MARKDOWN_FILE_ASSOCIATIONS
    ) =>
      new LinuxTargetHelper({
        appInfo: {
          productName: 'LeafBook',
          sanitizedProductName: 'LeafBook',
          description: 'LeafBook — a local-first Markdown book reader and editor',
          buildVersion: '0.1.0'
        },
        executableName: 'leafbook',
        info: { metadata: { desktopName: 'leafbook' } },
        fileAssociations,
        config: { protocols: [], mac: {} },
        platformSpecificBuildOptions: { protocols: [] }
      })
    const desktopHelper = createDesktopHelper()
    const packageDesktop = await desktopHelper.computeDesktopEntry(desktopOptions())
    const appImageDesktop = await desktopHelper.computeDesktopEntry(
      desktopOptions(),
      'AppRun --no-sandbox %U',
      { 'X-AppImage-Version': '0.1.0' }
    )
    const snapDesktop = await desktopHelper.computeDesktopEntry(desktopOptions(), 'leafbook %U', {
      Icon: `${String.fromCharCode(36)}{SNAP}/meta/gui/icon.png`
    })
    const { generateAppRunScript } = nodeRequire(
      'app-builder-lib/out/targets/appimage/appImageUtil.js'
    ) as {
      generateAppRunScript(config: Record<string, string>): string
    }
    const { buildCommandShContent } = nodeRequire(
      'app-builder-lib/out/targets/snap/coreLegacy.js'
    ) as {
      buildCommandShContent(config: {
        isTemplate: boolean
        executableName: string
        extraAppArgs: string[]
      }): string
    }
    try {
      const archive = path.join(temporary, 'archive')
      fs.mkdirSync(archive)
      writePayload(archive)

      const appimage = path.join(temporary, 'appimage')
      fs.cpSync(archive, appimage, { recursive: true })
      fs.writeFileSync(path.join(appimage, 'leafbook.desktop'), appImageDesktop)
      const appImageIcon = 'usr/share/icons/hicolor/512x512/apps/leafbook.png'
      fs.mkdirSync(path.join(appimage, path.dirname(appImageIcon)), { recursive: true })
      fs.writeFileSync(path.join(appimage, appImageIcon), 'png')
      fs.mkdirSync(path.join(appimage, 'usr/share/mime/packages'), { recursive: true })
      fs.writeFileSync(path.join(appimage, 'usr/share/mime/packages/leafbook.xml'), '<mime/>')
      fs.symlinkSync(appImageIcon, path.join(appimage, 'leafbook.png'))
      fs.symlinkSync(appImageIcon, path.join(appimage, '.DirIcon'))
      fs.writeFileSync(
        path.join(appimage, 'AppRun'),
        generateAppRunScript({
          ExecutableName: 'leafbook',
          DesktopFileName: 'leafbook.desktop',
          ProductFilename: 'LeafBook',
          ProductName: 'LeafBook',
          ResourceName: 'appimagekit-leafbook',
          MimeTypeFile: 'usr/share/mime/packages/leafbook.xml'
        }),
        { mode: 0o755 }
      )

      const snap = path.join(temporary, 'snap')
      fs.cpSync(archive, snap, { recursive: true })
      fs.mkdirSync(path.join(snap, 'meta', 'gui'), { recursive: true })
      fs.writeFileSync(path.join(snap, 'meta', 'gui', 'leafbook.desktop'), snapDesktop)
      fs.writeFileSync(path.join(snap, 'meta', 'gui', 'icon.png'), 'png')
      fs.writeFileSync(
        path.join(snap, 'command.sh'),
        buildCommandShContent({
          isTemplate: true,
          executableName: 'leafbook',
          extraAppArgs: ['--no-sandbox']
        }),
        { mode: 0o755 }
      )
      fs.writeFileSync(
        path.join(snap, 'meta', 'snap.yaml'),
        [
          'name: leafbook',
          "version: '0.1.0'",
          'summary: LeafBook',
          'description: A local-first Markdown book reader and editor.',
          'base: core20',
          'confinement: strict',
          'grade: stable',
          'apps:',
          '  leafbook:',
          '    command: command.sh',
          '    plugs: [desktop, home, network, x11]',
          ''
        ].join('\n')
      )

      const packageCarrier = (name: 'deb' | 'rpm') => {
        const tree = path.join(temporary, name)
        const app = path.join(tree, 'opt', 'LeafBook')
        fs.mkdirSync(app, { recursive: true })
        writePayload(app)
        fs.mkdirSync(path.join(tree, 'usr', 'bin'), { recursive: true })
        fs.symlinkSync('/opt/LeafBook/leafbook', path.join(tree, 'usr', 'bin', 'leafbook'))
        fs.mkdirSync(path.join(tree, 'usr', 'share', 'applications'), { recursive: true })
        fs.writeFileSync(
          path.join(tree, 'usr', 'share', 'applications', 'leafbook.desktop'),
          packageDesktop
        )
        return tree
      }
      const fixtures = [
        ['archive', archive],
        ['appimage', appimage],
        ['snap', snap],
        ['deb', packageCarrier('deb')],
        ['rpm', packageCarrier('rpm')]
      ] as const
      const results = []
      for (const [carrierKind, tree] of fixtures) {
        results.push(
          await module.auditApplicationLayout({
            tree,
            platform: 'linux',
            architecture: 'x64',
            carrierKind
          })
        )
      }
      expect(new Set(results.map((result) => result.manifestDigest)).size).toBe(1)
      expect(new Set(results.map((result) => result.carrierManifestDigest)).size).toBeGreaterThan(1)

      fs.writeFileSync(path.join(appimage, 'usr', 'share', 'side-effect.desktop'), 'bad')
      await expect(
        module.auditApplicationLayout({
          tree: appimage,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'appimage'
        })
      ).rejects.toThrow('unapproved integration metadata')
      fs.rmSync(path.join(appimage, 'usr', 'share', 'side-effect.desktop'))

      fs.symlinkSync('/tmp', path.join(appimage, 'resources', 'escape'))
      await expect(
        module.auditApplicationLayout({
          tree: appimage,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'appimage'
        })
      ).rejects.toThrow('escapes its app root')
      fs.rmSync(path.join(appimage, 'resources', 'escape'))

      const missingAssociationDesktop = await createDesktopHelper(
        associationModule.LINUX_MARKDOWN_FILE_ASSOCIATIONS.slice(0, -1)
      ).computeDesktopEntry(desktopOptions(), 'AppRun --no-sandbox %U', {
        'X-AppImage-Version': '0.1.0'
      })
      fs.writeFileSync(path.join(appimage, 'leafbook.desktop'), missingAssociationDesktop)
      await expect(
        module.auditApplicationLayout({
          tree: appimage,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'appimage'
        })
      ).rejects.toThrow('pinned electron-builder 26.15.3 output')

      const tamperedAssociations = associationModule.LINUX_MARKDOWN_FILE_ASSOCIATIONS.map(
        (association) =>
          association.ext === 'mdx' ? { ...association, mimeType: 'text/plain' } : association
      )
      const tamperedAssociationDesktop = await createDesktopHelper(
        tamperedAssociations
      ).computeDesktopEntry(desktopOptions(), 'AppRun --no-sandbox %U', {
        'X-AppImage-Version': '0.1.0'
      })
      fs.writeFileSync(path.join(appimage, 'leafbook.desktop'), tamperedAssociationDesktop)
      await expect(
        module.auditApplicationLayout({
          tree: appimage,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'appimage'
        })
      ).rejects.toThrow('pinned electron-builder 26.15.3 output')
      fs.writeFileSync(path.join(appimage, 'leafbook.desktop'), appImageDesktop)

      fs.writeFileSync(
        path.join(appimage, 'leafbook.desktop'),
        appImageDesktop.replace(
          'Keywords=leafbook;markdown;book;',
          'Keywords=leafbook;markdown;book;terminal;'
        )
      )
      await expect(
        module.auditApplicationLayout({
          tree: appimage,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'appimage'
        })
      ).rejects.toThrow('pinned electron-builder 26.15.3 output')
      fs.writeFileSync(path.join(appimage, 'leafbook.desktop'), appImageDesktop)

      fs.writeFileSync(
        path.join(appimage, 'leafbook.desktop'),
        appImageDesktop.replace('X-AppImage-Version=0.1.0', 'X-AppImage-Version=9.9.9')
      )
      await expect(
        module.auditApplicationLayout({
          tree: appimage,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'appimage'
        })
      ).rejects.toThrow('pinned electron-builder 26.15.3 output')
      fs.writeFileSync(path.join(appimage, 'leafbook.desktop'), appImageDesktop)

      const debTree = fixtures.find(([carrier]) => carrier === 'deb')?.[1] as string
      fs.writeFileSync(
        path.join(debTree, 'usr/share/applications/leafbook.desktop'),
        packageDesktop.replace('Exec=/opt/LeafBook/leafbook %U', 'Exec=leafbook --side-effect %U')
      )
      await expect(
        module.auditApplicationLayout({
          tree: debTree,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'deb'
        })
      ).rejects.toThrow('pinned electron-builder 26.15.3 output')

      const canonicalSnapYaml = fs.readFileSync(path.join(snap, 'meta/snap.yaml'), 'utf8')
      fs.writeFileSync(
        path.join(snap, 'meta/snap.yaml'),
        canonicalSnapYaml.replace('command: command.sh', 'command: app/leafbook')
      )
      await expect(
        module.auditApplicationLayout({
          tree: snap,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'snap'
        })
      ).rejects.toThrow('snap command does not bind')
      fs.writeFileSync(path.join(snap, 'meta/snap.yaml'), canonicalSnapYaml)

      fs.chmodSync(path.join(snap, 'command.sh'), 0o644)
      await expect(
        module.auditApplicationLayout({
          tree: snap,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'snap'
        })
      ).rejects.toThrow('missing or not executable')
      fs.chmodSync(path.join(snap, 'command.sh'), 0o755)

      fs.writeFileSync(
        path.join(snap, 'command.sh'),
        '#!/bin/bash -e\nexport SAFE=>/tmp/leafbook-side-effect\nexec "$SNAP/leafbook" "$@"',
        { mode: 0o755 }
      )
      await expect(
        module.auditApplicationLayout({
          tree: snap,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'snap'
        })
      ).rejects.toThrow('pinned electron-builder template')

      fs.writeFileSync(
        path.join(snap, 'meta', 'snap.yaml'),
        [
          'name: leafbook',
          "version: '0.1.0'",
          'base: core20',
          'confinement: strict',
          'grade: stable',
          'apps:',
          '  leafbook:',
          '    command: command.sh',
          '  hidden-daemon:',
          '    command: command.sh',
          '    daemon: simple',
          ''
        ].join('\n')
      )
      await expect(
        module.auditApplicationLayout({
          tree: snap,
          platform: 'linux',
          architecture: 'x64',
          carrierKind: 'snap'
        })
      ).rejects.toThrow('exactly the leafbook app')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  }, 30_000)

  it('bounds command output even after parent exit and kills descendants that retain pipes', () => {
    if (process.platform === 'win32') return
    const runner = path.join(root, 'scripts/run-bounded.py')
    const outputStart = Date.now()
    const output = spawnSync(
      'python3',
      [
        runner,
        '5',
        '5',
        '134217728',
        '--',
        'python3',
        '-c',
        'import os; os.write(1,b"x"*(70*1024*1024))'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 8_000 }
    )
    expect(output.status).toBe(125)
    expect(output.stderr.toString()).toContain('total-output budget')
    expect(Date.now() - outputStart).toBeLessThan(8_000)

    const pipeStart = Date.now()
    const retainedPipe = spawnSync(
      'python3',
      [
        runner,
        '1',
        '5',
        '134217728',
        '--',
        'python3',
        '-c',
        'import subprocess; subprocess.Popen(["python3","-c","import time;time.sleep(10)"])'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 4_000 }
    )
    expect(retainedPipe.status).toBe(124)
    expect(retainedPipe.stderr.toString()).toContain('wall-clock budget')
    expect(Date.now() - pipeStart).toBeLessThan(4_000)
  })

  it('rejects oversized ASAR pickle headers before the ASAR library parses them', () => {
    if (process.platform === 'win32') return
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-asar-prefix-'))
    const archive = path.join(temporary, 'oversized-header.asar')
    try {
      const prefix = Buffer.alloc(8)
      prefix.writeUInt32LE(4, 0)
      prefix.writeUInt32LE(70 * 1024 * 1024, 4)
      const descriptor = fs.openSync(archive, 'w')
      fs.writeSync(descriptor, prefix)
      fs.ftruncateSync(descriptor, 70 * 1024 * 1024 + 8)
      fs.closeSync(descriptor)
      const started = Date.now()
      const result = spawnSync('node', [path.join(root, 'scripts/preflight-asar.mjs'), archive], {
        encoding: 'utf8',
        timeout: 2_000
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('pickle header exceeds')
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('discovers exactly one AppImage SquashFS marker with a fixed-memory scanner', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-appimage-marker-'))
    const scanner = path.join(root, 'scripts/find-squashfs-offset.py')
    try {
      const one = path.join(temporary, 'one.AppImage')
      const multiple = path.join(temporary, 'multiple.AppImage')
      fs.writeFileSync(one, Buffer.concat([Buffer.alloc(1024 * 1024 + 2), Buffer.from('hsqs')]))
      fs.writeFileSync(multiple, Buffer.from('prefix-hsqs-middle-hsqs-suffix'))
      const valid = spawnSync('python3', [scanner, one], { encoding: 'utf8' })
      expect(valid.status).toBe(0)
      expect(valid.stdout.trim()).toBe(String(1024 * 1024 + 2))
      const invalid = spawnSync('python3', [scanner, multiple], { encoding: 'utf8' })
      expect(invalid.status).toBe(1)
      expect(invalid.stderr).toContain('exactly one')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('rejects traversal and oversized archive metadata before extraction', () => {
    if (process.platform === 'win32') return
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-archive-preflight-'))
    const traversal = path.join(temporary, 'traversal.tar')
    const oversized = path.join(temporary, 'oversized.tar')
    const build = spawnSync(
      'python3',
      [
        '-c',
        [
          'import io,tarfile,sys',
          'trav,huge=sys.argv[1:]',
          'with tarfile.open(trav,"w") as t:',
          ' i=tarfile.TarInfo("../escape"); b=b"x"; i.size=len(b); t.addfile(i,io.BytesIO(b))',
          'with open(huge,"wb") as f:',
          ' i=tarfile.TarInfo("huge.bin"); i.size=536870913; f.write(i.tobuf()); f.write(b"\\0"*1024)'
        ].join('\n'),
        traversal,
        oversized
      ],
      { encoding: 'utf8' }
    )
    expect(build.status, build.stderr).toBe(0)
    try {
      for (const [fixture, error] of [
        [traversal, 'unsafe archive path'],
        [oversized, 'size budget']
      ]) {
        const result = spawnSync('python3', ['scripts/preflight-archive.py', 'tar', fixture], {
          cwd: root,
          encoding: 'utf8'
        })
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(error)
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('rejects Debian maintainer hooks before extraction and accepts fixed control metadata', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-deb-control-'))
    const clean = path.join(temporary, 'clean.deb')
    const build = spawnSync(
      'python3',
      [
        '-c',
        [
          'import io,tarfile,sys',
          'def tar(entries):',
          ' out=io.BytesIO()',
          ' with tarfile.open(fileobj=out,mode="w:gz") as t:',
          '  for name,body,mode in entries:',
          '   info=tarfile.TarInfo(name); info.size=len(body); info.mode=mode',
          '   t.addfile(info,io.BytesIO(body))',
          ' return out.getvalue()',
          'def ar(path,control):',
          ' data=tar([("./opt/LeafBook/resources/app.asar",b"x",0o644)])',
          ' members=[("debian-binary",b"2.0\\n"),("control.tar.gz",control),("data.tar.gz",data)]',
          ' with open(path,"wb") as out:',
          '  out.write(b"!<arch>\\n")',
          '  for name,body in members:',
          '   header=f"{name}/".ljust(16)+f"{0:<12}{0:<6}{0:<6}{0o100644:<8}{len(body):<10}`\\n"',
          '   out.write(header.encode("ascii")); out.write(body)',
          '   if len(body)%2: out.write(b"\\n")',
          'fields=["Package: leafbook","Version: 0.1.0","License: MIT","Vendor: LeafBook Contributors","Architecture: amd64","Maintainer: LeafBook Contributors","Installed-Size: 1024","Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0","Recommends: libappindicator3-1","Section: default","Priority: optional","Homepage: https://github.com/Jacquesxu666/marktext","Description: A local-first Markdown book reader and editor."]',
          'body=("\\n".join(fields)+"\\n").encode()',
          'control=tar([("./control",body,0o644),("./md5sums",b"d41d8cd98f00b204e9800998ecf8427e  opt/LeafBook/resources/app.asar\\n",0o644)])',
          'ar(sys.argv[1],control)',
          'for field in ("Pre-Depends: curl","Conflicts: bash","Replaces: coreutils","Essential: yes","Protected: yes","X-Danger: command"):',
          ' poisoned=tar([("./control",body+field.encode()+b"\\n",0o644)])',
          ' ar(f"{sys.argv[2]}/{field.split(chr(58),1)[0]}.deb",poisoned)',
          'for hook in ("preinst","postinst","prerm","postrm","config","templates","triggers"):',
          ' scripted=tar([("./control",body,0o644),(f"./{hook}",b"#!/bin/sh\\ntouch /tmp/pwned\\n",0o755)])',
          ' ar(f"{sys.argv[2]}/{hook}.deb",scripted)'
        ].join('\n'),
        clean,
        temporary
      ],
      { encoding: 'utf8' }
    )
    expect(build.status, build.stderr).toBe(0)
    try {
      const run = (fixture: string) =>
        spawnSync('python3', ['scripts/preflight-archive.py', 'deb', fixture, '0.1.0', 'amd64'], {
          cwd: root,
          encoding: 'utf8'
        })
      expect(run(clean).status).toBe(0)
      for (const field of [
        'Pre-Depends',
        'Conflicts',
        'Replaces',
        'Essential',
        'Protected',
        'X-Danger'
      ]) {
        const rejected = run(path.join(temporary, `${field}.deb`))
        expect(rejected.status).not.toBe(0)
        expect(rejected.stderr).toContain('unapproved fields')
      }
      for (const hook of [
        'preinst',
        'postinst',
        'prerm',
        'postrm',
        'config',
        'templates',
        'triggers'
      ]) {
        const hookFixture = path.join(temporary, `${hook}.deb`)
        const rejected = run(hookFixture)
        expect(rejected.status).not.toBe(0)
        expect(rejected.stderr).toContain('unapproved maintainer metadata or script')
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('streams ZIP output and rejects a 16 MiB payload falsely declared as one byte', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-zip-stream-'))
    const fixture = path.join(temporary, 'lying.zip')
    const destination = path.join(temporary, 'extract')
    fs.mkdirSync(destination)
    const build = spawnSync(
      'python3',
      [
        '-c',
        [
          'import struct,sys,zipfile',
          'p=sys.argv[1]',
          'with zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED) as z: z.writestr("payload.bin",b"A"*(16*1024*1024))',
          'b=bytearray(open(p,"rb").read())',
          'local=b.find(b"PK\\x03\\x04"); central=b.find(b"PK\\x01\\x02")',
          'struct.pack_into("<I",b,local+22,1); struct.pack_into("<I",b,central+24,1)',
          'open(p,"wb").write(b)'
        ].join('\n'),
        fixture
      ],
      { encoding: 'utf8' }
    )
    expect(build.status, build.stderr).toBe(0)
    try {
      const result = spawnSync('python3', ['scripts/safe-extract-zip.py', fixture, destination], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('actual output exceeds declared size')
      const target = path.join(destination, 'payload.bin')
      expect(fs.existsSync(target) ? fs.statSync(target).size : 0).toBeLessThan(4096)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('rejects a ZIP symlink with a forged 64 MiB target without reading its payload', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-zip-link-budget-'))
    const fixture = path.join(temporary, 'lying-link.zip')
    const build = spawnSync(
      'python3',
      [
        '-c',
        [
          'import stat,struct,sys,zipfile',
          'info=zipfile.ZipInfo("link"); info.create_system=3; info.external_attr=(stat.S_IFLNK|0o777)<<16',
          'with zipfile.ZipFile(sys.argv[1],"w") as z: z.writestr(info,b"x")',
          'b=bytearray(open(sys.argv[1],"rb").read())',
          'local=b.find(b"PK\\x03\\x04"); central=b.find(b"PK\\x01\\x02")',
          'struct.pack_into("<I",b,local+22,64*1024*1024)',
          'struct.pack_into("<I",b,central+24,64*1024*1024)',
          'open(sys.argv[1],"wb").write(b)'
        ].join('\n'),
        fixture
      ],
      { encoding: 'utf8' }
    )
    expect(build.status, build.stderr).toBe(0)
    try {
      const result = spawnSync('python3', ['scripts/preflight-archive.py', 'zip', fixture], {
        cwd: root,
        encoding: 'utf8',
        timeout: 2_000
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('link target exceeds budget')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('fails closed when RPM scriptlet or trigger inspection reports any command', () => {
    const audit = read('scripts/audit-platform-artifacts.sh')
    for (const surface of ['scripts', 'triggers', 'filetriggers', 'transfiletriggers']) {
      expect(audit).toContain('scripts triggers filetriggers transfiletriggers')
      expect(audit).toContain('rpm -qp "--$surface"')
      expect(surface).toBeTruthy()
    }
    for (const tag of [
      'PREIN',
      'POSTIN',
      'PREUN',
      'POSTUN',
      'PRETRANS',
      'POSTTRANS',
      'VERIFYSCRIPT',
      'TRIGGERSCRIPTS',
      'FILETRIGGERSCRIPTS',
      'TRANSFILETRIGGERSCRIPTS'
    ]) {
      expect(audit).toContain(tag)
    }
    expect(audit).toContain('RPM carrier contains unapproved $surface.')
    const rpmFixture = 'preflight_rpm_scriptlets "$dist_dir/$' + '{expected[3]}"'
    expect(audit.indexOf(rpmFixture)).toBeLessThan(audit.indexOf('rpm2cpio "$2"'))
  })

  it('accepts only canonical DMG install affordances and bounded presentation metadata', async () => {
    if (process.platform === 'win32') return
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/audit-mac-carrier.mjs')).href
    )) as {
      auditMacCarrier(options: { tree: string; kind: 'dmg' }): Promise<void>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-dmg-shape-'))
    const create = (name: string) => {
      const tree = path.join(temporary, name)
      fs.mkdirSync(path.join(tree, 'LeafBook.app'), { recursive: true })
      fs.symlinkSync('/Applications', path.join(tree, 'Applications'))
      fs.mkdirSync(path.join(tree, '.background'))
      fs.writeFileSync(
        path.join(tree, '.background', 'background.tiff'),
        Buffer.from([0x49, 0x49, 0x2a, 0, 0, 0, 0, 0])
      )
      fs.writeFileSync(
        path.join(tree, '.DS_Store'),
        Buffer.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31])
      )
      fs.writeFileSync(path.join(tree, '.VolumeIcon.icns'), Buffer.from('icns0000'))
      return tree
    }
    try {
      await expect(
        module.auditMacCarrier({ tree: create('valid'), kind: 'dmg' })
      ).resolves.toBeUndefined()

      const fakeApplications = create('fake-applications')
      fs.rmSync(path.join(fakeApplications, 'Applications'))
      fs.writeFileSync(path.join(fakeApplications, 'Applications'), '/Applications')
      await expect(module.auditMacCarrier({ tree: fakeApplications, kind: 'dmg' })).rejects.toThrow(
        'exact /Applications symlink'
      )

      const extraBackground = create('extra-background')
      fs.mkdirSync(path.join(extraBackground, '.background', 'scripts'))
      await expect(module.auditMacCarrier({ tree: extraBackground, kind: 'dmg' })).rejects.toThrow(
        '.background contains an unapproved entry or type'
      )

      const escaping = create('escaping-root-link')
      fs.symlinkSync('/tmp', path.join(escaping, 'escape'))
      await expect(module.auditMacCarrier({ tree: escaping, kind: 'dmg' })).rejects.toThrow(
        /unexpected root entry|unapproved symlink/
      )

      const invalidMagic = create('invalid-magic')
      fs.writeFileSync(path.join(invalidMagic, '.DS_Store'), 'not-finder')
      await expect(module.auditMacCarrier({ tree: invalidMagic, kind: 'dmg' })).rejects.toThrow(
        'invalid magic'
      )

      const oversizedPresentation = create('oversized-presentation')
      fs.truncateSync(path.join(oversizedPresentation, '.VolumeIcon.icns'), 16 * 1024 * 1024 + 1)
      await expect(
        module.auditMacCarrier({ tree: oversizedPresentation, kind: 'dmg' })
      ).rejects.toThrow('invalid size')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('arms bounded DMG cleanup before attach and resolves the actual image device', () => {
    const audit = read('scripts/audit-mac-artifact.sh')
    const armed = audit.lastIndexOf('attach_attempted=1')
    const attach = audit.lastIndexOf('hdiutil attach "$dmg_path"')
    expect(armed).toBeGreaterThan(0)
    expect(attach).toBeGreaterThan(armed)
    expect(audit).toContain('hdiutil info -plist')
    expect(audit).toContain('image.get("image-path", "")')
    expect(audit).toContain('hdiutil detach "$mounted_device"')
    expect(audit).toContain('python3 "$repository_root/scripts/run-bounded.py" 30 20 67108864 --')
  })

  it('scans every Mach-O and accepts only bounded x64/arm64 universal binaries', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/audit-native-tree.mjs')).href
    )) as {
      auditNativeTree(options: {
        tree: string
        platform: 'macos'
        architecture: 'arm64'
        allowUniversal: boolean
      }): Promise<string[]>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-native-tree-'))
    const thin = (cpu: number): Buffer => {
      const header = Buffer.alloc(64)
      header.writeUInt32BE(0xcffaedfe, 0)
      header.writeUInt32LE(cpu, 4)
      return header
    }
    const fat = (...cpus: number[]): Buffer => {
      const header = Buffer.alloc(8 + cpus.length * 20)
      header.writeUInt32BE(0xcafebabe, 0)
      header.writeUInt32BE(cpus.length, 4)
      cpus.forEach((cpu, index) => header.writeUInt32BE(cpu, 8 + index * 20))
      return header
    }
    try {
      fs.writeFileSync(path.join(temporary, 'universal.node'), fat(0x01000007, 0x0100000c))
      await expect(
        module.auditNativeTree({
          tree: temporary,
          platform: 'macos',
          architecture: 'arm64',
          allowUniversal: true
        })
      ).resolves.toEqual(['universal.node'])

      fs.writeFileSync(path.join(temporary, 'mixed-helper'), thin(0x01000007))
      await expect(
        module.auditNativeTree({
          tree: temporary,
          platform: 'macos',
          architecture: 'arm64',
          allowUniversal: true
        })
      ).rejects.toThrow('does not match arm64')
      fs.rmSync(path.join(temporary, 'mixed-helper'))

      fs.writeFileSync(path.join(temporary, 'universal.node'), fat(0x0100000c, 123))
      await expect(
        module.auditNativeTree({
          tree: temporary,
          platform: 'macos',
          architecture: 'arm64',
          allowUniversal: true
        })
      ).rejects.toThrow('Unexpected universal native binary')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('describes the generated dependency inventory without claiming SBOM completeness', () => {
    const notices = read('packages/desktop/build/THIRD-PARTY-LICENSES.txt')
    expect(notices).toContain('generated production dependency license inventory')
    expect(notices).toContain('not an SBOM')
    expect(notices).toContain('multiple versions are intentionally preserved')
    expect(notices).not.toContain('all third-party packages that are bundled')
  })

  it('fails closed when packaged smoke collection contains fewer than eleven tests', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-smoke-list-'))
    const fixture = path.join(temporary, 'playwright-list.txt')
    try {
      fs.writeFileSync(
        fixture,
        [
          'Listing tests:',
          '  [electron] › renderer-security.spec.ts:1:1 › opening untrusted Markdown stays offline, renders local images, and does not execute HTML',
          'Total: 5 tests in 2 files',
          ''
        ].join('\n')
      )
      const result = spawnSync('bash', ['scripts/smoke-mac-unpacked.sh', '--check-list', fixture], {
        cwd: root,
        encoding: 'utf8'
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('must resolve to exactly eleven tests')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('accepts a clean tree and rejects updater names for files, symlinks, and directories', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-updater-audit-'))
    const resources = path.join(temporary, 'LeafBook.app', 'Contents', 'Resources')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-updater-outside-'))
    fs.mkdirSync(resources, { recursive: true })
    const runAudit = () =>
      spawnSync('bash', ['scripts/check-no-updater-files.sh', temporary], {
        cwd: root,
        encoding: 'utf8'
      })
    try {
      expect(runAudit().status).toBe(0)
      const updater = path.join(resources, 'app-update.yml')
      fs.writeFileSync(updater, 'provider: github\n')
      expect(runAudit().status).not.toBe(0)
      fs.rmSync(updater)

      const symlinkTarget =
        process.platform === 'win32' ? outside : path.join(outside, 'innocent-target')
      if (process.platform !== 'win32') fs.writeFileSync(symlinkTarget, 'not updater metadata\n')
      fs.symlinkSync(symlinkTarget, updater, process.platform === 'win32' ? 'junction' : 'file')
      const symlinkRejected = runAudit()
      expect(symlinkRejected.status).not.toBe(0)
      expect(symlinkRejected.stderr).toContain('app-update.yml')
      fs.unlinkSync(updater)

      fs.mkdirSync(path.join(resources, 'pending-update.yml'))
      expect(runAudit().status).not.toBe(0)
      fs.rmSync(path.join(resources, 'pending-update.yml'), { recursive: true })

      const uppercase = path.join(resources, 'APP-UPDATE.YML')
      fs.symlinkSync(symlinkTarget, uppercase, process.platform === 'win32' ? 'junction' : 'file')
      const uppercaseRejected = runAudit()
      expect(uppercaseRejected.status).not.toBe(0)
      expect(uppercaseRejected.stderr).toContain('APP-UPDATE.YML')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it.each([
    '/resources/app-update.yml',
    '/nested/APP-UPDATE.YML',
    '/nested/dev-app-update.yml',
    '/nested/latest-mac.yml',
    '/nested/runtime.BLOCKMAP',
    '/nested/pending.yml',
    '/nested/PENDING-UPDATE.YML',
    '/node_modules/electron-updater/index.js'
  ])('rejects updater runtime or basename in an ASAR listing: %s', (entry) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-asar-listing-'))
    const listing = path.join(temporary, 'asar-list.txt')
    try {
      fs.writeFileSync(listing, `/package.json\n${entry}\n`)
      const result = spawnSync('bash', ['scripts/check-asar-listing-no-updater.sh', listing], {
        cwd: root,
        encoding: 'utf8'
      })
      expect(result.status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('binds packaged smoke to an exact canonical audited app and rejects swaps or stale receipts', () => {
    if (process.platform === 'win32') return
    const temporary = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'leafbook-receipt-test-')
    )
    const distRoot = path.join(temporary, 'dist')
    const appRelative = path.join('mac-arm64', 'LeafBook.app')
    const app = path.join(distRoot, appRelative)
    const machExecutable = Buffer.alloc(32)
    machExecutable.writeUInt32BE(0xfeedfacf, 0)
    machExecutable.writeUInt32BE(0x0100000c, 4)
    const files: Record<string, string | Buffer> = {
      'Contents/MacOS/LeafBook': machExecutable,
      'Contents/Resources/app.asar': 'asar bytes',
      'Contents/Info.plist':
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.jacquesxu.leafbook</string><key>CFBundleDisplayName</key><string>LeafBook</string><key>CFBundleExecutable</key><string>LeafBook</string><key>CFBundleShortVersionString</key><string>0.1.0</string></dict></plist>',
      'Contents/Resources/licenses/LICENSE': 'MIT',
      'Contents/Resources/licenses/NOTICE': 'notice',
      'Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt': 'inventory',
      'Contents/Resources/app.asar.unpacked/native.node': 'native addon',
      'Contents/Frameworks/LeafBook Helper.app/Contents/MacOS/LeafBook Helper': 'helper executable',
      'Contents/Frameworks/Runtime.framework/Versions/A/Runtime': 'framework A',
      'Contents/Frameworks/Runtime.framework/Versions/B/Runtime': 'framework B'
    }
    const options = { distRoot, appRelative, architecture: 'arm64', version: '0.1.0' }
    try {
      for (const [relative, body] of Object.entries(files)) {
        const target = path.join(app, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, body)
      }
      fs.chmodSync(path.join(app, 'Contents/MacOS/LeafBook'), 0o700)
      fs.symlinkSync('Versions/A', path.join(app, 'Contents/Frameworks/Runtime.framework/Current'))
      const initialWrite = runReceipt('writeReceipt', options)
      expect(initialWrite.status, initialWrite.stderr).toBe(0)
      const initialVerify = runReceipt('verifyReceipt', options)
      expect(initialVerify.status, initialVerify.stderr).toBe(0)

      const executable = path.join(app, 'Contents/MacOS/LeafBook')
      fs.appendFileSync(executable, '# swapped\n')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)

      fs.writeFileSync(executable, files['Contents/MacOS/LeafBook'], { mode: 0o700 })
      expect(runReceipt('writeReceipt', options).status).toBe(0)

      const unbound = path.join(app, 'Contents/Resources/unbound-resource.dat')
      fs.writeFileSync(unbound, 'not in receipt')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.rmSync(unbound)

      const fifo = path.join(app, 'Contents/Resources/forbidden-fifo')
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.rmSync(fifo)

      const notice = path.join(app, 'Contents/Resources/licenses/NOTICE')
      fs.rmSync(notice)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.writeFileSync(notice, files['Contents/Resources/licenses/NOTICE'])

      const unpacked = path.join(app, 'Contents/Resources/app.asar.unpacked/native.node')
      fs.appendFileSync(unpacked, ' mutation')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.writeFileSync(unpacked, files['Contents/Resources/app.asar.unpacked/native.node'])

      const helper = path.join(
        app,
        'Contents/Frameworks/LeafBook Helper.app/Contents/MacOS/LeafBook Helper'
      )
      fs.appendFileSync(helper, ' mutation')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.writeFileSync(
        helper,
        files['Contents/Frameworks/LeafBook Helper.app/Contents/MacOS/LeafBook Helper']
      )

      const currentFramework = path.join(app, 'Contents/Frameworks/Runtime.framework/Current')
      fs.rmSync(currentFramework)
      fs.symlinkSync('Versions/B', currentFramework)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
      fs.rmSync(currentFramework)
      fs.symlinkSync('Versions/A', currentFramework)
      expect(runReceipt('verifyReceipt', options).status).toBe(0)

      const outsideWrapper = path.join(temporary, 'wrapper')
      fs.writeFileSync(outsideWrapper, '#!/bin/sh\n', { mode: 0o700 })
      fs.rmSync(executable)
      fs.symlinkSync(outsideWrapper, executable)
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)

      fs.rmSync(executable)
      fs.writeFileSync(executable, files['Contents/MacOS/LeafBook'], { mode: 0o700 })
      expect(runReceipt('writeReceipt', options).status).toBe(0)
      const movedApp = `${app}.swapped`
      fs.renameSync(app, movedApp)
      fs.symlinkSync(movedApp, app, 'dir')
      expect(runReceipt('verifyReceipt', options).status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('rejects symlink, FIFO, and device nodes as release artifact paths', () => {
    if (process.platform === 'win32') return
    const temporary = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'leafbook-safe-artifact-test-')
    )
    const regular = path.join(temporary, 'artifact.zip')
    const symlink = path.join(temporary, 'symlink.zip')
    const fifo = path.join(temporary, 'fifo.zip')
    const check = (kind: string, target: string, containment = temporary) =>
      spawnSync('bash', ['scripts/check-safe-artifact-path.sh', kind, target, containment], {
        cwd: root,
        encoding: 'utf8'
      })
    try {
      fs.writeFileSync(regular, 'artifact')
      expect(check('regular', regular).status).toBe(0)
      fs.symlinkSync(regular, symlink)
      expect(check('regular', symlink).status).not.toBe(0)
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0)
      expect(check('regular', fifo).status).not.toBe(0)
      expect(check('regular', '/dev/null', '/dev').status).not.toBe(0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
