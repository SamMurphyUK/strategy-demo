#!/usr/bin/env python3
"""Writes the 12 faction roundels as flat 256 x 256 SVGs, and a contact sheet to check them at 96, 44 and 24 px.

    python scripts/generate_roundels.py

Output goes to public/assets/roundels/. Only the standard library is used, and the output is deterministic:
the same script always writes the same bytes.

Every roundel has the same frame: a dark bezel (r 122), a brass hairline (r 118), and a clip at r 114 holding
the face (the ground and its rings) and the emblem on top. Flat enamel fills only: no gradients, no filters,
no text. The drawings are bold so they survive down to 20 px.
"""

import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "roundels"
C = 128  # centre
FACE_R = 114

# Enamel colours. Mostly the fading-16 strip's own tones, pushed a little where a flag needs it.
BEZEL = "#2a2023"
BRASS = "#a88a5e"
CREAM = "#f3ecdf"
STONE = "#cfc6b3"
SLATE = "#4e5463"
INK = "#3a2a26"
RED = "#b3322f"
CRIMSON = "#a8243a"
NAVY = "#243a63"
YELLOW = "#d9b23c"
GOLD = "#d2a53a"
BROWN = "#4a2f2a"
OLIVE = "#6f7a4a"
GREEN = "#3d7a4f"
STEEL_BLUE = "#46607f"
ROYAL = "#2c4f9e"
ROSE = "#a8656a"
WARM_CREAM = "#efe3c4"
DEEP_NAVY = "#1f2d4d"
FR_BLUE = "#2a4a8a"
SOVIET_RED = "#9c524e"  # the strip's muted red


