#!/usr/bin/env python3
"""Give every outlined unit sprite the same light, so the set reads as one hand.

Input is each *.outlined.quantized.png under web/assets/candidates (the
"quantisized" spelling too). Names with "bad" and anything already polished are
skipped. The result sits beside the original: unit.outlined.quantized.png
becomes unit.outlined.polished.png. The original is never touched.

Everything works on palette indices. Each opaque pixel (alpha > 128) is snapped
to the nearest of the 16 fading-16 colors first. Transparent pixels (alpha <=
128) stay transparent and are never read as color. Output alpha is 0 or 255 and
the opaque mask is identical to the input's. Only exact palette colors are
written, and the script checks that on the way out.

Palette ramps
    The 16 colors are grouped into ordered ramps, bright to dark: Highlight,
    Base, Shadow (and a fourth, lower Shadow when a family has four members).
    The darkest swatch is the shared Deep end of every ramp and is never a ramp
    interior step. The second outline color (see below) is also kept out of the
    ramps. Low-chroma swatches form one grey ramp. The rest are grouped by
    average-linkage clustering in Lab, then sorted by luminance. The ramps are
    printed on every run. RAMP_OVERRIDES below wins over the automatic result.

    The darkest swatch is found by luminance (2126 R + 7152 G + 722 B), not by
    a hard-coded hex. In fading-16 that is #4b3d44. The darker brown #3b322c
    that once came up is not in this palette.

Step A, despeckle
    A 3x3 mode filter, two passes, over the interior fill. The vote only counts
    opaque pixels that are not protected. Protected pixels do not change and are
    never voted in. Protected means the two outline colors plus the other dark
    neutrals among the four darkest swatches (#645355 in fading-16). Panel
    lines, barrels and antennas drawn in those survive; the first version
    protected only the two outline colors and ate the panel lines on a fighter.
    A 1px line drawn in an ordinary interior color between two larger blocks
    will still be eaten. That is the point, but it is also the one thing this
    step can damage. Ties go to the pixel's own color, then to the lowest index.

Step B, light from the top left (dx = -1, dy = -1)
    All shifts are computed from the despeckled image, so scan order does not
    matter. A pixel on any ramp step moves one step along its ramp and clamps
    at the ends (SHIFT_BASE_ONLY = True would move only the Base step for a
    strict three-tone read; it is off because the uneven fading-16 ramps left a
    whole fighter untouched). A step is refused if it would jump across more
    than STEP_MAX_DELTA in Lab, e.g. brown to teal.
    - Rim: pixel with a transparent or dark-border neighbour above or to the
      left goes one step brighter.
    - Self-shadow: pixel with a transparent or dark-border neighbour below or
      to the right goes one step darker.
    - A pixel that qualifies for both is left unchanged. Highlight only wins
      when there is no bottom or right trigger.
    - "Dark border" is an outline-colored pixel, or a pixel on the silhouette
      border (those are recolored to outline colors in the next step).
    - Pixels whose opaque run is 1px wide or 1px tall (thin barrels, antennas)
      are excluded from both shifts, so they do not turn cream.
    The Base step is the second-brightest step of its ramp (the middle step of
    a three-step ramp). It is marked in the printed ramps.

Selective outlining
    On the silhouette border (opaque pixels 4-adjacent to transparency or the
    image edge): a pixel with a transparent neighbour above or to the left gets
    the second outline color; a pixel with a transparent neighbour below or to
    the right gets the darkest swatch. Facing both: darkest wins.
    The second outline color is the second-darkest low-chroma swatch (the
    neutral outline family), not the second-darkest by luminance alone. That
    would be #774251, a maroon that belongs to the red ramp. OUTLINE_LIGHT_INDEX
    pins it by hand.

From web/:

    python scripts/unify_shading.py
    python scripts/unify_shading.py --limit 4
    python scripts/unify_shading.py --limit 4 --seed 7 --dry-run

Or, from the repo root or from web/:

    npm run polish:units -- --limit 4

Clip mode, for a whole animation:

    python scripts/unify_shading.py --clips public/assets/units/frames/jap_infantry/clips.json

--clips reads a "sprite-clips" version-1 file (the same one vectorize_units.py
--clips reads). Every frame it names (idle, walk, fire) is polished in one run
with the one set of ramps and constants above, so the same palette color gets
the same treatment in every frame. The PNG frames are read; the per-frame
.json layer files are ignored. The result goes to a NEW folder, by default the
source folder name plus "_polished" beside it (frames/jap_infantry_polished),
with the same frame file names and a copy of clips.json. The source folder is
never written, and --out is refused if it is the source folder. A frame that
appears in two clips is polished once. Frames whose snapped palette indices are
identical must come out byte-identical; the run checks that and stops if not.
--dry-run writes nothing. --limit, --seed and --diverse do not apply.

--protect 14 (comma-separated palette indices, empty by default) adds colors
that despeckle must neither change nor count as votes. The Japanese infantry
draws its eyes, brows and boot soles as 1x2 and 1x1 marks in #846d59, which is
ordinary interior color, so the mode filter ate the eyes. Use:

    python scripts/unify_shading.py --clips public/assets/units/frames/jap_infantry/clips.json --protect 14

The ramps, the shift and the sel-out are the same with or without it, and the
candidate batch never passes it, so its outputs do not change.

--limit takes a random sample. With --diverse (the default whenever --limit is
set) it picks greedily so the faction and the unit type differ where they can.
--seed makes both reproducible and is printed when it is chosen for you.

Requires Pillow and numpy.
"""

