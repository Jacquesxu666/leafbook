#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repository_root/scripts/private-root.sh"
desktop_package="$repository_root/packages/desktop/package.json"
version="$(node -p "require(process.argv[1]).version" "$desktop_package")"
dist_dir="${LEAFBOOK_AUDIT_DIST_ROOT:-$repository_root/dist}"
dist_containment="$repository_root"
if [[ -n "${LEAFBOOK_AUDIT_DIST_ROOT:-}" ]]; then
  dist_containment="$(dirname "$dist_dir")"
fi
"$repository_root/scripts/check-safe-artifact-path.sh" directory "$dist_dir" "$dist_containment"
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
leafbook_private_root_create "$repository_root" "artifact-audit"
temporary_root="$LEAFBOOK_PRIVATE_ROOT"
mount_point="$temporary_root/dmg"
mounted=0
attach_attempted=0
reference_tree_hash=""

find_mounted_device() {
  local info_plist="$temporary_root/hdiutil-info.plist"
  python3 "$repository_root/scripts/run-bounded.py" 15 10 67108864 -- \
    hdiutil info -plist > "$info_plist" || return 1
  python3 - "$info_plist" "$dmg_path" <<'PY'
import plistlib
import os
import sys

with open(sys.argv[1], "rb") as source:
    metadata = plistlib.load(source)
expected_image = os.path.realpath(sys.argv[2])
matches = []
for image in metadata.get("images", []):
    if os.path.realpath(image.get("image-path", "")) != expected_image:
        continue
    for entity in image.get("system-entities", []):
        device = entity.get("dev-entry")
        if isinstance(device, str) and device.startswith("/dev/") and "mount-point" not in entity:
            matches.append(device)
if len(matches) != 1:
    raise SystemExit(1)
print(matches[0])
PY
}

cleanup() {
  if [[ "$attach_attempted" == "1" ]]; then
    local mounted_device=""
    mounted_device="$(find_mounted_device || true)"
    if [[ -n "$mounted_device" ]]; then
      python3 "$repository_root/scripts/run-bounded.py" 30 20 67108864 -- \
        hdiutil detach "$mounted_device" -quiet >/dev/null || true
    elif [[ "$mounted" == "1" ]]; then
      # A successful attach must still be detached if hdiutil info is
      # temporarily unavailable during error cleanup.
      python3 "$repository_root/scripts/run-bounded.py" 30 20 67108864 -- \
        hdiutil detach "$mount_point" -quiet >/dev/null || true
    fi
  elif [[ "$mounted" == "1" ]]; then
    python3 "$repository_root/scripts/run-bounded.py" 30 20 67108864 -- \
      hdiutil detach "$mount_point" -quiet >/dev/null || true
  fi
  leafbook_private_root_cleanup "$repository_root"
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
  for relative in Contents/Frameworks Contents/Resources/app.asar.unpacked; do
    "$repository_root/scripts/check-safe-artifact-path.sh" directory "$bundle/$relative" "$bundle"
  done
  "$repository_root/scripts/check-no-updater-files.sh" "$bundle"
}

audit_plist() {
  local bundle="$1"
  local audit_id="$2"
  local plist="$bundle/Contents/Info.plist"
  local plist_json="$temporary_root/info-$audit_id.json"
  plist_value() {
    /usr/libexec/PlistBuddy -c "Print :$1" "$plist"
  }

  [[ "$(plist_value CFBundleDisplayName)" == "LeafBook" ]]
  [[ "$(plist_value CFBundleName)" == "LeafBook" ]]
  [[ "$(plist_value CFBundleExecutable)" == "LeafBook" ]]
  [[ "$(plist_value CFBundleIdentifier)" == "com.jacquesxu.leafbook" ]]
  [[ "$(plist_value CFBundleShortVersionString)" == "$version" ]]
  [[ "$(plist_value CFBundleVersion)" == "$version" ]]
  plutil -convert json -o "$plist_json" "$plist"
  node - "$plist_json" "$audit_id" <<'NODE'
const fs = require('node:fs')
const [plistPath, auditId] = process.argv.slice(2)
const plist = JSON.parse(fs.readFileSync(plistPath, 'utf8'))
const expected = ['md', 'markdown', 'mkd', 'mdwn', 'mdown', 'mdx']
const documentTypes = plist.CFBundleDocumentTypes
if (!Array.isArray(documentTypes) || documentTypes.length !== 1) {
  throw new Error(`${auditId} Info.plist must contain one LeafBook document type`)
}
const documentType = documentTypes[0]
const actual = documentType.CFBundleTypeExtensions
if (!Array.isArray(actual) || actual.join(',') !== expected.join(',')) {
  throw new Error(`Unexpected ${auditId} Info.plist Markdown extensions: ${actual}`)
}
if (
  documentType.CFBundleTypeName !== 'Markdown document' ||
  documentType.CFBundleTypeRole !== 'Editor' ||
  documentType.LSHandlerRank !== 'Alternate'
) {
  throw new Error(`${auditId} Info.plist document association is incomplete or unsafe`)
}
NODE
}

