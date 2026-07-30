# Real-book release-candidate harness

Phase 9B adds an opt-in Electron release-candidate check for a real Markdown
book. It is a test harness, not an importer and not a production migration
tool. The original book remains read-only.

## Running it

The source environment variable alone never activates the suite. The package
wrapper must mint a random 256-bit nonce, store it in an owner-validated marker,
and pass the matching runner root and nonce. Direct Playwright and normal E2E
runs skip before source access:

```sh
LEAFBOOK_RC_BOOK_ROOT=/absolute/path/to/book \
  pnpm --dir packages/desktop test:real-book:rc
```

The optional `LEAFBOOK_RC_MAIN_MD` value must be a basename for a regular
Markdown file at the book root. When omitted, the harness selects the largest
root Markdown file. Neither value is printed by the harness.

Do not enable Playwright screenshots, traces, snapshots, video, or verbose
application logging for this suite. Do not paste a failure artifact into an
issue without first confirming that it contains no book content.

The package script uses `scripts/run-real-book-rc.mjs`, not Playwright directly.
The wrapper creates and validates a marker-owned runner temporary root before
spawning Playwright, forces trace/screenshot/video and AI error-context DOM
capture off, and routes Playwright's output directory below that root. It
never forwards child stdout or stderr: each stream is consumed into a bounded
private buffer and discarded without being written anywhere. Successful public
output is exactly `RC_HARNESS_PASS product_ready=false visual_fidelity=false
content_adaptation_gaps=1 release_matrix_ready=false
accepted_p3_boundaries=crash_partial_create,same_user_syscall_path_boundary,unicode_casefold_pin_drift
book_structure_ready=true code=0`: this accepts the real-book preparation
structure covered below. It is not full product acceptance: the release matrix
is not ready, inline-SVG remains one known content-adaptation gap, and the
explicit P3 boundaries remain accepted rather than resolved. Signal handlers are
installed before runner-root creation and retained through all private cleanup;
a repeated signal escalates child termination, and a signal at any time forces
a non-PASS after cleanup. Its deterministic privacy and cleanup checks are:

```sh
node scripts/run-real-book-rc.mjs --self-test-child-failure
node scripts/run-real-book-rc.mjs --self-test-private-child-failure
node scripts/run-real-book-rc.mjs --self-test-direct-bypass
node scripts/run-real-book-rc.mjs --self-test-broad-root
node scripts/run-real-book-rc.mjs --self-test-signal-cleanup
node scripts/run-real-book-rc.mjs --self-test-pre-root-signal
```

## Isolation and cleanup

After wrapper authorization, the harness takes an in-memory source manifest
before copying or launching the application. Manifest and copy traversal share LeafBook's hidden,
`.git`, and `node_modules` ignores and the same depth, directory, entry,
per-directory, per-file, and aggregate caps. Hashing uses bounded chunks from
`O_NOFOLLOW` descriptors with identity checks; symlinks, special files, and
hard links are rejected. Broad `/`, home, and project roots are rejected. It then
creates a primary internal temporary directory, validates its canonical prefix
and owner, and writes a random marker with exclusive creation. The functional
RC's writable locations are children of that directory:

- `source-copy` contains the test-only book copy;
- `output` contains the HTML and website results;
- `userData` profiles contain Electron state.

This harness root is a child of the wrapper-owned Playwright-output root. Before
the functional copy, four short-lived sibling roots exercise cleanup rejection
for a symlink marker, an oversized marker, a directory marker, and a marker
pathname identity swap. Each fixture must still exist after the guarded cleanup
attempt and is then removed by fixture teardown. No RC artifact is written
below the repository. Every Electron launch strips all `LEAFBOOK_RC_*`
variables, including source, basename, runner authorization, and a synthetic
sentinel.

The copier accepts only regular files and directories. For each leaf it opens
the source read-only with `O_NOFOLLOW | O_NONBLOCK`, verifies the opened file's
identity, link count, type, and size, and copies bounded chunks into an
exclusively created `O_NOFOLLOW` destination. It then rechecks source identity
and both sizes. Source/destination root and parent directory realpaths and inode
identities are revalidated throughout. A deterministic swap-to-symlink probe
must fail before the real copy proceeds.

