import type { GameState } from "../engine/model/game_state";
import { VICTORY_CITIES } from "../engine/rules/optional/global1940Evaluator";

export interface TileThreat {
  regionId: string;
  strategicValue: number;
  /** Enemy attack power that can step onto this tile in one move. */
  counterReach1: number;
  /** Enemy attack power two moves out. One-move power is not counted again. */
  counterReach2: number;
}

const NAMED_OBJECTIVES = [
  "caucasus",
  "persia",
  "iraq",
  "sumatra",
  "java",
  "borneo",
  "celebes",
  "malaya",
  "philippines",
  "egypt",
  "greece",
  "gibraltar",
  "arkhangelsk",
  "moscow",
  "leningrad",
  "stalingrad",
  "canada",
  "south_africa",
  "india",
  "australia",
  "new_zealand",
];

function attackPower(state: GameState, regionId: string, factionId: string, friendly: boolean): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "") {
      continue;
    }
    const mine = state.sameTeam(owner, factionId);
    if (mine !== friendly) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    if (unit == null) {
      continue;
    }
    const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    total += count * Math.max(0, unit.attack);
  }
  return total;
}

/**
 * Visible board only. Enemy pending purchases and research are not read.
 * `huntObjectives` is the strategic-staging switch.
 */
export function threatMap(state: GameState, factionId: string, huntObjectives: boolean): TileThreat[] {
  const cities = new Set<string>(VICTORY_CITIES);
  const objectives = new Set(NAMED_OBJECTIVES);
  const hunt = huntObjectives && state.rulesetConfig.nationalObjectivesAndNeutrals === true;
  const global = state.scenarioId === "SCENARIO_GLOBAL_1940";
  const tiles: TileThreat[] = [];
  for (const regionId of Object.keys(state.regions)) {
    const region = state.regions[regionId];
    if (region == null || !region.isLandRegion()) {
      continue;
    }
    let value = Math.max(0, region.ipc_value);
    if (region.is_capital) {
      value += 8;
    }
    if (global && cities.has(regionId)) {
      value += 4;
    }
    if (hunt && objectives.has(regionId) && region.owner_faction_id !== factionId) {
      value += 3;
    }
    let near = 0;
    let far = 0;
    for (const hop of state.getAdjacentRegions(regionId)) {
      near += attackPower(state, hop, factionId, false);
      for (const second of state.getAdjacentRegions(hop)) {
        if (second === regionId || state.isAdjacent(regionId, second)) {
          continue;
        }
        far += attackPower(state, second, factionId, false);
      }
    }
    tiles.push({ regionId, strategicValue: value, counterReach1: near, counterReach2: far });
  }
  return tiles;
}

export function threatAt(tiles: readonly TileThreat[], regionId: string): TileThreat {
  return tiles.find((tile) => tile.regionId === regionId) ?? { regionId, strategicValue: 0, counterReach1: 0, counterReach2: 0 };
}
