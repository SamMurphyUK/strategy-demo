"""Scale Pacific islands and drop stepping-stone atolls onto the wrapped map.

Reads the backup SVG only. Writes a new SVG and a preview PNG. It does not
modify world_wrapped_ii.svg or world_wrapped_ii_backup.svg.

Coordinates are SVG pixels, y growing south. Each rule matches a polygon whose
centroid falls in (cx, cy) and whose area falls in [min_area, max_area].
Scale is about that polygon's own centroid, then (dx, dy) is applied.
"""

from __future__ import annotations

import argparse
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import make_valid
from svgpathtools import Line, parse_path

# Easy to edit. Windows are centroid ranges on world_wrapped_ii.
# Borneo, Celebes, the Philippines, Sumatra, and Java are the money islands.
ISLAND_RULES = {
    "hawaii": {
        "cx": (770, 830),
        "cy": (290, 345),
        "min_area": 20,
        "max_area": 200,
        "scale": 1.75,
        "dx": -12.0,
        "dy": 8.0,
    },
    "celebes": {
        "cx": (705, 745),
        "cy": (280, 320),
        "min_area": 12,
        "max_area": 200,
        "scale": 1.2,
        "dx": 7.0,
        "dy": 5.0,
    },
    "philippines": {
        "cx": (700, 760),
        "cy": (205, 255),
        "min_area": 40,
        "max_area": 500,
        "scale": 1.2,
        "dx": 8.0,
        "dy": -3.0,
    },
    "borneo": {
        "cx": (650, 735),
        "cy": (235, 305),
        "min_area": 200,
        "max_area": 1500,
        "scale": 1.2,
        "dx": 4.0,
        "dy": 8.0,
    },
    "sumatra": {
        "cx": (560, 610),
        "cy": (340, 390),
        "min_area": 120,
        "max_area": 500,
        "scale": 1.2,
        "dx": -6.0,
        "dy": 4.0,
    },
    "java": {
        "cx": (590, 640),
        "cy": (350, 385),
        "min_area": 40,
        "max_area": 150,
        "scale": 1.2,
        "dx": -2.0,
        "dy": 5.0,
    },
    "new_guinea": {
        "cx": (610, 680),
        "cy": (355, 400),
        "min_area": 150,
        "max_area": 800,
        "scale": 1.2,
        "dx": 5.0,
        "dy": -7.0,
    },
    "new_britain_solomons": {
        "cx": (690, 760),
        "cy": (395, 435),
        "min_area": 6,
        "max_area": 80,
        "scale": 1.45,
        "dx": 8.0,
        "dy": 2.0,
    },
    "new_zealand": {
        "cx": (690, 760),
        "cy": (425, 480),
        "min_area": 30,
        "max_area": 400,
        "scale": 1.35,
        "dx": 8.0,
        "dy": 6.0,
    },
    "japan_islands": {
        "cx": (700, 770),
        "cy": (115, 200),
        "min_area": 6,
        "max_area": 400,
        "scale": 1.25,
        "dx": 6.0,
        "dy": 2.0,
    },
}

# name, anchor, dx, dy, rx, ry, seed. Anchors are filled from the matched islands.
ATOLL_SPECS = [
    ("midway", "hawaii", -18.0, -16.0, 5.6, 3.4, 1.0),
    ("wake", "hawaii", -34.0, -6.0, 4.4, 2.8, 2.2),
    ("iwo_jima", "japan", 10.0, 18.0, 3.8, 2.4, 3.1),
    ("marianas", "japan", 16.0, 30.0, 4.6, 2.8, 4.0),
    ("marianas_south", "japan", 22.0, 40.0, 3.4, 2.2, 4.6),
    ("carolines", "philippines", 28.0, 12.0, 5.2, 3.2, 5.3),
    ("palau", "philippines", 16.0, 18.0, 4.0, 2.6, 6.1),
    ("fiji", "new_guinea", 38.0, 10.0, 5.4, 3.4, 7.4),
    ("new_hebrides", "new_guinea", 26.0, 18.0, 4.6, 3.0, 8.2),
]

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
SKIP_TAGS = {"defs", "clipPath", "mask", "symbol", "marker", "pattern"}
NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
TRANSFORM_RE = re.compile(
    r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)",
    re.IGNORECASE,
)
SAMPLE_PX = 0.5
SEA_GAP = 3.5
CONTINENT_AREA = 2500.0


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
        elif kind == "skewx" and nums:
            local = (1.0, 0.0, math.tan(math.radians(nums[0])), 1.0, 0.0, 0.0)
        elif kind == "skewy" and nums:
            local = (1.0, math.tan(math.radians(nums[0])), 0.0, 1.0, 0.0, 0.0)
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
    width = float(NUM_RE.search(root.get("width") or "900").group())
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
            yield d, matrix
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


