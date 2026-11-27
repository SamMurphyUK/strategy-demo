// Draft landmasses for the map editor. Pure and DOM-free.
//
// Shapes are layered, then a boolean union (polygon-clipping) welds the overlaps into coastlines.
// A shape marked as a hole is subtracted, so an inland sea stays open. Islands that do not touch
// stay separate polygons. Ramer-Douglas-Peucker then drops points that do not move the coast.
import polygonClipping from "polygon-clipping";
import { pointInPolygon, type Rect, type Vec2 } from "../geometry";
import { extractPathData, fillRuleOf } from "../landSvg";
import {
  landFromPathData,
  multiPolygonArea,
  type MultiPolygon,
  type Pair,
  type Polygon,
  type Ring,
} from "../regionClip";
import { rdp } from "./slicing";

export type SculptTool = "pen" | "blob" | "select" | "vertex";

/** One draft outline. `hole` subtracts it from the union. `holes` are lakes already inside this outline. */
export interface DraftShape {
  id: string;
  ring: Vec2[];
  holes: Vec2[][];
  hole: boolean;
}

/** Default RDP tolerance, in world units. A point closer than this to the simplified coast is dropped. */
export const DEFAULT_SIMPLIFY_TOLERANCE = 2;
/** A baked piece smaller than this is a sliver, not a coastline. */
const MIN_BAKE_AREA = 1;

export type BakeResult = { ok: true; polygons: MultiPolygon } | { ok: false; error: string };

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function copyRing(ring: Vec2[]): Vec2[] {
  return ring.map((p) => ({ x: p.x, y: p.y }));
}

export function copyShape(shape: DraftShape): DraftShape {
  return { id: shape.id, hole: shape.hole, ring: copyRing(shape.ring), holes: shape.holes.map(copyRing) };
}

/** Drop a repeated closing point and any doubled neighbours. */
export function openRing(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-6) {
      out.push({ x: p.x, y: p.y });
    }
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-6) {
    out.pop();
  }
  return out;
}

function closeRing(ring: Vec2[]): Ring {
  const open = openRing(ring);
  const closed: Ring = open.map((p): Pair => [p.x, p.y]);
  if (closed.length >= 3) {
    closed.push([closed[0][0], closed[0][1]]);
  }
  return closed;
}

function centroid(ring: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += cross;
    x += (ring[j].x + ring[i].x) * cross;
    y += (ring[j].y + ring[i].y) * cross;
  }
  if (Math.abs(a) < 1e-8) {
    return {
      x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
      y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
    };
  }
  return { x: x / (3 * a), y: y / (3 * a) };
}

/** Closed-ring RDP. The ring is split at its outermost point so that point is an endpoint and stays. */
export function simplifyClosed(ring: Vec2[], tolerance: number): Vec2[] {
  const open = openRing(ring);
  if (open.length < 4 || tolerance <= 0) {
    return open;
  }
  const c = centroid(open);
  let start = 0;
  let best = -1;
  open.forEach((p, i) => {
    const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
    if (d > best) {
      best = d;
      start = i;
    }
  });
  const rotated = [...open.slice(start), ...open.slice(0, start), open[start]];
  const simplified = openRing(rdp(rotated, tolerance));
  return simplified.length >= 3 ? simplified : open;
}

function mapRings(shape: DraftShape, fn: (ring: Vec2[]) => Vec2[]): DraftShape {
  return { ...shape, ring: fn(shape.ring), holes: shape.holes.map(fn) };
}

export function translateShape(shape: DraftShape, dx: number, dy: number): DraftShape {
  const move = (ring: Vec2[]) => ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return mapRings(shape, move);
}

export function scaleShape(shape: DraftShape, origin: Vec2, factor: number): DraftShape {
  const scale = (ring: Vec2[]) =>
    ring.map((p) => ({ x: origin.x + (p.x - origin.x) * factor, y: origin.y + (p.y - origin.y) * factor }));
  return mapRings(shape, scale);
}

export function rotateShape(shape: DraftShape, origin: Vec2, radians: number): DraftShape {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const turn = (ring: Vec2[]) =>
    ring.map((p) => {
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
    });
  return mapRings(shape, turn);
}

export function shapeCenter(shape: DraftShape): Vec2 {
  return centroid(shape.ring);
}

