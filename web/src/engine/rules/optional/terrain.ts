import type { BattleSide, BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";
import { isArtilleryClass, isBomberClass } from "../../types/ruleset";
import {
  adjustCombatRank as terrainRank,
  blitzBlocked,
  coverOf,
  landCover,
  movementEnterCost,
  terrainActive,
} from "./terrainResolver";

export { blitzBlocked, coverOf, landCover, movementEnterCost, terrainActive };

/**
 * Preparatory fire, then the terrain resolver. With both flags off the caller
 * keeps the classic rank map and never reaches this.
 */
export function adjustCombatRank(
  state: GameState,
  regionId: string,
  units: BattleUnitState[],
  unit: BattleUnitState,
  side: BattleSide,
  rank: number,
  round: number,
): number {
  const rules = state.rulesetConfig;
  let next = rank;
  if (rules.preparatoryBombardment && rules.terrainModifiers && round === 1 && side === "attacker" && state.forfeitOpening[unit.id]) {
    if (isArtilleryClass(unit.unit_type_id) || isBomberClass(unit.unit_type_id)) {
      next = 0;
    }
  }
  if (!rules.terrainModifiers) {
    return next;
  }
  return terrainRank(state, regionId, units, unit, side, next, round);
}

export function declarePreparatoryBombardment(state: GameState, regionId: string, unitIds: string[]): string {
  const rules = state.rulesetConfig;
  if (!rules.terrainModifiers || !rules.preparatoryBombardment) {
    return "Preparatory bombardment needs terrain.";
  }
  const cover = coverOf(state, regionId);
  if (cover !== "URBAN" && cover !== "FOREST") {
    return "Only a city or a wood can be suppressed.";
  }
  for (const id of unitIds) {
    state.forfeitOpening[id] = true;
  }
  state.terrainSuppressed[regionId] = state.game_round;
  return "";
}
