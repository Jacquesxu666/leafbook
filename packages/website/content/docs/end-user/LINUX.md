# LeafBook on Linux

LeafBook is in active development. There is currently no public LeafBook
release, signed package repository, or automatic-update channel. Do not use old
MarkText packages as LeafBook installers.

## Build from source

Follow the [build prerequisites](../dev/BUILD.md), clone the LeafBook source,
and install the frozen workspace dependencies:

```sh
git clone https://github.com/Jacquesxu666/marktext.git
cd marktext
corepack enable
pnpm install --frozen-lockfile
```

Use `pnpm build` to compile the desktop application without packaging. On a
supported Linux host, `pnpm build:linux` creates the Linux packages in `dist/`.
This is a local build workflow, not a public download or supported binary
distribution.

## Future release artifacts

After LeafBook begins publishing reviewed GitHub Releases, the Linux assets are
expected to use the desktop package version in these names:

```text
leafbook-linux-${VERSION}.AppImage
leafbook-linux-${VERSION}.snap
leafbook-linux-${VERSION}.deb
leafbook-linux-${VERSION}.rpm
leafbook-linux-${VERSION}.tar.gz
```

Those artifacts do not exist in a public release yet, so this page intentionally
does not provide download or package-manager installation commands. Future
downloads must be verified against the `SHA256SUMS.txt` shipped in the same
LeafBook release. Checksums provide integrity verification; they are not package
signatures.

## Desktop integration for local builds

The maintained desktop-entry source is
`packages/desktop/build/linux/leafbook.desktop`. If you install a local package
or create a desktop entry manually, make sure its executable path points to the
locally built `leafbook` executable. Do not reuse an installed MarkText desktop
entry or executable path.

## Configuration and removal

Normal Linux builds store LeafBook application data under
`$XDG_CONFIG_HOME/leafbook`, or `~/.config/leafbook` when
`$XDG_CONFIG_HOME` is unset. Development mode uses `leafbook-dev`, and portable
mode uses a sibling `leafbook-user-data` directory.

Remove a locally built package with the package manager used to install it.
For an AppImage or tar archive, delete the downloaded or extracted files.
Removing the application-data directory also deletes LeafBook preferences and
session state, but it does not delete Markdown folders opened in LeafBook.
