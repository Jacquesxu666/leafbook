#!/usr/bin/env python3
"""Fail-closed archive metadata budget check. This never extracts payload bytes."""

import hashlib
import io
import os
import posixpath
import stat
import sys
import tarfile
import zipfile

MAX_ENTRIES = 100_000
MAX_DEPTH = 128
MAX_PATH_BYTES = 4096
MAX_ENTRY_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
DEB_ALLOWED_FIELDS = {
    "Package",
    "Version",
    "License",
    "Vendor",
    "Architecture",
    "Maintainer",
    "Installed-Size",
    "Depends",
    "Recommends",
    "Section",
    "Priority",
    "Homepage",
    "Description",
}
DEB_REQUIRED_FIELDS = {
    "Package",
    "Version",
    "License",
    "Vendor",
    "Architecture",
    "Maintainer",
    "Installed-Size",
    "Depends",
    "Recommends",
    "Section",
    "Priority",
    "Homepage",
    "Description",
}
DEB_MAINTAINER_SCRIPT_SHA256 = {
    "postinst": "b41f43732ac478993a67a156ead287b6bfbeb72b2bbabc5fbbb7fbb618e90cb6",
    "postrm": "6cad66957fed4a5d34f1cce633e7d90184bcd1cc5999f913d134420ffa25a83f",
}
DEB_DEPENDS = (
    "libgtk-3-0",
    "libnotify4",
    "libnss3",
    "libxss1",
    "libxtst6",
    "xdg-utils",
    "libatspi2.0-0",
    "libuuid1",
    "libsecret-1-0",
)


def checked_name(name: str, allow_root: bool = False) -> str:
    name = name.replace("\\", "/")
    if "\0" in name or name.startswith("/") or len(name.encode("utf-8")) > MAX_PATH_BYTES:
        raise ValueError(f"unsafe archive path: {name!r}")
    normalized = posixpath.normpath(name)
    if normalized == "." and allow_root:
        return normalized
    if normalized in ("", ".", "..") or normalized.startswith("../"):
        raise ValueError(f"unsafe archive path: {name!r}")
    if len([part for part in normalized.split("/") if part]) > MAX_DEPTH:
        raise ValueError(f"archive path exceeds depth budget: {name!r}")
    return normalized


def check_entries(entries) -> None:
    count = 0
    total = 0
    names = set()
    for name, size, kind, link in entries:
        normalized = checked_name(name, allow_root=kind == "directory")
        if normalized in names:
            raise ValueError(f"duplicate archive path: {normalized!r}")
        names.add(normalized)
        count += 1
        if count > MAX_ENTRIES:
            raise ValueError("archive exceeds entry-count budget")
        if normalized == ".":
            if size != 0 or link:
                raise ValueError("archive root directory marker contains unexpected metadata")
            continue
        if size < 0 or size > MAX_ENTRY_BYTES:
            raise ValueError(f"archive entry exceeds size budget: {normalized!r}")
        if kind == "file":
            total += size
            if total > MAX_TOTAL_BYTES:
                raise ValueError("archive exceeds total uncompressed-size budget")
        if kind in ("symlink", "hardlink"):
            target = link.replace("\\", "/")
            if "\0" in target or target.startswith("/") or len(target.encode("utf-8")) > MAX_PATH_BYTES:
                raise ValueError(f"unsafe archive link: {normalized!r}")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(normalized), target))
            if resolved == ".." or resolved.startswith("../"):
                raise ValueError(f"archive link escapes extraction root: {normalized!r}")


def tar_entries(fileobj):
    with tarfile.open(fileobj=fileobj, mode="r:*") as archive:
        for member in archive:
            if member.isfile():
                kind = "file"
            elif member.isdir():
                kind = "directory"
            elif member.issym():
                kind = "symlink"
            elif member.islnk():
                raise ValueError(f"archive hard links are not accepted: {member.name!r}")
            else:
                raise ValueError(f"unsupported archive entry type: {member.name!r}")
            yield member.name, member.size, kind, member.linkname


def zip_entries(filename):
    with zipfile.ZipFile(filename) as archive:
        compressed_total = 0
        for entry in archive.infolist():
            if entry.compress_size < 0 or entry.compress_size > MAX_ENTRY_BYTES:
                raise ValueError(f"ZIP entry exceeds compressed-size budget: {entry.filename!r}")
            compressed_total += entry.compress_size
            if compressed_total > MAX_ARCHIVE_BYTES:
                raise ValueError("ZIP entries exceed total compressed-size budget")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                if entry.file_size > MAX_PATH_BYTES:
                    raise ValueError(f"archive link target exceeds budget: {entry.filename!r}")
                # Link payloads are attacker-controlled compressed bytes.  The
                # streaming extractor reads at most MAX_LINK_BYTES+1 and
                # validates the target before creating any symlink.
                link = ""
                kind = "symlink-deferred"
            elif entry.is_dir():
                link = ""
                kind = "directory"
            else:
                link = ""
                kind = "file"
            yield entry.filename, entry.file_size, kind, link


