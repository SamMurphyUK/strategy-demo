// Pointer hit-testing for the map canvas, in world coordinates.
//
// Land polygons overhang into the water and sea polygons run inland, so a plain point-in-polygon test
// picks the wrong region near shores. Two stages instead: ask the land stencil whether the point is
// land, then test only land regions (if it is) or only sea zones (if it is not).
import type { RegionShape, Vec2 } from "./geometry";
import type { PlacedCounter, RegionLayout } from "./mapRenderer";
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

export function buildRegionPaths(regions: RegionShape[]): Map<string, Path2D> {
  return new Map(regions.map((r) => [r.id, polygonPath2D(r.points)]));
}

export function isLandAt(land: MasterLand, p: Vec2): boolean {
  return probeContext().isPointInPath(land.masterLandPath, p.x, p.y);
}

/** The region under a world point, or "" for none. */
export function pickRegion(
  regions: RegionShape[],
  paths: Map<string, Path2D>,
  land: MasterLand | null,
  p: Vec2,
): string {
  const ctx = probeContext();
  // Without the stencil (still loading, or failed) fall back to testing every region.
  const stage = land ? isLandAt(land, p) : null;
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    if (stage !== null && (region.type === "land") !== stage) {
      continue;
    }
    const path = paths.get(region.id);
    if (path && ctx.isPointInPath(path, p.x, p.y)) {
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
