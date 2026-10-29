// Pointer hit-testing for the map canvas, in world coordinates.
//
// Every region has a true shape: its cutter polygon clipped against the land SVG (see regionClip.ts).
// Land regions stop at the coastline and sea zones wrap around it, so a plain point-in-path test on
// that shape is exact and the same path is what gets filled and outlined.
//
// Until the land SVG has loaded there is no true shape. Then the rough cutters are used instead, and
// the old two-stage test applies: cutters overhang the shore, so ask the land stencil which kind of
// region the point is in (when it is available) before testing only those.
import type { RegionShape, Vec2 } from "./geometry";
import type { PlacedCounter, RegionLayout } from "./mapRenderer";
import type { MultiPolygon } from "./regionClip";
import type { MasterLand } from "./svgLandLoader";

let probe: CanvasRenderingContext2D | null = null;

/** A 1x1 context with an identity transform, so Path2D tests run in plain world units. */
function probeContext(): CanvasRenderingContext2D {
  if (!probe) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d")!;
  }
  return probe;
}

export function polygonPath2D(points: Vec2[]): Path2D {
  const path = new Path2D();
  points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  path.closePath();
  return path;
}

/** Every ring of a MultiPolygon in one Path2D. Fill and hit-test it with "evenodd" so holes stay open. */
export function multiPolygonPath2D(mp: MultiPolygon): Path2D {
  const path = new Path2D();
  for (const polygon of mp) {
    for (const ring of polygon) {
      ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      path.closePath();
    }
  }
  return path;
}

/** The rough cutter outlines: what the editor drags. */
export function buildCutterPaths(regions: RegionShape[]): Map<string, Path2D> {
  return new Map(regions.map((r) => [r.id, polygonPath2D(r.points)]));
}

/**
 * One Path2D per region. With `clipped`, that is the region's true coastline-clipped shape; a region
 * the clipper left empty gets no path. Without it, the rough cutter.
 */
export function buildRegionPaths(regions: RegionShape[], clipped?: Map<string, MultiPolygon> | null): Map<string, Path2D> {
  if (!clipped) {
    return buildCutterPaths(regions);
  }
  const out = new Map<string, Path2D>();
  for (const region of regions) {
    const mp = clipped.get(region.id);
    if (mp && mp.length > 0) {
      out.set(region.id, multiPolygonPath2D(mp));
    }
  }
  return out;
}

export function isLandAt(land: MasterLand, p: Vec2): boolean {
  return probeContext().isPointInPath(land.masterLandPath, p.x, p.y);
}

/**
 * The region under a world point, or "" for none. `exact` says `paths` are the clipped shapes, which
 * are disjoint between land and sea, so no land stencil is needed.
 */
export function pickRegion(
  regions: RegionShape[],
  paths: Map<string, Path2D>,
  land: MasterLand | null,
  p: Vec2,
  exact = false,
  /** Only regions of this layer can be picked (the editor's Land / Sea mode). */
  only: "land" | "sea" | null = null,
): string {
  const ctx = probeContext();
  const stage = !exact && land ? isLandAt(land, p) : null;
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    if (only !== null && region.type !== only) {
      continue;
    }
    if (stage !== null && (region.type === "land") !== stage) {
      continue;
    }
    const path = paths.get(region.id);
    if (path && ctx.isPointInPath(path, p.x, p.y, "evenodd")) {
      return region.id;
    }
  }
  return "";
}

/** The unit counter under a screen point, nearest first. */
export function pickCounter(layouts: RegionLayout[], p: Vec2, radius: number): PlacedCounter | null {
  let best: PlacedCounter | null = null;
  let bestDist = radius;
  for (const layout of layouts) {
    for (const counter of layout.counters) {
      const d = Math.hypot(counter.x - p.x, counter.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        best = counter;
      }
    }
  }
  return best;
}
