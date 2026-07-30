# LeafBook Local Website Generation

Phase 8C generates a fixed, fully offline website from the current book. It deliberately reuses
the Phase 8B `generateBookExportHtml` renderer and `exportPolicy`; the website form does not have a
second Markdown renderer or a weaker HTML policy.

## Output contract

The selected directory contains exactly:

- `index.html` — the same self-contained, script-free HTML used by the single-file export.
- `leafbook-manifest.json` — canonical schema version 1 ownership metadata.

The manifest is generated and validated in the main process. It contains `schemaVersion`,
`generator: "LeafBook"`, and one `files` entry with the relative path `index.html`, byte size, and
SHA-256. It has no self hash, absolute/source paths, timestamps, or optional fields. LeafBook
rejects duplicate keys, unknown fields, noncanonical JSON, traversal paths, and hash/size
mismatches.

The HTML has inline fixed CSS, strict CSP, no scripts, no network or `file:` resources, no source
paths, and placeholders for local images. Reading order, aliases, groups, missing chapters,
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

LeafBook builds the two known files in a high-entropy sibling staging directory. Files are opened
with exclusive creation and, where supported by Node/the platform, `NOFOLLOW` and `NONBLOCK`.
Content, file identities, hashes, the staging directory, source revisions, source root,
destination parent, and target are checked again before commit. The manifest is written last.

The lease records the staging and destination directory identities plus the `index.html` and
manifest device/inode identities and SHA-256 values. Immediately before every rename, unlink, or
`rmdir`, LeafBook synchronously revalidates the owning session generation, parent, source root,
all final source hashes, target, staging directory, backup directory, and applicable recorded
leaves. After staging is renamed, the target must retain the original staging directory and leaf
identities. Rollback only renames a backup whose directory and leaves still exactly match the
original target, and only while the target remains absent.

For an absent target, staging is renamed to the target. For an empty or owned target, the old
target is first renamed to a high-entropy sibling backup, the staging directory is renamed into
place, and ordinary failures synchronously attempt to restore the old target. Backup cleanup
only occurs after the new target validates and its parent sync succeeds. Cleanup removes only
the two identity-validated owned leaves plus the manifest and then `rmdir`; an empty backup is
only removed with `rmdir`. LeafBook never uses recursive deletion and does not scan or recover
unknown backup directories in this phase.

Cleanup revalidates the backup and committed target between individual leaf removals. If an exact
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
