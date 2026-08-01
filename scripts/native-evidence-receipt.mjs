#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sha256Pattern = /^[0-9a-f]{64}$/u
const commitPattern = /^[0-9a-f]{40}$/u
const tagPattern =
  /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const fedoraDigest = 'sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814'
const fedoraImage = `fedora@${fedoraDigest}`
const lifecycleStages = ['install', 'smoke', 'uninstall', 'residue']

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has an unexpected schema`)
  }
}

const boundedText = (value, label) => {
  const hasControlCharacter =
    typeof value === 'string' &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
    })
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || hasControlCharacter) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

const parseTagVersion = (tag) => {
  if (typeof tag !== 'string' || !tagPattern.test(tag)) throw new Error('Invalid release tag')
  return tag.slice(1)
}

const expectedCarrierNames = (platform, architecture, version) => {
  if (!['x64', 'arm64'].includes(architecture)) throw new Error('Unsupported architecture')
  if (platform === 'windows') {
    return [
      `leafbook-win-${architecture}-${version}-setup.exe`,
      `leafbook-win-${architecture}-${version}.zip`
    ]
  }
  if (platform === 'linux') {
    return [
      `leafbook-linux-${architecture}-${version}.AppImage`,
      `leafbook-linux-${architecture}-${version}.deb`,
      `leafbook-linux-${architecture}-${version}.rpm`,
      `leafbook-linux-${architecture}-${version}.tar.gz`
    ]
  }
  throw new Error('Unsupported native evidence platform')
}

const lifecycleCarrierNames = (category, architecture, version) => {
  const prefix = `leafbook-linux-${architecture}-${version}`
  if (category === 'portable') return [`${prefix}.AppImage`, `${prefix}.tar.gz`]
  if (category === 'deb') return [`${prefix}.deb`]
  if (category === 'rpm') return [`${prefix}.rpm`]
  throw new Error('Unsupported Linux lifecycle category')
}

const stableHash = async (absolute, label) => {
  const before = await lstat(absolute)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size <= 0 ||
    before.size > 1024 ** 3
  ) {
    throw new Error(`Unsafe evidence file: ${label}`)
  }
  const descriptor = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await descriptor.stat()
    const identity = (item) => [
      item.dev,
      item.ino,
      item.mode,
      item.nlink,
      item.size,
      item.mtimeMs,
      item.ctimeMs
    ]
    if (JSON.stringify(identity(before)) !== JSON.stringify(identity(opened))) {
      throw new Error(`Evidence file changed before hashing: ${label}`)
    }
    const digest = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let total = 0
    while (true) {
      const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > opened.size || total > 1024 ** 3) {
        throw new Error(`Evidence file exceeded its bound: ${label}`)
      }
      digest.update(buffer.subarray(0, bytesRead))
    }
    const after = await descriptor.stat()
    const final = await lstat(absolute)
    if (
      total !== opened.size ||
      JSON.stringify(identity(opened)) !== JSON.stringify(identity(after)) ||
      JSON.stringify(identity(opened)) !== JSON.stringify(identity(final))
    ) {
      throw new Error(`Evidence file changed while hashing: ${label}`)
    }
    return { name: label, sha256: digest.digest('hex'), size: total }
  } finally {
    await descriptor.close()
  }
}

const hashCarriers = async ({ directory, platform, architecture, version }) => {
  const expected = expectedCarrierNames(platform, architecture, version).sort()
  const actual = []
  const handle = await opendir(directory)
  for await (const entry of handle) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Unsafe carrier directory entry: ${entry.name}`)
    }
    actual.push(entry.name)
  }
  actual.sort()
  if (JSON.stringify(actual) !== JSON.stringify([...expected, 'SHA256SUMS.txt'].sort())) {
    throw new Error('Carrier directory does not match the exact native evidence set')
  }
  const carriers = []
  for (const name of expected) carriers.push(await stableHash(path.join(directory, name), name))
  const manifest = await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  const declared = new Map()
  for (const line of manifest.split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._+-]*)$/u.exec(line)
    if (!match || declared.has(match[2])) {
      throw new Error('Malformed native evidence checksum manifest')
    }
    declared.set(match[2], match[1])
  }
  if (JSON.stringify([...declared.keys()].sort()) !== JSON.stringify(expected)) {
    throw new Error('Native evidence checksum subject set mismatch')
  }
  for (const carrier of carriers) {
    if (declared.get(carrier.name) !== carrier.sha256) {
      throw new Error(`Native evidence checksum mismatch: ${carrier.name}`)
    }
  }
  return carriers
}

