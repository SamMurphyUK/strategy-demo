// Which region is under a world point. Plain polygon maths: no canvas, no Path2D.
//
// A viewport raycasts the pointer to the board plane and asks this. The shapes are the same ones the
// map draws: each cutter clipped against the land (see regionClip.ts), or the rough cutters until the
// land has loaded.
import type { RegionShape, Vec2 } from "./geometry";
import { type MultiPolygon, type Pair, pointInMultiPolygon } from "./regionClip";

export interface PickShape {
  id: string;
  type: "land" | "sea";
  shape: MultiPolygon;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PickShapes {
  /** In region order. A later shape is drawn over an earlier one, so it wins a pick. */
  shapes: PickShape[];
  /** True when the shapes are clipped to the coastline. Land and sea are then disjoint. */
  exact: boolean;
}

export interface PickOptions {
  /** Only regions of this layer can be picked (the editor's Land / Sea mode). */
  only?: "land" | "sea" | null;
  /** The land polygon. Rough cutters overhang the shore, so it decides which layer the point is in. */
  land?: MultiPolygon | null;
}

function cutterShape(region: RegionShape): MultiPolygon {
  const rings = [region.points, ...(region.extra ?? [])].filter((ring) => ring.length >= 3);
  return rings.map((ring) => [ring.map((p): Pair => [p.x, p.y])]);
}

function pickShape(region: RegionShape, shape: MultiPolygon): PickShape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of shape) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { id: region.id, type: region.type, shape, minX, minY, maxX, maxY };
}

/**
 * One shape per region. With `clipped`, that is the coastline-clipped shape, and a region the clipper
 * left empty gets none. Without it, the rough cutter and its extra islands.
 */
export function buildPickShapes(regions: RegionShape[], clipped?: Map<string, MultiPolygon> | null): PickShapes {
  const shapes: PickShape[] = [];
  for (const region of regions) {
    const shape = clipped ? clipped.get(region.id) : cutterShape(region);
    if (shape && shape.length > 0) {
      shapes.push(pickShape(region, shape));
    }
  }
  return { shapes, exact: Boolean(clipped) };
}

/** The region under a world point, or "" for none. */
export function pickRegionAt(pick: PickShapes, p: Vec2, options: PickOptions = {}): string {
  const only = options.only ?? null;
  const onLand = !pick.exact && options.land ? pointInMultiPolygon(p, options.land) : null;
  for (let i = pick.shapes.length - 1; i >= 0; i--) {
    const candidate = pick.shapes[i];
    if (only !== null && candidate.type !== only) {
      continue;
    }
    if (onLand !== null && (candidate.type === "land") !== onLand) {
      continue;
    }
    if (p.x < candidate.minX || p.x > candidate.maxX || p.y < candidate.minY || p.y > candidate.maxY) {
      continue;
    }
    if (pointInMultiPolygon(p, candidate.shape)) {
      return candidate.id;
    }
  }
  return "";
}
