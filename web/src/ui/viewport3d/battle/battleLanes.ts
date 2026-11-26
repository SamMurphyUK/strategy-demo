// Depth lanes of the battle stage. Pure: no Three.js and no combat rules. The stage is a slice 18 units wide and 10 deep.
// x runs from the attacker's edge (-9) to the defender's (+9). `d` is depth as a fraction: 0 at the front lip, 1 at the horizon.
//
//   frontline   infantry, mechanized, tanks     d about 0.30   full size
//   rear        artillery, AA                   d about 0.60   scaled back (battleDepthScale), drawn out of colour, mist-tinted
//   air         fighters, bombers               banking overhead, with a shadow on the ground
import { battleLook, type BattleLook, type BattleVisualConfig } from "../skins/battleVisualConfig";
import { rankColumnX } from "./battleZones";

export const STAGE_WIDTH = 18;
export const STAGE_DEPTH = 24;
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

// The layout keeps the original 2D battle's model (App.tsx getUnitScreenPos, rules.ts resolveRanks): the columns are the four hit ranks.
// The attacker stands on the left with colIndex = 4 - rank (rank 4 outermost), the defender on the right mirrored with colIndex = rank - 1.
// Columns are 105 px apart on a 1280 px board, which is 1.477 stage units; units of one rank stack as rows. Depth scale and desaturation
// are applied on top by lane (see depthScale) and never change who stands where.
/** Spacing of the rank columns, from the live look: they step outward from the trench line (see battleZones.ts). */
export const COLUMN_GAP = 1.45;
const ROW_GAP = 0.1;
const ROW_D0 = 0.17;
const DEFAULT_RANK: Record<string, number> = { infantry: 1, mech_infantry: 1, aa: 1, aaa: 1, artillery: 2, tank: 3, armor: 3, fighter: 3, tactical_bomber: 3, strategic_bomber: 4 };

export interface LaneUnit {
  uid: string;
  type: string;
  side: Side;
  /** The engine's effective hit rank, 1 to 4. Absent takes the type's usual rank. */
  effectiveRank?: number;
  colIndex?: number;
  rowIndex?: number;
  pairedWithUid?: string;
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
  /** The unit's place among its side's lane, and how many the lane holds. The airspace's loops are spread by them. */
  index: number;
  count: number;
  /** The hit rank the unit fires in. Aircraft keep it for firing order. */
  rank: number;
}

/** The column of a rank: the attacker's rank 4 is outermost, the defender's rank 1 is. */
export function columnOf(side: Side, rank: number): number {
  const r = Math.min(4, Math.max(1, Math.round(rank)));
  return side === "attacker" ? 4 - r : r - 1;
}

/** The rank a column holds, the inverse of `columnOf`. */
export function rankOfColumn(side: Side, col: number): number {
  return side === "attacker" ? 4 - col : col + 1;
}

type Pos = BattleLook["pos"];

/** x of a column's centre at depth fraction d, stepping outward from the trench line. */
export function columnX(side: Side, col: number, d = 0.3, pos: Pos = battleLook.pos): number {
  const y = (d - 0.5) * STAGE_DEPTH;
  return rankColumnX(side, rankOfColumn(side, col), y, pos.trench, pos.columnGap, pos.columnOffset);
}

/** Position of a column and row on the stage. Odd rows stand a little further out, so the ranks do not form a grid. */
export function rankSlot(side: Side, col: number, row: number, pos: Pos = battleLook.pos): { x: number; d: number } {
  const out = row % 2 === 1 ? 0.2 : 0;
  // A small stagger in depth between neighbouring columns, so the rows do not read as a grid.
  const d = Math.min(0.68, ROW_D0 + row * ROW_GAP + (col % 2) * 0.035);
  const x = columnX(side, col, d, pos);
  return { x: side === "attacker" ? x - out : x + out, d };
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

/** A stable order: by uid, so a unit keeps its place while others fall. */
function ordered(units: readonly LaneUnit[]): LaneUnit[] {
  return [...units].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/**
 * The whole layout, driven by the engine's ranks, columns and rows. Ground units stand in their rank's column and row; an artillery piece
 * paired with an infantry stands beside it, just behind. Aircraft keep their high loops and their rank (for the firing order).
 */
export function layoutLanes(units: readonly LaneUnit[]): LaneSlot[] {
  const slots: LaneSlot[] = [];
  const byUid = new Map<string, LaneSlot>();
  for (const side of ["attacker", "defender"] as const) {
    const mine = ordered(units.filter((u) => u.side === side));
    const counts = new Map<number, number>();
    const ground = mine.filter((u) => laneOf(u.type) !== "air");
    ground.forEach((u, i) => {
      const rank = u.effectiveRank ?? DEFAULT_RANK[u.type] ?? 1;
      const col = u.colIndex ?? columnOf(side, rank);
      const row = u.rowIndex ?? counts.get(col) ?? 0;
      counts.set(col, (counts.get(col) ?? 0) + 1);
      const p = rankSlot(side, col, row);
      const slot: LaneSlot = { uid: u.uid, lane: laneOf(u.type), side, x: p.x, d: p.d, y: 0, facing: side === "attacker" ? 1 : -1, index: i, count: ground.length, rank };
      slots.push(slot);
      byUid.set(u.uid, slot);
    });
    const air = mine.filter((u) => laneOf(u.type) === "air");
    air.forEach((u, i) => {
      const p = airPose(side, i, air.length, 0);
      const rank = u.effectiveRank ?? DEFAULT_RANK[u.type] ?? 3;
      slots.push({ uid: u.uid, lane: "air", side, x: p.x, d: p.d, y: p.y, facing: side === "attacker" ? 1 : -1, index: i, count: air.length, rank });
    });
  }
  // A paired artillery piece stands beside its infantry, a little further back from the line.
  for (const u of units) {
    const slot = byUid.get(u.uid);
    const mate = u.pairedWithUid ? byUid.get(u.pairedWithUid) : undefined;
    if (slot && mate && u.type === "artillery") {
      slot.x = mate.x + (u.side === "attacker" ? -0.62 : 0.62);
      slot.d = mate.d + 0.03;
    }
  }
  return slots;
}

/** Stage coordinates to world coordinates, z up as the board is: x across, y into the scene (the front lip is -y, the horizon +y), z up. */
export function toWorld(x: number, d: number, height = 0): [number, number, number] {
  return [x, (d - 0.5) * STAGE_DEPTH, height];
}

/** The ground point a high unit's shadow falls on, from the sun's direction (toward the sun: x, y into the scene, z up). Pure. */
export function groundShadow(x: number, d: number, height: number, sunDir: readonly [number, number, number]): { x: number; d: number } {
  const k = height / Math.max(0.2, sunDir[2]);
  return { x: x - sunDir[0] * k, d: d - (sunDir[1] * k) / STAGE_DEPTH };
}
