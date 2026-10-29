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

/**
 * The land SVG as one MultiPolygon. Each <path> is one landmass; its sub-paths are combined with
 * even-odd (xor), which is what nonzero fill gives for lakes drawn with opposite winding. Different
 * paths are separate landmasses and are kept side by side.
 */
export function landFromPathData(data: string[]): MultiPolygon {
  const land: MultiPolygon = [];
  for (const d of data) {
    const rings = parsePathRings(d);
    if (rings.length === 0) {
      continue;
    }
    if (rings.length === 1) {
      land.push([rings[0]]);
    } else {
      const [first, ...rest] = rings.map((r): Polygon => [r]);
      land.push(...polygonClipping.xor(first, ...rest));
    }
  }
  return land;
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

const keyOf = (region: ClipInput) => `${region.type}|${region.points.map((p) => `${p.x},${p.y}`).join(" ")}`;

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
    const near = this.near(ringBox(ring));
    try {
      if (region.type === "sea") {
        return near.length === 0 ? [[ring]] : polygonClipping.difference([ring], near);
      }
      return near.length === 0 ? [] : polygonClipping.intersection([ring], near);
    } catch {
      // A degenerate cutter (zero-area spike, self-crossing edge) can defeat the clipper. Show the raw
      // cutter instead of losing the region, so it can still be selected and repaired.
      this.failed.add(region.id);
      return [[ring]];
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
