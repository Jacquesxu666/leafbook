#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
const commitPattern = /^[0-9a-f]{40}$/u
const tagPattern =
  /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an unexpected schema`)
  }
}

const boundedText = (value, label) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new Error(`Invalid ${label}`)
  }
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code !== undefined && (code <= 31 || code === 127)) throw new Error(`Invalid ${label}`)
  }
  return value
}

const versionFromTag = (tag) => {
  if (!tagPattern.test(tag)) throw new Error('Invalid macOS evidence tag')
  return tag.slice(1)
}

const expectedNames = (architecture, version) => {
  if (!['x64', 'arm64'].includes(architecture)) throw new Error('Unsupported macOS architecture')
  return [
    `leafbook-mac-${architecture}-${version}.dmg`,
    `leafbook-mac-${architecture}-${version}.zip`
  ].sort()
}

const stableHash = async (absolute, name) => {
  const before = await lstat(absolute)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size <= 0 ||
    before.size > 1024 ** 3
  ) {
    throw new Error(`Unsafe macOS evidence carrier: ${name}`)
  }
  const descriptor = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await descriptor.stat()
    const digest = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let total = 0
    while (true) {
      const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > opened.size || total > 1024 ** 3) throw new Error(`Oversized carrier: ${name}`)
      digest.update(buffer.subarray(0, bytesRead))
    }
    const after = await descriptor.stat()
    const final = await lstat(absolute)
    const identity = (item) => [
      item.dev,
      item.ino,
      item.mode,
      item.nlink,
      item.size,
      item.mtimeMs,
      item.ctimeMs
    ]
    if (
      total !== opened.size ||
      JSON.stringify(identity(before)) !== JSON.stringify(identity(opened)) ||
      JSON.stringify(identity(opened)) !== JSON.stringify(identity(after)) ||
      JSON.stringify(identity(opened)) !== JSON.stringify(identity(final))
    ) {
      throw new Error(`Carrier changed while hashing: ${name}`)
    }
    return { name, sha256: digest.digest('hex'), size: total }
  } finally {
    await descriptor.close()
  }
}

const hashCarriers = async (directory, architecture, version) => {
  const expected = expectedNames(architecture, version)
  const actual = (await readdir(directory)).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...expected, 'SHA256SUMS.txt'].sort())) {
    throw new Error('macOS evidence directory does not match its exact carrier set')
  }
  const carriers = await Promise.all(
    expected.map((name) => stableHash(path.join(directory, name), name))
  )
  const manifest = await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  const declared = new Map()
  for (const line of manifest.split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._+-]*)$/u.exec(line)
    if (!match || declared.has(match[2])) throw new Error('Malformed macOS checksum manifest')
    declared.set(match[2], match[1])
  }
  if (JSON.stringify([...declared.keys()].sort()) !== JSON.stringify(expected)) {
    throw new Error('macOS checksum subject set mismatch')
  }
  for (const carrier of carriers) {
    if (declared.get(carrier.name) !== carrier.sha256) {
      throw new Error(`macOS checksum mismatch: ${carrier.name}`)
    }
  }
  return carriers
}

const validateRunner = (runner, architecture) => {
  exactKeys(runner, ['arch', 'imageOs', 'imageVersion', 'label', 'os'], 'macOS runner')
  for (const [key, value] of Object.entries(runner)) boundedText(value, `runner ${key}`)
  if (
    runner.os.toLowerCase() !== 'macos' ||
    runner.arch.toLowerCase() !== architecture.toLowerCase()
  ) {
    throw new Error('macOS runner does not match receipt architecture')
  }
  return runner
}

const validateEnvironment = (environment, runner) => {
  exactKeys(environment, ['image', 'imageDigest', 'imageId', 'kind'], 'macOS environment')
  if (
    environment.kind !== 'host' ||
    environment.imageDigest !== 'not-applicable' ||
    environment.image !== runner.imageOs ||
    environment.imageId !== runner.imageVersion
  ) {
    throw new Error('macOS host environment does not match its runner image')
  }
  return environment
}

export const buildObservation = async ({
  stage,
  architecture,
  tag,
  commit,
  runner,
  environment,
  carrierDirectory
}) => {
  if (!stages.includes(stage)) throw new Error('Unsupported macOS evidence stage')
  if (!commitPattern.test(commit)) throw new Error('Invalid macOS evidence commit')
  const version = versionFromTag(tag)
  return {
    schema: 'leafbook-macos-stage-observation-v1',
    stage,
    tag,
    commit,
    architecture,
    runner: validateRunner(runner, architecture),
    environment: validateEnvironment(environment, runner),
    carriers: await hashCarriers(carrierDirectory, architecture, version),
    result: { passed: true }
  }
}

const validateObservations = ({ observations, architecture, tag, commit, carriers }) => {
  if (!Array.isArray(observations) || observations.length !== stages.length) {
    throw new Error('macOS receipt requires every stage observation')
  }
  const byStage = new Map()
  let runnerBinding
  for (const observation of observations) {
    exactKeys(
      observation,
      [
        'architecture',
        'carriers',
        'commit',
        'environment',
        'result',
        'runner',
        'schema',
        'stage',
        'tag'
      ],
      'macOS stage observation'
    )
    if (
      observation.schema !== 'leafbook-macos-stage-observation-v1' ||
      !stages.includes(observation.stage) ||
      byStage.has(observation.stage)
    ) {
      throw new Error('Unexpected or duplicate macOS stage observation')
    }
    if (
      observation.architecture !== architecture ||
      observation.tag !== tag ||
      observation.commit !== commit
    ) {
      throw new Error('macOS stage observation release binding mismatch')
    }
    validateRunner(observation.runner, architecture)
    validateEnvironment(observation.environment, observation.runner)
    exactKeys(observation.result, ['passed'], `${observation.stage} result`)
    if (observation.result.passed !== true) {
      throw new Error(`macOS ${observation.stage} stage did not pass`)
    }
    if (JSON.stringify(observation.carriers) !== JSON.stringify(carriers)) {
      throw new Error('macOS stage observation carrier digest mismatch')
    }
    const currentRunnerBinding = JSON.stringify({
      runner: observation.runner,
      environment: observation.environment
    })
    if (runnerBinding === undefined) runnerBinding = currentRunnerBinding
    if (currentRunnerBinding !== runnerBinding) {
      throw new Error('macOS stage observations disagree on runner identity')
    }
    byStage.set(observation.stage, observation)
  }
  return stages.map((stage) => byStage.get(stage))
}

export const buildReceipt = async ({
  architecture,
  tag,
  commit,
  carrierDirectory,
  observations
}) => {
  if (!commitPattern.test(commit)) throw new Error('Invalid macOS receipt commit')
  const carriers = await hashCarriers(carrierDirectory, architecture, versionFromTag(tag))
  return {
    schema: 'leafbook-macos-native-evidence-v1',
    tag,
    commit,
    platform: 'macos',
    architecture,
    carriers,
    observations: validateObservations({ observations, architecture, tag, commit, carriers })
  }
}

export const verifyReceipt = async ({ receipt, carrierDirectory }) => {
  exactKeys(
    receipt,
    ['architecture', 'carriers', 'commit', 'observations', 'platform', 'schema', 'tag'],
    'macOS native receipt'
  )
  if (receipt.schema !== 'leafbook-macos-native-evidence-v1' || receipt.platform !== 'macos') {
    throw new Error('Unsupported macOS native receipt')
  }
  const rebuilt = await buildReceipt({
    architecture: receipt.architecture,
    tag: receipt.tag,
    commit: receipt.commit,
    carrierDirectory,
    observations: receipt.observations
  })
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) {
    throw new Error('macOS receipt is not canonical or carrier bytes changed')
  }
}

const parseArguments = (values) => {
  const result = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith('--') || value === undefined || key.slice(2) in result) {
      throw new Error('Malformed macOS evidence arguments')
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
  if (command === 'observe') {
    const runner = runnerFromArgs(args)
    const observation = await buildObservation({
      stage: args.stage,
      architecture: args.architecture,
      tag: args.tag,
      commit: args.commit,
      runner,
      environment: {
        kind: 'host',
        image: runner.imageOs,
        imageDigest: 'not-applicable',
        imageId: runner.imageVersion
      },
      carrierDirectory: path.resolve(args.carriers)
    })
    await writeFile(args.output, `${JSON.stringify(observation, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    return
  }
  if (command === 'write') {
    const observations = await Promise.all(
      stages.map(async (stage) => JSON.parse(await readFile(args[`${stage}-report`], 'utf8')))
    )
    const receipt = await buildReceipt({
      architecture: args.architecture,
      tag: args.tag,
      commit: args.commit,
      carrierDirectory: path.resolve(args.carriers),
      observations
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
    await verifyReceipt({ receipt, carrierDirectory: path.resolve(args.carriers) })
    return
  }
  throw new Error('Usage: macos-native-evidence.mjs {observe|write|verify} ...')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