const validateRunner = (runner, platform, architecture) => {
  exactKeys(runner, ['arch', 'imageOs', 'imageVersion', 'label', 'os'], 'validation runner')
  for (const [key, value] of Object.entries(runner)) boundedText(value, `runner ${key}`)
  const expectedOs = platform === 'windows' ? 'windows' : 'linux'
  const expectedArch = architecture === 'arm64' ? 'arm64' : 'x64'
  if (runner.os.toLowerCase() !== expectedOs || runner.arch.toLowerCase() !== expectedArch) {
    throw new Error('Validation runner does not match the receipt platform and architecture')
  }
  return runner
}

const validateEnvironment = (environment, category, runner) => {
  exactKeys(environment, ['image', 'imageDigest', 'imageId', 'kind'], 'validation environment')
  if (category === 'rpm') {
    if (
      environment.kind !== 'fedora-container' ||
      environment.image !== fedoraImage ||
      environment.imageDigest !== fedoraDigest ||
      !/^sha256:[0-9a-f]{64}$/u.test(environment.imageId)
    ) {
      throw new Error(
        'RPM lifecycle does not bind the reviewed Fedora digest and resolved image ID'
      )
    }
  } else if (
    environment.kind !== 'host' ||
    environment.imageDigest !== 'not-applicable' ||
    environment.image !== runner.imageOs ||
    environment.imageId !== runner.imageVersion
  ) {
    throw new Error('Portable/deb lifecycle must bind its validation runner host image')
  }
  boundedText(environment.image, 'environment image')
  boundedText(environment.imageId, 'environment image ID')
  return environment
}

export const buildLinuxStageObservation = async ({
  category,
  stage,
  architecture,
  tag,
  commit,
  runner,
  environment,
  carrierDirectory
}) => {
  const version = parseTagVersion(tag)
  if (!commitPattern.test(commit)) throw new Error('Invalid lifecycle commit')
  if (!lifecycleStages.includes(stage)) throw new Error('Unsupported Linux lifecycle stage')
  const allCarriers = await hashCarriers({
    directory: carrierDirectory,
    platform: 'linux',
    architecture,
    version
  })
  const expected = lifecycleCarrierNames(category, architecture, version).sort()
  const carriers = allCarriers.filter(({ name }) => expected.includes(name))
  if (JSON.stringify(carriers.map(({ name }) => name).sort()) !== JSON.stringify(expected)) {
    throw new Error('Lifecycle carrier set mismatch')
  }
  return {
    schema: 'leafbook-linux-stage-observation-v1',
    category,
    stage,
    tag,
    commit,
    architecture,
    runner: validateRunner(runner, 'linux', architecture),
    environment: validateEnvironment(environment, category, runner),
    carriers,
    result: { passed: true }
  }
}

const validateLinuxStageObservations = ({ observations, category, architecture, tag, commit }) => {
  if (!Array.isArray(observations) || observations.length !== lifecycleStages.length) {
    throw new Error('Linux lifecycle requires four stage observations')
  }
  const byStage = new Map()
  let baseline
  for (const observation of observations) {
    exactKeys(
      observation,
      [
        'architecture',
        'carriers',
        'category',
        'commit',
        'environment',
        'result',
        'runner',
        'schema',
        'stage',
        'tag'
      ],
      'Linux stage observation'
    )
    if (
      observation.schema !== 'leafbook-linux-stage-observation-v1' ||
      !lifecycleStages.includes(observation.stage) ||
      byStage.has(observation.stage)
    ) {
      throw new Error('Unexpected or duplicate Linux lifecycle stage observation')
    }
    if (
      observation.category !== category ||
      observation.architecture !== architecture ||
      observation.tag !== tag ||
      observation.commit !== commit
    ) {
      throw new Error('Linux stage observation release binding mismatch')
    }
    validateRunner(observation.runner, 'linux', architecture)
    validateEnvironment(observation.environment, category, observation.runner)
    exactKeys(observation.result, ['passed'], `${observation.stage} stage result`)
    if (observation.result.passed !== true) {
      throw new Error(`Linux ${observation.stage} lifecycle stage did not pass`)
    }
    if (!Array.isArray(observation.carriers)) {
      throw new Error('Linux stage observation carriers must be an array')
    }
    const binding = JSON.stringify({
      runner: observation.runner,
      environment: observation.environment,
      carriers: observation.carriers
    })
    if (baseline === undefined) baseline = binding
    if (binding !== baseline) throw new Error('Linux lifecycle stage observations disagree')
    byStage.set(observation.stage, observation)
  }
  return lifecycleStages.map((stage) => byStage.get(stage))
}

