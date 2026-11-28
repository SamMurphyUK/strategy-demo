"""Builds a pixel-art font family from Futura Cyrillic (Book ... ExtraBold).

Every glyph is drawn large from the source font, then fitted to a pixel grid like a hand-hinted bitmap font:

  * One set of vertical metrics for every weight: x-height 6, cap height 10, ascender 11, descender 3.
    (Futura's own x-height drifts from 0.41 to 0.47 em across weights; the outline is warped to the grid.)
  * Fixed stem widths per weight, in whole pixels: vertical stems (V) and horizontal bars (H).
    The outline is thickened with an anisotropic dilation until it reaches the target.
  * Each glyph is nudged and stretched slightly sideways to the position where its stems fall on whole
    pixel columns, so stems are never a blur of 1px and 2px.
  * Orphan pixels and one-pixel notches are cleaned up afterwards.

The TTF puts one square per lit pixel, so it is crisp at any whole multiple of 16px (16, 32, 48 ...).
Spacing is pixel-tight: ink width plus one blank column.

    python -I scripts/buildPixelFont.py <folder with FuturaCyrillic*.ttf> <out folder> [--specimen file.png]

Futura is a commercial typeface. Check your licence before shipping a derivative.
"""

import os
import sys

import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

EM_PX = 16  # nominal em, in pixels
PX = 100  # font units per pixel
S = 16  # supersampling
SCALE = 15  # design size: px per em at which Futura is fitted (cap 0.667 em -> 10 px)
FAMILY = "Pixel Futura"
# style, CSS weight, source file, vertical stem px, horizontal bar px
WEIGHTS = [
    ("Book", 400, "Book", 1, 1),
    ("Medium", 500, "Medium", 2, 1),
    ("Demi", 600, "Demi", 2, 2),
    ("Bold", 700, "Bold", 3, 2),
    ("Heavy", 800, "Heavy", 3, 3),
    ("ExtraBold", 900, "ExtraBold", 4, 3),
]
RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F), (0x400, 0x4FF), (0x2010, 0x2022), (0x2026, 0x2026), (0x20AC, 0x20AC), (0x2116, 0x2116), (0x2190, 0x2193)]
XH, CAP, ASC, DESC = 6, 10, 11, 3
SPACE_PX = 4
ASCENT_PX, DESCENT_PX = 12, 4

CW, CH = 48 * S, 44 * S  # hi-res canvas
ORIGIN_X = 10 * S


def wanted(cmap):
    for lo, hi in RANGES:
        for cp in range(lo, hi + 1):
            if cp in cmap:
                yield cp


def render(font, ch):
    """Hi-res coverage array of one glyph with the baseline on row BASE."""
    im = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(im).text((ORIGIN_X, BASE), ch, font=font, fill=255, anchor="ls")
    return np.asarray(im, dtype=np.float32) / 255.0


BASE = 30 * S


def run_len(line):
    """Length of the first run of ink in a 1-D array, in hi-res samples."""
    on = np.flatnonzero(line > 0.5)
    if on.size == 0:
        return 0.0
    n = 1
    while n < on.size and on[n] == on[n - 1] + 1:
        n += 1
    return float(n)


class Source:
    def __init__(self, path):
        self.path = path
        self.ttf = TTFont(path)
        self.cmap = self.ttf.getBestCmap()
        self.glyphs = self.ttf.getGlyphSet()
        self.upem = self.ttf["head"].unitsPerEm
        self.font = ImageFont.truetype(path, SCALE * S)

        def top(ch):
            p = BoundsPen(self.glyphs)
            self.glyphs[self.cmap[ord(ch)]].draw(p)
            return p.bounds

        k = SCALE * S / self.upem
        self.xh = top("x")[3] * k
        self.cap = top("H")[3] * k
        self.asc = top("d")[3] * k
        self.desc = -top("p")[1] * k
        # stem and bar thickness of the source at the design size, in px
        i = render(self.font, "I")
        t = render(self.font, "T")
        self.v = run_len(i[BASE - 5 * S, :]) / S
        bar_row = int(BASE - self.cap + 3)
        bar = np.flatnonzero(t[bar_row, :] > 0.5)  # the T's top bar; read down it a quarter of the way in, clear of the stem
        quarter = int(bar[0] + 0.2 * (bar[-1] - bar[0])) if bar.size else ORIGIN_X
        self.h = run_len(t[:, quarter][int(BASE - self.cap - 6):]) / S