from __future__ import annotations

import argparse
import colorsys
import fnmatch
import json
import random
import re
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError as error:
    missing = getattr(error, "name", None) or error
    sys.exit(f"unify_shading needs Pillow and numpy. Missing: {missing}")

WEB_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = WEB_ROOT / "public"
PALETTE_NAME = "fading-16-32x.png"
PALETTE_SEARCH = [
    PUBLIC_ROOT / "assets" / "units" / PALETTE_NAME,
    WEB_ROOT / "assets" / "palettes" / PALETTE_NAME,
    Path.home() / "Downloads" / PALETTE_NAME,
]
DEFAULT_CANDIDATES = WEB_ROOT / "assets" / "candidates"

ALPHA_CUT = 128
PALETTE_COUNT = 16
TRANSPARENT = 255  # index for "no pixel" in the working array
DESPECKLE_PASSES = 2

# Swatches with Lab chroma under this are neutral. They make one grey ramp and
# are the outline family.
GREY_CHROMA = 12.0
# The chromatic swatches are merged down to this many ramps.
CHROMATIC_RAMPS = 3
# Lightness counts for a quarter of a hue step when swatches are compared.
LIGHTNESS_WEIGHT = 0.25

# Which ramp steps the light may move. False: any step moves one step toward
# the light or away from it, clamped at the ends. True: only the Base step moves.
# Base-only gives a strict three-tone read, but the fading-16 ramps are uneven
# and real sprites sit mostly on Shadow steps, so base-only left a 7,500 pixel
# fighter completely flat.
SHIFT_BASE_ONLY = False
# A ramp step is refused if the two swatches are further apart than this in Lab.
STEP_MAX_DELTA = 22.0

# Despeckle also protects any low-chroma swatch among this many of the darkest.
PROTECTED_DARKEST = 4

# Hand-written ramps win over the automatic grouping. Palette indices, bright to
# dark, Deep left out. Example: {"tan": [0, 1, 15, 14], "red": [2, 3, 4]}
# Swatches named here are removed from the automatic pass, and the rest are
# still grouped on their own.
RAMP_OVERRIDES: dict[str, list[int]] = {}
# Pin the outline colors by palette index. None means "find them".
OUTLINE_DEEP_INDEX: int | None = None
OUTLINE_LIGHT_INDEX: int | None = None

# Extra palette indices despeckle must leave alone, on top of the outline colors
# and the dark neutrals. Empty for the candidate batch. --protect fills it for a
# run; use it when a small feature (eyes, a sole) is drawn in an ordinary color.
EXTRA_PROTECTED: set[int] = set()

STEP_LABELS = ["Highlight", "Base", "Shadow", "Shadow-2", "Shadow-3"]

Rgb = tuple[int, int, int]


def luminance(rgb: Rgb) -> int:
    red, green, blue = rgb
    return 2126 * red + 7152 * green + 722 * blue


