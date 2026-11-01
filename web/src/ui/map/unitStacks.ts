// Unit tokens for a territory: the placed slots first, then a curved arc, then a [+] cap.
//
// Every stack in a territory, land, air or sea, shares unit_slots. Nothing is reserved for air.
//
//   open     N stacks and K slots with N <= K: stack i sits on slot i, exactly, however close the slots are
//   arc      N > K: each slot keeps a primary token, and up to three more fold around it on a circular arc
//   capped   a slot would need a fourth satellite: the extras stop, and a [+] on the lead opens the inspector
//
// The primary token of a slot is drawn last, so its silhouette and bottom-right count pill stay clear.
// Facilities are never part of the stack.
import {
  facilitiesOf,
  facilityAnchorOf,
  type RegionShape,
  type StackEntry,
  stackKey,
  type Vec2,
} from "./geometry";
import { badgeExtent } from "./facilityBadge";
import { type View, worldToScreen } from "./viewMath";

export type UnitDomain = "land" | "air" | "sea";

const AIR_UNITS = new Set(["fighter", "tactical_bomber", "strategic_bomber", "bomber"]);
const SEA_UNITS = new Set(["sub", "submarine", "destroyer", "cruiser", "battleship", "carrier", "transport"]);

/** Engine ids and the names the roster uses for the same piece. */
const ALIASES: Record<string, string> = {
  tank: "armor",
  aaa: "aa",
  submarine: "sub",
  bomber: "tactical_bomber",
};

/** The roster id of a unit type. `tank` is armor, `submarine` is sub, `aaa` is aa. */
export function canonicalUnit(unitTypeId: string): string {
  return ALIASES[unitTypeId] ?? unitTypeId;
}

/**
 * The domain of a unit type. `categories` (unit type id to `land`, `air` or `sea`, from the scenario's unit
 * data) wins; without it the standard unit ids decide, and anything unknown is land.
 */
export function unitDomain(unitTypeId: string, categories?: Record<string, string>): UnitDomain {
  const declared = categories?.[unitTypeId];
  if (declared === "land" || declared === "air" || declared === "sea") {
    return declared;
  }
  const id = canonicalUnit(unitTypeId);
  if (AIR_UNITS.has(unitTypeId) || AIR_UNITS.has(id)) {
    return "air";
  }
  if (SEA_UNITS.has(unitTypeId) || SEA_UNITS.has(id)) {
    return "sea";
  }
  return "land";
}

