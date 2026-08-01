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
is_prerelease="${LEAFBOOK_IS_PRERELEASE:-true}"
if [[ "$is_prerelease" != "true" && "$is_prerelease" != "false" ]]; then
  echo "LEAFBOOK_IS_PRERELEASE must be true or false." >&2
  exit 1
fi

if [[ ! -d "$dist_dir" || -L "$dist_dir" || "$dist_dir" != "$repository_root/dist" ]]; then
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
    if [[ "$architecture" != "x64" && "$architecture" != "arm64" ]]; then
      echo "Linux artifact audit requires x64 or arm64." >&2
      exit 1
    fi
    expected=(
      "leafbook-linux-$architecture-$version.AppImage"
      "leafbook-linux-$architecture-$version.deb"
      "leafbook-linux-$architecture-$version.rpm"
      "leafbook-linux-$architecture-$version.tar.gz"
    )
    archive="${expected[3]}"
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
  if [[ "$(wc -c < "$dist_dir/$artifact")" -gt 1073741824 ]]; then
    echo "Artifact exceeds the 1 GiB compressed carrier budget: $artifact" >&2
    exit 1
  fi
done

temporary_base="${TMPDIR:-/tmp}"
temporary_root="$(mktemp -d "${temporary_base%/}/leafbook-platform-audit.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT
reference_manifest_digest=""

preflight_python_archive() {
  local kind="$1"
  local artifact="$2"
  shift 2
  python3 "$repository_root/scripts/run-bounded.py" 60 30 2147483648 -- \
    python3 "$repository_root/scripts/preflight-archive.py" "$kind" "$artifact" "$@"
}

preflight_rpm() {
  local artifact="$1"
  local listing="$temporary_root/rpm-metadata.tsv"
  python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
    rpm -qp --queryformat \
    '[%{FILESIZES}\t%{FILEMODES:perms}\t%{FILENAMES}\t%{FILELINKTOS}\n]' \
    "$artifact" > "$listing"
  node "$repository_root/scripts/preflight-entry-list.mjs" rpm "$listing"
}

preflight_rpm_scriptlets() {
  local artifact="$1"
  local output tag expected_hash interpreter
  for tag in POSTIN POSTUN; do
    output="$temporary_root/rpm-header-$tag.txt"
    python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
      rpm -qp --queryformat "%{$tag}" "$artifact" > "$output"
    if [[ "$tag" == "POSTIN" ]]; then
      expected_hash="186dbbc5713b15cfafdc6b1d74df9ae8d25a396ca00ccd07dbf68266eb033d28"
    else
      expected_hash="6cad66957fed4a5d34f1cce633e7d90184bcd1cc5999f913d134420ffa25a83f"
    fi
    if [[ "$(sha256sum "$output" | awk '{print $1}')" != "$expected_hash" ]]; then
      echo "RPM carrier contains a non-canonical $tag scriptlet." >&2
      exit 1
    fi
    interpreter="$(rpm -qp --queryformat "%{${tag}PROG}" "$artifact")"
    if [[ "$interpreter" != "/bin/sh" ]]; then
      echo "RPM carrier contains a non-canonical ${tag}PROG interpreter." >&2
      exit 1
    fi
  done
  for tag in \
    PREIN PREUN PRETRANS POSTTRANS VERIFYSCRIPT \
    TRIGGERSCRIPTS FILETRIGGERSCRIPTS TRANSFILETRIGGERSCRIPTS; do
    output="$temporary_root/rpm-header-$tag.txt"
    python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
      rpm -qp --queryformat "%{$tag}" "$artifact" > "$output"
    if sed '/^[[:space:]]*$/d; /^(none)$/d' "$output" | grep -q .; then
      echo "RPM carrier contains an unapproved $tag header payload." >&2
      exit 1
    fi
  done
}

