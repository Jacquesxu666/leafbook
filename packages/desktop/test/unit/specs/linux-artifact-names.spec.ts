/* eslint-disable @stylistic/space-before-function-paren */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../../../..')

describe('Linux artifact names', () => {
  it.each([
    {
      architecture: 'x64',
      builderNames: [
        'x86_64-1.0.0.AppImage',
        'amd64-1.0.0.deb',
        'x86_64-1.0.0.rpm',
        'x64-1.0.0.tar.gz'
      ]
    },
    {
      architecture: 'arm64',
      builderNames: [
        'arm64-1.0.0.AppImage',
        'arm64-1.0.0.deb',
        'aarch64-1.0.0.rpm',
        'arm64-1.0.0.tar.gz'
      ]
    }
  ])(
    'normalizes electron-builder $architecture output to canonical carrier names',
    async ({ architecture, builderNames }) => {
      const module = (await import(
        pathToFileURL(path.join(root, 'scripts/normalize-linux-artifact-names.mjs')).href
      )) as {
        normalizeLinuxArtifactNames(options: {
          architecture: string
          distDirectory: string
          version: string
        }): Promise<string[]>
      }
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-linux-rpm-name-'))
      try {
        for (const builderName of builderNames) {
          fs.writeFileSync(path.join(temporary, `leafbook-linux-${builderName}`), builderName)
        }

        await expect(
          module.normalizeLinuxArtifactNames({
            architecture,
            distDirectory: temporary,
            version: '1.0.0'
          })
        ).resolves.toEqual(
          ['AppImage', 'deb', 'rpm', 'tar.gz'].map((extension) =>
            path.join(temporary, `leafbook-linux-${architecture}-1.0.0.${extension}`)
          )
        )
        for (const extension of ['AppImage', 'deb', 'rpm', 'tar.gz']) {
          expect(
            fs.statSync(path.join(temporary, `leafbook-linux-${architecture}-1.0.0.${extension}`))
              .size
          ).toBeGreaterThan(0)
        }

        const duplicateSourceArchitecture = architecture === 'x64' ? 'x86_64' : 'aarch64'
        fs.writeFileSync(
          path.join(temporary, `leafbook-linux-${duplicateSourceArchitecture}-1.0.0.rpm`),
          'duplicate'
        )
        await expect(
          module.normalizeLinuxArtifactNames({
            architecture,
            distDirectory: temporary,
            version: '1.0.0'
          })
        ).rejects.toThrow('Both builder and canonical')
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true })
      }
    }
  )
})
