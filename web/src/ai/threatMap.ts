import { longRangeBonus } from "../engine/air/air_fuel";
import type { GameState } from "../engine/model/game_state";
import type { Region } from "../engine/model/region";
import { MovementValidator } from "../engine/movement/movement_validator";
import { baseOutput } from "../engine/rules/optional/bombingResolver";
import { adjustedMoveRange, airRangeBonus } from "../engine/rules/optional/facilitiesResolver";
import { VICTORY_CITIES } from "../engine/rules/optional/global1940Evaluator";
import type { NeutralBloc } from "../engine/rules/optional/objectives";
import { personaFor } from "./types/aiTypes";

export type ZoneClassification = "SAFE_REAR" | "HOLD_LINE" | "DEAD_ZONE";

export interface TileThreat {
  regionId: string;
  strategicValue: number;
  /** Enemy attack power that can enter this tile on the enemy's next turn. */
  enemyThreat1Turn: number;
  /** Enemy attack power that can reach this tile in two movement points. */
  enemyReachableAttackPower: number;
  /** Friendly defense power that can reinforce this tile, excluding the garrison already there. */
  friendlyReach1Turn: number;
  zoneClassification: ZoneClassification;
}

const AXIS = new Set(["germany", "italy", "japan", "ger", "jap"]);

const CANON: Record<string, string> = {
  ger: "germany",
  germany: "germany",
  jap: "japan",
  japan: "japan",
  ussr: "soviet_union",
  soviet_union: "soviet_union",
  uk: "united_kingdom",
  united_kingdom: "united_kingdom",
  usa: "united_states",
  united_states: "united_states",
  italy: "italy",
  china: "china",
};

interface NamedGoal {
  faction: string;
  mode: "all" | "any" | "team";
  regions: string[];
}

const NAMED_GOALS: NamedGoal[] = [
  { faction: "germany", mode: "any", regions: ["caucasus", "persia", "iraq"] },
  { faction: "japan", mode: "all", regions: ["sumatra", "java", "borneo", "celebes"] },
  { faction: "japan", mode: "all", regions: ["malaya", "philippines"] },
  { faction: "italy", mode: "all", regions: ["egypt", "greece", "gibraltar"] },
  { faction: "soviet_union", mode: "all", regions: ["arkhangelsk"] },
  { faction: "soviet_union", mode: "all", regions: ["moscow", "leningrad", "stalingrad"] },
  { faction: "united_kingdom", mode: "all", regions: ["gibraltar", "egypt"] },
  { faction: "united_kingdom", mode: "team", regions: ["canada", "south_africa", "india", "australia", "new_zealand"] },
];

function canon(factionId: string): string {
  const key = factionId.trim().toLowerCase();
  return CANON[key] ?? key;
}

function add(into: Map<string, number>, regionId: string, amount: number): void {
  if (amount <= 0) {
    return;
  }
  into.set(regionId, (into.get(regionId) ?? 0) + amount);
}

function movementRange(state: GameState, factionId: string, regionId: string, unitType: string, printed: number): number {
  const unit = state.unit_types[unitType];
  if (unit?.category === "air") {
    return printed + airRangeBonus(state, factionId, regionId, unitType) + longRangeBonus(state, factionId);
  }
  if (unit?.category === "sea") {
    return adjustedMoveRange(state, unitType, regionId, printed, factionId);
  }
  return printed;
}

/** One flood per stack. Land stops on the first hostile tile. Air flies over. */
function project(state: GameState, factionId: string, friendly: boolean): Map<string, number> {
  const power = new Map<string, number>();
  const validator = new MovementValidator();
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getUnitsInRegion(regionId)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || state.sameTeam(owner, factionId) !== friendly) {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      const unit = state.unit_types[unitType];
      if (unit == null) {
        continue;
      }
      const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      const stat = friendly ? unit.defense : unit.attack;
      const body = count * Math.max(0, stat);
      if (body <= 0 || count <= 0) {
        continue;
      }
      const land = state.regions[regionId]?.isLandRegion() === true;
      if (!friendly && land) {
        add(power, regionId, body);
      }
      const printed = Math.max(0, Math.trunc(unit.movement));
      if (printed <= 0) {
        continue;
      }
      const range = movementRange(state, owner, regionId, unitType, printed);
      const air = unit.category === "air";
      const sea = unit.category === "sea";
      const reached = validator.floodFill(regionId, range, state, sea, owner, air, unitType);
      for (const dest of reached) {
        if (state.regions[dest]?.isLandRegion() !== true) {
          continue;
        }
        add(power, dest, body);
      }
    }
  }
  return power;
}

function garrisonDefense(state: GameState, factionId: string, regionId: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || !state.sameTeam(owner, factionId)) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    if (unit == null) {
      continue;
    }
    total += Math.max(0, Math.trunc(Number(entry.count ?? 0))) * Math.max(0, unit.defense);
  }
  return total;
}

function holds(state: GameState, factionId: string, regionId: string, team: boolean): boolean {
  const owner = state.regions[regionId]?.owner_faction_id ?? "";
  if (owner === "") {
    return false;
  }
  if (team && factionId === "united_kingdom") {
    return owner === "united_kingdom" || owner === "anzac" || state.sameTeam(owner, factionId);
  }
  return owner === factionId;
}

function goalCompletes(state: GameState, factionId: string, regionId: string, mode: NamedGoal["mode"], regions: string[]): boolean {
  if (!regions.includes(regionId) || holds(state, factionId, regionId, mode === "team")) {
    return false;
  }
  if (mode === "any") {
    return regions.every((id) => !holds(state, factionId, id, false));
  }
  return regions.every((id) => id === regionId || holds(state, factionId, id, mode === "team"));
}

