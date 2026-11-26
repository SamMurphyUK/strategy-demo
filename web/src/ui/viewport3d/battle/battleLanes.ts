// Depth lanes of the battle stage. Pure: no Three.js and no combat rules. The stage is a slice 18 units wide and 10 deep.
// x runs from the attacker's edge (-9) to the defender's (+9). `d` is depth as a fraction: 0 at the front lip, 1 at the horizon.
//
//   frontline   infantry, mechanized, tanks     d about 0.30   full size
//   rear        artillery, AA                   d about 0.60   scaled back (battleDepthScale), drawn out of colour, mist-tinted
//   air         fighters, bombers               banking overhead, with a shadow on the ground
import type { BattleVisualConfig } from "../skins/battleVisualConfig";

export const STAGE_WIDTH = 18;
export const STAGE_DEPTH = 10;
export const STAGE_HALF = STAGE_WIDTH / 2;

export type Lane = "front" | "rear" | "air";
export type Side = "attacker" | "defender";

const FRONT_TYPES = new Set(["infantry", "mech_infantry", "tank", "armor"]);
const REAR_TYPES = new Set(["artillery", "aaa", "aa"]);
const AIR_TYPES = new Set(["fighter", "tactical_bomber", "strategic_bomber"]);

/** The lane a unit type stands in. Anything unknown, ships included, is held in the frontline. */
export function laneOf(type: string): Lane {
  if (REAR_TYPES.has(type)) {
    return "rear";
  }
  if (AIR_TYPES.has(type)) {
    return "air";
  }
  return FRONT_TYPES.has(type) ? "front" : "front";
}

/** Scale of a lane against the front. The rear lane is the slider; the airspace follows it half way, since height is its own depth cue. */
export function depthScale(lane: Lane, config: Pick<BattleVisualConfig, "battleDepthScale">): number {
  const s = Math.min(1, Math.max(0.6, config.battleDepthScale));
  if (lane === "front") {
    return 1;
  }
  return lane === "rear" ? s : 1 - (1 - s) * 0.5;
}

/** Share of a lane's colour drawn out of it. 0 in the front. */
export function depthDesat(lane: Lane, config: Pick<BattleVisualConfig, "battleDepthDesat">): number {
  const d = Math.min(1, Math.max(0, config.battleDepthDesat));
  return lane === "front" ? 0 : lane === "rear" ? d : d * 0.5;
}

/** Share of valley mist over a lane. The front is clear. */
export function depthMist(lane: Lane, config: Pick<BattleVisualConfig, "battleValleyMist">): number {
  const m = Math.min(1, Math.max(0, config.battleValleyMist));
  return lane === "front" ? 0 : lane === "rear" ? 0.4 * m : 0.18 * m;
}

/** Desaturates a colour by `amount`, toward its luma. Pure; the sprite shader does the same sum. */
export function desaturate(rgb: readonly [number, number, number], amount: number): [number, number, number] {
  const l = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
  return [rgb[0] + (l - rgb[0]) * amount, rgb[1] + (l - rgb[1]) * amount, rgb[2] + (l - rgb[2]) * amount];
}

/** The lane's mid depth and the rows it spreads over. */
const LANE_D: Record<Exclude<Lane, "air">, { d: number; spread: number }> = {
  front: { d: 0.3, spread: 0.1 },
  rear: { d: 0.6, spread: 0.07 },
};

/** Where the first column of a lane stands from the centre, and the gap between columns. */
const LANE_X: Record<Exclude<Lane, "air">, { from: number; gap: number }> = {
  front: { from: 1.9, gap: 1.12 },
  rear: { from: 3.4, gap: 1.3 },
};

const ROWS = 3;

export interface LaneUnit {
  uid: string;
  type: string;
  side: Side;
}

export interface LaneSlot {
  uid: string;
  lane: Lane;
  side: Side;
  /** Position on the stage: x in units, d as the depth fraction, and the height above the ground. */
  x: number;
  d: number;
  y: number;
  /** +1 faces right (the attacker), -1 faces left (the defender). */
  facing: 1 | -1;
}

