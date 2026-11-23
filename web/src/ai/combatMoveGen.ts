import { canReturnAfter, isAirUnit } from "../engine/air/air_fuel";
import type { GameState } from "../engine/model/game_state";
import { MovementValidator } from "../engine/movement/movement_validator";
import { baseOutput } from "../engine/rules/optional/bombingResolver";
import { coverOf, coverSuppressed } from "../engine/rules/optional/terrainResolver";
import type { Ruleset } from "../engine/rules/ruleset";
import { assaultError } from "../engine/transport/cargo_rules";
import { classifyUnit, type RulesetUnitType } from "../engine/types/ruleset";
import { simulateBattleOdds } from "./battleOddsSim";
import { threatAt, type TileThreat } from "./threatMap";
import type { AIDifficultyProfile, CommanderWeights } from "./types/aiTypes";

export type PackageKind = "trade" | "hold" | "suppression" | "amphibious" | "naval_raid" | "strategic_bomb";

export interface PackageStack {
  from: string;
  unitType: string;
  count: number;
  assignedToSuppression?: boolean;
  isEscort?: boolean;
}

export interface AttackPackage {
  kind: PackageKind;
  to: string;
  stacks: PackageStack[];
  win: number;
  survival: number;
  cheap: boolean;
  value: number;
  committedTuv: number;
  expectedTuvSwing: number;
  expectedProductionSwing: number;
  survivingAttackers: number;
  deadZone?: boolean;
  transportId?: string;
  originSea?: string;
}

interface Reachable {
  from: string;
  unitType: string;
  count: number;
  cost: number;
  attack: number;
  defense: number;
  kind: RulesetUnitType | null;
  category: string;
  destinations: string[];
}

const PACKAGE_CAP = 12;
const TRADE_INFANTRY = 2;

function isCheapKind(kind: RulesetUnitType | null): boolean {
  return kind === "INFANTRY" || kind === "ARTILLERY" || kind === "CHINESE_GUERRILLA";
}

function stack(from: string, unitType: string, count: number, extra: Partial<PackageStack> = {}): PackageStack {
  return { from, unitType, count, ...extra };
}

function take(units: readonly Reachable[], kind: RulesetUnitType, count: number, extra: Partial<PackageStack> = {}): PackageStack[] {
  const out: PackageStack[] = [];
  let need = count;
  for (const unit of units) {
    if (unit.kind !== kind || need <= 0) {
      continue;
    }
    const n = Math.min(need, unit.count);
    if (n > 0) {
      out.push(stack(unit.from, unit.unitType, n, extra));
      need -= n;
    }
  }
  return out;
}

function defenseRanks(state: GameState, regionId: string, factionId: string): number[] {
  const out: number[] = [];
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId)) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    if (unit == null || unit.defense <= 0) {
      continue;
    }
    const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    for (let i = 0; i < count; i += 1) {
      out.push(unit.defense);
    }
  }
  return out;
}

function defenderTuv(state: GameState, regionId: string, factionId: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId)) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    total += count * Math.max(0, unit?.cost ?? 0);
  }
  return total;
}

function defendingInfantry(state: GameState, regionId: string, factionId: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId)) {
      continue;
    }
    const kind = classifyUnit(String(entry.unit_type_id ?? ""));
    if (kind === "INFANTRY" || kind === "CHINESE_GUERRILLA") {
      total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

function enemyFighters(state: GameState, regionId: string, factionId: string): number {
  let total = defendingCount(state, regionId, factionId, "FIGHTER");
  for (const near of state.getAdjacentRegions(regionId)) {
    total += defendingCount(state, near, factionId, "FIGHTER");
  }
  return total;
}

function defendingCount(state: GameState, regionId: string, factionId: string, kind: RulesetUnitType): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId)) {
      continue;
    }
    if (classifyUnit(String(entry.unit_type_id ?? "")) !== kind) {
      continue;
    }
    total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  }
  return total;
}

