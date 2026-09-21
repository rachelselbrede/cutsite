#!/usr/bin/env python3
"""
Generate the app icons from the same scissors mark as the favicon.

They are build products, like cutsite-standalone.html. The favicon lives
inline in index.html as an SVG; these are the PNGs a manifest and iOS need,
drawn from the same coordinates so the mark never drifts between them.

    python3 build-icons.py            write the icons
    python3 build-icons.py --check    verify the committed PNGs are current

Needs Pillow (pip install pillow). Nothing else in the project does, which
is why this is a separate script run by hand rather than part of the build:
the game itself still has no dependencies.
"""

import io
import pathlib
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).parent

INK = (7, 13, 26, 255)        # #070d1a, the page background
AMBER = (255, 178, 77, 255)   # #ffb24d, the scissors

# The favicon's geometry, on its 32-unit grid. Keep these in step with the
# inline SVG in index.html.
GRID = 32.0
CORNER = 7.0
STROKE = 2.6
RINGS = [(9.0, 9.5), (9.0, 22.5)]
RING_R = 3.0
BLADES = [((11.5, 11.2), (25.0, 22.5)), ((11.5, 20.8), (25.0, 9.5))]
PIVOT = (16.0, 16.0)
PIVOT_R = 1.6

SS = 4  # supersample before the downscale, so the strokes come out smooth

# name -> (size, rounded corners?, how much of the tile the mark fills)
# A maskable icon is cropped to a circle by the launcher, so its mark has to
# sit inside the middle 80%; the plain ones can use the whole tile.
ICONS = {
    "icon-192.png": (192, True, 1.0),
    "icon-512.png": (512, True, 1.0),
    "icon-maskable-512.png": (512, False, 0.62),
    "apple-touch-icon.png": (180, False, 0.88),
}


def draw_icon(size, rounded, inset):
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, px - 1, px - 1], radius=CORNER / GRID * px, fill=INK)
    else:
        d.rectangle([0, 0, px - 1, px - 1], fill=INK)

    # Map the 32-unit grid onto the tile, shrunk by `inset` about its centre.
    scale = px / GRID * inset
    offset = px / 2 - GRID / 2 * scale

    def p(x, y):
        return (offset + x * scale, offset + y * scale)

    def disc(x, y, r, fill):
        cx, cy = p(x, y)
        rr = r * scale
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    w = STROKE * scale

    for cx, cy in RINGS:
        disc(cx, cy, RING_R + STROKE / 2, AMBER)
        disc(cx, cy, RING_R - STROKE / 2, INK)

    for (x1, y1), (x2, y2) in BLADES:
        d.line([p(x1, y1), p(x2, y2)], fill=AMBER, width=max(1, round(w)))
        # Pillow has no round line caps, so the ends get their own discs.
        disc(x1, y1, STROKE / 2, AMBER)
        disc(x2, y2, STROKE / 2, AMBER)

    disc(*PIVOT, PIVOT_R, AMBER)

    return img.resize((size, size), Image.LANCZOS)


def encode(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def main():
    check = "--check" in sys.argv
    stale = []
    for name, (size, rounded, inset) in ICONS.items():
        data = encode(draw_icon(size, rounded, inset))
        path = ROOT / name
        if check:
            if not path.exists() or path.read_bytes() != data:
                stale.append(name)
        else:
            path.write_bytes(data)
            print(f"wrote {name} ({size}x{size}, {len(data):,} bytes)")

    if check:
        if stale:
            sys.exit(
                "out of date: " + ", ".join(stale) +
                f"\nRun: python3 {pathlib.Path(__file__).name}"
            )
        print("icons are up to date")


if __name__ == "__main__":
    main()
