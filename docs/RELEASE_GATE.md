# LeafBook release gate

**Overall status: NOT READY FOR PUBLIC RELEASE.**

Phase 10A establishes a fail-closed candidate pipeline on top of the Phase 8D
local safety and packaging gate. Passing either gate does not authorize
publishing.

## Verification matrix

| Scope                       | What is verified here                                                                                                                                                                                                                                                                                                                                                                                            | What is not verified                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Local macOS gate capability | production build; Apple Silicon local candidate DMG; canonical ZIP/DMG carrier topology plus complete app-tree binding; every Mach-O/native-addon architecture; unpacked receipt audit; eleven packaged smoke tests, including private Prepare draft recovery, validated Reader raster/SVG images, offline export assets, real keyboard input, save IPC, and exact disk-byte readback; DMG checksum verification | Developer ID signing, hardened runtime, notarization, Gatekeeper validation on an Internet-downloaded artifact                  |
| Windows/Linux carriers      | Linux x64 and arm64 tar.gz, deb, rpm and AppImage plus Windows ZIP receive a pre-extraction metadata budget check, canonical carrier topology/launcher binding, complete extracted-carrier enumeration, canonical licenses, updater/ASAR checks, and architecture checks; prerelease NSIS setup receives PE/container integrity checks                                                                           | reviewed fresh-runner receipts and trusted release consumption; Windows signing/install/uninstall evidence                      |
| External release systems    | every `v*` tag is version-validated; desktop and Muya type/unit gates plus lint, metadata/licenses, build, and Electron E2E must pass before packaging; GitHub's server tag is recursively peeled and bound to `GITHUB_SHA`; an existing same-tag Release blocks creation; candidates create a draft only                                                                                                        | CI credential rehearsal, protected-environment and tag-protection policy, signing/notarization secrets, provenance, publication |

## Renderer network boundary

Both Editor and Settings use `contextIsolation`, sandboxing, no Node
integration, and `webSecurity:true`. CSP allows only packaged/local resources
(`self`, `file`, bounded data/blob image use) and denies object, frame, child,
base, and form capabilities. Renderer HTTP(S)/WS(S) requests are denied in
production by Electron `webRequest`; development permits only the exact HTTP
loopback Vite host and its corresponding `ws:` endpoint. Requests without a
positive renderer `webContentsId` fail closed. Main-process Node and explicitly
confirmed child-process operations do not traverse the renderer session.
Navigation, new windows, and webviews are denied.

External links accept only `http:`, `https:`, and `mailto:` and require a native
target/origin confirmation every time. Legacy renderer-supplied reveal/openPath
bridges are disabled for this release; re-enabling them requires main-issued
opaque path capabilities. The legacy Editor format-link bridge also rejects
local and relative Markdown targets because its base directory is
renderer-supplied; Reader chapter navigation remains main-owned and available.
The project-sidebar Trash bridge and automatic opening of keyboard-debug dumps
are disabled for the same capability reason. Upload configuration is loaded from persisted
main-process preferences, never an IPC payload. PicGo and a custom uploader use
fixed `execFile` argument arrays with no shell. Every PicGo or custom upload
requires native confirmation showing the canonical image and executable plus
the configured-destination concept. Both are reopened and re-fstatted
immediately before dispatch; a changed image or executable fails closed. A
custom executable must be an absolute regular non-symlink file.

Opening arbitrary Markdown does not load remote images. PlantUML automatic
preview is disabled with an inert offline message. Local Editor images remain
available under `webSecurity:true`. Phase 10B2 connects the live Reader to the
typed, session- and chapter-bound PNG/JPEG/GIF/WebP plus sanitized-SVG
capability, using exact shared-parser Markdown token membership,
descriptor/ancestor pinning, asynchronous validation, trusted decode metadata,
deduplication, chapter-generation budgets, Blob URLs, and deterministic
revocation. SVG additionally uses bounded semantic geometry, typed complete-
subtree fragment graphs, locale-independent canonical bytes, and a strict
per-MIME Renderer DTO validator.
Single-HTML and local-site exports now include only main-validated offline image
resources through the separately bounded export transaction described in
`RESOURCE_PIPELINE.md`; rejected images remain inert placeholders.
The shared local-resource policy also rejects raw, percent-encoded, and
mixed-slash UNC paths plus every non-empty-authority `file:` URL. Static
print/PDF parses images in an inert template before DOM connection, while
legacy single-document HTML replaces such sources with inert placeholders;
neither path emits an SMB-capable `<img src>`.

