#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repository_root/scripts/private-root.sh"
if [[ "${1:-}" == "--" ]]; then
  shift
fi
mode="${1:-build}"
architecture="${2:-$(uname -m)}"
if [[ "$architecture" != "arm64" && "$architecture" != "x64" ]]; then
  echo "Unsupported macOS architecture: $architecture" >&2
  exit 1
fi

builder_args=(
  electron-builder
  --mac
  dir
  "--$architecture"
  --publish
  never
  -c.mac.identity=null
  -c.mac.notarize=false
)
private_root=""
private_token=""
electron_archive_state=""
electron_archive_state_hash=""

ensure_private_root() {
  [[ -z "$private_root" ]] || return 0
  leafbook_private_root_create "$repository_root" "builder"
  private_root="$LEAFBOOK_PRIVATE_ROOT"
  private_token="$LEAFBOOK_PRIVATE_TOKEN"
}

cleanup_private_root() {
  local status=$?
  trap - EXIT
  if [[ -n "$private_root" ]]; then
    if ! leafbook_private_root_cleanup "$repository_root"; then
      echo "Private package snapshot cleanup could not be proven." >&2
      exit 1
    fi
  fi
  exit "$status"
}
trap cleanup_private_root EXIT

configure_verified_electron_dist() {
  local requested="${LEAFBOOK_ELECTRON_DIST:-}"
  [[ -n "$requested" ]] || return 0
  if [[ "$requested" != /* || ! -f "$requested" || -L "$requested" ]]; then
    echo "LEAFBOOK_ELECTRON_DIST must be an absolute regular non-symlink file." >&2
    exit 1
  fi
  local canonical_directory
  canonical_directory="$(cd "$(dirname "$requested")" && pwd -P)"
  local canonical="$canonical_directory/$(basename "$requested")"
  if [[ "$canonical" != "$requested" ]]; then
    echo "LEAFBOOK_ELECTRON_DIST must already be canonical." >&2
    exit 1
  fi
  local electron_version expected_name expected_hash actual_hash
  electron_version="$(
    cd "$repository_root"
    node -e "process.stdout.write(require('electron/package.json').version)"
  )"
  expected_name="electron-v${electron_version}-darwin-${architecture}.zip"
  if [[ "$(basename "$canonical")" != "$expected_name" ]]; then
    echo "LEAFBOOK_ELECTRON_DIST does not match the selected Electron version/architecture." >&2
    exit 1
  fi
  expected_hash="$(
    cd "$repository_root"
    ELECTRON_ARCHIVE_NAME="$expected_name" node -e \
      "process.stdout.write(require('electron/checksums.json')[process.env.ELECTRON_ARCHIVE_NAME] || '')"
  )"
  if [[ -z "$expected_hash" ]]; then
    echo "LEAFBOOK_ELECTRON_DIST checksum does not match the installed Electron manifest." >&2
    exit 1
  fi
  ensure_private_root
  local archive_directory archive_copy
  archive_directory="$private_root/electron"
  mkdir -m 700 "$archive_directory"
  archive_copy="$archive_directory/$expected_name"
  electron_archive_state="$private_root/electron-archive-state.json"
  electron_archive_state_hash="$(
    node "$repository_root/scripts/package-private-snapshot.mjs" archive-copy \
      "$canonical" "$archive_copy" "$expected_name" "$expected_hash" \
      "$electron_version" "$architecture" "$electron_archive_state"
  )"
  builder_args+=("-c.electronDist=$archive_copy")
  printf 'Validated and privately snapshotted the local Electron archive.\n'
}

validate() {
  grep -q '^productName: LeafBook$' "$repository_root/packages/desktop/electron-builder.yml"
  grep -q '^  notarize: false$' "$repository_root/packages/desktop/electron-builder.yml"
  if rg -n '"electron-updater"|electron-updater' \
    "$repository_root/packages/desktop/package.json" \
    "$repository_root/packages/desktop/electron-builder.yml" >/dev/null; then
    echo "Updater dependency/config is forbidden for the unsigned local package." >&2
    exit 1
  fi
  printf 'Validated unsigned package invariants: publish=never, identity=null, notarize=false, auto-discovery=false.\n'
}

validate
case "$mode" in
  --validate-only)
    exit 0
    ;;
  --dry-run)
    printf 'Would run with CSC_IDENTITY_AUTO_DISCOVERY=false:\n'
    printf '  %q' pnpm --filter leafbook exec "${builder_args[@]}"
    printf '\n'
    exit 0
    ;;
  build)
    configure_verified_electron_dist
    ;;
  carriers)
    ;;
  *)
    echo "Usage: package-mac-unsigned-dir.sh [build|carriers|--dry-run|--validate-only] [arm64|x64]" >&2
    exit 1
    ;;
esac

cat >&2 <<'WARNING'
LeafBook will build an UNSIGNED, UNNOTARIZED local .app directory.
Publishing is disabled. The build runs under the macOS sandbox with all network
access denied. electron-builder/electron-rebuild may consult existing local
caches, but an offline cache miss will fail honestly.
Use --dry-run or --validate-only when no build/cache access is desired.
WARNING

if [[ "$(uname -s)" != "Darwin" || ! -x /usr/bin/sandbox-exec ]]; then
  echo "A real unsigned package requires macOS sandbox-exec for network denial." >&2
  exit 1
fi
# tsx uses a local Unix-domain IPC listener, so allow bind/listen while
# continuing to deny every outbound network operation. Package downloads need
# network-outbound and therefore fail closed.
offline_profile='(version 1)(allow default)(deny network*)(allow network-bind)'
run_offline() {
  /usr/bin/sandbox-exec -p "$offline_profile" "$@"
}

export CSC_IDENTITY_AUTO_DISCOVERY=false
if [[ "$mode" == "carriers" ]]; then
  version="$(
    cd "$repository_root"
    node -e "process.stdout.write(require('./packages/desktop/package.json').version)"
  )"
  node "$repository_root/scripts/mac-audit-receipt.mjs" verify "$architecture" "$version"
  app_directory="$([[ "$architecture" == "arm64" ]] && printf 'mac-arm64' || printf 'mac')"
  app_relative="$app_directory/LeafBook.app"
  ensure_private_root
  snapshot_app="$private_root/app-snapshot/LeafBook.app"
  snapshot_state="$private_root/app-snapshot-state.json"
  snapshot_state_hash="$(
    node "$repository_root/scripts/package-private-snapshot.mjs" app-copy \
      "$repository_root/dist" "$app_relative" "$architecture" "$version" \
      "$snapshot_app" "$snapshot_state"
  )"
  run_offline pnpm --filter leafbook exec electron-builder \
    --mac dmg zip \
    "--$architecture" \
    --publish never \
    --prepackaged "$snapshot_app" \
    -c.mac.identity=null \
    -c.mac.notarize=false
  node "$repository_root/scripts/package-private-snapshot.mjs" app-verify \
    "$snapshot_state" "$snapshot_state_hash"
  zip_path="$repository_root/dist/leafbook-mac-${architecture}-${version}.zip"
  dmg_path="$repository_root/dist/leafbook-mac-${architecture}-${version}.dmg"
  audit_root="$private_root/audited-dist"
  audit_state="$private_root/audited-artifacts-state.json"
  audit_state_hash="$(
    node "$repository_root/scripts/package-private-snapshot.mjs" audit-copy \
      "$repository_root/dist" "$app_relative" "$architecture" "$version" \
      "$zip_path" "$dmg_path" "$audit_root" "$audit_state"
  )"
  LEAFBOOK_AUDIT_DIST_ROOT="$audit_root" \
    bash "$repository_root/scripts/audit-mac-artifact.sh" "$architecture"
  node "$repository_root/scripts/package-private-snapshot.mjs" audit-verify \
    "$audit_state" "$audit_state_hash"
  node "$repository_root/scripts/package-private-snapshot.mjs" app-verify \
    "$snapshot_state" "$snapshot_state_hash"
  node "$repository_root/scripts/mac-audit-receipt.mjs" verify "$architecture" "$version"
  exit 0
fi
run_offline pnpm --filter leafbook minify-locales
run_offline pnpm --filter leafbook rebuild-native
run_offline pnpm --filter leafbook build
run_offline pnpm --filter leafbook exec "${builder_args[@]}"
if [[ -n "$electron_archive_state" ]]; then
  node "$repository_root/scripts/package-private-snapshot.mjs" archive-verify \
    "$electron_archive_state" "$electron_archive_state_hash"
fi
