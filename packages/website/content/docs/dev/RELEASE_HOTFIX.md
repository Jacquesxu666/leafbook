# Preparing a LeafBook hotfix

A hotfix is a patch release made from the exact stable LeafBook release that
needs correction. This page covers only the hotfix-specific branch workflow.
Follow the canonical [LeafBook release process](RELEASE.md) for versioning,
validation, tagging, CI, publishing, and post-release verification.

## 1. Create the hotfix branch

Fetch tags and branch from the stable tag being repaired:

```bash
git fetch origin --tags
git switch -c hotfix/vX.Y.Z vX.Y.PREVIOUS
```

`X.Y.Z` is the new patch version and `vX.Y.PREVIOUS` is the published release
that needs the fix. Apply the smallest safe change. If the fix already exists
on another branch, cherry-pick its reviewed commit:

```bash
git cherry-pick <full-commit-hash>
```

Resolve conflicts, review the complete diff, and run the relevant tests before
continuing.

## 2. Prepare and publish the patch release

Use `packages/desktop/package.json` as the single source of truth for the
LeafBook version. The pushed tag must exactly equal `v` plus that desktop
package version; the release workflow rejects any mismatch.

Then follow [RELEASE.md](RELEASE.md) from **Set the desktop version** through
**After publishing**. Do not copy the normal release checklist into this file:
the canonical document defines the current metadata mirrors, local gates,
tagging commands, and verification steps.

The current workflow contract is:

- five platform build jobs;
- exactly 13 installers and archives, plus `SHA256SUMS.txt` in the published
  GitHub Release;
- no `latest*.yml`, `.blockmap`, or other automatic-update metadata in the
  release set;
- no `electron-updater` dependency in the packaged application.

Do not bypass these gates for a hotfix. LeafBook has no approved automatic
update channel, so a patch release must not introduce updater metadata,
`electron-updater`, or an inherited MarkText update path.

## 3. Reconcile the fix

After the hotfix is published and verified, apply the fix to active development
branches if they do not already contain it. Prefer a normal reviewed merge or a
cherry-pick of the released fix so the patch cannot regress in the next
LeafBook release.