function accept(
  state: GameState,
  factionId: string,
  kind: PackageKind,
  to: string,
  stacks: PackageStack[],
  defenders: readonly number[],
  profile: AIDifficultyProfile,
  weights: CommanderWeights,
  value: number,
  seed: number,
  cheap: boolean,
  extra: Partial<AttackPackage> = {},
): AttackPackage | null {
  if (stacks.length === 0 || stacks.every((line) => line.count <= 0)) {
    return null;
  }
  const ranks: number[] = [];
  let committed = 0;
  let bodies = 0;
  for (const line of stacks) {
    const unit = state.unit_types[line.unitType];
    const cost = Math.max(0, unit?.cost ?? 0);
    committed += cost * line.count;
    bodies += line.count;
    if (line.assignedToSuppression || line.isEscort) {
      continue;
    }
    const attack = Math.max(0, unit?.attack ?? 0);
    if (attack <= 0) {
      continue;
    }
    for (let i = 0; i < line.count; i += 1) {
      ranks.push(attack);
    }
  }
  const odds = simulateBattleOdds(ranks, defenders, profile.fastOddsIterations, seed, state.rulesetConfig);
  const bar = cheap ? weights.tradeWinThreshold : weights.holdWinThreshold;
  if (odds.win < bar) {
    return null;
  }
  if (!cheap && odds.survival < weights.holdSurvivalThreshold) {
    return null;
  }
  const prize = defenderTuv(state, to, factionId);
  return {
    kind,
    to,
    stacks,
    win: odds.win,
    survival: odds.survival,
    cheap,
    value,
    committedTuv: committed,
    expectedTuvSwing: odds.win * prize - (1 - odds.survival) * committed,
    expectedProductionSwing: odds.win * (state.regions[to] != null ? baseOutput(state.regions[to]) : 0),
    survivingAttackers: odds.survivingAttackers || (odds.win > 0 ? bodies : 0),
    ...extra,
  };
}

