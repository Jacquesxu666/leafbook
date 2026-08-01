# Formal release checklist

Every checkbox is fail-closed. A workflow definition, skipped job, local result,
or stale artifact is not evidence for another commit or platform.

## Source and metadata

- [ ] Release tag exactly matches `packages/desktop/package.json` and resolves
      to the reviewed commit.
- [ ] Frozen install, lint, desktop/Muya typechecks, complete unit suites,
      production build, and Electron E2E pass on retained CI runs.
- [ ] Generated metadata, icons, canonical licenses, and third-party notices are
      unchanged after regeneration.
- [ ] `docs/RELEASE_NOTES.md` passes `pnpm verify:release-notes` and accurately
      states security, privacy, compatibility, and known limitations.

## Supply chain

- [ ] Derive `SOURCE_DATE_EPOCH` from the exact reviewed commit with Git's `%ct`
      format. Missing, malformed, zero, or out-of-range epochs fail closed.
- [ ] SBOM generation succeeds from that commit and frozen graph; every transitive
      license is allowed or hash-bound to a reviewed override. See the exact local
      command in `BUILD.md`.
- [ ] The SPDX 2.3 SBOM is reviewed for scope, versions, licenses, and exceptions.
- [ ] Repeating the SBOM command with the same epoch produces byte-identical output.
      Its namespace hashes canonical JSON for every emitted field except the
      namespace itself: any payload change changes it, while source-only changes
      with identical output do not.
- [ ] `SHA256SUMS.txt` is generated only after the candidate is complete and
      immediately passes `node scripts/release-checksums.mjs verify <candidate>`.
- [ ] GitHub build-provenance and SBOM attestations bind the exact manifest and
      artifacts to the reviewed commit and workflow.
- [ ] The SBOM attestation uses a dedicated checksum manifest containing only the
      exact 16 audited carriers. Neither the SBOM nor release notes are subjects.
- [ ] Every downloaded artifact passes its checksum and `gh attestation verify`.

## Native platform evidence

- [ ] The protected `windows-signing` job builds x64 and arm64 exactly once with
      step-scoped signing inputs sourced only from secrets on that GitHub
      Environment and `--publish never`; fresh jobs download the same bytes and
      verify the retained checksums.
- [ ] Windows Authenticode status and expected signer pass for setup and installed
      executable; silent NSIS defaults to no associations/protocols, installed
      launch and shortcuts pass, and uninstall leaves no executable/integration
      residue. The fixed receipt binds every result to tag, commit, runner and hashes.
- [ ] Linux x64 (`ubuntu-24.04`) and arm64 (`ubuntu-24.04-arm`) each build exactly
      AppImage, deb, rpm and tar.gz once; fresh jobs validate the same bytes.
- [ ] AppImage execution, real tar extract/run/remove, deb install/launch/MIME/
      purge, and pinned-Fedora `dnf install`/Xvfb smoke/`dnf remove` all pass.
      `rpm --nodeps` or extraction on Ubuntu is never accepted as RPM lifecycle evidence.
- [ ] The Linux receipt records the reviewed multiarch Fedora digest and the
      architecture-specific resolved image ID from the successful RPM job.
- [ ] Every Linux lifecycle contains four distinct observations written only
      after install, smoke, uninstall, and residue checks; missing, duplicate,
      failed, or runner/image-inconsistent observations fail closed.
- [ ] Release assembly downloads the same candidate artifacts that produced the
      native receipts, rebinds each receipt to the release tag and commit,
      recomputes every carrier hash, and stages only those verified bytes.
- [ ] Protected macOS x64 and arm64 jobs receive only the five explicit Apple
      secrets stored on the `macos-signing` GitHub Environment,
      build/sign/notarize with `--publish never`, and never install or launch a
      candidate.
- [ ] Separate fresh no-secret macOS jobs download the exact signed bytes and pass
      checksums, Developer ID signature, stapling, Gatekeeper, carrier/tree audits,
      packaged smoke, `/Applications` install/launch, cleanup, and fixed receipt.

## Approval and publication

- [ ] Required Apple secrets are Environment-level secrets on the protected
      `macos-signing` GitHub Environment, not repository-level secrets; logs
      expose only variable names when missing, never credential values.
- [ ] Required Windows certificate secrets are Environment-level secrets on the
      protected `windows-signing` GitHub Environment, not repository-level
      secrets; fresh validation jobs receive no signing secret.
- [ ] Reusable-workflow callers pass no signing secrets and declare no
      `workflow_call.secrets` signing contract. GitHub Environment secrets are
      resolved by jobs that name the protected Environment and cannot be passed
      through the caller workflow's `secrets` mapping.
- [ ] The `windows-signing`, `macos-signing`, and `release` GitHub Environments
      each have `Jacquesxu666` configured as a required reviewer.
- [ ] In the current personal-project release mode, the `release` Environment
      deliberately has **Prevent self-review** disabled
      (`prevent_self_review=false`), so its owner can approve the deployment.
      Its deployment branch/tag policy must still allow only the reviewed
      release-tag path (selected tags matching `v*`, with branch deployment
      denied). Merely creating the Environment without the required reviewer or
      this tag-only policy is not protection and blocks a formal release.
- [ ] If the project becomes multi-person, enable **Prevent self-review** and
      replace the personal approval model with at least one independent required
      reviewer before the next formal release.
- [ ] Action SHAs, least-privilege permissions, tag protection, environment
      protection, and the candidate-to-release asset mapping receive human review.
- [ ] The draft contains the verified formal release notes. Its public asset set
      is exactly 16 tag/version-derived carriers plus `SHA256SUMS.txt`; SBOM and
      notes remain separately retained evidence.
- [ ] The write job uploads only its exclusive read-only final snapshot. The
      saved file/directory identity record and every digest are reverified in the
      same shell, then the server tag target and release absence are rechecked
      immediately before `gh release create`; no `candidate/dist` glob reaches
      the upload command.
- [ ] The final state bytes match the snapshot-building step's SHA-256 output in
      constant time. The verifier independently reconstructs the exact 16-carrier
      and exact two-file metadata manifests plus the channel-specific notes body;
      replacing both snapshot and state cannot establish a new trusted digest.
- [ ] Protected tags prevent retargeting during the unavoidable remote
      check/create micro-window. The separately documented same-UID pathname
      mutation P3 remains accepted until uploads can be descriptor-based.
- [ ] The release remains a draft until an authorized human approves every
      retained evidence item above.
- [ ] Publication, signing, notarization, tags, and release edits are performed
      only by their explicitly reviewed workflow or operator; local verification
      commands never perform them.
