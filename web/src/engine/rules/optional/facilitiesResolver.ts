import type { GameState } from "../../model/game_state";
import { classifyUnit, type RulesetUnitType } from "../../types/ruleset";

const SEA: ReadonlySet<RulesetUnitType> = new Set([
  "SUBMARINE",
  "DESTROYER",
  "CRUISER",
  "CARRIER",
  "BATTLESHIP",
  "TRANSPORT",
]);
const CAPITAL: ReadonlySet<RulesetUnitType> = new Set(["CARRIER", "BATTLESHIP"]);
const AIR: ReadonlySet<RulesetUnitType> = new Set(["FIGHTER", "TACTICAL_BOMBER", "HEAVY_BOMBER"]);
const SCRAMBLE: ReadonlySet<RulesetUnitType> = new Set(["FIGHTER", "TACTICAL_BOMBER"]);

export function facilitiesActive(state: GameState): boolean {
  return state.rulesetConfig.facilitiesAndPatrols === true;
}

function launchKey(factionId: string, regionId: string, unitTypeId: string): string {
  return `${factionId}|${regionId}|${unitTypeId}`;
}

/** Disabled through `until` inclusive. An unset turn leaves the facility operational. */
function facilityDisabled(until: number, round: number): boolean {
  return until > 0 && until >= round;
}

export function operationalAirbase(state: GameState, regionId: string, factionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null || !region.airbase || !region.isLandRegion()) {
    return false;
  }
  if (region.owner_faction_id === "" || !state.sameTeam(region.owner_faction_id, factionId)) {
    return false;
  }
  return !facilityDisabled(region.airbase_disabled_until, state.game_round);
}

export function operationalHarbor(state: GameState, regionId: string, factionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null || !region.harbor || !region.isLandRegion()) {
    return false;
  }
  if (region.owner_faction_id === "" || !state.sameTeam(region.owner_faction_id, factionId)) {
    return false;
  }
  return !facilityDisabled(region.harbor_disabled_until, state.game_round);
}

/** +1 when this air stack began the turn on an operational airbase. */
export function airRangeBonus(state: GameState, factionId: string, regionId: string, unitTypeId: string): number {
  if (!facilitiesActive(state)) {
    return 0;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind == null || !AIR.has(kind)) {
    return 0;
  }
  const key = launchKey(factionId, regionId, unitTypeId);
  if (state.airbase_launch[key]) {
    return 1;
  }
  const spent = Math.trunc(Number(state.air_movement_spent[key] ?? 0));
  if (spent === 0 && operationalAirbase(state, regionId, factionId)) {
    return 1;
  }
  return 0;
}

/**
 * A plane that began the turn on an operational airbase keeps the extra range
 * after it leaves. Leaving a different airbase later does not grant it.
 */
export function carryAirbaseLaunch(
  state: GameState,
  factionId: string,
  fromRegionId: string,
  toRegionId: string,
  unitTypeId: string,
  sourceEmpty: boolean,
  priorSpent = 0,
): void {
  if (!facilitiesActive(state) || fromRegionId === "" || toRegionId === "" || fromRegionId === toRegionId) {
    return;
  }
  const fromKey = launchKey(factionId, fromRegionId, unitTypeId);
  const toKey = launchKey(factionId, toRegionId, unitTypeId);
  const startedHere =
    state.airbase_launch[fromKey] === true || (priorSpent <= 0 && operationalAirbase(state, fromRegionId, factionId));
  if (startedHere) {
    state.airbase_launch[toKey] = true;
  }
  if (sourceEmpty) {
    delete state.airbase_launch[fromKey];
  }
}

/** +1 when a sea unit starts in a sea zone beside a friendly operational harbor. */
export function navalRangeBonus(state: GameState, factionId: string, seaRegionId: string): number {
  if (!facilitiesActive(state)) {
    return 0;
  }
  const sea = state.regions[seaRegionId];
  if (sea == null || !sea.isSeaRegion()) {
    return 0;
  }
  for (const neighbor of state.getAdjacentRegions(seaRegionId)) {
    if (operationalHarbor(state, neighbor, factionId)) {
      return 1;
    }
  }
  return 0;
}

export function adjustedMoveRange(
  state: GameState,
  unitTypeId: string,
  fromRegionId: string,
  base: number,
  factionId = state.current_faction_id,
): number {
  if (!facilitiesActive(state) || base <= 0) {
    return base;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind == null) {
    return base;
  }
  if (SEA.has(kind) && navalRangeBonus(state, factionId, fromRegionId) > 0) {
    return base + 1;
  }
  return base;
}

/** Hits still missing on a battleship or carrier that survived. Zero for every other unit. */
export function capitalHullDamage(unitTypeId: string, hp: number, maxHp: number): number {
  const kind = classifyUnit(unitTypeId);
  if (kind == null || !CAPITAL.has(kind) || hp <= 0) {
    return 0;
  }
  return Math.max(0, maxHp - hp);
}