def n(value: float) -> str:
    """A short, stable number: two decimals, no trailing zeros."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def pts(points) -> str:
    return " ".join(f"{n(x)},{n(y)}" for x, y in points)


def circle(r: float, fill: str, cx: float = C, cy: float = C, extra: str = "") -> str:
    return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}"{extra}/>'


def ring_stroke(r: float, width: float, stroke: str) -> str:
    return f'<circle cx="{C}" cy="{C}" r="{n(r)}" fill="none" stroke="{stroke}" stroke-width="{n(width)}"/>'


def polygon(points, fill: str) -> str:
    return f'<polygon points="{pts(points)}" fill="{fill}"/>'


def star(cx: float, cy: float, outer: float, inner_ratio: float = 0.382, points: int = 5, rotate: float = -90.0):
    """Vertices of a star with `points` tips, one tip at `rotate` degrees."""
    out = []
    for i in range(points * 2):
        radius = outer if i % 2 == 0 else outer * inner_ratio
        angle = math.radians(rotate + i * 180.0 / points)
        out.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return out


def cross_poly(a: float, b: float, length: float):
    """A Balkenkreuz: arms flare from half-width a at the centre to half-width b at the tips, `length` from the centre."""
    # Built arm by arm, clockwise from the top.
    pairs = [
        (-a, -a), (-b, -length), (b, -length), (a, -a),
        (length, -b), (length, b), (a, a),
        (b, length), (-b, length), (-a, a),
        (-length, b), (-length, -b),
    ]
    return [(C + x, C + y) for x, y in pairs]


def rect(x: float, y: float, w: float, h: float, fill: str) -> str:
    return f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" fill="{fill}"/>'


# --------------------------------------------------------------------------------------
# The twelve roundels: each returns (face, emblem) markup.
# --------------------------------------------------------------------------------------


def us():
    face = circle(FACE_R, STEEL_BLUE)
    emblem = polygon(star(C, C, 88), CREAM) + circle(17, RED)
    return face, emblem


def uk():
    face = circle(FACE_R, YELLOW) + circle(96, NAVY) + circle(64, CREAM)
    emblem = circle(32, RED)
    return face, emblem


def ussr():
    # The hammer and sickle is hand-drawn art (scripts/roundel_art/), kept exactly as drawn.
    art = json.loads((Path(__file__).resolve().parent / "roundel_art" / "ussr_hammer_sickle.json").read_text(encoding="utf-8"))
    face = circle(FACE_R, SOVIET_RED)
    emblem = f'<path style="{art["style"]}" d="{art["d"]}"/>'
    return face, emblem


def ger():
    face = circle(FACE_R, ROSE)
    emblem = polygon(cross_poly(26, 40, 100), CREAM) + polygon(cross_poly(18, 31, 88), INK)
    return face, emblem


def jap():
    face = circle(FACE_R, WARM_CREAM)
    rays = []
    for i in range(16):
        centre = math.radians(i * 22.5 - 90)
        half = math.radians(5.4)
        far = 150
        near = 44
        points = [
            (C + near * math.cos(centre - half * 0.6), C + near * math.sin(centre - half * 0.6)),
            (C + far * math.cos(centre - half), C + far * math.sin(centre - half)),
            (C + far * math.cos(centre + half), C + far * math.sin(centre + half)),
            (C + near * math.cos(centre + half * 0.6), C + near * math.sin(centre + half * 0.6)),
        ]
        rays.append(polygon(points, CRIMSON))
    emblem = "".join(rays) + circle(34, CRIMSON)
    return face, emblem


def ita():
    face = circle(FACE_R, OLIVE) + circle(86, GREEN) + circle(58, CREAM)
    emblem = circle(30, RED)
    return face, emblem


def chn():
    face = circle(FACE_R, ROYAL)
    emblem = polygon(star(C, C, 92, 0.52, 12), CREAM) + circle(36, ROYAL) + circle(27, CREAM)
    return face, emblem


def anz():
    face = circle(FACE_R, DEEP_NAVY)
    core = circle(40, CREAM) + circle(25, RED)
    # The Southern Cross: four big stars and a small one, set clear of the core.
    cross = (
        polygon(star(128, 40, 17), CREAM)
        + polygon(star(128, 216, 17), CREAM)
        + polygon(star(52, 118, 15), CREAM)
        + polygon(star(204, 140, 15), CREAM)
        + polygon(star(172, 70, 9), CREAM)
    )
    return face, core + cross


def fra():
    face = circle(FACE_R, RED) + circle(86, CREAM) + circle(58, FR_BLUE)
    # Cross of Lorraine: one upright, two bars, the upper shorter.
    bars = (
        rect(C - 6, C - 46, 12, 92, CREAM)
        + rect(C - 22, C - 30, 44, 10, CREAM)
        + rect(C - 32, C + 2, 64, 10, CREAM)
    )
    return face, bars


def neutral(ring_colour: str):
    def build():
        face = circle(FACE_R, SLATE) + ring_stroke(96, 18, ring_colour) + ring_stroke(68, 5, STONE)
        # A four-point compass star with a crosshair through it.
        compass = polygon(star(C, C, 84, 0.26, 4), STONE)
        cross = rect(C - 4, C - 100, 8, 200, STONE) + rect(C - 100, C - 4, 200, 8, STONE)
        emblem = cross + compass + circle(12, SLATE) + circle(6, ring_colour)
        return face, emblem

    return build


def ita_fasces():
    """Wartime Regia Aeronautica marking (1940-43): a black fasces on a white disc."""
    face = circle(FACE_R, OLIVE) + circle(88, CREAM)
    rods = polygon([(C - 22, C + 60), (C - 24, C - 44), (C + 24, C - 44), (C + 22, C + 60)], INK)
    grooves = "".join(rect(C + x - 1.5, C - 44, 3, 104, CREAM) for x in (-8, 8))
    straps = rect(C - 25, C - 18, 50, 8, CREAM) + rect(C - 24, C + 24, 48, 8, CREAM)
    axe = polygon([(C + 20, C - 34), (C + 60, C - 66), (C + 60, C + 0), (C + 20, C - 14)], INK)
    return face, rods + grooves + straps + axe


def jap_hinomaru():
    """The Hinomaru: the plain red disc Japanese military aircraft wore."""
    return circle(FACE_R, WARM_CREAM), circle(62, CRIMSON)


def anz_raaf():
    """The RAAF's blue and white roundel of the Pacific war: the RAF's red centre painted over in white."""
    return circle(FACE_R, NAVY), circle(68, CREAM)


ROUNDELS = {
    "us": ("United States", us),
    "uk": ("United Kingdom", uk),
    "ussr": ("Soviet Union", ussr),
    "ger": ("Germany", ger),
    "jap": ("Japan", jap),
    "ita": ("Italy", ita),
    "chn": ("China", chn),
    "anz": ("Australia and New Zealand", anz),
    "fra": ("France", fra),
    "neutral_true": ("Neutral", neutral(STONE)),
    "neutral_allied": ("Neutral, leaning Allied", neutral(STEEL_BLUE)),
    "neutral_axis": ("Neutral, leaning Axis", neutral(RED)),
}


# Historically closer copies of roundels whose first versions are kept as they were.
ALTERNATES = {
    "ita_fasces": ("Italy, wartime fasces", ita_fasces),
    "jap_hinomaru": ("Japan, Hinomaru", jap_hinomaru),
    "anz_raaf": ("Australia and New Zealand, RAAF blue and white", anz_raaf),
}
EVERY = {**ROUNDELS, **ALTERNATES}


def svg(name: str, title: str, face: str, emblem: str) -> str:
    return "\n".join(
        [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">',
            f"<title>{title}</title>",
            "<defs>",
            f'<clipPath id="{name}-clip"><circle cx="{C}" cy="{C}" r="{FACE_R}"/></clipPath>',
            "</defs>",
            circle(122, BEZEL),
            f'<circle cx="{C}" cy="{C}" r="118" fill="none" stroke="{BRASS}" stroke-width="1.5"/>',
            f'<g clip-path="url(#{name}-clip)">',
            f'<g id="face">{face}</g>',
            f'<g id="emblem">{emblem}</g>',
            "</g>",
            "</svg>",
            "",
        ]
    )


def contact_sheet(names) -> str:
    cells = []
    for name in names:
        label = EVERY[name][0]
        cells.append(
            f'<figure><figcaption>{name}<small>{label}</small></figcaption>'
            f'<div class="row dark"><img src="{name}.svg" width="96" height="96" alt="{label}">'
            f'<img src="{name}.svg" width="44" height="44" alt=""><img src="{name}.svg" width="24" height="24" alt=""></div>'
            f'<div class="row light"><img src="{name}.svg" width="96" height="96" alt="">'
            f'<img src="{name}.svg" width="44" height="44" alt=""><img src="{name}.svg" width="24" height="24" alt=""></div></figure>'
        )
    return "\n".join(
        [
            "<!doctype html>",
            '<html lang="en"><head><meta charset="utf-8"><title>Roundels</title>',
            "<style>",
            "body{margin:24px;background:#241c1e;color:#ddcf99;font:14px/1.4 sans-serif}",
            "h1{font-size:18px;margin:0 0 4px}p{margin:0 0 20px;color:#a99c8d}",
            ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}",
            "figure{margin:0;border:1px solid #846d59}",
            "figcaption{padding:6px 8px;font-weight:700}figcaption small{display:block;font-weight:400;color:#a99c8d}",
            ".row{display:flex;align-items:center;gap:14px;padding:10px}",
            ".dark{background:#3a2a26}.light{background:#e2d8c3}",
            "</style></head><body>",
            "<h1>Faction roundels</h1>",
            "<p>Each at 96, 44 and 24 px, on a dark ground and on parchment.</p>",
            '<div class="grid">',
            *cells,
            "</div></body></html>",
            "",
        ]
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (title, build) in EVERY.items():
        face, emblem = build()
        (OUT / f"{name}.svg").write_text(svg(name, title, face, emblem), encoding="utf-8", newline="\n")
    (OUT / "contact_sheet.html").write_text(contact_sheet(list(EVERY)), encoding="utf-8", newline="\n")
    print(f"wrote {len(ROUNDELS)} roundels, {len(ALTERNATES)} alternates and contact_sheet.html to {OUT}")


if __name__ == "__main__":
    main()
