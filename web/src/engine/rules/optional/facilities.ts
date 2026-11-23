import type { GameState } from "../../model/game_state";
import { classifyUnit } from "../../types/ruleset";
import { facilitiesActive } from "./facilitiesResolver";

export {
  adjustedMoveRange,
  airRangeBonus,
  capitalHullDamage,
  carryAirbaseLaunch,
  facilitiesActive,
  harborRepair,
  harborStagingLoad,
  navalRangeBonus,
  operationalAirbase,
  operationalHarbor,
  planScramble,
  repairCapitalShips,
} from "./facilitiesResolver";
export type { ScrambleLift } from "./facilitiesResolver";

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
