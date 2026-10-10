#!/usr/bin/env python3
"""Deterministic, dependency-free, fully opaque 1024px icon for internal LiDAR testing.
The official Basira logo should replace this placeholder for public releases.
"""
from pathlib import Path
import struct
import zlib

SIZE = 1024
OUT = Path("ios/DepthCalibrationLab/DepthCalibrationLab/Assets.xcassets/AppIcon.appiconset/AppIcon.png")


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


rows = bytearray()
for y in range(SIZE):
    rows.append(0)  # PNG "no filter"
    for x in range(SIZE):
        px = (x - 512) ** 2 + (y - 512) ** 2
        outline = 350 ** 2 <= px <= 400 ** 2
        stem = 310 <= x <= 380 and 265 <= y <= 760
        upper = ((x - 425) / 215) ** 2 + ((y - 390) / 150) ** 2 <= 1
        upper_hole = ((x - 425) / 120) ** 2 + ((y - 390) / 69) ** 2 < 1
        lower = ((x - 425) / 230) ** 2 + ((y - 625) / 155) ** 2 <= 1
        lower_hole = ((x - 425) / 131) ** 2 + ((y - 625) / 73) ** 2 < 1
        letter_b = stem or (
            x >= 375 and ((upper and not upper_hole) or (lower and not lower_hole))
        )
        rgb = (245, 189, 84) if (outline or letter_b) else (18, 27, 43)
        rows.extend(rgb)

ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", ihdr)
    + chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
    + chunk(b"IEND", b"")
)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_bytes(png)
print(f"Generated opaque RGB {SIZE}x{SIZE} PNG at {OUT}")
