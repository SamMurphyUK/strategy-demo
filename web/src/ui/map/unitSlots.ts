// Unit slots: where each unit token of a territory sits, in world units. Pure: no canvas, no DOM.
//
// Every distinct unit type in a territory gets its own circular token in its own slot, and the slots are fixed
// in the world, so a formation keeps its exact shape at every zoom. A map file can place up to six by hand
// (`metadata.unit_slots`). Left unset, they are generated from the territory's true shape:
//
//   orbit  a broad, rounded territory (Germany, France, Russia): an arc or ring around the unit anchor
//   spine  a long, narrow one (the UK, Italy, Norway, Japan): a chain down the middle of its length
//
// The unit anchor (where the IPC shield sits) and the facility anchor (the Tri-Wedge badge) are the hub, and
// tokens keep clear of both. A slot's centre stays SLOT_INSET inside the coast or border; its rim may spill
// over it on a thin island. Slots are one pool for every unit type. Tokens sit on those slots as placed.
// Only when there are more unit types than slots do the extras arc around an anchor (see unitStacks.ts).
import { facilityCount } from "./facilityBadge";
import { facilitiesOf, facilityAnchorOf, type RegionShape, UNIT_SLOT_MAX, unitSlotMax, type Vec2 } from "./geometry";
import { type MultiPolygon, type Ring, pointInMultiPolygon } from "./regionClip";

/** Diameter of a unit token in world units. Tokens scale with the map, so slots can be laid out once. */
/** Half the old 20, so a token sits inside a narrow territory instead of covering its coast. */
export const TOKEN_WORLD = 10;
/** A generated slot's centre is at least this far inside the coast or border, in world units. */
export const SLOT_INSET = 3.5;
/** A shape this much longer than it is wide (by standard deviation of its area) gets a spine, not an orbit. */
export const ELONGATION_RATIO = 1.8;
/** Two slots closer than this share of a token's diameter collide. */
export const COLLIDE_RATIO = 0.95;

export type SlotMode = "orbit" | "spine";

export interface SlotRequest {
  /** The territory's true shape: its cutter clipped against the land (every island of it). */
  shape: MultiPolygon;
  /** The unit anchor: the IPC shield sits here. */
  hub: Vec2;
  /** The facility anchor, when the territory has a facility to keep clear. */
  facility?: Vec2 | null;
}

export interface GeneratedSlots {
  mode: SlotMode;
  /** Up to UNIT_SLOT_MAX slots, in the order units are assigned to them. */
  slots: Vec2[];
}

// ---------------------------------------------------------------
// Shape queries
// ---------------------------------------------------------------

type Seg = [number, number, number, number];

function segmentsOf(shape: MultiPolygon): Seg[] {
  const out: Seg[] = [];
  for (const polygon of shape) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        out.push([ring[j][0], ring[j][1], ring[i][0], ring[i][1]]);
      }
    }
  }
  return out;
}

/** Distance from `p` to the nearest edge. Stops early once it is below `floor`, which is then all the caller needs. */
function clearance(p: Vec2, segs: Seg[], floor = 0): number {
  let best = Infinity;
  const floorSq = floor * floor;
  for (const [x1, y1, x2, y2] of segs) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.min(Math.max(((p.x - x1) * dx + (p.y - y1) * dy) / len, 0), 1);
    const ex = x1 + t * dx - p.x;
    const ey = y1 + t * dy - p.y;
    const d = ex * ex + ey * ey;
    if (d < best) {
      best = d;
      if (best < floorSq) {
        return Math.sqrt(best);
      }
    }
  }
  return Math.sqrt(best);
}

interface Level {
  /** How far inside the edge a slot's centre must be. */
  inset: number;
  /** How far from the unit anchor and the facility anchor, centre to centre. */
  hubClear: number;
  facilityClear: number;
}

/** Tried in order. The later ones give a cramped territory a slot or two it would otherwise lack. */
const LEVELS: readonly Level[] = [
  { inset: SLOT_INSET, hubClear: TOKEN_WORLD * 0.85, facilityClear: TOKEN_WORLD * 0.9 },
  { inset: 1.5, hubClear: TOKEN_WORLD * 0.5, facilityClear: TOKEN_WORLD * 0.55 },
  { inset: 0, hubClear: 0, facilityClear: 0 },
];

interface Probe {
  shape: MultiPolygon;
  segs: Seg[];
  hub: Vec2;
  facility: Vec2 | null;
}

