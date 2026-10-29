// Cutting and welding region cutters with boolean geometry. Pure and DOM-free.
//
//   splitPolygon   a knife polyline divides one cutter into two that share the cut vertices exactly
//   mergePolygons  two adjacent cutters of one layer weld back into one
//   masterBlocks   the part of the canvas no cutter covers yet, as blocks ready to be sliced
//   anchorFor      a point well inside a clipped shape, for the unit stack anchor
import polygonClipping from "polygon-clipping";
import {
  multiPolygonArea,
  type MultiPolygon,
  type Pair,
  pointInMultiPolygon,
  type Polygon,
  type Ring,
  ringArea,
  type RegionClipper,
} from "../regionClip";
import { pointInPolygon, type Rect, type Vec2 } from "../geometry";
import { dist, labelPoint } from "./editorModel";

export type SliceResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** How far the knife's end segments are extended past the line you drew, in world units. */
const KNIFE_REACH = 1e4;
/** Pieces and blocks smaller than this (world units squared) are noise, not regions. */
const MIN_AREA = 0.5;
/** Unallocated blocks whose visible (clipped) area is below this are not worth a region. */
const MIN_BLOCK_AREA = 4;
/** Vertices this close are the same vertex after a boolean operation. */
const WELD_EPS = 1e-6;

const toRing = (points: Vec2[]): Ring => points.map((p): Pair => [p.x, p.y]);

/** polygon-clipping closes its rings (first point repeated). Ours are open. */
function fromRing(ring: Ring): Vec2[] {
  const out: Vec2[] = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (!last || dist(last, { x, y }) > WELD_EPS) {
      out.push({ x, y });
    }
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= WELD_EPS) {
    out.pop();
  }
  return out;
}

function ringAreaOf(points: Vec2[]): number {
  return ringArea(toRing(points));
}

// ---------------------------------------------------------------
// Knife
// ---------------------------------------------------------------

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** True when open segments ab and cd cross at a single interior point of both. */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) {
    return false;
  }
  const t = cross(sub(c, a), s) / denom;
  const u = cross(sub(c, a), r) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

function unit(from: Vec2, to: Vec2): Vec2 {
  const len = dist(from, to);
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
}

/** Points on a circle of radius `r` around `c` from angle `from` to `to`, sweeping the given way. */
function arc(c: Vec2, r: number, from: number, to: number, way: 1 | -1): Vec2[] {
  const full = Math.PI * 2;
  const mod = (n: number) => ((n % full) + full) % full;
  const sweep = way === 1 ? mod(to - from) : -mod(from - to);
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 8)));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = from + (sweep * i) / steps;
    out.push({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });
  }
  return out;
}

/** One side of an extended knife line, closed far outside the map into a polygon. */
function halfPlane(extended: Vec2[], center: Vec2, way: 1 | -1): Polygon {
  const start = extended[0];
  const end = extended[extended.length - 1];
  const angleOf = (p: Vec2) => Math.atan2(p.y - center.y, p.x - center.x);
  const closing = arc(center, KNIFE_REACH * 4, angleOf(end), angleOf(start), way);
  return [toRing([...extended, ...closing])];
}

const CROSS_ERROR = "The knife line has to cross the region from one side to the other.";
const THIN_ERROR = "That cut leaves a piece too thin to keep. Move the line away from the edge.";

/** The polygons of one side of a cut as single-ring pieces (holes bridged), dropping slivers. */
function piecesOf(mp: MultiPolygon): Vec2[][] {
  const out: Vec2[][] = [];
  for (const poly of mp) {
    const outer = fromRing(poly[0]);
    const holes = poly
      .slice(1)
      .map(fromRing)
      .filter((h) => h.length >= 3);
    const ring = holes.length > 0 ? bridgeHoles(outer, holes) : outer;
    if (ring.length >= 3 && ringAreaOf(ring) >= MIN_AREA) {
      out.push(ring);
    }
  }
  return out;
}

/**
 * Splits `polygon` along a knife polyline into one or more pieces per side. The first and last segments are
 * extended outward, so the line only has to start and end outside the region (or anywhere along the
 * extension). Every piece comes out of the same boolean operation against the same cut, and the cut
 * vertices are then made bit-identical, so neighbors share their border exactly: no gap, no overlap.
 */
