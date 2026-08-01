#!/usr/bin/env bash
set -euo pipefail

kind="${1:-}"
target="${2:-}"
containment="${3:-}"
[[ -n "$target" && -n "$containment" ]] || {
  echo "Usage: check-safe-artifact-path.sh {directory|regular} PATH CONTAINMENT_ROOT" >&2
  exit 1
}
[[ -d "$containment" && ! -L "$containment" ]] || {
  echo "Containment root is not a real directory: $containment" >&2
  exit 1
}
canonical_root="$(realpath "$containment")"

case "$kind" in
  directory)
    [[ -d "$target" && ! -L "$target" ]] || {
      echo "Unsafe directory artifact path: $target" >&2
      exit 1
    }
    ;;
  regular)
    [[ -f "$target" && ! -L "$target" && -s "$target" ]] || {
      echo "Unsafe non-regular, empty, or symlink artifact path: $target" >&2
      exit 1
    }
    ;;
  *)
    echo "Unknown safe-path kind: $kind" >&2
    exit 1
    ;;
esac

canonical_target="$(realpath "$target")"
case "$canonical_target" in
  "$canonical_root"|"$canonical_root"/*) ;;
  *)
    echo "Artifact path escapes containment: $target" >&2
    exit 1
    ;;
esac
canonical_parent="$(realpath "$(dirname "$target")")"
[[ "$canonical_target" == "$canonical_parent/$(basename "$target")" ]] || {
  echo "Artifact path contains a symlink component: $target" >&2
  exit 1
}