This is fail-closed test isolation, not a claim of syscall-level confinement.
Node does not expose the `openat(2)`-style directory-handle traversal needed to
eliminate every parent-path rename window. Cleanup likewise has a validation to
recursive-remove interval. Those residual local same-user races are accepted
P3 risks for this manually invoked desktop RC; the source manifest check and
marker/owner/realpath gates remain mandatory.

An uncatchable `SIGKILL`, process crash, or power loss can still leave an
owner-private runner/internal temporary directory and, in the abrupt-process
case, an orphan child. This is an accepted P3 operational limit. Manual
recovery must inspect one exact candidate with the RC runner prefix and validate
its canonical temporary-directory parent, current UID, regular-directory type,
and marker/nonce ownership before removal. Never use a broad recursive removal
or an automatic sweep. No recovery command is implemented in this phase.

All editing, arrangement, export, and website writes target the copy or its
sibling output directory. In `finally`, the harness recomputes the original
manifest before attempting cleanup. Recursive cleanup is allowed only when the
runner parent and temporary root retain their expected realpaths, owners,
prefixes, and directory identities. The marker is opened
`O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; it must be a single-link regular file of
the exact expected size and content. A bounded exact read plus descriptor and
pathname post-read identity checks reject link, type, size, or swap changes. A
failed validation retains the directory and reports only a sanitized boolean.

## Tracks and acceptance

Track A opens the unchanged copy using inferred navigation. It verifies:

- four logical inferred navigation entries, including a group landing, and no
  Arrange action;
- the initial inferred landing is not the 34-heading manuscript, then manual
  selection renders all 34 level-one headings;
- the current inline-SVG safety policy;
- an in-memory search query without printing the token;
- reading-position restore and the dirty-editor cancel/discard guard;
- zero remote HTTP(S) requests;
- safe Phase 8B HTML and Phase 8C two-file website outputs.

The inferred view still demonstrates why preparation is useful: its landing
and physical-file navigation do not expose the manuscript headings as chapters.
Inline SVG is currently stripped. That is safe and remains a visual-fidelity
observation, but it does not block the preparation workflow.

Track B uses the actual **Prepare Book** UI and main-process preparation API.
The isolated copy root is chosen so its basename uniquely matches the
manuscript stem, exercising automatic source selection. It first previews all
34 headings and cancels, proving zero write, then reopens preparation and
creates `SUMMARY.md`. The source manuscript digest must remain unchanged and
the only new copied-book path is `SUMMARY.md`. Its generated links refer to
fragment aliases in the same physical manuscript. It verifies the
first, middle, and last alias by private heading ordinal, active navigation
state, and actual target visibility (including bottom-clamped last-heading
scroll); it also verifies search and reading-position persistence from a
previously empty profile across a new Electron process. The ratio sampled
immediately before close must be near the intended 47%, and the restored ratio
must be within 5 percentage points of that private sample. Outputs must contain
one physical body and all 34 generated navigation aliases. No manual test code
writes the generated SUMMARY.

Arrangement checks cover reorder, Undo, Cancel exact zero-write, and Save. Save
must change the copied SUMMARY bytes and digest. A complete private manifest
taken immediately before Save proves every other copied path, type, size, and
file digest is exactly unchanged, including Markdown, documentation, and
assets. The original manuscript is never split or edited.

If preparation or first/middle/last fragment navigation cannot resolve
reliably, the harness fails with sanitized evidence.

## Privacy contract

Committed code, documentation, logs, and work records must not contain the
original absolute path, prose, titles, search token, screenshots, traces, or
snapshots. Harness status output is limited to fixed aggregate fields; test
assertions receive booleans, counts, and generic numeric measurements rather
than private arrays, buffers, paths, basenames, fragments, tokens, manifests,
raw HTML, or renderer messages/stacks. SHA-256 values are comparison material
held in memory and must not be printed. Failures map to fixed categories.
Screenshots, traces, video, error-context artifacts, and child failure logs are
not retained.
