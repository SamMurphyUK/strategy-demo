// Domain-separated unit stacks, one token per distinct unit type. Pure: no canvas, no DOM.
//
// Every stack (one unit type of one faction) is drawn as its own token in its own world-space slot, whatever
// the zoom (see unitSlots.ts for the slots). A territory's units are grouped by domain (land, sea, air) only so
// that a domain can fall back to a bubble when the territory cannot fit them all: a bubble shows the lead unit
// by threat priority inside a stacked-card double ring, and opens a drawer listing every unit type and count.
//
// Collapse is an overflow fallback and nothing else. It happens when the stacks present outnumber the slots
// that fit without colliding, never because of how many types there are or how far the camera is zoomed out.
//
// Facilities (factory, airbase, harbour) are never part of a stack. They have their own badge.
import {
  airAnchorOf,
  facilitiesOf,
  facilityAnchorOf,
  type RegionShape,
  type StackEntry,
  type StackSlot,
  stackKey,
  type Vec2,
} from "./geometry";
import { badgeExtent } from "./facilityBadge";
import { nonCollidingSlots, TOKEN_WORLD } from "./unitSlots";
import { type View, worldToScreen } from "./viewMath";

export type UnitDomain = "land" | "air" | "sea";

/** Land first, then sea, then air: the order stacks take slots and the drawer lists them. */
export const DOMAIN_ORDER: readonly UnitDomain[] = ["land", "sea", "air"];

const AIR_UNITS = new Set(["fighter", "tactical_bomber", "strategic_bomber", "bomber"]);
const SEA_UNITS = new Set(["submarine", "destroyer", "cruiser", "battleship", "carrier", "transport"]);

/**
 * The domain of a unit type. `categories` (unit type id to `land`, `air` or `sea`, from the scenario's unit
 * data) wins; without it the standard unit ids decide, and anything unknown (infantry, artillery, armor, aa)
 * is land.
 */
export function unitDomain(unitTypeId: string, categories?: Record<string, string>): UnitDomain {
  const declared = categories?.[unitTypeId];
  if (declared === "land" || declared === "air" || declared === "sea") {
    return declared;
  }
  if (AIR_UNITS.has(unitTypeId)) {
    return "air";
  }
  if (SEA_UNITS.has(unitTypeId)) {
    return "sea";
  }
  return "land";
}

/** "strategic_bomber" becomes "Strategic bomber". */
export function unitLabel(unitTypeId: string): string {
  const words = unitTypeId.replace(/_/g, " ").trim();
  return words === "" ? unitTypeId : words.charAt(0).toUpperCase() + words.slice(1);
}

export function domainLabel(domain: UnitDomain): string {
  return domain === "land" ? "Land" : domain === "air" ? "Air" : "Sea";
}

/**
 * Threat priority within a domain, higher first. It picks the lead icon of a collapsed bubble and the order
 * stacks take slots:
 *   land  armor > artillery > infantry > aa
 *   air   bomber > fighter
 *   sea   carrier > battleship > cruiser > destroyer > submarine > transport
 * Mechanised infantry ranks between artillery and infantry. Unknown units rank 0.
 */
const PRIORITY: Record<string, number> = {
  tank: 90,
  armor: 90,
  artillery: 80,
  mech_infantry: 70,
  infantry: 60,
  aa: 50,
  aaa: 50,
  strategic_bomber: 90,
  tactical_bomber: 80,
  bomber: 80,
  fighter: 70,
  carrier: 90,
  battleship: 80,
  cruiser: 70,
  destroyer: 60,
  submarine: 50,
  transport: 40,
};

export function unitPriority(unitTypeId: string): number {
  return PRIORITY[unitTypeId] ?? 0;
}

/** Highest threat priority first, then the bigger stack, then by key so the order never flickers. */
function byPriority(a: StackEntry, b: StackEntry): number {
  return (
    unitPriority(b.unit_type_id) - unitPriority(a.unit_type_id) ||
    b.count - a.count ||
    stackKey(a).localeCompare(stackKey(b))
  );
}

export interface DomainGroup {
  domain: UnitDomain;
  /** One entry per stack key (type | faction | instance), sorted by key. */
  entries: StackEntry[];
  /** Distinct unit types, regardless of faction. */
  typeCount: number;
  /** Every unit in the domain. */
  total: number;
  /** The stack shown on a collapsed bubble: the highest threat priority present. */
  lead: StackEntry;
}

function leadOf(entries: StackEntry[]): StackEntry {
  return [...entries].sort(byPriority)[0];
}

/** A group's stacks in the order they take slots: highest threat priority first. */
export function orderedEntries(group: DomainGroup): StackEntry[] {
  return [...group.entries].sort(byPriority);
}

