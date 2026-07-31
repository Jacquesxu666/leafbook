# Book resource pipeline

Phase 10B1 introduces a bounded main-process capability for reading local book
images. Phase 10B2 connects that capability only to live Reader rendering.
Phase 10B3 adds a separate main-owned export transaction. Export never reuses
Reader's one-shot lease, never accepts renderer-provided paths or bytes, and
does not add a custom Electron protocol.

## Capability contract

The renderer can submit only a typed request containing:

- the opaque ID of an owned, live book session;
- that session generation's opaque resource token;
- the opaque node ID of a chapter whose exact content was successfully returned
  by `readChapter` in the same session generation; and
- one relative resource reference authorized from that returned content.

The main process resolves the reference relative to that node's model-owned
chapter path. This is not a claim about whichever chapter happens to be
visually current in the renderer. The renderer cannot submit a root, absolute
path, file descriptor, or arbitrary filesystem target. The response contains
only an allowlisted MIME type, byte count, container-validated
width/height/frame-count/decode-pixel metadata, and a structured-cloned
`Uint8Array`; neither successful nor failed responses contain a filesystem
path.

Resource access is also content-authorized. A successful pinned
`readChapter` parses the exact returned Markdown through the same pure Marked
tokenizer-extension contract used by Muya Reader rendering and stores at most
64 unique image destinations for that node and session generation. Unsupported
destinations do not consume that quota. A
per-node read nonce permits only the latest concurrent response to replace the
authorization set, so an older late response cannot roll it back. Only
Markdown inline images and resolved reference-style images enter this set.
Raw HTML, code, links, remote/data/file URLs, and unsupported image types do
not. `readResource` requires the submitted reference to be an exact member of
that set before it performs any filesystem lookup. Each authorized reference
is a one-shot lease: a duplicate request in the same node generation is
rejected before filesystem work.

Admission and lease reservation are one synchronous main-process boundary.
Duplicate requests are rejected without entering the queue. A request rejected
because the owner or global queue is full does not consume its lease and may be
retried later. Once admitted to the queue, however, its lease is burned even
if the 30-second wait expires; replaying that reference fails closed. Timeout,
session/token/nonce revocation, and cancellation all remove the queue entry,
cancel its timer, and decrement the exact owner queue count. Session or nonce
revocation additionally destroys the complete generation ledger.
When two slots are released together, one queued start per owner is handed
through to the real loader before that owner's next queued item is admitted.
The handoff is an opaque operation token bound to its session, resource token,
node, read nonce, and generation. A separate 30-second pre-open watchdog,
session/nonce revocation, actual open, and final cleanup may release only an
exactly matching token. A late old request therefore cannot clear a newer
same-owner handoff. Watchdog expiry releases the admission gate, not the
underlying active I/O; normal return-time generation and lease checks still
fail closed. Before that watchdog expires, queued starts for one owner are
strict FIFO. After 30 seconds, availability takes precedence: a later request
in the same live generation may pass the stuck pre-open request, while both
the per-owner and global active caps remain enforced. The late old request is
still independently revalidated before it may return bytes. This preserves
normal same-owner FIFO without letting a permanently stuck pre-open operation
starve that owner, and it never prevents a different owner from taking another
globally available slot.

The capability belongs to the session object and renderer owner. Every refresh
or replacement rotates the resource token. Closing or refreshing a session,
destroying its renderer, replacing its root, or otherwise invalidating the
session prevents an in-flight read from returning bytes even when the old file
descriptor was already opened; later requests using the old token also fail.
A refresh scan failure deletes the invalidated session, so recovery requires
reopening the library and can never revive the old resource token.

## Accepted content

Only one resource is accepted per request. The current allowlist is:

| Extension       | Required MIME | Required container validation                                                                  |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `.png`          | `image/png`   | bounded allowlisted chunks/CRC, static non-interlaced IHDR, exact zlib scanlines and IEND      |
| `.jpg`, `.jpeg` | `image/jpeg`  | bounded marker/segment structure, supported SOF dimensions, entropy scan, exact terminal EOI   |
| `.gif`          | `image/gif`   | GIF87a/89a structure, bounded tables/extensions/subblocks/images, exact trailer                |
| `.webp`         | `image/webp`  | exact RIFF size, allowlisted static chunks, valid VP8/VP8L/VP8X dimensions; animation rejected |

Extension and fully validated container must agree. Images are limited to
16,384 pixels per dimension and 40 million pixels per frame. GIF is also
limited to 256 frames and 80 million aggregate decoded pixels. Container
record/chunk traversal is capped at 4,096 entries. Truncation, trailing
polyglots, malformed chunk lengths, CRC errors, unknown WebP chunks, and
dimension/frame/decode bombs fail closed. SVG is accepted only after the
main-process streaming sanitizer has reduced it to the audited static subset
described below. HTML, scripts, media, fonts, archives, and unknown extensions
are rejected.