function cutPolygon(polygon: Vec2[], knife: Vec2[]): SliceResult<{ left: Vec2[][]; right: Vec2[][] }> {
  const line: Vec2[] = [];
  for (const p of knife) {
    if (!line.length || dist(line[line.length - 1], p) > 1e-6) {
      line.push({ ...p });
    }
  }
  if (polygon.length < 3) {
    return { ok: false, error: "The region has no outline to cut." };
  }
  if (line.length < 2) {
    return { ok: false, error: "Place at least two points for the knife line." };
  }

  // Each end runs on, in the direction of its own segment, far past the map.
  const head = unit(line[1], line[0]);
  const last = line[line.length - 1];
  const tail = unit(line[line.length - 2], last);
  const extended: Vec2[] = [
    { x: line[0].x + head.x * KNIFE_REACH, y: line[0].y + head.y * KNIFE_REACH },
    ...line,
    { x: last.x + tail.x * KNIFE_REACH, y: last.y + tail.y * KNIFE_REACH },
  ];

  for (let i = 0; i + 1 < extended.length; i++) {
    if (i + 2 < extended.length) {
      const d1 = sub(extended[i + 1], extended[i]);
      const d2 = sub(extended[i + 2], extended[i + 1]);
      if (Math.abs(cross(d1, d2)) < 1e-9 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y) && d1.x * d2.x + d1.y * d2.y < 0) {
        return { ok: false, error: "The knife line doubles back on itself." };
      }
    }
    for (let j = i + 2; j + 1 < extended.length; j++) {
      if (segmentsCross(extended[i], extended[i + 1], extended[j], extended[j + 1])) {
        return { ok: false, error: "The knife line crosses itself." };
      }
    }
  }

  const all = [...polygon, ...line];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const subject: Polygon = [toRing(polygon)];

  let first: MultiPolygon;
  let second: MultiPolygon;
  try {
    first = polygonClipping.intersection(subject, halfPlane(extended, center, 1));
    second = polygonClipping.intersection(subject, halfPlane(extended, center, -1));
  } catch {
    return { ok: false, error: "The region outline is degenerate, so it cannot be cut. Fix its vertices first." };
  }

  if (first.length === 0 || second.length === 0) {
    return { ok: false, error: CROSS_ERROR };
  }
  const left = piecesOf(first);
  const rightRaw = piecesOf(second);
  if (left.length === 0 || rightRaw.length === 0) {
    return { ok: false, error: THIN_ERROR };
  }

  // Both runs computed the same crossings; make them identical to the last bit.
  const shared = left.flat();
  const right = rightRaw.map((ring) => ring.map((v) => ({ ...(shared.find((w) => dist(v, w) <= WELD_EPS) ?? v) })));
  return { ok: true, left, right };
}

/** Two pieces exactly: one on each side of the knife. Anything else is refused. */
export function splitPolygon(polygon: Vec2[], knife: Vec2[]): SliceResult<{ a: Vec2[]; b: Vec2[] }> {
  const cut = cutPolygon(polygon, knife);
  if (!cut.ok) {
    return cut;
  }
  if (cut.left.length > 1 || cut.right.length > 1) {
    return {
      ok: false,
      error: `That cut would leave more than two pieces (${cut.left.length > 1 ? "left" : "right"} side). Draw it so it crosses the outline only twice.`,
    };
  }
  return { ok: true, a: cut.left[0], b: cut.right[0] };
}

/** Every piece the knife makes, largest first. A concave region can come apart into three or more. */
export function splitPolygonInto(polygon: Vec2[], knife: Vec2[]): SliceResult<{ pieces: Vec2[][] }> {
  const cut = cutPolygon(polygon, knife);
  if (!cut.ok) {
    return cut;
  }
  const pieces = [...cut.left, ...cut.right].sort((p, q) => ringAreaOf(q) - ringAreaOf(p));
  return { ok: true, pieces };
}

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

/**
 * Welds two cutters into one. B's vertices within `snapEps` of one of A's are moved onto it first, so a
 * border drawn by hand (not quite coincident) still closes up.
 */
export function mergePolygons(a: Vec2[], b: Vec2[], snapEps: number): SliceResult<{ points: Vec2[] }> {
  const snapped = fromRing(
    toRing(
      b.map((v) => {
        let best: Vec2 | null = null;
        let bestDist = snapEps;
        for (const w of a) {
          const d = dist(v, w);
          if (d <= bestDist) {
            bestDist = d;
            best = w;
          }
        }
        return best ?? v;
      }),
    ),
  );
  let union: MultiPolygon;
  try {
    union = polygonClipping.union([toRing(a)], [toRing(snapped)]);
  } catch {
    return { ok: false, error: "One of the outlines is degenerate, so they cannot be merged." };
  }
  if (union.length === 0) {
    return { ok: false, error: "Nothing to merge." };
  }
  if (union.length > 1) {
    return { ok: false, error: "These regions do not share a border. Merge needs two neighbors." };
  }
  if (union[0].length > 1) {
    return { ok: false, error: "Merging would leave a hole between them. Merge the regions around it first." };
  }
  return { ok: true, points: fromRing(union[0][0]) };
}

// ---------------------------------------------------------------
// Master blocks
// ---------------------------------------------------------------

/** Edges of a ring as [from, to] pairs. */
function edgesOf(ring: Vec2[]): [Vec2, Vec2][] {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
}

/**
 * Joins each hole to the outline with a hairline cut (two coincident edges), giving one ring that covers
 * exactly the same area as the outline with its holes. A region has a single ring, and a block that merely
 * ignored its holes would overlap whatever sits in them.
 */
