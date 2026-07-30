# LeafBook SUMMARY arrangement

Phase 8A lets a reader safely rearrange an existing GitBook-style
`SUMMARY.md` or `SUMMARY.markdown`. It is a main-owned draft workflow. It does
not create a SUMMARY, move or rename chapter files, rewrite links, export a
book, or publish anything.

## Lossless source document

`common/book/summaryDocument.ts` is intentionally separate from the existing
navigation parser. It accepts strict UTF-8 up to 2 MiB, preserves an optional
UTF-8 BOM, every LF/CRLF terminator, and the absence of a final newline.
Bare CR, interior BOM, invalid UTF-8, excess lines/nodes/depth/operations, and
unterminated fenced blocks are rejected or made read-only.

Recognized headings are fixed containers. Recognized unordered list items are
arrangeable subtrees with stable opaque IDs tied to their original source-line
objects rather than mutable line numbers. Blank lines and complete single-line
HTML comments immediately before a list item travel with that item. Trailing
trivia at EOF or immediately before a heading or opaque barrier remains fixed
in place. Current UTF-8 byte spans are recomputed after every reorder or
indentation change, so span metadata never describes an older draft.
Unsupported lines and fenced regions are preserved byte-for-byte as opaque
barriers; operations cannot cross a heading, parent, or opaque barrier.
Malformed links and locally unsafe targets use the navigation parser's
sentinel-parent semantics: the invalid item is opaque and cannot become a
movable parent, while a valid nested item resumes at the safe container.
Heading and list nodes share the same public node budget. The first valid H1 is
book title metadata rather than a group, and an empty formatted heading is
ignored, matching the authoritative navigation parser.

The pure operation engine supports sibling `move-before`/`move-after`,
`indent`, and `outdent`. A whole list subtree moves together. It preserves the
original marker, text, comments, and line endings and changes only indentation
prefixes for reparenting. Mixed tab/space subtrees are not reparented. A final
line without a terminator cannot be moved away from EOF because doing so would
require inventing a byte or concatenating two logical lines. The draft keeps a
bounded 50-step undo history; the parser separately caps total operations at
10,000. Main stores each undo snapshot as serialized bytes plus a compact
`Uint32Array` containing the source-line identity order. Undo reparses strict
UTF-8 with those retained identities, so a non-initial multi-step snapshot does
not renumber opaque heading/list IDs by its temporary physical position. Both
byte content and ID metadata count toward the 8 MiB per-lease history cap. Main
does not retain 50 complete object graphs. The lifetime operation counter
belongs to the lease and is not refunded by undo. An
operation whose reparsed result is ambiguous, truncated, or over the original
depth/node/work limits is rejected without changing the draft, and save
reparses the candidate as a second defensive check.

## Main authorization boundary

Only a live owner-bound session whose navigation source is `summary` can begin
arrangement. Main requires the summary file to already exist directly in the
book root. The renderer receives only:

- an opaque arrangement ID and the existing session ID;
- SHA-256 base and candidate revisions;
- bounded heading/list DTOs and legal-operation hints;
- dirty/undo state, operation count, and candidate byte size.

It never receives a root path, SUMMARY path, source spans, raw lines, or raw
bytes. Typed invoke-only IPC exposes begin, apply, undo, save, and close.
Runtime validation bounds all identifiers, operation discriminants, targets,
revisions, and overwrite tokens before calling the manager.

The main lease pins owner, exact session object/generation through a current
capability, root realpath/device/inode, root directory identity and mode,
SUMMARY identity and mode, and raw SHA-256 revision. Public refresh, session
close/removal/eviction, root invalidation, owner teardown, or successful
save-owned session replacement revokes affected drafts. Apply and undo are
rejected while save is active; a second concurrent save receives a conflict.
At most four arrangement leases may belong to one renderer owner and at most
32 may exist globally. Capacity is reserved synchronously before begin performs
filesystem awaits, so a concurrent begin flood cannot oversubscribe either
limit. Retained drafts consume a conservative weighted budget consisting of
current raw bytes, source-line count, combined heading/list node count, and all
retained history bytes/ID metadata. Apply checks the prospective retained total
before pushing a snapshot. Owner and global totals include every pending-begin
reservation; pending-to-active conversion deducts only that begin's own
reservation, so other in-flight begins remain charged. Lease close, owner
cleanup, revocation, undo, and successful-save history clearing release the
corresponding retained budget.

## Conflict and atomic commit

Save reopens the exact regular file with no-follow semantics, checks its bounded
size and identity before and after reading, and compares raw bytes to the lease
revision. An external change is rejected by default. The response may contain
a one-use overwrite token bound to owner, lease generation, base revision,
external revision, and exact candidate hash. Editing the draft, changing the
external file again, using another owner, or replaying a consumed token cannot
authorize an overwrite.

