import type { GameState } from "../engine/model/game_state";
import type { OptionalRulesetConfig } from "../engine/types/ruleset";
import { estimateBattle } from "../engine/rules/optional/montecarlo";

export interface BattleOdds {
  win: number;
  survival: number;
  survivingAttackers: number;
  trials: number;
}

/**
 * Fast deterministic odds. An empty defender is a walk-in, so no dice are rolled.
 * Trials are capped at 1500 by the shared estimator.
 */
export function simulateBattleOdds(
  attackerRanks: readonly number[],
  defenderRanks: readonly number[],
  trials: number,
  seed: number,
  ruleset?: OptionalRulesetConfig,
): BattleOdds {
  if (attackerRanks.length === 0) {
    return { win: 0, survival: 0, survivingAttackers: 0, trials: 0 };
  }
  if (defenderRanks.length === 0) {
    return { win: 1, survival: 1, survivingAttackers: attackerRanks.length, trials: 0 };
  }
  const odds = estimateBattle([...attackerRanks], [...defenderRanks], trials, seed, ruleset);
  const decided = Math.max(1, odds.attackerWins + odds.defenderWins + odds.draws);
  return {
    win: odds.attackerWins / decided,
    survival: (odds.attackerWins + odds.draws) / decided,
    survivingAttackers: odds.meanAttackersLeft,
    trials: odds.trials,
  };
}

function ranks(state: GameState, regionId: string, factionId: string, friendly: boolean, attack: boolean): number[] {
  const out: number[] = [];
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId) !== friendly) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    if (unit == null) {
      continue;
    }
    const stat = attack ? unit.attack : unit.defense;
    if (stat <= 0) {
      continue;
    }
    const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    for (let i = 0; i < count; i += 1) {
      out.push(stat);
    }
  }
  return out;
}

/** Odds for every friendly attacker on `fromRegion` against the defenders on `targetRegion`. */
export function battleOdds(
  state: GameState,
  factionId: string,
  fromRegion: string,
  targetRegion: string,
  trials: number,
  seed: number,
): BattleOdds {
  return simulateBattleOdds(
    ranks(state, fromRegion, factionId, true, true),
    ranks(state, targetRegion, factionId, false, false),
    trials,
    seed,
    state.rulesetConfig,
  );
}