def warp(arr, src, dy=0):
    """Stretch the slices between the font's own heights onto the fixed grid heights.

    `dy` is how much the bars were thickened beforehand: that grows every flat top and bottom, so the
    heights move with it and the fixed grid heights still come out the same."""
    up = dy // 2
    down = dy - up
    base_y = BASE + down
    asc_y = int(round(BASE - src.asc)) - up
    cap_y = int(round(BASE - src.cap)) - up
    xh_y = int(round(BASE - src.xh)) - up
    desc_y = int(round(BASE + src.desc)) + down
    cuts = [
        (0, asc_y, asc_y),
        (asc_y, cap_y, (ASC - CAP) * S),
        (cap_y, xh_y, (CAP - XH) * S),
        (xh_y, base_y, XH * S),
        (base_y, desc_y, DESC * S),
        (desc_y, CH, CH - desc_y),
    ]
    parts = []
    for a, b, h in cuts:
        piece = Image.fromarray((arr[a:b] * 255).astype(np.uint8))
        if b - a != h and b > a and h > 0:
            piece = piece.resize((CW, h), Image.BICUBIC)
        parts.append(np.asarray(piece, dtype=np.float32) / 255.0)
    out = np.concatenate(parts, axis=0)
    new_base = asc_y + (ASC - CAP + CAP - XH + XH) * S
    # keep the baseline on a whole pixel row of the hi-res grid
    pad = (-new_base) % S
    if pad:
        out = np.concatenate([np.zeros((pad, CW), np.float32), out], axis=0)
        new_base += pad
    rows_below = out.shape[0] - new_base
    need = (-rows_below) % S
    if need:
        out = np.concatenate([out, np.zeros((need, CW), np.float32)], axis=0)
    return out, new_base


def dilate(arr, dx, dy):
    """Thicken strokes: dx widens vertical stems, dy thickens horizontal bars (hi-res samples)."""
    out = arr
    if dx > 0:
        left = dx // 2
        acc = out.copy()
        for k in range(-left, dx - left + 1):
            if k:
                acc = np.maximum(acc, np.roll(out, k, axis=1))
        out = acc
    if dy > 0:
        up = dy // 2
        acc = out.copy()
        for k in range(-up, dy - up + 1):
            if k:
                acc = np.maximum(acc, np.roll(out, k, axis=0))
        out = acc
    return out


def to_grid(hi, base, phase, sx, x0, x1):
    """Crop the ink columns, stretch them by sx, drop them on the grid at a sub-pixel phase, return coverage."""
    crop = hi[:, x0:x1 + 1]
    width = max(1, int(round(crop.shape[1] * sx)))
    if width != crop.shape[1]:
        crop = np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((width, crop.shape[0]), Image.BICUBIC), dtype=np.float32) / 255.0
    total = (width + S * 2 + phase)
    total += (-total) % S
    canvas = np.zeros((crop.shape[0], total), np.float32)
    canvas[:, S + phase:S + phase + width] = crop
    rows, cols = canvas.shape[0] // S, canvas.shape[1] // S
    cov = canvas.reshape(rows, S, cols, S).mean(axis=(1, 3))
    return cov


