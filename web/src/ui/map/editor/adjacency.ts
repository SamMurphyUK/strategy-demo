// Automatic neighbor detection for hand-drawn regions. Pure; the land mask arrives as a predicate.
import { pointInPolygon, type Vec2 } from "../geometry";

export type Pair = [string, string];

export interface AdjacencyRegion {
  id: string;
  polygon: Vec2[];
  /** The other islands of a multi-island territory. The territory touches whatever any of them touches. */
  extra?: Vec2[][];
  is_sea: boolean;
}

export const SHARED_VERTEX_EPS = 1.5;
/** Sample spacing and shore reach for the land/sea test, in world units. */
export const COAST_STEP = 1;
export const COAST_REACH = 3;

export function sharedVertexCount(a: Vec2[], b: Vec2[], eps: number): number {
  if (a.length * b.length <= 2500) {
    let shared = 0;
    for (const p of a) {
      if (b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= eps)) {
        shared++;
      }
    }
    return shared;
  }
  // Real coastlines have thousands of vertices: look each one up in a grid of B instead of scanning all of B.
  const cell = Math.max(eps, 1e-9);
  const grid = new Map<string, Vec2[]>();
  for (const q of b) {
    const key = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(q);
    } else {
      grid.set(key, [q]);
    }
  }
  let shared = 0;
  for (const p of a) {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) {
      for (let dy = -1; dy <= 1 && !near; dy++) {
        near = grid.get(`${cx + dx},${cy + dy}`)?.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= eps) ?? false;
      }
    }
    if (near) {
      shared++;
    }
  }
  return shared;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * True when an edge of A runs along an edge of B for a real stretch (collinear within `eps` for longer than
 * `2 * eps`). Catches borders that share a segment but not two vertices.
 */
export function sharesEdgeSegment(a: Vec2[], b: Vec2[], eps: number): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    const len = Math.hypot(a1.x - a0.x, a1.y - a0.y);
    if (len <= eps * 2) {
      continue;
    }
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      // Sample along A's edge and count how much of it lies on B's edge.
      const steps = Math.max(2, Math.ceil(len / eps));
      let onEdge = 0;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = { x: a0.x + (a1.x - a0.x) * t, y: a0.y + (a1.y - a0.y) * t };
        if (distToSegment(p, b0, b1) <= eps * 0.5) {
          onEdge++;
        }
      }
      if ((onEdge / (steps + 1)) * len > eps * 2) {
        return true;
      }
    }
  }
  return false;
}

/** Land-to-land or sea-to-sea: two shared vertices, or a shared edge segment. */
export function sameDomainAdjacent(a: Vec2[], b: Vec2[], eps = SHARED_VERTEX_EPS): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  const ba = boxOf(a);
  const bb = boxOf(b);
  if (ba.x1 + eps < bb.x0 || bb.x1 + eps < ba.x0 || ba.y1 + eps < bb.y0 || bb.y1 + eps < ba.y0) {
    return false;
  }
  return sharedVertexCount(a, b, eps) >= 2 || sharesEdgeSegment(a, b, eps);
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(poly: Vec2[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/** Memoises a land predicate on a unit grid so the many overlapping region pairs share one lookup per cell. */
export function cachedLandMask(isLand: (x: number, y: number) => boolean, cell = COAST_STEP): (x: number, y: number) => boolean {
  const cache = new Map<number, boolean>();
  return (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const key = cx * 100003 + cy;
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = isLand((cx + 0.5) * cell, (cy + 0.5) * cell);
      cache.set(key, hit);
    }
    return hit;
  };
}

/**
 * A land region and a sea zone are coastal neighbors when the real land inside the land polygon comes within
 * `reach` of the real water inside the sea polygon. The polygons are rough, so each is first cut down by the
 * land mask: the land region keeps only what is land, the sea zone only what is water.
 */
export function coastalAdjacent(
  land: Vec2[],
  sea: Vec2[],
  isLand: (x: number, y: number) => boolean,
  step = COAST_STEP,
  reach = COAST_REACH,
): boolean {
  const lb = boxOf(land);
  const sb = boxOf(sea);
  const x0 = Math.max(lb.x0, sb.x0) - reach;
  const y0 = Math.max(lb.y0, sb.y0) - reach;
  const x1 = Math.min(lb.x1, sb.x1) + reach;
  const y1 = Math.min(lb.y1, sb.y1) + reach;
  if (x0 > x1 || y0 > y1) {
    return false;
  }
  const cols = Math.ceil((x1 - x0) / step) + 1;
  const rows = Math.ceil((y1 - y0) / step) + 1;
  const landCells = new Uint8Array(cols * rows);
  const waterCells = new Uint8Array(cols * rows);
  let anyLand = false;
  let anyWater = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: x0 + c * step, y: y0 + r * step };
      if (isLand(p.x, p.y)) {
        if (pointInPolygon(p, land)) {
          landCells[r * cols + c] = 1;
          anyLand = true;
        }
      } else if (pointInPolygon(p, sea)) {
        waterCells[r * cols + c] = 1;
        anyWater = true;
      }
    }
  }
  if (!anyLand || !anyWater) {
    return false;
  }
  const w = Math.ceil(reach / step);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!landCells[r * cols + c]) {
        continue;
      }
      for (let dr = -w; dr <= w; dr++) {
        for (let dc = -w; dc <= w; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !waterCells[rr * cols + cc]) {
            continue;
          }
          if (Math.hypot(dr, dc) * step <= reach) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * A region that did not change between edits keeps its polygon array, so a pair of them keeps its answer.
 * Cutting one landmass then re-checks only the pieces it made, not every pair on the map.
 */
const pairMemo = new WeakMap<Vec2[], WeakMap<Vec2[], { coastal: boolean; linked: boolean }[]>>();

function remembered(a: Vec2[], b: Vec2[], coastal: boolean, compute: () => boolean): boolean {
  let inner = pairMemo.get(a);
  if (!inner) {
    inner = new WeakMap();
    pairMemo.set(a, inner);
  }
  let answers = inner.get(b);
  if (!answers) {
    answers = [];
    inner.set(b, answers);
  }
  const known = answers.find((x) => x.coastal === coastal);
  if (known) {
    return known.linked;
  }
  const linked = compute();
  answers.push({ coastal, linked });
  return linked;
}

/** Every neighbor pair the two rules find. `isLand` may be null before the land mask loads (coastal links are skipped). */
export function autoNeighborPairs(
  regions: AdjacencyRegion[],
  isLand: ((x: number, y: number) => boolean) | null,
): Pair[] {
  const pairs: Pair[] = [];
  const mask = isLand ? cachedLandMask(isLand) : null;
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      let linked = false;
      // Every island of one territory against every island of the other: any touch links the two.
      const partsA = [a.polygon, ...(a.extra ?? [])];
      const partsB = [b.polygon, ...(b.extra ?? [])];
      for (const pa of partsA) {
        for (const pb of partsB) {
          if (linked) {
            break;
          }
          if (a.is_sea === b.is_sea) {
            linked = remembered(pa, pb, false, () => sameDomainAdjacent(pa, pb));
          } else if (mask) {
            const land = a.is_sea ? pb : pa;
            const sea = a.is_sea ? pa : pb;
            linked = remembered(land, sea, true, () => {
              // Blocks cut from the real coast share its vertices with the sea beside them: that is the shore.
              if (sharedVertexCount(land, sea, SHARED_VERTEX_EPS) >= 2) {
                return true;
              }
              return coastalAdjacent(land, sea, mask);
            });
          }
        }
      }
      if (linked) {
        pairs.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
      }
    }
  }
  return pairs;
}
