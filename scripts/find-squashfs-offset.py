#!/usr/bin/env python3
"""Find exactly one SquashFS hsqs marker with fixed memory."""

import sys

MARKER = b"hsqs"
CHUNK_BYTES = 1024 * 1024


def main() -> int:
    if len(sys.argv) != 2:
        raise ValueError("Usage: find-squashfs-offset.py APPIMAGE")
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
                if len(offsets) > 1:
                    raise ValueError("AppImage must contain exactly one SquashFS payload")
                start = found + 1
            overlap = data[-(len(MARKER) - 1) :]
            absolute += len(chunk)
    if len(offsets) != 1:
        raise ValueError("AppImage must contain exactly one SquashFS payload")
    print(offsets[0])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