export const buildLinuxLifecycleReport = ({
  category,
  architecture,
  tag,
  commit,
  observations
}) => {
  const ordered = validateLinuxStageObservations({
    observations,
    category,
    architecture,
    tag,
    commit
  })
  const first = ordered[0]
  return {
    schema: 'leafbook-linux-lifecycle-v2',
    category,
    tag,
    commit,
    architecture,
    runner: first.runner,
    environment: first.environment,
    carriers: first.carriers,
    observations: ordered
  }
}

const validateLinuxLifecycleReports = ({ reports, architecture, tag, commit, carriers }) => {
  if (!Array.isArray(reports) || reports.length !== 3) {
    throw new Error('Linux receipt requires three lifecycle reports')
  }
  const byCategory = new Map()
  for (const report of reports) {
    exactKeys(
      report,
      [
        'architecture',
        'carriers',
        'category',
        'commit',
        'environment',
        'observations',
        'runner',
        'schema',
        'tag'
      ],
      'Linux lifecycle report'
    )
    if (
      report.schema !== 'leafbook-linux-lifecycle-v2' ||
      !['portable', 'deb', 'rpm'].includes(report.category) ||
      byCategory.has(report.category)
    ) {
      throw new Error('Unexpected or duplicate Linux lifecycle report')
    }
    if (report.architecture !== architecture || report.tag !== tag || report.commit !== commit) {
      throw new Error('Linux lifecycle report release binding mismatch')
    }
    validateRunner(report.runner, 'linux', architecture)
    validateEnvironment(report.environment, report.category, report.runner)
    const observations = validateLinuxStageObservations({
      observations: report.observations,
      category: report.category,
      architecture,
      tag,
      commit
    })
    const first = observations[0]
    if (
      JSON.stringify(report.runner) !== JSON.stringify(first.runner) ||
      JSON.stringify(report.environment) !== JSON.stringify(first.environment) ||
      JSON.stringify(report.carriers) !== JSON.stringify(first.carriers)
    ) {
      throw new Error('Linux lifecycle aggregate does not match its stage observations')
    }
    const version = parseTagVersion(tag)
    const expected = lifecycleCarrierNames(report.category, architecture, version).sort()
    if (
      !Array.isArray(report.carriers) ||
      JSON.stringify(report.carriers.map(({ name }) => name).sort()) !== JSON.stringify(expected)
    ) {
      throw new Error('Linux lifecycle report carrier set mismatch')
    }
    for (const item of report.carriers) {
      exactKeys(item, ['name', 'sha256', 'size'], 'lifecycle carrier')
      const carrier = carriers.find(({ name }) => name === item.name)
      if (!carrier || JSON.stringify(item) !== JSON.stringify(carrier)) {
        throw new Error('Linux lifecycle report carrier hash mismatch')
      }
    }
    byCategory.set(report.category, report)
  }
  return ['portable', 'deb', 'rpm'].map((category) => byCategory.get(category))
}

