#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = JSON.parse(
  await fs.readFile(path.join(root, 'packages/desktop/package.json'), 'utf8')
)

const lstatIfPresent = async (target) => {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const requireSafeRegular = (stats, label) => {
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size === 0) {
    throw new Error(`${label} must be one non-empty regular file with one link`)
  }
}

export const normalizeLinuxArtifactNames = async ({ architecture, distDirectory, version }) => {
  if (architecture !== 'arm64') {
    throw new Error('Linux artifact normalization only supports arm64')
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Linux artifact normalization requires a canonical package version')
  }

  const source = path.join(distDirectory, `leafbook-linux-aarch64-${version}.rpm`)
  const destination = path.join(distDirectory, `leafbook-linux-arm64-${version}.rpm`)
  const [sourceStats, destinationStats] = await Promise.all([
    lstatIfPresent(source),
    lstatIfPresent(destination)
  ])

  if (sourceStats && destinationStats) {
    throw new Error('Both legacy and canonical Linux ARM64 RPM names exist')
  }
  if (destinationStats) {
    requireSafeRegular(destinationStats, 'Canonical Linux ARM64 RPM')
    return destination
  }
  requireSafeRegular(sourceStats, 'electron-builder Linux ARM64 RPM')

  await fs.rename(source, destination)
  const normalizedStats = await fs.lstat(destination)
  requireSafeRegular(normalizedStats, 'Normalized Linux ARM64 RPM')
  if (
    normalizedStats.dev !== sourceStats.dev ||
    normalizedStats.ino !== sourceStats.ino ||
    normalizedStats.size !== sourceStats.size
  ) {
    throw new Error('Normalized Linux ARM64 RPM identity changed during rename')
  }
  return destination
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const architecture = process.argv[2]
  const distDirectory = path.join(root, 'dist')
  const canonicalDist = await fs.realpath(distDirectory)
  if (canonicalDist !== distDirectory) {
    throw new Error('Linux artifact normalization requires the canonical repository dist directory')
  }
  const normalized = await normalizeLinuxArtifactNames({
    architecture,
    distDirectory,
    version: desktop.version
  })
  console.log(`Normalized Linux artifact: ${path.basename(normalized)}`)
}
