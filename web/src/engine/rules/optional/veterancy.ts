import type { BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";

export interface UnitExperience {
  xp: number;
  veteran: boolean;
}

export interface BattleStrength {
  attacker: number;
  defender: number;
  attackerLost: number;
  defenderLost: number;
  attackerSurvivors: BattleUnitState[];
  defenderSurvivors: BattleUnitState[];
  winner: "attacker" | "defender" | "none";
}

/** A win is close when the smaller side started with at least 70% of the larger side. */
export function bloodyParity(report: BattleStrength): boolean {
  const high = Math.max(report.attacker, report.defender);
  const low = Math.min(report.attacker, report.defender);
  if (high <= 0 || report.winner === "none") {
    return false;
  }
  const parity = low / high;
  const bloody = report.attackerLost + report.defenderLost > 0;
  return bloody && parity >= 0.7;
}

export function experienceGain(report: BattleStrength): number {
  if (!bloodyParity(report)) {
    return 0;
  }
  const winnerLost = report.winner === "attacker" ? report.attackerLost : report.defenderLost;
  const winnerStart = report.winner === "attacker" ? report.attacker : report.defender;
  if (winnerStart > 0 && winnerLost / winnerStart >= 0.5) {
    return 2;
  }
  return 1;
}

/**
 * Survivors on the winning side gain XP. At most one level-2 unit becomes a veteran,
 * and that veteran may reroll one miss each round.
 */
export function grantVictoryExperience(state: GameState, report: BattleStrength): void {
  if (!state.rulesetConfig.unitVeterancy || !bloodyParity(report)) {
    return;
  }
  const gain = experienceGain(report);
  const survivors = report.winner === "attacker" ? report.attackerSurvivors : report.defenderSurvivors;
  let promoted = false;
  for (const unit of survivors) {
    const prior = state.unitExperience[unit.id] ?? { xp: 0, veteran: false };
    const xp = Math.min(2, prior.xp + gain);
    let veteran = prior.veteran;
    if (!veteran && !promoted && prior.xp >= 1 && xp >= 2) {
      veteran = true;
      promoted = true;
    }
    state.unitExperience[unit.id] = { xp, veteran };
  }
}

export function veteranMayReroll(state: GameState, unitId: string): boolean {
  return state.rulesetConfig.unitVeterancy === true && state.unitExperience[unitId]?.veteran === true;
}