export function shapeBounds(shape: DraftShape): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of shape.ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function moveVertex(shape: DraftShape, hole: number, index: number, point: Vec2): DraftShape {
  const next = copyShape(shape);
  const ring = hole < 0 ? next.ring : next.holes[hole];
  if (!ring || index < 0 || index >= ring.length) {
    return next;
  }
  ring[index] = { x: point.x, y: point.y };
  return next;
}

/** Insert `point` on the edge that starts at `index`. */
export function insertVertex(shape: DraftShape, hole: number, index: number, point: Vec2): DraftShape {
  const next = copyShape(shape);
  const ring = hole < 0 ? next.ring : next.holes[hole];
  if (!ring) {
    return next;
  }
  ring.splice(index + 1, 0, { x: point.x, y: point.y });
  return next;
}

export function shapeContains(shape: DraftShape, p: Vec2): boolean {
  if (shape.ring.length < 3 || !pointInPolygon(p, shape.ring)) {
    return false;
  }
  return !shape.holes.some((hole) => hole.length >= 3 && pointInPolygon(p, hole));
}

/** The topmost shape under the point, or null. Later shapes win. */
export function shapeAt(shapes: readonly DraftShape[], p: Vec2): DraftShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (shapeContains(shapes[i], p)) {
      return shapes[i];
    }
  }
  return null;
}

export function vertexAt(
  shape: DraftShape,
  p: Vec2,
  tol: number,
): { hole: number; index: number } | null {
  const rings: { hole: number; ring: Vec2[] }[] = [
    { hole: -1, ring: shape.ring },
    ...shape.holes.map((ring, hole) => ({ hole, ring })),
  ];
  let best: { hole: number; index: number } | null = null;
  let bestDist = tol;
  for (const { hole, ring } of rings) {
    ring.forEach((v, index) => {
      const d = dist(p, v);
      if (d <= bestDist) {
        bestDist = d;
        best = { hole, index };
      }
    });
  }
  return best;
}

/** The edge whose midpoint is within `tol`, when the edge is long enough to take another point. */
export function edgeAt(
  shape: DraftShape,
  p: Vec2,
  tol: number,
): { hole: number; index: number } | null {
  const rings: { hole: number; ring: Vec2[] }[] = [
    { hole: -1, ring: shape.ring },
    ...shape.holes.map((ring, hole) => ({ hole, ring })),
  ];
  for (const { hole, ring } of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      if (dist(a, b) <= tol * 2.2) {
        continue;
      }
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (dist(p, mid) <= tol) {
        return { hole, index: i };
      }
    }
  }
  return null;
}

export function circleRing(cx: number, cy: number, radius: number, steps = 14): Vec2[] {
  const ring: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return ring;
}

function toPolygon(shape: DraftShape): Polygon | null {
  const outer = closeRing(shape.ring);
  if (outer.length < 4) {
    return null;
  }
  const holes = shape.holes.map(closeRing).filter((ring) => ring.length >= 4);
  return [outer, ...holes];
}

/**
 * Weld every land shape and subtract every hole shape.
 * Disjoint outlines stay separate polygons. A hole inside an outline stays a hole.
 */
export function bakeLandmass(shapes: readonly DraftShape[], tolerance: number): BakeResult {
  const land = shapes.filter((shape) => !shape.hole);
  const holes = shapes.filter((shape) => shape.hole);
  const first = land.map(toPolygon).find((poly): poly is Polygon => poly !== null);
  if (!first) {
    return { ok: false, error: "Draw at least one land shape before baking." };
  }
  try {
    let acc: MultiPolygon = [first];
    for (const shape of land) {
      const poly = toPolygon(shape);
      if (!poly || poly === first) {
        continue;
      }
      acc = polygonClipping.union(acc, [poly]);
    }
    for (const shape of holes) {
      const poly = toPolygon(shape);
      if (poly) {
        acc = polygonClipping.difference(acc, [poly]);
      }
    }
    const cleaned = simplifyMulti(acc, tolerance).filter((poly) => multiPolygonArea([poly]) >= MIN_BAKE_AREA);
    if (cleaned.length === 0) {
      return { ok: false, error: "The bake collapsed. Lower the simplify tolerance." };
    }
    return { ok: true, polygons: cleaned };
  } catch {
    return { ok: false, error: "Those shapes could not be unioned. A stroke may cross itself." };
  }
}

