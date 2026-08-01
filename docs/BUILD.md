# Building LeafBook

LeafBook's canonical desktop package is `packages/desktop`. Development builds
are not release artifacts:

```bash
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test:unit
```

To generate the deterministic release SBOM locally, bind its timestamp to the
exact source commit:

```bash
SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)" \
  pnpm generate:release-sbom -- /tmp/leafbook.spdx.json
```

The command rejects a missing, zero, non-canonical, or out-of-range epoch. For
identical output payloads it emits identical bytes. The document namespace is a
domain-separated SHA-256 of canonical JSON for every SPDX output field except
`documentNamespace` itself, including creation metadata, packages, platform-
dependent inventory, relationships, and document descriptors. A source or
policy change that leaves the normalized output unchanged leaves the namespace
unchanged; every actual payload change changes it. Output changes must also bump
`SBOM_GENERATOR_VERSION` when they alter generator behavior.

## Safe local macOS package

The only approved local release-gate package command is:

```bash
pnpm package:mac:unsigned:dir -- --validate-only
pnpm package:mac:unsigned:dir -- --dry-run arm64
pnpm package:mac:unsigned:dir -- build arm64
pnpm package:mac:unsigned:dir -- carriers arm64
```

It produces an unpacked, unsigned, unnotarized application directory. The
script fixes `--publish never`, `mac.identity=null`, `mac.notarize=false`, and
`CSC_IDENTITY_AUTO_DISCOVERY=false`. Actual packaging runs under macOS
`sandbox-exec` with network access denied. Tools may consult existing local
caches; an offline cache miss is an honest build failure, not permission to
publish. It never creates a tag or release.

If `@electron/get` would otherwise fetch its checksum file, a maintainer may
set `LEAFBOOK_ELECTRON_DIST` to an existing canonical Electron archive. The
script accepts it only when it is a regular non-symlink, its filename matches
the selected Electron version/platform/architecture, and its SHA-256 exactly
matches the checksum manifest installed with Electron. Before builder access,
the archive is descriptor-stably copied into a random mode-0700 private
temporary root; the copy's full identity and hash are checked before and after
builder use.

`carriers` first verifies the app-tree audit receipt, creates and independently
receipts a private app snapshot, then creates ZIP/DMG from that snapshot under
the same network-denied sandbox. It revalidates the snapshot afterward and
automatically runs the complete app/ZIP/DMG audit, including `hdiutil verify`
and read-only mount inspection. The public `dist` app, ZIP, and DMG receive a
stable digest/full-identity snapshot before that audit and an identical
snapshot afterward; the app receipt is verified once more before success.
Cleanup requires the original private-root device, inode, uid, mode, random
owner marker, canonical temporary prefix, and a caller-hashed state file
outside the root before removal.

The receipt module's snapshot/build functions are import-safe and expose
optional process-local stable-read-chunk and post-file callbacks solely for
deterministic fault-injection tests. The production CLI accepts exactly its
documented three arguments and does not expose those callbacks through
command-line or environment controls.

After building:

```bash
pnpm audit:mac-unpacked arm64
pnpm smoke:mac:unpacked arm64
```

The audit enforces LeafBook identity, license presence, updater runtime and
metadata absence (including bundle-internal `app-update.yml`, `latest*.yml`,
blockmaps, and pending config). Forbidden names are rejected for every
filesystem type—including symlinks and directories—without following links.
The audit also enforces
650 MiB app / 250 MiB ASAR ceilings. These are conservative Phase 8D budgets,
not optimization targets or measurements of the current package. A candidate
is incomplete until both packaged audit and packaged smoke pass; current
candidate evidence belongs in `RELEASE_GATE.md`, not in this evergreen build
guide. The smoke command first asks Playwright to list an
anchored eleven-test selection and fails unless exactly eleven tests are collected.
Maintainers can verify the identical selection against the source build with
`pnpm smoke:mac:unpacked -- --source`; this does not replace packaged smoke.

For a privacy-safe regression against a local Markdown book without changing
the original:

```sh
node packages/desktop/scripts/run-real-book-svg-harness.mjs \
  --book-path /absolute/path/to/book-or-directory
```