PNG is static-only: APNG control/data chunks and interlace are rejected.
Compressed metadata (`iCCP`, `zTXt`, and `iTXt`) is rejected to avoid a second
decompression surface. Only a small schema-checked ancillary allowlist is
accepted, with 64 KiB per chunk and 256 KiB aggregate limits. Contiguous IDAT
payload is capped at 8 MiB. Its zlib stream is inflated asynchronously through
Node zlib/libuv so a worst-case accepted stream does not synchronously block
the Electron main thread. It must consume the exact compressed input, inflate
to the exact bit-depth/color-type scanline size, use only PNG filter bytes 0–4,
and produce no more than 64 MiB.

## Reference and path checks

The reference is capped at 4,096 UTF-16 code units and 64 path components. It
must be NFC-normalized and contain no control characters, NUL, query, fragment,
percent encoding, backslash, scheme, authority, or absolute-path prefix.
`data:`, `file:`, remote URLs, encoded traversal, mixed-slash traversal, and
query-based extension tricks therefore fail before filesystem access.

Parent traversal is accepted only when normalization still produces a path
inside the current book root. The main process then:

1. revalidates the session root identity;
2. snapshots every ancestor's real path, device/inode and mode while rejecting
   symlinks and non-directories;
3. requires the target real path and lexical path to agree;
4. requires a single-link regular file no larger than 8 MiB;
5. opens it read-only with `O_NOFOLLOW` and `O_NONBLOCK` where available;
6. matches pathname and descriptor identity before reading;
7. performs a bounded descriptor read and an EOF probe;
8. rechecks inode, mode, link count, size, modification time, creation/change
   time, final target real path, pathname identity, and every ancestor snapshot;
   and
9. validates the complete image container against the extension-derived MIME
   type and decode budgets.

Any ambiguity or filesystem race fails closed. Error DTOs use path-free
categories such as unavailable, too large, type mismatch, busy, or unreadable.

## Budgets

- maximum payload: 8 MiB;
- maximum 256 Markdown image occurrences and 64 unique authorized references
  per Reader render;
- maximum image dimensions/pixels: 16,384 per axis / 40 million per frame;
- maximum PNG compressed/inflated data: 8 MiB / 64 MiB;
- maximum PNG ancillary data: 64 KiB per chunk / 256 KiB aggregate;
- maximum GIF frames/aggregate pixels: 256 / 80 million;
- maximum 4,096 parsed container records;
- exactly one resource per request;
- maximum 2 concurrent reads per renderer owner;
- maximum 8 concurrent reads across the manager;
- a bounded 64-entry global / 8-entry per-owner, 30-second resource-read queue,
  scheduled FIFO among currently admissible owners so one saturated owner
  cannot block others;
- an authoritative main-process ledger per session/node/read nonce: maximum
  64 one-shot requests/references, 32 MiB compressed bytes, 120 million decode
  pixels, and 512 frames per generation;
- the renderer independently enforces the same aggregate limits and stops
  scheduling after the first overrun;
- no network access and no persistent resource cache.

These budgets bound descriptor count, allocation, and structured-clone cost.
All image extension/MIME mapping and byte/dimension/pixel/frame/generation
limits above come from the pure shared `common/book/imagePolicy.ts`, which
composes `rasterPolicy.ts` and `svgPolicy.ts`. Its
extension map is the sole MIME value source: the exported media type and
runtime media-type collection are derived from that map. Main authorization,
shared DTOs, container validation, response validation, and Reader admission
do not maintain private copies.

## Residual filesystem limitation

Portable Node APIs do not expose an `openat`-style, descriptor-relative walk
for the complete ancestor chain. LeafBook therefore snapshots and rechecks
each ancestor and the final descriptor/path identity, and fails closed on any
observed change. A hostile process running as the same user with write access
to the book tree can still target the small pathname-check/open micro-window.
This remains a documented P3 limitation; the supported boundary is ordinary
local books, not a hostile same-user filesystem adversary.

## Reader object-URL integration

Only Markdown image tokens can become Reader resource slots. The static
renderer uses a per-render random provenance marker while sanitizing, then
replaces it with a path-free `image-N` slot. Raw HTML images never pass through
that renderer hook. Remote, data, file, malformed, and unsupported destinations
become inert accessible placeholders and never call
`readResource`. The real reference remains in the current in-memory
rendered-chapter resource table while that chapter generation is mounted; it
is never written into HTML, a DOM attribute, storage, or an error message.
Chapter/session/token changes, refresh, Reader exit, or component unmount
discard that table with the generation.