audit_licenses() {
  local bundle="$1"
  local audit_id="$2"
  local licenses="$bundle/Contents/Resources/licenses"
  local relative source
  for relative in LICENSE NOTICE THIRD-PARTY-LICENSES.txt; do
    case "$relative" in
      LICENSE) source="$repository_root/LICENSE" ;;
      NOTICE) source="$repository_root/NOTICE" ;;
      THIRD-PARTY-LICENSES.txt)
        source="$repository_root/packages/desktop/build/THIRD-PARTY-LICENSES.txt"
        ;;
    esac
    if ! cmp -s "$source" "$licenses/$relative"; then
      echo "$audit_id bundle contains non-canonical licenses/$relative." >&2
      exit 1
    fi
  done
  grep -q "MarkText Contributors" "$licenses/LICENSE"
  grep -q "independent derivative project" "$licenses/NOTICE"
  if grep -q '^undefined$' "$licenses/THIRD-PARTY-LICENSES.txt"; then
    echo "$audit_id third-party notices contain a literal undefined license body." >&2
    exit 1
  fi
}

audit_asar_runtime() {
  local bundle="$1"
  local audit_id="$2"
  case "$audit_id" in
    source | zip | dmg) ;;
    *)
      echo "Unsupported ASAR audit identifier: $audit_id" >&2
      exit 1
      ;;
  esac

  local asar="$bundle/Contents/Resources/app.asar"
  local audit_root="$temporary_root/asar-$audit_id"
  local asar_listing="$audit_root/list.txt"
  local extracted_asar="$audit_root/extracted"
  mkdir "$audit_root"
  "$repository_root/scripts/check-safe-artifact-path.sh" directory "$audit_root" "$temporary_root"
  "$repository_root/scripts/check-safe-artifact-path.sh" regular "$asar" "$bundle"

  python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
    node "$repository_root/scripts/preflight-asar.mjs" "$asar"
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    pnpm --filter leafbook exec asar list "$asar" > "$asar_listing"
  "$repository_root/scripts/check-asar-listing-no-updater.sh" "$asar_listing"
  if ! grep -qx '/node_modules/katex/dist/katex.mjs' "$asar_listing"; then
    echo "$audit_id app ASAR is missing the required KaTeX ESM runtime." >&2
    exit 1
  fi
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    pnpm --filter leafbook exec asar extract "$asar" "$extracted_asar"
  node - "$extracted_asar/package.json" "$version" "$audit_id" <<'NODE'
const fs = require('node:fs')
const [packagePath, expectedVersion, auditId] = process.argv.slice(2)
const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
if (metadata.name !== 'leafbook' || metadata.version !== expectedVersion) {
  throw new Error(
    `Unexpected ${auditId} packaged metadata: ${metadata.name}@${metadata.version}`
  )
}
if (metadata.dependencies?.['electron-updater']) {
  throw new Error(`${auditId} packaged metadata contains electron-updater`)
}
if (metadata.author?.name !== 'Jacquesxu666') {
  throw new Error(`Unexpected ${auditId} packaged author: ${metadata.author?.name}`)
}
NODE
}

