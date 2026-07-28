#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_svg="$repository_root/packages/desktop/build/icons/leafbook.svg"
static_dir="$repository_root/packages/desktop/static"
build_icon_dir="$repository_root/packages/desktop/build/icons"
renderer_image_dir="$repository_root/packages/desktop/src/renderer/src/assets/images"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/leafbook-icons.XXXXXX")"
iconset_dir="$temporary_root/LeafBook.iconset"

trap 'rm -rf "$temporary_root"' EXIT

command -v sips >/dev/null
command -v iconutil >/dev/null

mkdir "$iconset_dir"
sips -s format png "$source_svg" --out "$static_dir/icon.png" >/dev/null
sips -z 512 512 "$static_dir/icon.png" --out "$build_icon_dir/icon.png" >/dev/null
sips -z 256 256 "$static_dir/icon.png" --out "$renderer_image_dir/logo.png" >/dev/null
sips -z 96 96 "$static_dir/icon.png" --out "$static_dir/logo-96px.png" >/dev/null
sips -z 96 96 "$static_dir/icon.png" --out "$static_dir/logo-small.png" >/dev/null

ico_inputs=()
for size in 16 24 32 48 64 128 256; do
  png_path="$temporary_root/icon-${size}.png"
  sips -z "$size" "$size" "$static_dir/icon.png" --out "$png_path" >/dev/null
  ico_inputs+=("$size=$png_path")
done
pnpm tsx "$repository_root/scripts/generateLeafBookIco.ts" \
  "$temporary_root/icon.ico" "${ico_inputs[@]}"

while read -r size filename; do
  sips -z "$size" "$size" "$static_dir/icon.png" --out "$iconset_dir/$filename" >/dev/null
done <<'EOF'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
EOF

iconutil -c icns "$iconset_dir" -o "$temporary_root/icon.icns"
cp "$temporary_root/icon.icns" "$static_dir/icon.icns"
cp "$temporary_root/icon.icns" "$build_icon_dir/icon.icns"
cp "$temporary_root/icon.ico" "$static_dir/icon.ico"
cp "$temporary_root/icon.ico" "$build_icon_dir/icon.ico"

echo "Generated LeafBook icons from $source_svg"
