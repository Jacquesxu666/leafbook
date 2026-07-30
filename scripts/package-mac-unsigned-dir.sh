#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
    ;;
  *)
    echo "Usage: package-mac-unsigned-dir.sh [build|--dry-run|--validate-only] [arm64|x64]" >&2
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
run_offline pnpm --filter leafbook minify-locales
run_offline pnpm --filter leafbook rebuild-native
run_offline pnpm --filter leafbook build
run_offline pnpm --filter leafbook exec "${builder_args[@]}"