audit_bundle_invariants() {
  local bundle="$1"
  local containment="$2"
  local audit_id="$3"
  audit_bundle_paths "$bundle" "$containment"
  audit_plist "$bundle" "$audit_id"
  audit_licenses "$bundle" "$audit_id"
  audit_asar_runtime "$bundle" "$audit_id"
  node "$repository_root/scripts/audit-native-tree.mjs" \
    macos "$architecture" "$bundle" true >/dev/null
  local tree_hash
  tree_hash="$(
    node --input-type=module - \
      "$repository_root/scripts/mac-audit-receipt.mjs" \
      "$containment" "$bundle" "$architecture" "$version" <<'NODE'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
const [modulePath, containment, bundle, architecture, version] = process.argv.slice(2)
const { buildReceipt } = await import(`file://${modulePath}`)
const distRoot = await fs.realpath(containment)
const appRelative = path.relative(distRoot, await fs.realpath(bundle))
const receipt = await buildReceipt({ distRoot, appRelative, architecture, version })
process.stdout.write(createHash('sha256').update(JSON.stringify(receipt.tree)).digest('hex'))
NODE
  )"
  if [[ "$audit_id" == "source" ]]; then
    reference_tree_hash="$tree_hash"
  elif [[ "$tree_hash" != "$reference_tree_hash" ]]; then
    echo "$audit_id complete application tree differs from the audited source bundle." >&2
    exit 1
  fi
}

[[ -d "$app_path" && ! -L "$app_path" && "$(realpath "$app_path")" == "$app_path" ]] || {
  echo "Missing or unsafe app bundle: $app_path" >&2
  exit 1
}
audit_bundle_invariants "$app_path" "$dist_dir" source
for artifact in "$zip_path" "$dmg_path"; do
  [[ -f "$artifact" && ! -L "$artifact" && -s "$artifact" ]] || {
    echo "Missing or unsafe regular artifact: $artifact" >&2
    exit 1
  }
  "$repository_root/scripts/check-safe-artifact-path.sh" regular "$artifact" "$dist_dir"
  if [[ "$(wc -c < "$artifact")" -gt 1073741824 ]]; then
    echo "macOS carrier exceeds the 1 GiB compressed-size budget: $artifact" >&2
    exit 1
  fi
done

zip_listing="$temporary_root/zip-list.txt"
python3 "$repository_root/scripts/preflight-archive.py" zip "$zip_path"
unzip -Z1 "$zip_path" > "$zip_listing"
grep -q "LeafBook.app/Contents/Resources/licenses/LICENSE" "$zip_listing"
grep -q "LeafBook.app/Contents/Resources/licenses/NOTICE" "$zip_listing"
grep -q "LeafBook.app/Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt" "$zip_listing"
zip_root="$temporary_root/zip"
mkdir "$zip_root"
python3 "$repository_root/scripts/run-bounded.py" 150 120 2147483648 -- \
  python3 "$repository_root/scripts/safe-extract-zip.py" "$zip_path" "$zip_root"
node "$repository_root/scripts/audit-mac-carrier.mjs" zip "$zip_root"
zip_app="$zip_root/LeafBook.app"
[[ -d "$zip_app" && ! -L "$zip_app" ]]
audit_bundle_invariants "$zip_app" "$zip_root" zip

mkdir "$mount_point"
python3 "$repository_root/scripts/run-bounded.py" 120 90 67108864 -- \
  hdiutil verify "$dmg_path" >/dev/null
attach_attempted=1
python3 "$repository_root/scripts/run-bounded.py" 120 90 67108864 -- \
  hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_point" -quiet
mounted=1
node "$repository_root/scripts/audit-mac-carrier.mjs" dmg "$mount_point"
dmg_app="$mount_point/LeafBook.app"
audit_bundle_invariants "$dmg_app" "$mount_point" dmg
mounted_device="$(find_mounted_device || true)"
if [[ -z "$mounted_device" ]]; then
  echo "Unable to resolve the mounted DMG device." >&2
  exit 1
fi
python3 "$repository_root/scripts/run-bounded.py" 30 20 67108864 -- \
  hdiutil detach "$mounted_device" -quiet
mounted=0
attach_attempted=0

echo "LeafBook app, ZIP, and DMG passed the macOS artifact audit."
