// Battle rules shared by the interactive battle and auto-resolve. No state, no dice.
import type { BattleCasualty, BattleSide, BattleUnitState } from "../model/battle";
import type { Unit } from "../model/unit";

/** A die hits when it rolls at or under the firing rank. */
export function hitsOn(roll: number, rank: number): boolean {
  return roll <= rank;
}

/** A unit with hit points to spare absorbs the hit. Anything else is destroyed. */
export function resolveHit(hp: number, maxHp: number): "damaged" | "destroyed" {
  return maxHp > 1 && hp > 1 ? "damaged" : "destroyed";
}

export function isCombatUnit(unit: Unit | undefined): boolean {
  return unit != null && (unit.attack > 0 || unit.defense > 0);
}

const AA_AIR = new Set(["fighter", "tactical_bomber", "strategic_bomber"]);

export function isAaGun(unit: Unit | undefined): boolean {
  return Boolean(unit?.special?.is_aa);
}

/** One shot per attacking plane, and at most three shots from each gun. */
export function openingAaShots(guns: number, planes: number): number {
  return Math.min(Math.max(0, planes), Math.max(0, guns) * 3);
}

export function defendingAaGuns(units: BattleUnitState[], unitTypes: Record<string, Unit>): BattleUnitState[] {
  return units.filter((unit) => isAlive(unit) && isAaGun(unitTypes[unit.unit_type_id]));
}

export function attackingAircraft(units: BattleUnitState[]): BattleUnitState[] {
  return units.filter((unit) => isAlive(unit) && AA_AIR.has(unit.unit_type_id));
}

/** AA hits destroy the cheapest aircraft first. Each hit removes one plane. */
export function assignAaHits(
  planes: BattleUnitState[],
  hits: number,
  unitTypes: Record<string, Unit>,
): BattleCasualty[] {
  const order = planes.filter(isAlive).map((unit, index) => ({ unit, index }));
  order.sort((a, b) => {
    const cost = (unitTypes[a.unit.unit_type_id]?.cost ?? 0) - (unitTypes[b.unit.unit_type_id]?.cost ?? 0);
    if (cost !== 0) return cost;
    return a.index - b.index;
  });
  const plan: BattleCasualty[] = [];
  const take = Math.min(Math.max(0, hits), order.length);
  for (let i = 0; i < take; i++) {
    plan.push({ unit_id: order[i].unit.id, side: "attacker", result: "destroyed", aa: true });
  }
  return plan;
}

/** Bombardment hits the cheapest defending land unit. One hit removes one unit. */
export function assignBombardHits(
  defenders: BattleUnitState[],
  hits: number,
  unitTypes: Record<string, Unit>,
): BattleCasualty[] {
  const order = defenders
    .filter((unit) => isAlive(unit) && unitTypes[unit.unit_type_id]?.category === "land")
    .map((unit, index) => ({ unit, index }));
  order.sort((a, b) => {
    const cost = (unitTypes[a.unit.unit_type_id]?.cost ?? 0) - (unitTypes[b.unit.unit_type_id]?.cost ?? 0);
    if (cost !== 0) return cost;
    return a.index - b.index;
  });
  const plan: BattleCasualty[] = [];
  const take = Math.min(Math.max(0, hits), order.length);
  for (let i = 0; i < take; i++) {
    plan.push({ unit_id: order[i].unit.id, side: "defender", result: "destroyed", bombard: true });
  }
  return plan;
}

export function maxHpOf(unit: Unit | undefined): number {
  return unit?.special?.takes_two_hits ? 2 : 1;
}

export function isAlive(unit: BattleUnitState): boolean {
  return unit.hp > 0;
}

function canSubmerge(unit: Unit | undefined): boolean {
  return Boolean(unit?.special?.can_submerge || unit?.special?.requires_destroyer_to_be_hit_by_air);
}

/**
 * A submarine can be hit by a destroyer, by aircraft escorted by one, or by any
 * other ship that actually fires. Aircraft alone cannot touch it.
 */
export function enemyCanHitSubmarines(
  enemy: BattleUnitState[],
  enemySide: BattleSide,
  unitTypes: Record<string, Unit>,
): boolean {
  const living = enemy.filter(isAlive);
  if (living.some((unit) => Boolean(unitTypes[unit.unit_type_id]?.special?.cancels_submarine_abilities))) {
    return true;
  }
  return living.some((unit) => {
    const type = unitTypes[unit.unit_type_id];
    if (type == null || type.category === "air") {
      return false;
    }
    return (enemySide === "attacker" ? type.attack : type.defense) > 0;
  });
}