preflight_squashfs() {
  local artifact="$1"
  local offset="$2"
  local carrier="$3"
  local safe_carrier="${carrier//[^A-Za-z0-9._-]/_}"
  local listing="$temporary_root/$safe_carrier-squashfs-list.txt"
  python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
    unsquashfs -lln -o "$offset" "$artifact" > "$listing"
  node "$repository_root/scripts/preflight-entry-list.mjs" squashfs "$listing"
}

audit_extracted_tree() {
  local tree="$1"
  local carrier="$2"
  local carrier_kind="$3"
  "$repository_root/scripts/check-safe-artifact-path.sh" directory "$tree" "$temporary_root"
  "$repository_root/scripts/check-no-updater-files.sh" "$tree"
  local layout_json resources_relative resources_directory manifest_digest
  layout_json="$(
    node "$repository_root/scripts/audit-application-layout.mjs" \
      "$platform" "$architecture" "$tree" "$carrier_kind" "$version"
  )"
  resources_relative="$(
    node -e 'process.stdout.write(Buffer.from(JSON.parse(process.argv[1]).resourcesRelativeBase64, "base64"))' \
      "$layout_json"
  )"
  case "$resources_relative" in
    ''|/*|../*|*/../*|*/..)
      echo "$carrier returned an unsafe relative resources directory." >&2
      exit 1
      ;;
  esac
  resources_directory="$tree/$resources_relative"
  manifest_digest="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).manifestDigest)' "$layout_json"
  )"
  if [[ -z "$reference_manifest_digest" ]]; then
    reference_manifest_digest="$manifest_digest"
  elif [[ "$manifest_digest" != "$reference_manifest_digest" ]]; then
    echo "$carrier application tree differs from the first audited carrier." >&2
    exit 1
  fi
  "$repository_root/scripts/check-safe-artifact-path.sh" directory "$resources_directory" "$tree"
  local license_file source
  for license_file in LICENSE NOTICE THIRD-PARTY-LICENSES.txt; do
    case "$license_file" in
      LICENSE) source="$repository_root/LICENSE" ;;
      NOTICE) source="$repository_root/NOTICE" ;;
      THIRD-PARTY-LICENSES.txt)
        source="$repository_root/packages/desktop/build/THIRD-PARTY-LICENSES.txt"
        ;;
    esac
    "$repository_root/scripts/check-safe-artifact-path.sh" regular \
      "$resources_directory/licenses/$license_file" "$tree"
    if ! cmp -s "$source" "$resources_directory/licenses/$license_file"; then
      echo "$carrier contains non-canonical licenses/$license_file." >&2
      exit 1
    fi
  done
  grep -q "MarkText Contributors" "$resources_directory/licenses/LICENSE" || {
    echo "$carrier license is missing the required upstream attribution." >&2
    exit 1
  }
  grep -q "independent derivative project" "$resources_directory/licenses/NOTICE" || {
    echo "$carrier notice is missing the required derivative-project declaration." >&2
    exit 1
  }
  if grep -q '^undefined$' "$resources_directory/licenses/THIRD-PARTY-LICENSES.txt"; then
    echo "$carrier contains an invalid third-party notice body." >&2
    exit 1
  fi

  local asar="$resources_directory/app.asar"
  local safe_carrier="${carrier//[^A-Za-z0-9._-]/_}"
  local asar_listing="$temporary_root/$safe_carrier-asar-list.txt"
  local asar_extract="$temporary_root/$safe_carrier-asar"
  "$repository_root/scripts/check-safe-artifact-path.sh" regular "$asar" "$tree"
  python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
    node "$repository_root/scripts/preflight-asar.mjs" "$asar"
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    node -e \
    'const { listPackage } = require("@electron/asar"); for (const item of listPackage(process.argv[1])) console.log(item)' \
    "$asar" > "$asar_listing"
  "$repository_root/scripts/check-asar-listing-no-updater.sh" "$asar_listing"
  grep -qx '/node_modules/katex/dist/katex.mjs' "$asar_listing" || {
    echo "$carrier ASAR is missing the required KaTeX ESM runtime." >&2
    exit 1
  }
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    node -e \
    'require("@electron/asar").extractAll(process.argv[1], process.argv[2])' \
    "$asar" "$asar_extract"
  node - "$asar_extract/package.json" "$version" "$carrier" <<'NODE'
