"""Cut Suez and Panama slots into a wrapped Global land SVG.

Reads the backup only. Writes world_global_canals.svg and canals_preview.png.
Does not modify the source SVG or the backup.

Angles are degrees in SVG space (y grows south). 0 means the canal runs
east-west. 90 means it runs north-south. Width is the gap across the canal.
"""

from __future__ import annotations

import argparse
import math
import re
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import make_valid
from svgpathtools import Line, parse_path

# Gap across each canal, in SVG units. Wide enough to read at strategic zoom.
DEFAULT_CANAL_WIDTH = 2.6
# Extra length, in SVG units, so the slot clears both shorelines.
LENGTH_PAD = 10.0

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
SKIP_TAGS = {"defs", "clipPath", "mask", "symbol", "marker", "pattern"}
NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
TRANSFORM_RE = re.compile(
    r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)",
    re.IGNORECASE,
)


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


def apply_tf(matrix, x, y):
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def parse_transform(text):
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
        elif kind == "rotate" and nums:
            ang = math.radians(nums[0])
            cos, sin = math.cos(ang), math.sin(ang)
            local = (cos, sin, -sin, cos, 0.0, 0.0)
            if len(nums) >= 3:
                cx, cy = nums[1], nums[2]
                local = mul(mul((1.0, 0.0, 0.0, 1.0, cx, cy), local), (1.0, 0.0, 0.0, 1.0, -cx, -cy))
        matrix = mul(matrix, local)
    return matrix


def tag_name(elem):
    return elem.tag.split("}")[-1]


def parse_viewbox(root):
    raw = root.get("viewBox")
    if raw:
        parts = [float(n) for n in NUM_RE.findall(raw)]
        if len(parts) >= 4 and parts[2] > 0 and parts[3] > 0:
            return parts[0], parts[1], parts[2], parts[3]
    width = float(NUM_RE.search(root.get("width") or "1000").group())
    height = float(NUM_RE.search(root.get("height") or "504").group())
    return 0.0, 0.0, width, height


def iter_paths(elem, parent):
    name = tag_name(elem)
    if name in SKIP_TAGS:
        return
    matrix = mul(parent, parse_transform(elem.get("transform")))
    if name == "path":
        d = elem.get("d")
        if d and d.strip():
            yield d, matrix, elem.get("transform")
    for child in list(elem):
        yield from iter_paths(child, matrix)


def dedupe(pts):
    cleaned = []
    for point in pts:
        if cleaned and abs(cleaned[-1][0] - point[0]) < 1e-6 and abs(cleaned[-1][1] - point[1]) < 1e-6:
            continue
        cleaned.append(point)
    if len(cleaned) > 1 and abs(cleaned[0][0] - cleaned[-1][0]) < 1e-6 and abs(cleaned[0][1] - cleaned[-1][1]) < 1e-6:
        cleaned[-1] = cleaned[0]
    return cleaned


def flatten_subpath(sub, matrix):
    pts = []
    for seg in sub:
        steps = 1 if isinstance(seg, Line) else max(2, int(math.ceil(float(seg.length()) / 0.5)))
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


def signed_area(pts):
    area = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        area += x0 * y1 - x1 * y0
    return 0.5 * area