## Known limitations

- 8B's final pathname-check-to-rename window cannot be eliminated with
  portable Node path APIs; `BOOK_EXPORT.md` records this P3.
- 8C has the analogous final pathname race around directory removal without
  portable `openat`/`unlinkat`; `BOOK_WEBSITE.md` records this P3.
- 10B1 snapshots and rechecks every image ancestor plus the final descriptor,
  but portable Node lacks the `openat`-style relative descriptor walk needed
  to eliminate a hostile same-user pathname-check/open micro-window. This is a
  documented P3; the resource boundary does not claim to resist an attacker
  with write access to the book tree.
- Uploader image/executable identity is rechecked immediately before
  `execFile`, but Node cannot atomically bind that inspected pathname to the
  later child-process open. The remaining inspect-to-exec pathname swap is P3.
- `THIRD-PARTY-LICENSES.txt` is the production dependency license inventory
  generated by license-checker. It preserves the returned package versions but
  is not an SBOM; package-manager resolution, optional/platform-specific paths,
  bundled assets, and transitive completeness require independent review.
- The unpacked-app audit writes a fixed, canonical JSON receipt under
  `dist/audit`. Packaged smoke refuses to run without it and immediately
  re-enumerates the complete app content tree. The receipt binds every
  directory, every symlink and its exact in-bundle target, and every regular
  file's relative path, mode, size, and SHA-256, including frameworks, helpers,
  `app.asar.unpacked`, executable, ASAR, Info.plist, and licenses. It also binds
  the canonical bundle path/device/inode and critical identity fields.
- The receipt is stored in the sibling `dist/audit` directory, never inside the
  app tree it measures. Enumeration is filename-safe through Node directory
  entries rather than line parsing and is capped at 100,000 entries, depth 128,
  4,096 UTF-8 bytes per relative path/symlink target, 650 MiB total regular
  bytes, and a 64 MiB receipt before JSON parsing.
- Every regular file and receipt is read through a no-follow descriptor with
  matching pre/post `fstat` and pathname `lstat` over device, inode, mode, link
  count, size, mtime, and ctime; regular files require one link. Every
  directory has a second identity and sorted entry-set snapshot. Version comes
  from stable `Info.plist` bytes and architecture from the stable Mach-O
  header, independently of caller arguments.
- Receipt construction requires two complete content, identity, and directory
  entry-set snapshots to be JSON-identical, followed by a third terminal
  full-tree scan. The module exposes process-local test callbacks after each
  stable-read chunk and after each file is hashed; neither is reachable through
  CLI arguments or environment variables. One deterministic regression
  performs a same-size write plus `fsync` after pass 1 reads the target's first
  chunk and requires the descriptor identity check to fail. Another mutates an
  early-sorted target after its pass-1 hash, keeps the mutation through the
  remaining scans, and requires the build to fail. Neither uses wall-clock
  timers.
- The content-tree receipt does not bind extended attributes, resource forks,
  ACLs, or Apple code-signature validity. Signing, notarization, Gatekeeper,
  and downloaded-artifact checks remain separate release blockers.
- Receipt equality and executable identity are checked immediately before
  launch and again after process exit, but pathname launch is not an atomic
  open-and-execute transaction; the instantaneous check-to-exec swap remains
  P3.
- Package, unpacked-app, and carrier audits share one private-root helper. Root
  creation records device, inode, uid, mode, and a random token in shell-held
  values plus a caller-hashed state file outside the root. Cleanup rejects a
  replacement inode even when its owner marker copies the old token. Portable
  path APIs cannot make the final identity-check-to-recursive-remove operation
  atomic; a same-uid instantaneous swap/restore in that interval remains P3.
- Carrier success additionally binds the public `dist` app, ZIP, and DMG:
  stable hashes and full identity trees are captured before the complete
  artifact audit, required to be identical afterward, and the public app
  receipt is verified again last. Extracted ZIP/DMG application trees must
  remain content-equivalent to that public audited app.
- Historical evidence only: an earlier ad-hoc-signed Apple Silicon Beta built
  on 2026-07-30 had SHA-256
  `0a08874a837c34b47f236feec5d0fe33856305fb07c3fbb21310fe0d5ba865e2`.
  It predates the current Reader resource integration and ten-test gate and is
  not the current candidate or public-release evidence.
