import { canReturnAfter, isAirUnit } from "../engine/air/air_fuel";
import type { GameState } from "../engine/model/game_state";
import { MovementValidator } from "../engine/movement/movement_validator";
import type { Ruleset } from "../engine/rules/ruleset";
import { battleOdds } from "./battleOddsSim";
import { threatAt, type TileThreat } from "./threatMap";
import type { AIDifficultyProfile, CommanderWeights } from "./types/aiTypes";

export interface AttackPackage {
  from: string;
  to: string;
  unitType: string;
  count: number;
  win: number;
  survival: number;
  cost: number;
  cheap: boolean;
  value: number;
}

const CANDIDATE_CAP = 8;

function cheapUnit(unitType: string, cost: number): boolean {
  return cost <= 4 || unitType === "infantry" || unitType === "artillery" || unitType.includes("guerrilla");
}

/**
 * Legal, non-suicidal attacks. Destinations come from the movement rules.
 * Air must still have a landing zone. Enemy purchase plans are not read.
 */
export function combatCandidates(
  state: GameState,
  factionId: string,
  ruleset: Ruleset,
  profile: AIDifficultyProfile,
  weights: CommanderWeights,
  tiles: readonly TileThreat[],
  seed: number,
): AttackPackage[] {
  const validator = new MovementValidator();
  const found: AttackPackage[] = [];
  const seen = new Set<string>();
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
      if (entry.instance_id != null && String(entry.instance_id) !== "") {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      const unit = state.unit_types[unitType];
      if (unit == null || unit.attack <= 0 || unit.category === "sea") {
        continue;
      }
      const have = state.movableStackCount(factionId, regionId, unitType);
      if (have <= 0) {
        continue;
      }
      const destinations = validator.getLegalDestinationsForStack(regionId, unitType, factionId, state, ruleset);
      for (const to of destinations) {
        if (!state.isRegionHostileTo(to, factionId) || state.regions[to]?.isLandRegion() !== true) {
          continue;
        }
        if (isAirUnit(state, unitType) && !canReturnAfter(state, factionId, unitType, regionId, to)) {
          continue;
        }
        const key = `${regionId}|${unitType}|${to}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const cheap = cheapUnit(unitType, unit.cost);
        if (threatAt(tiles, to).zoneClassification === "DEAD_ZONE" && !cheap) {
          continue;
        }
        const odds = battleOdds(state, factionId, regionId, to, profile.fastOddsIterations, seed + found.length + 1);
        const winBar = cheap ? weights.tradeWinThreshold : weights.holdWinThreshold;
        if (odds.win < winBar) {
          continue;
        }
        if (!cheap && odds.survival < weights.holdSurvivalThreshold) {
          continue;
        }
        found.push({
          from: regionId,
          to,
          unitType,
          count: have,
          win: odds.win,
          survival: odds.survival,
          cost: unit.cost * have,
          cheap,
          value: threatAt(tiles, to).strategicValue,
        });
      }
    }
  }
  found.sort((a, b) => b.win * (b.value + 1) - a.win * (a.value + 1));
  return found.slice(0, CANDIDATE_CAP);
}