def explode(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        if geom.exterior is None or geom.area <= 0:
            return []
        return [geom]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
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


def land_from_rings(rings):
    rings = [ring for ring in rings if abs(ring[1]) > 1e-4]
    if not rings:
        return []
    rings.sort(key=lambda ring: abs(ring[1]), reverse=True)
    fill_positive = rings[0][1] >= 0
    outers, holes = [], []
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


def load_items(path: Path):
    root = ET.parse(path).getroot()
    viewbox = parse_viewbox(root)
    items = []
    for d, matrix, raw_transform in iter_paths(root, IDENTITY):
        try:
            parsed = parse_path(d)
        except Exception as exc:
            print(f"skipped a path that did not parse: {exc}")
            continue
        rings = []
        for sub in parsed.continuous_subpaths():
            pts = flatten_subpath(sub, matrix)
            if pts is None:
                continue
            rings.append((pts, signed_area(pts)))
        polys = land_from_rings(rings)
        if not polys:
            continue
        items.append({
            "d": d if not raw_transform else None,
            "polys": polys,
        })
    return viewbox, items


def horizontal_segments(poly, y):
    minx, _, maxx, _ = poly.bounds
    inter = poly.intersection(LineString([(minx - 20, y), (maxx + 20, y)]))
    if inter.is_empty:
        return []
    parts = [inter] if inter.geom_type == "LineString" else list(getattr(inter, "geoms", []))
    return [part for part in parts if part.length > 0.4]


def detect_panama(items):
    """Narrowest east-west neck between wide North America and wide South America."""
    americas = None
    for item in items:
        for poly in item["polys"]:
            minx, miny, maxx, maxy = poly.bounds
            if minx < 40 and (maxy - miny) > 250 and poly.area > 5000:
                if americas is None or poly.area > americas.area:
                    americas = poly
    if americas is None:
        raise SystemExit("could not find the Americas polygon for the Panama neck")
    samples = []
    y = americas.bounds[1] + 15
    while y < americas.bounds[3] - 15:
        parts = horizontal_segments(americas, y)
        if parts:
            samples.append((y, max(part.length for part in parts), parts))
        y += 0.5
    best = None
    for y, narrow, parts in samples:
        if not 3.0 <= narrow <= 22.0:
            continue
        north = any(wide > 40 and 18 <= (y - other_y) <= 55 for other_y, wide, _ in samples)
        south = any(wide > 40 and 18 <= (other_y - y) <= 55 for other_y, wide, _ in samples)
        if not (north and south):
            continue
        if best is None or narrow < best[1]:
            best = (y, narrow, parts)
    if best is None:
        raise SystemExit("could not find a Panama neck; pass --panama-x and --panama-y")
    y, narrow, parts = best
    xs = [pt for part in parts for pt in (part.bounds[0], part.bounds[2])]
    x0, x1 = min(xs), max(xs)
    return {
        "x": (x0 + x1) / 2,
        "y": y,
        "width": DEFAULT_CANAL_WIDTH,
        "angle": 0.0,
        "length": max(x1 - x0, narrow) + LENGTH_PAD,
        "neck": narrow,
    }


def detect_suez(items):
    """Shortest north-south land bridge between the eastern sea pair (Med and Red Sea)."""
    eurasia = None
    for item in items:
        for poly in item["polys"]:
            minx, miny, maxx, maxy = poly.bounds
            if minx > 150 and poly.area > 20000:
                if eurasia is None or poly.area > eurasia.area:
                    eurasia = poly
    if eurasia is None:
        raise SystemExit("could not find the Africa-Eurasia polygon for the Suez neck")
    minx, miny, maxx, maxy = eurasia.bounds
    x0 = (minx + maxx) / 2
    y0 = miny
    y1 = miny + (maxy - miny) * 0.55
    step = 1.5
    nx = int((maxx - x0) / step)
    ny = int((y1 - y0) / step)
    land = [[False] * nx for _ in range(ny)]
    for j in range(ny):
        yy = y0 + (j + 0.5) * step
        for i in range(nx):
            xx = x0 + (i + 0.5) * step
            land[j][i] = eurasia.covers(Point(xx, yy))
    comp = [[-1] * nx for _ in range(ny)]
    info = []
    cid = 0
    for j in range(ny):
        for i in range(nx):
            if land[j][i] or comp[j][i] >= 0:
                continue
            queue = deque([(i, j)])
            comp[j][i] = cid
            cells = [(i, j)]
            border = i == 0 or j == 0 or i == nx - 1 or j == ny - 1
            while queue:
                x, y = queue.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a, b = x + dx, y + dy
                    if not (0 <= a < nx and 0 <= b < ny):
                        continue
                    if land[b][a] or comp[b][a] >= 0:
                        continue
                    comp[b][a] = cid
                    queue.append((a, b))
                    cells.append((a, b))
                    if a == 0 or b == 0 or a == nx - 1 or b == ny - 1:
                        border = True
            sx = sum(c[0] for c in cells) / len(cells)
            sy = sum(c[1] for c in cells) / len(cells)
            info.append({
                "id": cid,
                "n": len(cells),
                "border": border,
                "cx": x0 + sx * step,
                "cy": y0 + sy * step,
            })
            cid += 1
    oceans = [sea for sea in info if sea["border"] and sea["n"] > 40]
    pair = None
    for north in oceans:
        for south in oceans:
            if south["cy"] < north["cy"] + 50 or abs(south["cx"] - north["cx"]) > 80:
                continue
            gap = south["cy"] - north["cy"]
            if pair is None or gap > pair[2]:
                pair = (north, south, gap)
    if pair is None:
        raise SystemExit("could not find a Suez neck; pass --suez-x and --suez-y")
    south_id = pair[1]["id"]
    south_cells = [(i, j) for j in range(ny) for i in range(nx) if comp[j][i] == south_id]
    tip_j = min(j for _, j in south_cells)
    # Western head of the gulf: the Gulf of Suez, not the shorter pinch further east.
    head_band = [(i, j) for i, j in south_cells if j <= tip_j + 3]
    i_head = min(i for i, _ in head_band)
    # The Suez line is the westernmost vertical slot that actually separates
    # the Sinai peninsula. A shorter pinch further east only shaves the tip.
    best = None
    for i in range(max(0, i_head - 16), min(nx, i_head + 8)):
        j = tip_j
        while j >= 0 and not land[j][i]:
            j -= 1
        if j < 0 or not land[j][i]:
            continue
        bottom = j
        while j >= 0 and land[j][i]:
            j -= 1
        top = j + 1
        span = (bottom - top + 1) * step
        if not 6 <= span <= 40:
            continue
        cx = x0 + (i + 0.5) * step
        cy = y0 + ((top + bottom) / 2 + 0.5) * step
        length = span + LENGTH_PAD
        rect = box(cx - length / 2, cy - DEFAULT_CANAL_WIDTH / 2, cx + length / 2, cy + DEFAULT_CANAL_WIDTH / 2)
        rect = affinity.rotate(rect, 90, origin=(cx, cy))
        parts = [piece for piece in explode(clean(eurasia.difference(rect))) if piece.area > 40]
        if len(parts) < 2:
            continue
        small = min(parts, key=lambda piece: piece.area)
        if not 80 <= small.area <= 1500:
            continue
        if small.bounds[0] < cx - 1:
            continue
        if best is None or i < best["col"]:
            best = {
                "col": i,
                "x": cx,
                "y": cy,
                "width": DEFAULT_CANAL_WIDTH,
                "angle": 90.0,
                "length": length,
                "neck": span,
            }
    if best is None:
        raise SystemExit("could not find a Suez neck; pass --suez-x and --suez-y")
    return best


def slot(cx, cy, width, length, angle):
    rect = box(cx - length / 2, cy - width / 2, cx + length / 2, cy + width / 2)
    return affinity.rotate(rect, angle, origin=(cx, cy))


def apply_cuts(items, cutters):
    cutter = unary_union(cutters)
    kept_d = []
    changed = []
    for item in items:
        if item["d"] and not any(poly.intersects(cutter) for poly in item["polys"]):
            kept_d.append(item["d"])
            continue
        for poly in item["polys"]:
            if not poly.intersects(cutter):
                changed.append(poly)
                continue
            changed.extend(piece for piece in explode(clean(poly.difference(cutter))) if piece.area >= 1.0)
    return kept_d, [orient(poly, sign=1.0) for poly in changed]


def ring_d(coords):
    x0, y0 = coords[0]
    parts = [f"M {x0:.2f} {y0:.2f}"]
    for x, y in coords[1:-1]:
        parts.append(f"L {x:.2f} {y:.2f}")
    parts.append("Z")
    return " ".join(parts)


def polygon_d(poly):
    parts = [ring_d(list(poly.exterior.coords))]
    for hole in poly.interiors:
        parts.append(ring_d(list(hole.coords)))
    return " ".join(parts)


def write_svg(original_ds, polygons, dest: Path, viewbox):
    minx, miny, width, height = viewbox
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            '<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{width:.2f}" height="{height:.2f}" '
            f'viewBox="{minx:.2f} {miny:.2f} {width:.2f} {height:.2f}">'
        ),
        '  <g id="ne_110m_land" fill="#000000" stroke="none" fill-rule="nonzero">',
    ]
    for d in original_ds:
        lines.append(f'    <path d="{d}"/>')
    for poly in polygons:
        lines.append(f'    <path d="{polygon_d(poly)}"/>')
    lines.append("  </g>")
    lines.append("</svg>")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


