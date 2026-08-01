#!/usr/bin/env python3
"""Find exactly one valid SquashFS payload with fixed memory."""

import subprocess
import sys

MARKER = b"hsqs"
CHUNK_BYTES = 1024 * 1024
MAX_CANDIDATES = 128
VALIDATION_SECONDS = 10


def main() -> int:
    if len(sys.argv) not in (2, 3):
        raise ValueError("Usage: find-squashfs-offset.py APPIMAGE [UNSQUASHFS]")
    offsets = []
    absolute = 0
    overlap = b""
    with open(sys.argv[1], "rb") as source:
        while True:
            chunk = source.read(CHUNK_BYTES)
            if not chunk:
                break
            data = overlap + chunk
            start = 0
            while True:
                found = data.find(MARKER, start)
                if found < 0:
                    break
                offsets.append(absolute - len(overlap) + found)
                if len(offsets) > MAX_CANDIDATES:
                    raise ValueError("AppImage contains too many SquashFS marker candidates")
                start = found + 1
            overlap = data[-(len(MARKER) - 1) :]
            absolute += len(chunk)
    validator = sys.argv[2] if len(sys.argv) == 3 else "unsquashfs"
    valid_offsets = []
    for offset in offsets:
        try:
            result = subprocess.run(
                [validator, "-s", "-o", str(offset), sys.argv[1]],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=VALIDATION_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ValueError("SquashFS candidate validation exceeded its time budget") from error
        if result.returncode == 0:
            valid_offsets.append(offset)
            if len(valid_offsets) > 1:
                break
    if len(valid_offsets) != 1:
        raise ValueError("AppImage must contain exactly one SquashFS payload")
    print(valid_offsets[0])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
