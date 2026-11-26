// How dense the trees stand, as a coarse sheet over the board, for the ground under them to darken and enrich (the
// `forestUnderstoryTint` slider). Pure: the board makes a texture of it. One byte a texel, 0 open ground, 255 a thick copse.
import type { Rect } from "../map/geometry";
import type { PropInstance, PropKind } from "./propPlan";

/** The kinds that make a wood. Rock and dunes do not. */
const WOODS: readonly PropKind[] = ["pine", "broadleaf", "palm", "acacia"];

/** World units a texel spans, about. */
const FOREST_TEXEL = 3;
/** How far a tree darkens the ground round it, in world units. */
const CANOPY_REACH = 5;

export interface ForestSheet {
  width: number;
  height: number;
  data: Uint8Array;
}

export function buildForestSheet(bounds: Rect, props: Readonly<Record<PropKind, readonly PropInstance[]>>): ForestSheet {
  const width = Math.max(2, Math.ceil(bounds.w / FOREST_TEXEL));
  const height = Math.max(2, Math.ceil(bounds.h / FOREST_TEXEL));
  const sx = width / bounds.w;
  const sy = height / bounds.h;
  const weight = new Float32Array(width * height);
  const reachX = Math.ceil(CANOPY_REACH * sx);
  const reachY = Math.ceil(CANOPY_REACH * sy);
  for (const kind of WOODS) {
    for (const tree of props[kind] ?? []) {
      const cx = (tree.x - bounds.x) * sx;
      const cy = (tree.y - bounds.y) * sy;
      const x0 = Math.max(0, Math.floor(cx - reachX));
      const x1 = Math.min(width - 1, Math.ceil(cx + reachX));
      const y0 = Math.max(0, Math.floor(cy - reachY));
      const y1 = Math.min(height - 1, Math.ceil(cy + reachY));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot((x + 0.5 - cx) / sx, (y + 0.5 - cy) / sy) / CANOPY_REACH;
          if (d < 1) {
            const w = 1 - d * d;
            weight[y * width + x] += w * w * 0.35;
          }
        }
      }
    }
  }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    // A saturating curve: a few trees shade a little, a copse shades fully.
    data[i] = Math.round(255 * (1 - Math.exp(-weight[i] * 1.6)));
  }
  return { width, height, data };
}