The Reader removes the path-free slot attribute before IPC. One hydration
generation owns at most two concurrent requests. At most 256 occurrences can
become path-free slots. Repeated references share one request and one Blob URL;
the generation admits at most 64 unique references and cumulatively enforces
32 MiB compressed bytes, 120 million decode pixels, and 512 frames. The main
process reserves one-shot references before I/O and atomically finalizes its
own cumulative ledger before returning bytes; the first overrun fail-stops
that node generation and cancels queued work. The renderer likewise stops
scheduling new work at its first budget failure, tolerating only requests
already in flight. It validates the returned media type, exact byte length,
container metadata bounds, and cross-realm `Uint8Array` identity. Only then
does it copy the bytes into a `Blob`, create one object URL, attach decode-error
handling, and assign `img.src` to every matching slot. A failed request, budget
excess, or image decode becomes an accessible path-free placeholder.
`resource-busy` alone receives bounded, cancellation-aware backoff so reads
left draining by the previous chapter do not permanently starve the next;
other errors are never retried.

The slot attribute is removed synchronously before the first IPC call. An
unrelated Vue component re-render therefore finds no new resource slot and
does not replay a burned one-shot lease. A real chapter/session/token
generation change renders fresh slots only after the corresponding main-owned
chapter authorization has changed.

Chapter/session/token changes, refresh start, Reader exit, component unmount,
and a newer hydration generation revoke every owned object URL. A response
that arrives after any of those boundaries cannot create or assign an URL.
Bytes, references, and object URLs are not persisted or cached. The renderer
never loads a Markdown-provided HTTP, file, or data URL and does not call
`fetch` for image hydration.

## Safe SVG subset

Safe local SVG uses `saxes` in the main process. The sanitizer rejects DTDs,
entities, processing instructions, foreign namespaces, scripting, animation,
embedded resources, style/event attributes, external URLs, and unknown
elements or attributes. It accepts only a static basic-graphics subset:
groups, paths, rectangles, circles, ellipses, lines, polylines, polygons,
linear/radial gradients, stops, and non-rendered `title`/`desc` metadata. SVG
`text`/`tspan`, `clipPath`/`clip-path`, filters, masks, and every dynamic or
embedded-resource surface are deliberately unsupported. Numeric, path, and
transform data are finite and bounded; local gradient references are resolved
under a bounded graph; output is deterministic canonical UTF-8.

All numeric syntax rejects non-finite values, exponents outside ±12, non-zero
underflow below `1e-12`, and values beyond their semantic bound. Paths track
absolute and relative endpoints, control points, and subpath state; elliptical
arc commands (`A`/`a`) are deliberately outside the static path subset. Points,
shape geometry, `pathLength`, viewport origin/extent and
root dimensions use the same coordinate policy. A 1×1 output cannot hide an
oversized `viewBox`. Transform parameters are bounded by type and each matrix
is composed step-by-step; every intermediate component must remain within the
shared policy. A second tree pass starts with the root viewport/viewBox and
default `preserveAspectRatio` mapping, then composes parent-to-child CTMs
without allowing a later descendant transform to cancel an already excessive
intermediate CTM. Conservative bounds for every shape, path endpoint, and
explicit or reflected curve control are transformed by the effective CTM and
checked again against the coordinate policy. Stroked geometry,
including inherited strokes, reserves four full stroke widths on every side.
This conservatively covers SVG's default miter limit at acute path, polyline,
polygon, and rectangle joins.

Fragment targets are type checked: paint references and gradient `href`
resolve only to gradients. Each ID resource owns every fragment dependency in
its complete subtree. A three-color DFS rejects cycles and memoizes longest
dependency depth, capped at 32 nodes.
Canonical attributes use a fixed UTF-16 code-unit comparator, never locale
collation; a child-process regression checks the same SHA-256 under multiple
`LANG`/`LC_ALL` values.

The renderer receives those bytes through the same one-shot capability and
generation budgets as raster images and displays them only through a revocable
Blob URL on an `<img>` element. Raw SVG is never inserted into the DOM.
The shared per-MIME DTO validator requires SVG `frameCount === 1`,
`decodePixels === width * height`, and the SVG-specific byte, dimension, and
pixel budgets before a Blob can be created.

## Offline export transaction

At export preparation, the main process rereads every chapter in exact model
order and applies the shared occurrence contract: only the first 256 supported
Markdown image occurrences are eligible, repeated references retain their
exact document order, and no later occurrence is read or counted. It opens
each unique accepted resource through the same descriptor-pinned container and
SVG validation boundary.
Raw HTML, remote/data/file URLs, absolute paths, and unsupported extensions
become inert placeholders without a filesystem read. A supported reference
that is missing or present-but-invalid also becomes a placeholder, but main
retains a verifiable negative source snapshot for that exact reference.

