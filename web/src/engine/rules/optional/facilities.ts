import type { GameState } from "../../model/game_state";
import { classifyUnit, type RulesetUnitType } from "../../types/ruleset";

const SEA: ReadonlySet<RulesetUnitType> = new Set(["SUBMARINE", "DESTROYER", "CRUISER", "CARRIER", "BATTLESHIP", "TRANSPORT"]);
const CAPITAL: ReadonlySet<RulesetUnitType> = new Set(["CARRIER", "BATTLESHIP"]);
const AIR: ReadonlySet<RulesetUnitType> = new Set(["FIGHTER", "TACTICAL_BOMBER", "HEAVY_BOMBER"]);

export function facilitiesActive(state: GameState): boolean {
  return state.rulesetConfig.facilitiesAndPatrols === true;
}

export function adjustedMoveRange(state: GameState, unitTypeId: string, fromRegionId: string, base: number): number {
  if (!facilitiesActive(state) || base <= 0) {
    return base;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind == null) {
    return base;
  }
  if (AIR.has(kind) && state.regions[fromRegionId]?.airbase === true) {
    return base + 1;
  }
  if (SEA.has(kind)) {
    for (const neighbor of state.getAdjacentRegions(fromRegionId)) {
      const region = state.regions[neighbor];
      if (region?.harbor === true && region.owner_faction_id !== "" && state.sameTeam(region.owner_faction_id, state.current_faction_id)) {
        return base + 1;
      }
    }
  }
  return base;
}

/** A damaged capital ship at a friendly harbor is repaired by one hit. */
export function harborRepair(state: GameState, factionId: string, regionId: string, unitTypeId: string, damage: number): number {
  if (!facilitiesActive(state) || damage <= 0) {
    return damage;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind == null || !CAPITAL.has(kind)) {
    return damage;
  }
  const here = state.regions[regionId];
  if (here?.harbor === true && state.sameTeam(here.owner_faction_id, factionId)) {
    return damage - 1;
  }
  return damage;
}

export interface PatrolZone {
  regionId: string;
  kind: "air" | "convoy";
}

/** Friendly fighters on an airbase may patrol each adjacent region. */
export function airPatrols(state: GameState, factionId: string): PatrolZone[] {
  if (!facilitiesActive(state)) {
    return [];
  }
  const zones: PatrolZone[] = [];
  for (const regionId of Object.keys(state.regions)) {
    const region = state.regions[regionId];
    if (!region?.airbase || !state.sameTeam(region.owner_faction_id, factionId)) {
      continue;
    }
    const fighters = state.getUnitsInRegion(regionId).some(
      (entry) => entry.faction_id === factionId && classifyUnit(String(entry.unit_type_id)) === "FIGHTER" && entry.count > 0,
    );
    if (!fighters) {
      continue;
    }
    for (const neighbor of state.getAdjacentRegions(regionId)) {
      zones.push({ regionId: neighbor, kind: "air" });
    }
  }
  return zones;
}

/** Each enemy submarine in a hostile sea zone on a convoy raid takes 1 Industrial Output, up to the territory value. */
export function convoyRaidLoss(state: GameState, factionId: string): number {
  if (!facilitiesActive(state)) {
    return 0;
  }
  let loss = 0;
  for (const regionId of Object.keys(state.regions)) {
    const region = state.regions[regionId];
    if (region == null || !region.isSeaRegion()) {
      continue;
    }
    const subs = state.getUnitsInRegion(regionId).reduce((sum, entry) => {
      if (state.sameTeam(String(entry.faction_id), factionId) || classifyUnit(String(entry.unit_type_id)) !== "SUBMARINE") {
        return sum;
      }
      return sum + Math.max(0, Math.trunc(entry.count));
    }, 0);
    if (subs <= 0) {
      continue;
    }
    let value = 0;
    for (const neighbor of state.getAdjacentRegions(regionId)) {
      const land = state.regions[neighbor];
      if (land?.isLandRegion() && state.sameTeam(land.owner_faction_id, factionId)) {
        value += land.ipc_value;
      }
    }
    loss += Math.min(subs, value);
  }
  return loss;
}
