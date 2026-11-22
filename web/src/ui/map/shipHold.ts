// Two seats under every transport and every carrier. Transport seats are land cargo.
// Carrier seats are parked fighters and tactical bombers, plus a plane whose move
// order is landing on that ship. The circles are a view: planes stay region stacks.
import { isAirUnit, parkedAirCount, carrierDecks } from "../../engine/air/air_fuel";
import type { GameState } from "../../engine/model/game_state";
import { normalizeUnitTypeAndFaction } from "../../engine/presentation/region_unit_display";

export const HOLD_SEATS = 2;

export interface HoldMark {
  unitType: string;
  factionId: string;
  /** Set for land cargo. Empty when the seat is a plane. */
  transportId: string;
  /** Ordered onto this ship, still at its origin until the phase ends. Not a drag source. */
  pending: boolean;
}

export interface HoldSubject {
  unit_type_id?: string;
  faction_id?: string;
  count?: number;
  instance_id?: string;
}

export interface HoldCircle {
  x: number;
  y: number;
  r: number;
}

interface AirMove {
  from: string;
  to: string;
  faction: string;
  unitType: string;
  count: number;
}

interface SeatSlot {
  deckKey: string;
  unitType: string;
  factionId: string;
  own: boolean;
}

function countOf(entry: { count?: number }): number {
  return Math.max(0, Math.trunc(Number(entry.count ?? 0)));
}

/** Map tokens use the display faction (`ger` is drawn as `axis`). Seats are keyed the same way. */
function shownKey(unitType: string, faction: string): string {
  const shown = normalizeUnitTypeAndFaction(unitType, faction);
  return `${shown.faction_id}|${shown.unit_type_id}`;
}

/** The faction id stored on the piece, which is what movement and hostility use. */
function rawOwner(state: GameState, regionId: string, entry: HoldSubject): string {
  const instanceId = String(entry.instance_id ?? "");
  const want = shownKey(String(entry.unit_type_id ?? ""), String(entry.faction_id ?? ""));
  for (const unit of state.getUnitsInRegion(regionId)) {
    const id = String(unit.instance_id ?? "");
    if (instanceId !== "") {
      if (id === instanceId) {
        return String(unit.faction_id ?? "");
      }
      continue;
    }
    if (id !== "") {
      continue;
    }
    if (shownKey(String(unit.unit_type_id ?? ""), String(unit.faction_id ?? "")) === want) {
      return String(unit.faction_id ?? "");
    }
  }
  return String(entry.faction_id ?? "");
}

function capacityOf(state: GameState, unitType: string): number {
  return Math.max(0, Math.trunc(Number(state.unit_types[unitType]?.special?.fighter_capacity ?? 0)));
}

function hostsPlane(state: GameState, carrierType: string, planeType: string): boolean {
  if (capacityOf(state, carrierType) <= 0) {
    return false;
  }
  const carrier = state.unit_types[carrierType]?.special ?? {};
  const plane = state.unit_types[planeType]?.special ?? {};
  if (plane.can_land_on_carrier === true) {
    return carrier.can_host_fighters !== false;
  }
  return planeType === "tactical_bomber" && carrier.can_host_tactical_bombers === true;
}

function airMoves(state: GameState): AirMove[] {
  const out: AirMove[] = [];
  for (const order of state.phase_orders) {
    if (order.kind != null && order.kind !== "move") {
      continue;
    }
    if (!isAirUnit(state, order.unitType) || order.count <= 0) {
      continue;
    }
    out.push({
      from: order.fromRegionId,
      to: order.toRegionId,
      faction: order.faction,
      unitType: order.unitType,
      count: order.count,
    });
  }
  return out;
}

function leavingCount(moves: readonly AirMove[], regionId: string, faction: string, unitType: string): number {
  let total = 0;
  for (const move of moves) {
    if (move.from === regionId && move.faction === faction && move.unitType === unitType) {
      total += move.count;
    }
  }
  return total;
}

