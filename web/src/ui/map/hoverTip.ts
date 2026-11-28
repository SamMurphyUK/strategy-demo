// What the pointer is over on the 3D board, as a tooltip: a facility badge, or a region roundel. Pure.
//
// A unit's own tooltip is made where the unit is picked. The roundels are 3D discs under the territories; the 2D layer that
// reads the pointer cannot see them, so the 3D board lists them here (a plain module store, no React render) and the pointer
// is tested against each as an ellipse on the screen, the way the disc lies on the board.
import { type Facilities, facilitiesOf, type Vec2 } from "./geometry";
import type { RegionLayout } from "./mapRenderer";
import { plinthRadius } from "../viewport3d/plinthPlacement";
import { ROUNDEL_REF } from "../viewport3d/roundelPlacement";
import { projectionScales, type View, worldToScreen } from "./viewMath";

export interface RoundelHit {
  regionId: string;
  /** Where it stands, in map coordinates. */
  x: number;
  y: number;
  /** The placement scale: ROUNDEL_REF times the edit's size. */
  scale: number;
}

let hits: readonly RoundelHit[] = [];

export function setRoundelHits(next: readonly RoundelHit[]): void {
  hits = next;
}

export function getRoundelHits(): readonly RoundelHit[] {
  return hits;
}

/** A facility badge's own words: what it stands for. */
export function facilityLabel(f: Facilities): string {
  const parts: string[] = [];
  if (f.factory === "major") parts.push("Major factory");
  else if (f.factory === "minor") parts.push("Minor factory");
  if (f.harbour) parts.push("Harbour");
  if (f.airbase) parts.push("Airbase");
  return parts.join(" · ");
}

/** The territory whose facility badge the pointer is over, with the badge. */
export function badgeAt(layouts: readonly RegionLayout[], point: Vec2): { layout: RegionLayout; label: string } | null {
  for (const layout of layouts) {
    const { badge } = layout;
    if (!badge) {
      continue;
    }
    if (Math.abs(point.x - badge.x) <= badge.hw && Math.abs(point.y - badge.y) <= badge.hh) {
      const label = facilityLabel(facilitiesOf(layout.region));
      if (label !== "") {
        return { layout, label };
      }
    }
  }
  return null;
}

export interface RoundelUnderPointer {
  regionId: string;
  /** Its centre on the screen and the disc's half-height there, for placing the tip above it. */
  sx: number;
  sy: number;
  ry: number;
}

/**
 * The roundel under a screen point, if any. A disc's radius on the screen is the infantry base's, times the share and the
 * edit's size; it lies flat, so it is an ellipse as squashed as the ground is at this zoom. The nearest centre wins.
 */
export function roundelAt(
  list: readonly RoundelHit[],
  view: View,
  tokenPx: number,
  share: number,
  point: Vec2,
  /** How far the land under a map point stands up the screen, in px: the disc lies on top of it. */
  liftAt?: (world: Vec2) => number,
): RoundelUnderPointer | null {
  const { sx, sy } = projectionScales(view.k);
  const squash = sx > 0 ? Math.max(0.15, Math.min(1, sy / sx)) : 1;
  let best: RoundelUnderPointer | null = null;
  let bestGap = Infinity;
  for (const item of list) {
    const flat = worldToScreen(view, { x: item.x, y: item.y });
    const centre = { x: flat.x, y: flat.y - (liftAt?.({ x: item.x, y: item.y }) ?? 0) };
    // Screen px: the world radius times the zoom.
    const radius = plinthRadius(tokenPx, view.k, 1, { pair: 1, crowd: 1, vehicleRadius: 1 }, "infantry") * share * (item.scale / ROUNDEL_REF) * view.k;
    const rx = radius;
    const ry = radius * squash;
    const nx = (point.x - centre.x) / rx;
    const ny = (point.y - centre.y) / ry;
    const gap = nx * nx + ny * ny;
    if (gap <= 1 && gap < bestGap) {
      best = { regionId: item.regionId, sx: centre.x, sy: centre.y, ry };
      bestGap = gap;
    }
  }
  return best;
}
