import fs from 'fs'
import os from 'node:os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  generateThirdPartyLicense,
  renderThirdPartyNotices
} from '../../../../../scripts/generateThirdPartyLicense'
import {
  APP_ID,
  APP_NAME,
  APP_SLUG,
  AUTO_UPDATE_ENABLED,
  brandTranslations,
  DISCUSSIONS_URL,
  DOCUMENTATION_URLS,
  ISSUES_URL,
  REPOSITORY_URL
} from '@shared/brand'

const desktopRoot = process.cwd()
const repositoryRoot = path.resolve(desktopRoot, '../..')
const readDesktopFile = (relativePath: string): string =>
  fs.readFileSync(`${desktopRoot}/${relativePath}`, 'utf8')

describe('LeafBook public identity', () => {
  it('uses one stable product identity', () => {
    expect({
      APP_NAME,
      APP_SLUG,
      APP_ID,
      REPOSITORY_URL
    }).toEqual({
      APP_NAME: 'LeafBook',
      APP_SLUG: 'leafbook',
      APP_ID: 'com.jacquesxu.leafbook',
      REPOSITORY_URL: 'https://github.com/Jacquesxu666/marktext'
    })
  })

  it('keeps package and installer artifacts independent from MarkText', () => {
    const packageJson = JSON.parse(readDesktopFile('package.json')) as {
      name: string
      version: string
      license: string
      dependencies: Record<string, string>
      author: { name: string; url: string }
      maintainer: Array<{ name: string; url: string }>
    }
    const builder = readDesktopFile('electron-builder.yml')
    const installer = readDesktopFile('build/windows/installer.nsh')
    const extensionVariable = '$' + '{EXTENSION}'

    expect(packageJson.name).toBe(APP_SLUG)
    expect(packageJson.license).toBe('MIT')
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(packageJson.author).toEqual({
      name: 'Jacquesxu666',
      url: 'https://github.com/Jacquesxu666'
    })
    expect(packageJson.maintainer).toEqual([packageJson.author])
    expect(packageJson.dependencies['electron-updater']).toBeUndefined()
    expect(builder).toContain(`appId: ${APP_ID}`)
    expect(builder).toContain(`productName: ${APP_NAME}`)
    expect(builder).toContain('from: ../../LICENSE')
    expect(builder).toContain('to: licenses/LICENSE')
    expect(builder).toContain('from: ../../NOTICE')
    expect(builder).toContain('to: licenses/NOTICE')
    expect(builder).toContain('from: build/THIRD-PARTY-LICENSES.txt')
    expect(builder).toContain('to: licenses/THIRD-PARTY-LICENSES.txt')
    expect(builder).toContain('icon: static/icon.icns')
    expect(builder).toContain('icon: static/icon.ico')
    expect(builder).toContain("icon: 'static/icon.png'")
    expect(builder).toContain('executableName: leafbook')
    expect(builder).toMatch(/leafbook-win-\$\{arch\}-\$\{version\}\.\$\{ext\}/)
    expect(builder).not.toContain("'marktext-win-")
    expect(installer).toContain('LeafBook.Document')
    expect(builder).not.toMatch(/^fileAssociations:/m)
    expect(installer.indexOf('MessageBox MB_YESNO')).toBeLessThan(
      installer.indexOf('WriteRegStr HKCU')
    )
    expect(installer).toContain('$APPDATA\\leafbook')
    expect(installer).toContain('ReadRegStr $0 HKCU')
    expect(installer).toContain('StrCmp $0 "LeafBook.Document" 0 +3')
    expect(installer).toContain(`DeleteRegValue HKCU "Software\\Classes\\${extensionVariable}" ""`)
    expect(installer).toContain(
      `DeleteRegKey /ifempty HKCU "Software\\Classes\\${extensionVariable}"`
    )
    expect(installer).not.toContain(`DeleteRegKey HKCU "Software\\Classes\\${extensionVariable}"`)
    expect(installer).toContain('StrCmp $0 \'"$INSTDIR\\leafbook.exe" "%1"\' 0 KeepProgId')
    expect(installer).not.toMatch(/^\s*DeleteRegKey HKCU "Software\\Classes\\\.md"$/m)
    expect(installer).not.toContain('MarkText.Document')
    expect(installer).not.toContain('$APPDATA\\marktext')
  })

  it('keeps help and repository links on the current LeafBook fork', () => {
    expect(ISSUES_URL).toBe(`${REPOSITORY_URL}/issues`)
    expect(DISCUSSIONS_URL).toBe(`${REPOSITORY_URL}/discussions`)
    expect(Object.values(DOCUMENTATION_URLS)).toHaveLength(5)
    for (const url of Object.values(DOCUMENTATION_URLS)) {
      expect(url).toContain(`${REPOSITORY_URL}/blob/develop/`)
      expect(url).not.toContain('marktext.me')
    }

    const sourceFiles = [
      'src/main/menu/templates/help.ts',
      'src/renderer/src/commands/index.ts',
      'src/renderer/src/prefComponents/keybindings/index.vue',
      'src/renderer/src/prefComponents/image/components/folderSetting/index.vue',
      'src/renderer/src/components/exportSettings/index.vue'
    ]
    for (const sourceFile of sourceFiles) {
      expect(readDesktopFile(sourceFile)).not.toContain('marktext.me')
    }
  })

  it('uses LeafBook names in build, release, launch, and community templates', () => {
    const repositoryFile = (relativePath: string): string =>
      fs.readFileSync(`${repositoryRoot}/${relativePath}`, 'utf8')
    const desktopPackage = JSON.parse(readDesktopFile('package.json')) as {
      version: string
    }
    const websitePackage = JSON.parse(repositoryFile('packages/website/package.json')) as {
      name: string
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    const installation = repositoryFile('packages/website/content/docs/end-user/INSTALLATION.md')
    const linuxInstallation = repositoryFile('packages/website/content/docs/end-user/LINUX.md')
    const websiteRuntimeFiles = [
      'packages/website/src/app/layout.tsx',
      'packages/website/src/app/robots.ts',
      'packages/website/src/lib/downloads.ts',
      'packages/website/src/components/Download.tsx',
      'packages/website/src/components/Footer.tsx',
      'packages/website/src/components/Hero.tsx',
      'packages/website/src/components/Nav.tsx',
      'packages/website/src/components/Support.tsx'
    ]
    const checkedFiles = [
      '.github/workflows/build.yml',
      '.github/workflows/release.yml',
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/ISSUE_TEMPLATE/feature_request.md',
      '.github/DISCUSSION_TEMPLATE/q-and-a.yml',
      'packages/desktop/test/e2e/launch.spec.ts'
    ]
    for (const checkedFile of checkedFiles) {
      const content = repositoryFile(checkedFile)
      expect(content).not.toContain('https://github.com/marktext/marktext')
      expect(content).not.toContain('marktext.me')
    }
    expect(repositoryFile('.github/workflows/build.yml')).toMatch(
      /name: leafbook-\$\{\{ matrix\.name \}\}/
    )
    expect(repositoryFile('.github/workflows/release.yml')).toContain('/Applications/LeafBook.app')
    expect(repositoryFile('.github/workflows/release.yml')).toContain(
      'node scripts/validate-release-tag.mjs "$' + '{GITHUB_REF_NAME}"'
    )
    expect(repositoryFile('.github/workflows/release.yml')).not.toContain('dist/*.blockmap')
    expect(repositoryFile('.github/workflows/release.yml')).not.toContain('dist/*.yml')
    expect(repositoryFile('.github/ISSUE_TEMPLATE/bug_report.yml')).toContain(
      `placeholder: 'e.g. ${desktopPackage.version}'`
    )
    expect(repositoryFile('.github/DISCUSSION_TEMPLATE/q-and-a.yml')).toContain(
      `placeholder: "e.g. ${desktopPackage.version}"`
    )
    expect(repositoryFile('packages/desktop/build/linux/leafbook.appdata.xml')).toContain(
      `version="${desktopPackage.version}"`
    )
    expect(repositoryFile('packages/desktop/test/e2e/launch.spec.ts')).toContain(
      'Untitled-1 - LeafBook'
    )
    expect(websitePackage.name).toBe('leafbook-docs-validation')
    expect(Object.keys(websitePackage.scripts)).not.toContain('start')
    expect(Object.keys(websitePackage.scripts).join('\n')).not.toMatch(
      /(?:deploy|publish|preview|cf:)/
    )
    expect(Object.values(websitePackage.scripts).join('\n')).not.toMatch(
      /(?:wrangler|opennextjs-cloudflare)/
    )
    expect(websitePackage.devDependencies).not.toHaveProperty('@opennextjs/cloudflare')
    expect(websitePackage.devDependencies).not.toHaveProperty('wrangler')
    expect(fs.existsSync(`${repositoryRoot}/packages/website/wrangler.toml`)).toBe(false)
    expect(fs.existsSync(`${repositoryRoot}/packages/website/open-next.config.ts`)).toBe(false)
    expect(fs.existsSync(`${repositoryRoot}/packages/website/src/middleware.ts`)).toBe(false)
    expect(fs.existsSync(`${repositoryRoot}/packages/website/src/app/sitemap.ts`)).toBe(false)
    expect(repositoryFile('packages/website/next.config.ts')).not.toContain(
      "output: 'standalone'"
    )
    for (const websiteRuntimeFile of websiteRuntimeFiles) {
      const content = repositoryFile(websiteRuntimeFile)
      expect(content).not.toContain('marktext.me')
      expect(content).not.toContain('github.com/marktext/marktext/releases/latest')
    }
    expect(repositoryFile('packages/website/src/app/layout.tsx')).toContain('index: false')
    expect(repositoryFile('packages/website/src/app/robots.ts')).toContain("disallow: '/'")
    expect(repositoryFile('packages/website/README.md')).toContain(
      'not the LeafBook product website'
    )
    expect(repositoryFile('packages/website/README.md')).toContain('Never publish `.next/`')
    expect(installation).toContain('There is currently no public, signed')
    expect(installation).toContain('exactly 13 platform packages and archives')
    expect(installation).toContain('SHA256SUMS.txt')
    expect(installation).toContain('must not contain `latest*.yml`, `.blockmap`')
    expect(installation).not.toContain('github.com/marktext/marktext/releases')
    expect(installation).not.toContain('brew install --cask mark-text')
    expect(installation).not.toContain('SHA-512')
    expect(linuxInstallation).toMatch(/There is currently no public LeafBook\s+release/)
    expect(linuxInstallation).toContain('leafbook-linux-$' + '{VERSION}.AppImage')
    expect(linuxInstallation).toContain('$XDG_CONFIG_HOME/leafbook')
    expect(linuxInstallation).not.toContain('github.com/marktext/marktext/releases/latest')
    expect(linuxInstallation).not.toContain('marktext-%version%')
    expect(repositoryFile('README.md')).not.toContain('currently at version `0.1.0`')
    expect(repositoryFile('packages/website/content/docs/dev/RELEASE.md')).not.toContain('0.1.0')
  })

  it('keeps HTML and importable UI branding consistent with APP_NAME', () => {
    expect(readDesktopFile('src/renderer/index.html')).toContain(`<title>${APP_NAME}</title>`)
    expect(readDesktopFile('src/renderer/src/components/about/index.vue')).toContain(
      'const name = APP_NAME'
    )
    expect(readDesktopFile('src/renderer/src/components/titleBar/index.vue')).toContain(
      '{{ APP_NAME }}'
    )
    expect(readDesktopFile('src/main/windows/editor.ts')).toContain(
      '`$' + '{APP_NAME} has crashed`'
    )
  })

  it('ships non-empty third-party license bodies', () => {
    const notices = readDesktopFile('build/THIRD-PARTY-LICENSES.txt')
    expect(notices).not.toMatch(/^undefined$/m)
    expect(notices).toContain('# Third Party Notices')
    expect(notices.length).toBeGreaterThan(10_000)
  })

  it('fails license generation when the checker errors or returns no packages', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'leafbook-license-test-'))
    const outputPath = path.join(temporaryDirectory, 'notices.txt')

    const checkerFailure = generateThirdPartyLicense((_root, callback) => {
      callback(new Error('simulated checker failure'))
    }, outputPath)
    return expect(checkerFailure)
      .rejects.toThrow('simulated checker failure')
      .then(() => {
        expect(fs.existsSync(outputPath)).toBe(false)
        return expect(
          generateThirdPartyLicense((_root, callback) => {
            callback(null, {})
          }, outputPath)
        ).rejects.toThrow('No third-party packages were returned')
      })
      .then(() => {
        expect(fs.existsSync(outputPath)).toBe(false)
        fs.rmSync(temporaryDirectory, { recursive: true })
      })
  })

  it('refuses to render an empty third-party package map', () => {
    expect(() => renderThirdPartyNotices({})).toThrow('No third-party packages were returned')
  })

  it('keeps checked-in icon outputs at the required PNG dimensions', () => {
    const pngDimensions = (relativePath: string): [number, number] => {
      const png = fs.readFileSync(`${desktopRoot}/${relativePath}`)
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
      return [png.readUInt32BE(16), png.readUInt32BE(20)]
    }

    expect(pngDimensions('static/icon.png')).toEqual([1024, 1024])
    expect(pngDimensions('build/icons/icon.png')).toEqual([512, 512])
    expect(pngDimensions('static/logo-96px.png')).toEqual([96, 96])
    expect(pngDimensions('static/logo-small.png')).toEqual([96, 96])
    expect(pngDimensions('src/renderer/src/assets/images/logo.png')).toEqual([256, 256])
  })

  it('isolates normal, development, and portable user-data paths', () => {
    const bootstrap = readDesktopFile('src/main/index.ts')
    const cli = readDesktopFile('src/main/cli/index.ts')

    expect(bootstrap).toContain(
      "app.setPath('userData', path.join(app.getPath('appData'), APP_SLUG))"
    )
    expect(cli).toMatch(/APP_SLUG\}-dev/)
    expect(cli).toMatch(/APP_SLUG\}-user-data/)
    expect(cli).not.toContain("'marktext-dev'")
    expect(cli).not.toContain("'marktext-user-data'")
  })

  it('disables inherited automatic updates at code and package level', () => {
    const updateAction = readDesktopFile('src/main/menu/actions/marktext.ts')
    const appMenu = readDesktopFile('src/main/menu/templates/marktext.ts')
    const helpMenu = readDesktopFile('src/main/menu/templates/help.ts')
    const rendererCommands = readDesktopFile('src/renderer/src/commands/index.ts')

    expect(AUTO_UPDATE_ENABLED).toBe(false)
    expect(updateAction).not.toContain("from 'electron-updater'")
    expect(updateAction).not.toContain('autoUpdater.')
    expect(updateAction).toContain('Automatic updates are disabled')
    expect(appMenu).not.toContain('checkUpdates(')
    expect(helpMenu).not.toContain('checkUpdates(')
    expect(rendererCommands).toContain('AUTO_UPDATE_ENABLED && isUpdatable()')
  })

  it('brands inherited locale text without changing internal keys', () => {
    expect(
      brandTranslations({
        menu: { marktext: { title: 'MarkText', quit: 'Quit MarkText' } },
        untouched: 42
      })
    ).toEqual({
      menu: { marktext: { title: 'LeafBook', quit: 'Quit LeafBook' } },
      untouched: 42
    })
  })

  it('preserves the MIT license and carries explicit upstream attribution', () => {
    const license = fs.readFileSync(`${repositoryRoot}/LICENSE`, 'utf8')
    const notice = fs.readFileSync(`${repositoryRoot}/NOTICE`, 'utf8')
    const rootPackage = JSON.parse(fs.readFileSync(`${repositoryRoot}/package.json`, 'utf8')) as {
      license: string
    }

    expect(rootPackage.license).toBe('MIT')
    expect(license).toContain('Copyright (c) 2018-present MarkText Contributors')
    expect(notice).toContain('https://github.com/marktext/marktext')
    expect(notice).toContain('independent derivative project')
  })
})