- Before the present review fixes, the mutable local 0.1.0 candidate DMG had
  SHA-256
  `43e7771abebefb2a1339c8bc00e24d1af983b08422e302b8245b870cc2bfb8b1`.
  That value is a historical local checkpoint. A later post-review local
  checkpoint had SHA-256
  `7778b0374a6f5bfb02d6836af85703dc51b179427c71ca5a7a8393f5b6e4d88d`.
  A third-review local checkpoint had SHA-256
  `ffe72c8d9ea498d5fcf8366d1e4e32a2e38fba5527088e67cf092ee5bf6ff4bc`.
  A final-P2 local checkpoint had SHA-256
  `2181a51d1542538aac637fc68ae67e23603b6388c30e6973dfd7de84768a9a3c`.
  The final-P1 local checkpoint had SHA-256
  `61e6e70a925933840945e188652bf643f29bde112b137532d6c97ac1a91cc13e`.
  The pre-third-review Phase 10B2 safe-SVG local checkpoint DMG had SHA-256
  `f2a0a6ffb0c9b989dc92057177f65106c520fe52aa8b7a1e1325bbb755ee4082`;
  its ZIP has SHA-256
  `faeec5a9bf3ed75b9232fc7e4fa18495175598c45c7576bb730e818f7efc7cec`.
  The initial third-review-remediated Phase 10B2 checkpoint DMG had SHA-256
  `527c320f447db9a309820eca4f422183211c08a6bc5efc4573e256731af6a38b`;
  its ZIP has SHA-256
  `800dfd068ed5f64bd3486c3040093013a666d23fa5f7f2c7a3209b39942880ac`.
  The reflected-control checkpoint additionally bounds reflected `S`/`T` path
  control points. Its DMG has SHA-256
  `ae0d37038ff14bb83eeef81e1349db15acfbc8a40787e72480dd26232e511249`;
  its ZIP has SHA-256
  `b182f9f35e694eb9cfebd0cad6485d04217591d33af87fb297eee5a20f9d894b`.
  The previous tree-CTM/privacy-contract candidate DMG had SHA-256
  `d000f06d212f1cf1f6faed735e8719a38823f68ae4061f38cb636183180d2a6e`;
  its ZIP has SHA-256
  `f0f6dcce31c68947054b7574e3a6b048b0665744d6bd9e3b16c668014e99b788`;
  its app-tree audit receipt has SHA-256
  `9195b68dac826ba8b2f5fc4a9594592a00d571a07aabb18f7e4e91a4ca0168dd`.
  The previous stable-read/private-snapshot candidate DMG had SHA-256
  `a4a8bbe41926b11b07ee1ee6d200aa4108391f989c07e36a9a64debb05cf28d1`;
  its ZIP has SHA-256
  `3a69be81e3866524e58a004ca8b09aee0ec4336cc1afb08a17fdf4cfa5e0a2d4`;
  its app-tree audit receipt has SHA-256
  `109042a9689b664c572c4e9b2a4173be6d6cf829836a096513c44e3cc2b331d1`.
  The previous triple-tree/public-dist-bound candidate DMG had SHA-256
  `267d14d54d3c5ef9cbcad238ac598a0c6a7418d421cf22f50833bb610f8c0c6c`;
  its ZIP has SHA-256
  `0865cdcfa0ad936e1f0cdae1f158a2f0698b204c9076101bc8f91cfe171c0e4a`;
  its app-tree audit receipt has SHA-256
  `42eb75a2bf70d8e37fa91ab4eb07bd9ac9c401b0d73b2dc1afcc0789d3ed8542`.
  The previous Phase 10B3 offline-export candidate DMG is 159,542,114 bytes
  with SHA-256
  `c584a90bc7b654ac5b937866ce90d2573a47408d848ec6411b982dd2586a2aad`;
  its ZIP is 158,716,365 bytes with SHA-256
  `328226d481bf4942f8e71404ecba4b97fd2b139500e5cbffc4cdc41924f57742`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `ec2b95f09eaaa1a8b16d77429c887b89dded43c9b471390df3ee2fb2cb53f9b3`.
  The unpacked app is 416,759,808 bytes and its ASAR is 175,374,867 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, packaged smoke 10/10, and the receipt-bound packaged
  schema-2 real-book export harness. It remains unsigned and unnotarized and
  must never be used as a formal release artifact.