function carrierLeaving(state: GameState, regionId: string, faction: string, unitType: string): number {
  let total = 0;
  for (const order of state.phase_orders) {
    if (order.kind != null && order.kind !== "move") {
      continue;
    }
    if (order.fromRegionId === regionId && order.faction === faction && order.unitType === unitType) {
      total += Math.max(0, order.count);
    }
  }
  return total;
}

/** A same-team carrier is in this sea, or one is on its way, and it can hold this plane. */
export function seaWillHold(state: GameState, seaId: string, faction: string, planeType: string): boolean {
  const region = state.regions[seaId];
  if (region == null || !region.isSeaRegion() || !hostsAny(state, planeType)) {
    return false;
  }
  let seats = 0;
  for (const entry of state.getUnitsInRegion(seaId)) {
    const carrierType = String(entry.unit_type_id ?? "");
    const owner = String(entry.faction_id ?? "");
    if (!state.sameTeam(owner, faction) || !hostsPlane(state, carrierType, planeType)) {
      continue;
    }
    const staying = countOf(entry) - carrierLeaving(state, seaId, owner, carrierType);
    if (staying > 0) {
      seats += staying * capacityOf(state, carrierType);
    }
  }
  for (const order of state.phase_orders) {
    if (order.kind != null && order.kind !== "move") {
      continue;
    }
    if (order.toRegionId !== seaId || !state.sameTeam(order.faction, faction)) {
      continue;
    }
    if (!hostsPlane(state, order.unitType, planeType)) {
      continue;
    }
    seats += Math.max(0, order.count) * capacityOf(state, order.unitType);
  }
  return seats > 0;
}

function hostsAny(state: GameState, planeType: string): boolean {
  const plane = state.unit_types[planeType]?.special ?? {};
  return plane.can_land_on_carrier === true || planeType === "tactical_bomber";
}

function deckStay(state: GameState, regionId: string): Map<string, HoldMark[]> {
  const moves = airMoves(state);
  const leaving = new Map<string, number>();
  for (const move of moves) {
    if (move.from !== regionId) {
      continue;
    }
    const key = `${move.faction}|${move.unitType}`;
    leaving.set(key, (leaving.get(key) ?? 0) + move.count);
  }
  const slots: SeatSlot[] = [];
  for (const deck of carrierDecks(state, regionId)) {
    const deckKey = shownKey(deck.carrierUnitType, deck.carrierFactionId);
    for (const plane of deck.parked) {
      for (let i = 0; i < plane.count; i++) {
        slots.push({
          deckKey,
          unitType: plane.unitType,
          factionId: plane.factionId,
          own: plane.factionId === deck.carrierFactionId,
        });
      }
    }
  }
  const byPlane = new Map<string, SeatSlot[]>();
  for (const slot of slots) {
    const key = `${slot.factionId}|${slot.unitType}`;
    const list = byPlane.get(key) ?? [];
    list.push(slot);
    byPlane.set(key, list);
  }
  const removed = new Set<SeatSlot>();
  for (const [key, list] of byPlane) {
    let left = leaving.get(key) ?? 0;
    const ordered = list.slice().sort((a, b) => Number(b.own) - Number(a.own));
    for (const slot of ordered) {
      if (left <= 0) {
        break;
      }
      removed.add(slot);
      left -= 1;
    }
  }
  const stay = new Map<string, HoldMark[]>();
  for (const slot of slots) {
    if (removed.has(slot)) {
      continue;
    }
    const marks = stay.get(slot.deckKey) ?? [];
    marks.push({ unitType: slot.unitType, factionId: slot.factionId, transportId: "", pending: false });
    stay.set(slot.deckKey, marks);
  }
  return stay;
}

function primaryCarrierKey(state: GameState, regionId: string): string | null {
  const keys: string[] = [];
  for (const entry of state.getUnitsInRegion(regionId)) {
    const unitType = String(entry.unit_type_id ?? "");
    const faction = String(entry.faction_id ?? "");
    if (capacityOf(state, unitType) <= 0) {
      continue;
    }
    if (countOf(entry) - carrierLeaving(state, regionId, faction, unitType) <= 0) {
      continue;
    }
    keys.push(shownKey(unitType, faction));
  }
  keys.sort();
  return keys[0] ?? null;
}