function bridgeHoles(outer: Vec2[], holes: Vec2[][]): Vec2[] {
  let ring = outer;
  const pending = [...holes].sort((a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x)));
  while (pending.length > 0) {
    const hole = pending.shift() as Vec2[];
    const blockers = [...edgesOf(ring), ...edgesOf(hole), ...pending.flatMap(edgesOf)];
    const pairs: { r: number; h: number; d: number }[] = [];
    ring.forEach((p, r) => hole.forEach((q, h) => pairs.push({ r, h, d: dist(p, q) })));
    pairs.sort((a, b) => a.d - b.d);
    const clear = ({ r, h }: { r: number; h: number }) => {
      const a = ring[r];
      const b = hole[h];
      if (blockers.some(([c, d]) => segmentsCross(a, b, c, d))) {
        return false;
      }
      // The cut must run through free space, not through a hole or outside the outline.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return pointInPolygon(mid, ring) && !pointInPolygon(mid, hole) && !pending.some((other) => pointInPolygon(mid, other));
    };
    const best = pairs.find(clear);
    if (!best) {
      continue; // cannot be bridged cleanly; the hole is left to the regions around it
    }
    const around = [...hole.slice(best.h), ...hole.slice(0, best.h), hole[best.h]];
    ring = [...ring.slice(0, best.r + 1), ...around, ring[best.r], ...ring.slice(best.r + 1)].map((p) => ({ ...p }));
  }
  return ring;
}

/**
 * The canvas minus every cutter already in the layer, as outlines ready to become regions. Blocks with
 * nothing of that layer inside them (open ocean when asking for land) are dropped. A block that wraps
 * around other regions reaches them through hairline cuts, so it never overlaps them.
 */
export function masterBlocks(
  layerCutters: Vec2[][],
  canvas: Rect,
  type: "land" | "sea",
  clipper: RegionClipper,
): { blocks: Vec2[][] } {
  const base: Ring = [
    [canvas.x, canvas.y],
    [canvas.x + canvas.w, canvas.y],
    [canvas.x + canvas.w, canvas.y + canvas.h],
    [canvas.x, canvas.y + canvas.h],
  ];
  const others: Polygon[] = layerCutters.filter((p) => p.length >= 3).map((p) => [toRing(p)]);
  const free: MultiPolygon =
    others.length === 0 ? [[base]] : polygonClipping.difference([base], ...others);
  const blocks: Vec2[][] = [];
  for (const poly of free) {
    const outline = fromRing(poly[0]);
    if (outline.length < 3 || ringAreaOf(outline) < MIN_BLOCK_AREA) {
      continue;
    }
    const holes = poly.slice(1).map(fromRing).filter((h) => h.length >= 3);
    const block = bridgeHoles(outline, holes);
    const visible = multiPolygonArea(clipper.clip({ id: "master-block", type, points: block }));
    if (visible < MIN_BLOCK_AREA) {
      continue;
    }
    blocks.push(block);
  }
  return { blocks };
}
// ---------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------

function evenOddInside(p: Vec2, rings: Ring[]): boolean {
  return pointInMultiPolygon(p, [rings]);
}

function ringClearance(p: Vec2, rings: Ring[]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t)));
    }
  }
  return best;
}

/**
 * The point inside the polygon (holes respected) farthest from every edge: the middle of its widest part.
 * A grid search that narrows in on the best cell.
 */
export function interiorPoint(polygon: Polygon): Vec2 | null {
  const outer = polygon[0];
  if (!outer || outer.length < 3) {
    return null;
  }
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  let step = Math.max(x1 - x0, y1 - y0) / 32;
  if (step <= 0) {
    return null;
  }
  let best: { p: Vec2; d: number } | null = null;
  const scan = (ax: number, ay: number, bx: number, by: number) => {
    for (let x = ax; x <= bx + 1e-9; x += step) {
      for (let y = ay; y <= by + 1e-9; y += step) {
        const p = { x, y };
        if (!evenOddInside(p, polygon)) {
          continue;
        }
        const d = ringClearance(p, polygon);
        if (!best || d > best.d) {
          best = { p, d };
        }
      }
    }
  };
  scan(x0, y0, x1, y1);
  if (!best) {
    const fallback = labelPoint(fromRing(outer));
    return evenOddInside(fallback, polygon) ? fallback : null;
  }
  for (let round = 0; round < 5; round++) {
    const centre = (best as { p: Vec2; d: number }).p;
    scan(centre.x - step, centre.y - step, centre.x + step, centre.y + step);
    step /= 2;
  }
  return (best as { p: Vec2; d: number }).p;
}

/**
 * Where a region's unit stack belongs: `prefer` if it is still inside the shape, otherwise the middle of
 * the shape's largest piece. Null when the shape is empty.
 */
export function anchorFor(shape: MultiPolygon, prefer?: Vec2): Vec2 | null {
  if (shape.length === 0) {
    return null;
  }
  if (prefer && pointInMultiPolygon(prefer, shape)) {
    return prefer;
  }
  let largest = shape[0];
  let largestArea = -1;
  for (const poly of shape) {
    const area = multiPolygonArea([poly]);
    if (area > largestArea) {
      largestArea = area;
      largest = poly;
    }
  }
  return interiorPoint(largest);
}
