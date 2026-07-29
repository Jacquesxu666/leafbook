# LeafBook reader workspace

Phase 4 adds a local-first bookshelf, book contents tree, and immersive
read-only chapter view. Phase 5 adds bounded reading progress and per-chapter
position memory. Full-text search, annotations, editing, local-resource
transport, and publishing remain outside these phases.

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

## Reading progress and position memory

Reading state remains main-process owned and is stored only in LeafBook's
`bookshelf.json`. A library record may contain:

- the last main-only stable navigation target;
- at most 500 stable-target chapter positions as finite ratios from 0 through
  1;
- the last chapter title, overall progress, and update timestamp.

Legacy bookshelf records without reading state remain valid. Invalid reading
subrecords are discarded without dropping the library. Opaque renderer node
IDs are never persisted because they are regenerated for a new session.
Instead, the main process maps Phase 3 stable navigation identity, including
duplicate-target occurrence, to each session's opaque node ID. Stable keys and
chapter paths never enter renderer DTOs.

The renderer can save only an opaque `sessionId`, opaque `nodeId`, and bounded
ratio through `saveReadingPosition`. The main process resolves the target from
the owned session, requires a readable node, and rechecks exact session object,
owner, and pinned root identity after acquiring the bookshelf mutation queue.
A close, remove, renderer cleanup, or root replacement therefore prevents a
late save. A failed save against a replaced root does not consume the session,
so the following refresh still reports `book-unavailable` with the established
refresh semantics. Chapter titles are normalized and bounded to 512 UTF-16 code
units before persistence. Concurrent shelf updates retain the Phase 4
serialized read-modify-write semantics.

Overall progress uses the same flattened readable order as Previous/Next:

```text
(current chapter index + chapter ratio) / readable chapter count
```

The result is clamped to 0 through 1. Group landing pages participate in the
same place as Previous/Next. When the root landing is not already represented
in the contents tree, it is always the first readable item for main-process
persistence, renderer progress, Previous/Next, and Book home; it is never
duplicated when the tree already contains it. A saved stable target that no
longer exists after refresh falls back to the current book entry with zero
session progress.

The reader updates visible progress immediately, while disk writes use a
two-second trailing debounce. Persistence permits at most one request in flight
and one coalesced latest ratio. Insignificant changes are skipped. A unified
store flush waits for active position restoration, its timer, in-flight
request, and latest queued ratio before refresh, chapter or link navigation,
opening/switching books, or returning to the bookshelf/editor. Those normal
transitions await completion. Component destruction can only start the same
flush as a best-effort cleanup because Vue's unmount hook cannot await it; it
is not a durability guarantee.

Programmatic restoration suppresses its own scroll writes. Navigation intent
determines restoration after sanitized HTML is mounted:

1. explicit tree/previous/next/link navigation uses its requested fragment,
   otherwise the top of the chapter; it never prequeues zero for a fragment,
   and records the actual container ratio only after the anchor is positioned;
2. reopen, resume, and refresh use the saved chapter ratio when one exists;
3. without a saved ratio, resume may use the chapter's declared fragment and
   otherwise starts at the top.

The restoration pipeline is generation-scoped from Markdown rendering through
DOM mount, layout frames, scroll placement, and ratio sampling. Every current
generation exits through completion or cancellation, including render/layout
failures, so a transition flush cannot wait forever. Stale cleanup carries its
own token and cannot release or complete a newer chapter. Layout waits prefer
two animation frames, but fall back after 180 ms when a hidden/background
window stops delivering frames. Either path cancels the remaining frames and
timer; chapter cleanup or component unmount aborts the wait immediately.
Environments without `requestAnimationFrame` safely use the same bounded
fallback. The content surface exposes path-free `data-reading-ready` and
`aria-busy` UI readiness state.

Bookshelf cards and the reader header expose native, labelled progress
elements. A reopen resumes the last valid opaque node derived from the
persisted stable target; each previously visited chapter restores its own
bounded ratio.

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
renderer responses, unique duplicate-heading outline targets, legacy reading
records, bounded position retention, restart recovery, duplicate occurrence
identity, deleted-target fallback, root/session revocation, and stale renderer
progress responses. Progress tests also cover delayed persistence,
single-flight/latest coalescing, flush-before-refresh ordering, explicit versus
restore navigation intent, replaced-root refresh semantics, and normalized
bounded chapter titles across restart. Controlled render rejection, layout
failure, and stale cleanup tests verify that flush is released and subsequent
persistence remains usable. Fake-timer coverage verifies missing animation
frames, a stalled second frame, normal two-frame completion, and abort cleanup
without leaking a frame callback or timeout.

The Electron vertical-slice test replaces only the native dialog result with a
temporary book, then exercises:

```text
Open Book menu -> contents -> first chapter -> Next -> bookshelf -> editor
```

The temporary source folder is removed by the test, not by LeafBook.

A second vertical slice follows an explicit deep fragment into a long chapter,
verifies immediate overall progress, scrolls elsewhere, and confirms that
bookshelf reopen restores the saved ratio rather than replaying the fragment.
It then scrolls again and immediately refreshes inside the debounce window,
confirming that refresh waits for and restores the latest ratio. The restored
ratio remains stable after the full debounce interval, demonstrating that
loading/restoration scroll events did not enqueue a later zero.
