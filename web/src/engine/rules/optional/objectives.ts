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
  /** Join the other side from the invader instead of the fixed `joins` power. */
  oppose?: boolean;
  /** Infantry placed on each territory that flips. Omitted blocs do not spawn any. */
  garrison?: number;
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

const AXIS = new Set(["germany", "italy", "japan"]);

function sideJoined(state: GameState, bloc: NeutralBloc, attackerId: string): string {
  if (!bloc.oppose) {
    return bloc.joins;
  }
  const axis = AXIS.has(attackerId) || state.factions[attackerId]?.team === "axis";
  return axis ? "united_kingdom" : "germany";
}

function spawnGarrison(state: GameState, regionId: string, factionId: string, count: number): void {
  const units = state.region_units[regionId] ?? [];
  state.region_units[regionId] = units;
  const found = units.find((entry) => entry.faction_id === factionId && entry.unit_type_id === "infantry" && entry.instance_id == null);
  if (found) {
    found.count += count;
    return;
  }
  units.push({ faction_id: factionId, unit_type_id: "infantry", count });
}

/** Attacking one member of a bloc brings the others in on `joins`. Returns the regions that flipped. */
export function neutralDomino(state: GameState, attackedRegionId: string, attackerId: string): string[] {
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return [];
  }
  const flipped: string[] = [];
  for (const bloc of state.neutralBlocs) {
    const joins = sideJoined(state, bloc, attackerId);
    if (!bloc.members.includes(attackedRegionId) || joins === "" || state.sameTeam(joins, attackerId)) {
      continue;
    }
    for (const regionId of bloc.members) {
      if (regionId === attackedRegionId) {
        continue;
      }
      const region = state.regions[regionId];
      if (region == null || region.owner_faction_id === joins) {
        continue;
      }
      region.owner_faction_id = joins;
      if ((bloc.garrison ?? 0) > 0) {
        spawnGarrison(state, regionId, joins, bloc.garrison ?? 0);
      }
      flipped.push(regionId);
    }
  }
  return flipped;
}
