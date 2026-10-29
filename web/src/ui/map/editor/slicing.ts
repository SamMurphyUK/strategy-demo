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
  uncoveredLand,
} from "../regionClip";
import { pointInPolygon, type Rect, type Vec2 } from "../geometry";
import { dist, labelPoint } from "./editorModel";

export type SliceResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** The longest an end of the knife line is stretched to reach the edge, in screen pixels. */
export const KNIFE_REACH_PX = 25;
/** A stroke ending this close to where it began is closed into a loop, in screen pixels. */
export const LOOP_CLOSE_PX = 20;
/** A self-crossing loop has to span at least this to count as a loop and not a tremor, in screen pixels. */
export const LOOP_MIN_PX = 12;
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

/** Outward unit directions in which the two ends of the knife line may be stretched. */
export interface LineEnds {
  head: Vec2;
  tail: Vec2;
}

export interface KnifeOptions {
  /** Longest stretch of each end, in world units (KNIFE_REACH_PX at the current zoom). */
  reach?: number;
  /** Stretch directions (averaged stroke tangents). Each end's own segment is used when absent. */
  ends?: LineEnds;
}

/** One place where the knife line meets the outline. `s` is the position along the line (segment + fraction). */
interface Hit {
  s: number;
  p: Vec2;
}

function lineHits(line: Vec2[], ring: Vec2[]): Hit[] {
  const raw: Hit[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const r = sub(line[i + 1], a);
    for (let k = 0; k < ring.length; k++) {
      const c = ring[k];
      const e = sub(ring[(k + 1) % ring.length], c);
      const denom = cross(r, e);
      if (Math.abs(denom) < 1e-12) {
        continue;
      }
      const t = cross(sub(c, a), e) / denom;
      const u = cross(sub(c, a), r) / denom;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) {
        continue;
      }
      raw.push({ s: i + Math.min(1, Math.max(0, t)), p: { x: a.x + r.x * t, y: a.y + r.y * t } });
    }
  }
  raw.sort((x, y) => x.s - y.s);
  const hits: Hit[] = [];
  for (const h of raw) {
    // A line through a vertex meets both edges there; that is one hit.
    if (!hits.length || dist(hits[hits.length - 1].p, h.p) > 1e-7) {
      hits.push(h);
    }
  }
  return hits;
}

/**
 * Stretches the two ends of the line, but only the ones that stopped inside the region, only along their own
 * direction, only as far as the nearest edge and never more than `reach`. An end that stopped in the open
 * cannot reach anything, so it stays where it is.
 */
function stretchEnds(line: Vec2[], ring: Vec2[], reach: number, ends?: LineEnds): Vec2[] {
  const out = line.map((p) => ({ ...p }));
  const overshoot = Math.max(1e-3, reach * 1e-3);
  const stretch = (from: Vec2, dir: Vec2): Vec2 | null => {
    if (!pointInPolygon(from, ring) || !Number.isFinite(dir.x) || !Number.isFinite(dir.y)) {
      return null;
    }
    const far = { x: from.x + dir.x * reach, y: from.y + dir.y * reach };
    const first = lineHits([from, far], ring)[0];
    if (!first) {
      return null;
    }
    const d = Math.min(reach, dist(from, first.p) + overshoot);
    return { x: from.x + dir.x * d, y: from.y + dir.y * d };
  };
  const n = out.length;
  const head = stretch(out[0], ends?.head ?? unit(out[1], out[0]));
  const tail = stretch(out[n - 1], ends?.tail ?? unit(out[n - 2], out[n - 1]));
  return [...(head ? [head] : []), ...out, ...(tail ? [tail] : [])];
}