- The previous third-review-remediated Phase 10B3 candidate DMG is 159,516,647
  bytes with SHA-256
  `55f6db52b432c8050e058fd697f56f6bf991c2ccffe7828174574d41a2d0dc57`;
  its ZIP is 158,718,874 bytes with SHA-256
  `6caf12afcd89b803b08791db7f208cefe2d32f2932d710227c60ad9054210586`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `e2869ace7656a48db2de0e0cb9cbfa3f934812cdea71784df1bfcb840c8501e8`.
  The unpacked app is 417,611,776 bytes and its ASAR is 175,388,332 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, packaged smoke 10/10, and the receipt-bound packaged
  schema-2 real-book export harness. It remains unsigned and unnotarized and
  must never be used as a formal release artifact.
- The previous final-third-review Phase 10B3 candidate DMG is 159,524,027 bytes
  with SHA-256
  `fd5755d326706936f27de4f413112ead4e03c2987f26c1fe40544b3375963e7c`;
  its ZIP is 158,722,387 bytes with SHA-256
  `25e84eb7dbdd7dd72ac195edea64b99783fd0214bdb06f0c42afef94eaa2b086`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `0688ff8da2cefbf24da0a93cc5f3930ae79c9672ea9dcb3bf06575c5f1e26a12`.
  The unpacked app is 418,086,912 bytes and its ASAR is 175,409,638 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, packaged smoke 10/10, and the receipt-bound packaged
  schema-2 real-book export harness. It remains unsigned and unnotarized and
  must never be used as a formal release artifact.
- The previous staging-journal-final Phase 10B3 candidate DMG is 159,524,354
  bytes with SHA-256
  `f21caea117a0ae6f5e12214f0174c5f97ed9d3e46f9aeb498a517b7a6083c99f`;
  its ZIP is 158,721,122 bytes with SHA-256
  `667989e14eb892ec92ee866b3490358914fc79768da413a6c926914e543cc13c`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `2c76e008dc7307c8f1947f5c5d03762d7d56302b48e6b3bebd44447dfe2c9d5d`.
  The unpacked app is 416,985,088 bytes and its ASAR is 175,410,566 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, packaged smoke 10/10, and the receipt-bound packaged
  schema-2 real-book export harness. It remains unsigned and unnotarized and
  must never be used as a formal release artifact.
- The previous negative-source-state-final Phase 10B3 candidate DMG is
  159,526,128 bytes with SHA-256
  `9edf73bad24bab7243a05b8887a0181409cb5c2fb6208110f12892f0a2be654d`;
  its ZIP is 158,723,947 bytes with SHA-256
  `de24a3a644e420269215bed91d3eacb663b044f689038b19dfc0eebb94a74923`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `56a19194fee52a3791f4de81135a359247b797039beed451e84b0358de138cc8`.
  The unpacked app is 416,403,456 bytes and its ASAR is 175,429,518 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, packaged smoke 10/10, and the receipt-bound packaged
  schema-2 real-book export harness. It remains unsigned and unnotarized and
  must never be used as a formal release artifact.
- The previous physical-source-budget-and-rollback-final Phase 10B3 candidate
  DMG is 159,522,764 bytes with SHA-256
  `ed6bfc37b2fa8514d6c566b9bab307810d20e86c51fb4e53c796d71898f8ce56`;
  its ZIP is 158,725,144 bytes with SHA-256
  `6bc89caed789810cbf4513a4aa04dcd27bde3349aacf7a58ac801c15c3dffbb3`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `c49e9e8e9ad42f5d474cbd468a35485b21f82195b994a1d5aecf312c536cb592`.
  The unpacked app is 416,960,512 bytes and its ASAR is 175,438,674 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, source and packaged smoke 10/10, and the
  receipt-bound packaged schema-2 real-book export harness. It remains unsigned
  and unnotarized and must never be used as a formal release artifact.
- The previous preparation-draft-recovery-final Phase 10B3 candidate DMG is
  159,541,029 bytes with SHA-256
  `29d71bd6a8f531fb44593d6d76b351ea4fa704188a04c3c866fb609230bf7227`;
  its ZIP is 158,738,577 bytes with SHA-256
  `202e6af585c725710387cd11da90db829bc5126d346d5c66cbb5065c3a3eeebc`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `7142eab68de12ff6fb988242973a5a709652459f1a485e332f3768b896c565ab`.
  The unpacked app is 417,521,664 bytes and its ASAR is 175,502,522 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, source and packaged smoke 11/11, and the
  receipt-bound packaged schema-2 real-book harness with private Prepare draft
  isolation. It remains unsigned and unnotarized and must never be used as a
  formal release artifact.
