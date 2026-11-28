// Where the factory, harbor and airbase models stand on the 3D board, by territory, in map coordinates.
//
// The 3D board sets these when it lays the models out; the badge painter (mapRenderer.ts) reads them so the badge's triangles can
// drift apart and point at the models that replace them as the camera comes in. A plain module store: both sides run on every
// frame, and neither should cause a React render.

import type { BadgeSlot } from "./facilityBadge";
import type { Vec2 } from "./geometry";

const targets = new Map<string, Partial<Record<BadgeSlot, Vec2>>>();

export function clearFacilityTargets(): void {
  targets.clear();
}

export function setFacilityTarget(regionId: string, slot: BadgeSlot, at: Vec2): void {
  const entry = targets.get(regionId) ?? {};
  entry[slot] = at;
  targets.set(regionId, entry);
}

/** The model of a territory's facility, or null when no model stands for it (the 2D map, say). */
export function facilityTarget(regionId: string, slot: BadgeSlot): Vec2 | null {
  return targets.get(regionId)?.[slot] ?? null;
}