/** Splits a territory's stacks by domain, in DOMAIN_ORDER. Empty stacks and empty domains are dropped. */
export function groupByDomain(entries: StackEntry[], categories?: Record<string, string>): DomainGroup[] {
  const byKey = new Map<string, StackEntry>();
  for (const entry of entries) {
    if (entry.count > 0 && !byKey.has(stackKey(entry))) {
      byKey.set(stackKey(entry), entry);
    }
  }
  const buckets = new Map<UnitDomain, StackEntry[]>();
  for (const key of [...byKey.keys()].sort()) {
    const entry = byKey.get(key)!;
    const domain = unitDomain(entry.unit_type_id, categories);
    buckets.set(domain, [...(buckets.get(domain) ?? []), entry]);
  }
  return DOMAIN_ORDER.filter((d) => buckets.has(d)).map((domain) => {
    const list = buckets.get(domain)!;
    return {
      domain,
      entries: list,
      typeCount: new Set(list.map((e) => e.unit_type_id)).size,
      total: list.reduce((n, e) => n + e.count, 0),
      lead: leadOf(list),
    };
  });
}

// ---------------------------------------------------------------
// When a domain collapses: overflow only
// ---------------------------------------------------------------

/**
 * Which domains collapse into a bubble, given how many non-colliding slots the territory has.
 *
 * Nothing collapses while every stack present has a slot (`presentUnitTypes.length <= slotCount`). Past that,
 * the domain with the most stacks collapses first (the later of land, sea, air on a tie), then the next,
 * until what is left fits. A bubble takes a slot of its own, except an air bubble whose air anchor the map
 * file places. A domain holding a single stack never collapses: a bubble would show no more than the token.
 */
export function planCollapse(groups: DomainGroup[], slotCount: number, airAnchorPlaced = false): UnitDomain[] {
  const present = groups.reduce((n, g) => n + g.entries.length, 0);
  if (present <= slotCount) {
    return [];
  }
  const takesSlot = (g: DomainGroup) => !(g.domain === "air" && airAnchorPlaced);
  const candidates = groups
    .filter((g) => g.entries.length > 1)
    .sort((a, b) => b.entries.length - a.entries.length || DOMAIN_ORDER.indexOf(b.domain) - DOMAIN_ORDER.indexOf(a.domain));
  const collapsed: UnitDomain[] = [];
  const used = () =>
    groups.reduce((n, g) => n + (collapsed.includes(g.domain) ? (takesSlot(g) ? 1 : 0) : g.entries.length), 0);
  for (const g of candidates) {
    if (used() <= slotCount) {
      break;
    }
    collapsed.push(g.domain);
  }
  return collapsed;
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

export interface PlacedSlot {
  slot: StackSlot;
  x: number;
  y: number;
}

export interface DomainCluster {
  regionId: string;
  domain: UnitDomain;
  group: DomainGroup;
  collapsed: boolean;
  /** Screen centre: the bubble, or the middle of the domain's tokens. */
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** Expanded stacks, one token each. Empty when collapsed. */
  slots: PlacedSlot[];
  /** Radius of the collapsed bubble, in px. 0 when expanded. */
  bubbleRadius: number;
}

export interface PlacedBadge extends Box {
  regionId: string;
  /** Side of one triangle, in px. */
  side: number;
}

export interface RegionVisuals {
  clusters: DomainCluster[];
  badge: PlacedBadge | null;
  /** Screen y for the centre of the IPC shield: on the anchor, or above any unit that has no room elsewhere. */
  shieldY: number;
  /** Screen y for the centre of the combat marker, below every token and the badge near the anchor. */
  markerY: number;
  /** How many stacks the territory has slots for without a collision. */
  slotCount: number;
}

export interface LayoutParams {
  view: View;
  /** Pixel size of a unit token on screen. */
  tokenPx: number;
  /** Side of one badge triangle on screen. */
  badgeSide: number;
  /** The territory's unit slots in world units (see effectiveUnitSlots). */
  slots: Vec2[];
  /** World diameter of a token, which decides whether two slots collide. Defaults to TOKEN_WORLD. */
  tokenWorld?: number;
  categories?: Record<string, string>;
}

/** Radius of the collapsed bubble relative to the token's diameter: the same disc as a token. */
export const BUBBLE_RADIUS_RATIO = 0.5;
const GAP_PX = 4;

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw + gap && Math.abs(a.y - b.y) < a.hh + b.hh + gap;
}

/**
 * Moves `mover` along `dir` (default `fallback`) just far enough to clear `fixed`. A clear box stays put.
 * Used only for anchors the map file leaves at their default, so a hand-placed anchor is exact.
 */
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
  // The distance along d at which the boxes stop overlapping on x, or on y; the nearer one is enough.
  const tx = Math.abs(d.x) < 1e-9 ? Infinity : ((d.x > 0 ? w : -w) - rx) / d.x;
  const ty = Math.abs(d.y) < 1e-9 ? Infinity : ((d.y > 0 ? h : -h) - ry) / d.y;
  const t = Math.max(0, Math.min(tx, ty));
  return { ...mover, x: mover.x + d.x * t, y: mover.y + d.y * t };
}

