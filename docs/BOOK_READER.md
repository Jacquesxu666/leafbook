# LeafBook reader workspace

Phase 4 adds a local-first bookshelf, book contents tree, and immersive
read-only chapter view. Full-text search, reading progress, annotations,
editing, and publishing remain outside this phase.

## Security and process ownership

The main process owns every absolute book root and every filesystem read.
Renderer requests contain only opaque `libraryId`, `sessionId`, and `nodeId`
values generated with `randomUUID()`:

```text
native directory picker / persisted main-only library
  -> bounded Phase 3 scan
  -> main-owned session map (nodeId -> relative chapter target)
  -> serializable book DTO without an absolute path
  -> readChapter(sessionId, nodeId)
  -> bounded descriptor read with identity and containment checks
```

The renderer cannot supply a chapter path. A chapter read succeeds only when
the session exists and its node maps to a local chapter in the scanned model.
Each session is bound to the creating editor `webContents.id`. Read, refresh,
close, and link requests from another window fail as an expired session, and
destroying a renderer removes all of its sessions. At open time the main
process pins the canonical root plus bigint device/inode identity; read,
refresh, and link operations recheck that identity and permanently invalidate
the session if the root is renamed, replaced, or changed into a symlink.
Closing a session, removing a library, invalid identifiers, non-readable
nodes, and unavailable roots return stable structured errors.

Authorization is rechecked after every awaited filesystem or shell boundary by
comparing both the owner and the exact session object. A close, bookshelf
removal, or renderer cleanup therefore wins against an already-running read,
link, or refresh and its late result is discarded. External URLs receive one
additional check immediately before `shell.openExternal`, so cleanup during
root validation cannot produce a shell side effect.

Owner generations cover the earlier open lifecycle as well. Picker, root
identity, scan, and shelf-queue awaits all recheck the generation captured when
opening began. If renderer cleanup occurs first, the pending operation cannot
write a bookshelf record or register a session, even if its scan later
completes.

The bookshelf is stored in the LeafBook user-data directory as
`bookshelf.json` through `electron-store`. Its private records contain the
authorized absolute root; renderer list responses expose only display
metadata, availability, and the opaque library ID. Records are validated,
deduplicated, bounded to 50, and written atomically by the store. Removing a
book removes only this record and active sessions—it never deletes or modifies
the selected folder. Open/remove read-modify-write operations pass through one
main-process mutation queue so concurrent windows cannot lose shelf updates.

At most 20 live sessions are retained per renderer owner. Destroyed owners are
cleaned immediately, and one window cannot evict another window's active
sessions.

Refresh keeps the same opaque `sessionId`. The newly scanned model and target
maps are built off to the side, then replace the session map entry in one
synchronous commit only if the original owned session is still current. A
non-fatal scan failure leaves the prior session readable; a root identity
failure is the only refresh failure that invalidates it. Concurrent refreshes
for one owned session share one operation, and a close or library removal while
that operation is running prevents the result from reviving the session.

Opaque navigation IDs are derived indirectly from the Phase 3 model's stable
node identity and occurrence, never from a renderer path. This preserves
chapter and group component identity across refresh while keeping duplicate
`path + fragment` entries distinct and individually readable.

## Typed IPC

All book operations are invoke-only channels declared in
`shared/types/ipc.ts` and exposed through the narrow `window.electron.books`
preload API:

- `list`
- `openPicker`
- `openLibrary`
- `remove`
- `refresh`
- `closeSession`
- `readChapter`
- `followLink`

Input strings receive runtime type, size, and opaque-ID validation. Results are
plain serializable DTOs. The preload exposes no book path, `file://` helper, or
arbitrary filesystem operation. Listing is read-only and may be shared between
windows; picker/open/remove and every session operation additionally require a
live editor-window sender derived from Electron's IPC event.

## Link handling

The reader removes native anchor `href` attributes and delegates clicks to the
main process.

