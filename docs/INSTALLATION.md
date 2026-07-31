# Install, upgrade, uninstall, and data locations

## Release status

LeafBook does not yet provide a formal public release. Existing local macOS
candidates are unsigned and unnotarized. Windows and Linux workflow definitions
do not count as native evidence until their retained CI logs and artifacts have
been reviewed. Do not bypass operating-system trust warnings for a file whose
origin and SHA-256 you have not independently verified.

## Verify a downloaded candidate

The candidate directory must contain `SHA256SUMS.txt`. Keep the manifest and the
downloaded files in one directory, then verify every listed file before opening
an installer:

```bash
sha256sum -c SHA256SUMS.txt
```

On macOS, use `shasum -a 256 <file>` and compare the complete digest when GNU
`sha256sum` is unavailable. A future attested candidate must additionally pass
`gh attestation verify <file> -R Jacquesxu666/marktext`; checksums establish
integrity, while attestation binds artifacts to a GitHub workflow identity.

## Install and upgrade

- macOS: after formal signing and notarization evidence exists, open the DMG and
  drag `LeafBook.app` to `/Applications`. Do not use quarantine-removal commands
  as a substitute for that evidence. Upgrade by quitting LeafBook, verifying the
  new candidate, and replacing the application bundle. User data is separate.
- Windows: after signed native installer evidence exists, run the per-user NSIS
  installer. Association prompts are optional. Upgrade with a verified installer
  of the same architecture. Native install/run/uninstall evidence is currently a
  stable-release blocker.
- Linux: after native evidence exists, choose the architecture-matched deb/rpm
  package or portable AppImage/tarball. Snap is not a LeafBook release target.
  AppImage/tar and deb validation definitions exist for Ubuntu 24.04 x64 and
  arm64. RPM validation is defined as `dnf install`/Xvfb smoke/`dnf remove`
  inside a reviewed digest-pinned Fedora image; retained successful receipts
  are still required before release.

Back up manuscripts and the LeafBook user-data directory before any upgrade.
LeafBook edits manuscript files in place; application removal does not remove
those files.

## User-data locations

LeafBook sets Electron's user-data leaf to `leafbook`. Default locations are:

- macOS: `~/Library/Application Support/leafbook`
- Windows: `%APPDATA%\leafbook`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/leafbook`

This directory contains preferences, recents, editor state, keybindings, and
private Prepare recovery drafts under `leafbook-preparation-drafts`. Depending
on Electron and OS behavior, adjacent cache, crash-report, or GPU-cache data may
also exist. Manuscript folders remain wherever the user created them.

## Uninstall

1. Quit every LeafBook window and back up any needed manuscripts or recovery
   drafts.
2. Remove the application with the normal OS mechanism: delete the macOS app,
   use Windows Apps/Installed apps, or use the Linux package manager/remove the
   portable files.
3. To erase settings and recovery state, separately remove only the exact
   `leafbook` user-data directory listed above. Confirm the resolved path before
   deletion. This is irreversible and must never be aimed at its parent.
4. Manuscripts are not application data and must be retained or removed
   separately by the user.

Automatic updates are disabled. Upgrade and rollback are explicit manual
operations until a signed, project-owned update channel is reviewed.