def fit(hi, base):
    """Pick the phase and stretch that put the glyph's edges on pixel boundaries. Returns coverage and the baseline row."""
    cols = np.flatnonzero(hi.max(axis=0) > 0.5)
    if cols.size == 0:
        return None
    x0, x1 = int(cols[0]), int(cols[-1])
    best = None
    for sx in (0.94, 0.97, 1.0, 1.03, 1.06):
        for phase in range(0, S, 2):
            cov = to_grid(hi, base, phase, sx, x0, x1)
            sharp = float(np.minimum(cov, 1 - cov).sum())
            score = sharp + 6.0 * abs(sx - 1.0)
            if best is None or score < best[0]:
                best = (score, cov)
    return best[1], base // S


def cleanup(cov):
    lit = cov >= 0.5
    h, w = lit.shape
    pad = np.pad(lit, 1)
    for _ in range(2):
        pad = np.pad(lit, 1)
        n4 = pad[:-2, 1:-1].astype(int) + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]
        n8 = n4 + pad[:-2, :-2] + pad[:-2, 2:] + pad[2:, :-2] + pad[2:, 2:]
        # fill one-pixel notches that the outline mostly covers
        lit = lit | ((~lit) & (n4 >= 3) & (cov >= 0.3))
        # drop orphan specks the outline barely touches
        lit = lit & ~(lit & (n8 == 0) & (cov < 0.75))
    return lit


def pixels_of(lit, base_row):
    ys, xs = np.nonzero(lit)
    if xs.size == 0:
        return set(), 0
    x_min = xs.min()
    pixels = {(int(x - x_min), int(base_row - y - 1)) for x, y in zip(xs, ys)}
    return pixels, int(xs.max() - x_min + 1)


def rects(pixels):
    """Merge lit pixels into rectangles: horizontal runs, then identical runs stacked vertically."""
    rows = {}
    for x, y in pixels:
        rows.setdefault(y, []).append(x)
    runs = {}
    for y, xs in rows.items():
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:]:
            if x != prev + 1:
                runs.setdefault((start, prev), []).append(y)
                start = x
            prev = x
        runs.setdefault((start, prev), []).append(y)
    out = []
    for (x0, x1), ys in runs.items():
        ys.sort()
        y0 = prev = ys[0]
        for y in ys[1:]:
            if y != prev + 1:
                out.append((x0, y0, x1 + 1, prev + 1))
                y0 = y
            prev = y
        out.append((x0, y0, x1 + 1, prev + 1))
    return out


def glyph_bitmaps(src, style, v_t, h_t):
    dx = int(round(max(0.0, v_t - src.v) * S))
    dy = int(round(max(0.0, h_t - src.h) * S))
    result = {}
    for cp in wanted(src.cmap):
        ch = chr(cp)
        if ch in (" ", " "):
            result[cp] = (set(), SPACE_PX)
            continue
        hi = dilate(render(src.font, ch), dx, dy)
        hi, base = warp(hi, src, dy)
        fitted = fit(hi, base)
        if fitted is None:
            continue
        cov, base_row = fitted
        lit = cleanup(cov)
        pixels, width = pixels_of(lit, base_row)
        if not pixels:
            continue
        result[cp] = (pixels, width + 1)
    return result