def deb_archives(filename):
    with open(filename, "rb") as source:
        if source.read(8) != b"!<arch>\n":
            raise ValueError("Debian carrier has no valid ar header")
        members = {}
        while True:
            header = source.read(60)
            if not header:
                break
            if len(header) != 60 or header[58:] != b"`\n":
                raise ValueError("Debian carrier has a malformed ar member")
            name = header[:16].decode("ascii", "strict").strip().rstrip("/")
            size = int(header[48:58].decode("ascii", "strict").strip())
            if size < 0 or size > MAX_ARCHIVE_BYTES:
                raise ValueError("Debian ar member exceeds byte budget")
            if name in members:
                raise ValueError(f"Debian carrier contains duplicate ar member: {name}")
            payload = source.read(size)
            if len(payload) != size:
                raise ValueError("Debian ar member is truncated")
            if size % 2:
                if source.read(1) != b"\n":
                    raise ValueError("Debian ar member has invalid padding")
            members[name] = payload
        allowed = {"debian-binary"}
        control_names = [name for name in members if name.startswith("control.tar")]
        data_names = [name for name in members if name.startswith("data.tar")]
        if len(control_names) != 1:
            raise ValueError("Debian carrier must contain exactly one control archive")
        if len(data_names) != 1:
            raise ValueError("Debian carrier must contain exactly one data archive")
        allowed.update(control_names)
        allowed.update(data_names)
        unexpected = set(members) - allowed
        if unexpected:
            raise ValueError(f"Debian carrier contains unapproved ar members: {sorted(unexpected)}")
        if members.get("debian-binary") != b"2.0\n":
            raise ValueError("Debian carrier has invalid debian-binary metadata")
        return io.BytesIO(members[control_names[0]]), io.BytesIO(members[data_names[0]])


def parse_rfc822_control(body: bytes) -> dict[str, str]:
    if len(body) > 64 * 1024:
        raise ValueError("Debian control metadata exceeds fixed budget")
    try:
        text = body.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise ValueError("Debian control metadata is not valid UTF-8") from error
    if "\0" in text or "\r" in text:
        raise ValueError("Debian control metadata contains control bytes")
    fields: dict[str, str] = {}
    current = None
    paragraphs = 1
    for line in text.split("\n"):
        if not line:
            if current is not None:
                paragraphs += 1
                current = None
            continue
        if line[0] in " \t":
            if current != "Description":
                raise ValueError("Debian control continuation is accepted only for Description")
            fields[current] += "\n" + line[1:]
            continue
        if current is None and paragraphs > 1:
            raise ValueError("Debian control must contain exactly one RFC822 paragraph")
        if ":" not in line:
            raise ValueError("Debian control contains a malformed RFC822 field")
        name, value = line.split(":", 1)
        if (
            not name
            or any(not (character.isalnum() or character == "-") for character in name)
            or not value.startswith(" ")
            or name in fields
        ):
            raise ValueError("Debian control contains a malformed or duplicate RFC822 field")
        fields[name] = value[1:]
        current = name
    return fields


def validate_deb_control(fields: dict[str, str], expected_version: str, expected_arch: str) -> None:
    unexpected = set(fields) - DEB_ALLOWED_FIELDS
    missing = DEB_REQUIRED_FIELDS - set(fields)
    if unexpected:
        raise ValueError(f"Debian control contains unapproved fields: {sorted(unexpected)}")
    if missing:
        raise ValueError(f"Debian control is missing required fields: {sorted(missing)}")
    exact = {
        "Package": "leafbook",
        "Version": expected_version,
        "License": "MIT",
        "Vendor": "LeafBook Contributors",
        "Architecture": expected_arch,
        "Maintainer": "LeafBook Contributors",
        "Priority": "optional",
        "Homepage": "https://github.com/Jacquesxu666/leafbook",
    }
    for name, expected in exact.items():
        if fields[name] != expected:
            raise ValueError(f"Debian control has non-canonical {name}")
    if fields["Section"] not in ("default", "editors", "office", "utils"):
        raise ValueError("Debian control has non-canonical Section")
    if fields["Description"] not in (
        "A local-first Markdown book reader and editor.",
        "\nA local-first Markdown book reader and editor.",
    ):
        raise ValueError("Debian control has non-canonical Description")
    installed_size = fields["Installed-Size"]
    if not installed_size.isascii() or not installed_size.isdigit():
        raise ValueError("Debian control has invalid Installed-Size")
    installed_size_value = int(installed_size)
    if installed_size_value < 1 or installed_size_value > MAX_TOTAL_BYTES // 1024:
        raise ValueError("Debian control Installed-Size exceeds fixed budget")
    depends = tuple(value.strip() for value in fields["Depends"].split(","))
    if depends != DEB_DEPENDS:
        raise ValueError("Debian control Depends is not the audited electron-builder dependency set")
    if fields["Recommends"] != "libappindicator3-1":
        raise ValueError("Debian control Recommends is not canonical")


