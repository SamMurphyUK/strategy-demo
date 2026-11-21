#!/usr/bin/env python3
"""Deterministically build jap_infantry_v2 layered assets, frames, and sheets.

Rules enforced:
- PIL / NumPy only (zero generative image synthesis, zero blending/AA).
- Non-destructive: v1 files are never modified; SHA-256 hashes are verified.
- Walk Frames 1-8 (Poses 0..7) are kept 100% untouched byte-for-byte across all
  part JSON drawings and frame JSON layers.
- Weapon layer is left completely empty on Poses 8..19; all baked rifles,
  dropped ground rifles, muzzle smoke wisps, and floating stray pixels are
  stripped from torso, head, and legs.
- Strict web/src/ui/theme/militaryPalette.ts 16-color compliance on all _v2 PNG
  outputs, with #FF00FF empty space on sprite sheets and alpha=0 on frame/strip
  PNGs.
"""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

WEB_ROOT = Path(__file__).resolve().parents[1]
UNITS_DIR = WEB_ROOT / "public" / "assets" / "units"

V1_RIG_DIR = UNITS_DIR / "rigs" / "jap_infantry"
V2_RIG_DIR = UNITS_DIR / "rigs" / "jap_infantry_v2"

V1_FRAMES_DIR = UNITS_DIR / "frames" / "jap_infantry"
V2_FRAMES_DIR = UNITS_DIR / "frames" / "jap_infantry_v2"

V1_WALK_SHEET = UNITS_DIR / "jap_walk.png"
V2_WALK_SHEET = UNITS_DIR / "jap_walk_v2.png"

WIDTH = 80
HEIGHT = 80
CELLS = WIDTH * HEIGHT

# Exact 16-color palette from web/src/ui/theme/militaryPalette.ts
MILITARY_PALETTE_HEX: dict[str, str] = {
    "cream": "#DDCF99",
    "tan": "#CCA87B",
    "terracotta": "#B97A60",
    "crimson": "#9C524E",
    "plum": "#774251",
    "charcoal": "#4B3D44",
    "steel": "#4E5463",
    "spruce": "#5B7D73",
    "sage": "#8E9F7D",
    "taupe": "#645355",
    "feldgrau": "#8C7C79",
    "bone": "#A99C8D",
    "olive": "#7D7B62",
    "brass": "#AAA25D",
    "brown": "#846D59",
    "khaki": "#A88A5E",
}


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


ALLOWED_MILITARY_RGB: set[tuple[int, int, int]] = {
    hex_to_rgb(v) for v in MILITARY_PALETTE_HEX.values()
}
MAGENTA_RGB: tuple[int, int, int] = (255, 0, 255)

# Exact slot -> MILITARY 16-color RGB lookup (slots 1..13)
SLOT_TO_MILITARY_RGB: dict[int, tuple[int, int, int]] = {
    1: hex_to_rgb(MILITARY_PALETTE_HEX["khaki"]),       # #A88A5E Uniform highlight / collar
    2: hex_to_rgb(MILITARY_PALETTE_HEX["brass"]),       # #AAA25D Uniform mid / pants / belt / pack
    3: hex_to_rgb(MILITARY_PALETTE_HEX["charcoal"]),    # #4B3D44 Uniform shadow / crisp outline
    4: hex_to_rgb(MILITARY_PALETTE_HEX["taupe"]),       # #645355 Webbing / inner shadow
    5: hex_to_rgb(MILITARY_PALETTE_HEX["plum"]),        # #774251 Gear
    6: hex_to_rgb(MILITARY_PALETTE_HEX["brown"]),       # #846D59 Tunic / leather / eyes
    7: hex_to_rgb(MILITARY_PALETTE_HEX["khaki"]),       # #A88A5E Wood stock
    8: hex_to_rgb(MILITARY_PALETTE_HEX["cream"]),       # #DDCF99 Skin highlight
    9: hex_to_rgb(MILITARY_PALETTE_HEX["tan"]),         # #CCA87B Skin mid
    10: hex_to_rgb(MILITARY_PALETTE_HEX["terracotta"]), # #B97A60 Boot upper shaft
    11: hex_to_rgb(MILITARY_PALETTE_HEX["brass"]),      # #AAA25D Helmet
    12: hex_to_rgb(MILITARY_PALETTE_HEX["crimson"]),    # #9C524E Gun accent
    13: hex_to_rgb(MILITARY_PALETTE_HEX["steel"]),      # #4E5463 Gun metal
}