The command emits one aggregate JSON receipt and never emits a source path,
filename, content-derived digest, or exact source-size/count field.

To test an audited packaged app, all three binding arguments are mandatory:

```sh
node packages/desktop/scripts/run-real-book-svg-harness.mjs \
  --book-path /absolute/path/to/book-or-directory \
  --executable /absolute/path/to/LeafBook.app/Contents/MacOS/LeafBook \
  --audit-receipt /absolute/path/to/leafbook-mac-arm64-audit-receipt.json \
  --audit-receipt-sha256 EXPECTED_64_HEX_SHA256
```

The harness recomputes the receipt-bound application tree and requires the
executable to be the exact executable named by that receipt.

Compatibility note: Editor local/relative format links, project-sidebar Trash,
and automatically opening the keyboard-debug dump are disabled until the main
process can issue owner-bound path capabilities. Reader internal chapter links
remain available because their targets come from the validated book session.

DMG/ZIP commands and inherited Windows/Linux commands are development
configuration only. They are not release approval. See
[`RELEASE_GATE.md`](RELEASE_GATE.md).

## Native Windows and Linux evidence definitions

Linux release carriers are architecture-qualified. For each of `x64` and
`arm64`, `build:linux:<arch>` creates AppImage, deb, rpm, and tar.gz; Snap is
not a release target. `.github/workflows/platform-evidence.yml` builds each
architecture once on Ubuntu 24.04, downloads those exact bytes into fresh
native jobs, and exercises AppImage, real tar extraction/run/removal, and deb
install/run/purge. A separate native-runner job starts the reviewed multiarch
Fedora image pinned at
`sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814`,
then performs real `dnf install`, Xvfb launch/smoke, and `dnf remove`. The receipt
records both that digest and the architecture-specific resolved image ID.
Extracting an RPM or using `rpm --nodeps` on Ubuntu is not installation evidence.

`.github/workflows/windows-signed-evidence.yml` is manual and reusable. Only its
protected `windows-signing` build job receives step-scoped secrets directly
from that GitHub Environment, and every builder command remains `--publish
never`. The caller passes no signing secrets: Environment secrets are resolved
inside the job that declares the Environment and cannot be forwarded through a
reusable-workflow caller. Separate fresh Windows jobs download
the exact signed bytes, enforce Authenticode signer/status policy, silently
install with the association prompt's default No response, launch the installed
executable, verify shortcuts, uninstall, and reject executable, shortcut,
association, and protocol residue.

`.github/workflows/macos-signed-evidence.yml` is both manual and reusable for one
explicit architecture. Its protected `macos-signing` job receives exactly five
Apple signing/notarization secrets directly from that GitHub Environment,
without a `workflow_call.secrets` contract or caller mapping, builds with
`--publish never`, and uploads
the signed carrier bytes without installing or launching them. A separate fresh
job receives no signing secret, downloads those exact bytes, verifies Developer
ID signature, stapled notarization and Gatekeeper policy, runs carrier/tree/smoke
audits, installs the DMG into `/Applications`, observes launch, removes it, and
emits `leafbook-macos-native-evidence-v1`. Release assembly consumes only the
two signed candidates whose x64/arm64 receipts revalidate against the same bytes.

`scripts/native-evidence-receipt.mjs` defines the fixed
`leafbook-native-evidence-v2` receipt. Linux first emits separate strict
`portable`, `deb`, and `rpm` lifecycle reports from four separately written
stage observations created only after install, smoke, uninstall, and residue
checks complete. Missing, duplicate, failed, or inconsistent observations are
rejected. Every report binds its
actual hosted runner identity and image, exact carrier hashes, tag, commit, and
architecture; the RPM report additionally binds the reviewed Fedora digest and
resolved image ID. The final receipt accepts exactly those three non-overlapping
reports. Windows binds the corresponding hosted runner, signed carrier hashes,
signature results, and runtime results. A definition or partial report is not a
receipt. No stable release may consume native evidence until the real workflow
has succeeded for the exact candidate and a separately reviewed release job
verifies the retained receipt and attestation.