- The previous preparation-concurrency-final Phase 10B3 candidate DMG is
  159,545,630 bytes with SHA-256
  `e0ab227ee8d61f8ede30f89f0cab26d833762e37615feba453e97626d54d8e76`;
  its ZIP is 158,740,540 bytes with SHA-256
  `516c79ab5b4518d3cb05c05735e05c0a9c91adf13fd29c2d24fdb049ba0b3c0b`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `facf3be0844838f90f0b9b3d3e0f81cc6bf8ac84121f60d0ca8454a62f714925`.
  The unpacked app is 417,046,528 bytes and its ASAR is 175,516,939 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, source and packaged smoke 11/11, and the
  receipt-bound packaged schema-2 real-book harness with private Prepare draft
  isolation. It remains unsigned and unnotarized and must never be used as a
  formal release artifact.
- The previous preparation-flush-failure-final Phase 10B3 candidate DMG is
  159,542,555 bytes with SHA-256
  `45a19a624f914f7d7135bc19a19833fd3f56e350083ab7127723d13f7e4e088c`;
  its ZIP is 158,739,320 bytes with SHA-256
  `f42dd17a240cfce1887b9ce183bbd31d0495b0f59ad2726a537fd4d3f973b7f6`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `d3ee774d717f437b31d14476d54861b2a7d88121e98e6a5065ba9ec4009ec19b`.
  The unpacked app is 416,792,576 bytes and its ASAR is 175,522,905 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, source and packaged smoke 11/11, and the
  receipt-bound packaged schema-2 real-book harness with private Prepare draft
  isolation. It remains unsigned and unnotarized and must never be used as a
  formal release artifact.
- The current preparation-navigation-gate-final Phase 10B3 candidate DMG is
  159,540,413 bytes with SHA-256
  `ab515a89b3dfee5ad131eeb53831f9c5ddc05ca34fb3011c646ff30aa3a6be85`;
  its ZIP is 158,741,044 bytes with SHA-256
  `ca2b6312a5028f6d89d71ff5d7cc9de381869b5eff395790d93306f66feb2c1f`;
  its 38,329-byte app-tree audit receipt has SHA-256
  `e963b51fe7102c7784e2f1c609c9b6a6b4157185aadac5c981253d71702cb4fb`.
  The unpacked app is 417,525,760 bytes and its ASAR is 175,523,472 bytes.
  The app, receipt, ZIP, and DMG passed the independent unpacked and carrier
  audits, `hdiutil verify`, source and packaged smoke 11/11, and the
  receipt-bound packaged schema-2 real-book harness with private Prepare draft
  isolation. It remains unsigned and unnotarized and must never be used as a
  formal release artifact.
- The current candidate workflow is fail-closed at the repository layer:
  quality and Electron E2E jobs must pass before platform packaging. The
  quality job runs both desktop and Muya type/unit suites. macOS packaging must
  then pass the app/ZIP/DMG audit, unpacked receipt audit, and the exact eleven
  packaged smoke tests before upload. Release creation explicitly depends on
  both gates and every platform build, and the resulting GitHub Release remains
  a draft.
- The read-only assembly job checks the server-side tag before release
  assembly. The separate minimum-permission write job never checks out the tag,
  invokes a repository script, or uses a local action. Its fixed inline
  read-only API preflight runs immediately before the sole write command.
  Lightweight tags resolve directly; annotated tags are recursively peeled
  through GitHub's Git Data API. The final commit must exactly equal
  `GITHUB_SHA`. Both checks also enumerate all Releases visible to the token
  and reject an existing same-tag Release. Missing fields, unsupported object
  types, cycles, excessive annotation depth, API errors, and invalid JSON all
  fail closed.
- No remote API offers an atomic “verify this tag target and create a Release
  only if it is unchanged” operation. A small check-to-create window therefore
  remains even with the immediately adjacent recheck. GitHub tag protection
  or a repository ruleset that prevents tag movement/deletion by the workflow
  credential is mandatory before a stable tag; this is a stable blocker, not a
  locally accepted race.
- Linux release CI builds architecture-qualified AppImage, deb, rpm and tar.gz
  carriers for x64 and arm64; Snap is not a release target. Windows CI fully audits
  the ZIP; prerelease NSIS setup files must pass PE and 7-Zip container
  integrity checks but are explicitly labelled incomplete evidence. Stable
  Windows packaging fails closed until an isolated native Windows
  install/run/uninstall plus installed-bundle audit is implemented.
