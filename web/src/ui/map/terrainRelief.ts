// Coast relief, hostile frontlines, and battle scars. Pure data: the canvas only paints it.
// Frontline segments are cached until ownership or the region outlines change.
import type { GameState } from "../../engine/model/game_state";
import type { Vec2 } from "./geometry";
import { RegionUnitDisplay } from "../../engine/presentation/region_unit_display";
import { isSeamEdge, type Seam } from "./mapBakeMath";

export interface ReliefRegion {
  id: string;
  isSea: boolean;
  rings: Vec2[][];
}

export interface FrontlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** How many craters and smoke columns a fight leaves, by the units attacking: 1 for a lone attacker, 2 from 8, 3 from 15, 4 from 20. */
export function craterCountFor(attackers: number): number {
  return attackers >= 20 ? 4 : attackers >= 15 ? 3 : attackers >= 8 ? 2 : 1;
}

export interface ScarTarget {
  regionId: string;
  /** Ember at the plume base during combat move and combat. */
  ember: boolean;
  /** The units attacking the territory: the more, the more craters and smoke (see craterCountFor). */
  attackers: number;
}

export interface CraterMark {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rim: string;
  pit: string;
}

export interface SmokeCluster {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface EmberSpark {
  x: number;
  y: number;
  color: string;
}

export interface ScarFrame {
  craters: CraterMark[];
  smoke: SmokeCluster[];
  ember: EmberSpark | null;
}

export const CRATER_RIM = "#645355";
export const CRATER_PIT = "#4B3D44";
export const SMOKE_SOOT = "#4B3D44";
export const SMOKE_ASH = "#8C7C79";
export const EMBER = "#B97A60";
/** Stepped smoke clock. Four frames, about 4.5 per second. */
export const SMOKE_FRAME_MS = 220;
/** Craters stay this far from the IPC anchor and from unit slots, in world units. */
export const SCAR_CLEARANCE = 12;

const KEY_EPS = 1e-3;
const SMOKE_MID = "#645355";
const DRIFT: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, -1],
  [0, -2],
  [-1, -1],
];

export function smokeFrame(nowMs: number): number {
  return Math.floor(nowMs / SMOKE_FRAME_MS) % 4;
}

export function reliefRegions(
  regions: { id: string; type: "land" | "sea"; points: Vec2[]; extra?: Vec2[][] }[],
): ReliefRegion[] {
  return regions.map((region) => ({
    id: region.id,
    isSea: region.type === "sea",
    rings: [region.points, ...(region.extra ?? [])],
  }));
}

function warTeam(state: GameState, owner: string): string | null {
  if (owner === "" || owner === "neutral") {
    return null;
  }
  const team = state.teamOf(owner);
  if (team === "" || team === "neutral") {
    return null;
  }
  return team;
}

const q = (v: number) => Math.round(v / KEY_EPS);

