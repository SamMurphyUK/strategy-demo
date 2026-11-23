import type { BattleSide, BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";
import { classifyUnit, isArmorClass, isArtilleryClass, isBomberClass, isInfantryClass, type TerrainType } from "../../types/ruleset";

const COVERS = new Set<TerrainType>(["OPEN", "URBAN", "FOREST", "MOUNTAIN", "DESERT", "SNOW"]);

export function landCover(value: unknown): TerrainType {
  const text = String(value ?? "").trim().toUpperCase();
  return COVERS.has(text as TerrainType) ? (text as TerrainType) : "OPEN";
}

export function coverOf(state: GameState, regionId: string): TerrainType {
  return landCover(state.regions[regionId]?.land_cover);
}

export function terrainActive(state: GameState): boolean {
  return state.rulesetConfig.terrainModifiers === true;
}

/** Desert costs two movement. Snow can be entered, and the march stops there. */
export function movementEnterCost(
  state: GameState,
  unitTypeId: string,
  fromRegionId: string,
  intoRegionId: string,
  range: number,
  dist: number,
): number {
  if (!terrainActive(state) || unitTypeId === "") {
    return 1;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind == null || kind === "FIGHTER" || kind === "TACTICAL_BOMBER" || kind === "HEAVY_BOMBER") {
    return 1;
  }
  if (kind === "SUBMARINE" || kind === "DESTROYER" || kind === "CRUISER" || kind === "CARRIER" || kind === "BATTLESHIP" || kind === "TRANSPORT") {
    return 1;
  }
  const into = coverOf(state, intoRegionId);
  const from = coverOf(state, fromRegionId);
  if (into === "SNOW" || from === "SNOW") {
    return Math.max(1, range - dist);
  }
  if (into === "DESERT") {
    return 2;
  }
  return 1;
}

export function blitzBlocked(state: GameState, unitTypeId: string, regionId: string): boolean {
  return terrainActive(state) && isArmorClass(unitTypeId) && coverOf(state, regionId) === "MOUNTAIN";
}

function suppressed(state: GameState, regionId: string): boolean {
  const until = state.terrainSuppressed[regionId] ?? 0;
  return until > 0 && state.game_round <= until;
}

/**
 * Terrain and a declared preparatory bombardment. Returns the same rank when the
 * campaign is on the 1942 rules, or when the ground is open.
 */
export function adjustCombatRank(
  state: GameState,
  regionId: string,
  units: BattleUnitState[],
  unit: BattleUnitState,
  side: BattleSide,
  rank: number,
  round: number,
): number {
  const rules = state.rulesetConfig;
  let next = rank;
  if (rules.preparatoryBombardment && rules.terrainModifiers && round === 1 && side === "attacker" && state.forfeitOpening[unit.id]) {
    if (isArtilleryClass(unit.unit_type_id) || isBomberClass(unit.unit_type_id)) {
      next = 0;
    }
  }
  if (!rules.terrainModifiers) {
    return next;
  }
  const cover = coverOf(state, regionId);
  const quiet = suppressed(state, regionId);
  if (side === "defender" && isInfantryClass(unit.unit_type_id) && !quiet) {
    const cap = cover === "URBAN" ? 3 : cover === "MOUNTAIN" ? 2 : 0;
    if (cap > 0) {
      const peers = units.filter((item) => isInfantryClass(item.unit_type_id));
      const place = peers.findIndex((item) => item.id === unit.id);
      if (place >= 0 && place < cap) {
        next += 1;
      }
    }
  }
  if (side === "attacker" && cover === "FOREST" && isArmorClass(unit.unit_type_id)) {
    next = Math.max(0, next - 1);
  }
  return next;
}

export function declarePreparatoryBombardment(state: GameState, regionId: string, unitIds: string[]): string {
  const rules = state.rulesetConfig;
  if (!rules.terrainModifiers || !rules.preparatoryBombardment) {
    return "Preparatory bombardment needs terrain.";
  }
  const cover = coverOf(state, regionId);
  if (cover !== "URBAN" && cover !== "FOREST") {
    return "Only a city or a wood can be suppressed.";
  }
  for (const id of unitIds) {
    state.forfeitOpening[id] = true;
  }
  state.terrainSuppressed[regionId] = state.game_round;
  return "";
}