- Archive metadata is inspected before extraction. Tar, ZIP, and Debian use a
  standard-library parser; RPM and SquashFS use bounded fixed-command metadata
  listings. ZIP extraction is performed by the repository's streaming
  extractor, which counts deflate output before writing it and requires the
  actual byte count and CRC to match the directory metadata; the central
  directory is therefore never the resource-limit authority. The gate rejects
  more than 100,000 entries, depth over 128, a
  path/target over 4,096 UTF-8 bytes, one uncompressed entry over 512 MiB,
  total regular bytes over 2 GiB, a compressed carrier over 1 GiB, traversal,
  duplicate paths, hard links, escaping links, unsupported types, and malformed
  listings. External commands have a 64 MiB combined stdout/stderr budget and
  a wall-clock timeout. Output and wall-clock state are checked after the direct
  process exits as well as while it runs; reader shutdown shares the same
  deadline, and a descendant retaining an inherited output pipe causes the
  process group to be killed at that deadline. POSIX runs also receive CPU,
  output-file and open-file limits; dedicated Linux CI additionally applies
  address-space and process limits. The general Windows runner does not yet
  provide a proved Job Object process-tree/resource boundary, so native Windows
  stable evidence remains fail-closed rather than being described as
  equivalently bounded.
- Phase 10B1's platform-independent suite rejects Windows drive, backslash and
  UNC-shaped references on every runner. A native Windows-only case-alias test
  runs without requiring symlink privilege; POSIX symlink-race cases are
  conditionally skipped there. Before stable release, native Windows CI must
  run the resource suite on NTFS and add privileged reparse-point/symlink
  coverage on a dedicated runner. This evidence is not substituted by the
  current macOS run.
- Debian `control.tar` is audited before `dpkg-deb --extract`: only regular,
  bounded `control` and optional `md5sums` metadata are accepted. The control
  body must be one valid RFC822 paragraph with the exact approved identity,
  description, installation-size budget and the pinned electron-builder
  dependency/recommendation set. Unknown relationship fields and
  `Pre-Depends`, `Conflicts`, `Replaces`, `Essential`, or `Protected` fail
  closed. Maintainer scripts and hooks such as `preinst`, `postinst`, `prerm`,
  `postrm`, `config`, `templates`, and `triggers` also fail closed. RPM packages
  must produce empty `--scripts`, `--triggers`, `--filetriggers`, and
  `--transfiletriggers` reports plus empty script/trigger header tags before
  `rpm2cpio` runs; an unavailable query surface is a failure.
- Each released extracted format has one topology. ZIP/tar are portable app roots;
  deb/rpm bind `usr/bin/leafbook` to `opt/LeafBook/leafbook`; AppImage binds
  `AppRun`. Unexpected roots, sibling payloads,
  executable scripts, foreign formats, mixed architectures, and app symlinks
  escaping the app root or targeting an unmanifested entry are rejected. The
  cross-carrier application digest covers only the identical Electron payload;
  exact allowlisted AppImage/deb/rpm launcher and integration metadata is
  retained in a separate complete carrier manifest and audited independently.
  Every Linux desktop file is regenerated through the installed
  electron-builder 26.15.3 `LinuxTargetHelper.computeDesktopEntry` and compared
  byte-for-byte: AppImage must include its version key and `AppRun
--no-sandbox %U`, deb/rpm must use `/opt/LeafBook/leafbook %U`, and all keywords,
  MIME types and other keys must match. The
  generator consumes one shared seven-entry association contract (`md`,
  `markdown`, `mmd`, `mdown`, `mdtxt`, `mdtext`, `mdx`); a static YAML-AST
  assertion requires `electron-builder.yml` to remain identical to that
  contract.
  AppImage validation also matches the generated `AppRun` template
  byte-for-byte; its `hsqs` offset is found by a fixed-memory streaming scanner
  that requires exactly one marker. Historical Snap audit helpers remain test
  fixtures only and do not authorize a Snap target or release asset. ASAR
  extraction is preceded by a direct eight-byte pickle
  prefix check that rejects a header over 64 MiB or outside the carrier before
  calling the ASAR library, followed by raw-header
  count/depth/path/single/total-byte and offset-boundary audits.