def load_polygons(path: Path):
    root = ET.parse(path).getroot()
    viewbox = parse_viewbox(root)
    polygons = []
    path_count = 0
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
                continue
            rings.append((pts, signed_area(pts)))
        polygons.extend(land_from_rings(rings))
    return viewbox, path_count, polygons


def matches(poly, rule):
    x, y = poly.centroid.x, poly.centroid.y
    x0, x1 = rule["cx"]
    y0, y1 = rule["cy"]
    area = poly.area
    return x0 <= x <= x1 and y0 <= y <= y1 and rule["min_area"] <= area <= rule["max_area"]


def assign_rules(polygons):
    """Return (plain, scaled) where scaled items are (name, polygon)."""
    plain = []
    scaled = []
    for poly in polygons:
        if poly.area >= CONTINENT_AREA:
            plain.append(poly)
            continue
        chosen = None
        for name, rule in ISLAND_RULES.items():
            if matches(poly, rule):
                chosen = (name, rule)
                break
        if chosen is None:
            plain.append(poly)
            continue
        name, rule = chosen
        grown = affinity.scale(poly, xfact=rule["scale"], yfact=rule["scale"], origin="centroid")
        grown = affinity.translate(grown, xoff=rule["dx"], yoff=rule["dy"])
        scaled.append((name, clean(grown)))
    return plain, scaled


def separate(movable, fixed, gap):
    for _ in range(16):
        changed = False
        for i, poly in enumerate(movable):
            others = list(fixed) + movable[:i] + movable[i + 1 :]
            for other in others:
                if other is None or other.is_empty:
                    continue
                if poly.distance(other) >= gap:
                    continue
                vx = poly.centroid.x - other.centroid.x
                vy = poly.centroid.y - other.centroid.y
                dist = math.hypot(vx, vy)
                if dist < 1e-6:
                    vx, vy, dist = 1.0, 0.0, 1.0
                step = max(gap - poly.distance(other), 1.0) + 0.5
                poly = affinity.translate(poly, xoff=vx / dist * step, yoff=vy / dist * step)
                changed = True
            movable[i] = clean(poly)
        if not changed:
            break
    return movable


def blob(cx, cy, rx, ry, seed):
    count = 10
    pts = []
    for i in range(count):
        ang = 2 * math.pi * i / count - math.pi / 2
        wobble = 0.78 + 0.22 * math.sin(seed * 1.7 + i * 2.3)
        pts.append((cx + math.cos(ang) * rx * wobble, cy + math.sin(ang) * ry * wobble))
    pts.append(pts[0])
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = clean(poly)
    return poly


def blocked_land(polygons, pad):
    if not polygons:
        return Polygon()
    return unary_union(polygons).buffer(pad)


def place_atoll(cx, cy, rx, ry, seed, blocked):
    for radius in [0, *range(4, 40, 4)]:
        spins = 1 if radius == 0 else 8
        for k in range(spins):
            ang = seed + k * math.pi / 4
            x = cx + math.cos(ang) * radius
            y = cy + math.sin(ang) * radius
            poly = blob(x, y, rx, ry, seed + k)
            if poly.is_empty or not poly.is_valid:
                continue
            if not poly.intersects(blocked):
                return poly
    return None


def japan_anchor(polygons, matched):
    japan = [poly for name, poly in matched if name == "japan_islands" and poly.area >= 40]
    if japan:
        big = max(japan, key=lambda poly: poly.area)
        return (big.centroid.x, big.centroid.y)
    coasts = [poly for poly in polygons if poly.area > 8000 and poly.bounds[2] > 700]
    points = []
    for poly in coasts:
        points.extend(pt for pt in poly.exterior.coords if 125 <= pt[1] <= 185)
    if not points:
        return None
    west = min(points, key=lambda pt: pt[0])
    return west


def anchor_points(matched, polygons):
    anchors = {}
    for name, _rule in ISLAND_RULES.items():
        group = [poly for label, poly in matched if label == name]
        if not group:
            continue
        big = max(group, key=lambda poly: poly.area)
        anchors[name] = (big.centroid.x, big.centroid.y)
    japan = japan_anchor([poly for _name, poly in matched] + polygons, matched)
    if japan is not None:
        anchors["japan"] = japan
    return anchors