const fs = require('node:fs')
const [packagePath, expectedVersion, carrier] = process.argv.slice(2)
const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
if (metadata.name !== 'leafbook' || metadata.version !== expectedVersion) {
  throw new Error(`Unexpected ${carrier} metadata: ${metadata.name}@${metadata.version}`)
}
if (metadata.dependencies?.['electron-updater']) {
  throw new Error(`${carrier} metadata contains electron-updater`)
}
if (metadata.author?.name !== 'Jacquesxu666') {
  throw new Error(`Unexpected ${carrier} packaged author: ${metadata.author?.name}`)
}
NODE
  if [[ "$platform" == "windows" ]]; then
    if ! find "$tree" -type f -name 'leafbook.exe' -print -quit | grep -q .; then
      echo "$carrier application tree is missing leafbook.exe." >&2
      exit 1
    fi
  else
    if ! find "$tree" -type f -name 'leafbook' -print -quit | grep -q .; then
      echo "$carrier application tree is missing the leafbook executable." >&2
      exit 1
    fi
  fi
}

extract_linux_squashfs() {
  local artifact="$1"
  local destination="$2"
  local carrier="$3"
  local offset=0
  if [[ "$carrier" == *.AppImage ]]; then
    offset="$(
      python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
        python3 "$repository_root/scripts/find-squashfs-offset.py" "$artifact"
    )"
  fi
  preflight_squashfs "$artifact" "$offset" "$carrier"
  python3 "$repository_root/scripts/run-bounded.py" 60 30 67108864 -- \
    unsquashfs -s -o "$offset" "$artifact" >/dev/null
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    unsquashfs -no-progress -d "$destination" -o "$offset" "$artifact" >/dev/null
}

if [[ "$platform" == "linux" ]]; then
  tar_root="$temporary_root/tar"
  mkdir "$tar_root"
  preflight_python_archive tar "$dist_dir/${expected[3]}"
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    tar -xzf "$dist_dir/${expected[3]}" -C "$tar_root"
  tar_app_root="$tar_root/leafbook-linux-$architecture-$version"
  node - "$tar_root" "$(basename "$tar_app_root")" <<'NODE'