- Local Markdown links are resolved relative to the current model-owned
  chapter, normalized, checked against root traversal, and may navigate only
  to a chapter path already present in the current book model.
- Before any document-relative fallback, the decoded path is rejected when it
  is POSIX-rooted, backslash/UNC-rooted, or Windows drive-qualified. Encoded
  roots cannot be converted into relative paths by normalization.
- Same-page fragments and known chapter fragments are returned as navigation
  data and scrolled in the reader.
- External links are parsed and canonicalized again in the main process
  immediately before `shell.openExternal`. Only the Phase 3 allowlist
  (`http:`, `https:`, and `mailto:` without credentials) is accepted.
- Unknown, malformed, executable, absolute, escaping, and unsupported links
  produce a non-fatal structured error.

## Read-only rendering

The adapter uses Muya's synchronous `renderToStaticHTML` API, which leaves
Mermaid, PlantUML, Vega and other diagram fences as inert escaped
`pre > code` blocks. It never invokes the asynchronous diagram renderers.
DOMPurify then runs with the HTML-only profile; SVG/MathML, active embedded
content, forms, media, metadata and styles are forbidden. A final DOM pass
strips every resource/navigation attribute (`src`, `srcset`, `poster`,
`background`, `xlink:href`, `style`, `action`, `formaction`, and non-anchor
`href`) before serialization.

Local images and other attachments intentionally do not load in Phase 4.
Images become visible placeholders. This avoids exposing an arbitrary
filesystem protocol before a session-scoped resource transport is designed.

Anchors retain no native `href`; sanitized destinations are copied to
`data-book-href`, receive link role/tab stop semantics, and are handled by
delegated click or Enter/Space before the main process revalidates them.

## User interface

`File -> Open Book…` (`CmdOrCtrl+Alt+O`) and the editor empty state open the
native directory picker. The ordinary editor remains mounted while the
workspace overlay is active, preserving the existing edit flow.

The workspace provides:

- bookshelf cards, availability errors, reopen, and remove;
- recursive groups, chapters, external nodes, and directory/root landing
  pages;
- current-node highlighting and collapsible contents;
- previous/next buttons and Left/Right keyboard navigation;
- a sanitized, non-editable chapter surface;
- a generated current-chapter outline;
- refresh, diagnostics summary, loading, empty, and error states;
- responsive contents/outline panels and accessible navigation semantics.

The existing shared titlebar remains mounted above the book workspace, so
frameless Windows/Linux controls and the macOS traffic-light inset are
preserved. Async chapter rendering and Pinia IPC actions use cancellation/
generation tokens: late responses cannot replace a newer mode, session, node,
or rendered chapter. Chapter opens wait for an in-flight refresh before taking
their session snapshot. Refresh keeps the current stable node when it still
exists, otherwise it falls back to the book entry.

At widths where the outline panel is omitted, its toggle is omitted as well.
Navigation groups without a landing chapter expose disclosure semantics only
and never issue a chapter request. Global Left/Right chapter shortcuts ignore
modified keystrokes and events originating in links, buttons, form controls,
or editable content. Duplicate generated heading IDs receive deterministic
unique suffixes so every outline item resolves to exactly one heading.

Book diagnostics are informative and non-blocking. A fatal root scan prevents
the reader session from opening.

## Test coverage

Unit tests cover opaque DTOs, model-only chapter authorization, cross-owner
rejection/cleanup, root replacement invalidation, bookshelf persistence and
non-destructive removal, landing de-duplication, external-link policy, inert
PlantUML/static rendering, SVG and legacy resource-attribute sanitization,
media placeholders, flattened previous/next ordering, atomic same-session
refresh, duplicate-target identity, deferred refresh/open ordering, stale
renderer responses, and unique duplicate-heading outline targets.

The Electron vertical-slice test replaces only the native dialog result with a
temporary book, then exercises:

```text
Open Book menu -> contents -> first chapter -> Next -> bookshelf -> editor
```

The temporary source folder is removed by the test, not by LeafBook.