/** The index of `p` in `ring`, adding it to the edge it lies on when it is not a vertex yet. -1: not on it. */
function vertexAt(ring: Vec2[], p: Vec2): number {
  const existing = ring.findIndex((q) => dist(p, q) <= 1e-5);
  if (existing >= 0) {
    return existing;
  }
  let best = -1;
  let bestDist = Infinity;
  ring.forEach((a, i) => {
    const d = distToSegment(p, a, ring[(i + 1) % ring.length]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  if (best < 0 || bestDist > 1e-4) {
    return -1;
  }
  ring.splice(best + 1, 0, { ...p });
  return best + 1;
}

/**
 * Cuts one outline in two along `chain`, a path that starts and ends on the outline and runs through the
 * inside. Both halves are made of the outline's own vertices and the chain's, so they share the chain
 * exactly. Returns null when the chain does not actually sit on the outline.
 */
function splitAlong(outline: Vec2[], chain: Vec2[]): [Vec2[], Vec2[]] | null {
  const ring = outline.map((p) => ({ ...p }));
  const a = vertexAt(ring, chain[0]);
  const b = a < 0 ? -1 : vertexAt(ring, chain[chain.length - 1]);
  if (a < 0 || b < 0) {
    return null;
  }
  // vertexAt may have inserted B before A; look A up again so both indices describe the final ring.
  const ia = ring.findIndex((q) => dist(q, chain[0]) <= 1e-5);
  const ib = ring.findIndex((q) => dist(q, chain[chain.length - 1]) <= 1e-5);
  if (ia < 0 || ib < 0 || ia === ib) {
    return null;
  }
  const walk = (from: number, to: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = from; ; i = (i + 1) % ring.length) {
      out.push({ ...ring[i] });
      if (i === to) {
        return out;
      }
    }
  };
  const inner = chain.slice(1, -1).map((p) => ({ ...p }));
  const first = dedupe([...walk(ia, ib), ...[...inner].reverse()]);
  const second = dedupe([...walk(ib, ia), ...inner]);
  return [first, second];
}

const CROSS_ERROR =
  "The knife line has to cross the region from one edge to another. It stretches only a few pixels past where you stop.";
const THIN_ERROR = "That cut leaves a piece too thin to keep. Move the line away from the edge.";

/** The polygons of one side of a cut as single-ring pieces (holes bridged), dropping slivers. */
function piecesOf(mp: MultiPolygon, minArea = MIN_AREA): Vec2[][] {
  const out: Vec2[][] = [];
  for (const poly of mp) {
    const outer = fromRing(poly[0]);
    const holes = poly
      .slice(1)
      .map(fromRing)
      .filter((h) => h.length >= 3);
    const ring = holes.length > 0 ? bridgeHoles(outer, holes) : outer;
    if (ring.length >= 3 && ringAreaOf(ring) >= minArea) {
      out.push(ring);
    }
  }
  return out;
}

function selfIntersects(line: Vec2[]): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    for (let j = i + 2; j + 1 < line.length; j++) {
      if (segmentsCross(line[i], line[i + 1], line[j], line[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Cases B and C: an open knife line across the region's real outline.
 *
 * Wherever the line is inside the region between two crossings of the outline, it is a chord that divides
 * the piece it runs through in two. Coast to coast (B) and in-and-out through one coast (C: France, Korea)
 * are the same operation: the cut runs only between the two crossings, so nothing outside the region is
 * ever touched, and the shore itself closes the new piece. An end that stopped inside the region is
 * stretched at most `reach` to meet the edge. The region's other pieces, islands and peninsulas the line
 * never enters are left alone.
 */
export function splitPolygonInto(polygon: Vec2[], knife: Vec2[], options: KnifeOptions = {}): SliceResult<{ pieces: Vec2[][]; ordered: boolean }> {
  const line = dedupe(knife, 1e-6);
  if (polygon.length < 3) {
    return { ok: false, error: "The region has no outline to cut." };
  }
  if (line.length < 2) {
    return { ok: false, error: "Place at least two points for the knife line." };
  }
  for (let i = 0; i + 2 < line.length; i++) {
    const d1 = sub(line[i + 1], line[i]);
    const d2 = sub(line[i + 2], line[i + 1]);
    if (Math.abs(cross(d1, d2)) < 1e-9 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y) && d1.x * d2.x + d1.y * d2.y < 0) {
      return { ok: false, error: "The knife line doubles back on itself." };
    }
  }
  if (selfIntersects(line)) {
    return { ok: false, error: "The knife line crosses itself." };
  }

  const reach = options.reach ?? KNIFE_REACH_PX;
  const stretched = stretchEnds(line, polygon, reach, options.ends);
  const hits = lineHits(stretched, polygon);
  const chains: Vec2[][] = [];
  for (let k = 0; k + 1 < hits.length; k++) {
    const from = hits[k];
    const to = hits[k + 1];
    const middle: Vec2[] = [];
    for (let v = Math.floor(from.s) + 1; v <= Math.ceil(to.s) - 1; v++) {
      if (v > from.s && v < to.s) {
        middle.push(stretched[v]);
      }
    }
    const chain = [from.p, ...middle, to.p];
    let longest = 0;
    for (let i = 0; i + 1 < chain.length; i++) {
      if (dist(chain[i], chain[i + 1]) > dist(chain[longest], chain[longest + 1])) {
        longest = i;
      }
    }
    const probe = { x: (chain[longest].x + chain[longest + 1].x) / 2, y: (chain[longest].y + chain[longest + 1].y) / 2 };
    if (dist(from.p, to.p) > 1e-6 && pointInPolygon(probe, polygon)) {
      chains.push(chain);
    }
  }
  if (chains.length === 0) {
    return { ok: false, error: CROSS_ERROR };
  }

  let pieces: Vec2[][] = [polygon.map((p) => ({ ...p }))];
  for (const chain of chains) {
    let longest = 0;
    for (let i = 0; i + 1 < chain.length; i++) {
      if (dist(chain[i], chain[i + 1]) > dist(chain[longest], chain[longest + 1])) {
        longest = i;
      }
    }
    const probe = { x: (chain[longest].x + chain[longest + 1].x) / 2, y: (chain[longest].y + chain[longest + 1].y) / 2 };
    const target = pieces.findIndex((ring) => pointInPolygon(probe, ring));
    if (target < 0) {
      return { ok: false, error: CROSS_ERROR };
    }
    const halves = splitAlong(pieces[target], chain);
    if (!halves) {
      return { ok: false, error: CROSS_ERROR };
    }
    if (halves.some((h) => h.length < 3 || ringAreaOf(h) < MIN_AREA)) {
      return { ok: false, error: THIN_ERROR };
    }
    pieces = [...pieces.slice(0, target), ...halves, ...pieces.slice(target + 1)];
  }
  pieces.sort((p, q) => ringAreaOf(q) - ringAreaOf(p));
  return { ok: true, pieces, ordered: false };
}

/** Two pieces exactly. Anything else is refused. */
export function splitPolygon(polygon: Vec2[], knife: Vec2[], options: KnifeOptions = {}): SliceResult<{ a: Vec2[]; b: Vec2[] }> {
  const cut = splitPolygonInto(polygon, knife, options);
  if (!cut.ok) {
    return cut;
  }
  if (cut.pieces.length !== 2) {
    return {
      ok: false,
      error: `That cut would leave ${cut.pieces.length} pieces. Draw it so it crosses the outline only twice.`,
    };
  }
  return { ok: true, a: cut.pieces[0], b: cut.pieces[1] };
}

/**
 * Case A: a closed loop inside the region carves out an inland piece. The surrounding country keeps the
 * original id (it comes first); the carved piece is the intersection with the loop. A loop that spills
 * over the coast only carves what is actually land.
 */
export function carveLoop(polygon: Vec2[], loop: Vec2[]): SliceResult<{ pieces: Vec2[][]; ordered: boolean }> {
  if (polygon.length < 3) {
    return { ok: false, error: "The region has no outline to cut." };
  }
  const ring = dedupe(loop, 1e-6);
  if (ring.length < 3 || ringAreaOf(ring) < MIN_AREA) {
    return { ok: false, error: "That loop encloses no area." };
  }
  const region: Polygon = [toRing(polygon)];
  const cutter: Polygon = [toRing(ring)];
  let outer: MultiPolygon;
  let inner: MultiPolygon;
  try {
    outer = polygonClipping.difference(region, cutter);
    inner = polygonClipping.intersection(region, cutter);
  } catch {
    return { ok: false, error: "The region outline is degenerate, so it cannot be cut. Fix its vertices first." };
  }
  if (inner.length === 0) {
    return { ok: false, error: "That loop is outside the region." };
  }
  const carved = piecesOf(inner);
  const rest = piecesOf(outer);
  if (carved.length === 0) {
    return { ok: false, error: THIN_ERROR };
  }
  if (rest.length === 0) {
    return { ok: false, error: "That loop covers the whole region. Draw it inside the border." };
  }
  // Both results were computed separately; make the shared border bit-identical.
  const shared = rest.flat();
  const welded = carved.map((r) => r.map((v) => ({ ...(shared.find((w) => dist(v, w) <= WELD_EPS) ?? v) })));
  return { ok: true, pieces: [...rest.sort((p, q) => ringAreaOf(q) - ringAreaOf(p)), ...welded], ordered: true };
}

function intersectionOf(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 {
  const r = sub(b, a);
  const s = sub(d, c);
  const t = cross(sub(c, a), s) / cross(r, s);
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Drops repeated points. */
function dedupe(points: Vec2[], eps = 1e-9): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (!out.length || dist(out[out.length - 1], p) > eps) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/**
 * Untangles a stroke: wherever it crosses itself (a tremor, a tiny loop), the loop between the two passes
 * is cut out and the line continues from the crossing point.
 */
export function removeLoops(stroke: Vec2[]): Vec2[] {
  let pts = dedupe(stroke);
  for (let guard = 0; guard < 500; guard++) {
    let found = false;
    outer: for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = i + 2; j + 1 < pts.length; j++) {
        if (segmentsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) {
          const p = intersectionOf(pts[i], pts[i + 1], pts[j], pts[j + 1]);
          pts = dedupe([...pts.slice(0, i + 1), p, ...pts.slice(j + 1)]);
          found = true;
          break outer;
        }
      }
    }
    if (!found) {
      break;
    }
  }
  return pts;
}

/** Chaikin corner cutting: each pass replaces every corner with two points at 1/4 and 3/4. Ends stay put. */
export function chaikin(points: Vec2[], iterations = 1): Vec2[] {
  let pts = points;
  for (let n = 0; n < iterations && pts.length > 2; n++) {
    const next: Vec2[] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const len2 = d.x * d.x + d.y * d.y;
  if (len2 === 0) {
    return dist(p, a);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2));
  return dist(p, { x: a.x + d.x * t, y: a.y + d.y * t });
}

/** Ramer-Douglas-Peucker: the fewest points that keep every dropped point within `tolerance` of the line. */
export function rdp(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) {
    return points.map((p) => ({ ...p }));
  }
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    let worst = -1;
    let worstDist = tolerance;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i], points[lo], points[hi]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}

/** The rounded curve shown under the cursor while tracing (display only; the cut uses prepareStroke). */
export function strokePreview(raw: Vec2[]): Vec2[] {
  return chaikin(dedupe(raw), 2);
}

export interface StrokeOptions {
  /** RDP tolerance in world units. */
  tolerance: number;
  /** One Chaikin pass before simplifying, so curves read as hand drawn. */
  smooth: boolean;
  /** How much of each end (world units of arc length) is averaged for the extension direction. */
  tangentSpan: number;
  /** A stroke ending this close to its start is a closed loop (world units). */
  closeDist: number;
  /** A self-crossing loop smaller than this is a tremor and is untangled, not carved (world units). */
  minLoop: number;
}

/** A knife stroke ready to cut: an open line, or (when `loop` is set) a closed ring to carve out. */
export interface PreparedStroke {
  line: Vec2[];
  ends: LineEnds;
  loop: Vec2[] | null;
}

/** Direction of the stroke at one end, averaged over `span` of arc length, pointing out of the stroke. */
function endTangent(points: Vec2[], span: number, atStart: boolean): Vec2 {
  const seq = atStart ? points : [...points].reverse();
  const end = seq[0];
  let walked = 0;
  let from = seq[0];
  for (let i = 1; i < seq.length && walked < span; i++) {
    walked += dist(seq[i - 1], seq[i]);
    from = seq[i];
  }
  return unit(from, end);
}

function spanOf(points: Vec2[]): number {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function pathLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    total += dist(points[i], points[i + 1]);
  }
  return total;
}

/**
 * A closed loop in the stroke, or null. Either the stroke crosses itself (the loop between the two passes,
 * if it is bigger than a tremor) or it ends within `closeDist` of where it began after covering real ground.
 */
function findLoop(points: Vec2[], closeDist: number, minLoop: number): Vec2[] | null {
  for (let j = 2; j + 1 < points.length; j++) {
    for (let i = 0; i <= j - 2; i++) {
      if (segmentsCross(points[i], points[i + 1], points[j], points[j + 1])) {
        const x = intersectionOf(points[i], points[i + 1], points[j], points[j + 1]);
        const ring = dedupe([x, ...points.slice(i + 1, j + 1)]);
        if (ring.length >= 3 && spanOf(ring) >= minLoop) {
          return ring;
        }
      }
    }
  }
  const n = points.length;
  if (n >= 3 && dist(points[0], points[n - 1]) <= closeDist && pathLength(points) >= closeDist * 2.5 && spanOf(points) >= minLoop) {
    return dedupe(points);
  }
  return null;
}

/**
 * Turns a raw freehand stroke (hundreds of mouse samples) into a clean knife line: loops untangled,
 * optionally Chaikin-rounded, RDP-simplified, and the two stretch directions averaged over the first and
 * last `tangentSpan` of the stroke so the final twitch of the mouse does not aim them. A stroke that
 * closes on itself comes back as a `loop` instead.
 */
export function prepareStroke(raw: Vec2[], options: StrokeOptions): PreparedStroke | null {
  const points = dedupe(raw);
  if (points.length < 2) {
    return null;
  }
  const closed = findLoop(points, options.closeDist, options.minLoop);
  if (closed) {
    const sequence = [...closed, closed[0]];
    const rounded = options.smooth ? chaikin(sequence, 1) : sequence;
    const ring = dedupe(rdp(rounded, options.tolerance));
    if (ring.length > 1 && dist(ring[0], ring[ring.length - 1]) <= 1e-9) {
      ring.pop();
    }
    if (ring.length < 3) {
      return null;
    }
    return {
      line: ring,
      ends: { head: endTangent(points, options.tangentSpan, true), tail: endTangent(points, options.tangentSpan, false) },
      loop: ring,
    };
  }
  const loopless = removeLoops(points);
  if (loopless.length < 2 || dist(loopless[0], loopless[loopless.length - 1]) < 1e-6) {
    return null;
  }
  const rounded = options.smooth ? chaikin(loopless, 1) : loopless;
  const line = removeLoops(rdp(rounded, options.tolerance));
  if (line.length < 2) {
    return null;
  }
  return {
    line,
    ends: {
      head: endTangent(rounded, options.tangentSpan, true),
      tail: endTangent(rounded, options.tangentSpan, false),
    },
    loop: null,
  };
}

/** The same classification for a line placed point by point: no smoothing, a closed ring becomes a loop. */
export function prepareClicks(points: Vec2[], closeDist: number, minLoop: number): PreparedStroke | null {
  const line = dedupe(points, 1e-6);
  if (line.length < 2) {
    return null;
  }
  const ends: LineEnds = { head: unit(line[1], line[0]), tail: unit(line[line.length - 2], line[line.length - 1]) };
  const closed = findLoop(line, closeDist, minLoop);
  return { line, ends, loop: closed };
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

/**
 * Combines two or more regions into one territory, whether or not they touch. Outlines that share a border are
 * welded into one (as `mergePolygons` does); outlines separated by water stay separate islands of the same
 * territory. The largest island becomes `polygon`, the rest are `extra`, largest first. Nothing is lost:
 * every input outline, including the extra islands of an archipelago being merged, ends up in the result.
 */
export function mergeRegions(
  regions: { polygon: Vec2[]; extra?: Vec2[][] }[],
  snapEps: number,
): SliceResult<{ polygon: Vec2[]; extra: Vec2[][] }> {
  if (regions.length < 2) {
    return { ok: false, error: "Pick at least two regions to merge." };
  }
  let islands: Vec2[][] = [];
  for (const ring of regions.flatMap((r) => [r.polygon, ...(r.extra ?? [])])) {
    if (ring.length < 3) {
      continue;
    }
    let incoming = ring;
    // Fold the outline into every island it touches; a bridge between two islands joins them too.
    for (let again = true; again; ) {
      again = false;
      for (let i = 0; i < islands.length; i++) {
        const joined = mergePolygons(islands[i], incoming, snapEps);
        if (joined.ok) {
          incoming = joined.points;
          islands = islands.filter((_, k) => k !== i);
          again = true;
          break;
        }
        if (/hole|degenerate/.test(joined.error)) {
          return joined;
        }
      }
    }
    islands.push(incoming);
  }
  if (islands.length === 0) {
    return { ok: false, error: "Nothing to merge." };
  }
  islands.sort((p, q) => ringAreaOf(q) - ringAreaOf(p));
  return { ok: true, polygon: islands[0], extra: islands.slice(1) };
}

/**
 * The connected piece of unclaimed land under `point`, as an outline ready to become a region (holes bridged),
 * or null when the point is on water or on land some region already owns. `covered` is every land region's
 * clipped shape.
 */
export function landComponentAt(point: Vec2, land: MultiPolygon, covered: MultiPolygon[]): { outline: Vec2[]; area: number } | null {
  let free: MultiPolygon;
  try {
    free = uncoveredLand(land, covered);
  } catch {
    return null;
  }
  const hit = free.find((poly) => pointInMultiPolygon(point, [poly]));
  if (!hit) {
    return null;
  }
  const outline = piecesOf([hit], 1e-6)[0];
  return outline ? { outline, area: ringAreaOf(outline) } : null;
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
 * What is left of the layer once every cutter already in it is taken out, as outlines ready to become
 * regions. Land is the real coastline (the unclaimed part of the land mask); sea is the canvas minus the
 * land. Each connected piece (a continent, an island, an ocean) is its own block, so a knife stroke on one
 * never reaches another, and its outline is the visible shape itself, not a canvas-sized box. A block that
 * wraps around other regions reaches them through hairline cuts, so it never overlaps them.
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
  let free: MultiPolygon;
  try {
    const world: MultiPolygon =
      type === "land" ? clipper.land : clipper.land.length === 0 ? [[base]] : polygonClipping.difference([base], clipper.land);
    const covered = layerCutters
      .filter((p) => p.length >= 3)
      .map((p) => clipper.clip({ id: "master-block", type, points: p }))
      .filter((mp) => mp.length > 0);
    free = covered.length === 0 ? world : polygonClipping.difference(world, ...covered);
  } catch {
    return { blocks: [] };
  }
  const blocks = piecesOf(free, type === "land" ? MIN_AREA : MIN_BLOCK_AREA);
  blocks.sort((p, q) => ringAreaOf(q) - ringAreaOf(p));
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