/** Planes ordered into this sea that will be sitting on a carrier when the phase ends. */
export function incomingPlanes(state: GameState, regionId: string): { unitType: string; factionId: string; count: number }[] {
  const grouped = new Map<string, { unitType: string; factionId: string; count: number }>();
  for (const move of airMoves(state)) {
    if (move.to !== regionId || move.from === regionId || !seaWillHold(state, regionId, move.faction, move.unitType)) {
      continue;
    }
    const key = `${move.faction}|${move.unitType}`;
    const row = grouped.get(key);
    if (row) {
      row.count += move.count;
    } else {
      grouped.set(key, { unitType: move.unitType, factionId: move.faction, count: move.count });
    }
  }
  return [...grouped.values()];
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

/**
 * The seats drawn on this token. `null` when the token is not a transport or a carrier.
 * An empty array is a ship with both circles open. At most two marks are returned.
 */
export function holdMarks(state: GameState, regionId: string, entry: HoldSubject): HoldMark[] | null {
  const unitType = String(entry.unit_type_id ?? "");
  const faction = String(entry.faction_id ?? "");
  const instanceId = String(entry.instance_id ?? "");
  if (unitType === "transport") {
    if (instanceId === "" || state.transport_instances[instanceId] == null) {
      return null;
    }
    return cargoMarks(state, instanceId, rawOwner(state, regionId, entry));
  }
  if (capacityOf(state, unitType) <= 0) {
    return null;
  }
  const key = shownKey(unitType, faction);
  const stay = (deckStay(state, regionId).get(key) ?? []).slice(0, HOLD_SEATS);
  if (stay.length >= HOLD_SEATS || primaryCarrierKey(state, regionId) !== key) {
    return stay;
  }
  const pending: HoldMark[] = [];
  for (const plane of incomingPlanes(state, regionId)) {
    for (let i = 0; i < plane.count && stay.length + pending.length < HOLD_SEATS; i++) {
      pending.push({ unitType: plane.unitType, factionId: plane.factionId, transportId: "", pending: true });
    }
  }
  return [...stay, ...pending];
}

/**
 * Map stacks with parked aircraft hidden, a launching plane put back, and a plane
 * ordered onto a carrier taken off its origin so it is not drawn twice.
 */
export function presentRegionUnits<T extends HoldSubject>(state: GameState, regionId: string, units: readonly T[]): T[] {
  const moves = airMoves(state);
  const out: T[] = [];
  for (const entry of units) {
    const unitType = String(entry.unit_type_id ?? "");
    const faction = String(entry.faction_id ?? "");
    if (entry.instance_id || !isAirUnit(state, unitType)) {
      out.push(entry);
      continue;
    }
    const actual = countOf(entry);
    const parked = parkedAirCount(state, regionId, faction, unitType);
    const leaving = leavingCount(moves, regionId, faction, unitType);
    const parkedStay = Math.max(0, parked - leaving);
    const shown = Math.max(0, actual - parkedStay);
    let embarking = 0;
    for (const move of moves) {
      if (move.from !== regionId || move.faction !== faction || move.unitType !== unitType) {
        continue;
      }
      if (seaWillHold(state, move.to, faction, unitType)) {
        embarking += move.count;
      }
    }
    const visible = Math.max(0, shown - Math.min(shown, embarking));
    if (visible <= 0) {
      continue;
    }
    if (visible === actual) {
      out.push(entry);
      continue;
    }
    out.push({ ...entry, count: visible });
  }
  return out;
}

/** Two circles underneath a token. `d` is the token diameter. Upright figures sit the pair clear of the keel. */
export function holdCircleCenters(x: number, y: number, d: number, upright: boolean): [HoldCircle, HoldCircle] {
  const r = upright ? 6.5 : Math.max(3.5, d * 0.9 * 0.16);
  const cy = upright ? y + 24 : y + d * 0.9 * 0.5 + r + 3;
  const dx = upright ? 16 : Math.max(r * 2.35, d * 0.24);
  return [
    { x: x - dx, y: cy, r },
    { x: x + dx, y: cy, r },
  ];
}
