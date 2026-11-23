// Two seats under a transport. Cargo stays on transport_instances. A circle is one
// land unit being moved off that ship. Carriers are not drawn here.
import type { GameState } from "../../engine/model/game_state";
import type { StackEntry } from "./geometry";
import { MILITARY } from "../theme/militaryPalette";

export const HOLD_SEATS = 2;

export interface HoldMark {
  unitType: string;
  factionId: string;
  transportId: string;
  pending: boolean;
}

export interface HoldCircle {
  x: number;
  y: number;
  r: number;
}

export interface HoldSubject {
  unit_type_id?: string;
  instance_id?: string;
  faction_id?: string;
}

export interface HoldShip {
  regionId: string;
  entry: StackEntry;
  x: number;
  y: number;
  /** Token size the circles sit under, in screen pixels. */
  d: number;
  upright: boolean;
  marks: HoldMark[] | null;
}

function rawOwner(state: GameState, regionId: string, entry: HoldSubject): string {
  const instanceId = String(entry.instance_id ?? "");
  if (instanceId !== "") {
    for (const unit of state.region_units[regionId] ?? []) {
      if (String(unit.instance_id ?? "") === instanceId) {
        return String(unit.faction_id ?? "");
      }
    }
  }
  return String(entry.faction_id ?? "");
}

function cargoMarks(state: GameState, instanceId: string, faction: string): HoldMark[] {
  const marks: HoldMark[] = [];
  for (const line of state.transport_instances[instanceId]?.cargo ?? []) {
    const unitType = String(line.unit_type_id ?? "");
    const n = Math.max(0, Math.trunc(Number(line.count ?? 0)));
    for (let i = 0; i < n && marks.length < HOLD_SEATS; i++) {
      marks.push({ unitType, factionId: faction, transportId: instanceId, pending: false });
    }
  }
  return marks;
}

/** Cargo seats for a transport. No instance draws nothing. Carriers are left to their own branch. */
export function holdMarks(state: GameState, regionId: string, entry: HoldSubject): HoldMark[] | null {
  const unitType = String(entry.unit_type_id ?? "");
  const instanceId = String(entry.instance_id ?? "");
  if (unitType === "transport") {
    if (instanceId === "" || state.transport_instances[instanceId] == null) {
      return null;
    }
    return cargoMarks(state, instanceId, rawOwner(state, regionId, entry));
  }
  return null;
}

/** One inspector card per cargo type aboard each transport in this sea. */
export function cargoStacks(state: GameState, regionId: string): StackEntry[] {
  const region = state.regions[regionId];
  if (region == null || !region.isSeaRegion()) {
    return [];
  }
  const cards: StackEntry[] = [];
  for (const entry of state.region_units[regionId] ?? []) {
    if (String(entry.unit_type_id ?? "") !== "transport") {
      continue;
    }
    const transportId = String(entry.instance_id ?? "");
    const row = state.transport_instances[transportId];
    if (transportId === "" || row == null) {
      continue;
    }
    const owner = rawOwner(state, regionId, entry);
    const counts = new Map<string, number>();
    for (const line of row.cargo ?? []) {
      const unitType = String(line.unit_type_id ?? "");
      const n = Math.max(0, Math.trunc(Number(line.count ?? 0)));
      if (unitType === "" || n <= 0) {
        continue;
      }
      counts.set(unitType, (counts.get(unitType) ?? 0) + n);
    }
    for (const [unitType, count] of counts) {
      cards.push({ unit_type_id: unitType, faction_id: owner, count, cargoOf: transportId });
    }
  }
  return cards;
}

/** Circle centres, shared by drawing and hit testing. */
export function holdCircleCenters(x: number, y: number, d: number, upright: boolean): [HoldCircle, HoldCircle] {
  const r = upright ? 6.5 : Math.max(3.5, d * 0.9 * 0.16);
  const cy = upright ? y + 24 : y + d * 0.9 * 0.5 + r + 3;
  const dx = upright ? 16 : Math.max(r * 2.35, d * 0.24);
  return [
    { x: x - dx, y: cy, r },
    { x: x + dx, y: cy, r },
  ];
}

/** `holds` null draws nothing. 0 draws two empty rings. Filled seats are the indexes below `holds`. */
export function drawHoldCircles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  d: number,
  upright: boolean,
  holds: number | null,
): void {
  if (holds == null) {
    return;
  }
  const circles = holdCircleCenters(x, y, d, upright);
  ctx.save();
  ctx.lineWidth = 1.5;
  circles.forEach((circle, index) => {
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    if (index < holds) {
      ctx.fillStyle = MILITARY.brass;
      ctx.fill();
    }
    ctx.strokeStyle = MILITARY.cream;
    ctx.stroke();
  });
  ctx.restore();
}

export function seatStack(mark: HoldMark): StackEntry {
  return {
    unit_type_id: mark.unitType,
    faction_id: mark.factionId,
    count: 1,
    cargoOf: mark.transportId || undefined,
  };
}

/** Front-most ship wins. An empty circle is a hit with `mark` null. */
export function pickHold(ships: readonly HoldShip[], px: number, py: number): { ship: HoldShip; mark: HoldMark | null } | null {
  const hits: { ship: HoldShip; mark: HoldMark | null; y: number }[] = [];
  for (const ship of ships) {
    if (ship.marks == null) {
      continue;
    }
    const circles = holdCircleCenters(ship.x, ship.y, ship.d, ship.upright);
    circles.forEach((circle, index) => {
      if (Math.hypot(px - circle.x, py - circle.y) <= circle.r + 3) {
        hits.push({ ship, mark: ship.marks?.[index] ?? null, y: ship.y });
      }
    });
  }
  if (hits.length === 0) {
    return null;
  }
  hits.sort((a, b) => b.y - a.y);
  return { ship: hits[0].ship, mark: hits[0].mark };
}
