# Releasing LeafBook

LeafBook release drafts are created by the `Release LeafBook` workflow in
`.github/workflows/release.yml`. Pushing a `v*` tag starts the pipeline; public
publication remains a separate reviewed action:

```text
validate tag → native build/validation receipts → exact-byte assembly → attest → draft
```

`packages/desktop/package.json` is the single source of truth for the
application version. The release tag must be exactly `v` followed by that
version.

## Current release policy

- Runtime automatic updates are disabled. LeafBook does not depend on
  `electron-updater` and does not have a signed, project-owned update feed.
- Release assets must not include `latest*.yml`, any `.blockmap`, or other
  auto-updater metadata.
- Release macOS carriers must come from the protected signing/notarization job
  and pass fresh no-secret signature, stapling, Gatekeeper, audit, packaged
  smoke, `/Applications` install/launch, and cleanup receipt validation. Local
  development macOS builds remain unsigned and are never release assets.
- Windows release installers must come from the protected signing job and pass
  fresh-runner Authenticode/install/launch/uninstall receipt validation.
- Linux packages are not signed by a LeafBook package repository.
- `SHA256SUMS.txt` provides download integrity checks. It is not a substitute
  for platform code signing or notarization.
- The inherited website workflow only lints, type-checks, and builds the site.
  It does not deploy to an upstream or LeafBook-owned target.

## Prerequisites

- Push access to `Jacquesxu666/marktext`.
- An authenticated GitHub CLI (`gh auth status`) if using the commands below.
- A clean checkout of the commit intended for release.
- All required changes merged to `develop`.
- Protected `windows-signing` Environment approval and its certificate secrets
  configured as Environment-level (not repository-level) secrets; the reviewed
  public signer thumbprint remains configured as `WIN_SIGNER_SHA1`.
- Protected `macos-signing` Environment approval and its five Apple
  signing/notarization values configured as Environment-level (not
  repository-level) secrets. Reusable-workflow callers cannot pass Environment
  secrets, so the release jobs have no signing-secret mapping and the protected
  jobs resolve them directly; validation jobs receive none of them.
- Protected release tags and reviewers prepared to inspect retained native
  receipts, attestations, logs, and the draft before publication.

## 1. Set the desktop version

Set the authoritative `version` field in `packages/desktop/package.json`. For
example, a valid stable version has this shape:

```json
{
  "name": "leafbook",
  "version": "<major>.<minor>.<patch>"
}
```

Pre-release versions use valid SemVer with a suffix such as `-rc.1`. Do not treat
the root `package.json` as an application version source; it is the private
workspace orchestrator and intentionally has no `version`.

After setting the desktop version, synchronize the checked-in metadata that is
validated against it:

- the newest `<release>` entry in
  `packages/desktop/build/linux/leafbook.appdata.xml`;
- the version examples in `.github/ISSUE_TEMPLATE/bug_report.yml` and
  `.github/DISCUSSION_TEMPLATE/q-and-a.yml`.

These are derived mirrors, not independent version sources.

## 2. Validate the release commit

Run the local gates before committing the version change:

```bash
VERSION="$(node -p "require('./packages/desktop/package.json').version")"
pnpm verify-leafbook-metadata
node scripts/validate-release-tag.mjs "v${VERSION}"
pnpm test
pnpm typecheck
pnpm lint
```

Use the tag matching the version being prepared. The release workflow repeats
the metadata, Windows-association, third-party-notice, and platform artifact
audits on the appropriate CI runners.

Commit the release-ready state and push it through the normal review process:

```bash
git add packages/desktop/package.json \
  packages/desktop/build/linux/leafbook.appdata.xml \
  .github/ISSUE_TEMPLATE/bug_report.yml \
  .github/DISCUSSION_TEMPLATE/q-and-a.yml
git commit -m "chore(release): v${VERSION}"
git push origin HEAD
```

If other generated or release-note files legitimately change, include them
explicitly; do not use a broad add command without reviewing the diff.

## 3. Tag the exact release commit

After the release commit is on `develop`, create and push an annotated tag:

```bash
git switch develop
git pull --ff-only
VERSION="$(node -p "require('./packages/desktop/package.json').version")"
git tag -a "v${VERSION}" -m "LeafBook v${VERSION}"
git push origin "v${VERSION}"
```

The validate job rejects malformed SemVer tags and any tag that is not `v`
followed by the desktop package version at the tagged commit. A version
containing a pre-release suffix marks the resulting draft as a GitHub
pre-release; a plain three-component SemVer tag creates a non-prerelease draft.
Neither path publishes the draft.