function usable(p: Vec2, probe: Probe, level: Level): boolean {
  if (level.hubClear > 0 && Math.hypot(p.x - probe.hub.x, p.y - probe.hub.y) < level.hubClear) {
    return false;
  }
  if (probe.facility && level.facilityClear > 0 && Math.hypot(p.x - probe.facility.x, p.y - probe.facility.y) < level.facilityClear) {
    return false;
  }
  if (!pointInMultiPolygon(p, probe.shape)) {
    return false;
  }
  return level.inset <= 0 || clearance(p, probe.segs, level.inset) >= level.inset;
}

// ---------------------------------------------------------------
// The shape's long axis
// ---------------------------------------------------------------

interface Analysis {
  mean: Vec2;
  /** Unit vector along the long axis, pointing down or right so the first slot is the north or west end. */
  u: Vec2;
  v: Vec2;
  sdMajor: number;
  sdMinor: number;
  ratio: number;
  /** Extent of the shape's area along u, measured from `mean`. */
  tMin: number;
  tMax: number;
}

/** Principal axis of the territory's area, from a grid of samples inside it. Null when no sample lands inside. */
function analyse(probe: Probe): Analysis | null {
  const xs = probe.segs.flatMap((s) => [s[0], s[2]]);
  const ys = probe.segs.flatMap((s) => [s[1], s[3]]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const step = Math.max(0.75, Math.max(x1 - x0, y1 - y0) / 36);
  const pts: Vec2[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      if (pointInMultiPolygon({ x, y }, probe.shape)) {
        pts.push({ x, y });
      }
    }
  }
  if (pts.length === 0) {
    return null;
  }
  const mean = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mean.x) ** 2;
    syy += (p.y - mean.y) ** 2;
    sxy += (p.x - mean.x) * (p.y - mean.y);
  }
  sxx /= pts.length;
  syy /= pts.length;
  sxy /= pts.length;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u = { x: Math.cos(theta), y: Math.sin(theta) };
  if (u.y < -1e-9 || (Math.abs(u.y) <= 1e-9 && u.x < 0)) {
    u = { x: -u.x, y: -u.y };
  }
  const v = { x: -u.y, y: u.x };
  const along = (p: Vec2) => (p.x - mean.x) * u.x + (p.y - mean.y) * u.y;
  const across = (p: Vec2) => (p.x - mean.x) * v.x + (p.y - mean.y) * v.y;
  const varMajor = pts.reduce((s, p) => s + along(p) ** 2, 0) / pts.length;
  const varMinor = pts.reduce((s, p) => s + across(p) ** 2, 0) / pts.length;
  const sdMajor = Math.sqrt(varMajor);
  const sdMinor = Math.sqrt(Math.max(varMinor, 1e-6));
  const ts = pts.map(along);
  return {
    mean,
    u,
    v,
    sdMajor,
    sdMinor,
    ratio: sdMajor / sdMinor,
    tMin: Math.min(...ts) - step / 2,
    tMax: Math.max(...ts) + step / 2,
  };
}

// ---------------------------------------------------------------
// Orbit: an arc or ring around the unit anchor
// ---------------------------------------------------------------

const ORBIT_ROTATIONS = 24;
const ORBIT_RADIUS_STEPS = 9;

