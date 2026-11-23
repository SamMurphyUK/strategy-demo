import type { BattleSide, BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";
import type { Unit } from "../../model/unit";
import {
  classifyUnit,
  isArmorClass,
  isArtilleryClass,
  isMechClass,
  type RulesetUnitType,
  type TerrainType,
} from "../../types/ruleset";

const COVERS = new Set<TerrainType>(["OPEN", "URBAN", "FOREST", "MOUNTAIN", "DESERT", "SNOW"]);
const AIR: ReadonlySet<RulesetUnitType> = new Set(["FIGHTER", "TACTICAL_BOMBER", "HEAVY_BOMBER"]);
const SEA: ReadonlySet<RulesetUnitType> = new Set([
  "SUBMARINE",
  "DESTROYER",
  "CRUISER",
  "CARRIER",
  "BATTLESHIP",
  "TRANSPORT",
]);

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

function landUnit(unitTypeId: string): boolean {
  const kind = classifyUnit(unitTypeId);
  if (kind == null) {
    return true;
  }
  return !AIR.has(kind) && !SEA.has(kind);
}

/**
 * One step's movement cost. Mountain and snow spend whatever is left, so the
 * unit can enter and then stop. Armor and mechanised infantry spend half a
 * point only when the step stays inside desert.
 */
export function movementEnterCost(
  state: GameState,
  unitTypeId: string,
  fromRegionId: string,
  intoRegionId: string,
  range: number,
  dist: number,
): number {
  if (!terrainActive(state) || unitTypeId === "" || !landUnit(unitTypeId)) {
    return 1;
  }
  const into = coverOf(state, intoRegionId);
  if (into === "MOUNTAIN" || into === "SNOW") {
    const remaining = range - dist;
    return remaining > 0 ? remaining : 1;
  }
  if (into === "DESERT" && coverOf(state, fromRegionId) === "DESERT" && (isArmorClass(unitTypeId) || isMechClass(unitTypeId))) {
    return 0.5;
  }
  return 1;
}

/** A land unit that has entered mountain or snow cannot blitz onward. */
export function blitzBlocked(state: GameState, unitTypeId: string, regionId: string): boolean {
  if (!terrainActive(state) || !landUnit(unitTypeId)) {
    return false;
  }
  const cover = coverOf(state, regionId);
  return cover === "MOUNTAIN" || cover === "SNOW";
}

/** Urban and forest can be quieted. Mountain never is. */
export function coverSuppressed(state: GameState, regionId: string): boolean {
  const cover = coverOf(state, regionId);
  if (cover === "MOUNTAIN" || cover === "SNOW" || cover === "DESERT" || cover === "OPEN") {
    return false;
  }
  const until = state.terrainSuppressed[regionId] ?? 0;
  return until > 0 && state.game_round <= until;
}

function experienceOf(state: GameState, unitId: string): number {
  return state.unitExperience[unitId]?.xp ?? 0;
}

/** The defenders who receive the cover bonus, lowest experience first. */
export function coverInfantry(state: GameState, units: BattleUnitState[], cap: number): Set<string> {
  const infantry = units
    .filter((unit) => unit.hp > 0 && classifyUnit(unit.unit_type_id) === "INFANTRY")
    .sort((a, b) => experienceOf(state, a.id) - experienceOf(state, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Set(infantry.slice(0, Math.min(cap, infantry.length)).map((unit) => unit.id));
}

/**
 * Terrain on top of the printed rank. Open ground, snow, and desert leave the
 * roll alone. A suppressed city or wood loses its cover until the turn passes.
 */
export function adjustCombatRank(
  state: GameState,
  regionId: string,
  units: BattleUnitState[],
  unit: BattleUnitState,
  side: BattleSide,
  rank: number,
  _round: number,
): number {
  if (!terrainActive(state)) {
    return rank;
  }
  const cover = coverOf(state, regionId);
  const quiet = coverSuppressed(state, regionId);
  if (side === "defender" && !quiet && (cover === "URBAN" || cover === "MOUNTAIN")) {
    const cap = cover === "URBAN" ? 3 : 2;
    if (coverInfantry(state, units, cap).has(unit.id)) {
      return rank + 1;
    }
  }
  if (side === "attacker" && cover === "FOREST" && !quiet && isArmorClass(unit.unit_type_id)) {
    return Math.max(0, rank - 1);
  }
  return rank;
}

/**
 * Each artillery raises one infantry or Chinese guerrilla from 1 to 2.
 * Guns already spent by the classic pairing are not spent again.
 */
export function pairArtillery(
  units: BattleUnitState[],
  ranks: Map<string, number>,
  unitTypes: Record<string, Unit>,
): Map<string, number> {
  const guns = units.filter((unit) => unit.hp > 0 && isArtilleryClass(unit.unit_type_id)).length;
  if (guns === 0) {
    return ranks;
  }
  const eligible = units.filter((unit) => {
    const kind = classifyUnit(unit.unit_type_id);
    return unit.hp > 0 && (kind === "INFANTRY" || kind === "CHINESE_GUERRILLA");
  });
  let used = 0;
  for (const unit of eligible) {
    const printed = unitTypes[unit.unit_type_id]?.attack ?? 0;
    if ((ranks.get(unit.id) ?? 0) > printed) {
      used += 1;
    }
  }
  const open = eligible
    .filter((unit) => {
      const printed = unitTypes[unit.unit_type_id]?.attack ?? 0;
      return printed < 2 && (ranks.get(unit.id) ?? 0) <= printed;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = new Map(ranks);
  for (const unit of open.slice(0, Math.max(0, guns - used))) {
    next.set(unit.id, 2);
  }
  return next;
}

export function guerrillaSurpriseActive(state: GameState, regionId: string): boolean {
  if (!terrainActive(state)) {
    return false;
  }
  const cover = coverOf(state, regionId);
  return cover === "FOREST" || cover === "MOUNTAIN";
}

/**
 * Attacking guerrillas in a wood or on a mountain may leave at the end of a
 * round. Returns the pieces that go, or null when the request is not a slip.
 */
export function guerrillaSlipAway(
  state: GameState,
  regionId: string,
  attackers: BattleUnitState[],
  unitIds: readonly string[],
): BattleUnitState[] | null {
  if (!guerrillaSurpriseActive(state, regionId) || unitIds.length === 0) {
    return null;
  }
  const wanted = new Set(unitIds);
  const leaving = attackers.filter(
    (unit) => unit.hp > 0 && !unit.amphibious && wanted.has(unit.id) && classifyUnit(unit.unit_type_id) === "CHINESE_GUERRILLA",
  );
  if (leaving.length !== wanted.size) {
    return null;
  }
  return leaving;
}