## 4. What CI builds and audits

The native evidence graph contains six architecture lanes. Each lane may use
multiple isolated jobs so that protected signing/build work is separated from
fresh-machine validation:

| Runner                 | Architecture | Expected assets            | Required native evidence                                         |
| ---------------------- | ------------ | -------------------------- | ---------------------------------------------------------------- |
| Ubuntu 24.04           | x64          | AppImage, deb, rpm, tar.gz | fresh AppImage/tar/deb plus pinned-Fedora RPM lifecycle receipts |
| Ubuntu 24.04 ARM       | arm64        | AppImage, deb, rpm, tar.gz | fresh AppImage/tar/deb plus pinned-Fedora RPM lifecycle receipts |
| Windows                | x64          | NSIS setup.exe, zip        | Authenticode and fresh install/launch/uninstall receipt          |
| Windows 11 ARM         | arm64        | NSIS setup.exe, zip        | Authenticode and fresh install/launch/uninstall receipt          |
| macOS 15 Intel         | x64          | signed dmg, signed zip     | notarization, Gatekeeper, audits and fresh install receipt       |
| macOS 15 Apple silicon | arm64        | signed dmg, signed zip     | notarization, Gatekeeper, audits and fresh install receipt       |

This is exactly 16 cross-platform artifacts. Snap is not a release target:

```text
leafbook-linux-x64-${VERSION}.AppImage
leafbook-linux-x64-${VERSION}.deb
leafbook-linux-x64-${VERSION}.rpm
leafbook-linux-x64-${VERSION}.tar.gz
leafbook-linux-arm64-${VERSION}.AppImage
leafbook-linux-arm64-${VERSION}.deb
leafbook-linux-arm64-${VERSION}.rpm
leafbook-linux-arm64-${VERSION}.tar.gz
leafbook-win-x64-${VERSION}-setup.exe
leafbook-win-x64-${VERSION}.zip
leafbook-win-arm64-${VERSION}-setup.exe
leafbook-win-arm64-${VERSION}.zip
leafbook-mac-x64-${VERSION}.dmg
leafbook-mac-x64-${VERSION}.zip
leafbook-mac-arm64-${VERSION}.dmg
leafbook-mac-arm64-${VERSION}.zip
```

Here `${VERSION}` denotes the exact value read from
`packages/desktop/package.json`.

The release assembly downloads each architecture-qualified candidate together
with the native receipt produced for those same bytes. It rebinds every receipt
to the tag, commit, platform and architecture, recomputes every carrier hash,
and copies only the verified macOS 4 + Windows 4 + Linux 8 carriers into the
exact-16 set. `scripts/audit-release-files.sh` rejects missing, empty or extra
files, including `latest*.yml` and `.blockmap` updater metadata, before creating
`SHA256SUMS.txt`.

Only that receipt-bound exact-16 candidate reaches build-provenance and SBOM
attestation. After attestation succeeds, the write-permission job revalidates
the exact final snapshot and creates a **draft** GitHub Release. It does not
publish the draft. If an authorized reviewer later approves publication, the
public asset contract is 17 files: the 16 carriers plus `SHA256SUMS.txt`.

## 5. Monitor and verify

```bash
gh run list --workflow=release.yml --limit 3
gh run watch <run-id> --exit-status
VERSION="$(node -p "require('./packages/desktop/package.json').version")"
gh release view "v${VERSION}"
```

Confirm that:

- all signed/native evidence jobs and independent regression audits passed;
- the release has the expected stable or pre-release status;
- the 16 exact packages/archives and `SHA256SUMS.txt` are present;
- no `latest*.yml` or `.blockmap` asset is present;
- the checksums validate for downloaded files:

  ```bash
  sha256sum -c SHA256SUMS.txt --ignore-missing
  ```

Unsigned and unnotarized macOS builds are development evidence only. Do not
publish instructions that remove quarantine or bypass Gatekeeper; wait for a
signed, notarized candidate that passes independent downloaded-artifact review.

## 6. After publishing

- Record the release outcome and any CI exceptions in the project worklog.
- If development must continue at a new version, update
  `packages/desktop/package.json` in a separate reviewed change.
- Do not enable updater metadata or automatic updates until LeafBook has a
  project-owned update channel and a reviewed signing and rollout design.

For a patch release from an existing stable LeafBook tag, follow the
[LeafBook hotfix process](RELEASE_HOTFIX.md).
