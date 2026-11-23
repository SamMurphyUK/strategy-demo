import type { BattleSide, BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";
import type { Region } from "../../model/region";
import { classifyUnit, type RulesetUnitType } from "../../types/ruleset";
import { consumeInterceptFighters, interceptingFighters } from "./airAndNavalRaiding";
import { coverOf, coverSuppressed } from "./terrainResolver";

export type FacilityTarget = "airbase" | "harbor" | "depot";

export interface BombDie {
  unitId: string;
  side: BattleSide;
  rank: number;
  roll: number;
  hit: boolean;
  kind: "aa" | "escort" | "interceptor" | "suppression" | "damage";
}

export interface BombLoss {
  unitId: string;
  side: BattleSide;
}

export function preparatoryActive(state: GameState, regionId: string): boolean {
  const rules = state.rulesetConfig;
  if (!rules.terrainModifiers || !rules.preparatoryBombardment) {
    return false;
  }
  const cover = coverOf(state, regionId);
  return (cover === "URBAN" || cover === "FOREST") && !coverSuppressed(state, regionId);
}

export function assignedSuppression(state: GameState, unit: BattleUnitState): boolean {
  if (unit.hp <= 0 || !state.forfeitOpening[unit.id]) {
    return false;
  }
  const kind = classifyUnit(unit.unit_type_id);
  return kind === "ARTILLERY" || kind === "HEAVY_BOMBER" || kind === "TACTICAL_BOMBER";
}

export function suppressionBomber(state: GameState, unit: BattleUnitState): boolean {
  if (!assignedSuppression(state, unit)) {
    return false;
  }
  const kind = classifyUnit(unit.unit_type_id);
  return kind === "HEAVY_BOMBER" || kind === "TACTICAL_BOMBER";
}

/** Fighters marked to fly the opening escort. They sit out the first normal round. */
export function assignEscort(state: GameState, unitIds: string[]): void {
  if (!state.rulesetConfig.terrainModifiers || !state.rulesetConfig.preparatoryBombardment) {
    return;
  }
  for (const id of unitIds) {
    if (id !== "") {
      state.escortDuty[id] = true;
    }
  }
}

export function baseOutput(region: Region): number {
  return region.base_output > 0 ? region.base_output : region.ipc_value;
}

export function factoryBuildCap(state: GameState, region: Region): number {
  const tokens = Math.max(0, Math.trunc(state.repairTokens[region.id] ?? 0));
  return Math.max(0, baseOutput(region) - tokens);
}

export function depotBuildsBlocked(state: GameState, regionId: string): boolean {
  if (!state.rulesetConfig.facilitiesAndPatrols) {
    return false;
  }
  const region = state.regions[regionId];
  if (region == null || !region.forward_depot) {
    return false;
  }
  const until = state.depotDisabledUntil[regionId] ?? 0;
  return until > 0 && state.game_round <= until;
}

export function heavyBombersActive(state: GameState, factionId: string): boolean {
  if (!state.rulesetConfig.techTree) {
    return false;
  }
  return (state.researchUnlocked[factionId] ?? []).includes("heavy_bombers");
}

function veteran(state: GameState, unitId: string): boolean {
  return state.unitExperience[unitId]?.veteran === true;
}

function byId(a: BattleUnitState, b: BattleUnitState): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function dieFace(roll: () => number): number {
  const face = Math.trunc(roll());
  if (face < 1) {
    return 1;
  }
  return face > 6 ? 6 : face;
}

function aaGun(state: GameState, unit: BattleUnitState): boolean {
  if (unit.hp <= 0) {
    return false;
  }
  const id = unit.unit_type_id.trim().toLowerCase();
  if (id === "aa" || id === "aaa" || id === "aa_gun" || id === "anti_aircraft") {
    return true;
  }
  return Boolean(state.unit_types[unit.unit_type_id]?.special?.is_aa);
}

export function suppressionHitOn(cover: "URBAN" | "FOREST", unitTypeId: string): number {
  const artillery = classifyUnit(unitTypeId) === "ARTILLERY";
  if (cover === "URBAN") {
    return artillery ? 2 : 4;
  }
  return artillery ? 1 : 2;
}

/**
 * Pre-round suppression. AA shoots the assigned bombers, escorts fight one round,
 * then the surviving guns and bombers roll to quiet the city or the wood.
 */
export function planPreparatorySuppression(
  state: GameState,
  regionId: string,
  attackers: BattleUnitState[],
  defenders: BattleUnitState[],
  roll: () => number,
): { dice: BombDie[]; casualties: BombLoss[]; suppressed: boolean } {
  const cover = coverOf(state, regionId) === "FOREST" ? "FOREST" : "URBAN";
  const dice: BombDie[] = [];
  const dead = new Set<string>();
  const casualties: BombLoss[] = [];

  const bombers = attackers.filter((unit) => suppressionBomber(state, unit)).sort((a, b) => {
    const experience = Number(veteran(state, a.id)) - Number(veteran(state, b.id));
    return experience !== 0 ? experience : byId(a, b);
  });
  const guns = defenders.filter((unit) => aaGun(state, unit));
  if (guns.length > 0) {
    let hits = 0;
    for (let i = 0; i < bombers.length; i++) {
      const face = dieFace(roll);
      const hit = face <= 1;
      dice.push({ unitId: guns[i % guns.length].id, side: "defender", rank: 1, roll: face, hit, kind: "aa" });
      if (hit) {
        hits += 1;
      }
    }
    for (const bomber of bombers.slice(0, hits)) {
      dead.add(bomber.id);
      casualties.push({ unitId: bomber.id, side: "attacker" });
    }
  }

  const escorts = attackers
    .filter((unit) => unit.hp > 0 && state.escortDuty[unit.id] === true && classifyUnit(unit.unit_type_id) === "FIGHTER")
    .sort(byId);
  const interceptors = defenders
    .filter((unit) => unit.hp > 0 && classifyUnit(unit.unit_type_id) === "FIGHTER")
    .sort(byId);
  let escortHits = 0;
  for (const escort of escorts) {
    const face = dieFace(roll);
    const hit = face <= 1;
    dice.push({ unitId: escort.id, side: "attacker", rank: 1, roll: face, hit, kind: "escort" });
    if (hit) {
      escortHits += 1;
    }
  }
  let interceptorHits = 0;
  for (const fighter of interceptors) {
    const face = dieFace(roll);
    const hit = face <= 2;
    dice.push({ unitId: fighter.id, side: "defender", rank: 2, roll: face, hit, kind: "interceptor" });
    if (hit) {
      interceptorHits += 1;
    }
  }
  for (const fighter of interceptors.slice(0, escortHits)) {
    dead.add(fighter.id);
    casualties.push({ unitId: fighter.id, side: "defender" });
  }
  for (const escort of escorts.slice(0, interceptorHits)) {
    dead.add(escort.id);
    casualties.push({ unitId: escort.id, side: "attacker" });
  }

  let suppressed = false;
  const firing = attackers.filter((unit) => assignedSuppression(state, unit) && !dead.has(unit.id)).sort(byId);
  for (const unit of firing) {
    const rank = suppressionHitOn(cover, unit.unit_type_id);
    const face = dieFace(roll);
    const hit = face <= rank;
    dice.push({ unitId: unit.id, side: "attacker", rank, roll: face, hit, kind: "suppression" });
    if (hit) {
      suppressed = true;
    }
  }
  return { dice, casualties, suppressed };
}

function countClass(state: GameState, regionId: string, factionId: string, kind: RulesetUnitType): number {
  let total = 0;
  for (const entry of state.region_units[regionId] ?? []) {
    if (entry.faction_id !== factionId || entry.instance_id) {
      continue;
    }
    if (classifyUnit(String(entry.unit_type_id ?? "")) !== kind) {
      continue;
    }
    total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  }
  return total;
}

function removeClass(state: GameState, regionId: string, factionId: string, kind: RulesetUnitType, count: number): void {
  let left = count;
  const units = state.region_units[regionId] ?? [];
  for (let i = units.length - 1; i >= 0 && left > 0; i--) {
    const entry = units[i];
    if (entry.faction_id !== factionId || entry.instance_id) {
      continue;
    }
    if (classifyUnit(String(entry.unit_type_id ?? "")) !== kind) {
      continue;
    }
    const have = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    if (have > left) {
      entry.count = have - left;
      left = 0;
    } else {
      left -= have;
      units.splice(i, 1);
    }
  }
}

/** Fighters that set isPatrolling on a station covering this raid. */
export function patrollingFighters(state: GameState, defenderFactionId: string, regionId: string): number {
  return interceptingFighters(state, defenderFactionId, regionId);
}

function removePatrollingFighters(state: GameState, defenderFactionId: string, regionId: string, count: number): void {
  consumeInterceptFighters(state, defenderFactionId, regionId, count);
}

export interface IndustrialRaid {
  bomberLosses: number;
  escortLosses: number;
  interceptorLosses: number;
  damage: number;
  tokens: number;
}

/**
 * Facility AA, then one escort round, then 1d6 damage from each surviving heavy bomber.
 * Heavy Bombers research rolls 2d6. Tokens stop at twice the territory's base output.
 */
export function runIndustrialBombing(
  state: GameState,
  attackerFactionId: string,
  regionId: string,
  escortCount: number,
  roll: () => number,
  bomberLimit?: number,
): { error: string } | IndustrialRaid {
  if (!state.rulesetConfig.facilitiesAndPatrols) {
    return { error: "Facilities are off" };
  }
  const region = state.regions[regionId];
  if (region == null || !region.major_factory) {
    return { error: "Region is not a major factory" };
  }
  const present = countClass(state, regionId, attackerFactionId, "HEAVY_BOMBER");
  const bombers = bomberLimit == null ? present : Math.min(present, Math.max(0, Math.trunc(bomberLimit)));
  if (bombers <= 0) {
    return { error: "No heavy bombers" };
  }
  const escorts = Math.min(Math.max(0, Math.trunc(escortCount)), countClass(state, regionId, attackerFactionId, "FIGHTER"));
  const owner = region.owner_faction_id;
  const interceptors = patrollingFighters(state, owner, regionId);

  let bomberLosses = 0;
  for (let i = 0; i < bombers; i++) {
    if (dieFace(roll) <= 1) {
      bomberLosses += 1;
    }
  }
  let escortHits = 0;
  for (let i = 0; i < escorts; i++) {
    if (dieFace(roll) <= 1) {
      escortHits += 1;
    }
  }
  let interceptorHits = 0;
  for (let i = 0; i < interceptors; i++) {
    if (dieFace(roll) <= 2) {
      interceptorHits += 1;
    }
  }
  const escortLosses = Math.min(escorts, interceptorHits);
  const interceptorLosses = Math.min(interceptors, escortHits);
  const surviving = bombers - bomberLosses;
  const dicePerBomber = heavyBombersActive(state, attackerFactionId) ? 2 : 1;
  let damage = 0;
  for (let i = 0; i < surviving * dicePerBomber; i++) {
    damage += dieFace(roll);
  }
  const cap = 2 * baseOutput(region);
  const prior = Math.max(0, Math.trunc(state.repairTokens[regionId] ?? 0));
  const tokens = Math.min(cap, prior + damage);
  removeClass(state, regionId, attackerFactionId, "HEAVY_BOMBER", bomberLosses);
  removeClass(state, regionId, attackerFactionId, "FIGHTER", escortLosses);
  removePatrollingFighters(state, owner, regionId, interceptorLosses);
  if (tokens <= 0) {
    delete state.repairTokens[regionId];
  } else {
    state.repairTokens[regionId] = tokens;
  }
  return { bomberLosses, escortLosses, interceptorLosses, damage, tokens };
}

export interface InterdictionRaid {
  hits: number;
  disabledUntil: number;
}

/** One attack roll per tactical bomber. A single hit closes the facility through the next round. */
export function runInterdiction(
  state: GameState,
  attackerFactionId: string,
  regionId: string,
  facility: FacilityTarget,
  roll: () => number,
  bomberLimit?: number,
  kind: "TACTICAL_BOMBER" | "HEAVY_BOMBER" = "TACTICAL_BOMBER",
): { error: string } | InterdictionRaid {
  if (!state.rulesetConfig.facilitiesAndPatrols) {
    return { error: "Facilities are off" };
  }
  const region = state.regions[regionId];
  if (region == null) {
    return { error: "No such region" };
  }
  if (facility === "airbase" && !region.airbase) {
    return { error: "No airbase" };
  }
  if (facility === "harbor" && !region.harbor) {
    return { error: "No harbor" };
  }
  if (facility === "depot" && !region.forward_depot) {
    return { error: "No depot" };
  }
  const attack = attackOf(state, regionId, attackerFactionId, kind);
  const present = countClass(state, regionId, attackerFactionId, kind);
  const bombers = bomberLimit == null ? present : Math.min(present, Math.max(0, Math.trunc(bomberLimit)));
  if (bombers <= 0) {
    return { error: "No tactical bombers" };
  }
  let hits = 0;
  for (let i = 0; i < bombers; i++) {
    if (dieFace(roll) <= attack) {
      hits += 1;
    }
  }
  if (hits <= 0) {
    return { hits: 0, disabledUntil: 0 };
  }
  const until = state.game_round + 1;
  if (facility === "airbase") {
    region.airbase_disabled_until = until;
  } else if (facility === "harbor") {
    region.harbor_disabled_until = until;
  } else {
    state.depotDisabledUntil[regionId] = until;
  }
  return { hits, disabledUntil: until };
}

function attackOf(state: GameState, regionId: string, factionId: string, kind: RulesetUnitType): number {
  for (const entry of state.region_units[regionId] ?? []) {
    if (entry.faction_id !== factionId) {
      continue;
    }
    if (classifyUnit(String(entry.unit_type_id ?? "")) !== kind) {
      continue;
    }
    return Math.max(0, Math.trunc(Number(state.unit_types[String(entry.unit_type_id ?? "")]?.attack ?? 0)));
  }
  return 0;
}

export interface RepairPlan {
  spend: number;
  lines: { regionId: string; spend: number }[];
}

/** Checks every repair line before any Industrial Output is spent. */
export function planPurchaseRepairs(state: GameState, factionId: string, lines: { regionId: string; tokens: number }[]): { error: string } | RepairPlan {
  if (!state.rulesetConfig.facilitiesAndPatrols) {
    return { error: "Facilities are off." };
  }
  const planned: { regionId: string; spend: number }[] = [];
  let spend = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    const region = state.regions[line.regionId];
    if (region == null || region.owner_faction_id !== factionId) {
      return { error: "That factory is not yours." };
    }
    if (seen.has(line.regionId)) {
      return { error: "Nothing to repair." };
    }
    seen.add(line.regionId);
    const have = Math.max(0, Math.trunc(state.repairTokens[line.regionId] ?? 0));
    const want = Math.max(0, Math.trunc(line.tokens));
    const take = Math.min(have, want);
    if (take <= 0) {
      return { error: "Nothing to repair." };
    }
    planned.push({ regionId: line.regionId, spend: take });
    spend += take;
  }
  if (spend <= 0) {
    return { error: "Nothing to repair." };
  }
  if (state.getFactionIpc(factionId) < spend) {
    return { error: "Not enough Industrial Output." };
  }
  return { spend, lines: planned };
}

export function commitPurchaseRepairs(state: GameState, factionId: string, plan: RepairPlan): void {
  state.modifyIpc(factionId, -plan.spend);
  for (const line of plan.lines) {
    const left = Math.max(0, Math.trunc(state.repairTokens[line.regionId] ?? 0)) - line.spend;
    if (left <= 0) {
      delete state.repairTokens[line.regionId];
    } else {
      state.repairTokens[line.regionId] = left;
    }
  }
}

/** One Industrial Output repairs one token during purchase. The owner pays. */
export function purchaseRepair(state: GameState, factionId: string, regionId: string, tokens: number): string {
  const plan = planPurchaseRepairs(state, factionId, [{ regionId, tokens }]);
  if ("error" in plan) {
    return plan.error;
  }
  commitPurchaseRepairs(state, factionId, plan);
  return "";
}
