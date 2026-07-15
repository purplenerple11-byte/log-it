#!/usr/bin/env python3
"""Generate the Log It app icons.

The icon is a solid --action field with a centred --bg dot (variant B2).
Run from the repo root:  python3 tools/make-icons.py

Stdlib only by design: this repo has no build step and no npm.
The dot is 52% of the icon width, which keeps it inside the 80% safe zone
Android crops maskable icons to -- so one image serves "any maskable" and
Apple alike, and no padded variant is needed.
"""

import struct
import zlib
from pathlib import Path

BG = (0xCC, 0x78, 0x5C)   # --action
DOT = (0x12, 0x13, 0x16)  # --bg
DOT_DIAMETER = 0.52       # fraction of icon width
SS = 4                    # supersampling factor, for a smooth dot edge

SIZES = {
    "icon-180.png": 180,  # apple-touch-icon
    "icon-192.png": 192,
    "icon-512.png": 512,
}


def render(size):
    """Return RGB rows for one icon, anti-aliased by SS x SS supersampling."""
    centre = size / 2.0
    radius = size * DOT_DIAMETER / 2.0
    # Compare squared distances to avoid a sqrt per subsample.
    r2 = radius * radius
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            hits = 0
            for sy in range(SS):
                dy = y + (sy + 0.5) / SS - centre
                for sx in range(SS):
                    dx = x + (sx + 0.5) / SS - centre
                    if dx * dx + dy * dy <= r2:
                        hits += 1
            if hits == 0:
                row += bytes(BG)
            elif hits == SS * SS:
                row += bytes(DOT)
            else:
                a = hits / (SS * SS)
                row += bytes(round(b + (d - b) * a) for b, d in zip(BG, DOT))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    return len(png)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for name, size in SIZES.items():
        n = write_png(out / name, size)
        print(f"{name:16} {size:>4}px  {n:>7,} bytes")
