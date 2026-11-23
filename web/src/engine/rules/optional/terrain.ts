import type { BattleSide, BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";
import { classifyUnit } from "../../types/ruleset";
import {
  adjustCombatRank as terrainRank,
  blitzBlocked,
  coverOf,
  coverSuppressed,
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
  if (rules.preparatoryBombardment && rules.terrainModifiers && round === 1 && side === "attacker") {
    const kind = classifyUnit(unit.unit_type_id);
    if (state.forfeitOpening[unit.id] && (kind === "ARTILLERY" || kind === "HEAVY_BOMBER" || kind === "TACTICAL_BOMBER")) {
      next = 0;
    }
    if (state.escortDuty[unit.id] && kind === "FIGHTER") {
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
  if (coverSuppressed(state, regionId)) {
    return "That ground is already suppressed.";
  }
  for (const id of unitIds) {
    state.forfeitOpening[id] = true;
  }
  return "";
}
