# LeafBook Local Website Generation

LeafBook generates a fixed, fully offline website from the current book. It deliberately reuses
the Phase 8B `generateBookExportHtml` renderer and `exportPolicy`; the website form does not have a
second Markdown renderer or a weaker HTML policy.

## Output contract

The selected directory contains exactly the declared ownership set:

- `index.html` — script-free HTML with website CSP;
- `assets/` — present only when accepted local Markdown images exist, containing one
  `assets/<sha256>.<ext>` file per unique sanitized payload; and
- `leafbook-manifest.json` — canonical schema version 2 ownership metadata.

The manifest is generated and validated in the main process. It contains `schemaVersion`,
`generator: "LeafBook"`, and the exact sorted `files` entries for `index.html` plus every asset,
including relative path, byte size, and SHA-256. Every asset basename hash must equal its record
SHA-256. It has no self hash, absolute/source paths, timestamps, or optional fields. LeafBook
rejects duplicate keys, unknown fields, noncanonical JSON, traversal paths, and hash/size
mismatches.

The HTML has inline fixed CSS, strict CSP, no scripts, no network or `file:` resources, and no
source paths. Accepted local images use only manifest-owned hashed assets; unsupported images are
placeholders. Renderer snapshots carry one opaque target per unique `image-N` slot, while main
separately validates the exact occurrence-expanded sequence of images and supported-resource
placeholders. Each supported placeholder is also bound to an exact negative filesystem snapshot;
creating a missing path, changing corrupt bytes, making an invalid image valid, or replacing a
symlink with a regular file invalidates the generation. Unverifiable I/O fails preparation rather
than issuing a placeholder. Reading order, aliases, groups, missing chapters,
scoped fragments, and unique physical chapter bodies follow the Phase 8B navigation semantics.
Security does not rely on Chromium supporting the CSP `navigate-to` directive: the shared strict
HTML validator permits only generated in-document `#leafbook-…` links, and the Electron E2E
allows only Chromium's exact unsupported-directive warning while failing on any other warning or
error.

## Destination policy

The Save dialog proposes `LeafBook-site` and the destination must be
outside the source book. A target may be:

- absent;
- empty, after an explicit Replace confirmation; or
- an exact, valid LeafBook-owned website, after an explicit Replace confirmation.

Anything else is refused: extra entries, malformed/tampered/noncanonical manifests, changed
hashes, symlinks, multiply-linked regular files, FIFOs, other special files, or a changed
destination identity.

## Transaction and durability

LeafBook builds the complete known file set in a high-entropy sibling staging directory. Files are opened
with exclusive creation and, where supported by Node/the platform, `NOFOLLOW` and `NONBLOCK`.
Content, file identities, hashes, the staging directory, source revisions, source root,
destination parent, and target are checked again before commit. The manifest is written last.
The stage root is journaled as soon as it is created; the assets-directory identity and each file
identity are added immediately after exclusive creation, before content awaits. Cancellation, TTL
expiry, and ordinary exceptions can therefore remove an exact partially written stage even when
the manifest was never reached. Unknown or identity-changed entries remain untouched.

The lease records the staging/destination/assets directory identities plus every index, asset, and
manifest device/inode identity and SHA-256. Directory enumeration uses bounded `opendir` iteration;
the manifest declares at most 32 MiB of assets and 8 MiB per asset before any asset allocation.
Immediately before every rename, unlink, or
`rmdir`, LeafBook synchronously revalidates the owning session generation, parent, source root,
all final source hashes, target, staging directory, backup directory, and applicable recorded
leaves. Positive raw files and readable negative regular files share one 32 MiB physical-source
budget and a device/inode plus exact-metadata proof cache; hard-link aliases are read and hashed
once per validation pass, while directory and symlink states require no content read. Only budget
exhaustion is reported as too large; unreadable or unstable proof capture is reported as a source
change. The lease's current
time, token, owner, session, and generation are checked immediately after the final source-state
validation and before each rename, without an asynchronous yield. After staging is renamed, the target must retain the original staging directory and leaf
identities. Rollback only renames a backup whose directory and leaves still exactly match the
original target, and only while the target remains absent.

For an absent target, staging is renamed to the target. For an empty or owned target, the old
target is first renamed to a high-entropy sibling backup, the staging directory is renamed into
place, and ordinary failures synchronously attempt to restore the old target. After that first
rename, rollback authorization intentionally excludes source/resource freshness and instead
requires the same operation, owner, session, destination parent, absent target, and exact
stage/backup identities. A source mutation therefore aborts the replacement with
`website-source-changed` and `committed: false`, restores the old website, and leaves no known
stage or backup. Backup cleanup
only occurs after the new target validates and its parent sync succeeds. Cleanup removes only
the identity-validated index/assets leaves plus the manifest and then `rmdir`; an empty backup is
only removed with `rmdir`. LeafBook never uses recursive deletion and does not scan or recover
unknown backup directories in this phase.

Cleanup revalidates the backup and committed target between individual leaf removals. Assets are
removed only by their exact manifest-bound identities before the empty assets directory is removed.
If an exact
but different directory is swapped into the backup, cleanup stops, leaves the replacement
untouched, and reports uncertain durability. The same fail-closed rule preserves staging or
backup directories whenever their recorded boundary no longer holds.

For each leaf, the expensive session/source/committed-target checks run first. A fresh
`lstat`/`NOFOLLOW` open/`fstat`/hash inspection of the expected backup leaf then runs as the last
substantive check, followed only by the adjacent pinned-parent and backup-directory identity check
before `unlink`. The manifest follows the same ordering; final directory identity and `readdir`
are adjacent to `rmdir`. Node still cannot eliminate the final syscall-sized pathname race without
portable `openat`/`unlinkat`; test-only post-inspection hooks document that remaining P3 window
instead of claiming it is closed.

This is a best-effort local filesystem transaction, not an absolute atomicity guarantee. Node
does not expose `openat`, `renameat`, or an atomic directory exchange on all supported platforms.
A hostile namespace can still change between pathname checks, and a crash can occur between
renames or syncs. UI results therefore distinguish a normal success, success with uncertain
durability, and committed/uncertain failure. After cancellation reaches the critical rename
window, LeafBook reports the truth of a late committed result instead of claiming cancellation.

## Scope

Phase 8C does not add a server, cloud publishing, PDF, external assets, executable diagrams,
plugins, workflow changes, or crash-recovery scanning.