function simplifyMulti(mp: MultiPolygon, tolerance: number): MultiPolygon {
  const out: MultiPolygon = [];
  for (const poly of mp) {
    const rings = poly
      .map((ring) => simplifyClosed(ring.map(([x, y]) => ({ x, y })), tolerance))
      .filter((ring) => ring.length >= 3 && ringAreaOf(ring) >= MIN_BAKE_AREA * 0.25);
    if (rings.length > 0 && ringAreaOf(rings[0]) >= MIN_BAKE_AREA) {
      out.push(rings.map((ring) => ring.map((p): Pair => [p.x, p.y])));
    }
  }
  return out;
}

function ringAreaOf(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(a) / 2;
}

/** A freehand stroke closed into one outline, simplified so the pen does not keep every sample. */
export function ringFromStroke(points: Vec2[], tolerance: number): Vec2[] | null {
  const ring = simplifyClosed(points, tolerance);
  return ring.length >= 3 ? ring : null;
}

/** Circles stamped along a stroke, unioned into one organic outline. */
export function blobFromStroke(points: Vec2[], radius: number): DraftShape | null {
  if (points.length === 0 || radius <= 0) {
    return null;
  }
  const samples: Vec2[] = [points[0]];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    walked += dist(points[i - 1], points[i]);
    if (walked >= radius * 0.55) {
      samples.push(points[i]);
      walked = 0;
    }
  }
  const last = points[points.length - 1];
  if (dist(samples[samples.length - 1], last) > radius * 0.3) {
    samples.push(last);
  }
  const capped = samples.length > 64 ? samples.filter((_, i) => i % Math.ceil(samples.length / 64) === 0) : samples;
  const circles = capped.map((p) => circleRing(p.x, p.y, radius));
  const baked = bakeLandmass(
    circles.map((ring, i) => ({ id: `blob-${i}`, ring, holes: [], hole: false })),
    Math.min(1.25, radius * 0.15),
  );
  if (!baked.ok || baked.polygons.length === 0) {
    return null;
  }
  const poly = baked.polygons[0];
  return {
    id: "blob",
    hole: false,
    ring: openRing(poly[0].map(([x, y]) => ({ x, y }))),
    holes: poly.slice(1).map((ring) => openRing(ring.map(([x, y]) => ({ x, y })))),
  };
}

function num(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function pathOf(mp: MultiPolygon): string {
  return mp
    .flatMap((poly) => poly.map((ring) => {
      const open = openRing(ring.map(([x, y]) => ({ x, y })));
      if (open.length < 3) {
        return "";
      }
      const body = open.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");
      return `${body} Z`;
    }))
    .filter((d) => d !== "")
    .join(" ");
}

/** A single even-odd path. Islands and inland holes are subpaths of that one path. */
export function landmassToSvg(polygons: MultiPolygon, viewBox: Rect): string {
  const d = pathOf(polygons);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(viewBox.x)} ${num(viewBox.y)} ${num(viewBox.w)} ${num(viewBox.h)}" width="${num(viewBox.w)}" height="${num(viewBox.h)}">`,
    `  <path fill-rule="evenodd" fill="#8C7C79" d="${d}" />`,
    `</svg>`,
    ``,
  ].join("\n");
}

/** Grow `base` so every baked point sits inside it, with a small margin. */
export function viewBoxAround(base: Rect, polygons: MultiPolygon): Rect {
  let x0 = base.x;
  let y0 = base.y;
  let x1 = base.x + base.w;
  let y1 = base.y + base.h;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  const pad = 8;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** One draft shape per polygon in an imported SVG. Curves are rejected by the path reader. */
export function shapesFromSvg(svgText: string): DraftShape[] {
  const data = extractPathData(svgText);
  if (data.length === 0) {
    return [];
  }
  return landFromPathData(data, fillRuleOf(svgText)).flatMap((poly, i) => {
    const ring = openRing(poly[0].map(([x, y]) => ({ x, y })));
    if (ring.length < 3) {
      return [];
    }
    return [
      {
        id: `import-${i + 1}`,
        hole: false,
        ring,
        holes: poly.slice(1).map((hole) => openRing(hole.map(([x, y]) => ({ x, y })))),
      },
    ];
  });
}

export function replaceShape(shapes: readonly DraftShape[], next: DraftShape): DraftShape[] {
  return shapes.map((shape) => (shape.id === next.id ? next : shape));
}
