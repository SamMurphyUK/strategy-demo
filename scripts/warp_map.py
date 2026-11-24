"""Warp Natural Earth land into an Axis & Allies 1940-style map.

Reads the Inkscape export, welds hairline seams, drops speck islands, cuts the
high Arctic, then applies smooth warps in normalized (u, v) space. u grows
east and v grows south, both over the source viewBox.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.plotting import plot_polygon
from shapely.validation import make_valid
from svgpathtools import Line, parse_path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(r"C:\Users\sammu\Downloads\ne_110m_land_FINAL_03.svg")
DST = ROOT / "art" / "loose" / "svg" / "map_warped.svg"
PREVIEW = ROOT / "art" / "loose" / "png" / "preview_comparison.png"

# Fraction of the normalized 0..1 box. 8e-5 is about 32 px² on an 800×504 map.
MIN_ISLAND_AREA = 8e-5
WELD_PX = 0.15
SIMPLIFY_PX = 0.8
SAMPLE_PX = 0.5
ARCTIC_CUT = 0.16
TOP_PAD = 0.06
BOTTOM_PAD = 0.06

EUROPE_U = 0.48
EUROPE_V = 0.36
EUROPE_SIGMA = 0.09
EUROPE_GAIN = 0.35  # peak radial scale 1.35
AMERICAS_SHIFT = 0.03
SIBERIA_U = 0.72
SIBERIA_SCALE = 0.82
MED_PUSH = 0.045
AFRICA_V0 = 0.45
AFRICA_V1 = 0.85
AFRICA_SCALE = 0.85

# Preview windows in source-normalized (u, v), before polar padding.
FULL_WINDOW = (-0.08, 1.06, 0.0, 1.0)
EUROPE_WINDOW = (0.36, 0.64, 0.18, 0.56)
PACIFIC_WINDOW = (0.68, 1.04, 0.10, 0.55)

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
SKIP_TAGS = {"defs", "clipPath", "mask", "symbol", "marker", "pattern"}
NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
TRANSFORM_RE = re.compile(
    r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)",
    re.IGNORECASE,
)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 == edge0:
        return 0.0 if x < edge0 else 1.0
    t = (x - edge0) / (edge1 - edge0)
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    return t * t * (3.0 - 2.0 * t)


def mul(parent, local):
    """Compose SVG matrices. `local` is applied to the point first."""
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
        nums = [float(n) for n in NUM_RE.findall(blob)]
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
        elif kind == "rotate":
            ang = math.radians(nums[0] if nums else 0.0)
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


def parse_viewbox(root) -> tuple[float, float, float, float]:
    raw = root.get("viewBox")
    if raw:
        parts = [float(n) for n in NUM_RE.findall(raw)]
        if len(parts) >= 4 and parts[2] > 0 and parts[3] > 0:
            return parts[0], parts[1], parts[2], parts[3]
    width = float(NUM_RE.search(root.get("width") or "800").group())
    height = float(NUM_RE.search(root.get("height") or "504").group())
    return 0.0, 0.0, width, height


def dedupe(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cleaned = []
    for x, y in pts:
        if cleaned:
            px, py = cleaned[-1]
            if abs(px - x) < 1e-6 and abs(py - y) < 1e-6:
                continue
        cleaned.append((x, y))
    if len(cleaned) > 1:
        x0, y0 = cleaned[0]
        x1, y1 = cleaned[-1]
        if abs(x0 - x1) < 1e-6 and abs(y0 - y1) < 1e-6:
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
    x0, y0 = pts[0]
    x1, y1 = pts[-1]
    if (x0 - x1) ** 2 + (y0 - y1) ** 2 > 1.0:
        return None
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


def signed_area(pts: list[tuple[float, float]]) -> float:
    area = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        area += x0 * y1 - x1 * y0
    return 0.5 * area


def as_polygons(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    kind = geom.geom_type
    if kind == "Polygon":
        if geom.exterior is None or geom.area <= 0:
            return []
        return [geom]
    if kind == "MultiPolygon":
        return [g for g in geom.geoms if not g.is_empty and g.area > 0 and g.exterior is not None]
    if kind == "GeometryCollection":
        found = []
        for part in geom.geoms:
            found.extend(as_polygons(part))
        return found
    return []


def clean(geom):
    if geom is None or geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = make_valid(geom)
    return geom


def rings_to_land(rings: list[tuple[list[tuple[float, float]], float]]):
    """Nonzero fill: the dominant winding is land, the opposite winding is cut out."""
    if not rings:
        return []
    rings = sorted(rings, key=lambda item: abs(item[1]), reverse=True)
    fill_positive = rings[0][1] >= 0
    outers = []
    holes = []
    for pts, area in rings:
        poly = Polygon(pts)
        if poly.is_empty or poly.area <= 0:
            continue
        poly = clean(poly)
        parts = as_polygons(poly)
        positive = area >= 0
        if positive == fill_positive:
            outers.extend(parts)
        else:
            holes.extend(parts)
    if not outers:
        return []
    land = unary_union(outers)
    if holes:
        hole_geom = unary_union(holes)
        # A clockwise ring outside the landmass is an island, not a lake.
        outside = hole_geom.difference(land)
        land = unary_union([land.difference(hole_geom), outside])
    return as_polygons(clean(land))


def load_polygons(path: Path):
    tree = ET.parse(path)
    root = tree.getroot()
    viewbox = parse_viewbox(root)
    polygons = []
    path_count = 0
    ring_count = 0
    open_rings = 0
    for d, matrix in iter_paths(root, IDENTITY):
        path_count += 1
        try:
            parsed = parse_path(d)
        except Exception as exc:
            print(f"skipped a path that did not parse: {exc}")
            continue
        rings = []
        for sub in parsed.continuous_subpaths():
            pts = flatten_subpath(sub, matrix)
            if pts is None:
                open_rings += 1
                continue
            area = signed_area(pts)
            if abs(area) < 1e-4:
                continue
            rings.append((pts, area))
            ring_count += 1
        polygons.extend(rings_to_land(rings))
    return viewbox, path_count, ring_count, open_rings, polygons


def med_push(v: float) -> float:
    """Southward push, full on the North African coast and gone by v ≈ 0.62."""
    onset = smoothstep(0.42, 0.48, v)
    fade = 1.0 - smoothstep(0.52, 0.62, v)
    return MED_PUSH * onset * fade


AFRICA_ANCHOR = AFRICA_V0 + med_push(AFRICA_V0)


def warp_uv(u: float, v: float, aspect: float) -> tuple[float, float]:
    # Americas (left) and the date-line Alaska fragment (right) move west together.
    w_left = 1.0 - smoothstep(0.30, 0.36, u)
    w_right = smoothstep(0.84, 0.88, u)
    shifted = u - AMERICAS_SHIFT * (w_left + w_right)

    # Far East Siberia squeezes toward u=0.72. The weight fades across the same
    # 0.84..0.88 band as the Alaska shift, so that shift is not crushed back east.
    g_u = smoothstep(0.70, 0.76, u) * (1.0 - smoothstep(0.84, 0.88, u))
    g_v = 1.0 - smoothstep(0.45, 0.52, v)
    siberia = g_u * g_v
    u2 = SIBERIA_U + (shifted - SIBERIA_U) * (1.0 - (1.0 - SIBERIA_SCALE) * siberia)

    du = (u - EUROPE_U) * aspect
    dv = v - EUROPE_V
    gain = EUROPE_GAIN * math.exp(-0.5 * (du * du + dv * dv) / (EUROPE_SIGMA * EUROPE_SIGMA))
    u3 = u2 + (u - EUROPE_U) * gain
    v3 = v + (v - EUROPE_V) * gain + med_push(v)

    enter = smoothstep(AFRICA_V0 - 0.03, AFRICA_V0 + 0.03, v)
    leave = 1.0 - smoothstep(AFRICA_V1 - 0.03, AFRICA_V1 + 0.03, v)
    weight = enter * leave
    target = AFRICA_ANCHOR + (v3 - AFRICA_ANCHOR) * AFRICA_SCALE
    v4 = v3 + (target - v3) * weight
    return u3, v4


def map_polygon(poly: Polygon, fn) -> list[Polygon]:
    shell = [fn(x, y) for x, y in poly.exterior.coords]
    holes = [[fn(x, y) for x, y in ring.coords] for ring in poly.interiors]
    mapped = Polygon(shell, holes)
    return as_polygons(clean(mapped))


def prune(polys: list[Polygon], min_area: float):
    kept = []
    dropped = []
    for poly in polys:
        area = float(poly.area)
        if area < min_area:
            dropped.append(area)
        else:
            kept.append(poly)
    dropped.sort(reverse=True)
    return kept, dropped


def vertex_count(polys: list[Polygon]) -> int:
    total = 0
    for poly in polys:
        total += max(0, len(poly.exterior.coords) - 1)
        for ring in poly.interiors:
            total += max(0, len(ring.coords) - 1)
    return total


def ring_d(coords) -> str:
    x0, y0 = coords[0]
    parts = [f"M {x0:.2f} {y0:.2f}"]
    for x, y in coords[1:-1]:
        parts.append(f"L {x:.2f} {y:.2f}")
    parts.append("Z")
    return " ".join(parts)


def polygon_d(poly: Polygon) -> str:
    parts = [ring_d(list(poly.exterior.coords))]
    for ring in poly.interiors:
        parts.append(ring_d(list(ring.coords)))
    return " ".join(parts)


def write_svg(polys: list[Polygon], viewbox: tuple[float, float, float, float]) -> None:
    minx, miny, width, height = viewbox
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{width:.2f}" height="{height:.2f}" '
            f'viewBox="{minx:.2f} {miny:.2f} {width:.2f} {height:.2f}">'
        ),
        '  <g id="ne_110m_land" fill="#000000" stroke="none" fill-rule="nonzero">',
    ]
    for poly in polys:
        lines.append(f'    <path d="{polygon_d(poly)}"/>')
    lines.append("  </g>")
    lines.append("</svg>")
    DST.write_text("\n".join(lines) + "\n", encoding="utf-8")


def draw_land(ax, polys, title, window, pixel_aspect: float):
    u0, u1, v0, v1 = window
    for poly in polys:
        plot_polygon(
            poly,
            ax=ax,
            add_points=False,
            facecolor="#000000",
            edgecolor="none",
            linewidth=0,
        )
    ax.set_xlim(u0, u1)
    ax.set_ylim(v0, v1)
    # One u unit is the source width and one v unit is the source height.
    ax.set_aspect(pixel_aspect, adjustable="box")
    ax.invert_yaxis()
    ax.set_xticks([i / 10 for i in range(math.floor(u0 * 10), math.ceil(u1 * 10) + 1)])
    ax.set_yticks([i / 10 for i in range(math.floor(v0 * 10), math.ceil(v1 * 10) + 1)])
    ax.grid(True, color="#9aa3ad", linewidth=0.45, alpha=0.9)
    ax.set_axisbelow(False)
    ax.set_title(title, fontsize=11)
    ax.tick_params(labelsize=7)
    ax.set_xlabel("u", fontsize=8)
    ax.set_ylabel("v  (southward)", fontsize=8)


def draw_preview(before, after, pixel_aspect: float) -> None:
    fig, axes = plt.subplots(
        3,
        2,
        figsize=(16, 15),
        dpi=140,
        gridspec_kw={"height_ratios": [1.05, 1.25, 1.2]},
    )
    panels = [
        (axes[0, 0], before, "Before — welded source", FULL_WINDOW, True),
        (axes[0, 1], after, "After — arctic cut and warps", FULL_WINDOW, True),
        (axes[1, 0], before, "Europe / Mediterranean — before", EUROPE_WINDOW, False),
        (axes[1, 1], after, "Europe / Mediterranean — after", EUROPE_WINDOW, False),
        (axes[2, 0], before, "Pacific / Far East — before", PACIFIC_WINDOW, False),
        (axes[2, 1], after, "Pacific / Far East — after", PACIFIC_WINDOW, False),
    ]
    for ax, polys, title, window, mark in panels:
        draw_land(ax, polys, title, window, pixel_aspect)
        if mark:
            ax.axhline(ARCTIC_CUT, color="#c0392b", linewidth=0.7, alpha=0.85)
            for (u0, u1, v0, v1), color in (
                (EUROPE_WINDOW, "#c0392b"),
                (PACIFIC_WINDOW, "#1f6aa5"),
            ):
                ax.add_patch(
                    Rectangle(
                        (u0, v0),
                        u1 - u0,
                        v1 - v0,
                        fill=False,
                        edgecolor=color,
                        linewidth=0.8,
                    )
                )
    fig.suptitle(
        "0.1 (u, v) grid. Red line is the arctic cut. "
        "Red box: Europe / Mediterranean. Blue box: Pacific.",
        fontsize=12,
    )
    fig.tight_layout()
    fig.savefig(PREVIEW, facecolor="white")
    plt.close(fig)


def fmt_areas(areas: list[float]) -> str:
    if not areas:
        return "(none)"
    shown = areas[:40]
    text = ", ".join(f"{area:.3e}" for area in shown)
    if len(areas) > len(shown):
        text += f", … {len(areas) - len(shown)} smaller"
    return text


def floor2(value: float) -> float:
    return math.floor(value * 100 + 1e-9) / 100


def ceil2(value: float) -> float:
    return math.ceil(value * 100 - 1e-9) / 100


def main() -> None:
    print(f"source: {SRC}")
    viewbox, path_count, ring_count, open_rings, polygons = load_polygons(SRC)
    vb_x, vb_y, vb_w, vb_h = viewbox
    aspect = vb_w / vb_h
    print(
        f"input viewBox: {vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}  "
        f"paths: {path_count}  rings: {ring_count}  open rings skipped: {open_rings}"
    )
    print(f"input polygons: {len(polygons)}")

    welded = unary_union(polygons)
    welded = welded.buffer(WELD_PX).buffer(-WELD_PX)
    welded = clean(welded)
    pixel_parts = as_polygons(welded)
    print(f"polygons after weld ({WELD_PX} px): {len(pixel_parts)}")

    norm = affinity.affine_transform(
        unary_union(pixel_parts),
        [1 / vb_w, 0, 0, 1 / vb_h, -vb_x / vb_w, -vb_y / vb_h],
    )
    norm_parts = as_polygons(clean(norm))
    kept, dropped = prune(norm_parts, MIN_ISLAND_AREA)
    kept_areas = sorted(float(poly.area) for poly in kept)
    print(f"pruned micro-islands: {len(dropped)}  (area < {MIN_ISLAND_AREA:.1e})")
    print(f"  dropped areas: {fmt_areas(dropped)}")
    if kept_areas:
        print(f"  smallest kept areas: {fmt_areas(kept_areas[:8])}")
    before_uv = kept

    crop = box(-0.5, ARCTIC_CUT, 1.5, 1.5)
    cropped = clean(unary_union(kept).intersection(crop))
    cropped_parts = as_polygons(cropped)
    surviving, slivers = prune(cropped_parts, MIN_ISLAND_AREA)
    print(f"polygons after arctic cut v>={ARCTIC_CUT}: {len(cropped_parts)}")
    print(f"pruned arctic slivers: {len(slivers)}")
    if slivers:
        print(f"  sliver areas: {fmt_areas(slivers)}")

    def warp_point(x: float, y: float) -> tuple[float, float]:
        return warp_uv(x, y, aspect)

    warped_parts = []
    for poly in surviving:
        warped_parts.extend(map_polygon(poly, warp_point))
    warped = clean(unary_union(warped_parts))
    warped_kept, warped_dust = prune(as_polygons(warped), MIN_ISLAND_AREA)
    print(f"polygons after warp union: {len(as_polygons(warped))}")
    print(f"pruned after warp: {len(warped_dust)}")
    if warped_dust:
        print(f"  after-warp areas: {fmt_areas(warped_dust)}")
    after_uv = warped_kept

    span = 1.0 - ARCTIC_CUT
    usable = 1.0 - TOP_PAD - BOTTOM_PAD
    a_v = usable / span
    b_v = TOP_PAD - ARCTIC_CUT * a_v
    pixel = affinity.affine_transform(
        unary_union(after_uv),
        [vb_w, 0, 0, a_v * vb_h, 0, b_v * vb_h],
    )
    simplified = clean(pixel.simplify(SIMPLIFY_PX, preserve_topology=True))
    output = [orient(poly, sign=1.0) for poly in as_polygons(simplified)]
    output.sort(key=lambda poly: poly.area, reverse=True)
    print(f"output polygons: {len(output)}")
    print(f"output vertices: {vertex_count(output)}")

    minx, miny, maxx, maxy = unary_union(output).bounds
    miny = min(miny, 0.0)
    maxy = max(maxy, vb_h)
    minx, miny, maxx, maxy = floor2(minx), floor2(miny), ceil2(maxx), ceil2(maxy)
    out_w = maxx - minx
    out_h = maxy - miny
    print(
        f"bbox px: minx={minx:.2f} miny={miny:.2f} maxx={maxx:.2f} maxy={maxy:.2f} "
        f"width={out_w:.2f} height={out_h:.2f}"
    )
    print(f"viewBox: {minx:.2f} {miny:.2f} {out_w:.2f} {out_h:.2f}")
    u_min = min(poly.bounds[0] for poly in after_uv)
    u_max = max(poly.bounds[2] for poly in after_uv)
    v_min = min(poly.bounds[1] for poly in after_uv)
    v_max = max(poly.bounds[3] for poly in after_uv)
    print(
        f"warped (u, v) before padding: u {u_min:.4f}..{u_max:.4f}  "
        f"v {v_min:.4f}..{v_max:.4f}"
    )

    write_svg(output, (minx, miny, out_w, out_h))
    draw_preview(before_uv, after_uv, vb_h / vb_w)
    print(f"wrote {DST}")
    print(f"wrote {PREVIEW}")


if __name__ == "__main__":
    main()
