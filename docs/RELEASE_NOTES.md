# LeafBook 1.0.0

## Highlights

- Local-first Markdown book workspace with folder discovery and `SUMMARY.md`
  navigation.
- Bounded Reader image handling and offline single-file/website export.
- Private, identity-bound Prepare recovery drafts and fail-closed navigation.

## Security and privacy

- Renderer network policy: denied by default
- Recovery draft sensitivity: may contain manuscript text

Production renderer network access is denied by default. Local raster and safe
SVG resources use bounded main-process capabilities; remote and unsafe inputs
stay inert. Prepare recovery drafts may contain manuscript text and live in the
LeafBook user-data directory.

## Dependency and license evidence

- SBOM format: SPDX-2.3
- Checksum manifest: SHA256SUMS.txt

The release process defines a deterministic SPDX 2.3 SBOM for the transitive
production dependency closure, a fail-closed license policy, and an exact
`SHA256SUMS.txt` manifest. These files and GitHub attestations are valid evidence
only when produced by a retained reviewed workflow run for the exact candidate.

## Known limitations

- macOS signing: required before draft
- macOS notarization: required before draft
- Windows native evidence: required before draft
- Linux native evidence: required before draft
- Hosted evidence review: required before publication
- Public release approval: blocked

Any GitHub draft for this version requires receipt-bound macOS 4 + Windows 4 +
Linux 8 carriers for the exact tag and commit. The macOS carriers must be signed
and notarized, then pass fresh no-secret signature, stapling, Gatekeeper, audit,
packaged-smoke, `/Applications` install/launch, and cleanup validation. Windows
must pass Authenticode and fresh install/launch/uninstall checks. Linux must pass
fresh AppImage, tar, deb, and pinned-Fedora RPM lifecycle checks. Only the exact
16 carriers bound to those receipts may proceed to provenance/SBOM attestation
and draft creation. Snap is not a release target.

Workflow definitions and local test results are not retained hosted evidence.
The draft-producing hosted run, protected-environment approvals, native receipts,
attestations, and logs still require human review before publication. No current
binary is approved as a formal public release merely because these definitions
or a draft exist.

## Verification

Verify all candidate files against `SHA256SUMS.txt`, then review the SPDX SBOM,
workflow run, platform audit logs, and any signing/notarization evidence. A
same-run macOS Gatekeeper result does not replace testing a notarized artifact
after an independent Internet download.
