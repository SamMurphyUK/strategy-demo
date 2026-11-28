// The internal borders of the land, as a path for each territory: only the edges it shares with a neighbouring territory, never its
// coast. Built once for a set of shapes and kept.
import { ringsOf, sharedEdges, type Seam } from "./mapBakeMath";
import type { MultiPolygon } from "./regionClip";
import { multiPolygonPath2D } from "./hitTest";

/** The id the land no territory covers (desert, steppe) goes by among the land shapes. */
export const OPEN_LAND_ID = "__open";

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(shape: MultiPolygon): Box {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const ring of ringsOf(shape)) {
    for (const [x, y] of ring) {
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
    }
  }
  return box;
}

function touches(a: Box, b: Box): boolean {
  const slack = 0.5;
  return a.x0 <= b.x1 + slack && b.x0 <= a.x1 + slack && a.y0 <= b.y1 + slack && b.y0 <= a.y1 + slack;
}

/** The edges two shapes share, [x1, y1, x2, y2] each. */
export function pairEdges(a: MultiPolygon, b: MultiPolygon, seam: Seam | null): [number, number, number, number][] {
  return sharedEdges([a, b], seam, 2);
}

/**
 * For each land territory, the stretches of its outline it shares with another land territory, as segments of one path. Pairs are
 * taken one at a time, so two neighbours' edges never leak into a third's.
 */
export function internalBorderSegments(shapes: Map<string, MultiPolygon>, seam: Seam | null): Map<string, [number, number, number, number][]> {
  const ids = [...shapes.keys()];
  const boxes = ids.map((id) => boxOf(shapes.get(id)!));
  const out = new Map<string, [number, number, number, number][]>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!touches(boxes[i], boxes[j])) {
        continue;
      }
      const edges = pairEdges(shapes.get(ids[i])!, shapes.get(ids[j])!, seam);
      if (edges.length === 0) {
        continue;
      }
      for (const id of [ids[i], ids[j]]) {
        const list = out.get(id) ?? [];
        list.push(...edges);
        out.set(id, list);
      }
    }
  }
  return out;
}

const cache = new WeakMap<Map<string, MultiPolygon>, Map<string, Path2D>>();

/** The internal-border paths for a set of land shapes, built once per set. */
export function internalBorderPaths(shapes: Map<string, MultiPolygon>, seam: Seam | null): Map<string, Path2D> {
  const hit = cache.get(shapes);
  if (hit) {
    return hit;
  }
  const paths = new Map<string, Path2D>();
  for (const [id, segs] of internalBorderSegments(shapes, seam)) {
    const path = new Path2D();
    for (const [x1, y1, x2, y2] of segs) {
      path.moveTo(x1, y1);
      path.lineTo(x2, y2);
    }
    paths.set(id, path);
  }
  cache.set(shapes, paths);
  return paths;
}

const openPaths = new WeakMap<Map<string, MultiPolygon>, Path2D | null>();

/** The outline of the open land (no territory's), or null where there is none. */
export function openLandPath(shapes: Map<string, MultiPolygon>): Path2D | null {
  if (openPaths.has(shapes)) {
    return openPaths.get(shapes) ?? null;
  }
  const shape = shapes.get(OPEN_LAND_ID);
  const path = shape && shape.length > 0 ? multiPolygonPath2D(shape) : null;
  openPaths.set(shapes, path);
  return path;
}

/** Where the open land's lift is read: the middle of its widest piece. */
export function openLandAnchor(shapes: Map<string, MultiPolygon>): { x: number; y: number } | null {
  const shape = shapes.get(OPEN_LAND_ID);
  if (!shape || shape.length === 0) {
    return null;
  }
  const box = boxOf(shape);
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}