/** Position on the stage of the Nth member of a ground lane. Column-major, three rows deep, outward from the line. */
export function groundSlot(lane: Exclude<Lane, "air">, side: Side, index: number): { x: number; d: number } {
  const row = index % ROWS;
  const col = Math.floor(index / ROWS);
  const { from, gap } = LANE_X[lane];
  const { d, spread } = LANE_D[lane];
  // The rows stagger: the middle row stands a half gap further out, so the ranks do not form a grid.
  const stagger = row === 1 ? gap * 0.5 : 0;
  const dist = from + col * gap + stagger;
  const x = side === "attacker" ? -dist : dist;
  return { x, d: d + (row - 1) * spread };
}

/** A stable order for a lane: by type, then uid, so a unit keeps its place while others fall. */
function ordered(units: readonly LaneUnit[]): LaneUnit[] {
  return [...units].sort((a, b) => (a.type === b.type ? (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) : a.type < b.type ? -1 : 1));
}

/** Where the airspace's Nth aircraft of a side starts, as a phase round its loop, and its altitude. */
export function airHome(side: Side, index: number, count: number): { phase: number; altitude: number; cx: number } {
  const sign = side === "attacker" ? -1 : 1;
  return { phase: (index / Math.max(1, count)) * Math.PI * 2, altitude: 3.6 + (index % 3) * 0.55, cx: sign * 3.6 };
}

/** The Nth aircraft of a side on its banking loop at `seconds`: position, altitude, heading as a bank and a yaw. Pure. */
export function airPose(side: Side, index: number, count: number, seconds: number): { x: number; d: number; y: number; bank: number; facing: 1 | -1 } {
  const home = airHome(side, index, count);
  const w = 0.42 + (index % 3) * 0.04;
  const a = home.phase + seconds * w;
  const x = home.cx + Math.sin(a) * 3.2;
  const d = 0.52 + Math.cos(a * 0.9 + home.phase) * 0.16;
  const y = home.altitude + Math.sin(a * 1.3) * 0.18;
  // The aircraft banks into the turn: the lateral acceleration is the derivative of the heading.
  const vx = Math.cos(a) * w;
  return { x, d, y, bank: -Math.sin(a) * 0.38, facing: vx >= 0 ? 1 : -1 };
}

/** The whole layout: one slot per unit, in the lanes the unit types decide. Aircraft get their loop's start. */
export function layoutLanes(units: readonly LaneUnit[]): LaneSlot[] {
  const slots: LaneSlot[] = [];
  for (const side of ["attacker", "defender"] as const) {
    const mine = units.filter((u) => u.side === side);
    for (const lane of ["front", "rear"] as const) {
      ordered(mine.filter((u) => laneOf(u.type) === lane)).forEach((u, i) => {
        const p = groundSlot(lane, side, i);
        slots.push({ uid: u.uid, lane, side, x: p.x, d: p.d, y: 0, facing: side === "attacker" ? 1 : -1 });
      });
    }
    const air = ordered(mine.filter((u) => laneOf(u.type) === "air"));
    air.forEach((u, i) => {
      const p = airPose(side, i, air.length, 0);
      slots.push({ uid: u.uid, lane: "air", side, x: p.x, d: p.d, y: p.y, facing: side === "attacker" ? 1 : -1 });
    });
  }
  return slots;
}

/** Stage coordinates to world coordinates: x across, y up, z toward the camera (the front lip is +z). */
export function toWorld(x: number, d: number, y = 0): [number, number, number] {
  return [x, y, (0.5 - d) * STAGE_DEPTH];
}

/** The ground point a high unit's shadow falls on, from the sun's direction (toward the sun, y up). Pure. */
export function groundShadow(x: number, d: number, y: number, sunDir: readonly [number, number, number]): { x: number; d: number } {
  const k = y / Math.max(0.2, sunDir[1]);
  // The shadow lies away from the sun, in world z, so in d it moves the opposite way.
  return { x: x - sunDir[0] * k, d: d + (sunDir[2] * k) / STAGE_DEPTH };
}