/**
 * A region's tokens or bubbles, facility badge and the y of its shield and combat marker, all in screen px.
 *
 * Stacks take the region's non-colliding slots in order: land first, then sea, then air, highest threat
 * priority first within each. When there are more stacks than slots, planCollapse picks the domains that
 * fold into bubbles, and each bubble takes a slot. Anything still without a slot (a cramped territory) sits
 * just off the anchor, air at the air anchor.
 */
export function layoutRegionVisuals(region: RegionShape, entries: StackEntry[], p: LayoutParams): RegionVisuals {
  const { view, tokenPx } = p;
  const s = tokenPx / 32;
  const anchor = worldToScreen(view, region.anchor);
  const groups = groupByDomain(entries, p.categories);
  const slotsWorld = nonCollidingSlots(p.slots, p.tokenWorld ?? TOKEN_WORLD);
  const free = slotsWorld.map((w) => worldToScreen(view, w));
  const airPlaced = region.airAnchorSet === true;
  const airAt = worldToScreen(view, airAnchorOf(region));
  const collapsedDomains = planCollapse(groups, slotsWorld.length, airPlaced);

  // Where a stack or bubble goes once the slots are used up.
  let overflow = 0;
  const spill = (domain: UnitDomain): Vec2 => {
    const n = overflow++;
    const base = domain === "air" ? airAt : { x: anchor.x, y: anchor.y + tokenPx * 0.95 };
    return { x: base.x + n * tokenPx * 1.05, y: base.y };
  };
  const take = (domain: UnitDomain): Vec2 => free.shift() ?? spill(domain);

  const r = tokenPx * BUBBLE_RADIUS_RATIO;
  const half = tokenPx / 2 + 1;
  const clusters: DomainCluster[] = [];
  const occupied: Box[] = [];

  // Bubbles first, so a collapsed domain gets the better slot.
  const bubbleAt = new Map<UnitDomain, Vec2>();
  for (const group of groups.filter((g) => collapsedDomains.includes(g.domain))) {
    bubbleAt.set(group.domain, group.domain === "air" && airPlaced ? airAt : take(group.domain));
  }

  for (const group of groups) {
    if (collapsedDomains.includes(group.domain)) {
      const at = bubbleAt.get(group.domain)!;
      clusters.push({
        regionId: region.id,
        domain: group.domain,
        group,
        collapsed: true,
        x: at.x,
        y: at.y,
        hw: r + 4,
        hh: r + 4,
        slots: [],
        bubbleRadius: r,
      });
      occupied.push({ x: at.x, y: at.y, hw: r + 3, hh: r + 3 });
      continue;
    }
    const placed: PlacedSlot[] = orderedEntries(group).map((entry) => {
      const at = take(group.domain);
      occupied.push({ x: at.x, y: at.y, hw: half, hh: half });
      return {
        slot: { key: stackKey(entry), entry, offset: { x: at.x - anchor.x, y: at.y - anchor.y } },
        x: at.x,
        y: at.y,
      };
    });
    const x0 = Math.min(...placed.map((q) => q.x)) - half;
    const x1 = Math.max(...placed.map((q) => q.x)) + half;
    const y0 = Math.min(...placed.map((q) => q.y)) - half;
    const y1 = Math.max(...placed.map((q) => q.y)) + half;
    clusters.push({
      regionId: region.id,
      domain: group.domain,
      group,
      collapsed: false,
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      hw: (x1 - x0) / 2,
      hh: (y1 - y0) / 2,
      slots: placed,
      bubbleRadius: 0,
    });
  }

  // The IPC shield sits on the anchor. Slots keep clear of it, so it only moves above a token that has no
  // other place to go, in a territory too small for the hub and its units.
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
      // A default badge keeps off the tokens and the shield; one the file places is exact.
      for (const obstacle of [shieldBox(shieldY), ...occupied]) {
        box = clearOf(obstacle, box, { x: 0, y: 1 });
      }
    }
    badge = { ...box, regionId: region.id, side: p.badgeSide };
  }

  // The combat marker (44 px wide) goes below whatever sits under it.
  const boxes: Box[] = [...occupied, ...(badge ? [badge] : [])];
  const bottom = Math.max(anchor.y, ...boxes.filter((b) => Math.abs(b.x - anchor.x) < b.hw + 24 * s).map((b) => b.y + b.hh));
  return {
    clusters,
    badge,
    shieldY,
    markerY: bottom + 18 * s,
    slotCount: slotsWorld.length,
  };
}

// ---------------------------------------------------------------
// The expanded drawer
// ---------------------------------------------------------------

export interface DrawerRow {
  key: string;
  entry: StackEntry;
  label: string;
  count: number;
}

/** One row per stack in the domain: biggest first, then by name. */
export function drawerRows(group: DomainGroup): DrawerRow[] {
  return group.entries
    .map((entry) => ({ key: stackKey(entry), entry, label: unitLabel(entry.unit_type_id), count: entry.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
