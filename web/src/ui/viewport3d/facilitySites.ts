// Where a territory's harbor and airbase stand. Pure.
//
// A harbor stands at the foot of a cliff: its back to the land's edge, its piers reaching out over the water. The site is the
// nearest stretch of coast to the territory's facility anchor that belongs to the territory. An airbase stands on level ground by
// the territory's air anchor. Both are defaults, and the placement editor moves them like a landmark.
import type { Vec2 } from "../map/geometry";
import { FACILITY_SCALE, type FacilityKind } from "./facilityModels";

export interface FacilitySite {
  kind: FacilityKind;
  regionId: string;
  /** Where the model's origin stands, in map coordinates. */
  x: number;
  y: number;
  /** Turn about the vertical, in the placement's own convention: the model's +x lands on map direction (cos t, -sin t). */
  turn: number;
}

/** What a harbor model's quay reaches back from its origin, in model units: the origin sits this far seaward of the cliff's edge. */
const QUAY_BACK = 0.24;
/** How far out from the facility anchor the search for a coast goes, in world units. */
const SHORE_REACH = 40;

/**
 * The nearest coast of a territory, found by marching out from `origin` in every direction until the land stops. Returns the last
 * point of land and the direction out to sea, or null when the territory has no coast within reach.
 */
export function shoreFrom(
  origin: Vec2,
  isLand: (p: Vec2) => boolean,
  contains: (p: Vec2) => boolean,
  reach = SHORE_REACH,
): { shore: Vec2; dir: Vec2 } | null {
  if (!isLand(origin)) {
    return null;
  }
  let best: { shore: Vec2; dir: Vec2; distance: number } | null = null;
  const directions = 48;
  for (let i = 0; i < directions; i++) {
    const angle = (i / directions) * Math.PI * 2;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    let last = origin;
    for (let d = 0.5; d <= reach; d += 0.5) {
      const p = { x: origin.x + dir.x * d, y: origin.y + dir.y * d };
      if (!isLand(p)) {
        if (contains(last) && (best === null || d < best.distance)) {
          best = { shore: last, dir, distance: d };
        }
        break;
      }
      last = p;
    }
  }
  return best ? { shore: best.shore, dir: best.dir } : null;
}

/** A harbor's site: the model's back against the cliff and its piers out over the water. Null for an inland territory. */
export function harborSite(
  regionId: string,
  origin: Vec2,
  isLand: (p: Vec2) => boolean,
  contains: (p: Vec2) => boolean,
): FacilitySite | null {
  const found = shoreFrom(origin, isLand, contains);
  if (!found) {
    return null;
  }
  const back = QUAY_BACK * FACILITY_SCALE.harbor;
  return {
    kind: "harbor",
    regionId,
    x: found.shore.x + found.dir.x * back,
    y: found.shore.y + found.dir.y * back,
    turn: Math.atan2(-found.dir.y, found.dir.x),
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** An airbase's site: by the air anchor, with its strip turned a little differently in each territory. */
export function airbaseSite(regionId: string, origin: Vec2): FacilitySite {
  return { kind: "airbase", regionId, x: origin.x, y: origin.y, turn: (hash(regionId) - 0.5) * 0.9 };
}
