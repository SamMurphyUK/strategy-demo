// Boolean clipping of the rough region "cutter" polygons against the land SVG. DOM-free, so tests and
// scripts can run it.
//
//   land region  = cutter  INTERSECT  land      (the part of the box that is actually land)
//   sea zone     = cutter  DIFFERENCE land      (the part of the box that is actually water)
//
// The result is a MultiPolygon: exterior rings plus holes (lakes, enclaves), possibly several pieces
// (a region with islands). It is the region's true shape for drawing, hover, selection and hit-testing.
// The cutter stays the thing you edit; the clip is recomputed from it.
import polygonClipping from "polygon-clipping";
import type { Vec2 } from "./geometry";
import { parsePathRings } from "./landSvg";

export type Pair = [number, number];
export type Ring = Pair[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A region as the clipper sees it: its cutter polygon and whether it is water. */
export interface ClipInput {
  id: string;
  points: Vec2[];
  /** Rings cut out of `points` (a lake, or the land inside a sea zone). Not other islands. */
  holes?: Vec2[][];
  /** Further outlines of the same region (an archipelago's other islands). Disjoint from `points`. */
  extra?: Vec2[][];
  type: "land" | "sea";
}

function ringBox(ring: Ring): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

/** SVG fill-rule. The default in the spec, and on the world sheet, is nonzero. */
export type FillRule = "nonzero" | "evenodd";

function signedRingArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** A point strictly inside the ring, so containment is not decided on a vertex. */
function interiorPoint(ring: Ring): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  const c: [number, number] = [x / ring.length, y / ring.length];
  if (pointInRing(c[0], c[1], ring)) {
    return c;
  }
  const sign = signedRingArea(ring) >= 0 ? 1 : -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      continue;
    }
    // Left of the edge is inward for a CCW ring.
    const px = (a[0] + b[0]) / 2 + (-dy / len) * 0.25 * sign;
    const py = (a[1] + b[1]) / 2 + (dx / len) * 0.25 * sign;
    if (pointInRing(px, py, ring)) {
      return [px, py];
    }
  }
  return c;
}

function orientRing(ring: Ring, want: 1 | -1): Ring {
  const sign = signedRingArea(ring) >= 0 ? 1 : -1;
  return sign === want ? ring : [...ring].reverse();
}

/** Even-odd: every other nested ring is a hole, which is what xor of the sub-paths produces. */
function evenoddPolygons(rings: Ring[]): MultiPolygon {
  if (rings.length === 1) {
    return [[rings[0]]];
  }
  const [first, ...rest] = rings.map((r): Polygon => [r]);
  return polygonClipping.xor(first, ...rest);
}

/**
 * Nonzero: a nested ring is a hole only when the winding inside it falls to zero.
 * A same-winding ring stays filled. An opposite-winding ring is a hole. An island in that hole
 * is its own polygon. Outers are CCW and holes are CW, so an evenodd fill of the result matches.
 */
function nonzeroPolygons(rings: Ring[]): MultiPolygon {
  if (rings.length === 1) {
    return [[rings[0]]];
  }
  interface Node {
    ring: Ring;
    sign: 1 | -1;
    abs: number;
    parent: number;
    inside: number;
  }
  const nodes: Node[] = [];
  for (const ring of rings) {
    const area = signedRingArea(ring);
    if (Math.abs(area) < 1e-8) {
      continue;
    }
    nodes.push({ ring, sign: area >= 0 ? 1 : -1, abs: Math.abs(area), parent: -1, inside: 0 });
  }
  if (nodes.length === 0) {
    return [];
  }
  if (nodes.length === 1) {
    return [[nodes[0].ring]];
  }
  const sample = nodes.map((n) => interiorPoint(n.ring));
  for (let i = 0; i < nodes.length; i++) {
    let parent = -1;
    let parentAbs = Infinity;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || nodes[j].abs <= nodes[i].abs) {
        continue;
      }
      if (nodes[j].abs < parentAbs && pointInRing(sample[i][0], sample[i][1], nodes[j].ring)) {
        parent = j;
        parentAbs = nodes[j].abs;
      }
    }
    nodes[i].parent = parent;
  }
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[b].abs - nodes[a].abs);
  for (const i of order) {
    const outside = nodes[i].parent < 0 ? 0 : nodes[nodes[i].parent].inside;
    nodes[i].inside = outside + nodes[i].sign;
  }
  const polygons: MultiPolygon = [];
  const owned = new Map<number, Polygon>();
  for (const i of order) {
    const outside = nodes[i].parent < 0 ? 0 : nodes[nodes[i].parent].inside;
    const inside = outside + nodes[i].sign;
    if (outside === 0 && inside !== 0) {
      const poly: Polygon = [orientRing(nodes[i].ring, 1)];
      polygons.push(poly);
      owned.set(i, poly);
    } else if (outside !== 0 && inside === 0) {
      let a = nodes[i].parent;
      while (a >= 0 && !owned.has(a)) {
        a = nodes[a].parent;
      }
      if (a >= 0) {
        owned.get(a)!.push(orientRing(nodes[i].ring, -1));
      }
    }
  }
  return polygons;
}

/**
 * The land SVG as one MultiPolygon. Each path is its own landmass. `evenodd` (the default, so the
 * existing suites stay) xors sub-paths. `nonzero` follows the SVG rule: a same-winding nested ring
 * stays filled, and only a winding that falls to zero becomes a hole. Different paths stay side by side.
 */