def check_deb_control(fileobj, expected_version: str, expected_arch: str):
    allowed = {"control", "md5sums", *DEB_MAINTAINER_SCRIPT_SHA256}
    seen = set()
    control_body = None
    with tarfile.open(fileobj=fileobj, mode="r:*") as archive:
        for member in archive:
            name = checked_name(member.name, allow_root=member.isdir())
            if name in seen:
                raise ValueError(f"duplicate Debian control path: {name!r}")
            seen.add(name)
            if name == ".":
                if not member.isdir() or member.size != 0 or member.linkname:
                    raise ValueError(
                        "Debian control root directory marker contains unexpected metadata"
                    )
                continue
            if name not in allowed:
                raise ValueError(
                    f"Debian control archive contains unapproved maintainer metadata or script: {name}"
                )
            if not member.isfile() or member.issym() or member.islnk():
                raise ValueError(f"Debian control metadata must be a regular file: {name}")
            expected_mode = 0o755 if name in DEB_MAINTAINER_SCRIPT_SHA256 else 0o644
            if member.mode != expected_mode or member.uid != 0 or member.gid != 0:
                raise ValueError(f"Debian control metadata has non-canonical ownership or mode: {name}")
            limit = 64 * 1024 if name == "control" else 16 * 1024 * 1024
            if member.size < 1 or member.size > limit:
                raise ValueError(f"Debian control metadata exceeds fixed budget: {name}")
            if name == "control":
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ValueError("Debian control metadata cannot be read")
                control_body = extracted.read(limit + 1)
            elif name in DEB_MAINTAINER_SCRIPT_SHA256:
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ValueError(f"Debian maintainer script cannot be read: {name}")
                body = extracted.read(limit + 1)
                if hashlib.sha256(body).hexdigest() != DEB_MAINTAINER_SCRIPT_SHA256[name]:
                    raise ValueError(f"Debian maintainer script is not canonical: {name}")
    missing = allowed - seen
    if missing:
        raise ValueError(f"Debian control archive is missing required metadata: {sorted(missing)}")
    if control_body is None:
        raise ValueError("Debian control archive is missing control metadata")
    validate_deb_control(
        parse_rfc822_control(control_body),
        expected_version,
        expected_arch,
    )
    # md5sums is deterministic payload metadata when present; every other
    # standard maintainer hook (preinst/postinst/prerm/postrm/config/templates,
    # triggers, shlibs, or arbitrary additions) is deliberately rejected.


def deb_data(filename, expected_version: str, expected_arch: str):
    control, data = deb_archives(filename)
    check_deb_control(control, expected_version, expected_arch)
    return data


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] not in ("tar", "zip", "deb"):
        raise ValueError(
            "Usage: preflight-archive.py {tar|zip} ARCHIVE | deb ARCHIVE VERSION ARCH"
        )
    mode, filename = sys.argv[1:3]
    if mode == "deb":
        if len(sys.argv) != 5 or sys.argv[4] not in ("amd64", "arm64"):
            raise ValueError("Debian preflight requires VERSION and amd64|arm64")
        expected_version, expected_arch = sys.argv[3:5]
    elif len(sys.argv) != 3:
        raise ValueError("tar/zip preflight accepts only ARCHIVE")
    if not os.path.isfile(filename) or os.path.islink(filename):
        raise ValueError("archive must be a regular non-symlink file")
    if os.path.getsize(filename) > MAX_ARCHIVE_BYTES:
        raise ValueError("compressed archive exceeds 1 GiB budget")
    if mode == "zip":
        check_entries(zip_entries(filename))
    elif mode == "deb":
        check_entries(tar_entries(deb_data(filename, expected_version, expected_arch)))
    else:
        with open(filename, "rb") as source:
            check_entries(tar_entries(source))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # fail closed with one actionable line
        print(str(error), file=sys.stderr)
        sys.exit(1)
