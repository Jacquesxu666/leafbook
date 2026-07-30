#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift
fi
release_directory="${1:-dist}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_directory="$(cd "$release_directory" 2>/dev/null && pwd -P || true)"
if [[ -z "$release_directory" || "$release_directory" != "$repository_root/dist" || -L "$repository_root/dist" ]]; then
  echo "Release directory must be the canonical fixed repository dist directory." >&2
  exit 1
fi
if [[ -z "$(find "$release_directory" -maxdepth 1 -type f -print -quit)" ]]; then
  echo "Release directory is empty: $release_directory" >&2
  exit 1
fi

"$repository_root/scripts/check-no-updater-files.sh" "$release_directory"

version="$(node -p "require(process.argv[1]).version" \
  "$repository_root/packages/desktop/package.json")"
expected=(
  "leafbook-linux-$version.AppImage"
  "leafbook-linux-$version.snap"
  "leafbook-linux-$version.deb"
  "leafbook-linux-$version.rpm"
  "leafbook-linux-$version.tar.gz"
  "leafbook-win-x64-$version-setup.exe"
  "leafbook-win-x64-$version.zip"
  "leafbook-win-arm64-$version-setup.exe"
  "leafbook-win-arm64-$version.zip"
  "leafbook-mac-x64-$version.dmg"
  "leafbook-mac-x64-$version.zip"
  "leafbook-mac-arm64-$version.dmg"
  "leafbook-mac-arm64-$version.zip"
)
for artifact in "${expected[@]}"; do
  if [[ ! -f "$release_directory/$artifact" || -L "$release_directory/$artifact" || ! -s "$release_directory/$artifact" ]]; then
    echo "Release set is missing an expected regular non-symlink artifact: $artifact" >&2
    exit 1
  fi
done

unsafe="$(find "$release_directory" -mindepth 1 -maxdepth 1 ! -type f -print)"
if [[ -n "$unsafe" ]]; then
  echo "Release directory contains a symlink, directory, FIFO, device, or other unsafe entry:" >&2
  printf '%s\n' "$unsafe" >&2
  exit 1
fi

actual="$(
  find "$release_directory" -maxdepth 1 -type f ! -name 'SHA256SUMS.txt' \
    -exec basename {} \; | LC_ALL=C sort
)"
expected_sorted="$(printf '%s\n' "${expected[@]}" | LC_ALL=C sort)"
if [[ "$actual" != "$expected_sorted" ]]; then
  echo "Release directory contains an unexpected artifact set." >&2
  diff <(printf '%s\n' "$expected_sorted") <(printf '%s\n' "$actual") >&2 || true
  exit 1
fi

echo "Release file set is complete and contains no updater metadata or blockmaps."
