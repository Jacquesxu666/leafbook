# LeafBook book domain contract

Phase 3 introduces the book model without UI or IPC:

- `packages/desktop/src/common/book` contains serializable types and bounded,
  pure parsing/building functions.
- `packages/desktop/src/main/book` is the only Node filesystem boundary. It
  accepts an absolute root, scans safely, and passes relative paths and content
  to the pure builder.

## Public API and serialization boundary

`buildBook`, `parseBookSummary`, and `resolveBookTarget` are exported from
`common/book`. `loadBookFromDirectory` is exported from `main/book`.

No absolute root, Node error string, file handle, Electron object, or renderer
state may enter a `Book` or diagnostic. Incoming diagnostics are reconstructed
from a code-to-severity/message table; arbitrary `message` values are never
copied. Empty or invalid source/related paths are dropped. Runtime validation
constrains `rootName`, `summaryPath`, `BookFile.path`, diagnostic source paths,
related paths, options, and messages rather than relying only on TypeScript
types.

`buildBook` also normalizes its top-level runtime input. `undefined`, `null`,
arrays, and other non-object values return an empty, safe `BookBuildResult` with
a controlled diagnostic instead of throwing.

Physical filesystem paths and SUMMARY URL destinations are deliberately
different:

- A physical `BookFile.path` is already a canonical POSIX path relative to the
  root and is **never URL-decoded**. Thus `a%20b.md` and `a b.md` are distinct.
- A SUMMARY destination is URL-decoded exactly once. `a%2520b.md` addresses the
  physical file `a%20b.md`; it is not decoded a second time.
- Fragments are decoded once, stored separately, and reject NUL/control
  characters.

## Navigation and landing semantics

1. Exact root `SUMMARY.md` wins over exact `SUMMARY.markdown`. The scanner loads
   the selected SUMMARY first under an independent byte budget; neither
   candidate consumes the ordinary file budget or becomes an orphan.
2. SUMMARY order is authoritative. The first existing local chapter is the
   entry page; when none exists, the root landing page is the entry.
3. A root landing page is selected from exact `README.md`,
   `README.markdown`, `index.md`, `index.markdown`, then deterministic
   case-insensitive matches. It supplies book title/entry fallback and is not an
   orphan merely because SUMMARY omits it.
4. Without SUMMARY, a directory trie builds deterministic navigation in
   directory-first order. A directory README/index is its `landingPath`, not a
   duplicate child chapter. The root equivalent is
   `BookNavigation.landingPath`.
5. Navigation identity is an unambiguous JSON tuple `[path, fragment]`; node IDs
   add occurrence as a third tuple field. Delimiter characters such as `#` in a
   decoded path or fragment cannot collide. The same file may appear at
   different anchors. Repeated identical targets remain stable nodes with an
   occurrence in the ID and produce one duplicate diagnostic. File existence
   and orphan checks use path identity only.
6. H1 extraction ignores fenced code and honors opening/closing fence character
   and length.

The SUMMARY parser supports headings and nested unordered lists, ignores fenced
code, and treats an invalid/skipped list item as a sentinel boundary: nested
items cannot attach to the previous valid sibling. Missing-chapter diagnostics
retain the SUMMARY source line.

## URL and path safety

Local targets reject absolute/Windows/UNC paths, root traversal, queries,
malformed encoding, non-Markdown extensions, and controls. External navigation
requires an explicit WHATWG-parsable `http:`, `https:`, or `mailto:` URL.
Protocol-relative URLs, `file:`, credentials, malformed URLs, controls, and all
other schemes are rejected. Canonical `URL.href` is stored.

Phase 4 must revalidate an external URL in the main process immediately before
opening it. A serialized external node is data, not authorization to call
Electron `shell.openExternal`.

Unicode NFC + case-folded physical path collisions are diagnosed without
silently dropping either node. This warns about books that are ambiguous across
case-sensitive and case-insensitive filesystems.

## Bounded scanning and TOCTOU posture

All numeric options require finite integers, are clamped to hard maxima, and
otherwise use safe defaults. A root must be a non-empty absolute string;
relative, empty, and non-string roots return a structured result without
calling `path.resolve`. Phase 4 may pass only a path returned by its authorized
directory picker, and the main process must still revalidate that path.

The scanner has independent bounds for depth, files, directories, global
entries, entries per directory, diagnostics, per-file bytes, total ordinary
bytes, SUMMARY bytes, and exclude-pattern count/per-pattern/total characters.
Exclude patterns are normalized and compiled once. A directory is read through
`opendir` only through its configured limit plus one; an oversized directory is
closed and skipped in full, so filesystem iteration order cannot select a
nondeterministic partial subset. Exact root SUMMARY candidates are probed and
bounded independently before ordinary traversal, preserving SUMMARY priority.

File and SUMMARY descriptors are read in a loop through at most their byte
limit plus one, then decoded with `TextDecoder`; `readFile` is not used. Identity
and stability are checked with bigint descriptor stats before and after the
read. The stable snapshot compares `dev`, `ino`, `size`, `mtimeNs`, and
`ctimeNs`, so a same-inode, same-length rewrite is rejected even if its mtime is
restored. Identity replacement and same-identity content change have distinct
diagnostics. The
pure parser/builder independently bound candidate-file and incoming-diagnostic
iterations, raw characters before encoding, bytes, SUMMARY characters/lines/
list items/link and fragment lengths, nodes, depth, and diagnostics. Limits are
checked before node creation or additional input iteration.

Capacity diagnostics mean that content was actually omitted. Exactly reaching
`maxFiles`, `maxNodes`, or `maxLines` is valid; a diagnostic is emitted only
after another eligible Markdown file, navigation node, or real SUMMARY line is
observed. Probing for overflow remains bounded by the scanner's entry,
directory, depth, and per-directory caps.

Directory symlinks observed by the static traversal are never traversed,
including aliases to a real directory inside the root. Markdown files are
opened with `O_NOFOLLOW` where available. Before content is read from the open
handle, LeafBook compares the pre-open identity, handle `fstat`, current-path
identity, and realpath containment; it repeats descriptor/current-path checks
after the bounded read. Content is accepted only from a stable, contained file
descriptor.

On platforms without `O_NOFOLLOW`, post-open identity and containment checks
still detect and reject observable replacement. Node does not expose an
`openat`-style API here, so the scanner cannot promise that an arbitrary,
concurrently mutated parent-directory namespace remains unchanged. Static
symlink rejection plus per-file descriptor containment prevents accepting a
file that is observed to escape the root; it is not a proof that the directory
namespace was immutable for the entire scan.

An invalid, missing, non-directory, or unreadable root produces the stable
error diagnostic `scan-root-error`. Failures for individual entries and files
remain the warning diagnostic `scan-read-error`, allowing callers to
distinguish a book that cannot be opened from a partially readable book.
