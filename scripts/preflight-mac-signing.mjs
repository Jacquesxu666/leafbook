#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID'
]
const missing = required.filter(
  (name) => typeof process.env[name] !== 'string' || process.env[name].length === 0
)
if (missing.length > 0) {
  console.error(
    `BLOCKED: missing macOS signing/notarization credential variables: ${missing.join(', ')}`
  )
  process.exit(1)
}
if (!/^[A-Z0-9]{10}$/.test(process.env.APPLE_TEAM_ID)) {
  console.error(
    'BLOCKED: APPLE_TEAM_ID is present but does not have the expected 10-character shape.'
  )
  process.exit(1)
}

const builder = await readFile(path.join(root, 'packages/desktop/electron-builder.yml'), 'utf8')
if (!/^ {2}notarize: false$/m.test(builder) || !/^publish: null$/m.test(builder)) {
  throw new Error(
    'Unsigned local packaging defaults changed; review the release boundary before signing'
  )
}
console.log(
  'macOS signing/notarization credential presence and local unsigned defaults passed preflight.'
)
