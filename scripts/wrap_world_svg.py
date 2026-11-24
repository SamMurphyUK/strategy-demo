"""Cylindrical Pacific wrap of a Natural Earth land SVG.

The map is Atlantic-centered: the Americas sit on the left and the date line
cuts Alaska / British Columbia into a left-edge piece and a right-edge piece.
This script cuts North America at ``split_x``, moves the western side onto the
old Pacific edge, and slides the rest of the world so the cut becomes x = 0.
"""

from __future__ import annotations

import argparse
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import make_valid
from svgpathtools import Line, parse_path

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
SKIP_TAGS = {"defs", "clipPath", "mask", "symbol", "marker", "pattern"}
NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
TRANSFORM_RE = re.compile(
    r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)",
    re.IGNORECASE,
)
# Slivers past this x are date-line scraps on a wider export. This file's land
# ends at x=901, so the clip is a no-op unless a later export still has them.
RIGHT_SLIVER_X = 1075.0
SAMPLE_PX = 0.5
NA_AREA = 1000.0
NA_FRACTION = 0.15


def smooth_numbers(blob: str) -> list[float]:
    return [float(n) for n in NUM_RE.findall(blob)]


def mul(parent, local):
    pa, pb, pc, pd, pe, pf = parent
    qa, qb, qc, qd, qe, qf = local
    return (
        pa * qa + pc * qb,
        pb * qa + pd * qb,
        pa * qc + pc * qd,
        pb * qc + pd * qd,
        pa * qe + pc * qf + pe,
        pb * qe + pd * qf + pf,
    )


