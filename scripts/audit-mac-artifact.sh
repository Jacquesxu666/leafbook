#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop_package="$repository_root/packages/desktop/package.json"
version="$(node -p "require(process.argv[1]).version" "$desktop_package")"
dist_dir="$repository_root/dist"
"$repository_root/scripts/check-safe-artifact-path.sh" directory "$dist_dir" "$repository_root"
[[ -d "$dist_dir" && ! -L "$dist_dir" && "$(realpath "$dist_dir")" == "$dist_dir" ]] || {
  echo "dist must be a canonical real directory." >&2
  exit 1
}
if [[ "${1:-}" == "--" ]]; then
  shift
fi
architecture="${1:-arm64}"
if [[ "$architecture" != "arm64" && "$architecture" != "x64" ]]; then
  echo "Unsupported macOS architecture: $architecture" >&2
  exit 1
fi
app_directory="mac"
if [[ "$architecture" == "arm64" ]]; then
  app_directory="mac-arm64"
fi
app_path="$dist_dir/$app_directory/LeafBook.app"
zip_path="$dist_dir/leafbook-mac-$architecture-$version.zip"
dmg_path="$dist_dir/leafbook-mac-$architecture-$version.dmg"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/leafbook-artifact-audit.XXXXXX")"
mount_point="$temporary_root/dmg"
mounted=0

cleanup() {
  if [[ "$mounted" == "1" ]]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT

audit_bundle_paths() {
  local bundle="$1"
  local containment="$2"
  "$repository_root/scripts/check-safe-artifact-path.sh" directory "$bundle" "$containment"
  local relative
  for relative in \
    Contents/MacOS/LeafBook \
    Contents/Info.plist \
    Contents/Resources/app.asar \
    Contents/Resources/licenses/LICENSE \
    Contents/Resources/licenses/NOTICE \
    Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt; do
    "$repository_root/scripts/check-safe-artifact-path.sh" regular "$bundle/$relative" "$bundle"
  done
  "$repository_root/scripts/check-no-updater-files.sh" "$bundle"
}

[[ -d "$app_path" && ! -L "$app_path" && "$(realpath "$app_path")" == "$app_path" ]] || {
  echo "Missing or unsafe app bundle: $app_path" >&2
  exit 1
}
audit_bundle_paths "$app_path" "$dist_dir"
for artifact in "$zip_path" "$dmg_path"; do
  [[ -f "$artifact" && ! -L "$artifact" && -s "$artifact" ]] || {
    echo "Missing or unsafe regular artifact: $artifact" >&2
    exit 1
  }
  "$repository_root/scripts/check-safe-artifact-path.sh" regular "$artifact" "$dist_dir"
done

plist="$app_path/Contents/Info.plist"
resources="$app_path/Contents/Resources"
asar="$resources/app.asar"
plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$plist"
}

[[ "$(plist_value CFBundleDisplayName)" == "LeafBook" ]]
[[ "$(plist_value CFBundleName)" == "LeafBook" ]]
[[ "$(plist_value CFBundleExecutable)" == "LeafBook" ]]
[[ "$(plist_value CFBundleIdentifier)" == "com.jacquesxu.leafbook" ]]
[[ "$(plist_value CFBundleShortVersionString)" == "$version" ]]
plist_json="$temporary_root/info.json"
plutil -convert json -o "$plist_json" "$plist"
node - "$plist_json" <<'NODE'
const fs = require('node:fs')
const plist = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const expected = ['md', 'markdown', 'mkd', 'mdwn', 'mdown', 'mdx']
const documentTypes = plist.CFBundleDocumentTypes
if (!Array.isArray(documentTypes) || documentTypes.length !== 1) {
  throw new Error('Info.plist must contain one LeafBook document type')
}
const actual = documentTypes[0].CFBundleTypeExtensions
if (!Array.isArray(actual) || actual.join(',') !== expected.join(',')) {
  throw new Error(`Unexpected Info.plist Markdown extensions: ${actual}`)
}
if (
  documentTypes[0].CFBundleTypeRole !== 'Editor' ||
  documentTypes[0].LSHandlerRank !== 'Alternate'
) {
  throw new Error('Info.plist document type role or handler rank is unsafe')
}
NODE
[[ -s "$resources/licenses/LICENSE" ]]
[[ -s "$resources/licenses/NOTICE" ]]
[[ -s "$resources/licenses/THIRD-PARTY-LICENSES.txt" ]]
grep -q "MarkText Contributors" "$resources/licenses/LICENSE"
grep -q "independent derivative project" "$resources/licenses/NOTICE"
if grep -q '^undefined$' "$resources/licenses/THIRD-PARTY-LICENSES.txt"; then
  echo "Third-party notices contain a literal undefined license body." >&2
  exit 1
fi

asar_listing="$temporary_root/asar-list.txt"
pnpm --filter leafbook exec asar list "$asar" > "$asar_listing"
"$repository_root/scripts/check-asar-listing-no-updater.sh" "$asar_listing"
pnpm --filter leafbook exec asar extract "$asar" "$temporary_root/asar"
node - "$temporary_root/asar/package.json" "$version" <<'NODE'
const fs = require('node:fs')
const [packagePath, expectedVersion] = process.argv.slice(2)
const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
if (metadata.name !== 'leafbook' || metadata.version !== expectedVersion) {
  throw new Error(`Unexpected packaged metadata: ${metadata.name}@${metadata.version}`)
}
if (metadata.dependencies?.['electron-updater']) {
  throw new Error('Packaged metadata contains electron-updater')
}
if (metadata.author?.name !== 'Jacquesxu666') {
  throw new Error(`Unexpected packaged author: ${metadata.author?.name}`)
}
NODE

zip_listing="$temporary_root/zip-list.txt"
unzip -Z1 "$zip_path" > "$zip_listing"
grep -q "LeafBook.app/Contents/Resources/licenses/LICENSE" "$zip_listing"
grep -q "LeafBook.app/Contents/Resources/licenses/NOTICE" "$zip_listing"
grep -q "LeafBook.app/Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt" "$zip_listing"
zip_root="$temporary_root/zip"
mkdir "$zip_root"
unzip -q "$zip_path" -d "$zip_root"
zip_app="$zip_root/LeafBook.app"
[[ -d "$zip_app" && ! -L "$zip_app" ]]
audit_bundle_paths "$zip_app" "$zip_root"

mkdir "$mount_point"
hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_point" -quiet
mounted=1
dmg_app="$mount_point/LeafBook.app"
audit_bundle_paths "$dmg_app" "$mount_point"
[[ -s "$dmg_app/Contents/Resources/licenses/LICENSE" ]]
[[ -s "$dmg_app/Contents/Resources/licenses/NOTICE" ]]
[[ -s "$dmg_app/Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$dmg_app/Contents/Info.plist")" == "com.jacquesxu.leafbook" ]]
hdiutil detach "$mount_point" -quiet
mounted=0

echo "LeafBook app, ZIP, and DMG passed the macOS artifact audit."
