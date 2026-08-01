# LeafBook chapter editing

Phase 7 lets a reader edit the current local Markdown chapter in LeafBook's
existing Muya editor. It does not introduce a second editor or expose an
absolute book path to the renderer.

## Authorization boundary

The renderer starts editing with only the active `sessionId` and `nodeId`.
Main validates that exact session and chapter, then returns an opaque `editId`,
normalized Markdown, a SHA-256 revision, and non-path formatting metadata.
The main-owned edit lease pins the owner, a generation and abort signal, every
physical directory component from root through parent, the physical target
identity, stable chapter key, raw revision, BOM, and line-ending format.
Session close/removal/eviction, public refresh, invalid root identity, or window
teardown advances the exact session generation and revokes all affected
leases. A lease is current only while its exact session object, session
generation, lease generation, and operation generation all match. Save and
reload are single-flight per lease, and every asynchronous checkpoint confirms
that full identity is still current.

Book edit IPC is invoke-only:

- `begin-edit(sessionId, nodeId)`
- `save-edit(request)`
- `reload-edit(editId)`
- `close-edit(editId)`

No DTO or tab contains the root or target path.

## Safe format and write policy

Editing accepts strict UTF-8 only, with an optional UTF-8 BOM, and is capped at
8 MiB by both early IPC byte validation and main validation before and after
editing. LF and CRLF are preserved. Mixed LF/CRLF input
requires an explicit confirmation before its first save; that save normalizes
to the predominant original line ending. Lone CR is rejected.

Main writes a book chapter with a same-directory, exclusive, no-follow
temporary file. It requires writable target and parent permissions, preserves
permission bits, fsyncs the file, and checks the exact lease after every
asynchronous open/write/chmod/stat/fsync/test checkpoint. Immediately before
commit it synchronously revalidates realpath, every component's lstat identity
and mode, root/session/lease generations, target identity, writability, and raw
revision, then calls `renameSync` in the same event-loop turn. It synchronously
fsyncs the directory and verifies the committed identity and bytes. It never
creates a missing parent, follows a symlink, or recreates a deleted/replaced
target.

Node does not expose a directory-descriptor-relative `renameat` API. This is a
local desktop threat model, not a claim of protection against an adversary in
another native process that can continuously swap path components while the
JavaScript thread is running. LeafBook closes the event-loop interleaving gap:
there is no `await` from the final component-wise validation through rename.
Close, refresh, owner cleanup, and lease revocation before that critical turn
abort and clean only the temporary file. Once the critical turn begins, a
revoke request is deferred until rename and synchronous commit verification
finish, so the API never reports `edit-not-found` for bytes it already changed.

Rename is the commit point. If directory fsync fails but the committed bytes
verify, save succeeds with a visible durability warning. If the committed bytes
cannot be verified, main returns `edit-commit-uncertain` with `committed: true`,
revokes the lease, and the renderer preserves the dirty candidate in read-only
mode instead of blindly retrying or claiming it was saved.

An unexpected raw revision is rejected by default. The conflict response can
carry a one-use overwrite token bound to owner, lease generation, root and
target identities, base and external revisions, and the exact candidate hash.
A later save must present that exact token for that exact candidate; changed,
stale, concurrent, or reused tokens do not authorize an overwrite. The editor
presents a labelled modal with visible Cancel, Reload, and Overwrite buttons.
Cancel receives initial focus, Tab is trapped inside the modal, Escape cancels
in the capture phase, and closing restores the previous focus.

After a successful write, main uses a save-owned private refresh capability
bound to that exact lease operation. It does not join the public refresh
single-flight. Only that operation may consume its scan, replace the exact
session, invalidate search state, preserve reading progress, and atomically
rebind the lease by stable node identity. A public refresh advances the session
generation and revokes leases at its start: before commit it prevents the save;
after commit it sees the new bytes while the completed save returns read-only.
If the book can no longer be refreshed or rebound, the successful write is
reported but the edit becomes read-only.

A scoped/live external-filesystem watcher is explicitly deferred and outside
Phase 7. Current safety comes from comparing the exact raw revision immediately
before every save, rejecting external changes by default, and refreshing the
book session when returning to the reader. LeafBook does not claim to surface
external edits live while a chapter remains open.

## Editor behavior and scope

Reader **Edit** cancels active search, flushes the current reading ratio, begins
the lease, and opens a book-backed tab in the existing editor. `Cmd/Ctrl+S`
uses `save-edit` for that tab; ordinary file tabs retain their existing save
path. Per-tab operation generations prevent late save/reload results from
discarding input typed while an operation was in flight. Every Back, tab-close,
and window-close guard first awaits the tab's existing save promise and only
then recomputes dirty state; it neither opens an early Unsaved dialog nor
issues a duplicate save. Book tabs and lease
metadata are excluded from crash-recovery buffer snapshots. Book tabs have no
pathname and disable auto-save, Save As, Move, Rename,
encoding changes, and line-ending/final-newline controls. Closing a dirty book
tab and closing the window use Save/Discard/Cancel guards that never route the
book tab through the pathname-based save dialog. **Back to Book** resolves
dirty book tabs, refreshes the hidden session while the editor remains
mounted, and switches to the reader only after a successful refresh.

The same accessible decision surface is used for mixed-EOL confirmation and
dirty Back/window/tab-close guards. Requests are FIFO and carry a request id
plus owning tab/operation generation; closing or superseding a tab disposes
only its requests. It has dialog semantics, a labelled description,
keyboard-reachable actions, initial Cancel focus, document-capture Tab/Escape
handling even if focus was moved outside the dialog, and deterministic focus
restore. Unmount removes the capture listener and disposes queued requests.
Reader-to-editor transitions make at most four rendered-frame DOM focus
attempts against an actual visible Muya `contenteditable` inside
`.editor-component`. The mobile Electron E2E verifies that the resulting
`activeElement` is inside the editor; this fixed bound is not an unbounded
readiness promise.

Creating or renaming chapters, writing `SUMMARY.md`, attachments, Save As, and
non-UTF-8 conversion remain outside Phase 7.
