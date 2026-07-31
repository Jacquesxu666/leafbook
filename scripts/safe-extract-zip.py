#!/usr/bin/env python3
"""Extract a ZIP while enforcing limits against bytes actually decompressed.

The ZIP central directory is metadata supplied by the artifact.  In particular,
its uncompressed-size field is not treated as a resource limit: deflate output
is counted before it is written and must exactly match the declared size.
"""

import os
import posixpath
import stat
import struct
import sys
import time
import zipfile
import zlib

MAX_ENTRIES = 100_000
MAX_DEPTH = 128
MAX_PATH_BYTES = 4096
MAX_ENTRY_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_LINK_BYTES = 4096
MAX_SECONDS = 120
READ_SIZE = 64 * 1024


def safe_name(value: str) -> str:
    name = value.replace("\\", "/")
    if "\0" in name or name.startswith("/") or len(name.encode("utf-8")) > MAX_PATH_BYTES:
        raise ValueError(f"unsafe ZIP path: {value!r}")
    normalized = posixpath.normpath(name)
    parts = normalized.split("/")
    if (
        normalized in ("", ".", "..")
        or normalized.startswith("../")
        or len(parts) > MAX_DEPTH
        or any(part in ("", ".", "..") for part in parts)
    ):
        raise ValueError(f"unsafe ZIP path: {value!r}")
    return normalized


def ensure_parent(root: str, name: str) -> str:
    parts = name.split("/")
    current = root
    for component in parts[:-1]:
        current = os.path.join(current, component)
        try:
            current_stat = os.lstat(current)
        except FileNotFoundError:
            os.mkdir(current, 0o755)
            current_stat = os.lstat(current)
        if not stat.S_ISDIR(current_stat.st_mode) or stat.S_ISLNK(current_stat.st_mode):
            raise ValueError(f"ZIP path has a non-directory parent: {name!r}")
    return os.path.join(root, *parts)


def local_payload(source, entry: zipfile.ZipInfo):
    source.seek(entry.header_offset)
    header = source.read(30)
    if len(header) != 30 or header[:4] != b"PK\x03\x04":
        raise ValueError(f"invalid ZIP local header: {entry.filename!r}")
    (
        _signature,
        _extract_version,
        flags,
        method,
        _mtime,
        _mdate,
        _crc,
        compressed_size,
        uncompressed_size,
        name_size,
        extra_size,
    ) = struct.unpack("<IHHHHHIIIHH", header)
    if flags & 0x1:
        raise ValueError(f"encrypted ZIP entries are not accepted: {entry.filename!r}")
    if method != entry.compress_type or method not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise ValueError(f"unsupported ZIP compression method: {entry.filename!r}")
    local_name = source.read(name_size)
    source.seek(extra_size, os.SEEK_CUR)
    expected_name = entry.orig_filename.encode("utf-8")
    if flags & 0x800 and local_name != expected_name:
        raise ValueError(f"ZIP local/central path mismatch: {entry.filename!r}")
    if not flags & 0x8:
        if compressed_size != entry.compress_size or uncompressed_size != entry.file_size:
            raise ValueError(f"ZIP local/central size mismatch: {entry.filename!r}")
    payload_offset = source.tell()
    if payload_offset + entry.compress_size > os.fstat(source.fileno()).st_size:
        raise ValueError(f"truncated ZIP payload: {entry.filename!r}")
    return payload_offset, method


def checked_output(chunk: bytes, entry: zipfile.ZipInfo, actual: int, total: int):
    next_actual = actual + len(chunk)
    next_total = total + len(chunk)
    if next_actual > entry.file_size:
        raise ValueError(
            f"ZIP actual output exceeds declared size before extraction: {entry.filename!r}"
        )
    if next_actual > MAX_ENTRY_BYTES:
        raise ValueError(f"ZIP entry exceeds actual byte budget: {entry.filename!r}")
    if next_total > MAX_TOTAL_BYTES:
        raise ValueError("ZIP exceeds actual total-byte budget")
    return next_actual, next_total


def stream_entry(source, entry: zipfile.ZipInfo, sink, total: int, deadline: float):
    payload_offset, method = local_payload(source, entry)
    source.seek(payload_offset)
    remaining = entry.compress_size
    actual = 0
    crc = 0
    inflater = zlib.decompressobj(-15) if method == zipfile.ZIP_DEFLATED else None
    while remaining:
        if time.monotonic() > deadline:
            raise TimeoutError("ZIP extraction exceeded wall-clock budget")
        compressed = source.read(min(READ_SIZE, remaining))
        if not compressed:
            raise ValueError(f"truncated ZIP payload: {entry.filename!r}")
        remaining -= len(compressed)
        pending = compressed
        while pending:
            if inflater is None:
                output = pending
                pending = b""
            else:
                # Asking for at most declared+1 bytes makes a falsified tiny
                # central size fail before a decompression bomb can be written.
                allowance = min(
                    READ_SIZE,
                    entry.file_size + 1 - actual,
                    MAX_ENTRY_BYTES + 1 - actual,
                    MAX_TOTAL_BYTES + 1 - total,
                )
                if allowance <= 0:
                    raise ValueError(f"ZIP entry exceeds actual byte budget: {entry.filename!r}")
                output = inflater.decompress(pending, allowance)
                pending = inflater.unconsumed_tail
            actual, total = checked_output(output, entry, actual, total)
            if output:
                sink.write(output)
                crc = zlib.crc32(output, crc)
            if inflater is not None and not output and pending:
                raise ValueError(f"invalid deflate stream: {entry.filename!r}")
    if inflater is not None:
        while not inflater.eof:
            allowance = min(
                READ_SIZE,
                entry.file_size + 1 - actual,
                MAX_ENTRY_BYTES + 1 - actual,
                MAX_TOTAL_BYTES + 1 - total,
            )
            if allowance <= 0:
                raise ValueError(f"ZIP entry exceeds actual byte budget: {entry.filename!r}")
            output = inflater.flush(allowance)
            if not output:
                break
            actual, total = checked_output(output, entry, actual, total)
            sink.write(output)
            crc = zlib.crc32(output, crc)
        if not inflater.eof or inflater.unused_data:
            raise ValueError(f"invalid or trailing deflate payload: {entry.filename!r}")
    if actual != entry.file_size:
        raise ValueError(f"ZIP actual output does not match declared size: {entry.filename!r}")
    if crc & 0xFFFFFFFF != entry.CRC:
        raise ValueError(f"ZIP CRC mismatch: {entry.filename!r}")
    return total


