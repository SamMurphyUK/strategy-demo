// Axis & Allies transport cargo: 2 infantry, or 1 infantry and 1 other land unit, or 1 other land unit.
import type { GameState } from "../model/game_state";
import type { CargoLine } from "../model/types";

export const STRANDED_CARGO_MESSAGE =
  "Units embarked during Combat Move must disembark into an invasion or have their embark order cancelled before ending Combat Move.";

export interface StrandedCargo {
  transportInstanceId: string;
  seaZoneId: string;
  cargo: CargoLine[];
}

export interface CargoCommit {
  advance: boolean;
  seaZoneId: string;
  warning: string;
}

export function isInfantryCargo(unitTypeId: string): boolean {
  return unitTypeId === "infantry";
}

/** AA guns, and anything else marked noncombat-only, stay off transports during combat move. */
export function movesOnlyInNoncombat(state: GameState, unitTypeId: string): boolean {
  const special = state.unit_types[unitTypeId]?.special;
  return Boolean(special?.is_aa || special?.noncombat_move_only);
}

export function cargoCount(lines: readonly CargoLine[] | undefined): number {
  let total = 0;
  for (const line of lines ?? []) {
    total += Math.max(0, Math.trunc(Number(line.count ?? 0)));
  }
  return total;
}

/** True when these lines fit in one transport. Non-land ids count as the single "other" slot. */
export function cargoFits(lines: readonly { unit_type_id?: string; count?: number }[]): boolean {
  let infantry = 0;
  let others = 0;
  for (const line of lines) {
    const count = Math.trunc(Number(line.count ?? 0));
    if (count <= 0) {
      continue;
    }
    const id = String(line.unit_type_id ?? "");
    if (isInfantryCargo(id)) {
      infantry += count;
    } else {
      others += count;
    }
  }
  if (others > 1) {
    return false;
  }
  if (others === 1) {
    return infantry <= 1;
  }
  return infantry <= 2;
}

export function transportSeaZone(state: GameState, instanceId: string): string {
  let sea = String(state.transport_instances[instanceId]?.region_id ?? "");
  for (const order of state.phase_orders) {
    const kind = order.kind ?? "move";
    if (kind !== "move") {
      continue;
    }
    if (order.shipInstanceIds?.includes(instanceId)) {
      sea = order.toRegionId;
    }
  }
  return sea;
}

function countsOf(lines: readonly CargoLine[] | undefined): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const line of lines ?? []) {
    const id = String(line.unit_type_id ?? "");
    const count = Math.trunc(Number(line.count ?? 0));
    if (id === "" || count <= 0) {
      continue;
    }
    totals[id] = (totals[id] ?? 0) + count;
  }
  return totals;
}

function excessCargo(current: readonly CargoLine[] | undefined, before: readonly CargoLine[] | undefined): CargoLine[] {
  const now = countsOf(current);
  const then = countsOf(before);
  const extra: CargoLine[] = [];
  for (const id of Object.keys(now)) {
    const count = now[id] - (then[id] ?? 0);
    if (count > 0) {
      extra.push({ unit_type_id: id, count });
    }
  }
  return extra;
}

function transportOwnedBy(state: GameState, instanceId: string, factionId: string): boolean {
  const sea = String(state.transport_instances[instanceId]?.region_id ?? "");
  for (const entry of state.getFactionUnitsInRegion(sea, factionId)) {
    if (String(entry.instance_id ?? "") === instanceId) {
      return true;
    }
  }
  return false;
}

/** Cargo loaded during this combat move that is still aboard. */
export function strandedCombatCargo(state: GameState): StrandedCargo[] {
  if (state.current_phase !== "combat_move") {
    return [];
  }
  const factionId = state.current_faction_id;
  const snapshot = state.phase_start_snapshot;
  const stranded: StrandedCargo[] = [];
  for (const instanceId of Object.keys(state.transport_instances)) {
    if (!transportOwnedBy(state, instanceId, factionId)) {
      continue;
    }
    const before = snapshot?.transport_instances?.[instanceId]?.cargo;
    const extra = excessCargo(state.transport_instances[instanceId]?.cargo, before);
    if (extra.length === 0) {
      continue;
    }
    stranded.push({
      transportInstanceId: instanceId,
      seaZoneId: transportSeaZone(state, instanceId),
      cargo: extra,
    });
  }
  return stranded;
}

export function strandedCargoGate(state: GameState): CargoCommit {
  const stranded = strandedCombatCargo(state);
  if (stranded.length === 0) {
    return { advance: true, seaZoneId: "", warning: "" };
  }
  return { advance: false, seaZoneId: stranded[0].seaZoneId, warning: STRANDED_CARGO_MESSAGE };
}

/** Blocks the phase and tells the caller which sea zone to put under the camera. */
export function combatCargoCommit(state: GameState, focus?: (seaZoneId: string) => void): CargoCommit {
  const gate = strandedCargoGate(state);
  if (!gate.advance) {
    focus?.(gate.seaZoneId);
  }
  return gate;
}