/** "strategic_bomber" becomes "Strategic bomber". Anti-aircraft is "AA". */
export function unitLabel(unitTypeId: string): string {
  const id = canonicalUnit(unitTypeId);
  if (id === "aa") {
    return "AA";
  }
  const words = id.replace(/_/g, " ").trim();
  return words === "" ? unitTypeId : words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------
// One list per territory, not one per domain
// ---------------------------------------------------------------

/** Highest priority first. A land territory. */
export const LAND_ROSTER: readonly string[] = [
  "armor",
  "mech_infantry",
  "artillery",
  "infantry",
  "strategic_bomber",
  "tactical_bomber",
  "fighter",
  "aa",
];

/** Highest priority first. A sea zone. Aircraft on a carrier sit ahead of the transport. */
export const SEA_ROSTER: readonly string[] = [
  "carrier",
  "battleship",
  "cruiser",
  "destroyer",
  "sub",
  "fighter",
  "tactical_bomber",
  "transport",
];

/** The full 14-type roster, each piece once. */
export const ROSTER: readonly string[] = [
  "infantry",
  "mech_infantry",
  "artillery",
  "armor",
  "aa",
  "fighter",
  "tactical_bomber",
  "strategic_bomber",
  "battleship",
  "carrier",
  "cruiser",
  "destroyer",
  "sub",
  "transport",
];

/** Lower is further forward. Unknown units sort after the roster, then by key. */
export function rosterRank(unitTypeId: string, sea: boolean): number {
  const list = sea ? SEA_ROSTER : LAND_ROSTER;
  const at = list.indexOf(canonicalUnit(unitTypeId));
  return at < 0 ? list.length : at;
}

/** Every stack with a count, highest tactical priority first. The same list whatever the domain. */
export function orderStacks(entries: StackEntry[], sea: boolean): StackEntry[] {
  const byKey = new Map<string, StackEntry>();
  for (const entry of entries) {
    if (entry.count > 0 && !byKey.has(stackKey(entry))) {
      byKey.set(stackKey(entry), entry);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => rosterRank(a.unit_type_id, sea) - rosterRank(b.unit_type_id, sea) || stackKey(a).localeCompare(stackKey(b)),
  );
}

// ---------------------------------------------------------------
// Slots first, then a curved arc
// ---------------------------------------------------------------

/** How far a satellite sits from its anchor's primary token, in token diameters. */
export const ARC_RADIUS_RATIO = 0.72;
/** Satellites folded around one anchor before that anchor grows a [+]. */
export const ARC_SATELLITE_MAX = 3;

export type LayoutStage = "open" | "arc" | "capped";

/**
 * Screen-space degrees for 1, 2 or 3 satellites. 0° is to the right and positive is downward, so these
 * sit on the upper crescent and stay out of the +20° to +80° quadrant where the primary's count pill is.
 */
export function arcAngles(count: number): number[] {
  if (count >= 3) {
    return [-145, -100, -55];
  }
  if (count === 2) {
    return [-145, -55];
  }
  if (count === 1) {
    return [-100];
  }
  return [];
}

/** Where satellite `index` of `count` sits, relative to its primary token. */
export function arcOffset(index: number, count: number, diameter: number): Vec2 {
  const deg = arcAngles(count)[index] ?? -100;
  const rad = (deg * Math.PI) / 180;
  const reach = ARC_RADIUS_RATIO * diameter;
  return { x: Math.cos(rad) * reach, y: Math.sin(rad) * reach };
}

/**
 * Stacks onto slots. The first `K` stacks, highest priority first, are the primaries. Anything past that is
 * dealt around the slots, three satellites each. `groups[i][0]` is the primary of slot i.
 */
export function assignStacks(ordered: StackEntry[], slotCount: number): { groups: StackEntry[][]; capped: boolean } {
  const k = Math.max(0, slotCount);
  if (ordered.length === 0 || k === 0) {
    return { groups: [], capped: ordered.length > 0 };
  }
  const capacity = k * (1 + ARC_SATELLITE_MAX);
  const shown = Math.min(ordered.length, capacity);
  const groups: StackEntry[][] = Array.from({ length: k }, () => []);
  const primaries = Math.min(k, shown);
  for (let i = 0; i < primaries; i++) {
    groups[i].push(ordered[i]);
  }
  const extra = ordered.slice(primaries, shown);
  for (let i = 0; i < extra.length; i++) {
    groups[i % k].push(extra[i]);
  }
  return { groups, capped: ordered.length > shown };
}

/**
 * Index of the front-most point within `radius` of `p`. `points` is back to front, so the walk starts at the end
 * and the first hit wins. -1 when none is close enough.
 */
export function frontMostIndex(points: Vec2[], p: Vec2, radius: number): number {
  for (let i = points.length - 1; i >= 0; i--) {
    if (Math.hypot(points[i].x - p.x, points[i].y - p.y) <= radius) {
      return i;
    }
  }
  return -1;
}

/** Where the [+] sits relative to a token's centre: the rim at about half past one. */
export function plusOffset(diameter: number): Vec2 {
  const angle = -Math.PI / 4;
  const reach = diameter * 0.46;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
}

// ---------------------------------------------------------------
// Screen layout
// ---------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

export interface PlacedToken {
  entry: StackEntry;
  key: string;
  domain: UnitDomain;
  x: number;
  y: number;
  /** Higher draws later, so it is in front. The lead is the highest. */
  z: number;
}

export interface PlacedBadge extends Box {
  regionId: string;
  side: number;
}

export interface RegionVisuals {
  /** Back to front. */
  tokens: PlacedToken[];
  stage: LayoutStage;
  capped: boolean;
  /** The [+] badge, when the arcs are capped. */
  plus: Vec2 | null;
  /** Radial offset of a satellite, in screen px. 0 when every stack has its own slot. */
  stepPx: number;
  badge: PlacedBadge | null;
  shieldY: number;
  markerY: number;
}

export interface LayoutParams {
  view: View;
  /** Drawn token diameter, in screen px. */
  tokenPx: number;
  /** Side of one badge triangle, in screen px. */
  badgeSide: number;
  /** The territory's unit slots, in world units. Each one is used as placed. */
  slots: Vec2[];
  /** Kept so callers can pass a world diameter. Placement trusts the slots and does not use it. */
  tokenWorld?: number;
  categories?: Record<string, string>;
}

const GAP_PX = 4;

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw + gap && Math.abs(a.y - b.y) < a.hh + b.hh + gap;
}

/** Moves `mover` along its own direction (or `fallback`) just far enough to clear `fixed`. */
export function clearOf(fixed: Box, mover: Box, fallback: Vec2, gap = GAP_PX): Box {
  if (!overlaps(fixed, mover, gap)) {
    return mover;
  }
  let dx = mover.x - fixed.x;
  let dy = mover.y - fixed.y;
  let len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = fallback.x;
    dy = fallback.y;
    len = Math.hypot(dx, dy) || 1;
  }
  const d = { x: dx / len, y: dy / len };
  const w = fixed.hw + mover.hw + gap;
  const h = fixed.hh + mover.hh + gap;
  const rx = mover.x - fixed.x;
  const ry = mover.y - fixed.y;
  const tx = Math.abs(d.x) < 1e-9 ? Infinity : ((d.x > 0 ? w : -w) - rx) / d.x;
  const ty = Math.abs(d.y) < 1e-9 ? Infinity : ((d.y > 0 ? h : -h) - ry) / d.y;
  const t = Math.max(0, Math.min(tx, ty));
  return { ...mover, x: mover.x + d.x * t, y: mover.y + d.y * t };
}

