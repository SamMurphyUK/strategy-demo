import type { GameState } from "../engine/model/game_state";
import { estimateBattle } from "../engine/rules/optional/montecarlo";

export interface BattleOdds {
  win: number;
  survival: number;
  trials: number;
}

/** One rank per unit. Attackers use attack. Defenders use defense. */
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

/**
 * Fast deterministic odds. An empty defender is a walk-in, so no dice are rolled.
 * Trials are capped at 1500 by the shared estimator.
 */
export function battleOdds(
  state: GameState,
  factionId: string,
  fromRegion: string,
  targetRegion: string,
  trials: number,
  seed: number,
): BattleOdds {
  const attackers = ranks(state, fromRegion, factionId, true, true);
  const defenders = ranks(state, targetRegion, factionId, false, false);
  if (attackers.length === 0) {
    return { win: 0, survival: 0, trials: 0 };
  }
  if (defenders.length === 0) {
    return { win: 1, survival: 1, trials: 0 };
  }
  const odds = estimateBattle(attackers, defenders, trials, seed, state.rulesetConfig);
  const decided = Math.max(1, odds.attackerWins + odds.defenderWins + odds.draws);
  return {
    win: odds.attackerWins / decided,
    survival: (odds.attackerWins + odds.draws) / decided,
    trials: odds.trials,
  };
}