/** Submarines the other side cannot hit. They leave the battle and are not casualties. */
export function escapingSubmarines(
  own: BattleUnitState[],
  enemy: BattleUnitState[],
  enemySide: BattleSide,
  unitTypes: Record<string, Unit>,
): BattleUnitState[] {
  if (enemyCanHitSubmarines(enemy, enemySide, unitTypes)) {
    return [];
  }
  return own.filter((unit) => isAlive(unit) && canSubmerge(unitTypes[unit.unit_type_id]));
}

/** True when both sides still have someone in the fight after those submarines leave. */
export function hasCombatantsAfterEscape(
  attackers: BattleUnitState[],
  defenders: BattleUnitState[],
  unitTypes: Record<string, Unit>,
): boolean {
  const attackingLeave = new Set(escapingSubmarines(attackers, defenders, "defender", unitTypes).map((unit) => unit.id));
  const defendingLeave = new Set(escapingSubmarines(defenders, attackers, "attacker", unitTypes).map((unit) => unit.id));
  const attacking = attackers.some((unit) => isAlive(unit) && !attackingLeave.has(unit.id));
  const defending = defenders.some((unit) => isAlive(unit) && !defendingLeave.has(unit.id));
  return attacking && defending;
}

function special(unit: Unit | undefined, flag: string): boolean {
  return Boolean(unit?.special?.[flag]);
}

/**
 * Firing rank for each living unit. Attack uses `attack`, defence uses `defense`.
 * On attack, each artillery raises one infantry-type unit to its boost value, and each tank
 * or fighter raises one tactical bomber to 4. Pairing follows list order.
 */
export function firingRanks(
  units: BattleUnitState[],
  side: BattleSide,
  unitTypes: Record<string, Unit>,
): Map<string, number> {
  const ranks = new Map<string, number>();
  const living = units.filter(isAlive);
  for (const unit of living) {
    const type = unitTypes[unit.unit_type_id];
    ranks.set(unit.id, side === "attacker" ? (type?.attack ?? 0) : (type?.defense ?? 0));
  }
  if (side !== "attacker") {
    return ranks;
  }

  const boostable = living.filter((u) => special(unitTypes[u.unit_type_id], "can_be_boosted_by_artillery"));
  const artillery = living.filter((u) => special(unitTypes[u.unit_type_id], "boosts_infantry"));
  for (let i = 0; i < Math.min(boostable.length, artillery.length); i++) {
    const boostTo = Number(unitTypes[artillery[i].unit_type_id]?.special?.boosts_infantry_attack_to ?? 2);
    ranks.set(boostable[i].id, Math.max(ranks.get(boostable[i].id) ?? 0, boostTo));
  }

  // units.json has no flag on fighters, so the fighter partner is matched by id.
  const bombers = living.filter((u) => special(unitTypes[u.unit_type_id], "can_be_boosted_by_tanks"));
  const partners = living.filter(
    (u) => special(unitTypes[u.unit_type_id], "boosts_tactical_bomber") || u.unit_type_id === "fighter",
  );
  for (let i = 0; i < Math.min(bombers.length, partners.length); i++) {
    ranks.set(bombers[i].id, 4);
  }
  return ranks;
}

/**
 * Spend hits on the cheapest living unit, then the lower rank, then list order.
 * A two-hit unit takes the first hit as damage and stays in the queue, so two hits sink
 * a lone battleship. Returns the plan without changing the units.
 */
export interface HitBudget {
  /** Hits that can be taken by any unit. */
  any: number;
  /** Submarine fire: cannot be taken by aircraft. */
  skipAir: number;
  /** Aircraft fire with no friendly destroyer: cannot be taken by submarines. */
  skipSub: number;
}

function isAirPiece(unitTypes: Record<string, Unit>, unit: BattleUnitState): boolean {
  return unitTypes[unit.unit_type_id]?.category === "air";
}

function isSubPiece(unitTypes: Record<string, Unit>, unit: BattleUnitState): boolean {
  return Boolean(unitTypes[unit.unit_type_id]?.special?.requires_destroyer_to_be_hit_by_air);
}

/**
 * Spend a mixed volley. Submarine hits skip aircraft, and aircraft hits skip submarines
 * unless a destroyer already turned those into ordinary hits. Hits with no legal target are lost.
 */