def hex_color(rgb: Rgb) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def read_palette(path: Path) -> list[Rgb]:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    if width % PALETTE_COUNT != 0 or height < 1:
        raise SystemExit(f"{path} is {width} by {height}; expected 16 equal swatches.")
    band = width // PALETTE_COUNT
    pixels = image.load()
    colors: list[Rgb] = []
    for index in range(PALETTE_COUNT):
        left = index * band
        swatch = pixels[left + band // 2, height // 2]
        color = (int(swatch[0]), int(swatch[1]), int(swatch[2]))
        for y in range(height):
            for x in range(left, left + band):
                pixel = pixels[x, y]
                if (int(pixel[0]), int(pixel[1]), int(pixel[2])) != color:
                    raise SystemExit(f"Swatch {index} in {path} is not a flat color.")
        colors.append(color)
    if len(set(colors)) != PALETTE_COUNT:
        raise SystemExit(f"{path} does not contain {PALETTE_COUNT} distinct colors.")
    return colors


def find_palette(explicit: Path | None) -> Path:
    if explicit is not None:
        path = explicit if explicit.is_absolute() else Path.cwd() / explicit
        if not path.is_file():
            raise SystemExit(f"Palette not found: {path}")
        return path
    for path in PALETTE_SEARCH:
        if path.is_file():
            return path
    tried = ", ".join(str(path) for path in PALETTE_SEARCH)
    raise SystemExit(f"Palette not found. Tried: {tried}")


# ---------------------------------------------------------------------------
# Ramps


def to_lab(rgb: Rgb) -> np.ndarray:
    linear = np.asarray(rgb, dtype=np.float64) / 255.0
    linear = np.where(linear > 0.04045, ((linear + 0.055) / 1.055) ** 2.4, linear / 12.92)
    matrix = np.array(
        [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]]
    )
    x, y, z = (matrix @ linear) / np.array([0.95047, 1.0, 1.08883])

    def curve(value: float) -> float:
        return float(np.cbrt(value)) if value > 216 / 24389 else (24389 / 27 * value + 16) / 116

    fx, fy, fz = curve(float(x)), curve(float(y)), curve(float(z))
    return np.array([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)])


def chroma(lab: np.ndarray) -> float:
    return float(np.hypot(lab[1], lab[2]))


def hue_degrees(lab: np.ndarray) -> float:
    return float(np.degrees(np.arctan2(lab[2], lab[1])) % 360)


def cluster_indices(indices: list[int], labs: dict[int, np.ndarray], count: int) -> list[list[int]]:
    """Average-linkage clustering. Ties break on the lowest index, so it is deterministic."""
    weight = np.array([LIGHTNESS_WEIGHT, 1.0, 1.0])
    clusters = [[index] for index in sorted(indices)]

    def distance(first: list[int], second: list[int]) -> float:
        return float(np.mean([np.linalg.norm((labs[a] - labs[b]) * weight) for a in first for b in second]))

    while len(clusters) > max(count, 1):
        best: tuple[float, int, int] | None = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                found = (distance(clusters[i], clusters[j]), i, j)
                if best is None or found < best:
                    best = found
        assert best is not None
        _, i, j = best
        clusters[i] = sorted(clusters[i] + clusters[j])
        del clusters[j]
    return clusters


def ramp_name(members: list[int], labs: dict[int, np.ndarray]) -> str:
    mean_chroma = float(np.mean([chroma(labs[i]) for i in members]))
    if mean_chroma < GREY_CHROMA:
        return "slate/grey"
    a = float(np.mean([labs[i][1] for i in members]))
    b = float(np.mean([labs[i][2] for i in members]))
    hue = float(np.degrees(np.arctan2(b, a)) % 360)
    if hue < 60:
        return "brick red"
    if hue < 98:
        return "desert tan"
    return "olive/sage"


