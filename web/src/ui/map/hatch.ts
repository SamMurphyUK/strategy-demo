// Diagonal hatching for land nobody owns. Pure: the bake strokes these segments (see mapBake.ts).
import { resolveFaction } from "../theme/factionPalette";
import type { Rect } from "./geometry";

export type HatchSegment = [number, number, number, number];

/**
 * Parallel 45-degree lines, rising to the right, spaced `spacing` apart (measured along x), that cover
 * `bounds`. The caller clips them to the land they are for.
 */
export function hatchSegments(bounds: Rect, spacing: number): HatchSegment[] {
  if (spacing <= 0 || bounds.w <= 0 || bounds.h <= 0) {
    return [];
  }
  const out: HatchSegment[] = [];
  const bottom = bounds.y + bounds.h;
  for (let c = 0; c <= bounds.w + bounds.h; c += spacing) {
    // The line through (x0 + c, bottom) and (x0 + c - h, top) would start left of the box; this one runs
    // from the bottom edge up and to the right.
    out.push([bounds.x + c - bounds.h, bottom, bounds.x + c, bounds.y]);
  }
  return out;
}

/** Land with no owner, or the neutral one, is hatched. Every faction's own land is not. */
export function isHatchedOwner(owner: string): boolean {
  return resolveFaction(owner) === "NEUTRAL";
}