export function landFromPathData(data: string[], rule: FillRule = "evenodd"): MultiPolygon {
  const land: MultiPolygon = [];
  for (const d of data) {
    const rings = parsePathRings(d).filter((r) => r.length >= 3);
    if (rings.length === 0) {
      continue;
    }
    land.push(...(rule === "nonzero" ? nonzeroPolygons(rings) : evenoddPolygons(rings)));
  }
  return land;
}

/** The polygons as one SVG path. Fill and clip it with evenodd: holes are their own sub-paths. */
export function multiPolygonPathData(mp: MultiPolygon): string {
  const parts: string[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) {
        continue;
      }
      const cmds = ring.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`);
      parts.push(`${cmds.join(" ")} Z`);
    }
  }
  return parts.join(" ");
}

/** Even-odd containment across every ring of every polygon: the same answer as a canvas evenodd fill. */
export function pointInMultiPolygon(p: Vec2, mp: MultiPolygon): boolean {
  let inside = false;
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/** Area of a MultiPolygon: exteriors minus holes (the first ring of each polygon is the exterior). */
export function multiPolygonArea(mp: MultiPolygon): number {
  let total = 0;
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      total += i === 0 ? ringArea(ring) : -ringArea(ring);
    });
  }
  return total;
}

const keyOfPoints = (points: Vec2[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
const keyOf = (region: ClipInput) =>
  `${region.type}|${keyOfPoints(region.points)}|h${(region.holes ?? []).map((h) => keyOfPoints(h)).join("/")}|e${(region.extra ?? []).map((e) => keyOfPoints(e)).join("/")}`;

export class RegionClipper {
  private readonly parts: { poly: Polygon; box: Box }[];
  private cache = new Map<string, MultiPolygon>();
  /** Ids of regions whose cutter the clipper could not process, so they show unclipped. */
  readonly failed = new Set<string>();

  constructor(readonly land: MultiPolygon) {
    this.parts = land.map((poly) => ({ poly, box: ringBox(poly[0]) }));
  }

  /** The landmasses whose bounding box touches the box. Everything else cannot change the result. */
  private near(box: Box): MultiPolygon {
    return this.parts.filter((p) => boxesOverlap(p.box, box)).map((p) => p.poly);
  }

  private compute(region: ClipInput): MultiPolygon {
    const ring: Ring = region.points.map((p): Pair => [p.x, p.y]);
    if (ring.length < 3) {
      return [];
    }
    const holes: Ring[] = (region.holes ?? [])
      .filter((h) => h.length >= 3)
      .map((h): Ring => h.map((p): Pair => [p.x, p.y]));
    const extra: Ring[] = (region.extra ?? [])
      .filter((e) => e.length >= 3)
      .map((e): Ring => e.map((p): Pair => [p.x, p.y]));
    const subject: MultiPolygon = [[ring, ...holes], ...extra.map((r): Polygon => [r])];
    const boxes = [ring, ...holes, ...extra].map(ringBox);
    const near = this.near({
      x0: Math.min(...boxes.map((b) => b.x0)),
      y0: Math.min(...boxes.map((b) => b.y0)),
      x1: Math.max(...boxes.map((b) => b.x1)),
      y1: Math.max(...boxes.map((b) => b.y1)),
    });
    try {
      if (region.type === "sea") {
        return near.length === 0 ? subject : polygonClipping.difference(subject, near);
      }
      return near.length === 0 ? [] : polygonClipping.intersection(subject, near);
    } catch {
      // A degenerate cutter (zero-area spike, self-crossing edge) can defeat the clipper. Show the raw
      // cutter instead of losing the region, so it can still be selected and repaired.
      this.failed.add(region.id);
      return subject;
    }
  }

  clip(region: ClipInput): MultiPolygon {
    const key = keyOf(region);
    const hit = this.cache.get(key);
    if (hit) {
      return hit;
    }
    const result = this.compute(region);
    this.cache.set(key, result);
    return result;
  }

  /**
   * Clips every region and forgets cached results nobody asked for this time, so dragging a vertex
   * recomputes only the regions that share it and the cache does not grow with every frame.
   */
  clipAll(regions: ClipInput[]): Map<string, MultiPolygon> {
    const previous = this.cache;
    this.cache = new Map();
    const out = new Map<string, MultiPolygon>();
    for (const region of regions) {
      const key = keyOf(region);
      const result = previous.get(key) ?? this.compute(region);
      this.cache.set(key, result);
      out.set(region.id, result);
    }
    return out;
  }
}

const clippers = new WeakMap<MultiPolygon, RegionClipper>();

/** One clipper (and one cache) per land MultiPolygon, shared by the canvas and the editor export. */
export function clipperFor(land: MultiPolygon): RegionClipper {
  let clipper = clippers.get(land);
  if (!clipper) {
    clipper = new RegionClipper(land);
    clippers.set(land, clipper);
  }
  return clipper;
}

/** The part of `land` that none of the clipped land regions covers: unclaimed territory. */
export function uncoveredLand(land: MultiPolygon, coveredBy: MultiPolygon[]): MultiPolygon {
  const covers = coveredBy.filter((mp) => mp.length > 0);
  return covers.length === 0 ? land : polygonClipping.difference(land, ...covers);
}