def all_polygons(items):
    found = []
    for item in items:
        found.extend(item["polys"])
    return found


def write_preview(before, after, suez, panama, suez_cut, panama_cut, dest: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from shapely.plotting import plot_polygon

    fig, axes = plt.subplots(2, 2, figsize=(12, 10), dpi=140)

    def draw(ax, polys, cut, title, center, span):
        cx, cy = center
        for poly in polys:
            if poly.bounds[2] < cx - 40 or poly.bounds[0] > cx + 40:
                continue
            if poly.bounds[3] < cy - 40 or poly.bounds[1] > cy + 40:
                continue
            plot_polygon(poly, ax=ax, add_points=False, facecolor="#000000", edgecolor="none", linewidth=0)
        if cut is not None:
            plot_polygon(cut, ax=ax, add_points=False, facecolor="#c0392b", edgecolor="#c0392b", linewidth=0.4, alpha=0.85)
        ax.set_xlim(cx - span, cx + span)
        ax.set_ylim(cy - span, cy + span)
        ax.set_aspect("equal", adjustable="box")
        ax.invert_yaxis()
        ax.set_title(title, fontsize=10)
        ax.grid(True, color="#d5dbe2", linewidth=0.4)
        ax.tick_params(labelsize=7)

    suez_span = max(24, suez["length"] * 0.7)
    panama_span = max(24, panama["length"] * 0.7)
    draw(
        axes[0, 0], before, suez_cut,
        f"Suez before  ({suez['x']:.1f}, {suez['y']:.1f})  w={suez['width']:.1f}  a={suez['angle']:.0f}",
        (suez["x"], suez["y"]),
        suez_span,
    )
    draw(
        axes[0, 1], after, None,
        "Suez after",
        (suez["x"], suez["y"]),
        suez_span,
    )
    draw(
        axes[1, 0], before, panama_cut,
        f"Panama before  ({panama['x']:.1f}, {panama['y']:.1f})  w={panama['width']:.1f}  a={panama['angle']:.0f}",
        (panama["x"], panama["y"]),
        panama_span,
    )
    draw(
        axes[1, 1], after, None,
        "Panama after",
        (panama["x"], panama["y"]),
        panama_span,
    )
    fig.suptitle("Canal slots. Red on the before panels is the cutter.", fontsize=12)
    fig.tight_layout()
    fig.savefig(dest, facecolor="white")
    plt.close(fig)


def fill_canal(detected, x, y, width, angle):
    canal = dict(detected)
    if x is not None:
        canal["x"] = x
    if y is not None:
        canal["y"] = y
    if width is not None:
        canal["width"] = width
    if angle is not None:
        canal["angle"] = angle
    return canal


def main():
    downloads = Path.home() / "Downloads"
    parser = argparse.ArgumentParser(description="Cut Suez and Panama canal slots into the Global land SVG.")
    parser.add_argument(
        "--input",
        type=Path,
        default=downloads / "out" / "world_wrapped_ii_final_backup.svg",
    )
    parser.add_argument("--output", type=Path, default=downloads / "world_global_canals.svg")
    parser.add_argument("--preview", type=Path, default=downloads / "canals_preview.png")
    parser.add_argument("--suez-x", type=float, default=None)
    parser.add_argument("--suez-y", type=float, default=None)
    parser.add_argument("--suez-width", type=float, default=DEFAULT_CANAL_WIDTH)
    parser.add_argument("--suez-angle", type=float, default=None)
    parser.add_argument("--suez-length", type=float, default=None)
    parser.add_argument("--panama-x", type=float, default=None)
    parser.add_argument("--panama-y", type=float, default=None)
    parser.add_argument("--panama-width", type=float, default=DEFAULT_CANAL_WIDTH)
    parser.add_argument("--panama-angle", type=float, default=None)
    parser.add_argument("--panama-box", type=float, nargs=4, metavar=("X0", "Y0", "X1", "Y1"), default=None,
                        help="Axis-aligned Panama cutter: x0 y0 x1 y1. y grows south.")
    args = parser.parse_args()

    backup = (downloads / "world_global_final_backup.svg").resolve()
    source = (downloads / "world_wrapped_ii.svg").resolve()
    if args.output.resolve() in {backup, source, args.input.resolve()}:
        raise SystemExit("refusing to overwrite the source SVG or its backup")

    viewbox, items = load_items(args.input)
    print(f"source: {args.input}")
    print(f"viewBox: {viewbox[0]:.2f} {viewbox[1]:.2f} {viewbox[2]:.2f} {viewbox[3]:.2f}")
    print(f"input paths: {len(items)}")

    suez = fill_canal(detect_suez(items), args.suez_x, args.suez_y, args.suez_width, args.suez_angle)
    panama = fill_canal(detect_panama(items), args.panama_x, args.panama_y, args.panama_width, args.panama_angle)
    # Width flags replace the detector default even when left at the parser default.
    suez["width"] = args.suez_width
    if args.suez_length is not None:
        suez["length"] = args.suez_length
    panama["width"] = args.panama_width
    suez_cut = slot(suez["x"], suez["y"], suez["width"], suez["length"], suez["angle"])
    if args.panama_box is not None:
        x0, y0, x1, y1 = args.panama_box
        panama_cut = box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        panama["x"] = (x0 + x1) / 2
        panama["y"] = (y0 + y1) / 2
        panama["width"] = abs(x1 - x0)
        panama["length"] = abs(y1 - y0)
        panama["angle"] = 90.0
        panama["neck"] = abs(y1 - y0)
    else:
        panama_cut = slot(panama["x"], panama["y"], panama["width"], panama["length"], panama["angle"])
    for name, canal in (("Suez", suez), ("Panama", panama)):
        print(
            f"{name}: center=({canal['x']:.2f}, {canal['y']:.2f})  "
            f"width={canal['width']:.2f}  angle={canal['angle']:.1f}  "
            f"length={canal['length']:.1f}  neck={canal['neck']:.1f}"
        )
    before = all_polygons(items)
    kept_d, changed = apply_cuts(items, [suez_cut, panama_cut])
    after = []
    cutter = unary_union([suez_cut, panama_cut])
    for item in items:
        if item["d"] and not any(poly.intersects(cutter) for poly in item["polys"]):
            after.extend(item["polys"])
        else:
            for poly in item["polys"]:
                if poly.intersects(cutter):
                    after.extend(piece for piece in explode(clean(poly.difference(cutter))) if piece.area >= 1.0)
                else:
                    after.append(poly)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_svg(kept_d, changed, args.output, viewbox)
    write_preview(before, after, suez, panama, suez_cut, panama_cut, args.preview)
    print(f"output polygons written from {len(kept_d)} untouched paths and {len(changed)} cut pieces")
    print(f"wrote {args.output}")
    print(f"wrote {args.preview}")


if __name__ == "__main__":
    main()