function objectiveFlip(state: GameState, factionId: string, regionId: string): boolean {
  const name = canon(factionId);
  for (const goal of NAMED_GOALS) {
    if (goal.faction === name && goalCompletes(state, name, regionId, goal.mode, goal.regions)) {
      return true;
    }
  }
  for (const goal of state.nationalObjectives) {
    if (goal.factionId !== factionId && goal.factionId !== name) {
      continue;
    }
    if (goalCompletes(state, goal.factionId, regionId, "all", goal.holds)) {
      return true;
    }
  }
  return false;
}

function sideJoined(state: GameState, bloc: NeutralBloc, attackerId: string): string {
  if (!bloc.oppose) {
    return bloc.joins;
  }
  const axis = AXIS.has(attackerId) || AXIS.has(canon(attackerId)) || state.factions[attackerId]?.team === "axis";
  return axis ? "united_kingdom" : "germany";
}

function blocPenalty(state: GameState, factionId: string, region: Region): boolean {
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return false;
  }
  let flipped = 0;
  for (const bloc of state.neutralBlocs) {
    if (!bloc.members.includes(region.id)) {
      continue;
    }
    const joins = sideJoined(state, bloc, factionId);
    if (joins === "" || state.sameTeam(joins, factionId)) {
      continue;
    }
    for (const memberId of bloc.members) {
      if (memberId === region.id) {
        continue;
      }
      const member = state.regions[memberId];
      if (member == null || member.owner_faction_id === joins) {
        continue;
      }
      flipped += baseOutput(member) + Math.max(0, bloc.garrison ?? 0);
    }
  }
  return flipped > baseOutput(region);
}

function strategicValue(state: GameState, factionId: string, region: Region, huntObjectives: boolean): number {
  let value = baseOutput(region) * 2.5;
  if (state.scenarioId === "SCENARIO_GLOBAL_1940" && (VICTORY_CITIES as readonly string[]).includes(region.id)) {
    value += 18;
  }
  if (region.is_capital) {
    const friendly = region.owner_faction_id !== "" && state.sameTeam(region.owner_faction_id, factionId);
    value += friendly ? 40 : 35;
  }
  if (state.rulesetConfig.facilitiesAndPatrols) {
    if (region.major_factory) {
      value += 10;
    }
    if (region.forward_depot) {
      value += 4;
    }
    if (region.airbase) {
      value += 3;
    }
    if (region.harbor) {
      value += 3;
    }
  }
  if (huntObjectives && state.rulesetConfig.nationalObjectivesAndNeutrals && objectiveFlip(state, factionId, region.id)) {
    value += 8;
  }
  if (blocPenalty(state, factionId, region)) {
    value -= 25;
  }
  return value;
}

function classify(enemy: number, garrison: number, reinforcements: number, threshold: number): ZoneClassification {
  if (enemy === 0) {
    return "SAFE_REAR";
  }
  const ours = garrison + reinforcements;
  const survival = ours / (ours + enemy);
  return survival >= threshold ? "HOLD_LINE" : "DEAD_ZONE";
}

/**
 * Visible board only. Enemy pending purchases and research are not read.
 * `huntObjectives` adds the national-objective bonus when that rule is on.
 */
function projectWithin(state: GameState, factionId: string, steps: number): Map<string, number> {
  const power = new Map<string, number>();
  const validator = new MovementValidator();
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getUnitsInRegion(regionId)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || state.sameTeam(owner, factionId)) {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      const unit = state.unit_types[unitType];
      if (unit == null || unit.attack <= 0) {
        continue;
      }
      const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      const body = count * unit.attack;
      if (body <= 0) {
        continue;
      }
      if (state.regions[regionId]?.isLandRegion() === true) {
        add(power, regionId, body);
      }
      const range = Math.min(steps, movementRange(state, owner, regionId, unitType, Math.max(0, Math.trunc(unit.movement))));
      if (range <= 0) {
        continue;
      }
      const air = unit.category === "air";
      const sea = unit.category === "sea";
      for (const dest of validator.floodFill(regionId, range, state, sea, owner, air, unitType)) {
        if (state.regions[dest]?.isLandRegion() === true) {
          add(power, dest, body);
        }
      }
    }
  }
  return power;
}

export function threatMap(state: GameState, factionId: string, huntObjectives: boolean): TileThreat[] {
  const enemy = project(state, factionId, false);
  const friendly = project(state, factionId, true);
  const close = projectWithin(state, factionId, 2);
  const threshold = personaFor(factionId).holdSurvivalThreshold;
  const tiles: TileThreat[] = [];
  for (const region of Object.values(state.regions)) {
    if (!region.isLandRegion()) {
      continue;
    }
    const enemyThreat1Turn = enemy.get(region.id) ?? 0;
    const friendlyReach1Turn = friendly.get(region.id) ?? 0;
    tiles.push({
      regionId: region.id,
      strategicValue: strategicValue(state, factionId, region, huntObjectives),
      enemyThreat1Turn,
      enemyReachableAttackPower: close.get(region.id) ?? 0,
      friendlyReach1Turn,
      zoneClassification: classify(enemyThreat1Turn, garrisonDefense(state, factionId, region.id), friendlyReach1Turn, threshold),
    });
  }
  return tiles;
}

export function threatAt(tiles: readonly TileThreat[], regionId: string): TileThreat {
  return (
    tiles.find((tile) => tile.regionId === regionId) ?? {
      regionId,
      strategicValue: 0,
      enemyThreat1Turn: 0,
      enemyReachableAttackPower: 0,
      friendlyReach1Turn: 0,
      zoneClassification: "SAFE_REAR",
    }
  );
}
