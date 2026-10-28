// DOM-free helpers for the master land SVG. The loader (svgLandLoader.ts) does the fetch and Path2D work.
import type { Rect } from "./geometry";

/** The land SVG's viewBox is the map's world space: region polygons and anchors use the same units. */
export function parseViewBox(viewBox: string | null | undefined, width = 0, height = 0): Rect {
  const nums = String(viewBox ?? "")
    .split(/[\s,]+/)
    .filter((s) => s !== "")
    .map(Number);
  if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
    return { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
  }
  return { x: 0, y: 0, w: width > 0 ? width : 1, h: height > 0 ? height : 1 };
}

/** One SVG path string out of many. Each sub-path starts with its own M, so a space join is safe. */
export function combinePathData(data: string[]): string {
  return data
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .join(" ");
}