def build(dst, style, weight, bitmaps):
    glyphs, metrics, order, charmap = {}, {}, [".notdef"], {}

    def add(name, pixels, advance_px):
        pen = TTGlyphPen(None)
        for x0, y0, x1, y1 in rects(pixels):
            X0, X1, Y0, Y1 = x0 * PX, x1 * PX, y0 * PX, y1 * PX
            pen.moveTo((X0, Y0))
            pen.lineTo((X0, Y1))
            pen.lineTo((X1, Y1))
            pen.lineTo((X1, Y0))
            pen.closePath()
        glyphs[name] = pen.glyph()
        metrics[name] = (advance_px * PX, 0)
        if name not in order:
            order.append(name)

    box = {(x, y) for x in range(0, 7) for y in (0, CAP - 1)} | {(x, y) for y in range(0, CAP) for x in (0, 6)}
    add(".notdef", box, 8)
    for cp, (pixels, advance) in bitmaps.items():
        name = "uni%04X" % cp
        add(name, pixels, advance)
        charmap[cp] = name

    fb = FontBuilder(EM_PX * PX, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(charmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT_PX * PX, descent=-DESCENT_PX * PX, lineGap=0)
    fb.setupNameTable(
        {
            "familyName": FAMILY if style == "Book" else f"{FAMILY} {style}",
            "styleName": "Regular",
            "uniqueFontIdentifier": f"{FAMILY} {style} 2.0",
            "fullName": f"{FAMILY} {style}",
            "psName": f"PixelFutura-{style}",
            "version": "Version 2.0",
            "typographicFamily": FAMILY,
            "typographicSubfamily": style,
        }
    )
    fb.setupOS2(
        usWeightClass=weight,
        sTypoAscender=ASCENT_PX * PX,
        sTypoDescender=-DESCENT_PX * PX,
        sTypoLineGap=0,
        usWinAscent=ASCENT_PX * PX,
        usWinDescent=DESCENT_PX * PX,
        sxHeight=XH * PX,
        sCapHeight=CAP * PX,
    )
    fb.setupPost(isFixedPitch=0)
    fb.save(dst)


def specimen(path, all_bitmaps):
    lines = ["BATTLE PLANS: GLOBAL WAR", "abcdefghijklm", "nopqrstuvwxyz", "Mechanised Infantry 0123456789", "Привет Мир, Ёж."]
    zoom = 3
    sheets = []
    for style, bitmaps in all_bitmaps:
        rows = []
        for text in lines:
            width = 4 + sum(bitmaps.get(ord(c), ({}, 5))[1] if c != " " else SPACE_PX for c in text)
            img = np.zeros((EM_PX + 2, width), np.uint8)
            x = 2
            for c in text:
                if c == " ":
                    x += SPACE_PX
                    continue
                pixels, adv = bitmaps.get(ord(c), (set(), 5))
                for (px, py) in pixels:
                    row = DESCENT_PX + 1 + CAP + 1 - py - 1 + 0
                    row = (ASCENT_PX + 1) - py - 1
                    if 0 <= row < img.shape[0] and 0 <= x + px < img.shape[1]:
                        img[row, x + px] = 255
                x += adv
            rows.append(img)
        w = max(r.shape[1] for r in rows)
        block = np.zeros((sum(r.shape[0] for r in rows) + 2, w), np.uint8)
        y = 0
        for r in rows:
            block[y:y + r.shape[0], :r.shape[1]] = r
            y += r.shape[0]
        sheets.append(block)
    w = max(s.shape[1] for s in sheets)
    sheet = np.zeros((sum(s.shape[0] + 3 for s in sheets), w), np.uint8)
    y = 0
    for s in sheets:
        sheet[y:y + s.shape[0], :s.shape[1]] = s
        y += s.shape[0] + 3
    img = Image.fromarray(255 - sheet).resize((w * zoom, sheet.shape[0] * zoom), Image.NEAREST)
    img.save(path)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    folder, out = args[0], args[1]
    os.makedirs(out, exist_ok=True)
    collected = []
    for style, weight, source, v_t, h_t in WEIGHTS:
        src = Source(os.path.join(folder, f"FuturaCyrillic{source}.ttf"))
        bitmaps = glyph_bitmaps(src, style, v_t, h_t)
        dst = os.path.join(out, f"PixelFutura-{style}.ttf")
        build(dst, style, weight, bitmaps)
        collected.append((style, bitmaps))
        print(f"{style:10s} {weight} V{v_t} H{h_t} (source V{src.v:.2f} H{src.h:.2f}) {len(bitmaps)} glyphs {os.path.getsize(dst)} bytes")
    if "--specimen" in sys.argv:
        specimen(sys.argv[sys.argv.index("--specimen") + 1], collected)


main()