export function restrictedCasualties(
  units: BattleUnitState[],
  budget: HitBudget,
  side: BattleSide,
  unitTypes: Record<string, Unit>,
  ranks: Map<string, number>,
): { plan: BattleCasualty[]; used: HitBudget } {
  const hp = new Map(units.map((u) => [u.id, u.hp]));
  const order = units.map((u, index) => ({ unit: u, index }));
  const plan: BattleCasualty[] = [];
  const used: HitBudget = { any: 0, skipAir: 0, skipSub: 0 };
  const pull = (kind: keyof HitBudget, ok: (unit: BattleUnitState) => boolean) => {
    let left = Math.max(0, budget[kind]);
    while (left > 0) {
      const living = order.filter(({ unit }) => (hp.get(unit.id) ?? 0) > 0 && ok(unit));
      if (living.length === 0) {
        break;
      }
      living.sort((a, b) => {
        const cost = (unitTypes[a.unit.unit_type_id]?.cost ?? 0) - (unitTypes[b.unit.unit_type_id]?.cost ?? 0);
        if (cost !== 0) return cost;
        const rank = (ranks.get(a.unit.id) ?? 0) - (ranks.get(b.unit.id) ?? 0);
        if (rank !== 0) return rank;
        return a.index - b.index;
      });
      const target = living[0].unit;
      const before = hp.get(target.id)!;
      const result = resolveHit(before, target.max_hp);
      hp.set(target.id, result === "damaged" ? before - 1 : 0);
      plan.push({ unit_id: target.id, side, result });
      used[kind] += 1;
      left -= 1;
    }
  };
  pull("skipAir", (unit) => !isAirPiece(unitTypes, unit));
  pull("skipSub", (unit) => !isSubPiece(unitTypes, unit));
  pull("any", () => true);
  return { plan, used };
}

/** True when `unitId` can take one hit from the budget that is still left. */
export function casualtyFitsBudget(
  unit: BattleUnitState,
  budget: HitBudget,
  unitTypes: Record<string, Unit>,
): keyof HitBudget | null {
  if (isAirPiece(unitTypes, unit)) {
    if (budget.any > 0) return "any";
    if (budget.skipSub > 0) return "skipSub";
    return null;
  }
  if (isSubPiece(unitTypes, unit)) {
    if (budget.any > 0) return "any";
    if (budget.skipAir > 0) return "skipAir";
    return null;
  }
  if (budget.skipAir > 0) return "skipAir";
  if (budget.skipSub > 0) return "skipSub";
  if (budget.any > 0) return "any";
  return null;
}

export function cheapestCasualties(
  units: BattleUnitState[],
  hits: number,
  side: BattleSide,
  unitTypes: Record<string, Unit>,
  ranks: Map<string, number>,
): BattleCasualty[] {
  const hp = new Map(units.map((u) => [u.id, u.hp]));
  const order = units.map((u, index) => ({ unit: u, index }));
  const plan: BattleCasualty[] = [];
  for (let i = 0; i < hits; i++) {
    const living = order.filter(({ unit }) => (hp.get(unit.id) ?? 0) > 0);
    if (living.length === 0) {
      break;
    }
    living.sort((a, b) => {
      const cost = (unitTypes[a.unit.unit_type_id]?.cost ?? 0) - (unitTypes[b.unit.unit_type_id]?.cost ?? 0);
      if (cost !== 0) return cost;
      const rank = (ranks.get(a.unit.id) ?? 0) - (ranks.get(b.unit.id) ?? 0);
      if (rank !== 0) return rank;
      return a.index - b.index;
    });
    const target = living[0].unit;
    const before = hp.get(target.id)!;
    const result = resolveHit(before, target.max_hp);
    hp.set(target.id, result === "damaged" ? before - 1 : 0);
    plan.push({ unit_id: target.id, side, result });
  }
  return plan;
}

export type BattleOutcome = "attacker_won" | "defender_won" | "mutual_destruction" | "undecided";

/** Both sides gone is mutual destruction: the attacker does not take the ground. */
export function battleOutcome(attackersAlive: number, defendersAlive: number): BattleOutcome {
  if (attackersAlive <= 0 && defendersAlive <= 0) return "mutual_destruction";
  if (defendersAlive <= 0) return "attacker_won";
  if (attackersAlive <= 0) return "defender_won";
  return "undecided";
}
