import { firingRanks } from "../../combat/battle_rules";
import type { BattleSide, BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";
import type { Unit } from "../../model/unit";
import { adjustCombatRank } from "./terrain";

/** The 1942 ranks, then the optional terrain and bombardment adjustments. */
export function optionalCombatRanks(
  state: GameState,
  regionId: string,
  round: number,
  units: BattleUnitState[],
  side: BattleSide,
  unitTypes: Record<string, Unit> = state.unit_types,
): Map<string, number> {
  const ranks = firingRanks(units, side, unitTypes);
  const rules = state.rulesetConfig;
  if (!rules.terrainModifiers && !rules.preparatoryBombardment) {
    return ranks;
  }
  const next = new Map<string, number>();
  for (const unit of units) {
    const base = ranks.get(unit.id) ?? 0;
    next.set(unit.id, adjustCombatRank(state, regionId, units, unit, side, base, round));
  }
  return next;
}