- A macOS DMG must contain a real `LeafBook.app` directory and the exact
  `Applications -> /Applications` symlink. Finder presentation metadata is
  type constrained: `.background` is a real directory containing only an
  allowlisted regular background image, while `.DS_Store`,
  `.VolumeIcon.icns`, and root `.background.tiff` (when present) are regular
  files. Presentation files also have 16 MiB single/32 MiB aggregate budgets
  and format magic checks. DMG verification, attach, state inspection and
  detach are wall-clock bounded. Cleanup is armed before attach starts, resolves
  the actual mount point to its `/dev/` image device, and performs a bounded
  detach even when attach times out after creating the mount. ZIP and DMG
  compressed carriers are capped at 1 GiB. Other root entries, escaping
  symlinks, and nested presentation payloads are rejected.
- The release round-trip fixture is deliberately named
  `representative-blocks`: it covers the high-risk structural and inline
  families asserted by the test and does not claim exhaustive coverage of
  every Muya extension. Its release-smoke mutation uses real keyboard input,
  observes dirty state, saves through production IPC, and reads exact serialized
  bytes back from disk.
- The exact source and packaged smoke selection contains eleven tests. Its
  Reader-resource case opens real PNG, JPEG, GIF, and WebP files through the
  session capability, forces browser decode of every Blob URL, keeps a missing
  file plus remote/raw-HTML images inert, verifies zero HTTP requests and
  renderer errors, and rejects DOM exposure of references or resource tokens.
  Its separate SVG case decodes a main-sanitized local SVG through a Blob URL
  while a network-bearing/script SVG and remote/data/file/raw-HTML inputs stay
  placeholders with zero network activity and no inline SVG DOM.
  Its offline-export resource case verifies cross-chapter content
  deduplication, embedded single-HTML data URLs, one hashed website asset,
  exact manifest hashes, successful browser decode, no source-path leakage,
  and zero HTTP(S) requests.
- `is_prerelease` is emitted once by strict SemVer validation and consumed by
  every build, audit, release-note, and draft-creation decision. A hyphen in
  stable build metadata does not select the prerelease path. Every candidate may
  reach a draft only after the signed Windows, signed/notarized macOS, native
  Linux, exact-byte receipt, supply-chain, and quality gates pass.

Phase 10D adds evidence definitions without claiming execution. The
manual/reusable Windows workflow confines `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` to the protected `windows-signing` build step and never
publishes. Those values must be Environment-level secrets on
`windows-signing`, not repository-level secrets. The release caller passes no
signing-secret mapping and the reusable workflow declares no
`workflow_call.secrets` contract: Environment secrets are resolved only by the
job that names that Environment and cannot be forwarded by its caller. Fresh Windows jobs download
the exact build bytes and must verify Authenticode, silent default-No file and
protocol association behavior, installed launch, shortcuts, uninstall and
residue before producing a fixed receipt. The reusable/manual Linux workflow
builds four architecture-qualified carriers once on Ubuntu 24.04 x64 and arm64,
then uses fresh runners for exact-byte AppImage, tar and deb lifecycles. Its RPM
job runs real `dnf install`, Xvfb smoke and `dnf remove` in the reviewed Fedora
multiarch image digest and records the resolved architecture image ID; there is
no `rpm --nodeps` success path. `leafbook-native-evidence-v2` accepts exactly
three Linux lifecycle reports (`portable`, `deb`, and `rpm`), each aggregated
from four per-stage observations written after the corresponding command/check
succeeds and bound to its actual hosted runner/image,
architecture, tag, commit, exact carrier hashes, and
install/smoke/uninstall/residue results. The RPM report also binds the reviewed
Fedora digest and resolved image ID. Windows binds its actual hosted ImageOS,
ImageVersion, runner label/OS/architecture, separate stage observations, and
signature policy. The reusable/manual macOS workflow accepts one exact
architecture. Its protected job only builds, signs, notarizes, and uploads with
five explicit Apple secrets sourced directly from the `macos-signing` GitHub
Environment; repository-level copies and caller mappings are forbidden. It
never installs or launches the candidate. A
fresh no-secret job verifies the same bytes with `codesign`, `stapler`, `spctl`,
carrier/tree audits, packaged smoke, `/Applications` install/launch, cleanup,
and a fixed macOS receipt. The tag workflow calls all native workflows,
downloads their candidate bytes and receipts, rebinds every receipt
to its own tag/commit/platform/architecture, recomputes the carrier hashes, and
copies only those verified bytes into the exact 16-carrier set. Stable remains
blocked until the protected workflows actually succeed and their attestations
and retained run evidence receive review.

## Release blockers

Every item below blocks a public release:

