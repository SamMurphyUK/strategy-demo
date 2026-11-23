import { canLandAt, isAirUnit, isLanded } from "../engine/air/air_fuel";
import type { GameState } from "../engine/model/game_state";
import { MovementValidator } from "../engine/movement/movement_validator";
import type { Ruleset } from "../engine/rules/ruleset";
import { TransportLoadValidator } from "../engine/transport/transport_load_validator";
import type { AttackPackage } from "./combatMoveGen";

export interface QuietMove {
  from: string;
  to: string;
  unitType: string;
  count: number;
}

export interface StagedLoad {
  transportId: string;
  from: string;
  unitType: string;
  count: number;
}

/**
 * Lands aircraft that did not attack. When staging is on, one infantry
 * may board an adjacent friendly transport for a later landing.
 * Patrols are not written here. The session has no patrol command.
 */
export function planNonCombat(
  state: GameState,
  factionId: string,
  ruleset: Ruleset,
  attacks: readonly AttackPackage[],
  stage: boolean,
): { moves: QuietMove[]; loads: StagedLoad[] } {
  const used = new Set(attacks.map((attack) => `${attack.from}|${attack.unitType}`));
  const validator = new MovementValidator();
  const moves: QuietMove[] = [];
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
      const unitType = String(entry.unit_type_id ?? "");
      if (!isAirUnit(state, unitType) || used.has(`${regionId}|${unitType}`)) {
        continue;
      }
      if (isLanded(state, factionId, unitType, regionId)) {
        continue;
      }
      const have = state.movableStackCount(factionId, regionId, unitType);
      if (have <= 0) {
        continue;
      }
      const spots = validator
        .getLegalDestinationsForStack(regionId, unitType, factionId, state, ruleset)
        .filter((dest) => canLandAt(state, factionId, unitType, dest));
      if (spots.length === 0) {
        continue;
      }
      moves.push({ from: regionId, to: spots[0], unitType, count: have });
    }
  }
  const loads: StagedLoad[] = [];
  if (!stage) {
    return { moves, loads };
  }
  const loader = new TransportLoadValidator();
  for (const regionId of Object.keys(state.regions)) {
    if (loads.length > 0) {
      break;
    }
    const region = state.regions[regionId];
    if (region == null || !region.isLandRegion() || region.owner_faction_id !== factionId) {
      continue;
    }
    if (state.movableStackCount(factionId, regionId, "infantry") <= 0) {
      continue;
    }
    for (const seaId of state.getAdjacentRegions(regionId)) {
      if (state.regions[seaId]?.isSeaRegion() !== true) {
        continue;
      }
      for (const entry of state.getUnitsInRegion(seaId)) {
        if (String(entry.faction_id ?? "") !== factionId || String(entry.unit_type_id ?? "") !== "transport") {
          continue;
        }
        const transportId = String(entry.instance_id ?? "");
        if (transportId === "") {
          continue;
        }
        if (!loader.canLoadUnits(transportId, regionId, [{ unit_type_id: "infantry", count: 1 }], factionId, state)) {
          continue;
        }
        loads.push({ transportId, from: regionId, unitType: "infantry", count: 1 });
        break;
      }
    }
  }
  return { moves, loads };
}