/**
 * The territory's tokens, back to front, plus its facility badge and the y of the shield and combat marker.
 * One pool of slots for every unit type. Air has no anchor of its own.
 */
export function layoutRegionVisuals(region: RegionShape, entries: StackEntry[], p: LayoutParams): RegionVisuals {
  const { view, tokenPx } = p;
  const sea = region.type === "sea";
  const ordered = orderStacks(entries, sea);
  const categories = p.categories;
  const seats = p.slots.length > 0 ? p.slots : ordered.length > 0 ? [region.anchor] : [];
  const { groups, capped } = assignStacks(ordered, seats.length);

  // Back to front: lower-priority anchors first, and each anchor's satellites before its primary.
  const placed: { entry: StackEntry; at: Vec2 }[] = [];
  let arcing = false;
  for (let g = groups.length - 1; g >= 0; g--) {
    const group = groups[g];
    if (group.length === 0) {
      continue;
    }
    const origin = worldToScreen(view, seats[g]);
    const sats = group.slice(1);
    if (sats.length > 0) {
      arcing = true;
    }
    sats.forEach((entry, s) => {
      const off = arcOffset(s, sats.length, tokenPx);
      placed.push({ entry, at: { x: origin.x + off.x, y: origin.y + off.y } });
    });
    placed.push({ entry: group[0], at: origin });
  }
  const stage: LayoutStage = capped ? "capped" : arcing ? "arc" : "open";
  const stepPx = arcing ? ARC_RADIUS_RATIO * tokenPx : 0;

  const tokens: PlacedToken[] = placed.map((item, i) => ({
    entry: item.entry,
    key: stackKey(item.entry),
    domain: unitDomain(item.entry.unit_type_id, categories),
    x: item.at.x,
    y: item.at.y,
    z: i,
  }));
  const lead = placed[placed.length - 1];
  const plus = capped && lead ? { x: lead.at.x + plusOffset(tokenPx).x, y: lead.at.y + plusOffset(tokenPx).y } : null;

  const s = tokenPx / 32;
  const anchor = worldToScreen(view, region.anchor);
  const half = tokenPx / 2 + 1;
  const occupied: Box[] = tokens.map((t) => ({ x: t.x, y: t.y, hw: half, hh: half }));

  const shieldBox = (y: number): Box => ({ x: anchor.x, y: y + 1.5 * s, hw: 10 * s + 1, hh: 12.5 * s + 1 });
  let shieldY = anchor.y;
  for (let i = 0; i < 6; i++) {
    const hit = occupied.filter((b) => overlaps(shieldBox(shieldY), b));
    if (hit.length === 0) {
      break;
    }
    shieldY = Math.min(...hit.map((b) => b.y - b.hh)) - 12.5 * s - 3;
  }

  const facilities = facilitiesOf(region);
  const ext = badgeExtent(facilities);
  let badge: PlacedBadge | null = null;
  if (ext.w > 0) {
    const at = worldToScreen(view, facilityAnchorOf(region));
    let box: Box = { x: at.x, y: at.y, hw: (ext.w * p.badgeSide) / 2, hh: (ext.h * p.badgeSide) / 2 };
    if (!region.facilityAnchorSet) {
      for (const obstacle of [shieldBox(shieldY), ...occupied]) {
        box = clearOf(obstacle, box, { x: 0, y: 1 });
      }
    }
    badge = { ...box, regionId: region.id, side: p.badgeSide };
  }

  const boxes: Box[] = [...occupied, ...(badge ? [badge] : [])];
  const bottom = Math.max(anchor.y, ...boxes.filter((b) => Math.abs(b.x - anchor.x) < b.hw + 24 * s).map((b) => b.y + b.hh));
  return { tokens, stage, capped, plus, stepPx, badge, shieldY, markerY: bottom + 18 * s };
}