const validateSignature = (signature, platform, carriers) => {
  exactKeys(signature, ['policy', 'subjects'], 'signature report')
  if (!Array.isArray(signature.subjects)) throw new Error('Signature subjects must be an array')
  if (platform === 'linux') {
    if (signature.policy !== 'not-applicable' || signature.subjects.length !== 0) {
      throw new Error('Linux signature report must be explicitly not applicable')
    }
    return signature
  }
  if (signature.policy !== 'authenticode-valid-v1' || signature.subjects.length !== 2) {
    throw new Error('Windows Authenticode policy is incomplete')
  }
  const setup = carriers.find(({ name }) => name.endsWith('-setup.exe'))
  const roles = new Set()
  for (const subject of signature.subjects) {
    exactKeys(
      subject,
      ['name', 'role', 'sha256', 'signerThumbprint', 'status'],
      'signature subject'
    )
    if (!['setup', 'installed-executable'].includes(subject.role) || roles.has(subject.role)) {
      throw new Error('Unexpected or duplicate signature role')
    }
    roles.add(subject.role)
    if (
      subject.status !== 'Valid' ||
      !sha256Pattern.test(subject.sha256) ||
      !/^[0-9A-F]{40}$/u.test(subject.signerThumbprint)
    ) {
      throw new Error('Invalid Authenticode result')
    }
    if (
      subject.role === 'setup' &&
      (subject.name !== setup?.name || subject.sha256 !== setup.sha256)
    ) {
      throw new Error('Setup signature is not bound to the carrier bytes')
    }
    if (subject.role === 'installed-executable' && subject.name !== 'leafbook.exe') {
      throw new Error('Unexpected installed executable signature subject')
    }
  }
  return signature
}

const validateWindowsEvidence = (evidence, architecture) => {
  exactKeys(evidence, ['environment', 'runner', 'runtime'], 'Windows evidence')
  validateRunner(evidence.runner, 'windows', architecture)
  exactKeys(
    evidence.environment,
    ['image', 'imageDigest', 'imageId', 'kind'],
    'Windows environment'
  )
  if (
    evidence.environment.kind !== 'host' ||
    evidence.environment.imageDigest !== 'not-applicable' ||
    evidence.environment.image !== evidence.runner.imageOs ||
    evidence.environment.imageId !== evidence.runner.imageVersion
  ) {
    throw new Error('Windows evidence environment is invalid')
  }
  boundedText(evidence.environment.image, 'Windows environment image')
  boundedText(evidence.environment.imageId, 'Windows environment image ID')
  exactKeys(
    evidence.runtime,
    ['associations', 'install', 'residue', 'shortcuts', 'smoke', 'uninstall'],
    'Windows runtime'
  )
  for (const phase of ['install', 'residue', 'shortcuts', 'smoke', 'uninstall']) {
    exactKeys(evidence.runtime[phase], ['passed'], `${phase} result`)
    if (evidence.runtime[phase].passed !== true) {
      throw new Error(`Windows ${phase} validation did not pass`)
    }
  }
  exactKeys(
    evidence.runtime.associations,
    ['defaultNo', 'extensionsUnchanged', 'protocolsAbsent'],
    'association result'
  )
  if (!Object.values(evidence.runtime.associations).every((value) => value === true)) {
    throw new Error('Windows association policy did not pass')
  }
  return evidence
}

export const buildNativeEvidenceReceipt = async ({
  platform,
  architecture,
  tag,
  commit,
  carrierDirectory,
  signature,
  windowsEvidence,
  linuxLifecycles
}) => {
  const version = parseTagVersion(tag)
  if (!commitPattern.test(commit)) throw new Error('Invalid evidence commit')
  const carriers = await hashCarriers({
    directory: carrierDirectory,
    platform,
    architecture,
    version
  })
  const receipt = {
    schema: 'leafbook-native-evidence-v2',
    tag,
    commit,
    platform,
    architecture,
    carriers,
    signature: validateSignature(signature, platform, carriers),
    windowsEvidence: null,
    linuxLifecycles: []
  }
  if (platform === 'windows') {
    if (linuxLifecycles?.length) throw new Error('Windows receipt cannot contain Linux lifecycles')
    receipt.windowsEvidence = validateWindowsEvidence(windowsEvidence, architecture)
  } else {
    if (windowsEvidence !== null && windowsEvidence !== undefined) {
      throw new Error('Linux receipt cannot contain Windows evidence')
    }
    receipt.linuxLifecycles = validateLinuxLifecycleReports({
      reports: linuxLifecycles,
      architecture,
      tag,
      commit,
      carriers
    })
  }
  return receipt
}