Main writes an exclusive no-follow temporary file in the book root, preserves
permission bits, fsyncs it, then repeats asynchronous root/directory/file and
revision checks. Immediately before commit it synchronously revalidates root
realpath, root and target lstat identities, bounded descriptor size, and raw
revision. There is no `await` between that final authority check and
`renameSync`. Revocation before the critical turn removes only the temp file;
revocation during the critical turn is deferred until rename and verification
finish.

Rename is the commit point. Main fsyncs the directory and verifies the
replacement descriptor identity and bytes. Verified bytes with a directory
fsync failure return success plus `durabilityUncertain`. Failure to verify
after rename returns `arrangement-commit-uncertain`, `committed: true`, and
revokes the lease so callers cannot blindly retry. A successful save runs a
private book reload bound to the same unchanged session, replaces that session,
invalidates search/edit/arrangement capabilities, and returns the refreshed
navigation when possible. The file save remains successful if that later
reader refresh cannot be consumed. The lease remains busy from the first save
through completion of this private reload/session replacement. Apply, undo, or
a second save in that interval is rejected, preventing a post-commit draft from
being silently revoked by the first save's refresh. If the private refresh
cannot be consumed, the committed save is still reported but the arrangement
lease is revoked rather than continuing against stale navigation.

Node does not expose `renameat(2)`, so this is the same local-desktop threat
model documented for chapter editing: LeafBook closes JavaScript event-loop
interleaving between final component checks and rename, but does not claim to
defeat a hostile native process continuously racing filesystem names.

## Renderer draft workflow

The Reader exposes an explicit **Arrange** action only when the active session
was loaded from an existing SUMMARY. Starting it first runs the same
`PREPARE_RETURN_TO_BOOK` guard used by chapter editing, so a hidden dirty book
tab must be saved, reloaded, or cancelled before an arrangement lease is
requested. Pending begin and an active draft are exclusive Reader transitions:
search, edit, refresh, chapter navigation, and leaving the Reader cannot race
them. Search and reading-position writes are flushed before begin. A
programmatic edit transition explicitly closes/invalidate a pending begin; if
that already-dispatched begin later succeeds, its returned lease is closed.

Arrange mode renders only the bounded DTO returned by main. The renderer never
receives the SUMMARY path or source bytes. Headings are focusable fixed
containers without movement controls. List entries support:

- pointer drag and drop among safe siblings;
- `Alt+ArrowUp` / `Alt+ArrowDown` sibling movement;
- `Alt+ArrowLeft` outdent and `Alt+ArrowRight` indent;
- visible Move up/down/indent/outdent buttons, including at mobile widths;
- roving tree focus, visible focus rings, and polite live announcements.

The actual `treeitem` owns its role, roving `tabindex`, keyboard handler,
selection/grabbed state, and parent `aria-expanded` state. Exactly one
treeitem is in the tree's Tab sequence. Per-item pointer controls remain
clickable but use `tabindex="-1"` so they do not turn every row into five Tab
stops. Recursive treeitems stop keyboard and every drag lifecycle event at the
current node for their own handling, preventing a nested child gesture from
being repeated by its parent/heading ancestors. Keyboard uses a self-only
handler rather than stopping propagation, so unhandled Escape still reaches
the workspace Arrange-close command. Drop before/after uses the target row's
rectangle rather than the enclosing `li` subtree, so expanded children cannot
distort the row midpoint.

The DTO's `canIndent` marker also identifies the first entry of a safe section,
so renderer-side move and drop targets do not cross a heading or opaque
barrier. Main remains authoritative and rejects any ambiguity not expressible
by the DTO, including mixed tab/space reparenting. A rejected operation leaves
the prior draft intact and is shown in the arrangement panel. Live-region
success is announced only after main accepts the operation and the returned
candidate revision/operation state changes; main rejection announces the error
and never claims the requested move completed.

The panel previews the bounded item count, lifetime operation count, candidate
byte length, dirty state, and undo availability. Undo is main-owned; there is
no renderer redo stack. Cancel sends `close-arrangement` and never invokes
save. Save uses the base revision supplied by begin. An external rewrite opens
the shared focus-trapped decision dialog; only an explicit Overwrite action
retries with the one-use candidate-bound token.

Renderer begin/apply/undo/save operations use an arrangement-specific
generation. Closing, leaving the Reader, refreshing, or unmounting invalidates
that generation; late responses cannot revive a draft. A late successful begin
is explicitly closed. A fatal save response first disposes any decision and
best-effort closes the main lease (including already-revoked not-found cases)
before renderer state forgets its opaque ID. Successful save consumes the refreshed session returned
by main, clears search state, keeps the current stable chapter node when it
still exists, and restores its persisted reading position. If main committed
the SUMMARY but could not return a refreshed session, the Reader performs a
normal refresh instead.

## Deferred scope

Phase 8A has no redo stack, filesystem watcher, chapter
creation/deletion/move/rename, inferred-to-SUMMARY conversion, image copying,
HTML/PDF generation, cloud deployment, Git command, website workflow, or
release-workflow change. Those require separate phases and threat models.