def apply_tf(matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def parse_transform(text: str | None):
    if not text:
        return IDENTITY
    matrix = IDENTITY
    for kind, blob in TRANSFORM_RE.findall(text):
        nums = smooth_numbers(blob)
        kind = kind.lower()
        local = IDENTITY
        if kind == "matrix" and len(nums) >= 6:
            local = tuple(nums[:6])
        elif kind == "translate":
            tx = nums[0] if nums else 0.0
            ty = nums[1] if len(nums) > 1 else 0.0
            local = (1.0, 0.0, 0.0, 1.0, tx, ty)
        elif kind == "scale":
            sx = nums[0] if nums else 1.0
            sy = nums[1] if len(nums) > 1 else sx
            local = (sx, 0.0, 0.0, sy, 0.0, 0.0)
        elif kind == "rotate" and nums:
            ang = math.radians(nums[0])
            cos, sin = math.cos(ang), math.sin(ang)
            local = (cos, sin, -sin, cos, 0.0, 0.0)
            if len(nums) >= 3:
                cx, cy = nums[1], nums[2]
                local = mul(
                    mul((1.0, 0.0, 0.0, 1.0, cx, cy), local),
                    (1.0, 0.0, 0.0, 1.0, -cx, -cy),
                )
        elif kind == "skewx" and nums:
            local = (1.0, 0.0, math.tan(math.radians(nums[0])), 1.0, 0.0, 0.0)
        elif kind == "skewy" and nums:
            local = (1.0, math.tan(math.radians(nums[0])), 0.0, 1.0, 0.0, 0.0)
        matrix = mul(matrix, local)
    return matrix


def tag_name(elem) -> str:
    return elem.tag.split("}")[-1]


def parse_viewbox(root) -> tuple[float, float, float, float]:
    raw = root.get("viewBox")
    if raw:
        parts = smooth_numbers(raw)
        if len(parts) >= 4 and parts[2] > 0 and parts[3] > 0:
            return parts[0], parts[1], parts[2], parts[3]
    width = float((NUM_RE.search(root.get("width") or "950") or re.match("950", "950")).group())
    height = float((NUM_RE.search(root.get("height") or "504") or re.match("504", "504")).group())
    return 0.0, 0.0, width, height


def find_land_group(elem, parent):
    name = tag_name(elem)
    if name in SKIP_TAGS:
        return None
    matrix = mul(parent, parse_transform(elem.get("transform")))
    if name == "g" and elem.get("id") == "ne_110m_land":
        return elem, matrix
    for child in list(elem):
        found = find_land_group(child, matrix)
        if found is not None:
            return found
    return None


def iter_paths(elem, parent):
    name = tag_name(elem)
    if name in SKIP_TAGS:
        return
    matrix = mul(parent, parse_transform(elem.get("transform")))
    if name == "path":
        d = elem.get("d")
        if d and d.strip():
            yield d, matrix
    for child in list(elem):
        yield from iter_paths(child, matrix)


def dedupe(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cleaned = []
    for point in pts:
        if cleaned and abs(cleaned[-1][0] - point[0]) < 1e-6 and abs(cleaned[-1][1] - point[1]) < 1e-6:
            continue
        cleaned.append(point)
    if len(cleaned) > 1:
        if abs(cleaned[0][0] - cleaned[-1][0]) < 1e-6 and abs(cleaned[0][1] - cleaned[-1][1]) < 1e-6:
            cleaned[-1] = cleaned[0]
    return cleaned


def flatten_subpath(sub, matrix) -> list[tuple[float, float]] | None:
    pts: list[tuple[float, float]] = []
    for seg in sub:
        if isinstance(seg, Line):
            steps = 1
        else:
            try:
                length = float(seg.length())
            except Exception:
                length = SAMPLE_PX * 8
            steps = max(2, int(math.ceil(length / SAMPLE_PX)))
        for i in range(steps):
            z = seg.point(i / steps)
            pts.append(apply_tf(matrix, z.real, z.imag))
    end = sub.end
    pts.append(apply_tf(matrix, end.real, end.imag))
    pts = dedupe(pts)
    if len(pts) < 4:
        return None
    if (pts[0][0] - pts[-1][0]) ** 2 + (pts[0][1] - pts[-1][1]) ** 2 > 1.0:
        return None
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


def signed_area(pts) -> float:
    area = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        area += x0 * y1 - x1 * y0
    return 0.5 * area


def explode(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    kind = geom.geom_type
    if kind == "Polygon":
        if geom.exterior is None or geom.area <= 0:
            return []
        return [geom]
    if kind in ("MultiPolygon", "GeometryCollection"):
        found = []
        for part in geom.geoms:
            found.extend(explode(part))
        return found
    return []


def clean(geom):
    if geom is None or geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = make_valid(geom)
    return geom


def land_from_rings(rings: list[tuple[list[tuple[float, float]], float]]) -> list[Polygon]:
    """Nonzero fill. The dominant winding is land; the opposite winding is a lake."""
    rings = [ring for ring in rings if abs(ring[1]) > 1e-4]
    if not rings:
        return []
    rings.sort(key=lambda ring: abs(ring[1]), reverse=True)
    fill_positive = rings[0][1] >= 0
    outers: list[Polygon] = []
    holes: list[Polygon] = []
    for pts, area in rings:
        poly = Polygon(pts)
        if poly.is_empty or poly.area <= 0:
            continue
        parts = explode(clean(poly))
        if (area >= 0) == fill_positive:
            outers.extend(parts)
        else:
            holes.extend(parts)
    if not outers:
        return []
    land = unary_union(outers)
    if holes:
        hole_geom = unary_union(holes)
        outside = hole_geom.difference(land)
        land = unary_union([land.difference(hole_geom), outside])
    return explode(clean(land))


def load_land(path: Path):
    root = ET.parse(path).getroot()
    viewbox = parse_viewbox(root)
    found = find_land_group(root, IDENTITY)
    if found is None:
        raise SystemExit(f"{path} has no <g id=\"ne_110m_land\">")
    group, matrix = found
    polygons = []
    path_count = 0
    for d, path_matrix in iter_paths(group, matrix):
        path_count += 1
        try:
            parsed = parse_path(d)
        except Exception as exc:
            print(f"skipped a path that did not parse: {exc}")
            continue
        rings = []
        for sub in parsed.continuous_subpaths():
            pts = flatten_subpath(sub, path_matrix)
            if pts is None:
                continue
            rings.append((pts, signed_area(pts)))
        polygons.extend(land_from_rings(rings))
    return viewbox, path_count, polygons


def clip_right_slivers(polygons: list[Polygon], limit: float) -> tuple[list[Polygon], int]:
    kept = []
    removed = 0
    blade = box(-1e9, -1e9, limit, 1e9)
    for poly in polygons:
        minx, _, maxx, _ = poly.bounds
        if minx > limit:
            removed += 1
            continue
        if maxx > limit:
            clipped = explode(clean(poly.intersection(blade)))
            removed += 1
            kept.extend(clipped)
            continue
        kept.append(poly)
    return kept, removed


def north_america(polygons: list[Polygon]) -> Polygon:
    large = [poly for poly in polygons if poly.area >= NA_AREA]
    if not large:
        large = polygons
    return min(large, key=lambda poly: poly.bounds[0])


def wrap_polygons(polygons: list[Polygon], split_x: float, land_min_x: float, content_w: float):
    """Return wrapped pieces. ``split_x`` is in the original SVG frame."""
    split_local = split_x - land_min_x
    if split_local <= 0 or split_local >= content_w:
        raise SystemExit(
            f"split-x {split_x:.2f} is outside the land span "
            f"{land_min_x:.2f}..{land_min_x + content_w:.2f}"
        )
    left_box = box(-1.0, -1e9, split_local, 1e9)
    right_box = box(split_local, -1e9, content_w + 1.0, 1e9)
    west_shift = content_w - split_local
    pieces = []
    for poly in polygons:
        shifted = affinity.translate(poly, xoff=-land_min_x)
        west = shifted.intersection(left_box)
        east = shifted.intersection(right_box)
        if not west.is_empty:
            pieces.extend(explode(clean(affinity.translate(west, xoff=west_shift))))
        if not east.is_empty:
            pieces.extend(explode(clean(affinity.translate(east, xoff=-split_local))))
    return pieces, west_shift


def ring_d(coords) -> str:
    x0, y0 = coords[0]
    parts = [f"M {x0:.2f} {y0:.2f}"]
    for x, y in coords[1:-1]:
        parts.append(f"L {x:.2f} {y:.2f}")
    parts.append("Z")
    return " ".join(parts)


def polygon_d(poly: Polygon) -> str:
    parts = [ring_d(list(poly.exterior.coords))]
    for hole in poly.interiors:
        parts.append(ring_d(list(hole.coords)))
    return " ".join(parts)


def write_svg(polygons: list[Polygon], dest: Path, width: float, height: float) -> None:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{width:.2f}" height="{height:.2f}" '
            f'viewBox="0 0 {width:.2f} {height:.2f}">'
        ),
        '  <g id="ne_110m_land" fill="#000000" stroke="none" fill-rule="nonzero">',
    ]
    for poly in polygons:
        lines.append(f'    <path d="{polygon_d(poly)}"/>')
    lines.append("  </g>")
    lines.append("</svg>")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_preview(before, after, split_x, join_x, content_w, vb_h, dest: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from shapely.plotting import plot_polygon

    fig, axes = plt.subplots(1, 2, figsize=(16, 7), dpi=130)

    def draw(ax, polys, title, xlim):
        for poly in polys:
            plot_polygon(poly, ax=ax, add_points=False, facecolor="#000000", edgecolor="none", linewidth=0)
        ax.set_xlim(*xlim)
        ax.set_ylim(0, vb_h)
        ax.set_aspect("equal", adjustable="box")
        ax.invert_yaxis()
        ax.set_title(title, fontsize=11)
        ax.grid(True, color="#c5ccd3", linewidth=0.4)
        ax.set_axisbelow(False)

    before_max = max(poly.bounds[2] for poly in before)
    draw(axes[0], before, f"Before  (split x = {split_x:.1f})", (-5, max(before_max, split_x) + 20))
    axes[0].axvline(split_x, color="#c0392b", linewidth=0.8)
    draw(axes[1], after, f"After  (date-line join x = {join_x:.1f})", (-5, content_w + 5))
    axes[1].axvline(join_x, color="#1f6aa5", linewidth=0.8)
    fig.suptitle("Pacific wrap. Red: cut through North America. Blue: welded date line.", fontsize=12)
    fig.tight_layout()
    fig.savefig(dest, facecolor="white")
    plt.close(fig)


def default_input() -> Path:
    downloads = Path.home() / "Downloads"
    for name in ("europe larger_vii.svg", "europe larger-vii.svg"):
        candidate = downloads / name
        if candidate.exists():
            return candidate
    return downloads / "europe larger_vii.svg"


def fmt_areas(areas: list[float]) -> str:
    if not areas:
        return "(none)"
    shown = ", ".join(f"{area:.2f}" for area in areas[:20])
    extra = len(areas) - 20
    if extra > 0:
        shown += f", … {extra} smaller"
    return shown


def main() -> None:
    parser = argparse.ArgumentParser(description="Wrap an Atlantic-centered land SVG across the Pacific.")
    parser.add_argument("--input", type=Path, default=default_input())
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads" / "world_wrapped.svg")
    parser.add_argument(
        "--split-x",
        type=float,
        default=None,
        help="Cut x in North America. Default: 15%% of the way across North America from its left edge.",
    )
    parser.add_argument("--min-area", type=float, default=3.5, help="Drop polygons smaller than this area.")
    parser.add_argument(
        "--preview-png",
        nargs="?",
        const="auto",
        default=None,
        help="Write a before/after PNG. Optionally pass the output path.",
    )
    args = parser.parse_args()

    viewbox, path_count, polygons = load_land(args.input)
    vb_x, vb_y, vb_w, vb_h = viewbox
    print(f"source: {args.input}")
    print(f"input viewBox: {vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}")
    print(f"input paths: {path_count}")
    print(f"input polygons: {len(polygons)}")

    polygons, slivers = clip_right_slivers(polygons, RIGHT_SLIVER_X)
    print(f"right-edge slivers clipped (x > {RIGHT_SLIVER_X:.0f}): {slivers}")
    if not polygons:
        raise SystemExit("no land remained after the right-edge clip")

    bounds = unary_union(polygons).bounds
    land_min_x, land_min_y, land_max_x, land_max_y = bounds
    content_w = land_max_x - land_min_x
    print(
        f"land bounds: x {land_min_x:.2f}..{land_max_x:.2f}  "
        f"y {land_min_y:.2f}..{land_max_y:.2f}  "
        f"(page width {vb_w:.2f}, empty right margin {vb_w - land_max_x:.2f})"
    )

    na = north_america(polygons)
    na_min, _, na_max, _ = na.bounds
    if args.split_x is None:
        split_x = na_min + NA_FRACTION * (na_max - na_min)
        print(
            f"North America x {na_min:.2f}..{na_max:.2f}  "
            f"auto split-x {split_x:.2f} ({NA_FRACTION:.0%} from the left edge)"
        )
    else:
        split_x = args.split_x
        print(f"North America x {na_min:.2f}..{na_max:.2f}  explicit split-x {split_x:.2f}")

    pieces, west_shift = wrap_polygons(polygons, split_x, land_min_x, content_w)
    welded = clean(unary_union(pieces))
    welded_parts = explode(welded)
    kept = []
    dropped = []
    for poly in welded_parts:
        area = float(poly.area)
        if area < args.min_area:
            dropped.append(area)
        else:
            kept.append(orient(poly, sign=1.0))
    dropped.sort(reverse=True)
    kept.sort(key=lambda poly: poly.area, reverse=True)
    print(f"polygons after weld: {len(welded_parts)}")
    print(f"pruned area < {args.min_area:.2f}: {len(dropped)}")
    print(f"  dropped areas: {fmt_areas(dropped)}")
    print(f"output polygons: {len(kept)}")

    out_bounds = unary_union(kept).bounds
    join_x = west_shift
    print(
        f"output bbox: x {out_bounds[0]:.2f}..{out_bounds[2]:.2f}  "
        f"y {out_bounds[1]:.2f}..{out_bounds[3]:.2f}"
    )
    print(f"date-line join x: {join_x:.2f}")
    print(f"viewBox: 0 0 {content_w:.2f} {vb_h:.2f}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_svg(kept, args.output, content_w, vb_h)
    print(f"wrote {args.output}")

    if args.preview_png is not None:
        if args.preview_png == "auto":
            preview = args.output.with_name(args.output.stem + "_preview.png")
        else:
            preview = Path(args.preview_png)
        write_preview(polygons, kept, split_x, join_x, content_w, vb_h, preview)
        print(f"wrote {preview}")


if __name__ == "__main__":
    main()