function orbitSlots(probe: Probe, level: Level): Vec2[] {
  const D = TOKEN_WORLD;
  const memo = new Map<string, boolean>();
  const at = (r: number, a: number): Vec2 => ({ x: probe.hub.x + r * Math.cos(a), y: probe.hub.y + r * Math.sin(a) });
  const ok = (r: number, a: number): boolean => {
    const key = `${r.toFixed(3)}|${a.toFixed(5)}`;
    let hit = memo.get(key);
    if (hit === undefined) {
      hit = usable(at(r, a), probe, level);
      memo.set(key, hit);
    }
    return hit;
  };

  interface Config {
    count: number;
    full: boolean;
    r: number;
    rot: number;
    k: number;
    angles: number[];
  }
  /** More slots first; then a whole ring over an arc; then the tighter ring, the one nearer the top, the fuller one. */
  const beats = (a: Config, b: Config | null): boolean => {
    if (b === null) {
      return true;
    }
    if (a.count !== b.count) {
      return a.count > b.count;
    }
    if (a.full !== b.full) {
      return a.full;
    }
    if (a.r !== b.r) {
      return a.r < b.r;
    }
    if (a.rot !== b.rot) {
      return a.rot < b.rot;
    }
    return a.k > b.k;
  };
  let best: Config | null = null;

  for (let k = UNIT_SLOT_MAX; k >= 1; k--) {
    const rMin = Math.max(level.hubClear, k >= 2 ? D / (2 * Math.sin(Math.PI / k)) : 0);
    for (let i = 0; i < ORBIT_RADIUS_STEPS; i++) {
      const r = rMin + i * 0.4 * D;
      for (let rot = 0; rot < ORBIT_ROTATIONS; rot++) {
        const phase = -Math.PI / 2 + (rot * 2 * Math.PI) / ORBIT_ROTATIONS;
        const angles: number[] = [];
        for (let j = 0; j < k; j++) {
          const a = phase + (2 * Math.PI * j) / k;
          if (ok(r, a)) {
            angles.push(a);
          }
        }
        if (angles.length === 0) {
          continue;
        }
        const candidate: Config = { count: angles.length, full: angles.length === k, r, rot: Math.min(rot, ORBIT_ROTATIONS - rot), k, angles };
        if (beats(candidate, best)) {
          best = candidate;
        }
      }
    }
  }
  const found = best as Config | null;
  if (found === null) {
    return [];
  }
  const turn = (a: number) => (((a + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return [...found.angles].sort((a, b) => turn(a) - turn(b)).map((a) => at(found.r, a));
}

// ---------------------------------------------------------------
// Spine: a chain down the length of the territory
// ---------------------------------------------------------------

interface SpinePoint {
  t: number;
  p: Vec2;
}

function spineSlots(probe: Probe, level: Level, axis: Analysis): Vec2[] {
  const D = TOKEN_WORLD;
  const dt = D / 4;
  const reach = axis.sdMinor * 2.2 + 2;
  const ds = Math.max(0.75, reach / 6);
  const pts: SpinePoint[] = [];
  for (let t = axis.tMin; t <= axis.tMax + 1e-9; t += dt) {
    let best: { p: Vec2; c: number; s: number } | null = null;
    for (let s = -reach; s <= reach + 1e-9; s += ds) {
      const p = {
        x: axis.mean.x + axis.u.x * t + axis.v.x * s,
        y: axis.mean.y + axis.u.y * t + axis.v.y * s,
      };
      if (!pointInMultiPolygon(p, probe.shape)) {
        continue;
      }
      const c = clearance(p, probe.segs);
      if (best === null || c > best.c + 1e-9 || (Math.abs(c - best.c) <= 1e-9 && Math.abs(s) < Math.abs(best.s))) {
        best = { p, c, s };
      }
    }
    if (best && usable(best.p, probe, level)) {
      pts.push({ t, p: best.p });
    }
  }
  if (pts.length === 0) {
    return [];
  }
  const apart = (list: Vec2[], p: Vec2, gap: number) => list.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap);

  // Evenly spaced along the chain, as many as the length allows.
  const span = pts[pts.length - 1].t - pts[0].t;
  let even: Vec2[] = [];
  for (let k = Math.min(UNIT_SLOT_MAX, Math.floor(span / D) + 1); k >= 1; k--) {
    const used = new Set<number>();
    const picked: Vec2[] = [];
    for (let i = 0; i < k; i++) {
      const target = k === 1 ? pts[0].t + span / 2 : pts[0].t + (i * span) / (k - 1);
      let nearest = -1;
      pts.forEach((sp, index) => {
        if (!used.has(index) && (nearest < 0 || Math.abs(sp.t - target) < Math.abs(pts[nearest].t - target))) {
          nearest = index;
        }
      });
      if (nearest >= 0) {
        used.add(nearest);
        picked.push(pts[nearest].p);
      }
    }
    if (picked.every((p, i) => apart(picked.slice(0, i), p, D * 0.98))) {
      even = picked;
      break;
    }
  }

  // Or packed from the first end, which does better when a gap (the hub) splits the chain.
  const greedy: Vec2[] = [];
  for (const sp of pts) {
    if (greedy.length < UNIT_SLOT_MAX && apart(greedy, sp.p, D)) {
      greedy.push(sp.p);
    }
  }
  const chosen = greedy.length > even.length ? greedy : even;
  const along = (p: Vec2) => (p.x - axis.mean.x) * axis.u.x + (p.y - axis.mean.y) * axis.u.y;
  return [...chosen].sort((a, b) => along(a) - along(b));
}

// ---------------------------------------------------------------
// Generation
// ---------------------------------------------------------------

/**
 * Up to six deterministic slots inside the territory. A rounded territory gets an orbit around the hub, a
 * long narrow one a spine. The other layout is tried too when the first leaves slots empty, and the better of
 * the two wins. A cramped territory relaxes the hub and edge clearances (see LEVELS) rather than lose all of
 * its slots. Possibly empty, for a shape with no area.
 */
export function generateUnitSlots(request: SlotRequest): GeneratedSlots {
  const segs = segmentsOf(request.shape);
  if (segs.length === 0) {
    return { mode: "orbit", slots: [] };
  }
  const probe: Probe = { shape: request.shape, segs, hub: request.hub, facility: request.facility ?? null };
  const axis = analyse(probe);
  const primary: SlotMode = axis !== null && axis.ratio >= ELONGATION_RATIO ? "spine" : "orbit";
  const run = (mode: SlotMode, level: Level): Vec2[] =>
    mode === "orbit" ? orbitSlots(probe, level) : axis ? spineSlots(probe, level, axis) : [];

  let best: GeneratedSlots = { mode: primary, slots: [] };
  for (const level of LEVELS) {
    let result: GeneratedSlots = { mode: primary, slots: run(primary, level) };
    if (result.slots.length < UNIT_SLOT_MAX) {
      const other: SlotMode = primary === "orbit" ? "spine" : "orbit";
      const alternative = run(other, level);
      if (alternative.length > result.slots.length) {
        result = { mode: other, slots: alternative };
      }
    }
    if (result.slots.length > best.slots.length) {
      best = result;
    }
    if (best.slots.length >= 3) {
      break;
    }
  }
  return best;
}

// ---------------------------------------------------------------
// A region's slots
// ---------------------------------------------------------------

const rough = new WeakMap<RegionShape, MultiPolygon>();

/**
 * The cutter polygon (and its other islands) as a MultiPolygon, for when the land has not loaded. The same
 * object every time for one region, so the generator's cache holds.
 */
export function roughShape(region: RegionShape): MultiPolygon {
  let shape = rough.get(region);
  if (!shape) {
    const ring = (points: Vec2[]): Ring => points.map((p) => [p.x, p.y]);
    shape = [[ring(region.points)], ...(region.extra ?? []).map((points): Ring[] => [ring(points)])];
    rough.set(region, shape);
  }
  return shape;
}

const generated = new WeakMap<MultiPolygon, Map<string, GeneratedSlots>>();

/** True when the region's slots come from the map file instead of the generator. */
export function hasHandPlacedSlots(region: RegionShape): boolean {
  return (region.unitSlots?.length ?? 0) > 0;
}

/** The generated slots of a region (cached per shape, hub and facility anchor). Never empty. */
export function generatedSlotsOf(region: RegionShape, shape: MultiPolygon): GeneratedSlots {
  const land = region.type === "land" && facilityCount(facilitiesOf(region)) > 0;
  const facility = land ? facilityAnchorOf(region) : null;
  const key = `${region.anchor.x},${region.anchor.y}|${facility ? `${facility.x},${facility.y}` : ""}`;
  let byKey = generated.get(shape);
  if (!byKey) {
    byKey = new Map();
    generated.set(shape, byKey);
  }
  let hit = byKey.get(key);
  if (!hit) {
    hit = generateUnitSlots({ shape, hub: region.anchor, facility });
    byKey.set(key, hit);
  }
  return hit.slots.length > 0 ? hit : { mode: hit.mode, slots: [{ ...region.anchor }] };
}

/**
 * Where the region's unit tokens go, in world units: the slots its map file places, else generated ones.
 * `shape` is the territory's true (clipped) shape, or roughShape(region).
 */
export function effectiveUnitSlots(region: RegionShape, shape: MultiPolygon): Vec2[] {
  if (hasHandPlacedSlots(region)) {
    return (region.unitSlots ?? []).slice(0, unitSlotMax(region.type === "sea"));
  }
  return generatedSlotsOf(region, shape).slots;
}

/**
 * The slots that do not collide with an earlier one, in order. A token needs a slot of its own, so this is
 * how many unit types a territory can show before a domain must collapse.
 */
export function nonCollidingSlots(slots: Vec2[], tokenWorld = TOKEN_WORLD): Vec2[] {
  const gap = tokenWorld * COLLIDE_RATIO;
  const kept: Vec2[] = [];
  for (const slot of slots) {
    if (kept.every((k) => Math.hypot(k.x - slot.x, k.y - slot.y) >= gap)) {
      kept.push(slot);
    }
  }
  return kept;
}
