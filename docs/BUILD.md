# Building LeafBook

LeafBook's canonical desktop package is `packages/desktop`. Development builds
are not release artifacts:

```bash
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test:unit
```

## Safe local macOS package

The only approved local release-gate package command is:

```bash
pnpm package:mac:unsigned:dir -- --validate-only
pnpm package:mac:unsigned:dir -- --dry-run arm64
pnpm package:mac:unsigned:dir -- build arm64
```

It produces an unpacked, unsigned, unnotarized application directory. The
script fixes `--publish never`, `mac.identity=null`, `mac.notarize=false`, and
`CSC_IDENTITY_AUTO_DISCOVERY=false`. Actual packaging runs under macOS
`sandbox-exec` with network access denied. Tools may consult existing local
caches; an offline cache miss is an honest build failure, not permission to
publish. It never creates a tag or release.

After building:

```bash
pnpm audit:mac-unpacked -- arm64
pnpm smoke:mac:unpacked -- arm64
```

The audit enforces LeafBook identity, license presence, updater runtime and
metadata absence (including bundle-internal `app-update.yml`, `latest*.yml`,
blockmaps, and pending config). Forbidden names are rejected for every
filesystem type—including symlinks and directories—without following links.
The audit also enforces
650 MiB app / 250 MiB ASAR ceilings. These are conservative Phase 8D budgets,
not optimization targets or measurements of the current package. The current
workstation has no successful packaged artifact baseline: packaged audit and
packaged smoke are **NOT RUN**; only the production source build and selected
source smoke currently provide evidence. The smoke command first asks Playwright to list an
anchored six-test selection and fails unless exactly six tests are collected.
Maintainers can verify the identical selection against the source build with
`pnpm smoke:mac:unpacked -- --source`; this does not replace packaged smoke.

Compatibility note: Editor local/relative format links, project-sidebar Trash,
and automatically opening the keyboard-debug dump are disabled until the main
process can issue owner-bound path capabilities. Reader internal chapter links
remain available because their targets come from the validated book session.

DMG/ZIP commands and inherited Windows/Linux commands are development
configuration only. They are not release approval. See
[`RELEASE_GATE.md`](RELEASE_GATE.md).
