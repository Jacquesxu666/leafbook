#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop_package="$repository_root/packages/desktop/package.json"
version="$(node -p "require(process.argv[1]).version" "$desktop_package")"
if [[ "${1:-}" == "--" ]]; then
  shift
fi
platform="${1:-}"
architecture="${2:-}"
dist_dir="${3:-$repository_root/dist}"

if [[ ! -d "$dist_dir" || -L "$dist_dir" || "$(realpath "$dist_dir")" != "$repository_root/dist" ]]; then
  echo "Artifact directory must be the canonical fixed repository dist directory." >&2
  exit 1
fi
"$repository_root/scripts/check-safe-artifact-path.sh" directory "$dist_dir" "$repository_root"
if [[ -z "$(find "$dist_dir" -maxdepth 1 -type f -print -quit)" ]]; then
  echo "Artifact directory is empty: $dist_dir" >&2
  exit 1
fi

expected=()
archive=""
case "$platform" in
  linux)
    expected=(
      "leafbook-linux-$version.AppImage"
      "leafbook-linux-$version.snap"
      "leafbook-linux-$version.deb"
      "leafbook-linux-$version.rpm"
      "leafbook-linux-$version.tar.gz"
    )
    archive="${expected[4]}"
    ;;
  windows)
    if [[ "$architecture" != "x64" && "$architecture" != "arm64" ]]; then
      echo "Windows artifact audit requires x64 or arm64." >&2
      exit 1
    fi
    expected=(
      "leafbook-win-$architecture-$version-setup.exe"
      "leafbook-win-$architecture-$version.zip"
    )
    archive="${expected[1]}"
    ;;
  *)
    echo "Usage: audit-platform-artifacts.sh {linux|windows} [x64|arm64] [DIST_DIR]" >&2
    exit 1
    ;;
esac

for artifact in "${expected[@]}"; do
  if [[ ! -f "$dist_dir/$artifact" || -L "$dist_dir/$artifact" || ! -s "$dist_dir/$artifact" ]]; then
    echo "Missing, empty, or unsafe regular $platform artifact: $dist_dir/$artifact" >&2
    exit 1
  fi
  "$repository_root/scripts/check-safe-artifact-path.sh" regular "$dist_dir/$artifact" "$dist_dir"
done

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/leafbook-platform-audit.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT
if [[ "$platform" == "linux" ]]; then
  tar -xzf "$dist_dir/$archive" -C "$temporary_root"
else
  tar -xf "$dist_dir/$archive" -C "$temporary_root"
fi

resources_directory="$(find "$temporary_root" -type d -path '*/resources' -print -quit)"
if [[ -z "$resources_directory" ]]; then
  echo "$archive does not contain an application resources directory." >&2
  exit 1
fi
"$repository_root/scripts/check-safe-artifact-path.sh" directory "$resources_directory" "$temporary_root"
"$repository_root/scripts/check-no-updater-files.sh" "$temporary_root"
for license_file in LICENSE NOTICE THIRD-PARTY-LICENSES.txt; do
  if [[ ! -s "$resources_directory/licenses/$license_file" ]]; then
    echo "$archive is missing licenses/$license_file." >&2
    exit 1
  fi
  "$repository_root/scripts/check-safe-artifact-path.sh" regular \
    "$resources_directory/licenses/$license_file" "$temporary_root"
done
grep -q "MarkText Contributors" "$resources_directory/licenses/LICENSE"
grep -q "independent derivative project" "$resources_directory/licenses/NOTICE"
if grep -q '^undefined$' "$resources_directory/licenses/THIRD-PARTY-LICENSES.txt"; then
  echo "$archive contains an invalid third-party notice body." >&2
  exit 1
fi

asar="$resources_directory/app.asar"
"$repository_root/scripts/check-safe-artifact-path.sh" regular "$asar" "$temporary_root"
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
NODE

if [[ "$platform" == "windows" ]]; then
  find "$temporary_root" -type f -name 'leafbook.exe' -print -quit | grep -q .
else
  find "$temporary_root" -type f -name 'leafbook' -print -quit | grep -q .
fi

echo "LeafBook $platform $architecture artifacts passed identity, license, and updater audits."
