#!/usr/bin/env bash
set -euo pipefail

listing="${1:-}"
[[ -f "$listing" && ! -L "$listing" && -s "$listing" ]] || {
  echo "ASAR listing must be a non-empty regular file: $listing" >&2
  exit 1
}

if grep -Eqi \
  '(^|/)electron-updater(/|$)|(^|/)(app-update\.yml|dev-app-update\.yml|latest[^/]*\.yml|[^/]*\.blockmap|pending[^/]*\.yml)$' \
  "$listing"; then
  echo "Updater runtime or metadata basename is forbidden inside app.asar." >&2
  exit 1
fi