def extract(archive_path: str, destination: str) -> None:
    archive_stat = os.lstat(archive_path)
    destination_stat = os.lstat(destination)
    if (
        not stat.S_ISREG(archive_stat.st_mode)
        or stat.S_ISLNK(archive_stat.st_mode)
        or archive_stat.st_size > MAX_ARCHIVE_BYTES
    ):
        raise ValueError("ZIP must be a regular file within the compressed-byte budget")
    if not stat.S_ISDIR(destination_stat.st_mode) or stat.S_ISLNK(destination_stat.st_mode):
        raise ValueError("ZIP destination must be a real directory")
    destination = os.path.realpath(destination)
    deadline = time.monotonic() + MAX_SECONDS
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES:
            raise ValueError("ZIP exceeds entry-count budget")
        normalized = []
        names = set()
        for entry in entries:
            name = safe_name(entry.filename.rstrip("/"))
            if name in names:
                raise ValueError(f"duplicate ZIP path: {name!r}")
            names.add(name)
            if entry.file_size < 0 or entry.file_size > MAX_ENTRY_BYTES:
                raise ValueError(f"ZIP declared entry exceeds byte budget: {name!r}")
            mode = entry.external_attr >> 16
            kind = (
                "symlink"
                if stat.S_ISLNK(mode)
                else "directory"
                if entry.is_dir()
                else "file"
            )
            if kind == "symlink" and entry.file_size > MAX_LINK_BYTES:
                raise ValueError(f"ZIP symlink target exceeds byte budget: {name!r}")
            normalized.append((entry, name, kind, mode))

        link_targets = {}
        with open(archive_path, "rb") as source:
            for entry, name, kind, _mode in normalized:
                if kind != "symlink":
                    continue
                chunks = []

                class LinkSink:
                    def write(self, value):
                        chunks.append(value)

                stream_entry(source, entry, LinkSink(), 0, deadline)
                link = b"".join(chunks).decode("utf-8", "strict").replace("\\", "/")
                if "\0" in link or link.startswith("/") or len(link.encode()) > MAX_LINK_BYTES:
                    raise ValueError(f"unsafe ZIP symlink target: {name!r}")
                link_destination = posixpath.normpath(
                    posixpath.join(posixpath.dirname(name), link)
                )
                if link_destination == ".." or link_destination.startswith("../"):
                    raise ValueError(f"ZIP symlink escapes extraction root: {name!r}")
                link_targets[name] = (link, link_destination)

        def resolve_manifest_target(destination: str) -> str:
            current = destination
            for _ in range(64):
                components = current.split("/")
                replacement = None
                for length in range(1, len(components) + 1):
                    prefix = "/".join(components[:length])
                    if prefix in link_targets:
                        _link, target = link_targets[prefix]
                        suffix = components[length:]
                        replacement = posixpath.normpath(
                            posixpath.join(target, *suffix) if suffix else target
                        )
                        break
                if replacement is None:
                    return current
                if replacement == ".." or replacement.startswith("../"):
                    raise ValueError("ZIP symlink chain escapes extraction root")
                current = replacement
            raise ValueError("ZIP symlink chain exceeds resolution budget")

        for name, (_link, link_destination) in link_targets.items():
            if resolve_manifest_target(link_destination) not in names:
                raise ValueError(f"ZIP symlink targets an unlisted path: {name!r}")

        class NullSink:
            def write(self, _value):
                pass

        total = 0
        with open(archive_path, "rb") as source:
            for entry, name, kind, mode in normalized:
                if time.monotonic() > deadline:
                    raise TimeoutError("ZIP extraction exceeded wall-clock budget")
                target = ensure_parent(destination, name)
                if os.path.lexists(target):
                    if kind == "directory":
                        target_stat = os.lstat(target)
                        if not stat.S_ISDIR(target_stat.st_mode) or stat.S_ISLNK(target_stat.st_mode):
                            raise ValueError(f"ZIP directory collides with another entry: {name!r}")
                        continue
                    raise ValueError(f"ZIP path already exists: {name!r}")
                if kind == "directory":
                    os.mkdir(target, 0o755)
                    continue
                if kind == "symlink":
                    link = link_targets[name][0]
                    total = stream_entry(source, entry, NullSink(), total, deadline)
                    os.symlink(link, target)
                    continue
                with open(target, "xb") as sink:
                    total = stream_entry(source, entry, sink, total, deadline)
                os.chmod(target, (mode & 0o777) or 0o644)


def main() -> None:
    if len(sys.argv) != 3:
        raise ValueError("Usage: safe-extract-zip.py ARCHIVE DESTINATION")
    extract(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
