<p align="center">
  <img src="packages/desktop/build/icons/leafbook.svg" alt="LeafBook logo" width="112" height="112">
</p>

<h1 align="center">LeafBook</h1>

<p align="center">
  <strong>Read a folder of Markdown files like a book.</strong><br>
  A local-first Markdown book reader and editor for macOS, Windows, and Linux.<br>
  <sub>把一整个 Markdown 文件夹，变成一本可以阅读、整理和编辑的书。</sub>
</p>

<p align="center">
  <a href="https://github.com/Jacquesxu666/leafbook/actions/workflows/build.yml"><img src="https://github.com/Jacquesxu666/leafbook/actions/workflows/build.yml/badge.svg?branch=develop" alt="Build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Jacquesxu666/leafbook" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/version-1.0.0-2f855a" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-334155" alt="macOS, Windows and Linux">
</p>

---

LeafBook turns an ordinary directory of Markdown documents into a focused book
workspace. Your manuscripts stay in folders you control; LeafBook discovers the
chapters, builds navigation, remembers where you stopped, and lets you move
between reading and editing without uploading the book to a service.

## What you can do

- **Open a book folder** — use an existing `SUMMARY.md` or let LeafBook infer a
  deterministic chapter tree from the directory.
- **Prepare a manuscript** — turn the top-level headings in one long Markdown
  document into a reviewed `SUMMARY.md` without changing the source document.
- **Read with context** — navigate chapters, restore reading progress and scroll
  position, and search across the whole book.
- **Arrange the contents** — reorder and nest existing `SUMMARY.md` entries with
  keyboard, buttons, drag-and-drop, undo, cancel, and explicit save.
- **Edit a chapter** — switch from Reader to the Markdown editor, save locally,
  detect external changes, and return to the same reading position.
- **Export the book** — create a self-contained offline HTML file or a local
  static website with deterministic assets and manifests.
- **Keep local media local** — render bounded local raster images and safe SVGs
  while remote renderer network access remains denied by default.

## Local-first by design

LeafBook does not require an account or a hosted workspace. Book discovery,
reading, editing, preparation drafts, search, and export run on your computer.
Opening a folder grants the app access to that folder, and edits write directly
to your manuscript files, so normal backups still matter.

See [Privacy and security](docs/PRIVACY_SECURITY.md) for the complete trust and
data-handling model.

## Release status

LeafBook 1.0.0 has passed the project test suite and cross-platform packaging
audits. Public installers are not posted yet because the macOS and Windows
packages still need project-owned code-signing and notarization credentials.

| Platform | Planned formats            | Current status                                       |
| -------- | -------------------------- | ---------------------------------------------------- |
| macOS    | DMG, ZIP                   | Packaging verified; signing and notarization pending |
| Windows  | NSIS installer, ZIP        | Packaging verified; Authenticode signing pending     |
| Linux    | AppImage, tar.gz, DEB, RPM | Packaging and carrier audits verified                |

Do not treat an unsigned development artifact as a formal release. Installation,
upgrade, uninstall, checksum, and data-location guidance lives in
[Installation](docs/INSTALLATION.md).

## Run from source

LeafBook uses Node.js, pnpm, Electron, Vue, and the Muya editing engine.

```bash
corepack enable
pnpm install
pnpm dev
```

Common validation commands:

```bash
pnpm typecheck
pnpm test:unit
pnpm lint
pnpm build
```

Platform dependencies and safe packaging commands are documented in
[Building LeafBook](docs/BUILD.md).

## Documentation

| Guide                                      | Covers                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| [Reader workspace](docs/BOOK_READER.md)    | Bookshelf, discovery, navigation, search, and progress    |
| [Prepare Book](docs/PREPARE_BOOK.md)       | Converting a long manuscript into reviewed navigation     |
| [Arrange book](docs/BOOK_ARRANGEMENT.md)   | Safe `SUMMARY.md` reordering and save behavior            |
| [Chapter editing](docs/BOOK_EDITING.md)    | Reader/editor transitions and conflict handling           |
| [Single-file export](docs/BOOK_EXPORT.md)  | Offline semantic HTML export                              |
| [Website generation](docs/BOOK_WEBSITE.md) | Deterministic local static-site output                    |
| [Release gate](docs/RELEASE_GATE.md)       | Signing, carrier audits, evidence, and publication policy |

## Project identity

- Product: **LeafBook**
- Application ID: `com.jacquesxu.leafbook`
- Package and executable prefix: `leafbook`
- License: MIT

LeafBook is an independent derivative of
[MarkText](https://github.com/marktext/marktext). It is not affiliated with or
endorsed by the MarkText project. Upstream copyright and attribution are
preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Contributing

Issues and focused pull requests are welcome. Please read the relevant design
guide before changing book parsing, filesystem access, export, or release code;
those boundaries deliberately fail closed.

If LeafBook is useful to you, starring the repository is a simple way to help
the project become easier to discover.
