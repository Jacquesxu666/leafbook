/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../../../..')

describe('Linux artifact names', () => {
  it('normalizes electron-builder aarch64 RPM output to the canonical arm64 carrier', async () => {
    const module = (await import(
      pathToFileURL(path.join(root, 'scripts/normalize-linux-artifact-names.mjs')).href
    )) as {
      normalizeLinuxArtifactNames(options: {
        architecture: string
        distDirectory: string
        version: string
      }): Promise<string>
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-linux-rpm-name-'))
    try {
      const source = path.join(temporary, 'leafbook-linux-aarch64-1.0.0.rpm')
      const destination = path.join(temporary, 'leafbook-linux-arm64-1.0.0.rpm')
      fs.writeFileSync(source, 'rpm')

      await expect(
        module.normalizeLinuxArtifactNames({
          architecture: 'arm64',
          distDirectory: temporary,
          version: '1.0.0'
        })
      ).resolves.toBe(destination)
      expect(fs.existsSync(source)).toBe(false)
      expect(fs.readFileSync(destination, 'utf8')).toBe('rpm')

      fs.writeFileSync(source, 'duplicate')
      await expect(
        module.normalizeLinuxArtifactNames({
          architecture: 'arm64',
          distDirectory: temporary,
          version: '1.0.0'
        })
      ).rejects.toThrow('Both legacy and canonical')
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