def snapshot_hashes(paths: list[Path]) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for p in paths:
        if p.is_file():
            hashes[p.as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
        elif p.is_dir():
            for child in sorted(p.rglob("*")):
                if child.is_file():
                    hashes[child.as_posix()] = hashlib.sha256(child.read_bytes()).hexdigest()
    return hashes


def to_grid(cells: list[int]) -> np.ndarray:
    return np.array(cells, dtype=np.uint8).reshape((HEIGHT, WIDTH))


def from_grid(grid: np.ndarray) -> list[int]:
    return [int(v) for v in grid.reshape(-1)]


def shift_grid(grid: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.zeros_like(grid)
    ys, xs = np.nonzero(grid)
    for y, x in zip(ys.tolist(), xs.tolist()):
        nx, ny = x + dx, y + dy
        if 0 <= nx < WIDTH and 0 <= ny < HEIGHT:
            out[ny, nx] = grid[y, x]
    return out


def build_clean_frame1_torso(torso0: np.ndarray) -> np.ndarray:
    """Fill the chest area behind Walk Frame 1's rifle using Frame 1's exact tunic/collar/belt slots."""
    t = torso0.copy()
    # Rows 38..47 in Walk Frame 1 (Pose 0) had a horizontal cutout at y=39..44, x=32..48
    # where weapon_original[0] sat over the chest. Fill cleanly with Frame 1 slots:
    # 2 = backpack/belt (#AAA25D), 6 = tunic (#846D59), 1 = placket/collar (#A88A5E), 3 = outline (#4B3D44).
    fill_rows: dict[int, tuple[int, str]] = {
        # y: (start_x, slot_hex_string)
        39: (27, "2266666666666666266663"),
        40: (26, "22226666666666666166663"),
        41: (26, "22226666666666666166663"),
        42: (26, "22222666666666661166663"),
        43: (26, "22222666666611111666663"),
        44: (26, "22222666666611166666663"),
        45: (26, "22222266662222222222663"),
        46: (28, "226666222222222222333"),
        47: (29, "666326222222222222333"),
    }
    for y, (x0, pattern) in fill_rows.items():
        t[y, :] = 0
        for i, ch in enumerate(pattern):
            if ch != ".":
                t[y, x0 + i] = int(ch, 16)
    # Remove single stray pixel at y=48 (belongs to hip transition)
    t[48, :] = 0
    return t


def stamp_boot_column(legs: np.ndarray, x_min: int, x_max: int, y_top: int = 62) -> None:
    """Normalize a dark charcoal/taupe boot in [x_min..x_max, y_top..71] to match clean tan/brown boots."""
    for y in range(y_top, 72):
        xs = [x for x in range(x_min, x_max + 1) if legs[y, x] != 0]
        if not xs:
            continue
        left, right = min(xs), max(xs)
        if y <= 68:
            for x in range(left, right + 1):
                legs[y, x] = 10
        elif y == 69:
            for x in range(left, right + 1):
                legs[y, x] = 6 if x == right else 10
        elif y == 70:
            for x in range(left, right + 1):
                legs[y, x] = 6 if x >= right - 1 else 10
        elif y == 71:
            for x in range(left, right + 1):
                legs[y, x] = 4 if x == left else 6


def clean_boot_soles(legs: np.ndarray, x_min: int = 0, x_max: int = 79) -> None:
    """Clean stray slot-2 pixels on boot soles (rows 69..71) to crisp Frame 1 brown/taupe/charcoal."""
    for y in (69, 70, 71):
        for x in range(x_min, x_max + 1):
            v = int(legs[y, x])
            if v == 2:
                legs[y, x] = 4 if y < 71 else 3
            elif y == 71 and v == 6:
                # Keep crisp brown/charcoal sole base
                legs[y, x] = 3 if (x > 0 and legs[y, x - 1] == 0) else 6


def clean_upright_legs(raw: np.ndarray, pose: int, dx: int, dy: int) -> np.ndarray:
    """Extract and clean trousers + boots for upright Poses 8..15."""
    legs = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    y_start = 48 + dy
    # Left hip cutoff on rows y_start..y_start+4 strips the hanging rifle-sling/coat-strap artifact
    hip_left_cut = 31 + dx

    for y in range(y_start, 72):
        for x in range(WIDTH):
            v = int(raw[y, x])
            if v == 0:
                continue
            if y <= y_start + 4 and x < hip_left_cut:
                continue
            # Also strip any leftover right-hand / gun-butt pixels hanging into row 48..49 on the right
            if y <= y_start + 1 and x > 46 + dx:
                continue
            if y < 63:
                # Trousers region: map wood-stock 7 -> uniform-mid 2, terracotta edge 10 -> 2
                if v == 7:
                    v = 2
                elif v == 10:
                    v = 2 if y < 61 else 10
                elif v in (1, 8, 9):
                    v = 6
            elif v == 7:
                v = 2
            legs[y, x] = v

    # Ensure seamless waist-to-hip connection at y_start (width matching Frame 1 hip top x=32..45 + dx)
    for x in range(32 + dx, 46 + dx):
        if legs[y_start, x] == 0:
            legs[y_start, x] = 3 if x == 32 + dx else 6

    # Fix dark charcoal rear boot in Frame 10 (Pose 9) and front boot in Firing Row 0 Col 1 (Pose 13)
    if pose == 9:
        stamp_boot_column(legs, 39, 49, y_top=62)
    elif pose == 13:
        stamp_boot_column(legs, 40, 50, y_top=62)

    clean_boot_soles(legs)
    return legs


def paint_pattern(grid: np.ndarray, x0: int, y0: int, rows: list[str]) -> None:
    hex_map = {ch: i for i, ch in enumerate("0123456789ABCD")}
    for dy, line in enumerate(rows):
        y = y0 + dy
        for dx, ch in enumerate(line):
            x = x0 + dx
            if ch != "." and 0 <= x < WIDTH and 0 <= y < HEIGHT:
                grid[y, x] = hex_map[ch]


def clean_pose_16(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Falling Frame 1 (Row 1 Col 1): staggering backward."""
    work = raw.copy()
    # 1. Strip dropped rifle on the ground (bottom-right)
    work[55:63, 56:80] = 0
    work[63:72, 52:80] = 0

    # 2. Separate tilted head (y=25..38, x=19..39) and clean with Walk Frame 1 helmet (B),
    #    clean cream skin (8), brow (6), outline (3), and crisp tilted 2-pixel eyes (6).
    head = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    head_rows = [
        # x = 19..39 (width 21), y = 25..38
        "........6663.........",  # 25
        "......BBBBBB3........",  # 26
        ".....BBBBBBBB3.......",  # 27
        "....BBBBBBBBB3.......",  # 28
        "...BBBBBBBB6663......",  # 29
        "..BBBBBBBB666883.....",  # 30
        ".BBBBBBBB66688883....",  # 31
        ".BBBBBBB6668888683...",  # 32  <- right eye top at (36, 32)
        "B6BBBBBB6688868683...",  # 33  <- left eye top (33,33), right eye bot (36,33)
        "BBBBBBB66688868883...",  # 34  <- left eye bot (33,34)
        ".BBBBBB66888888883...",  # 35
        ".BBBBB666888888883...",  # 36
        "..BBB6668888888833...",  # 37
        "......66888888833....",  # 38
    ]
    paint_pattern(head, 19, 25, head_rows)
    work[25:39, 19:42] = 0

    # 3. Split remaining body into torso (upper body + outstretched arms/hands) and legs (trousers + boots)
    torso = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    legs = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)

    for y in range(39, 72):
        for x in range(WIDTH):
            v = int(work[y, x])
            if v == 0:
                continue
            is_left_arm = x <= 29 and y <= 58
            is_torso = y <= 53 or is_left_arm
            if is_torso:
                if (x <= 26 and y >= 55) or (x >= 52 and 46 <= y <= 49):
                    v = 6 if (x == 25 and y == 55) else 8
                elif y == 39 and 27 <= x <= 35:
                    v = 8 if x <= 31 else 1
                elif y in (40, 41) and 33 <= x <= 37 and v == 7:
                    v = 1
                elif v in (7, 10):
                    v = 2
                elif v in (1, 8, 9):
                    v = 6
                torso[y, x] = v
            else:
                if v == 7:
                    v = 2
                elif y < 63 and v == 10:
                    v = 2
                elif y < 63 and v in (1, 8, 9):
                    v = 6
                legs[y, x] = v

    # Keep clean 2px separation between left leg/boot (x <= 42) and front boot (x >= 44) on y=63..66
    legs[63:66, 43] = 0
    stamp_boot_column(legs, 44, 51, y_top=63)
    clean_boot_soles(legs, 30, 52)
    return legs, torso, head


def clean_pose_17(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Falling Frame 2 (Row 1 Col 2): supine fallen pose 1."""
    work = raw.copy()
    # 1. Strip dropped rifle & stray speck below supine body (all rows y >= 64)
    work[64:80, :] = 0

    # 2. Separate supine head on the right (x=52..70, y=50..63)
    head = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    head_rows = [
        # x = 52..69 (width 18), y = 50..63
        "..........6BB3....",  # 50
        "..........6BBBB3..",  # 51
        ".8888888866BBBBB3.",  # 52
        "88888866866BBBBBB3",  # 53  <- upper 2px horizontal eye at x=58..59
        "88888888866BBBBBB3",  # 54
        "88888888866BBBBBB3",  # 55
        "88888866866BBBBBB3",  # 56  <- lower 2px horizontal eye at x=58..59
        "68888888866BBBBBB3",  # 57
        "68888888866BBBBBB3",  # 58
        "66888888666BBBBBB3",  # 59
        "46688866666BBBBBB3",  # 60
        "44668866666BBBBBB3",  # 61
        "..444444446BBBBB3.",  # 62
        "..........66BBB3..",  # 63
    ]
    paint_pattern(head, 52, 50, head_rows)
    work[50:64, 52:72] = 0

    # 3. Separate legs (left side x <= 31: boots + bent knees) and torso (middle x=32..51)
    legs = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    torso = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)

    for y in range(47, 64):
        for x in range(52):
            v = int(work[y, x])
            if v == 0:
                continue
            if x <= 31:
                if x >= 19 and v in (7, 10):
                    v = 2
                elif x < 19 and v == 7:
                    v = 2
                elif y == 63 and v == 2:
                    v = 4
                legs[y, x] = v
            else:
                if (35 <= x <= 41 and 51 <= y <= 52 and v in (1, 7, 8, 9, 10)) or (
                    33 <= x <= 38 and 62 <= y <= 63 and v in (1, 8, 9)
                ):
                    v = 8
                elif v in (7, 10):
                    v = 2
                elif v in (1, 8, 9):
                    v = 6
                torso[y, x] = v

    return legs, torso, head


def clean_pose_18(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Falling Frame 3 (Row 2 Col 0): staggering forward."""
    work = raw.copy()
    # 1. Surgical removal of dropped rifle on ground (bottom-right)
    for y in range(56, 68):
        if y <= 61:
            work[y, 51:80] = 0
        elif y == 62:
            work[y, 50:80] = 0
        elif y == 63:
            work[y, 46:80] = 0
        else:
            work[y, 45:80] = 0

    # 2. Separate forward-pitched head (x=38..52, y=30..43) and clean with Walk Frame 1
    #    helmet (B=11), diagonal brow (6), clean cream face (8), outline (3), and crisp
    #    tilted 2-pixel eyes (6) at (42, 38..39) and (45, 39..40).
    head = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    head_rows = [
        # x = 38..52 (width 15), y = 30..43
        "..BBBBBBBB3....",  # 30
        ".BBBBBBBBBB3...",  # 31
        ".6BBBBBBBBBB3..",  # 32
        ".66BBBBBBBBBB3.",  # 33
        ".6666BBBBBBBBB3",  # 34
        "886666BBBBBBBB3",  # 35
        "8888666BBBBBBB3",  # 36
        "88888866BBBBBB3",  # 37
        "888868866BBBBB3",  # 38  <- left eye top (42, 38)
        "1888688686BBBB3",  # 39  <- collar 1 + left eye bot (42, 39), right eye top (45, 39)
        "118888868866BB3",  # 40  <- collar 11 + right eye bot (45, 40)
        "61888888863....",  # 41
        "6618888883.....",  # 42
        "666188883......",  # 43
    ]
    paint_pattern(head, 38, 30, head_rows)
    # Move collar pixels (slot 1/6 on x=38..41, y=39..43) onto torso behind head so neck is 100% gap-free!
    work[30:44, 38:54] = 0
    for y in range(39, 44):
        for x in range(38, 42):
            if head[y, x] in (1, 6):
                work[y, x] = head[y, x]
                head[y, x] = 0

    # 3. Split remaining body into torso (upper body + left & right arms) and legs (trousers + boots)
    torso = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    legs = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)

    for y in range(36, 72):
        for x in range(WIDTH):
            v = int(work[y, x])
            if v == 0:
                continue
            is_left_arm = x <= 25 and y <= 52
            is_right_arm = x >= 45 and y <= 55
            is_torso = y <= 50 or is_left_arm or is_right_arm
            if is_torso:
                if (x <= 23 and 48 <= y <= 52) or (x >= 50 and 53 <= y <= 55):
                    v = 8
                elif v == 1 and 38 <= x <= 41 and 39 <= y <= 43:
                    v = 1
                elif v in (7, 10):
                    v = 2
                elif v in (1, 8, 9):
                    v = 6
                torso[y, x] = v
            else:
                if v == 7:
                    v = 2
                elif y < 63 and v == 10:
                    v = 2
                elif y < 63 and v in (1, 8, 9):
                    v = 6
                legs[y, x] = v

    # 4. Normalize dark charcoal front boot (x=38..46, y=63..71) and clean left boot sole
    stamp_boot_column(legs, 38, 46, y_top=63)
    clean_boot_soles(legs, 22, 47)
    return legs, torso, head


def clean_pose_19(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Falling Frame 4 (Row 2 Col 1): supine fallen pose 2."""
    work = raw.copy()
    # 1. Strip dropped rifle below supine body (all rows y >= 65)
    work[65:80, :] = 0

    # 2. Separate supine head on the right (x=53..71, y=52..63)
    head = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    head_rows = [
        # x = 53..70 (width 18), y = 52..63
        "..8888886666BB3...",  # 52
        ".8888888866BBBB3..",  # 53
        "88888866866BBBBB3.",  # 54  <- upper 2px horizontal eye at x=59..60
        "88888888866BBBBBB3",  # 55
        "88888888866BBBBBB3",  # 56
        "88888866866BBBBBB3",  # 57  <- lower 2px horizontal eye at x=59..60
        "68888888866BBBBBB3",  # 58
        "66888888666BBBBBB3",  # 59
        "46688866666BBBBBB3",  # 60
        "44668866666BBBBB3.",  # 61
        "...44444466BBBBB3.",  # 62
        "..........6BBBB3..",  # 63
    ]
    paint_pattern(head, 53, 52, head_rows)
    work[52:64, 53:72] = 0

    # 3. Separate legs (left side x <= 31: boots + bent knees) and torso (middle x=32..52)
    legs = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    torso = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)

    for y in range(47, 64):
        for x in range(53):
            v = int(work[y, x])
            if v == 0:
                continue
            if x <= 31:
                if x >= 19 and v in (7, 10):
                    v = 2
                elif x < 19 and v == 7:
                    v = 2
                elif y == 63 and v == 2:
                    v = 4
                legs[y, x] = v
            else:
                if (35 <= x <= 41 and 51 <= y <= 52 and v in (1, 7, 8, 9, 10)) or (
                    33 <= x <= 39 and 61 <= y <= 63 and v in (1, 7, 8, 9)
                ):
                    v = 8
                elif v in (7, 10):
                    v = 2
                elif v in (1, 8, 9):
                    v = 6
                torso[y, x] = v

    return legs, torso, head


def composite_pose(
    legs: np.ndarray,
    torso: np.ndarray,
    head: np.ndarray,
    weapon: np.ndarray,
) -> np.ndarray:
    """Composite layers in rig order: legs -> torso -> head -> weapon."""
    out = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    for layer in (legs, torso, head, weapon):
        mask = layer != 0
        out[mask] = layer[mask]
    return out


def slots_to_rgba(grid: np.ndarray, magenta_bg: bool = False) -> np.ndarray:
    """Render a slot grid (H x W) to RGBA uint8 strictly using the 16-color MILITARY palette."""
    h, w = grid.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    if magenta_bg:
        rgba[:, :, 0] = 255
        rgba[:, :, 1] = 0
        rgba[:, :, 2] = 255
        rgba[:, :, 3] = 255
    for slot, rgb in SLOT_TO_MILITARY_RGB.items():
        mask = grid == slot
        if np.any(mask):
            rgba[mask, 0] = rgb[0]
            rgba[mask, 1] = rgb[1]
            rgba[mask, 2] = rgb[2]
            rgba[mask, 3] = 255
    return rgba


def verify_palette_compliance(rgba: np.ndarray, label: str, allow_magenta: bool) -> None:
    """Assert 100% strict militaryPalette.ts 16-color compliance and zero alpha blending."""
    alphas = set(np.unique(rgba[:, :, 3]).tolist())
    if not alphas.issubset({0, 255}):
        raise RuntimeError(f"{label} has semi-transparent blended alpha values: {alphas}")
    opaque = rgba[rgba[:, :, 3] == 255][:, :3]
    if opaque.size == 0:
        return
    unique_rgb = {tuple(int(c) for c in row) for row in np.unique(opaque, axis=0)}
    allowed = ALLOWED_MILITARY_RGB | ({MAGENTA_RGB} if allow_magenta else set())
    illegal = unique_rgb - allowed
    if illegal:
        hexes = [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in sorted(illegal)]
        raise RuntimeError(f"{label} contains non-MILITARY colors: {hexes}")


def save_rgba(path: Path, rgba: np.ndarray, allow_magenta: bool = False) -> None:
    verify_palette_compliance(rgba, path.name, allow_magenta=allow_magenta)
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG")


def build_part_strip(drawings: list[list[int]]) -> np.ndarray:
    """Horizontal strip across all poses (poses * 80 x 80), matching partStripRgba."""
    grids = [to_grid(d) for d in drawings]
    strip_slots = np.concatenate(grids, axis=1)
    return slots_to_rgba(strip_slots, magenta_bg=False)


def render_sheet(poses: list[np.ndarray], cols: int, rows: int) -> np.ndarray:
    sheet = np.zeros((rows * HEIGHT, cols * WIDTH, 4), dtype=np.uint8)
    sheet[:, :, 0] = 255
    sheet[:, :, 2] = 255
    sheet[:, :, 3] = 255
    for idx, grid in enumerate(poses):
        r = idx // cols
        c = idx % cols
        if r >= rows:
            break
        y0, x0 = r * HEIGHT, c * WIDTH
        sheet[y0 : y0 + HEIGHT, x0 : x0 + WIDTH] = slots_to_rgba(grid, magenta_bg=True)
    return sheet


def main() -> None:
    v1_protected = [
        V1_RIG_DIR,
        V1_FRAMES_DIR,
        UNITS_DIR / "frames" / "jap_infantry_polished",
        UNITS_DIR / "vector" / "frames" / "jap_infantry",
        UNITS_DIR / "vector" / "frames" / "jap_infantry_polished",
        V1_WALK_SHEET,
    ]
    before_hashes = snapshot_hashes(v1_protected)

    # Duplicate jap_walk.png -> jap_walk_v2.png byte-for-byte
    shutil.copy2(V1_WALK_SHEET, V2_WALK_SHEET)

    # Load v1 rig & parts (read-only)
    rig_data = json.loads((V1_RIG_DIR / "rig.json").read_text(encoding="utf-8"))
    part_files: dict[str, dict] = {}
    for entry in rig_data["parts"]:
        pid = entry["id"]
        part_files[pid] = json.loads((V1_RIG_DIR / f"part_{pid}.json").read_text(encoding="utf-8"))

    legs_drawings = copy.deepcopy(part_files["legs_original"]["drawings"])
    torso_drawings = copy.deepcopy(part_files["torso_original"]["drawings"])
    head_drawings = copy.deepcopy(part_files["head_original"]["drawings"])
    weapon_drawings = copy.deepcopy(part_files["weapon_original"]["drawings"])

    # Walk Frame 1 (Pose 0) clean references
    head0 = to_grid(head_drawings[0])
    clean_torso0 = build_clean_frame1_torso(to_grid(torso_drawings[0]))

    # Upright poses 8..15 integer (dx, dy) offsets:
    # - Idle/Ready Frames 9-12 (Poses 8..11): dy=0 on 8, dy=+1 on recoil 9, dy=0 on 10 & 11
    # - Upright Firing Frames 1-4 (Poses 12..15): aligned to neck, dy=+1 on recoil 13
    upright_offsets: dict[int, tuple[int, int]] = {
        8: (0, 0),
        9: (0, 1),
        10: (0, 0),
        11: (0, 0),
        12: (-1, 0),
        13: (0, 1),
        14: (1, 0),
        15: (0, 0),
    }

    for pose, (dx, dy) in upright_offsets.items():
        raw_pose = to_grid(torso_drawings[pose])
        head_drawings[pose] = from_grid(shift_grid(head0, dx, dy))
        torso_drawings[pose] = from_grid(shift_grid(clean_torso0, dx, dy))
        legs_drawings[pose] = from_grid(clean_upright_legs(raw_pose, pose, dx, dy))
        weapon_drawings[pose] = [0] * CELLS

    # Also stamp alternate swappable helmets onto upright poses 8..15 while keeping 0..7 untouched
    alt_head_ids = ["head_stahlhelm", "head_brodie_helmet", "head_ushanka", "head_peaked_cap"]
    alt_heads: dict[str, list[list[int]]] = {}
    for hid in alt_head_ids:
        drawings = copy.deepcopy(part_files[hid]["drawings"])
        h0 = to_grid(drawings[0])
        for pose, (dx, dy) in upright_offsets.items():
            drawings[pose] = from_grid(shift_grid(h0, dx, dy))
        for pose in range(16, 20):
            drawings[pose] = [0] * CELLS
        alt_heads[hid] = drawings

    # Falling Frames 1-4 (Poses 16..19)
    falling_cleaners = {
        16: clean_pose_16,
        17: clean_pose_17,
        18: clean_pose_18,
        19: clean_pose_19,
    }
    for pose, cleaner in falling_cleaners.items():
        raw_pose = to_grid(torso_drawings[pose])
        legs_g, torso_g, head_g = cleaner(raw_pose)
        legs_drawings[pose] = from_grid(legs_g)
        torso_drawings[pose] = from_grid(torso_g)
        head_drawings[pose] = from_grid(head_g)
        weapon_drawings[pose] = [0] * CELLS

    # Verify Walk Frames 1-8 (Poses 0..7) are 100% untouched byte-for-byte across all layers
    for pose in range(8):
        assert legs_drawings[pose] == part_files["legs_original"]["drawings"][pose]
        assert torso_drawings[pose] == part_files["torso_original"]["drawings"][pose]
        assert head_drawings[pose] == part_files["head_original"]["drawings"][pose]
        assert weapon_drawings[pose] == part_files["weapon_original"]["drawings"][pose]
        for hid in alt_head_ids:
            assert alt_heads[hid][pose] == part_files[hid]["drawings"][pose]
    for pose in range(8, 20):
        assert all(v == 0 for v in weapon_drawings[pose]), f"Weapon layer not empty on pose {pose}"

    # Write rigs/jap_infantry_v2
    V2_RIG_DIR.mkdir(parents=True, exist_ok=True)
    v2_rig = copy.deepcopy(rig_data)
    v2_rig["unitId"] = "jap_infantry_v2"
    if not any(p["id"] == "weapon_empty" for p in v2_rig["parts"]):
        v2_rig["parts"].append({"id": "weapon_empty", "name": "Unarmed (empty)", "layer": "weapon"})
    (V2_RIG_DIR / "rig.json").write_text(json.dumps(v2_rig, indent=2) + "\n", encoding="utf-8")

    updated_drawings: dict[str, list[list[int]]] = {
        "legs_original": legs_drawings,
        "torso_original": torso_drawings,
        "head_original": head_drawings,
        "weapon_original": weapon_drawings,
        "weapon_empty": [[0] * CELLS for _ in range(20)],
        **alt_heads,
    }

    for entry in v2_rig["parts"]:
        pid = entry["id"]
        p_doc = {
            "kind": "rig-part",
            "version": 1,
            "id": pid,
            "name": entry["name"],
            "layer": entry["layer"],
            "width": WIDTH,
            "height": HEIGHT,
            "drawings": updated_drawings[pid],
        }
        (V2_RIG_DIR / f"part_{pid}.json").write_text(json.dumps(p_doc, indent=2) + "\n", encoding="utf-8")
        save_rgba(V2_RIG_DIR / f"part_{pid}.png", build_part_strip(updated_drawings[pid]), allow_magenta=False)

    # Composite all 20 poses
    composited_poses: list[np.ndarray] = []
    for pose in range(20):
        comp = composite_pose(
            to_grid(legs_drawings[pose]),
            to_grid(torso_drawings[pose]),
            to_grid(head_drawings[pose]),
            to_grid(weapon_drawings[pose]),
        )
        composited_poses.append(comp)

    # Save #FF00FF magenta sprite sheets (Walk+Idle 3x4 poses 0..11, Fire+Fall 3x3 poses 12..19)
    sheet_walk_idle = render_sheet(composited_poses[0:12], cols=3, rows=4)
    sheet_fire_fall = render_sheet(composited_poses[12:20], cols=3, rows=3)
    save_rgba(V2_RIG_DIR / "sheet_walk_idle_v2.png", sheet_walk_idle, allow_magenta=True)
    save_rgba(V2_RIG_DIR / "sheet_fire_fall_v2.png", sheet_fire_fall, allow_magenta=True)

    # Write frames/jap_infantry_v2 + rig frame PNGs
    V2_FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    clip_names: dict[str, list[str]] = {"idle": [], "walk": [], "fire": [], "damaged": []}

    for clip_key in ("idle", "walk", "fire", "damaged"):
        for idx, item in enumerate(v2_rig["clips"][clip_key]):
            pose = int(item["pose"])
            fname = f"{clip_key}_{idx}"
            clip_names[clip_key].append(fname)

            # Save transparent PNG strictly in the 16-color MILITARY palette
            rgba = slots_to_rgba(composited_poses[pose], magenta_bg=False)
            save_rgba(V2_RIG_DIR / f"{fname}.png", rgba, allow_magenta=False)
            save_rgba(V2_FRAMES_DIR / f"{fname}.png", rgba, allow_magenta=False)

            # For Walk Frames 1-8 (walk_0..7) and idle_0 (pose 0), copy v1 frame JSON byte-for-byte!
            v1_frame_json = V1_FRAMES_DIR / f"{fname}.json"
            v2_frame_json = V2_FRAMES_DIR / f"{fname}.json"
            if clip_key == "walk" or (clip_key == "idle" and idx == 0):
                shutil.copy2(v1_frame_json, v2_frame_json)
            else:
                frame_doc = {
                    "kind": "sprite-frame",
                    "version": 1,
                    "width": WIDTH,
                    "height": HEIGHT,
                    "layers": {
                        "legs": legs_drawings[pose],
                        "torso": torso_drawings[pose],
                        "head": head_drawings[pose],
                        "weapon": weapon_drawings[pose],
                    },
                    "muzzle": None,
                    "flash": False,
                }
                v2_frame_json.write_text(json.dumps(frame_doc, indent=2) + "\n", encoding="utf-8")

    clips_doc = {
        "kind": "sprite-clips",
        "version": 1,
        "unitId": "jap_infantry_v2",
        "factionId": "JAP",
        "unitTypeId": "infantry",
        "width": WIDTH,
        "height": HEIGHT,
        "feet": v2_rig["feet"],
        "clips": clip_names,
    }
    (V2_FRAMES_DIR / "clips.json").write_text(json.dumps(clips_doc, indent=2) + "\n", encoding="utf-8")

    # Verify v1 files were 100% untouched byte-for-byte
    after_hashes = snapshot_hashes(v1_protected)
    if before_hashes != after_hashes:
        raise RuntimeError("ERROR: v1 files were modified!")

    print(f"Built {V2_RIG_DIR}")
    print(f"Built {V2_FRAMES_DIR} ({sum(len(v) for v in clip_names.values())} frames)")
    print("Verified: Walk Poses 0..7 untouched across all layers; v1 SHA-256 hashes 100% unchanged; 16-color MILITARY compliance passed.")


if __name__ == "__main__":
    main()