/**
 * Legal attack packages. Destinations come from the movement rules.
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
  const reachable: Reachable[] = [];
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
      if (entry.instance_id != null && String(entry.instance_id) !== "") {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      const unit = state.unit_types[unitType];
      if (unit == null || unit.attack <= 0) {
        continue;
      }
      const have = state.movableStackCount(factionId, regionId, unitType);
      if (have <= 0) {
        continue;
      }
      const destinations = validator
        .getLegalDestinationsForStack(regionId, unitType, factionId, state, ruleset)
        .filter((dest) => state.isRegionHostileTo(dest, factionId));
      const legal = destinations.filter(
        (dest) => !isAirUnit(state, unitType) || canReturnAfter(state, factionId, unitType, regionId, dest, have),
      );
      if (legal.length === 0) {
        continue;
      }
      reachable.push({
        from: regionId,
        unitType,
        count: have,
        cost: unit.cost,
        attack: unit.attack,
        defense: unit.defense,
        kind: classifyUnit(unitType),
        category: unit.category,
        destinations: legal,
      });
    }
  }

  const found: AttackPackage[] = [];
  const targets = new Set<string>();
  for (const unit of reachable) {
    if (unit.category === "sea") {
      continue;
    }
    for (const dest of unit.destinations) {
      if (state.regions[dest]?.isLandRegion() === true) {
        targets.add(dest);
      }
    }
  }

  let serial = seed;
  for (const to of targets) {
    const here = reachable.filter((unit) => unit.category !== "sea" && unit.destinations.includes(to));
    const zone = threatAt(tiles, to).zoneClassification;
    const dead = zone === "DEAD_ZONE";
    const defenders = defenseRanks(state, to, factionId);
    const value = threatAt(tiles, to).strategicValue;
    const cover = coverOf(state, to);
    const trade: PackageStack[] = [];
    if (state.rulesetConfig.terrainModifiers && (cover === "FOREST" || cover === "MOUNTAIN")) {
      trade.push(...take(here, "CHINESE_GUERRILLA", 1));
    }
    if (trade.length === 0) {
      trade.push(...take(here, "INFANTRY", TRADE_INFANTRY));
      trade.push(...take(here, "ARTILLERY", 1));
    }
    const traded = accept(state, factionId, "trade", to, trade, defenders, profile, weights, value, serial, true);
    serial += 1;
    const suppress =
      state.rulesetConfig.preparatoryBombardment === true &&
      state.rulesetConfig.terrainModifiers === true &&
      (cover === "URBAN" || cover === "FOREST") &&
      !coverSuppressed(state, to) &&
      defendingInfantry(state, to, factionId) >= 2;
    let fired: AttackPackage | null = null;
    if (suppress) {
      const guns = [...take(here, "ARTILLERY", 2, { assignedToSuppression: true }), ...take(here, "HEAVY_BOMBER", 2, { assignedToSuppression: true })];
      const quiet = guns.slice(0, 2);
      const withInfantry = [...take(here, "INFANTRY", 99), ...quiet];
      if (enemyFighters(state, to, factionId) > 0) {
        withInfantry.push(...take(here, "FIGHTER", 1, { isEscort: true }));
      }
      fired = accept(state, factionId, "suppression", to, withInfantry, defenders, profile, weights, value, serial, true);
      serial += 1;
    }
    if (fired != null) {
      fired.deadZone = dead;
      found.push(fired);
    } else if (traded != null) {
      traded.deadZone = dead;
      found.push(traded);
    } else if (!dead) {
      const infantry = take(here, "INFANTRY", 99);
      const infantryCount = infantry.reduce((sum, line) => sum + line.count, 0);
      const hold = [
        ...infantry,
        ...take(here, "ARTILLERY", infantryCount),
        ...take(here, "ARMOR", 99),
        ...take(here, "FIGHTER", 99),
        ...take(here, "TACTICAL_BOMBER", 99),
      ];
      const held = accept(state, factionId, "hold", to, hold, defenders, profile, weights, value, serial, false);
      serial += 1;
      if (held != null) {
        held.deadZone = dead;
        found.push(held);
      }
    }

    const factory = state.regions[to];
    if (state.rulesetConfig.facilitiesAndPatrols && factory?.major_factory === true) {
      const bombers = take(here, "HEAVY_BOMBER", 99);
      const bomberCount = bombers.reduce((sum, line) => sum + line.count, 0);
      const bomberCost = bombers.reduce((sum, line) => sum + line.count * (state.unit_types[line.unitType]?.cost ?? 0), 0);
      const tokens = bomberCount * (5 / 6) * 3.5;
      const loss = bomberCount * (1 / 6) * (bomberCost / Math.max(1, bomberCount));
      if (bomberCount > 0 && tokens > loss) {
        const escorts = enemyFighters(state, to, factionId) > 0 ? take(here, "FIGHTER", bomberCount, { isEscort: true }) : [];
        const raid = accept(
          state,
          factionId,
          "strategic_bomb",
          to,
          [...bombers, ...escorts],
          defenseRanks(state, to, factionId).length > 0 ? defenders : [],
          profile,
          weights,
          tokens,
          serial,
          false,
        );
        serial += 1;
        if (raid != null) {
          found.push(raid);
        }
      }
    }
  }

  if (state.current_phase === "combat_move") {
    for (const [transportId, transport] of Object.entries(state.transport_instances)) {
      const sea = String(transport.region_id ?? "");
      const cargo = (transport.cargo ?? []).filter((line) => Math.trunc(Number(line.count ?? 0)) > 0);
      if (sea === "" || cargo.length === 0) {
        continue;
      }
      for (const to of state.getAdjacentRegions(sea)) {
        if (state.regions[to]?.isLandRegion() !== true || !state.isRegionHostileTo(to, factionId)) {
          continue;
        }
        if (assaultError(state, factionId, transportId, sea, to) != null) {
          continue;
        }
        const dead = threatAt(tiles, to).zoneClassification === "DEAD_ZONE";
        const lines: PackageStack[] = [];
        for (const line of cargo) {
          const unitType = String(line.unit_type_id ?? "");
          const kind = classifyUnit(unitType);
          if (dead && !isCheapKind(kind)) {
            continue;
          }
          lines.push(stack(sea, unitType, Math.trunc(Number(line.count ?? 0))));
        }
        for (const entry of state.getUnitsInRegion(sea)) {
          if (String(entry.faction_id ?? "") !== factionId) {
            continue;
          }
          const unitType = String(entry.unit_type_id ?? "");
          const kind = classifyUnit(unitType);
          if (kind !== "BATTLESHIP" && kind !== "CRUISER") {
            continue;
          }
          lines.push(stack(sea, unitType, Math.max(0, Math.trunc(Number(entry.count ?? 1)))));
        }
        const landed = accept(
          state,
          factionId,
          "amphibious",
          to,
          lines.filter((line) => classifyUnit(line.unitType) !== "BATTLESHIP" && classifyUnit(line.unitType) !== "CRUISER"),
          defenseRanks(state, to, factionId),
          profile,
          weights,
          threatAt(tiles, to).strategicValue,
          serial,
          dead || lines.every((line) => isCheapKind(classifyUnit(line.unitType))),
          { transportId, originSea: sea },
        );
        serial += 1;
        if (landed != null) {
          landed.stacks = lines;
          found.push(landed);
        }
      }
    }
  }

  if (state.rulesetConfig.facilitiesAndPatrols) {
    for (const unit of reachable) {
      if (unit.kind !== "DESTROYER" && unit.kind !== "CRUISER") {
        continue;
      }
      for (const to of state.getAdjacentRegions(unit.from)) {
        const target = state.regions[to];
        if (target == null) {
          continue;
        }
        const port = target.harbor === true || target.isSeaRegion();
        if (!port || !state.isRegionHostileTo(to, factionId)) {
          continue;
        }
        const sea = target.isSeaRegion() ? to : unit.from;
        if (defendingCount(state, sea, factionId, "DESTROYER") > 0) {
          continue;
        }
        const raid = accept(
          state,
          factionId,
          "naval_raid",
          to,
          [stack(unit.from, unit.unitType, Math.min(1, unit.count))],
          defenseRanks(state, sea, factionId),
          profile,
          weights,
          0,
          serial,
          false,
        );
        serial += 1;
        if (raid != null) {
          found.push(raid);
        }
      }
    }
  }

  found.sort((a, b) => {
    const left = (a.expectedTuvSwing + a.value) / Math.max(1, a.committedTuv);
    const right = (b.expectedTuvSwing + b.value) / Math.max(1, b.committedTuv);
    return right - left;
  });
  return found.slice(0, PACKAGE_CAP);
}
