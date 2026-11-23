import type { GameState } from "../../model/game_state";

export interface NationalObjective {
  id: string;
  factionId: string;
  /** Extra Industrial Output when every listed region is held. */
  production: number;
  holds: string[];
}

export interface NeutralBloc {
  id: string;
  members: string[];
  /** The power the rest of the bloc joins when one member is attacked. */
  joins: string;
}

export function objectiveBonus(state: GameState, factionId: string): number {
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return 0;
  }
  let bonus = 0;
  for (const goal of state.nationalObjectives) {
    if (goal.factionId !== factionId || goal.holds.length === 0) {
      continue;
    }
    const held = goal.holds.every((regionId) => state.regions[regionId]?.owner_faction_id === factionId);
    if (held) {
      bonus += Math.max(0, Math.trunc(goal.production));
    }
  }
  return bonus;
}

/** Attacking one member of a bloc brings the others in on `joins`. Returns the regions that flipped. */
export function neutralDomino(state: GameState, attackedRegionId: string, attackerId: string): string[] {
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return [];
  }
  const flipped: string[] = [];
  for (const bloc of state.neutralBlocs) {
    if (!bloc.members.includes(attackedRegionId) || bloc.joins === "" || state.sameTeam(bloc.joins, attackerId)) {
      continue;
    }
    for (const regionId of bloc.members) {
      if (regionId === attackedRegionId) {
        continue;
      }
      const region = state.regions[regionId];
      if (region == null || region.owner_faction_id === bloc.joins) {
        continue;
      }
      region.owner_faction_id = bloc.joins;
      flipped.push(regionId);
    }
  }
  return flipped;
}