export function seaZoneCargoLabel(state: GameState, regionId: string): string {
  const lines: string[] = [];
  for (const instanceId of Object.keys(state.transport_instances)) {
    const td = state.transport_instances[instanceId];
    if (transportSeaZone(state, instanceId) !== regionId && String(td?.region_id ?? "") !== regionId) {
      continue;
    }
    if (cargoCount(td?.cargo) <= 0) {
      continue;
    }
    lines.push(transportLoadedLabel(state, instanceId));
  }
  return lines.join(" · ");
}

export function transportLoadedLabel(state: GameState, instanceId: string): string {
  const parts: string[] = [];
  for (const line of state.transport_instances[instanceId]?.cargo ?? []) {
    const count = Math.trunc(Number(line.count ?? 0));
    if (count <= 0) {
      continue;
    }
    const raw = state.unit_types[String(line.unit_type_id)]?.name || String(line.unit_type_id);
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    parts.push(`${name} × ${count}`);
  }
  if (parts.length === 0) {
    return "Transport (Cargo: empty)";
  }
  return `Transport (Cargo: ${parts.join(", ")})`;
}

export function unloadError(
  state: GameState,
  factionId: string,
  transportInstanceId: string,
  toRegionId: string,
  units: readonly { unit_type_id?: string; count?: number }[],
): string | null {
  if (!["combat_move", "noncombat_move"].includes(state.current_phase)) {
    return "Not in a movement phase";
  }
  const td = state.transport_instances[transportInstanceId];
  if (td == null || !transportOwnedBy(state, transportInstanceId, factionId)) {
    return "Cannot unload that transport";
  }
  const sea = transportSeaZone(state, transportInstanceId);
  const land = state.regions[toRegionId];
  if (land == null || !land.isLandRegion() || !state.isAdjacent(sea, toRegionId)) {
    return "Unload onto an adjacent coastal territory";
  }
  if (state.current_phase === "noncombat_move" && (state.isRegionHostileTo(sea, factionId) || state.isRegionHostileTo(toRegionId, factionId))) {
    return "The sea zone or the coast is hostile";
  }
  if (state.current_phase === "combat_move" && state.isRegionHostileTo(toRegionId, factionId)) {
    return "Hostile coasts are an amphibious assault";
  }
  const aboard = countsOf(td.cargo);
  for (const line of units) {
    const id = String(line.unit_type_id ?? "");
    const count = Math.trunc(Number(line.count ?? 0));
    if (count <= 0 || (aboard[id] ?? 0) < count) {
      return "Those units are not aboard";
    }
    if (state.current_phase === "combat_move" && movesOnlyInNoncombat(state, id)) {
      return "AA guns cannot move during combat";
    }
    aboard[id] -= count;
  }
  return null;
}

export function assaultError(
  state: GameState,
  factionId: string,
  transportInstanceId: string,
  originSeaZoneId: string,
  targetRegionId: string,
): string | null {
  if (state.current_phase !== "combat_move") {
    return "Amphibious assaults are declared during combat move";
  }
  const td = state.transport_instances[transportInstanceId];
  if (td == null || !transportOwnedBy(state, transportInstanceId, factionId)) {
    return "Cannot assault from that transport";
  }
  const sea = transportSeaZone(state, transportInstanceId);
  if (originSeaZoneId !== sea && originSeaZoneId !== String(td.region_id ?? "")) {
    return "The transport is not in that sea zone";
  }
  const land = state.regions[targetRegionId];
  if (land == null || !land.isLandRegion() || !state.isAdjacent(originSeaZoneId, targetRegionId)) {
    return "Assault an adjacent coastal territory";
  }
  if (!state.isRegionHostileTo(targetRegionId, factionId)) {
    return "Friendly coasts are an unload";
  }
  const cargo = (td.cargo ?? []).filter((line) => !movesOnlyInNoncombat(state, String(line.unit_type_id ?? "")));
  if (cargoCount(cargo) <= 0) {
    return "No cargo can assault";
  }
  return null;
}

/** A sea zone already has a naval battle, or one is still waiting, so its ships cannot bombard. */
export function navalBattleBlocksBombardment(state: GameState, seaZoneId: string, factionId: string): boolean {
  if (state.naval_battles_this_turn[seaZoneId]) {
    return true;
  }
  let friendly = false;
  let enemy = false;
  for (const entry of state.region_units[seaZoneId] ?? []) {
    const type = state.unit_types[entry.unit_type_id];
    if (type?.category !== "sea") {
      continue;
    }
    const mine = String(entry.faction_id ?? "") === factionId || state.sameTeam(String(entry.faction_id ?? ""), factionId);
    if (mine && (type.attack > 0 || type.defense > 0)) {
      friendly = true;
    }
    if (!mine) {
      enemy = true;
    }
  }
  return friendly && enemy;
}
