# LeafBook single-file HTML export

Phase 8B exports the current Markdown book as one self-contained `.html` file.
It does not export PDF, a website directory, a server, or a cloud artifact.

## User flow

Open a book in Reader and choose **Export…**. LeafBook first uses the same
dirty-editor guard as Reader/Edit/Arrange, then opens the native Save dialog.
The destination must:

- end in `.html`;
- be outside the source book root;
- have a real, unchanged parent directory;
- not be a symlink, directory, FIFO, or multiply-linked file.

Replacing an existing regular file requires a second explicit confirmation.
Cancel writes nothing. During export, Reader navigation, search, refresh, edit,
arrange, and mode switches are disabled; any open search panel closes
immediately. The Export control becomes **Cancel export** during begin,
generation, and commit. A successful export reports only the output filename,
never its absolute path. If directory durability cannot be confirmed, the UI
reports a qualified warning rather than ordinary success.

Electron does not provide an API to programmatically dismiss an active native
Save dialog. If cancellation is requested while that dialog is open, LeafBook
keeps export exclusive and displays “close the Save dialog to finish
cancelling.” Once the dialog/preparation settles, any returned lease is
immediately cancelled and the controls are released. During commit, LeafBook
also waits for both commit and cancellation settlement; a late successful
commit is reported as completed before cancellation, and `committed: true`
uncertainty is reported as possibly committed rather than hidden as stale.

Only one commit is admitted for a lease. Cancel or owner/session cleanup
increments the lease generation and aborts an admitted operation after every
asynchronous boundary. If cancellation wins before the synchronous rename
turn, the final pathname is never written. Once rename has occurred, a later
boundary failure is reported explicitly as `committed: true` rather than as a
successful cancellation.

## Offline output contract

The generated file has:

- a static nested table of contents and static chapter sections;
- one semantic **Book home** TOC item when the root landing is outside SUMMARY,
  and group labels linked to their authorized group landing;
- one section per physical Markdown document, even when SUMMARY contains
  aliases or multiple heading links to that document;
- namespaced chapter and heading IDs for same-document navigation;
- deterministic duplicate-heading handling, including Unicode headings;
- disabled TOC text and no body section for a missing/unreadable chapter;
- an inert text marker for external or unresolved links;
- an inert local-image placeholder.

The export contains no scripts, executable diagrams, remote resources,
`file://` links, source absolute paths, forms, embedded frames, media loaders,
inline event attributes, or user-controlled style attributes. It carries a CSP
with `default-src 'none'`, data images only, the fixed inline stylesheet,
`base-uri 'none'`, `form-action 'none'`, and `navigate-to 'none'`.

## Security and consistency boundary

Export is a two-phase, main-owned lease:

1. Main canonicalizes the selected parent using `realpath`, derives the target
   from that real parent plus the selected basename, and freezes an opaque,
   bounded snapshot. Absolute source paths and output paths stay in main.
2. Renderer uses the existing static Reader renderer and DOMPurify policy,
   replaces local media, rewrites only authorized internal links, and builds a
   fixed shell.
3. Main parses the result with a strict tag/quoted-attribute allowlist. It
   requires the exact CSP and stylesheet; the only URL-bearing attribute
   accepted is a namespaced in-document anchor. The parser is iterative and
   linear with a maximum depth of 128, 200,000 tags, 32 attributes per tag, and
   a 64 KiB tag token. IPC checks the 64 MiB UTF-8 payload limit before running
   this validator or copying the accepted payload.

This validator is deliberately a custom recognizer for LeafBook's fixed
generator subset, not a general standards-compliant HTML parser. Browser HTML
parsers repair malformed nesting aggressively; deterministic DOM-repair
differential fixtures require every such tested repair case to fail closed
before the file is written. 4. Main validates the source-root identity before and after source
revalidation. It rereads every exported source plus SUMMARY twice and
compares SHA-256 revisions. A final synchronous descriptor pass immediately
before rename opens each source no-follow, checks regular-file identity and
its declared/per-file/32 MiB aggregate size before allocating, hashes with
one fixed 64 KiB buffer, detects short reads or growth, and rechecks
inode/size/mode/link-count/timestamps after EOF. 5. Main pins the canonical destination directory with an open descriptor,
writes a high-entropy `O_EXCL | O_NOFOLLOW` temporary file, verifies its
inode after open, and syncs it. Immediately before rename, one synchronous
turn rechecks the pinned/pathname parent identities and realpath, source-root
identity, target inode/link count, every source hash, and temp inode. After
rename it proves the target is the temp inode, rechecks parent/root identity,
and syncs the pinned directory descriptor.

Node does not expose portable `openat(2)`/`renameat(2)` APIs. Consequently an
external local process with permission to mutate the destination or source
namespace can still race source, target, temp, or parent pathnames after a
descriptor check/close and inside the final pathname-check-to-`renameSync`
syscall window.
LeafBook does not claim that this OS-level race is eliminated. Observed swaps
fail closed; cleanup never unlinks through a redirected parent pathname, and a
swap detected after rename is returned as committed-but-uncertain. This is a
local-desktop boundary, not a safe export primitive for an actively hostile
shared directory. If the directory is redirected immediately after exclusive
temp creation, LeafBook intentionally closes the descriptor without unlinking
through the now-untrusted pathname. The old pinned directory can therefore
retain one empty, high-entropy `.leafbook-export-*.tmp` file; no book bytes are
written before the post-open parent check.

Limits are 2,000 documents, 32 MiB of decoded Markdown source, 1,024 discovered
links per document, 16,384 links per book, 64 MiB of final HTML, four concurrent
export owners, and one preparation per window. Closing/refreshing the session,
owner destruction, explicit cancellation, or a late renderer generation
revokes the lease.

The old single-document `exportStyledHTML` pipeline is intentionally not used:
it can resolve local resources to absolute `file://` URLs and has a broader
export surface than the Reader-grade offline contract.
