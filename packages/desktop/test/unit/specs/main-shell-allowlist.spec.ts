import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../../src/main')
const walk = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : entry.isFile() ? [target] : []
  })

describe('main-process direct shell call allowlist', () => {
  it('rejects every unreviewed direct OS shell dispatch', () => {
    const actual = walk(root).flatMap((file) => {
      const relative = path.relative(root, file).split(path.sep).join('/')
      return [
        ...fs
          .readFileSync(file, 'utf8')
          .matchAll(/\bshell\.(openExternal|openPath|showItemInFolder|trashItem)\s*\(/g)
      ].map((match) => `${relative}:${match[1]}`)
    })
    expect(actual.sort()).toEqual(
      [
        'keyboard/shortcutHandler.ts:openPath',
        'menu/templates/help.ts:openExternal',
        'menu/templates/help.ts:openExternal',
        'menu/templates/help.ts:openExternal',
        'menu/templates/help.ts:openExternal',
        'menu/templates/help.ts:openExternal',
        'menu/templates/help.ts:openExternal',
        'security/confirmedExternalOpen.ts:openExternal',
        'utils/createGitHubIssue.ts:openExternal'
      ].sort()
    )
  })
})
