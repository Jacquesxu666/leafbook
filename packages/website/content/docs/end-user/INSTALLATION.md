# Installation

LeafBook is in active development. There is currently no public, signed
LeafBook release and there is no automatic-update channel. Until a reviewed
GitHub Release is published, build the application locally from the repository.

## Build from source

Install the prerequisites listed in the
[build instructions](../dev/BUILD.md), then:

```sh
git clone https://github.com/Jacquesxu666/marktext.git
cd marktext
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` compiles LeafBook without creating an installer. To create
platform packages on a supported host, use the matching command:

```sh
pnpm build:mac
pnpm build:win
pnpm build:linux
```

Packaged installers and archives are written to `dist/`.

## Future GitHub releases

When public LeafBook releases begin, each release is expected to contain
exactly 13 platform packages and archives:

| Platform | Expected artifacts |
| --- | --- |
| Linux | AppImage, snap, deb, rpm, and tar.gz |
| Windows x64 | NSIS installer and portable zip |
| Windows arm64 | NSIS installer and portable zip |
| macOS x64 | DMG and zip |
| macOS arm64 | DMG and zip |

The release will also contain `SHA256SUMS.txt`, for 14 assets in total. LeafBook
release assets must not contain `latest*.yml`, `.blockmap`, or other
automatic-update metadata.

These packages are not available yet, so this guide intentionally does not
provide a release download link.

## Verify a future download

After downloading a package and `SHA256SUMS.txt` from the same GitHub Release,
verify the files before opening them:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing
```

On macOS, use `shasum -a 256 <downloaded-file>` and compare the result with the
corresponding entry in `SHA256SUMS.txt`.

Checksums detect accidental corruption or replacement, but do not provide code
signing. The current release design does not sign or notarize macOS builds,
code-sign Windows installers, or publish signed Linux repository packages.

## Updating

LeafBook does not check for or install updates automatically. For local source
builds, fetch a reviewed revision and rebuild it. After public releases begin,
updates will require downloading and verifying the replacement package
manually unless a signed, project-owned update channel is introduced later.

## Uninstall

| Platform | How |
| --- | --- |
| Windows | Use **Settings → Apps** for an installed build, or delete a portable build. |
| macOS | Drag **LeafBook.app** to the Trash. |
| Linux package | Remove it with the package manager used to install it. |
| Linux AppImage / tar.gz | Delete the downloaded or extracted files. |

To remove local preferences and session data as well, delete LeafBook's
platform-specific application data directory. This is separate from any
Markdown folders opened in LeafBook.