def describe(poly):
    minx, miny, maxx, maxy = poly.bounds
    c = poly.centroid
    return (
        f"area={poly.area:8.1f}  centroid=({c.x:7.1f},{c.y:6.1f})  "
        f"bbox=({minx:7.1f},{miny:6.1f})-({maxx:7.1f},{maxy:6.1f})"
    )


def print_audit(polygons, matched_before):
    print("Pacific and East Asian polygons (area >= 40), plus every matched island:")
    named = {id(poly): name for name, poly in matched_before}
    rows = []
    for poly in polygons:
        label = named.get(id(poly))
        if poly.area >= 40 or label:
            rows.append((poly.centroid.x, label or "—", poly))
    for _x, label, poly in sorted(rows, key=lambda row: (row[2].centroid.y, row[0])):
        print(f"  {label:<22} {describe(poly)}")
    if not any(name == "japan_islands" and poly.area >= 80 for name, poly in matched_before):
        print("  Honshu is not a separate polygon. The Japan atolls use the west coast of the")
        print("  Bering / western-North-America mass, and only the small Japan-band islands are scaled.")


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


def write_svg(polygons, dest: Path, viewbox):
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
    for poly in polygons:
        lines.append(f'    <path d="{polygon_d(poly)}"/>')
    lines.append("  </g>")
    lines.append("</svg>")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_preview(land, atolls, labels, viewbox, dest: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from shapely.plotting import plot_polygon

    minx, miny, width, height = viewbox
    fig, ax = plt.subplots(figsize=(14, 8), dpi=140)
    for poly in land:
        plot_polygon(poly, ax=ax, add_points=False, facecolor="#000000", edgecolor="none", linewidth=0)
    for poly in atolls:
        plot_polygon(
            poly,
            ax=ax,
            add_points=False,
            facecolor="#000000",
            edgecolor="#1f6aa5",
            linewidth=0.8,
        )
    for text, x, y in labels:
        ax.text(x, y, text, color="#9a3412", fontsize=7, ha="center", va="bottom")
    ax.set_xlim(520, minx + width + 4)
    ax.set_ylim(miny, miny + height)
    ax.set_aspect("equal", adjustable="box")
    ax.invert_yaxis()
    ax.set_title("Pacific balance. Blue outline marks added atolls.", fontsize=12)
    ax.grid(True, color="#d0d5db", linewidth=0.4)
    fig.tight_layout()
    fig.savefig(dest, facecolor="white")
    plt.close(fig)


def output_viewbox(polygons, source):
    minx, miny, maxx, maxy = unary_union(polygons).bounds
    vb_x, vb_y, vb_w, vb_h = source
    left, top = vb_x, vb_y
    right, bottom = vb_x + vb_w, vb_y + vb_h
    if minx < left:
        left = math.floor(minx - 1)
    if miny < top:
        top = math.floor(miny - 1)
    if maxx > right:
        right = math.ceil(maxx + 1)
    if maxy > bottom:
        bottom = math.ceil(maxy + 1)
    return (left, top, right - left, bottom - top)


def default_backup():
    return Path.home() / "Downloads" / "world_wrapped_ii_backup.svg"


def main():
    downloads = Path.home() / "Downloads"
    parser = argparse.ArgumentParser(description="Scale Pacific islands and add stepping-stone atolls.")
    parser.add_argument("--input", type=Path, default=default_backup())
    parser.add_argument("--output", type=Path, default=downloads / "world_pacific_balanced.svg")
    parser.add_argument("--preview", type=Path, default=downloads / "pacific_preview.png")
    parser.add_argument("--min-area", type=float, default=3.0)
    parser.add_argument("--add-atolls", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    forbidden = {default_backup().resolve(), (downloads / "world_wrapped_ii.svg").resolve()}
    if args.output.resolve() in forbidden or args.input.resolve() == args.output.resolve():
        raise SystemExit("refusing to overwrite the source SVG or its backup")

    viewbox, path_count, polygons = load_polygons(args.input)
    print(f"source: {args.input}")
    print(f"input viewBox: {viewbox[0]:.2f} {viewbox[1]:.2f} {viewbox[2]:.2f} {viewbox[3]:.2f}")
    print(f"input paths: {path_count}")
    print(f"input polygons: {len(polygons)}")

    plain, scaled_pairs = assign_rules(polygons)
    matched_before = []
    for poly in polygons:
        if poly.area >= CONTINENT_AREA:
            continue
        for name, rule in ISLAND_RULES.items():
            if matches(poly, rule):
                matched_before.append((name, poly))
                break
    print_audit(polygons, matched_before)
    print("applied rules:")
    seen = {}
    for poly in polygons:
        if poly.area >= CONTINENT_AREA:
            continue
        for name, rule in ISLAND_RULES.items():
            if matches(poly, rule):
                seen.setdefault(name, []).append(poly)
                break
    for name, group in seen.items():
        rule = ISLAND_RULES[name]
        for poly in group:
            print(
                f"  {name:<22} {describe(poly)}  "
                f"scale={rule['scale']:.2f} dx={rule['dx']:.1f} dy={rule['dy']:.1f}"
            )
    missing = [name for name in ISLAND_RULES if name not in seen]
    if missing:
        print("  no polygon matched: " + ", ".join(missing))

    fixed = list(plain)
    movable = [poly for _name, poly in scaled_pairs]
    movable = separate(movable, fixed, SEA_GAP)
    atoll_polys = []
    atoll_labels = []
    if args.add_atolls:
        anchors = _anchors_after_move(scaled_pairs, movable, plain)
        print("anchors:")
        for name, (x, y) in anchors.items():
            print(f"  {name:<22} ({x:.1f}, {y:.1f})")
        occupied = plain + movable
        for name, anchor_name, dx, dy, rx, ry, seed in ATOLL_SPECS:
            anchor = anchors.get(anchor_name)
            if anchor is None:
                print(f"  atoll {name} skipped: no {anchor_name} anchor")
                continue
            blocked = blocked_land(occupied, 2.5)
            placed = place_atoll(anchor[0] + dx, anchor[1] + dy, rx, ry, seed, blocked)
            if placed is None:
                print(f"  atoll {name} skipped: no open water near the anchor")
                continue
            atoll_polys.append(placed)
            occupied.append(placed)
            atoll_labels.append((name.replace("_", " "), placed.centroid.x, placed.centroid.y))
            print(f"  atoll {name:<16} centroid=({placed.centroid.x:.1f}, {placed.centroid.y:.1f})")

    combined = plain + movable + atoll_polys
    kept = []
    dropped = 0
    for poly in combined:
        if poly is None or poly.is_empty or poly.area < args.min_area:
            dropped += 1
            continue
        kept.append(poly)
    welded = explode(clean(unary_union(kept)))
    welded = [orient(poly, sign=1.0) for poly in welded if poly.area >= args.min_area]
    welded.sort(key=lambda poly: poly.area, reverse=True)
    print(f"pruned area < {args.min_area:.2f}: {dropped}")
    print(f"output polygons: {len(welded)}  (atolls added: {len(atoll_polys)})")

    out_box = output_viewbox(welded, viewbox)
    bounds = unary_union(welded).bounds
    print(
        f"output bbox: x {bounds[0]:.2f}..{bounds[2]:.2f}  y {bounds[1]:.2f}..{bounds[3]:.2f}"
    )
    print(f"viewBox: {out_box[0]:.2f} {out_box[1]:.2f} {out_box[2]:.2f} {out_box[3]:.2f}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_svg(welded, args.output, out_box)
    labels = []
    for name, poly in _named_movable(scaled_pairs, movable):
        if poly is None or poly.is_empty:
            continue
        labels.append((name.replace("_", " "), poly.centroid.x, poly.centroid.y))
    labels.extend(atoll_labels)
    write_preview(
        [poly for poly in welded if poly not in atoll_polys],
        [poly for poly in welded if _near_any(poly, atoll_polys)],
        labels,
        out_box,
        args.preview,
    )
    print(f"wrote {args.output}")
    print(f"wrote {args.preview}")


def _named_movable(scaled_pairs, movable):
    return list(zip([name for name, _poly in scaled_pairs], movable))


def _anchors_after_move(scaled_pairs, movable, plain):
    anchors = {}
    named = _named_movable(scaled_pairs, movable)
    for name in ISLAND_RULES:
        group = [poly for label, poly in named if label == name and poly is not None and not poly.is_empty]
        if not group:
            continue
        big = max(group, key=lambda poly: poly.area)
        anchors[name] = (big.centroid.x, big.centroid.y)
    japan = japan_anchor(plain, [(name, poly) for name, poly in named])
    if japan is not None:
        anchors["japan"] = japan
    return anchors


def _near_any(poly, atolls):
    for atoll in atolls:
        if poly.distance(atoll) < 0.5 or poly.equals(atoll):
            return True
        if abs(poly.area - atoll.area) < 1.0 and poly.centroid.distance(atoll.centroid) < 1.0:
            return True
    return False


if __name__ == "__main__":
    main()