const fs = require('node:fs')
const [root, expected] = process.argv.slice(2)
const entries = fs.readdirSync(root, { withFileTypes: true })
if (
  entries.length !== 1 ||
  entries[0].name !== expected ||
  !entries[0].isDirectory() ||
  entries[0].isSymbolicLink()
) {
  throw new Error('Linux tar carrier requires one canonical versioned application directory')
}
NODE
  "$repository_root/scripts/check-safe-artifact-path.sh" directory "$tar_app_root" "$tar_root"
  audit_extracted_tree "$tar_app_root" "${expected[3]}" archive

  deb_root="$temporary_root/deb"
  expected_deb_arch="$([[ "$architecture" == "x64" ]] && echo amd64 || echo arm64)"
  preflight_python_archive deb "$dist_dir/${expected[1]}" "$version" "$expected_deb_arch"
  dpkg-deb --info "$dist_dir/${expected[1]}" >/dev/null
  [[ "$(dpkg-deb -f "$dist_dir/${expected[1]}" Package)" == "leafbook" ]] || {
    echo "DEB package identity is not leafbook." >&2
    exit 1
  }
  [[ "$(dpkg-deb -f "$dist_dir/${expected[1]}" Version)" == "$version" ]] || {
    echo "DEB package version is not $version." >&2
    exit 1
  }
  [[ "$(dpkg-deb -f "$dist_dir/${expected[1]}" Architecture)" == "$expected_deb_arch" ]] || {
    echo "DEB package architecture is not $expected_deb_arch." >&2
    exit 1
  }
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    dpkg-deb --extract "$dist_dir/${expected[1]}" "$deb_root"
  audit_extracted_tree "$deb_root" "${expected[1]}" deb

  rpm_root="$temporary_root/rpm"
  mkdir "$rpm_root"
  preflight_rpm "$dist_dir/${expected[2]}"
  preflight_rpm_scriptlets "$dist_dir/${expected[2]}"
  rpm -qip "$dist_dir/${expected[2]}" >/dev/null
  [[ "$(rpm -qp --queryformat '%{NAME}' "$dist_dir/${expected[2]}")" == "leafbook" ]] || {
    echo "RPM package identity is not leafbook." >&2
    exit 1
  }
  [[ "$(rpm -qp --queryformat '%{VERSION}' "$dist_dir/${expected[2]}")" == "$version" ]] || {
    echo "RPM package version is not $version." >&2
    exit 1
  }
  expected_rpm_arch="$([[ "$architecture" == "x64" ]] && echo x86_64 || echo aarch64)"
  [[ "$(rpm -qp --queryformat '%{ARCH}' "$dist_dir/${expected[2]}")" == "$expected_rpm_arch" ]] || {
    echo "RPM package architecture is not $expected_rpm_arch." >&2
    exit 1
  }
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    bash -c 'set -euo pipefail; cd "$1"; rpm2cpio "$2" | cpio -idm --quiet' \
    bash "$rpm_root" "$dist_dir/${expected[2]}"
  audit_extracted_tree "$rpm_root" "${expected[2]}" rpm

  appimage_root="$temporary_root/appimage"
  extract_linux_squashfs "$dist_dir/${expected[0]}" "$appimage_root" "${expected[0]}"
  audit_extracted_tree "$appimage_root" "${expected[0]}" appimage
  appimage_desktop="$(find "$appimage_root" -maxdepth 2 -type f -name '*.desktop' -print -quit)"
  "$repository_root/scripts/check-safe-artifact-path.sh" regular "$appimage_desktop" "$appimage_root"
  grep -qx 'Name=LeafBook' "$appimage_desktop" || {
    echo "AppImage desktop entry has a non-canonical name." >&2
    exit 1
  }
  grep -Eq '^Exec=.+$' "$appimage_desktop" || {
    echo "AppImage desktop entry is missing Exec." >&2
    exit 1
  }
  grep -qx 'StartupWMClass=leafbook' "$appimage_desktop" || {
    echo "AppImage desktop entry has a non-canonical StartupWMClass." >&2
    exit 1
  }
  grep -Eq '^MimeType=.*text/markdown' "$appimage_desktop" || {
    echo "AppImage desktop entry is missing the Markdown MIME type." >&2
    exit 1
  }

else
  zip_root="$temporary_root/zip"
  mkdir "$zip_root"
  preflight_python_archive zip "$dist_dir/$archive"
  python3 "$repository_root/scripts/run-bounded.py" 150 120 2147483648 -- \
    python3 "$repository_root/scripts/safe-extract-zip.py" "$dist_dir/$archive" "$zip_root"
  audit_extracted_tree "$zip_root" "$archive" archive

  setup="${expected[0]}"
  node - "$dist_dir/$setup" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const data = fs.readFileSync(file)
if (data.length < 512 || data[0] !== 0x4d || data[1] !== 0x5a) {
  throw new Error('Windows setup carrier is not a valid PE file')
}
const peOffset = data.readUInt32LE(0x3c)
if (peOffset + 4 > data.length || data.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\0\0') {
  throw new Error('Windows setup carrier has no valid PE signature')
}
NODE
  python3 "$repository_root/scripts/run-bounded.py" 120 90 536870912 -- \
    7z t "$dist_dir/$setup" >/dev/null
  if [[ "$is_prerelease" == "false" ]]; then
    echo "Stable release blocked: the NSIS setup carrier still requires an isolated install/uninstall and installed-bundle audit on Windows." >&2
    exit 1
  fi
  echo "Pre-release evidence only: $setup passed PE and container integrity checks, but not installed-bundle validation." >&2
fi

echo "LeafBook $platform $architecture carriers passed the available structural audits."
