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

export function maxHpOf(unit: Unit | undefined): number {
  return unit?.special?.takes_two_hits ? 2 : 1;
}

export function isAlive(unit: BattleUnitState): boolean {
  return unit.hp > 0;
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