class Roles:
    """The detected structure: ramps, the two outline colors, and what is left over."""

    def __init__(self, palette: list[Rgb]) -> None:
        self.palette = palette
        labs = {index: to_lab(color) for index, color in enumerate(palette)}
        self.labs = labs
        by_dark = sorted(range(len(palette)), key=lambda i: (luminance(palette[i]), sum(palette[i]), i))

        self.deep = OUTLINE_DEEP_INDEX if OUTLINE_DEEP_INDEX is not None else by_dark[0]
        neutral_dark = [i for i in by_dark if i != self.deep and chroma(labs[i]) < GREY_CHROMA]
        if OUTLINE_LIGHT_INDEX is not None:
            self.light = OUTLINE_LIGHT_INDEX
        elif neutral_dark:
            self.light = neutral_dark[0]
        else:
            self.light = by_dark[1]
        if self.light == self.deep:
            raise SystemExit("The two outline colors must differ.")
        self.outline = {self.deep, self.light}
        self.literal_second = [i for i in by_dark if i != self.deep][0]
        # Panel lines and rigging are drawn in the dark neutrals, not only in the
        # two outline colors. Despeckle leaves those alone as well.
        self.protected = set(self.outline) | {
            i for i in by_dark[:PROTECTED_DARKEST] if chroma(labs[i]) < GREY_CHROMA
        }
        for extra in EXTRA_PROTECTED:
            if not 0 <= extra < len(palette):
                raise SystemExit(f"--protect: index {extra} is not in the palette.")
            self.protected.add(extra)

        taken: set[int] = set(self.outline)
        ramps: list[tuple[str, list[int]]] = []
        for name, members in RAMP_OVERRIDES.items():
            for member in members:
                if not 0 <= member < len(palette):
                    raise SystemExit(f"RAMP_OVERRIDES {name}: index {member} is not in the palette.")
                if member in taken:
                    raise SystemExit(f"RAMP_OVERRIDES {name}: index {member} is already an outline color or in another ramp.")
                taken.add(member)
            ramps.append((name, list(members)))

        free = [i for i in range(len(palette)) if i not in taken]
        grey = [i for i in free if chroma(labs[i]) < GREY_CHROMA]
        chromatic = [i for i in free if i not in grey]
        groups: list[list[int]] = []
        if grey:
            groups.append(grey)
        if chromatic:
            groups.extend(cluster_indices(chromatic, labs, CHROMATIC_RAMPS))
        for members in groups:
            ordered = sorted(members, key=lambda i: (-luminance(palette[i]), i))
            ramps.append((ramp_name(members, labs), ordered))
        self.ramps = ramps

        self.ramp_of = np.full(len(palette), -1, dtype=np.int16)
        self.step_of = np.full(len(palette), -1, dtype=np.int16)
        for ramp_id, (_name, members) in enumerate(self.ramps):
            for step, member in enumerate(members):
                self.ramp_of[member] = ramp_id
                self.step_of[member] = step
        listed = sorted(i for _n, members in self.ramps for i in members) + sorted(self.outline)
        self.leftovers = [i for i in range(len(palette)) if i not in listed]
        if len(listed) != len(set(listed)):
            raise SystemExit("A palette color landed in two ramps.")

    def base_step(self, members: list[int]) -> int:
        return 0 if len(members) < 3 else 1

    def step_delta(self, first: int, second: int) -> float:
        return float(np.linalg.norm(self.labs[first] - self.labs[second]))

    def lookup_tables(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Per-color: may the light move it, and what is one step brighter and darker.

        Steps clamp at the ramp ends. A step is also refused when the two swatches
        are further apart than STEP_MAX_DELTA in Lab, so a brown does not jump to
        a teal just because luminance put them next to each other.
        """
        size = len(self.palette)
        movable = np.zeros(size, dtype=bool)
        brighter = np.arange(size, dtype=np.uint8)
        darker = np.arange(size, dtype=np.uint8)
        for _name, members in self.ramps:
            base = self.base_step(members)
            for step, color in enumerate(members):
                if SHIFT_BASE_ONLY and step != base:
                    continue
                movable[color] = True
                up = members[max(step - 1, 0)]
                down = members[min(step + 1, len(members) - 1)]
                if self.step_delta(color, up) <= STEP_MAX_DELTA:
                    brighter[color] = up
                if self.step_delta(color, down) <= STEP_MAX_DELTA:
                    darker[color] = down
        return movable, brighter, darker

    def report(self) -> None:
        deep = self.palette[self.deep]
        print(f"deep outline {hex_color(deep)} (index {self.deep}, darkest swatch by luminance)")
        light = self.palette[self.light]
        print(f"sel-out light {hex_color(light)} (index {self.light}, second-darkest low-chroma swatch)")
        literal = self.palette[self.literal_second]
        if self.literal_second != self.light:
            print(f"  note: second-darkest by luminance alone is {hex_color(literal)} (index {self.literal_second}); not used")
        held = " ".join(f"{hex_color(self.palette[i])}[{i}]" for i in sorted(self.protected))
        print(f"despeckle protects: {held}")
        print(f"ramps ({len(self.ramps)}), bright to dark, Deep {hex_color(deep)} closes each:")
        for ramp_id, (name, members) in enumerate(self.ramps):
            base = self.base_step(members)
            steps = []
            for step, member in enumerate(members):
                label = STEP_LABELS[step] if step < len(STEP_LABELS) else f"Step-{step}"
                mark = "*" if step == base else ""
                steps.append(f"{label}{mark} {hex_color(self.palette[member])}[{member}]")
            steps.append(f"Deep {hex_color(deep)}[{self.deep}]")
            print(f"  {ramp_id + 1}. {name}: " + " > ".join(steps))
        scope = "the only step the light moves" if SHIFT_BASE_ONLY else "the middle of the read; every step shifts, clamped"
        print(f"  (* is the Base step, {scope})")
        if self.leftovers:
            left = " ".join(f"{hex_color(self.palette[i])}[{i}]" for i in self.leftovers)
            print(f"  leftovers: {left}")
        else:
            print("  leftovers: none")


# ---------------------------------------------------------------------------
# Image work


def snap_indices(image: Image.Image, palette: list[Rgb]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rgba = np.asarray(image.convert("RGBA"))
    rgb = rgba[..., :3].astype(np.int32)
    opaque = rgba[..., 3] > ALPHA_CUT
    flat = rgb.reshape(-1, 3)
    colors = np.asarray(palette, dtype=np.int32)
    distance = np.sum((flat[:, None, :] - colors[None, :, :]) ** 2, axis=2)
    nearest = np.argmin(distance, axis=1).astype(np.uint8).reshape(opaque.shape)
    nearest[~opaque] = TRANSPARENT
    return nearest, opaque, rgba[..., :3]


def shifted(array: np.ndarray, dy: int, dx: int, fill) -> np.ndarray:
    """The value of the neighbour at (y + dy, x + dx), with fill outside the image."""
    height, width = array.shape
    padded = np.pad(array, 1, mode="constant", constant_values=fill)
    return padded[1 + dy : 1 + dy + height, 1 + dx : 1 + dx + width]


def despeckle(indices: np.ndarray, outline: set[int], size: int) -> np.ndarray:
    protected = np.isin(indices, list(outline))
    opaque = indices != TRANSPARENT
    voters = opaque & ~protected
    current = indices.copy()
    for _ in range(DESPECKLE_PASSES):
        counts = np.zeros((size,) + current.shape, dtype=np.int32)
        for color in range(size):
            hit = voters & (current == color)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    counts[color] += shifted(hit, dy, dx, False)
        # Score: votes first, then the pixel's own color, then the lowest index.
        score = counts * 64 + (15 - np.arange(size, dtype=np.int32))[:, None, None]
        own = (current[None, :, :] == np.arange(size)[:, None, None]).astype(np.int32)
        score = score + own * 32
        winner = np.argmax(score, axis=0).astype(np.uint8)
        current = np.where(voters, winner, current)
    return current


def silhouette_edges(opaque: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "up": opaque & ~shifted(opaque, -1, 0, False),
        "left": opaque & ~shifted(opaque, 0, -1, False),
        "down": opaque & ~shifted(opaque, 1, 0, False),
        "right": opaque & ~shifted(opaque, 0, 1, False),
    }


def thin_pixels(opaque: np.ndarray) -> np.ndarray:
    up = shifted(opaque, -1, 0, False)
    down = shifted(opaque, 1, 0, False)
    left = shifted(opaque, 0, -1, False)
    right = shifted(opaque, 0, 1, False)
    return opaque & ((~left & ~right) | (~up & ~down))


def shade(indices: np.ndarray, roles: Roles, opaque: np.ndarray) -> tuple[np.ndarray, int, int]:
    movable, brighter, darker = roles.lookup_tables()
    edges = silhouette_edges(opaque)
    border = edges["up"] | edges["left"] | edges["down"] | edges["right"]
    dark = np.isin(indices, list(roles.outline)) | border
    clear = ~opaque

    def blocked(dy: int, dx: int) -> np.ndarray:
        return shifted(clear, dy, dx, True) | shifted(dark, dy, dx, False)

    light_trigger = blocked(-1, 0) | blocked(0, -1)
    shadow_trigger = blocked(1, 0) | blocked(0, 1)
    safe_index = np.where(indices == TRANSPARENT, 0, indices)
    eligible = opaque & movable[safe_index] & ~dark & ~thin_pixels(opaque)
    rim = eligible & light_trigger & ~shadow_trigger
    shadow = eligible & shadow_trigger & ~light_trigger
    out = indices.copy()
    out[rim] = brighter[indices[rim]]
    out[shadow] = darker[indices[shadow]]
    return out, int(rim.sum()), int(shadow.sum())


def sel_out(indices: np.ndarray, roles: Roles, opaque: np.ndarray) -> np.ndarray:
    edges = silhouette_edges(opaque)
    facing_light = edges["up"] | edges["left"]
    facing_shadow = edges["down"] | edges["right"]
    out = indices.copy()
    out[facing_light] = roles.light
    out[facing_shadow] = roles.deep
    return out


def polish(indices: np.ndarray, opaque: np.ndarray, roles: Roles) -> tuple[np.ndarray, dict[str, int]]:
    size = len(roles.palette)
    cleaned = despeckle(indices, roles.protected, size)
    shaded, rims, shadows = shade(cleaned, roles, opaque)
    final = sel_out(shaded, roles, opaque)
    stats = {
        "despeckle": int((cleaned != indices).sum()),
        "rim": rims,
        "shadow": shadows,
        "selout": int((final != shaded).sum()),
        "total": int((final != indices).sum()),
    }
    return final, stats


def render(indices: np.ndarray, source_rgb: np.ndarray, palette: list[Rgb]) -> Image.Image:
    height, width = indices.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[..., :3] = source_rgb
    colors = np.asarray(palette, dtype=np.uint8)
    solid = indices != TRANSPARENT
    rgba[solid, :3] = colors[indices[solid]]
    rgba[solid, 3] = 255
    rgba[~solid, 3] = 0
    return Image.fromarray(rgba, "RGBA")


def self_check(output: Image.Image, source: Image.Image, palette: list[Rgb]) -> None:
    out = np.asarray(output.convert("RGBA"))
    alpha = out[..., 3]
    if not bool(np.all((alpha == 0) | (alpha == 255))):
        raise SystemExit("Self-check failed: output alpha is not 0 or 255.")
    source_mask = np.asarray(source.convert("RGBA"))[..., 3] > ALPHA_CUT
    if not np.array_equal(alpha == 255, source_mask):
        raise SystemExit("Self-check failed: the transparency mask changed.")
    allowed = {color for color in palette}
    used = {(int(r), int(g), int(b)) for r, g, b in out[alpha == 255][:, :3]}
    stray = used - allowed
    if stray:
        raise SystemExit(f"Self-check failed: colors outside the palette: {sorted(hex_color(c) for c in stray)}")


# ---------------------------------------------------------------------------
# Files


def polished_name(name: str) -> str | None:
    """unit.outlined.quantized.png -> unit.outlined.polished.png. Never .quantized.polished."""
    swapped, count = re.subn(r"quant(?:ized|isized)", "polished", name, count=1, flags=re.IGNORECASE)
    if count == 0 or not swapped.lower().endswith(".png"):
        return None
    return swapped


def is_candidate_name(name: str) -> bool:
    lowered = name.lower()
    return (
        fnmatch.fnmatch(lowered, "*outlined*quant*")
        and lowered.endswith(".png")
        and "bad" not in lowered
        and "polished" not in lowered
    )


def find_candidates(folder: Path) -> list[Path]:
    files = [path for path in folder.rglob("*.png") if path.is_file() and is_candidate_name(path.name)]
    return sorted(files, key=lambda path: path.as_posix().lower())


def candidate_index(folder: Path) -> dict[str, dict]:
    manifest = folder / "manifest.json"
    if not manifest.is_file():
        return {}
    data = json.loads(manifest.read_text(encoding="utf-8"))
    index: dict[str, dict] = {}
    for row in data.get("candidates", []):
        quantized = row.get("quantized")
        if isinstance(quantized, str):
            index[quantized.replace("\\", "/")] = row
    return index


def unit_identity(path: Path, index: dict[str, dict]) -> tuple[str, str]:
    """(factionId, unitTypeId) from the manifest, else from the folder and file name."""
    try:
        relative = path.resolve().relative_to(WEB_ROOT).as_posix()
    except ValueError:
        relative = ""
    row = index.get(relative, {})
    faction = row.get("factionId") if isinstance(row.get("factionId"), str) else path.parent.name
    unit_type = row.get("unitTypeId") if isinstance(row.get("unitTypeId"), str) else None
    if unit_type is None:
        stem = path.name.split(".", 1)[0]
        stem = re.sub(r"_seed\d+.*$", "", stem)
        prefix = f"{faction.lower()}_"
        unit_type = stem[len(prefix) :] if stem.lower().startswith(prefix) else stem
    return faction, unit_type


def pick_random(files: list[Path], count: int, seed: int) -> list[Path]:
    return sorted(random.Random(seed).sample(files, count), key=lambda path: path.as_posix().lower())


def pick_diverse(files: list[Path], count: int, seed: int, index: dict[str, dict]) -> list[Path]:
    """Greedy: prefer a new unit type and a new faction, break ties with the seeded RNG."""
    rng = random.Random(seed)
    pool = list(files)
    rng.shuffle(pool)
    identity = {path: unit_identity(path, index) for path in pool}
    chosen: list[Path] = []
    factions: set[str] = set()
    types: set[str] = set()
    while pool and len(chosen) < count:
        def score(path: Path) -> tuple[int, int]:
            faction, unit_type = identity[path]
            new_type = unit_type not in types
            new_faction = faction not in factions
            return (int(new_type) * 2 + int(new_faction), int(new_type))

        best = max(score(path) for path in pool)
        pick = next(path for path in pool if score(path) == best)
        pool.remove(pick)
        chosen.append(pick)
        factions.add(identity[pick][0])
        types.add(identity[pick][1])
    return sorted(chosen, key=lambda path: path.as_posix().lower())


CLIP_FRAME_NAME = re.compile(r"(idle|walk|fire)_\d+")


def polish_clips(clips_path: Path, out_dir: Path | None, palette: list[Rgb], roles: Roles, dry_run: bool) -> int:
    """Polish every frame of a sprite clip list into a new folder. See the docstring."""
    path = clips_path if clips_path.is_absolute() else Path.cwd() / clips_path
    if not path.is_file():
        raise SystemExit(f"Clips file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    clips = data.get("clips") if isinstance(data, dict) else None
    if not isinstance(clips, dict):
        raise SystemExit(f"{path} has no clips.")
    if data.get("kind") != "sprite-clips" or data.get("version") != 1:
        raise SystemExit(f"{path} is not a sprite-clips version 1 file.")
    ordered: dict[str, list[str]] = {}
    names: list[str] = []
    for clip_name in ("idle", "walk", "fire"):
        frames = clips.get(clip_name)
        if not isinstance(frames, list) or not frames:
            raise SystemExit(f"{path} is missing the {clip_name} clip.")
        for frame in frames:
            if not isinstance(frame, str) or not CLIP_FRAME_NAME.fullmatch(frame):
                raise SystemExit(f"Bad frame name in {clip_name}: {frame}")
            if frame not in names:
                names.append(frame)
        ordered[clip_name] = list(frames)

    source_dir = path.parent.resolve()
    destination_dir = (out_dir if out_dir is not None else source_dir.with_name(source_dir.name + "_polished"))
    destination_dir = (destination_dir if destination_dir.is_absolute() else Path.cwd() / destination_dir).resolve()
    if destination_dir == source_dir:
        raise SystemExit(f"Refusing to write into the source folder: {source_dir}")
    print(f"clips {path}")
    print(f"out   {destination_dir}{' (dry run)' if dry_run else ''}")

    results: dict[str, tuple[np.ndarray, np.ndarray, Image.Image, bytes]] = {}
    totals = {"despeckle": 0, "rim": 0, "shadow": 0, "selout": 0, "total": 0}
    for name in names:
        source_path = source_dir / f"{name}.png"
        if not source_path.is_file():
            raise SystemExit(f"Missing frame: {source_path}")
        source = Image.open(source_path)
        width, height = source.size
        if width != data.get("width") or height != data.get("height"):
            raise SystemExit(f"{source_path.name} is {width}x{height}; clips.json says {data.get('width')}x{data.get('height')}.")
        indices, opaque, source_rgb = snap_indices(source, palette)
        final, stats = polish(indices, opaque, roles)
        output = render(final, source_rgb, palette)
        self_check(output, source, palette)
        if not dry_run:
            destination_dir.mkdir(parents=True, exist_ok=True)
            destination = destination_dir / f"{name}.png"
            output.save(destination, format="PNG")
            self_check(Image.open(destination), source, palette)
        results[name] = (indices, final, output, source_path.read_bytes())
        for key in totals:
            totals[key] += stats[key]
        print(
            f"{name}.png {width}x{height} "
            f"despeckle {stats['despeckle']}, rim {stats['rim']}, shadow {stats['shadow']}, "
            f"sel-out {stats['selout']}, changed {stats['total']} of {int(opaque.sum())} opaque"
        )

    # Same snapped input must give the same output.
    groups: dict[bytes, list[str]] = {}
    for name in names:
        groups.setdefault(results[name][0].tobytes(), []).append(name)
    for members in groups.values():
        first = results[members[0]]
        for other in members[1:]:
            second = results[other]
            if not np.array_equal(first[1], second[1]):
                raise SystemExit(f"Determinism check failed: {members[0]} and {other} have identical input but different output.")
    twins = [members for members in groups.values() if len(members) > 1]
    if twins:
        for members in twins:
            print("identical input, identical output: " + ", ".join(members))
    else:
        print("no frames share identical input")

    if not dry_run:
        document = {
            "kind": "sprite-clips",
            "version": 1,
            "unitId": data.get("unitId") if isinstance(data.get("unitId"), str) else source_dir.name,
            "width": data.get("width"),
            "height": data.get("height"),
            "feet": data.get("feet"),
            "clips": ordered,
        }
        clips_out = destination_dir / "clips.json"
        clips_out.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        print(f"clips {clips_out}")
    print(
        f"{'checked' if dry_run else 'polished'} {len(names)} frames "
        f"(despeckle {totals['despeckle']}, rim {totals['rim']}, shadow {totals['shadow']}, sel-out {totals['selout']})"
    )
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Unify the shading of outlined unit PNGs.")
    parser.add_argument("inputs", nargs="*", type=Path, help="Outlined quantized PNGs. Default: every one under the candidates folder.")
    parser.add_argument("--limit", type=int, default=0, help="Polish only this many files, chosen at random.")
    parser.add_argument("--seed", type=int, default=None, help="Seed for --limit. Printed when it is chosen for you.")
    parser.add_argument(
        "--diverse",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="With --limit, vary faction and unit type. On by default when --limit is set.",
    )
    parser.add_argument("--clips", type=Path, default=None, help="A sprite clips.json. Polish idle, walk and fire into a new folder.")
    parser.add_argument("--out", type=Path, default=None, help="With --clips: the output folder. Default: <source folder>_polished beside it.")
    parser.add_argument(
        "--protect",
        type=str,
        default="",
        help="Comma-separated palette indices despeckle must not change or vote in, e.g. 14 for small features drawn in #846d59.",
    )
    parser.add_argument("--palette", type=Path, default=None, help=f"Default: search for {PALETTE_NAME}.")
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--dry-run", action="store_true", help="Run every step and the self-check, write nothing.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    palette_path = find_palette(args.palette)
    palette = read_palette(palette_path)
    print(f"palette {palette_path}")
    print("colors " + " ".join(hex_color(color) for color in palette))
    try:
        EXTRA_PROTECTED.update(int(part) for part in args.protect.split(",") if part.strip())
    except ValueError:
        raise SystemExit("--protect takes palette indices such as 14 or 14,15.")
    roles = Roles(palette)
    roles.report()

    if args.clips:
        return polish_clips(args.clips, args.out, palette, roles, args.dry_run)

    if args.limit < 0:
        raise SystemExit("--limit must be 0 or more.")
    if args.inputs:
        files = [path if path.is_absolute() else Path.cwd() / path for path in args.inputs]
        for path in files:
            if not path.is_file():
                raise SystemExit(f"Not a file: {path}")
            if not is_candidate_name(path.name):
                raise SystemExit(f"Not an outlined quantized candidate: {path.name}")
    else:
        if not args.candidates.is_dir():
            raise SystemExit(f"Candidate folder not found: {args.candidates}")
        files = find_candidates(args.candidates)
    if not files:
        raise SystemExit("No outlined quantized PNGs to polish.")

    index = candidate_index(args.candidates if args.candidates.is_dir() else DEFAULT_CANDIDATES)
    if args.limit and args.limit < len(files):
        seed = args.seed
        if seed is None:
            seed = random.SystemRandom().randrange(1, 10_000_000)
            print(f"seed {seed}")
        else:
            print(f"seed {seed} (given)")
        diverse = True if args.diverse is None else args.diverse
        files = pick_diverse(files, args.limit, seed, index) if diverse else pick_random(files, args.limit, seed)
        print(f"sampling {'diverse' if diverse else 'random'}, {len(files)} files")

    totals = {"despeckle": 0, "rim": 0, "shadow": 0, "selout": 0, "total": 0}
    written = 0
    for path in files:
        target_name = polished_name(path.name)
        if target_name is None:
            print(f"skip {path.name}: cannot name the polished file")
            continue
        destination = path.with_name(target_name)
        source = Image.open(path)
        indices, opaque, source_rgb = snap_indices(source, palette)
        final, stats = polish(indices, opaque, roles)
        output = render(final, source_rgb, palette)
        self_check(output, source, palette)
        if not args.dry_run:
            output.save(destination, format="PNG")
            reread = Image.open(destination)
            self_check(reread, source, palette)
        faction, unit_type = unit_identity(path, index)
        for key in totals:
            totals[key] += stats[key]
        written += 1
        print(
            f"{path.name} -> {destination}{' (dry run)' if args.dry_run else ''} "
            f"[{faction} {unit_type}] {source.width}x{source.height} "
            f"despeckle {stats['despeckle']}, rim {stats['rim']}, shadow {stats['shadow']}, "
            f"sel-out {stats['selout']}, changed {stats['total']} of {int(opaque.sum())} opaque"
        )
    print(
        f"{'checked' if args.dry_run else 'polished'} {written} "
        f"(despeckle {totals['despeckle']}, rim {totals['rim']}, shadow {totals['shadow']}, sel-out {totals['selout']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
