#!/usr/bin/env bash

leafbook_private_root_create() {
  local repository_root="$1"
  local label="$2"
  local created token identity
  created="$(mktemp -d "${TMPDIR:-/tmp}/leafbook-package-${label}-XXXXXXXX")"
  LEAFBOOK_PRIVATE_ROOT="$(cd "$created" && pwd -P)"
  chmod 700 "$LEAFBOOK_PRIVATE_ROOT"
  token="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  LEAFBOOK_PRIVATE_TOKEN="$token"
  LEAFBOOK_PRIVATE_MARKER="$LEAFBOOK_PRIVATE_ROOT/.leafbook-package-owner"
  PRIVATE_MARKER="$LEAFBOOK_PRIVATE_MARKER" PRIVATE_TOKEN="$token" node -e \
    "require('node:fs').writeFileSync(process.env.PRIVATE_MARKER, process.env.PRIVATE_TOKEN, {flag:'wx',mode:0o600})"
  mkdir -p "$repository_root/dist/audit"
  chmod 700 "$repository_root/dist/audit"
  LEAFBOOK_PRIVATE_STATE="$repository_root/dist/audit/.leafbook-private-root-${token}.json"
  identity="$(
    node "$repository_root/scripts/package-private-snapshot.mjs" root-state-create \
      "$LEAFBOOK_PRIVATE_ROOT" "$token" "$LEAFBOOK_PRIVATE_STATE"
  )"
  IFS=$'\t' read -r \
    LEAFBOOK_PRIVATE_STATE_HASH \
    LEAFBOOK_PRIVATE_DEV \
    LEAFBOOK_PRIVATE_INO \
    LEAFBOOK_PRIVATE_UID \
    LEAFBOOK_PRIVATE_MODE <<< "$identity"
}

leafbook_private_root_cleanup() {
  local repository_root="$1"
  node "$repository_root/scripts/package-private-snapshot.mjs" cleanup \
    "$LEAFBOOK_PRIVATE_ROOT" "$LEAFBOOK_PRIVATE_TOKEN" \
    "$LEAFBOOK_PRIVATE_DEV" "$LEAFBOOK_PRIVATE_INO" \
    "$LEAFBOOK_PRIVATE_UID" "$LEAFBOOK_PRIVATE_MODE" \
    "$LEAFBOOK_PRIVATE_STATE" "$LEAFBOOK_PRIVATE_STATE_HASH"
}
