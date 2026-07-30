#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
architecture="${1:-$(uname -m)}"
case "$architecture" in
  arm64) app_directory="mac-arm64" ;;
  x64) app_directory="mac" ;;
  *) echo "Usage: audit-mac-unpacked.sh [arm64|x64]" >&2; exit 1 ;;
esac
app="$repository_root/dist/$app_directory/LeafBook.app"
resources="$app/Contents/Resources"
asar="$resources/app.asar"
version="$(node -p "require(process.argv[1]).version" "$repository_root/packages/desktop/package.json")"
[[ -d "$repository_root/dist" && ! -L "$repository_root/dist" ]] || {
  echo "dist must be a real directory." >&2
  exit 1
}
[[ -d "$app" && ! -L "$app" ]] || { echo "Missing or unsafe unpacked app: $app" >&2; exit 1; }
[[ "$(realpath "$repository_root/dist")" == "$repository_root/dist" ]]
[[ "$(realpath "$app")" == "$app" ]]
"$repository_root/scripts/check-safe-artifact-path.sh" directory "$app" "$repository_root/dist"
"$repository_root/scripts/check-no-updater-files.sh" "$app"

plist="$app/Contents/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == \
  "com.jacquesxu.leafbook" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$plist")" == "LeafBook" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" == "LeafBook" ]]
for license in LICENSE NOTICE THIRD-PARTY-LICENSES.txt; do
  [[ -s "$resources/licenses/$license" ]] || {
    echo "Missing packaged license: $license" >&2
    exit 1
  }
done
grep -q "MarkText Contributors" "$resources/licenses/LICENSE"
grep -q "independent derivative project" "$resources/licenses/NOTICE"
if grep -q '^undefined$' "$resources/licenses/THIRD-PARTY-LICENSES.txt"; then
  echo "Invalid undefined third-party license body." >&2
  exit 1
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/leafbook-unpacked-audit.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT
pnpm --filter leafbook exec asar list "$asar" > "$temporary_root/asar-list.txt"
"$repository_root/scripts/check-asar-listing-no-updater.sh" "$temporary_root/asar-list.txt"

app_bytes="$(du -sk "$app" | awk '{print $1 * 1024}')"
asar_bytes="$(stat -f '%z' "$asar")"
max_app_bytes=$((650 * 1024 * 1024))
max_asar_bytes=$((250 * 1024 * 1024))
(( app_bytes <= max_app_bytes )) || { echo "App exceeds 650 MiB budget: $app_bytes" >&2; exit 1; }
(( asar_bytes <= max_asar_bytes )) || { echo "ASAR exceeds 250 MiB budget: $asar_bytes" >&2; exit 1; }

node "$repository_root/scripts/mac-audit-receipt.mjs" create "$architecture" "$version"
printf 'LeafBook unpacked macOS audit passed: app=%s bytes, asar=%s bytes.\n' \
  "$app_bytes" "$asar_bytes"
