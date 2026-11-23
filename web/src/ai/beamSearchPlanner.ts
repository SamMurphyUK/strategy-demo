import type { GameState } from "../engine/model/game_state";
import { battleOdds } from "./battleOddsSim";
import type { AttackPackage } from "./combatMoveGen";
import { threatAt, type TileThreat } from "./threatMap";
import type { AIDifficultyProfile, CommanderWeights } from "./types/aiTypes";

export interface TurnPackage {
  attacks: AttackPackage[];
  score: number;
}

function overlaps(plan: readonly AttackPackage[], next: AttackPackage): boolean {
  return plan.some((attack) => attack.from === next.from && attack.unitType === next.unitType);
}

function scoreAttack(
  state: GameState,
  factionId: string,
  attack: AttackPackage,
  tiles: readonly TileThreat[],
  profile: AIDifficultyProfile,
  weights: CommanderWeights,
): number {
  const threat = threatAt(tiles, attack.to);
  const gain = attack.win * Math.max(1, attack.value) * weights.objectiveWeight;
  const loss = (1 - attack.survival) * attack.cost * weights.tuvPreservationWeight;
  let counter = 0;
  if (profile.lookaheadPly === 2) {
    counter = (threat.counterReach1 + threat.counterReach2 * 0.5) * (1 - attack.survival) * weights.tuvPreservationWeight;
  }
  return gain - loss - counter;
}

/**
 * Greedy beam over non-overlapping attacks. The empty plan scores 0,
 * so a negative package is dropped.
 */
export function beamSearch(
  state: GameState,
  factionId: string,
  candidates: readonly AttackPackage[],
  tiles: readonly TileThreat[],
  profile: AIDifficultyProfile,
  weights: CommanderWeights,
  seed: number,
): { best: TurnPackage; evaluated: number } {
  let beam: TurnPackage[] = [{ attacks: [], score: 0 }];
  let evaluated = 1;
  for (const candidate of candidates) {
    const next: TurnPackage[] = [];
    for (const plan of beam) {
      next.push(plan);
      if (overlaps(plan.attacks, candidate)) {
        continue;
      }
      const attacks = [...plan.attacks, candidate];
      const score = attacks.reduce((sum, attack) => sum + scoreAttack(state, factionId, attack, tiles, profile, weights), 0);
      next.push({ attacks, score });
      evaluated += 1;
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, Math.max(1, profile.beamWidth));
  }
  const top = beam[0] ?? { attacks: [], score: 0 };
  if (top.attacks.length === 0) {
    return { best: top, evaluated };
  }
  const verified = top.attacks.filter((attack, index) => {
    const deep = battleOdds(state, factionId, attack.from, attack.to, profile.deepOddsIterations, seed + 1000 + index);
    const bar = attack.cheap ? weights.tradeWinThreshold : weights.holdWinThreshold;
    return deep.win >= bar && (attack.cheap || deep.survival >= weights.holdSurvivalThreshold);
  });
  const score = verified.reduce((sum, attack) => sum + scoreAttack(state, factionId, attack, tiles, profile, weights), 0);
  if (score < 0) {
    return { best: { attacks: [], score: 0 }, evaluated };
  }
  return { best: { attacks: verified, score }, evaluated };
}
