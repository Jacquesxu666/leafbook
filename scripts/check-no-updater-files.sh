#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
[[ -d "$target" ]] || { echo "Updater audit target is not a directory: $target" >&2; exit 1; }

matches_file="$(mktemp "${TMPDIR:-/tmp}/leafbook-updater-matches.XXXXXX")"
trap 'rm -f "$matches_file"' EXIT
# find does not follow symlinks by default. Deliberately omit a type predicate:
# a forbidden updater name is rejected whether it is a regular file, symlink,
# FIFO/device, or directory. NUL output preserves every legal pathname.
find "$target" \
  \( -iname 'app-update.yml' \
     -o -iname 'dev-app-update.yml' \
     -o -iname 'latest*.yml' \
     -o -iname '*.blockmap' \
     -o -iname 'pending.yml' \
     -o -iname 'pending-update.yml' \) \
  -print0 > "$matches_file"
if [[ -s "$matches_file" ]]; then
  echo "Updater runtime metadata/config is forbidden inside packaged output:" >&2
  while IFS= read -r -d '' match; do
    printf '  %q\n' "$match" >&2
  done < "$matches_file"
  exit 1
fi