- Phase 10C adds local deterministic SPDX/checksum/release-note gates and
  manual/callable workflow definitions only. None of those definitions has been
  run as part of this local checkpoint, so they provide no native, signing,
  notarization, Gatekeeper, or hosted-attestation evidence. The formal checklist
  is [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), with install/data handling in
  [INSTALLATION.md](INSTALLATION.md) and the privacy/security boundary in
  [PRIVACY_SECURITY.md](PRIVACY_SECURITY.md). SBOM generation fails closed unless
  `SOURCE_DATE_EPOCH` is a canonical positive in-range integer; release workflows
  inject the exact checked-out commit timestamp. Its namespace binds canonical
  JSON for the complete emitted SPDX payload except the namespace itself, so
  actual inventory/output changes are covered without source-only churn or
  self-reference. The write-permission job derives and verifies the exact 16
  carrier names from the tag, plus `SHA256SUMS.txt`; formal notes are the draft
  body, while notes and SBOM remain non-asset evidence. The SBOM attestation has
  a separate manifest whose subjects are only those 16 carriers. The write job
  descriptor-copies carriers, manifest, metadata, and body into an exclusive
  final snapshot, records complete file hashes and directory identities, makes
  it read-only, and emits a stable state digest through the trusted step-output
  channel. The upload shell first compares that digest in constant time, then
  independently parses/recomputes the 16-carrier manifest, two-file metadata
  manifest, and channel-specific formal notes body before cross-checking state
  identities and revalidating the entire snapshot. In that same shell, fixed
  inline API logic then peels the server tag to the expected commit and confirms
  release absence immediately before the sole `gh release create`. It never
  executes candidate code. Replacing a self-consistent snapshot and state
  therefore cannot replace the earlier trusted digest.
  Carrier limits are format-specific:
  512 MiB for installers/packages, 640 MiB for ZIP/tar archives, and 768 MiB for
  DMGs; release SBOM evidence is capped at 16 MiB, and inputs/targets with
  allocated blocks significantly below logical size are rejected as sparse.
  The remaining server-check-to-create micro-window requires protected tags;
  independently, the final file-check-to-`gh` pathname-open interval is a
  same-user P3 because the CLI offers no descriptor-based atomic upload
  interface;

The sole `contents: write` job declares `environment: release`, so GitHub must
approve that deployment before the draft-creation shell can run. Repository
administrators must configure `Jacquesxu666` as a required reviewer on all three
protected Environments: `windows-signing`, `macos-signing`, and `release`. The
current personal-project release mode deliberately permits owner approval by
setting **Prevent self-review** to disabled (`prevent_self_review=false`) on the
`release` Environment. Its deployment branch/tag policy must still be restricted
to the reviewed release-tag path (selected tags matching `v*`, with branch
deployment denied). Environment existence alone is not a protection boundary:
a missing required reviewer or missing tag-only policy blocks formal release.

If the project becomes multi-person, enable **Prevent self-review** and require
at least one independent reviewer before the next formal release. That stronger
separation-of-duties recommendation does not describe the current personal-mode
configuration.

- reviewed real Windows, Linux, and macOS build-and-run receipts for the exact candidate;
- signed macOS build, hardened-runtime review, notarization and Gatekeeper
  validation in the separate fresh no-secret job on the exact uploaded artifact;
- a signed, notarized macOS release-candidate package plus unpacked audit,
  packaged smoke, and Gatekeeper testing after an Internet download;
- Windows signing and installer validation from the protected build job followed
  by a separate fresh-runner Authenticode/install/launch/uninstall/residue job;
- successful pinned-Fedora RPM install/run/uninstall evidence with the resolved
  image ID. Ubuntu extraction or `rpm --nodeps` is not accepted as a substitute;
- successful trusted release consumption of fixed tag/commit/runner/
  architecture/hash/signature/lifecycle receipts and corresponding reviewed
  attestations (definitions and uploaded partial reports alone do not satisfy this gate);
- a complete SBOM plus transitive license/provenance review;
- reproducible release artifact provenance and trusted CI attestations;
- a dry-run review of the candidate workflow, action permissions, repository
  settings, and credentials before any release tag is pushed;
- a protected tag ruleset that prevents the release credential from moving or
  deleting stable tags, closing the unavoidable tag-check/create micro-window;
- protected-environment configuration or an equivalent separately reviewed
  manual publication procedure. RC and stable tags can create only a draft;
  this workflow cannot make a release public;
- an explicit human approval after all platform evidence is attached.

No Phase 10A verification command may change versions, create tags, sign,
notarize, publish, or edit a release. The candidate workflow's sole authorized
write is creation of a new draft after every gate succeeds.