function edgeKey(a: Vec2, b: Vec2): string {
  const ka = `${q(a.x)},${q(a.y)}`;
  const kb = `${q(b.x)},${q(b.y)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function openRing(ring: Vec2[]): Vec2[] {
  const n = ring.length;
  if (n > 1 && ring[0].x === ring[n - 1].x && ring[0].y === ring[n - 1].y) {
    return ring.slice(0, n - 1);
  }
  return ring;
}

function normalSegment(a: Vec2, b: Vec2): FrontlineSegment {
  const swap = a.x > b.x || (a.x === b.x && a.y > b.y);
  const p = swap ? b : a;
  const q = swap ? a : b;
  return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
}

let frontlineKey = "";
let frontlineCache: FrontlineSegment[] = [];

function stampRegions(regions: ReliefRegion[], state: GameState, seam: Seam | null): string {
  let key = seam ? `${seam.left},${seam.right}|` : "|";
  for (const region of regions) {
    key += `${region.id}:${region.isSea ? "s" : "l"}:${state.getRegionOwner(region.id)}:`;
    for (const ring of region.rings) {
      for (const point of ring) {
        key += `${point.x},${point.y};`;
      }
      key += "/";
    }
    key += "|";
  }
  return key;
}

/**
 * Shared border edges between land regions owned by opposing teams.
 * Sea borders, friendly borders, and unowned or neutral borders are left out.
 * The result is cached until ownership or the outlines change.
 */
export function extractHostileFrontlineSegments(
  regions: ReliefRegion[],
  state: GameState,
  seam: Seam | null = null,
): FrontlineSegment[] {
  const key = stampRegions(regions, state, seam);
  if (key === frontlineKey) {
    return frontlineCache;
  }
  const seen = new Map<string, { seg: FrontlineSegment; teams: string[] }>();
  for (const region of regions) {
    if (region.isSea) {
      continue;
    }
    const team = warTeam(state, state.getRegionOwner(region.id));
    if (team === null) {
      continue;
    }
    const mine = new Set<string>();
    for (const ring of region.rings) {
      const pts = openRing(ring);
      const n = pts.length;
      for (let i = 0; i < n && n > 1; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (a.x === b.x && a.y === b.y) {
          continue;
        }
        if (seam && isSeamEdge([a.x, a.y], [b.x, b.y], seam)) {
          continue;
        }
        const edge = edgeKey(a, b);
        if (mine.has(edge)) {
          continue;
        }
        mine.add(edge);
        const hit = seen.get(edge);
        if (hit) {
          if (!hit.teams.includes(team)) {
            hit.teams.push(team);
          }
        } else {
          seen.set(edge, { seg: normalSegment(a, b), teams: [team] });
        }
      }
    }
  }
  const out: FrontlineSegment[] = [];
  for (const { seg, teams } of seen.values()) {
    if (teams.length >= 2) {
      out.push(seg);
    }
  }
  out.sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1 || a.x2 - b.x2 || a.y2 - b.y2);
  frontlineKey = key;
  frontlineCache = out;
  return out;
}

const ATTACK_PHASES = new Set(["combat_move", "combat"]);

/** Land fought or about to be fought this round: incoming combat moves, the active battle, and resolved battles. */
export function scarTargets(state: GameState): ScarTarget[] {
  const ids = new Set<string>();
  const emberPhase = ATTACK_PHASES.has(state.current_phase);
  if (emberPhase) {
    for (const order of state.phase_orders) {
      if (state.isRegionLand(order.toRegionId) && state.isRegionHostileTo(order.toRegionId, order.faction)) {
        ids.add(order.toRegionId);
      }
    }
  }
  const active = state.active_battle?.region_id ?? "";
  if (active !== "" && state.isRegionLand(active)) {
    ids.add(active);
  }
  for (const regionId of Object.keys(state.territories_fought_this_round)) {
    if (state.territories_fought_this_round[regionId] && state.isRegionLand(regionId)) {
      ids.add(regionId);
    }
  }
  // The units sent in: the orders on their way, or, once they have arrived, the pool that is fighting.
  const sent = new Map<string, number>();
  for (const order of state.phase_orders) {
    sent.set(order.toRegionId, (sent.get(order.toRegionId) ?? 0) + Math.max(0, order.count));
  }
  return [...ids].sort().map((regionId) => ({
    regionId,
    ember: emberPhase,
    attackers: Math.max(sent.get(regionId) ?? 0, RegionUnitDisplay.combatPoolUnitCount(state, regionId, state.current_faction_id)),
  }));
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clearOf(x: number, y: number, avoid: readonly Vec2[]): boolean {
  for (const point of avoid) {
    const dx = point.x - x;
    const dy = point.y - y;
    if (dx * dx + dy * dy < SCAR_CLEARANCE * SCAR_CLEARANCE) {
      return false;
    }
  }
  return true;
}

function placeCraters(regionId: string, anchor: Vec2, avoid: readonly Vec2[], inside?: (p: Vec2) => boolean, wanted?: number): CraterMark[] {
  const within = (x: number, y: number) => inside === undefined || inside({ x, y });
  const rand = mulberry32(hashId(regionId));
  const count = wanted ?? 2 + (hashId(regionId) % 2);
  const marks: CraterMark[] = [];
  for (let i = 0; i < count; i++) {
    let x = anchor.x + 16;
    let y = anchor.y + 14;
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = rand() * Math.PI * 2;
      const dist = SCAR_CLEARANCE + 4 + rand() * 18 + attempt;
      x = anchor.x + Math.cos(angle) * dist;
      y = anchor.y + Math.sin(angle) * dist;
      if (within(x, y) && clearOf(x, y, avoid) && marks.every((mark) => clearOf(x, y, [mark]))) {
        break;
      }
    }
    if (!within(x, y) || !clearOf(x, y, avoid) || !marks.every((mark) => clearOf(x, y, [mark]))) {
      for (let step = 1; step <= 8; step++) {
        const fx = anchor.x + SCAR_CLEARANCE + 6 + step * 6;
        const fy = anchor.y + (i % 2 === 0 ? 1 : -1) * (SCAR_CLEARANCE + 4 + step * 4);
        if (within(fx, fy) && clearOf(fx, fy, avoid) && marks.every((mark) => clearOf(fx, fy, [mark]))) {
          x = fx;
          y = fy;
          break;
        }
      }
    }
    // A territory too small or too narrow for the usual reach: search every direction at growing distance for ground inside it.
    if (!within(x, y)) {
      search: for (let dist = 4; dist <= 40; dist += 3) {
        for (let a = 0; a < 16; a++) {
          const sx = anchor.x + Math.cos((a / 16) * Math.PI * 2 + i) * dist;
          const sy = anchor.y + Math.sin((a / 16) * Math.PI * 2 + i) * dist;
          if (within(sx, sy) && marks.every((mark) => clearOf(sx, sy, [mark]))) {
            x = sx;
            y = sy;
            break search;
          }
        }
      }
    }
    const rx = 3.5 + rand() * 2.5;
    const ry = rx * (0.62 + rand() * 0.2);
    marks.push({
      x: Math.round(x * 2) / 2,
      y: Math.round(y * 2) / 2,
      rx: Math.round(rx * 2) / 2,
      ry: Math.round(ry * 2) / 2,
      rim: CRATER_RIM,
      pit: CRATER_PIT,
    });
  }
  return marks;
}

function smokeColumn(crater: CraterMark, frame: number, ember: boolean): { smoke: SmokeCluster[]; ember: EmberSpark | null } {
  const count = 3 + (hashId(`${crater.x},${crater.y}`) % 2);
  const smoke: SmokeCluster[] = [];
  for (let i = 0; i < count; i++) {
    const [dx, dy] = DRIFT[(frame + i) % 4];
    const color = i === 0 ? SMOKE_SOOT : i === count - 1 ? SMOKE_ASH : SMOKE_MID;
    smoke.push({
      x: Math.round(crater.x - 1 + dx),
      y: Math.round(crater.y - 5 - i * 3 + dy),
      w: i === count - 1 ? 2 : 3,
      h: 2,
      color,
    });
  }
  const spark = ember
    ? { x: Math.round(crater.x), y: Math.round(crater.y - 2), color: EMBER }
    : null;
  return { smoke, ember: spark };
}

/**
 * Four smoke frames for one territory. Craters stay put. Smoke steps between frames.
 * `avoid` is the IPC anchor and the unit slots, in world units.
 */
export function battleScarDescriptors(
  regionId: string,
  anchor: Vec2,
  avoid: readonly Vec2[],
  ember: boolean,
  /** Whether a world point is on the territory being fought over: craters are laid only there. */
  inside?: (p: Vec2) => boolean,
  /** How many craters to lay (see craterCountFor). Absent, two or three. */
  wanted?: number,
): ScarFrame[] {
  const craters = placeCraters(regionId, anchor, avoid, inside, wanted);
  const main = craters[0];
  return [0, 1, 2, 3].map((frame) => {
    const column = smokeColumn(main, frame, ember);
    return { craters, smoke: column.smoke, ember: column.ember };
  });
}
