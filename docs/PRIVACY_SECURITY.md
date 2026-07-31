# Privacy, security, and known limitations

## Privacy model

LeafBook is local-first. Book discovery, reading, editing, Prepare recovery,
search, and export operate on local files. The production renderer denies
ambient HTTP(S), WebSocket, and FTP requests. Reader images are loaded through
bounded main-process capabilities, and remote, raw-HTML, `file:`, and unsafe SVG
sources remain inert. Website and single-file exports are generated for offline
use.

LeafBook does not claim that the operating system, Electron runtime, package
manager, crash facilities, DNS, or a user-confirmed external browser is offline.
Development tools and dependency installation use the network. A user can also
explicitly confirm opening an external link in the system browser.

## Local data and access

Opening a book grants LeafBook access to that selected folder. Editing writes
manuscript files in place. Prepare can create private recovery drafts in the
LeafBook user-data directory; they may contain manuscript text and should be
included in backup and device-encryption decisions. Export writes only to a
destination selected by the user. See [INSTALLATION.md](INSTALLATION.md) for
exact default data locations and erasure guidance.

Do not open an untrusted manuscript as if it were executable content. The
renderer and resource pipeline apply containment, size, MIME, SVG, and network
controls, but parser and Electron vulnerabilities remain possible. Keep a
separate backup and review exported HTML before hosting it publicly.

## Distribution security

Current local macOS candidates are unsigned and unnotarized. There is no current
Windows Authenticode evidence, native NSIS install/uninstall evidence, or
reviewed Linux installation evidence. Workflow files are executable definitions,
not proof that a workflow ran. Evidence requires immutable run identity, retained
logs, exact artifacts, checksum verification, and human review.

The release supply-chain definition generates a deterministic SPDX 2.3 SBOM
from the frozen production dependency closure, fails on unreviewed or disallowed
transitive licenses, creates an exact SHA-256 manifest, and defines GitHub build
and SBOM attestations. SBOM creation requires a strict positive
`SOURCE_DATE_EPOCH`; CI derives it from the exact checked-out commit, and the
SPDX `created` field records that UTC instant. The document namespace hashes the
canonical complete SPDX payload except `documentNamespace` itself, so the real
inventory, licenses, platform-dependent packages, relationships, creation data,
and every other emitted field are bound without self-reference. Source changes
that do not alter output do not manufacture a new namespace.

The formal release asset set is exactly 16 tag/version-derived platform carriers
plus `SHA256SUMS.txt`. The verified `docs/RELEASE_NOTES.md` supplies the GitHub
draft body, while the SBOM and its dedicated 16-carrier subject manifest remain
separate retained evidence and never become checksum subjects of themselves or
public carrier assets. Before the repository-write boundary, candidate files are
copied through no-follow descriptors into an exclusively created final snapshot,
rehash-bound with file and directory identities, and made read-only. The same
trusted build step binds its state to the tag, commit, schema, and a random
nonce, then exports a stable state digest through the GitHub step-output channel.
The same shell that invokes `gh` first compares the state bytes with that digest
in constant time, independently reparses and verifies both checksum manifests,
reconstructs the formal notes body, and cross-checks every file and directory
against the state. Fixed inline API logic then peels the remote tag to the
expected commit and confirms release absence immediately before uploading only
snapshot paths. It does not execute candidate code. Significant sparse files are
rejected using allocated-block checks in addition to logical-size bounds.
Protected tags are required for the remaining server-check/create micro-window.
A separate same-user mutation in the unavoidable interval between the final file
check and `gh` opening each pathname remains a documented P3; the snapshot and
read-only modes reduce but cannot make pathname upload atomic.
The tag workflow calls the reusable attestation workflow only after native
receipts have been verified and their exact bytes assembled. An SBOM records
components and declared licenses; it is not a
vulnerability scan, legal opinion, proof of reproducibility, or guarantee that
an artifact is safe.

## Known limitations

- No formal public release, trusted updater, or automatic rollback channel.
- No completed signed/notarized/downloaded Gatekeeper evidence for macOS.
- No completed Windows signing or isolated NSIS install/run/uninstall audit.
- No reviewed native Linux install/run/uninstall and desktop-integration matrix;
  the pinned Fedora RPM lifecycle definition is not evidence until a retained
  successful run and image-ID-bound receipt are reviewed.
- No reproducible-build claim across operating systems.
- Local filesystem race resistance is bounded by Node and OS APIs; documented
  residual P3 same-account races remain where descriptor-relative primitives
  are unavailable.
- Exported websites inherit the confidentiality of their source manuscript;
  publishing an export is an explicit disclosure by the user.

Security-sensitive reports should avoid public manuscript samples, personal
paths, credentials, or recovery-draft contents. Share the smallest synthetic
reproduction possible.
