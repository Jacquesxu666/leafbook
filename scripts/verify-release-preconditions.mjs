#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const MAX_TAG_DEPTH = 32

const requiredString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${label}.`)
  }
  return value
}

export const peelTagTarget = async ({ repository, tag, api }) => {
  const encodedTag = tag
    .split('/')
    .map((component) => encodeURIComponent(component))
    .join('/')
  let object = (await api(`repos/${repository}/git/ref/tags/${encodedTag}`))?.object
  const visited = new Set()

  for (let depth = 0; depth < MAX_TAG_DEPTH; depth++) {
    const type = requiredString(object?.type, 'Git tag object type')
    const sha = requiredString(object?.sha, 'Git tag object SHA')
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new Error(`GitHub returned an invalid ${type} SHA for ${tag}.`)
    }
    if (type === 'commit') return sha.toLowerCase()
    if (type !== 'tag') {
      throw new Error(`Git tag ${tag} resolves to unsupported object type ${type}.`)
    }
    if (visited.has(sha)) throw new Error(`Git tag ${tag} contains an annotation cycle.`)
    visited.add(sha)
    object = (await api(`repos/${repository}/git/tags/${sha}`))?.object
  }

  throw new Error(`Git tag ${tag} exceeded the maximum annotation depth.`)
}

export const verifyReleasePreconditions = async ({
  repository,
  tag,
  expectedSha,
  api,
  rejectExistingRelease = true
}) => {
  const target = await peelTagTarget({ repository, tag, api })
  if (target !== expectedSha.toLowerCase()) {
    throw new Error(
      `Server tag ${tag} resolves to ${target}, not triggering commit ${expectedSha.toLowerCase()}.`
    )
  }

  if (rejectExistingRelease) {
    const pages = await api(`repos/${repository}/releases?per_page=100`, {
      paginate: true,
      slurp: true
    })
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw new Error('GitHub Releases API returned an unexpected paginated response.')
    }
    const matches = pages.flat().filter((release) => release?.tag_name === tag)
    if (matches.length !== 0) {
      throw new Error(`A GitHub Release already exists for ${tag}; refusing to edit or replace it.`)
    }
  }

  return target
}

const ghApi = (endpoint, { paginate = false, slurp = false } = {}) => {
  const args = ['api']
  if (paginate) args.push('--paginate')
  if (slurp) args.push('--slurp')
  args.push(endpoint)
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error) throw new Error(`Unable to execute GitHub CLI: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`GitHub API request failed for ${endpoint}: ${result.stderr.trim()}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}.`)
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    const repository = requiredString(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY')
    const tag = requiredString(process.env.GITHUB_REF_NAME, 'GITHUB_REF_NAME')
    const expectedSha = requiredString(process.env.GITHUB_SHA, 'GITHUB_SHA')
    if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
      throw new Error('GITHUB_SHA is not a full commit SHA.')
    }
    await verifyReleasePreconditions({ repository, tag, expectedSha, api: ghApi })
    console.log(`Server tag ${tag} is bound to ${expectedSha} and has no existing Release.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
