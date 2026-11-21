#!/usr/bin/env python3
"""Trace outlined unit PNGs into exact-palette SVGs.

Each opaque pixel (alpha > 128) is snapped to the nearest of the 16 RGB
colors in the fading-16 palette, then the sprite is scaled 4x with
nearest-neighbor. A solid backing path is the full opaque silhouette, filled
with the darkest palette color, so a zoomed-out unit does not show hairline
gaps between shapes. Every palette color that is actually used is dilated by
one pixel and traced with potrace, which fits those stair-stepped masks to
smooth curves. Each path is filled with that color's exact hex. Scour then
compacts the SVG.

From web/:

    python scripts/vectorize_units.py
    python scripts/vectorize_units.py --limit 4
    python scripts/vectorize_units.py --clips public/assets/units/frames/jap_infantry/clips.json
    python scripts/vectorize_units.py --polished
    python scripts/vectorize_units.py --clips public/assets/units/frames/jap_infantry_polished/clips.json

Or, from the repo root or from web/:

    npm run vectorize:units -- --limit 4
    npm run vectorize:units -- --polished

Output lands in web/public/assets/units/vector/. The battle map (?field=1)
lists those files under Vector in the Sprite menu.

--polished traces the *.outlined.polished.png files that unify_shading.py
writes instead of the *.outlined.quantized.png ones. A polished unit is saved
as <FACTION>/<stem>.polished.svg beside the plain <stem>.svg, and its manifest
row carries "polished": true and "grade": "polished". Every other row is
"polished": false. A clip folder whose name ends in _polished is traced into
vector/frames/<unitId>_polished/, its clips.json says "polished": true, and it
is listed under "clips" in the manifest. The sprite editor (?bake=1) lists
only polished vector rows by default.

--stamped traces the *.outlined.stamped.png files that stampUnits.mjs writes
(npm run stamp:units): a polished PNG with national emblems composited on.
Each is saved as <FACTION>/<stem>.stamped.svg, and its manifest row carries
"stamped": true, "polished": true and "grade": "stamped". Polished rows stay
as they are. The editor and the battle map show the stamped vector in place
of the polished one. A --stamped run also drops stamped rows, and their SVGs,
whose stamped PNG is gone.

    python scripts/vectorize_units.py --stamped
    python scripts/vectorize_units.py --stamped assets/candidates/US/us_bomber_seed1.outlined.stamped.png

Requires Pillow, numpy, potracer, and scour.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
    from potrace import Bitmap
    from scour.scour import sanitizeOptions, scourString
except ImportError as error:
    missing = getattr(error, "name", None) or error
    sys.exit(f"vectorize_units needs Pillow, numpy, potracer, and scour. Missing: {missing}")

WEB_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = WEB_ROOT / "public"
DEFAULT_PALETTE = PUBLIC_ROOT / "assets" / "units" / "fading-16-32x.png"
DEFAULT_CANDIDATES = WEB_ROOT / "assets" / "candidates"
DEFAULT_OUT = WEB_ROOT / "public" / "assets" / "units" / "vector"

UPSCALE = 4
ALPHA_CUT = 128
SVG_NS = "http://www.w3.org/2000/svg"
PALETTE_COUNT = 16
# potrace defaults. Corners of the pixel art stay put, and the curve fit rounds
# them instead of emitting the staircase as a polygon. 0 would be that polygon.
POTRACE_ALPHAMAX = 1.0
POTRACE_OPTTOLERANCE = 0.2

HEX_COLOR = re.compile(r"^#([0-9a-f]{3}|[0-9a-f]{6})$", re.IGNORECASE)
RGB_COLOR = re.compile(r"^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$", re.IGNORECASE)


def luminance(rgb: tuple[int, int, int]) -> int:
    red, green, blue = rgb
    return 2126 * red + 7152 * green + 722 * blue


def hex_color(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def parse_css_color(value: str) -> tuple[int, int, int] | None:
    text = value.strip().lower()
    if text in {"none", "transparent"}:
        return None
    matched = HEX_COLOR.fullmatch(text)
    if matched:
        digits = matched.group(1)
        if len(digits) == 3:
            digits = "".join(channel * 2 for channel in digits)
        return tuple(int(digits[index : index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]
    matched = RGB_COLOR.fullmatch(text)
    if matched:
        channels = tuple(int(channel) for channel in matched.groups())
        if any(channel > 255 for channel in channels):
            return None
        return channels  # type: ignore[return-value]
    return None


def read_palette(path: Path) -> list[tuple[int, int, int]]:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    if width % PALETTE_COUNT != 0 or height < 1:
        raise SystemExit(f"{path} is {width} by {height}; expected 16 equal swatches.")
    band = width // PALETTE_COUNT
    pixels = image.load()
    colors: list[tuple[int, int, int]] = []
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


def darkest(colors: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    return min(enumerate(colors), key=lambda item: (luminance(item[1]), sum(item[1]), item[0]))[1]


QUANTIZED_SUFFIX = ".outlined.quantized.png"
POLISHED_SUFFIX = ".outlined.polished.png"
STAMPED_SUFFIX = ".outlined.stamped.png"
UNIT_ID = re.compile(r"^(ger|uk|us|ussr|jap)_(.+)$")


def outlined_pngs(folder: Path, suffix: str = QUANTIZED_SUFFIX) -> list[Path]:
    files = [
        path
        for path in folder.rglob(f"*{suffix}")
        if path.is_file() and "bad" not in path.name.lower()
    ]
    return sorted(files, key=lambda path: path.as_posix().lower())


def is_polished(path: Path) -> bool:
    return path.name.endswith(POLISHED_SUFFIX)


def is_stamped(path: Path) -> bool:
    return path.name.endswith(STAMPED_SUFFIX)


def traceable(path: Path) -> bool:
    name = path.name
    return path.is_file() and name.endswith((QUANTIZED_SUFFIX, POLISHED_SUFFIX, STAMPED_SUFFIX)) and "bad" not in name.lower()


def quantized_twin(relative: str) -> str:
    """The quantized candidate a polished or stamped file was made from. The candidate manifest only names that one."""
    for suffix in (POLISHED_SUFFIX, STAMPED_SUFFIX):
        if relative.endswith(suffix):
            return relative[: -len(suffix)] + QUANTIZED_SUFFIX
    return relative


def candidate_row(index: dict[str, dict], relative: str) -> dict:
    """The manifest row for this picture. A peeled file has no ".outlined" in its name."""
    twin = quantized_twin(relative)
    found = index.get(twin)
    if found:
        return found
    peeled = twin.replace(".outlined.quantized.png", ".quantized.png")
    if peeled != twin:
        found = index.get(peeled)
        if found:
            return found
    return {}


def svg_name(path: Path) -> str:
    if is_polished(path):
        return path.name[: -len(POLISHED_SUFFIX)] + ".polished.svg"
    if is_stamped(path):
        return path.name[: -len(STAMPED_SUFFIX)] + ".stamped.svg"
    return path.name[: -len(QUANTIZED_SUFFIX)] + ".svg"


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


def snap_indices(image: Image.Image, palette: list[tuple[int, int, int]]) -> tuple[np.ndarray, np.ndarray]:
    rgba = np.asarray(image.convert("RGBA"))
    rgb = rgba[..., :3].astype(np.int16)
    opaque = rgba[..., 3] > ALPHA_CUT
    flat = rgb.reshape(-1, 3)
    colors = np.asarray(palette, dtype=np.int16)
    distance = np.sum((flat[:, None, :] - colors[None, :, :]) ** 2, axis=2)
    nearest = np.argmin(distance, axis=1).astype(np.uint8).reshape(opaque.shape)
    nearest[~opaque] = 255
    return nearest, opaque


def dilate_1px(mask: np.ndarray) -> np.ndarray:
    """Grow a boolean mask by one pixel, diagonals included."""
    padded = np.pad(mask, 1, mode="constant", constant_values=False)
    height, width = mask.shape
    grown = np.zeros((height, width), dtype=bool)
    for offset_y in range(3):
        for offset_x in range(3):
            grown |= padded[offset_y : offset_y + height, offset_x : offset_x + width]
    return grown


def format_coord(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        return "0"
    return text


def trace_mask(mask: np.ndarray) -> list[dict[str, str]]:
    """Fit a smooth curve to a foreground mask.

    Bitmap inverts its input, so the mask is passed negated and the foreground
    comes back out as the traced shape. Subpaths of one path keep holes: a
    wheel opening is a second loop, and the SVG fill rule is evenodd.
    """
    curves = Bitmap(np.logical_not(mask)).trace(
        turdsize=2,
        alphamax=POTRACE_ALPHAMAX,
        opticurve=True,
        opttolerance=POTRACE_OPTTOLERANCE,
    )
    parts: list[str] = []
    for curve in curves:
        start = curve.start_point
        if start is None:
            continue
        commands = [f"M{format_coord(start.x)} {format_coord(start.y)}"]
        for segment in curve:
            if segment.is_corner:
                commands.append(f"L{format_coord(segment.c.x)} {format_coord(segment.c.y)}")
                commands.append(f"L{format_coord(segment.end_point.x)} {format_coord(segment.end_point.y)}")
            else:
                commands.append(
                    "C"
                    f"{format_coord(segment.c1.x)} {format_coord(segment.c1.y)} "
                    f"{format_coord(segment.c2.x)} {format_coord(segment.c2.y)} "
                    f"{format_coord(segment.end_point.x)} {format_coord(segment.end_point.y)}"
                )
        commands.append("Z")
        parts.append("".join(commands))
    if not parts:
        return []
    return [{"d": "".join(parts)}]


def build_svg(width: int, height: int, layers: list[tuple[str, str, list[dict[str, str]]]]) -> str:
    ET.register_namespace("", SVG_NS)
    svg = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "viewBox": f"0 0 {width} {height}",
            "width": str(width),
            "height": str(height),
            "fill-rule": "evenodd",
        },
    )
    for layer_id, fill, paths in layers:
        first = True
        for path in paths:
            attrib = {"d": path["d"], "fill": fill}
            if first and layer_id:
                attrib["id"] = layer_id
                first = False
            transform = path.get("transform")
            if transform:
                attrib["transform"] = transform
            ET.SubElement(svg, f"{{{SVG_NS}}}path", attrib)
    body = ET.tostring(svg, encoding="unicode")
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{body}\n'


def scour_svg(svg: str) -> str:
    options = sanitizeOptions()
    options.quiet = True
    options.strip_comments = True
    options.remove_descriptive_elements = True
    options.indent_type = "none"
    options.newlines = True
    options.strip_xml_space_attribute = True
    # Keep width and height in pixels. A 100% box has no intrinsic size when
    # the battle map loads the file as an image.
    options.enable_viewboxing = False
    return scourString(svg, options)


def rewrite_fills(svg: str, allowed: dict[tuple[int, int, int], str]) -> str:
    def replace(match: re.Match[str]) -> str:
        rgb = parse_css_color(match.group(1))
        if rgb is None:
            raise SystemExit(f"A path fill could not be read: {match.group(1)}")
        exact = allowed.get(rgb)
        if exact is None:
            raise SystemExit(f"Fill {match.group(1)} is not one of the 16 palette colors.")
        return f'fill="{exact}"'

    rewritten, count = re.subn(r'fill="([^"]+)"', replace, svg)
    if count < 1:
        raise SystemExit("Scour removed every fill from the SVG.")
    if 'fill-rule="evenodd"' not in rewritten:
        rewritten = rewritten.replace("<svg ", '<svg fill-rule="evenodd" ', 1)
    if not rewritten.endswith("\n"):
        rewritten += "\n"
    return rewritten


def vectorize(path: Path, palette: list[tuple[int, int, int]], backing: tuple[int, int, int]) -> tuple[str, int, int]:
    image = Image.open(path)
    indices, _opaque = snap_indices(image, palette)
    scaled = np.repeat(np.repeat(indices, UPSCALE, axis=0), UPSCALE, axis=1)
    height, width = scaled.shape
    silhouette = scaled != 255
    if not bool(silhouette.any()):
        raise SystemExit(f"{path} has no opaque pixels.")

    layers: list[tuple[str, str, list[dict[str, str]]]] = []
    backing_paths = trace_mask(silhouette)
    if not backing_paths:
        raise SystemExit(f"{path} silhouette did not trace.")
    layers.append(("backing", hex_color(backing), backing_paths))

    present = [index for index in range(len(palette)) if bool(np.any(scaled == index))]
    # Light colors first, darkest last, so an outline stays on top of the
    # one-pixel overlap from dilation.
    present.sort(key=lambda index: (-luminance(palette[index]), -index))
    for index in present:
        mask = dilate_1px(scaled == index)
        paths = trace_mask(mask)
        if not paths:
            raise SystemExit(f"{path} color {hex_color(palette[index])} did not trace.")
        layers.append(("", hex_color(palette[index]), paths))

    allowed = {color: hex_color(color) for color in palette}
    svg = rewrite_fills(scour_svg(build_svg(width, height, layers)), allowed)
    check_svg(svg, allowed)
    return svg, image.width, image.height


def check_svg(svg: str, allowed: dict[tuple[int, int, int], str]) -> None:
    payload = svg.split("?>", 1)[-1]
    root = ET.fromstring(payload)
    paths = [element for element in root.iter() if element.tag.endswith("path")]
    if not paths:
        raise SystemExit("The traced SVG has no paths.")
    if not any(element.get("id") == "backing" for element in paths):
        raise SystemExit("The traced SVG is missing its backing path.")
    for element in paths:
        rgb = parse_css_color(element.get("fill") or "")
        if rgb is None or rgb not in allowed:
            raise SystemExit(f"A traced path fill is outside the palette: {element.get('fill')}")


def unit_record(path: Path, index: dict[str, dict], width: int, height: int, svg_file: Path) -> dict:
    relative = path.resolve().relative_to(WEB_ROOT).as_posix()
    row = candidate_row(index, relative)
    faction = row.get("factionId") if isinstance(row.get("factionId"), str) else path.parent.name
    unit_type = row.get("unitTypeId") if isinstance(row.get("unitTypeId"), str) else "unit"
    seed = row.get("seed") if isinstance(row.get("seed"), int) else None
    if seed is None:
        found = re.search(r"_seed(\d+)", path.name)
        seed = int(found.group(1)) if found else None
    try:
        public = svg_file.resolve().relative_to(PUBLIC_ROOT).as_posix()
    except ValueError as error:
        raise SystemExit(f"{svg_file} is outside {PUBLIC_ROOT}, so the battle map cannot serve it.") from error
    record = {
        "file": public,
        "source": relative,
        "factionId": faction,
        "unitTypeId": unit_type,
        "width": width,
        "height": height,
    }
    if seed is not None:
        record["seed"] = seed
    record["polished"] = is_polished(path) or is_stamped(path)
    if is_stamped(path):
        record["stamped"] = True
        record["grade"] = "stamped"
    elif record["polished"]:
        record["grade"] = "polished"
    return record


def write_manifest(
    folder: Path,
    palette: list[tuple[int, int, int]],
    backing: tuple[int, int, int],
    updates: dict[str, dict],
    clip_updates: dict[str, dict] | None = None,
    prune_stamped: bool = False,
) -> None:
    document = {"scale": UPSCALE, "palette": [], "backing": hex_color(backing), "units": []}
    manifest_path = folder / "manifest.json"
    if manifest_path.is_file():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if isinstance(previous, dict):
            document = previous
    units = document.get("units")
    by_source: dict[str, dict] = {}
    if isinstance(units, list):
        for unit in units:
            source = unit.get("source") if isinstance(unit, dict) else None
            if isinstance(source, str):
                by_source[source] = unit
    by_source.update(updates)
    if prune_stamped:
        for source, unit in list(by_source.items()):
            if unit.get("stamped") is True and source.endswith(STAMPED_SUFFIX) and not (WEB_ROOT / source).is_file():
                del by_source[source]
                svg = PUBLIC_ROOT / str(unit.get("file", ""))
                if str(unit.get("file", "")).endswith(".stamped.svg") and svg.is_file():
                    svg.unlink()
                print(f"dropped {unit.get('file')}: {source} is gone")
    for unit in by_source.values():
        if "polished" not in unit:
            unit["polished"] = str(unit.get("source", "")).endswith(POLISHED_SUFFIX)
    ordered = sorted(by_source.values(), key=lambda unit: (str(unit.get("factionId")), str(unit.get("unitTypeId")), int(unit.get("seed") or 0), str(unit.get("file"))))
    clips_by_source: dict[str, dict] = {}
    previous_clips = document.get("clips")
    if isinstance(previous_clips, list):
        for clip in previous_clips:
            source = clip.get("source") if isinstance(clip, dict) else None
            if isinstance(source, str):
                clips_by_source[source] = clip
    clips_by_source.update(clip_updates or {})
    document = {
        "scale": UPSCALE,
        "palette": [hex_color(color) for color in palette],
        "backing": hex_color(backing),
        "units": ordered,
    }
    if clips_by_source:
        document["clips"] = sorted(clips_by_source.values(), key=lambda clip: str(clip.get("dir")))
    manifest_path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def vectorize_clips(clips_path: Path, palette: list[tuple[int, int, int]], backing: tuple[int, int, int], out_root: Path) -> int:
    """Trace every frame named by a sprite clip list and write a playable copy."""
    path = clips_path if clips_path.is_absolute() else Path.cwd() / clips_path
    if not path.is_file():
        raise SystemExit(f"Clips file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    clips = data.get("clips") if isinstance(data, dict) else None
    if not isinstance(clips, dict):
        raise SystemExit(f"{path} has no clips.")
    names: list[str] = []
    ordered: dict[str, list[str]] = {}
    for clip_name in ("idle", "walk", "fire"):
        frames = clips.get(clip_name)
        if not isinstance(frames, list) or not frames:
            raise SystemExit(f"{path} is missing the {clip_name} clip.")
        cleaned: list[str] = []
        for frame in frames:
            if not isinstance(frame, str) or not re.fullmatch(r"(idle|walk|fire)_\d+", frame):
                raise SystemExit(f"Bad frame name in {clip_name}: {frame}")
            cleaned.append(frame)
            names.append(frame)
        ordered[clip_name] = cleaned
    unit_id = data.get("unitId") if isinstance(data.get("unitId"), str) and data.get("unitId") else path.parent.name
    # unify_shading.py keeps the unitId and puts the polished frames in <folder>_polished.
    # The traced copy gets the same suffix so it never lands on the plain traced walk.
    polished = path.parent.name.endswith("_polished") or data.get("polished") is True
    folder_id = unit_id if not polished or unit_id.endswith("_polished") else f"{unit_id}_polished"
    out_dir = out_root / "frames" / folder_id
    out_dir.mkdir(parents=True, exist_ok=True)
    folder = path.parent
    for name in names:
        source = folder / f"{name}.png"
        if not source.is_file():
            raise SystemExit(f"Missing frame: {source}")
        svg, width, height = vectorize(source, palette, backing)
        destination = out_dir / f"{name}.svg"
        destination.write_text(svg, encoding="utf-8", newline="\n")
        print(f"{source.name} -> {destination} ({width}x{height}, {destination.stat().st_size} bytes)")
    document = {
        "kind": "sprite-clips",
        "version": 1,
        "unitId": unit_id,
        "width": data.get("width"),
        "height": data.get("height"),
        "feet": data.get("feet"),
        "scale": UPSCALE,
        "polished": polished,
        "clips": ordered,
    }
    for key in ("factionId", "unitTypeId", "smoke", "muzzle", "flashFrames", "puffFrames"):
        if key in data:
            document[key] = data[key]
    clips_out = out_dir / "clips.json"
    clips_out.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"clips {clips_out}")

    base_id = unit_id[: -len("_polished")] if unit_id.endswith("_polished") else unit_id
    identity = UNIT_ID.fullmatch(base_id)
    try:
        source = path.resolve().relative_to(WEB_ROOT).as_posix()
    except ValueError:
        source = path.resolve().as_posix()
    try:
        public_dir = out_dir.resolve().relative_to(PUBLIC_ROOT).as_posix()
    except ValueError as error:
        raise SystemExit(f"{out_dir} is outside {PUBLIC_ROOT}, so the battle map cannot serve it.") from error
    named_faction = data.get("factionId")
    named_type = data.get("unitTypeId")
    faction_id = named_faction if isinstance(named_faction, str) and named_faction else (identity.group(1).upper() if identity else "")
    unit_type_id = named_type if isinstance(named_type, str) and named_type else (identity.group(2) if identity else base_id)
    record = {
        "dir": public_dir,
        "source": source,
        "unitId": unit_id,
        "factionId": faction_id,
        "unitTypeId": unit_type_id,
        "width": data.get("width"),
        "height": data.get("height"),
        "frames": len(set(names)),
        "preview": f"{public_dir}/{ordered['idle'][0]}.svg",
        "polished": polished,
    }
    if polished:
        record["grade"] = "polished"
    write_manifest(out_root, palette, backing, {}, {source: record})
    print(f"manifest {out_root / 'manifest.json'}")
    print(f"traced {len(names)}")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trace outlined unit PNGs into exact-palette SVGs.")
    parser.add_argument(
        "inputs",
        nargs="*",
        type=Path,
        help="Outlined PNGs, quantized or polished. Default: every outlined.quantized candidate, or every outlined.polished one with --polished.",
    )
    parser.add_argument(
        "--polished",
        action="store_true",
        help="Trace the outlined.polished PNGs from unify_shading.py instead. They are saved as <stem>.polished.svg.",
    )
    parser.add_argument(
        "--stamped",
        action="store_true",
        help="Trace the outlined.stamped PNGs from npm run stamp:units instead. They are saved as <stem>.stamped.svg.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Trace only this many files, chosen at random.")
    parser.add_argument("--seed", type=int, default=None, help="Seed for --limit. Printed when it is chosen for you.")
    parser.add_argument("--clips", type=Path, default=None, help="A sprite clips.json. Trace idle, walk, and fire beside it.")
    parser.add_argument("--palette", type=Path, default=DEFAULT_PALETTE)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not args.palette.is_file():
        raise SystemExit(f"Palette not found: {args.palette}")
    palette = read_palette(args.palette)
    backing = darkest(palette)
    print(f"palette {args.palette}")
    print("colors " + " ".join(hex_color(color) for color in palette))
    print(f"backing {hex_color(backing)}")

    if args.clips:
        return vectorize_clips(args.clips, palette, backing, args.out)

    if args.inputs:
        files = [path if path.is_absolute() else Path.cwd() / path for path in args.inputs]
        missing = [path for path in files if not path.is_file()]
        if missing:
            raise SystemExit("Not found (paths are relative to web/): " + ", ".join(str(path) for path in missing))
    else:
        if not args.candidates.is_dir():
            raise SystemExit(f"Candidate folder not found: {args.candidates}")
        files = outlined_pngs(args.candidates, STAMPED_SUFFIX if args.stamped else POLISHED_SUFFIX if args.polished else QUANTIZED_SUFFIX)
    files = [path for path in files if traceable(path)]
    grade = "stamped" if args.stamped else "polished" if args.polished else "quantized"
    if not files and args.stamped:
        write_manifest(args.out, palette, backing, {}, prune_stamped=True)
        print("No outlined.stamped PNGs to trace. Run npm run stamp:units first.")
        return 0
    if not files:
        raise SystemExit(f"No outlined.{grade} PNGs to trace.")
    if args.limit < 0:
        raise SystemExit("--limit must be 0 or more.")
    if args.limit and args.limit < len(files):
        seed = args.seed
        if seed is None:
            seed = random.SystemRandom().randrange(1, 10_000_000)
            print(f"seed {seed}")
        files = sorted(random.Random(seed).sample(files, args.limit), key=lambda path: path.as_posix().lower())

    index = candidate_index(args.candidates if args.candidates.is_dir() else DEFAULT_CANDIDATES)
    args.out.mkdir(parents=True, exist_ok=True)
    updates: dict[str, dict] = {}
    for path in files:
        svg, width, height = vectorize(path, palette, backing)
        row = index.get(quantized_twin(path.resolve().relative_to(WEB_ROOT).as_posix()), {})
        faction = row.get("factionId") if isinstance(row.get("factionId"), str) else path.parent.name
        destination = args.out / str(faction) / svg_name(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(svg, encoding="utf-8", newline="\n")
        record = unit_record(path, index, width, height, destination)
        updates[record["source"]] = record
        print(f"{path.name} -> {destination} ({width}x{height}, {destination.stat().st_size} bytes)")

    write_manifest(args.out, palette, backing, updates, prune_stamped=args.stamped)
    print(f"manifest {args.out / 'manifest.json'}")
    print(f"traced {len(files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
