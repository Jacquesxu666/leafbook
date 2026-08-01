#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
outputs=(
  "packages/desktop/static/icon.icns"
  "packages/desktop/static/icon.ico"
  "packages/desktop/static/icon.png"
  "packages/desktop/build/icons/icon.icns"
  "packages/desktop/build/icons/icon.ico"
  "packages/desktop/build/icons/icon.png"
  "packages/desktop/static/logo-96px.png"
  "packages/desktop/static/logo-small.png"
  "packages/desktop/src/renderer/src/assets/images/logo.png"
)

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "LeafBook icon verification requires macOS sips and iconutil." >&2
  exit 1
fi

hash_outputs() {
  for relative_path in "${outputs[@]}"; do
    shasum -a 256 "$repository_root/$relative_path"
  done
}

bash "$repository_root/scripts/generate-leafbook-icons.sh"
first_hashes="$(hash_outputs)"
# Apple’s sips/iconutil versions can rewrite PNG/ICNS metadata between macOS
# runner images. Validate reproducibility within the same runner instead of
# comparing platform-specific metadata against a checked-in byte hash.
bash "$repository_root/scripts/generate-leafbook-icons.sh"
second_hashes="$(hash_outputs)"

if [[ "$first_hashes" != "$second_hashes" ]]; then
  echo "LeafBook icon generation is not reproducible." >&2
  exit 1
fi

check_png_size() {
  local relative_path="$1"
  local expected="$2"
  local actual
  actual="$(sips -g pixelWidth -g pixelHeight "$repository_root/$relative_path" \
    | awk '/pixelWidth|pixelHeight/ { print $2 }' | paste -sd x -)"
  if [[ "$actual" != "$expected" ]]; then
    echo "$relative_path is $actual; expected $expected." >&2
    exit 1
  fi
}

check_png_size "packages/desktop/static/icon.png" "1024x1024"
check_png_size "packages/desktop/build/icons/icon.png" "512x512"
check_png_size "packages/desktop/static/logo-96px.png" "96x96"
check_png_size "packages/desktop/static/logo-small.png" "96x96"
check_png_size "packages/desktop/src/renderer/src/assets/images/logo.png" "256x256"

file "$repository_root/packages/desktop/static/icon.icns" | grep -q "Mac OS X icon"
file "$repository_root/packages/desktop/static/icon.ico" | grep -q "MS Windows icon resource"
pnpm tsx "$repository_root/scripts/verifyLeafBookIco.ts"
echo "LeafBook icon outputs are reproducible and have the expected formats and sizes."