Sanitized bytes are keyed by SHA-256 and deduplicated across chapters. Every
accepted source also records its root, full ancestor chain, file identity,
raw-byte length, and raw SHA-256. Every negative source records the root and
existing path chain plus exact type, identity, link count, timestamps,
canonical path, symlink text where applicable, and a bounded stable raw hash
for a readable invalid regular file. Missing paths record the first absent
component. An I/O or permission failure that cannot produce a proof rejects
export preparation instead of issuing an unbound placeholder. Export admits no more than 32 MiB of unique
raw source bytes, before sanitization. The renderer receives only a
document-local first-occurrence-ordered array of unique opaque output targets,
aligned with Reader's unique `image-N` slots:
safe data URLs for single HTML, or `assets/<sha256>.<ext>` for a website. It
never receives a source reference, source path, filesystem root, or asset
bytes. The main process retains the authoritative ledger and validates the
returned HTML against a separate occurrence-expanded sequence, including
duplicates and every main-managed supported-resource placeholder. Those
placeholders carry only their opaque `image-N` slot; unsupported and raw-HTML
placeholders are deliberately outside this contract. An omitted, reordered,
extra, or substituted managed image/placeholder fails closed.

Single HTML permits at most 24 MiB of unique sanitized assets and 64 MiB of
final UTF-8 HTML. Before any snapshot reaches IPC, the occurrence-expanded
data-URL character total is capped at 48 MiB, so repeating one unique image
cannot consume the final-HTML budget in Renderer. An individual generated
`<img>` token uses a shared calculated bound covering the maximum 6 MiB asset's
base64 URL, 4 KiB `alt` and `title` values, and bounded attribute overhead;
every other HTML token remains capped at 64 KiB. Website assets have a separate 32 MiB whole-book budget and an 8 MiB
per-asset inspection limit.
Both modes cap unique assets, total references, decode pixels, and frames.
Immediately before commit, main synchronously reopens every positive raw
resource with no-follow bounded reads, verifies the recorded
root/ancestor/file identities, EOF, raw length and raw SHA-256, and enforces
the aggregate raw budget again. It also reconstructs every negative snapshot
and requires an exact match. Thus missing-to-created, invalid-byte changes,
invalid-to-valid, symlink-to-regular, and other state transitions fail closed;
an unchanged negative state remains a valid placeholder. Positive and readable
negative regular files share one 32 MiB physical-source budget. Physical files
are deduplicated by device/inode plus exact size, mode, link count, and
nanosecond timestamps, so hard-link aliases are hashed at most once per
validation pass; directories and symlinks are never opened for content. The
final synchronous pass uses the same per-physical cache and rejects a metadata
or content mismatch. Only exhaustion of this byte budget is classified as
`too-large`; an unstable, unreadable, or otherwise unverifiable source is
classified as `source-changed` and fails closed. The lease's current
time, token, owner, session, and generation are checked immediately after
those final synchronous source checks and before rename, with no asynchronous
yield between them.

Website output is staged in a private sibling directory. Each asset is written
with exclusive, no-follow descriptor semantics, synced, and bound into a
canonical schema-2 manifest with its exact path, byte count, and SHA-256; each
asset basename must contain that same SHA-256. The bounded ownership inspector
uses directory iteration caps before reading content, rejects undeclared or
unused assets, checks the declared per-file and aggregate budgets, and requires
the index's exact image occurrence sequence to match the main ledger. The
index, asset directory, manifest, directory identities, link counts, and
complete entry set are re-inspected before atomic rename. Replacement uses a pinned
backup/rollback transaction; uncertain cleanup or durability is reported
instead of guessed. Once the old target has been moved to its backup, rollback
authorization is deliberately limited to operation/owner/session identity,
the destination parent, the absent target, and the exact stage and backup
identities. A source change can therefore invalidate the new export while the
already-moved old website is still restored safely. Single HTML uses the corresponding private temporary-file
and atomic-rename transaction. Export leases are random, owner/session/
generation bound, short-lived, single-commit, and revoked on cancel, close,
refresh, renderer destruction, completion, or an identity-bound active TTL
timer. Revocation immediately aborts the operation and removes the lease from
admission. If a commit holds an in-flight reference, its pinned parent
descriptor and asset buffers remain available only until that operation's
`finally`; the final reference then closes the descriptor, zeroes the buffers,
and releases the ledger. Revalidation ledgers are always disposed in explicit
`finally` blocks. Later begin calls also prune expired leases before applying
concurrency caps. Website staging journals the root, asset directory, and each
file identity from creation, allowing cancel, TTL expiry, or an exception to
safely remove an exact partial stage even before its manifest exists.