export const verifyNativeEvidenceReceipt = async ({ receipt, carrierDirectory }) => {
  exactKeys(
    receipt,
    [
      'architecture',
      'carriers',
      'commit',
      'linuxLifecycles',
      'platform',
      'schema',
      'signature',
      'tag',
      'windowsEvidence'
    ],
    'native evidence receipt'
  )
  if (receipt.schema !== 'leafbook-native-evidence-v2') {
    throw new Error('Unsupported native evidence receipt schema')
  }
  const rebuilt = await buildNativeEvidenceReceipt({
    platform: receipt.platform,
    architecture: receipt.architecture,
    tag: receipt.tag,
    commit: receipt.commit,
    carrierDirectory,
    signature: receipt.signature,
    windowsEvidence: receipt.windowsEvidence,
    linuxLifecycles: receipt.linuxLifecycles
  })
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) {
    throw new Error('Native evidence receipt is not canonical or no longer matches carrier bytes')
  }
}

const parseArguments = (values) => {
  const result = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith('--') || value === undefined || key in result) {
      throw new Error('Malformed native evidence arguments')
    }
    result[key.slice(2)] = value
  }
  return result
}

const runnerFromArgs = (args) => ({
  label: args['runner-label'],
  os: args['runner-os'],
  arch: args['runner-arch'],
  imageOs: args['image-os'],
  imageVersion: args['image-version']
})

const main = async () => {
  const [command, ...values] = process.argv.slice(2)
  const args = parseArguments(values)
  if (command === 'stage-write') {
    const environment = args['environment-report']
      ? JSON.parse(await readFile(args['environment-report'], 'utf8'))
      : {
          kind: 'host',
          image: args['image-os'],
          imageDigest: 'not-applicable',
          imageId: args['image-version']
        }
    const report = await buildLinuxStageObservation({
      category: args.category,
      stage: args.stage,
      architecture: args.architecture,
      tag: args.tag,
      commit: args.commit,
      runner: runnerFromArgs(args),
      environment,
      carrierDirectory: path.resolve(args.carriers)
    })
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    return
  }
  if (command === 'lifecycle-write') {
    const observations = await Promise.all(
      lifecycleStages.map(async (stage) =>
        JSON.parse(await readFile(args[`${stage}-report`], 'utf8'))
      )
    )
    const report = buildLinuxLifecycleReport({
      category: args.category,
      architecture: args.architecture,
      tag: args.tag,
      commit: args.commit,
      observations
    })
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    return
  }
  if (command === 'write') {
    const signature = JSON.parse(await readFile(args['signature-report'], 'utf8'))
    const windowsEvidence =
      args.platform === 'windows'
        ? {
            runner: runnerFromArgs(args),
            environment: JSON.parse(await readFile(args['environment-report'], 'utf8')),
            runtime: JSON.parse(await readFile(args['runtime-report'], 'utf8'))
          }
        : null
    let linuxLifecycles = []
    if (args.platform === 'linux') {
      const lifecycleArguments = ['portable-lifecycle', 'deb-lifecycle', 'rpm-lifecycle']
      linuxLifecycles = await Promise.all(
        lifecycleArguments.map(async (name) => JSON.parse(await readFile(args[name], 'utf8')))
      )
    }
    const receipt = await buildNativeEvidenceReceipt({
      platform: args.platform,
      architecture: args.architecture,
      tag: args.tag,
      commit: args.commit,
      carrierDirectory: path.resolve(args.carriers),
      signature,
      windowsEvidence,
      linuxLifecycles
    })
    await writeFile(args.output, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    return
  }
  if (command === 'verify') {
    const receipt = JSON.parse(await readFile(args.receipt, 'utf8'))
    await verifyNativeEvidenceReceipt({ receipt, carrierDirectory: path.resolve(args.carriers) })
    return
  }
  throw new Error(
    'Usage: native-evidence-receipt.mjs {stage-write|lifecycle-write|write|verify} ...'
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