/** Full repair. The harbor is the adjacent friendly land, not the sea zone. */
export function harborRepair(
  state: GameState,
  factionId: string,
  regionId: string,
  unitTypeId: string,
  damage: number,
): number {
  if (!facilitiesActive(state) || damage <= 0) {
    return damage;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind == null || !CAPITAL.has(kind)) {
    return damage;
  }
  if (navalRangeBonus(state, factionId, regionId) > 0) {
    return 0;
  }
  return damage;
}

/** Damaged battleships and carriers beside a friendly operational harbor return to full HP. */
export function repairCapitalShips(state: GameState, factionId: string): void {
  if (!facilitiesActive(state) || factionId === "") {
    return;
  }
  for (const regionId of Object.keys(state.region_units)) {
    if (navalRangeBonus(state, factionId, regionId) <= 0) {
      continue;
    }
    for (const entry of state.region_units[regionId] ?? []) {
      if (entry.faction_id !== factionId) {
        continue;
      }
      const kind = classifyUnit(entry.unit_type_id);
      if (kind == null || !CAPITAL.has(kind) || entry.damage == null) {
        continue;
      }
      delete entry.damage;
    }
  }
}

/**
 * A transport at a friendly operational harbor may embark from that land,
 * or from one friendly land territory connected to it.
 */
export function harborStagingLoad(
  state: GameState,
  factionId: string,
  seaRegionId: string,
  fromRegionId: string,
): boolean {
  if (!facilitiesActive(state)) {
    return false;
  }
  const from = state.regions[fromRegionId];
  const sea = state.regions[seaRegionId];
  if (from == null || sea == null || !from.isLandRegion() || !sea.isSeaRegion()) {
    return false;
  }
  if (from.owner_faction_id === "" || !state.sameTeam(from.owner_faction_id, factionId)) {
    return false;
  }
  for (const neighbor of state.getAdjacentRegions(seaRegionId)) {
    if (!operationalHarbor(state, neighbor, factionId)) {
      continue;
    }
    if (neighbor === fromRegionId || state.isAdjacent(neighbor, fromRegionId)) {
      return true;
    }
  }
  return false;
}

export interface ScrambleLift {
  fromRegionId: string;
  unitTypeId: string;
  count: number;
}

function stationed(state: GameState, regionId: string, factionId: string, unitTypeId: string): number {
  let total = 0;
  for (const entry of state.region_units[regionId] ?? []) {
    if (entry.faction_id !== factionId || entry.unit_type_id !== unitTypeId || entry.instance_id) {
      continue;
    }
    total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  }
  return total;
}

/**
 * Up to three fighters or tactical bombers from each operational airbase
 * may enter an adjacent sea zone or an adjacent friendly territory.
 */
export function planScramble(
  state: GameState,
  battleRegionId: string,
  defenderFactionId: string,
  picks: ScrambleLift[],
): { ok: true; lifts: ScrambleLift[] } | { ok: false; reason: string } {
  if (!facilitiesActive(state)) {
    return { ok: false, reason: "Facilities are off" };
  }
  const battle = state.regions[battleRegionId];
  if (battle == null) {
    return { ok: false, reason: "No such region" };
  }
  const sea = battle.isSeaRegion();
  const friendlyLand = battle.isLandRegion() && state.sameTeam(battle.owner_faction_id, defenderFactionId);
  if (!sea && !friendlyLand) {
    return { ok: false, reason: "Scramble only enters a sea zone or a friendly territory" };
  }
  if (picks.length === 0) {
    return { ok: false, reason: "Choose planes to scramble" };
  }
  const usedAtBase: Record<string, number> = {};
  const usedOfType: Record<string, number> = {};
  const lifts: ScrambleLift[] = [];
  for (const pick of picks) {
    const count = Math.trunc(pick.count);
    if (count <= 0) {
      return { ok: false, reason: "Scramble needs at least one plane" };
    }
    const kind = classifyUnit(pick.unitTypeId);
    if (kind == null || !SCRAMBLE.has(kind)) {
      return { ok: false, reason: "Only fighters and tactical bombers scramble" };
    }
    if (!operationalAirbase(state, pick.fromRegionId, defenderFactionId)) {
      return { ok: false, reason: "That airbase is not operational" };
    }
    if (!state.isAdjacent(pick.fromRegionId, battleRegionId) || pick.fromRegionId === battleRegionId) {
      return { ok: false, reason: "Scramble stays adjacent to the airbase" };
    }
    const typeKey = `${pick.fromRegionId}|${pick.unitTypeId}`;
    const alreadyType = usedOfType[typeKey] ?? 0;
    if (alreadyType + count > stationed(state, pick.fromRegionId, defenderFactionId, pick.unitTypeId)) {
      return { ok: false, reason: "Not enough planes at that airbase" };
    }
    const alreadyBase = usedAtBase[pick.fromRegionId] ?? 0;
    if (alreadyBase + count > 3) {
      return { ok: false, reason: "An airbase scrambles at most three planes" };
    }
    usedAtBase[pick.fromRegionId] = alreadyBase + count;
    usedOfType[typeKey] = alreadyType + count;
    lifts.push({ fromRegionId: pick.fromRegionId, unitTypeId: pick.unitTypeId, count });
  }
  return { ok: true, lifts };
}
