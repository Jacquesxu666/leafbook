# LeafBook

LeafBook is a local-first Markdown book reader and editor. Its goal is simple:
open a folder of Markdown documents and make it feel like reading and writing a
book.

The project is under active development. The current application version is
defined only in `packages/desktop/package.json`. The first foundation release
establishes an independent application identity; book-library, `SUMMARY.md`
navigation, reading progress, and whole-book search will follow.

## Development

Requirements and LeafBook-specific safe packaging notes are in
[docs/BUILD.md](docs/BUILD.md). The inherited
[developer documentation](packages/website/content/docs/dev/BUILD.md)
remains transitional reference.
The documents under `packages/website/content/docs` originated in MarkText and
are retained as transitional reference material; LeafBook-specific guides will
replace them as features diverge.

```bash
corepack enable
pnpm install
pnpm dev
```

Common checks:

```bash
pnpm typecheck
pnpm test:unit
pnpm lint
pnpm build
```

The application icons are generated deterministically from
`packages/desktop/build/icons/leafbook.svg` on macOS:

```bash
pnpm generate-leafbook-icons
pnpm verify-leafbook-icons
```

Icon generation currently requires macOS `sips` and `iconutil`. The checked-in
inputs are explicit per platform: `static/icon.icns` for macOS,
`static/icon.ico` for Windows, and `static/icon.png` for Linux. The verification
script regenerates twice, checks hashes and dimensions, and fails if the outputs
are not reproducible.

After a macOS arm64 package build, audit the real app, ZIP, and DMG:

```bash
pnpm audit:mac-artifact
# or: pnpm audit:mac-artifact -- x64
```

This macOS-only audit checks bundle metadata, shipped `LICENSE`/`NOTICE`,
packaged dependency metadata, and confirms the app ASAR does not contain
`electron-updater`.

## Project identity

- Product name: **LeafBook**
- Application ID: `com.jacquesxu.leafbook`
- Executable and package prefix: `leafbook`
- Local user-data directory: `leafbook`
- Automatic updates: disabled until LeafBook has a signed, project-owned
  release channel

Internal `marktext`, `@marktext`, and Muya identifiers are intentionally
retained where they are implementation details. This keeps upstream merges
reviewable and does not affect the installed product identity.

## Attribution and license

LeafBook is an independent derivative of
[MarkText](https://github.com/marktext/marktext). It is not affiliated with or
endorsed by the MarkText project.

MarkText is Copyright (c) 2018-present MarkText Contributors and is distributed
under the MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
