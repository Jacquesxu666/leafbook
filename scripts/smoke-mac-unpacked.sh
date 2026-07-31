#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--" ]]; then
  shift
fi

expected_titles=(
  "opening untrusted Markdown stays offline, renders local images, and does not execute HTML"
  "Reader keeps local and remote images as inert placeholders without filesystem or network loads"
  "open book, navigate chapters, return to bookshelf, and preserve editor flow"
  "Reader displays four safe local image formats without path or network exposure"
  "Reader displays sanitized local SVG while malicious SVG stays inert and offline"
  "real keyboard input becomes dirty, saves through IPC, and matches disk bytes"
  "arranges an existing SUMMARY with keyboard, buttons, undo, save and zero-write cancel"
  "exports one offline HTML book with scoped Chinese heading navigation"
  "generates an exact two-file offline website whose manifest hashes the loaded HTML"
  "exports offline book images as embedded data and hashed website assets"
  "recovers a private Prepare draft only after explicit restore and keeps books isolated"
)
selection='('
separator=''
for title in "${expected_titles[@]}"; do
  selection+="$separator$title"
  separator='|'
done
selection+=')$'

verify_listing() {
  local listing="$1"
  if ! grep -Eq '^Total: 11 tests in [123] files$' <<<"$listing"; then
    echo "Release smoke selection must resolve to exactly eleven tests." >&2
    return 1
  fi
  local title
  for title in "${expected_titles[@]}"; do
    if [[ "$(grep -Fc "› $title" <<<"$listing")" != "1" ]]; then
      echo "Release smoke selection is missing or duplicates: $title" >&2
      return 1
    fi
  done
}

# Static/unit tests can exercise the fail-closed parser without launching
# Electron or substituting a fake pnpm binary.
if [[ "${1:-}" == "--check-list" ]]; then
  [[ -f "${2:-}" ]] || { echo "Missing Playwright listing fixture." >&2; exit 1; }
  [[ "$(stat -f '%z' "$2")" -le 65536 ]] || { echo "Listing fixture is too large." >&2; exit 1; }
  verify_listing "$(<"$2")"
  exit
fi

mode="packaged"
architecture="${1:-$(uname -m)}"
if [[ "$architecture" == "--source" ]]; then
  mode="source"
else
  case "$architecture" in
    arm64) app_directory="mac-arm64" ;;
    x64) app_directory="mac" ;;
    *) echo "Usage: smoke-mac-unpacked.sh [arm64|x64|--source]" >&2; exit 1 ;;
  esac
fi

# Keep this anchored to complete current titles. Before launching anything,
# Playwright's own collector must prove both the exact title set and count.
test_args=(
  test/e2e/renderer-security.spec.ts \
  test/e2e/book-reader.spec.ts \
  test/e2e/representative-blocks-roundtrip.spec.ts \
  --grep "$selection" \
  --workers=1
)
listing="$(pnpm --filter leafbook exec playwright test "${test_args[@]}" --list)"
printf '%s\n' "$listing"
verify_listing "$listing"

if [[ "$mode" == "packaged" ]]; then
  executable="$repository_root/dist/$app_directory/LeafBook.app/Contents/MacOS/LeafBook"
  version="$(node -p "require(process.argv[1]).version" "$repository_root/packages/desktop/package.json")"
  # The fixed receipt binds the canonical bundle and its complete content tree.
  # Verification re-enumerates directories and symlinks and rehashes every
  # regular file immediately before launch; no renderer-supplied wrapper,
  # added helper/resource, deletion, or substituted executable is accepted.
  node "$repository_root/scripts/mac-audit-receipt.mjs" verify "$architecture" "$version"
  [[ -x "$executable" && ! -L "$executable" && "$(realpath "$executable")" == "$executable" ]] || {
    echo "Missing or unsafe packaged executable: $executable" >&2
    exit 1
  }
  export LEAFBOOK_E2E_EXECUTABLE="$executable"
else
  unset LEAFBOOK_E2E_EXECUTABLE
fi

pnpm --filter leafbook exec playwright test "${test_args[@]}"
