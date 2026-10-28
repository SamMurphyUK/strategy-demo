// Combat decisions for the battle screen, with no rendering and no timers.
// The screen asks this module what happens, then plays the animation.
import { PCG } from "../engine/rng/pcg";
import {
  type BattlePhase,
  type TheaterId,
  UNIT_DEFINITIONS,
  type UnitType,
} from "./combatTypes";

/** One d6 in 1..6. `createBattleDice` builds one from the engine's seeded generator. */
export type DieRoll = () => number;

/** Same generator the map session uses. `rollD6` is unbiased, so a seed replays the same battle. */
export function createBattleDice(seed: number): DieRoll {
  const pcg = new PCG(seed, 1);
  return () => pcg.rollD6();
}

/** A roll hits when it is at or under the firing rank. */
export function hitsOn(roll: number, targetRank: number): boolean {
  return roll <= targetRank;
}

export interface RankedUnit {
  uid: string;
  type: UnitType;
  /** Still able to fight. Downed, pending and confirmed casualties are not. */
  active: boolean;
}

export interface ResolvedRank {
  uid: string;
  effectiveRank: number;
  hasSynergyBonus: boolean;
  pairedWithUid?: string;
}

const MARITIME: TheaterId[] = ["navy_test", "air_strike_test"];

function baseRank(type: UnitType, side: "attacker" | "defender", theater: TheaterId): number {
  const def = UNIT_DEFINITIONS[type];
  if (theater === "navy_test") {
    if (side === "attacker") {
      if (type === "carrier") return 1;
      if (type === "submarine" || type === "destroyer") return 2;
      if (type === "cruiser" || type === "fighter") return 3;
      if (type === "battleship") return 4;
    } else {
      if (type === "submarine") return 1;
      if (type === "destroyer" || type === "carrier") return 2;
      if (type === "cruiser") return 3;
      if (type === "battleship" || type === "fighter") return 4;
    }
  }
  return side === "attacker" ? def.baseAttackRank : def.baseDefenseRank;
}

/**
 * Firing ranks for one side. On land, each artillery raises one infantry to rank 2,
 * and each tank or fighter raises one tactical bomber to rank 4. Sea theaters do neither.
 * Pairing follows list order and only uses units that are still fighting.
 */
export function resolveRanks(
  units: RankedUnit[],
  side: "attacker" | "defender",
  theater: TheaterId,
): ResolvedRank[] {
  const resolved: ResolvedRank[] = units.map((unit) => ({
    uid: unit.uid,
    effectiveRank: baseRank(unit.type, side, theater),
    hasSynergyBonus: false,
  }));
  if (MARITIME.includes(theater)) {
    return resolved;
  }

  const byUid = new Map(resolved.map((rank) => [rank.uid, rank]));
  const active = units.filter((unit) => unit.active);

  const infantry = active.filter((unit) => unit.type === "infantry");
  const artillery = active.filter((unit) => unit.type === "artillery");
  const pairs = Math.min(infantry.length, artillery.length);
  for (let i = 0; i < pairs; i++) {
    const soldier = byUid.get(infantry[i].uid)!;
    const gun = byUid.get(artillery[i].uid)!;
    soldier.effectiveRank = 2;
    soldier.hasSynergyBonus = true;
    soldier.pairedWithUid = gun.uid;
    gun.pairedWithUid = soldier.uid;
  }

  const bombers = active.filter((unit) => unit.type === "tactical_bomber");
  const partners = active.filter((unit) => unit.type === "tank" || unit.type === "fighter");
  const bomberPairs = Math.min(bombers.length, partners.length);
  for (let i = 0; i < bomberPairs; i++) {
    const bomber = byUid.get(bombers[i].uid)!;
    bomber.effectiveRank = 4;
    bomber.hasSynergyBonus = true;
  }

  return resolved;
}

export function compareByCostThenRank(
  a: { type: UnitType; effectiveRank: number },
  b: { type: UnitType; effectiveRank: number },
): number {
  const costA = UNIT_DEFINITIONS[a.type].cost;
  const costB = UNIT_DEFINITIONS[b.type].cost;
  if (costA !== costB) return costA - costB;
  return a.effectiveRank - b.effectiveRank;
}

export interface HitTarget {
  uid: string;
  type: UnitType;
  rank: number;
  currentHp: number;
  maxHp: number;
}

export interface AssignedHit {
  uid: string;
  /** A ship with hit points left absorbs the hit. Anything else is removed. */
  result: "damaged" | "destroyed";
  hpAfter: number;
}

export function resolveHit(currentHp: number, maxHp: number): "damaged" | "destroyed" {
  if (maxHp > 1 && currentHp > 1) return "damaged";
  return "destroyed";
}

/**
 * Spend hits on the cheapest units first. A two-hit ship takes the first hit as damage
 * and can take the next one, so two hits on a lone battleship sink it.
 */
export function assignHits(units: HitTarget[], hits: number): AssignedHit[] {
  const hp = new Map(units.map((unit) => [unit.uid, unit.currentHp]));
  const assigned: AssignedHit[] = [];
  let remaining = hits;
  while (remaining > 0) {
    const living = units.filter((unit) => (hp.get(unit.uid) ?? 0) > 0);
    if (living.length === 0) break;
    living.sort((a, b) =>
      compareByCostThenRank({ type: a.type, effectiveRank: a.rank }, { type: b.type, effectiveRank: b.rank }),
    );
    const target = living[0];
    const before = hp.get(target.uid)!;
    const result = resolveHit(before, target.maxHp);
    const after = result === "damaged" ? before - 1 : 0;
    hp.set(target.uid, after);
    assigned.push({ uid: target.uid, result, hpAfter: after });
    remaining -= 1;
  }
  return assigned;
}

/** Each defending AA gun fires at most three shots, and never more shots than there are aircraft. */
export function aaShotCount(aaGuns: number, enemyAircraft: number): number {
  return Math.min(enemyAircraft, Math.max(0, aaGuns) * 3);
}

export interface FiringUnit {
  type: UnitType;
  active: boolean;
  effectiveRank: number;
  hasFiredThisRound: boolean;
  carrierFightersFired?: boolean;
}

/** Whether this side still has someone to shoot in the rank. Navy carriers also launch fighters at rank 4. */
export function rankCanFire(
  units: FiringUnit[],
  side: "attacker" | "defender",
  rank: number,
  theater: TheaterId,
): boolean {
  if (theater === "navy_test" && side === "defender" && rank === 4) {
    const fighters = units.some(
      (unit) =>
        unit.active &&
        ((unit.effectiveRank === 4 && !unit.hasFiredThisRound) ||
          (unit.type === "carrier" && !unit.carrierFightersFired)),
    );
    if (fighters) return true;
  }
  return units.some((unit) => unit.active && unit.effectiveRank === rank && !unit.hasFiredThisRound);
}

export interface PhaseQuery {
  theater: TheaterId;
  round: number;
  current: BattlePhase;
  /** True once the opening anti-aircraft roll has been taken. */
  aaResolved: boolean;
  /** True once the Normandy offshore battleship has fired. */
  shoreFired: boolean;
  attackers: FiringUnit[];
  defenders: FiringUnit[];
}

function firstRank(query: PhaseQuery, side: "attacker" | "defender"): BattlePhase | null {
  const units = side === "attacker" ? query.attackers : query.defenders;
  for (let rank = 1; rank <= 4; rank++) {
    if (rankCanFire(units, side, rank, query.theater)) {
      return `${side === "attacker" ? "ATK" : "DEF"}_RANK_${rank}` as BattlePhase;
    }
  }
  return null;
}

/**
 * The next phase that has someone to shoot. Empty ranks are skipped.
 * Round 1 opens with anti-aircraft, then submarine surprise (cancelled by an enemy destroyer),
 * then the Normandy shore bombardment, then attacker ranks, then defender ranks.
 */
export function nextCombatPhase(query: PhaseQuery): BattlePhase {
  const { current } = query;

  if (query.round === 1 && !query.aaResolved) {
    const hasAa = query.defenders.some((unit) => unit.active && unit.type === "aaa");
    const hasAir = query.attackers.some((unit) => unit.active && UNIT_DEFINITIONS[unit.type].category === "air");
    if (hasAa && hasAir && (current === "IDLE" || current === "DEPLOYMENT_READY")) {
      return "DEF_AA_ATTACK";
    }
  }

  if (query.theater === "navy_test") {
    const attackerSubs = query.attackers.some(
      (unit) => unit.active && unit.type === "submarine" && !unit.hasFiredThisRound,
    );
    const defenderSubs = query.defenders.some(
      (unit) => unit.active && unit.type === "submarine" && !unit.hasFiredThisRound,
    );
    const defenderHasDestroyer = query.defenders.some((unit) => unit.active && unit.type === "destroyer");
    const attackerHasDestroyer = query.attackers.some((unit) => unit.active && unit.type === "destroyer");
    const opening = current === "IDLE" || current === "DEF_AA_ATTACK" || current === "AA_ALLOCATION";
    if (opening && attackerSubs && !defenderHasDestroyer) return "ATK_SUB_SURPRISE";
    if ((opening || current === "ATK_SUB_SURPRISE") && defenderSubs && !attackerHasDestroyer) {
      return "DEF_SUB_SURPRISE";
    }
  }

  if (query.theater === "normandy" && query.round === 1 && !query.shoreFired) {
    if (current === "IDLE" || current === "DEF_AA_ATTACK" || current === "AA_ALLOCATION") {
      return "ATK_SHORE_BOMBARDMENT";
    }
  }

  const openingDone =
    current === "DEF_AA_ATTACK" ||
    current === "AA_ALLOCATION" ||
    current === "ATK_SHORE_BOMBARDMENT" ||
    current === "ATK_SUB_SURPRISE" ||
    current === "DEF_SUB_SURPRISE";
  if (openingDone) {
    return firstRank(query, "attacker") ?? firstRank(query, "defender") ?? "ALLOCATION";
  }

  if (current.startsWith("ATK_RANK_")) {
    const rank = Number(current.replace("ATK_RANK_", ""));
    for (let next = rank + 1; next <= 4; next++) {
      if (rankCanFire(query.attackers, "attacker", next, query.theater)) {
        return `ATK_RANK_${next}` as BattlePhase;
      }
    }
    return firstRank(query, "defender") ?? "ALLOCATION";
  }

  if (current.startsWith("DEF_RANK_")) {
    const rank = Number(current.replace("DEF_RANK_", ""));
    for (let next = rank + 1; next <= 4; next++) {
      if (rankCanFire(query.defenders, "defender", next, query.theater)) {
        return `DEF_RANK_${next}` as BattlePhase;
      }
    }
    return "ALLOCATION";
  }

  return firstRank(query, "attacker") ?? firstRank(query, "defender") ?? "ALLOCATION";
}

export type BattleOutcome = "attacker_wins" | "defender_wins" | "mutual" | "undecided";

/** Both sides gone is a draw: the attacker does not take the ground. */
export function battleOutcome(attackersAlive: number, defendersAlive: number): BattleOutcome {
  if (attackersAlive <= 0 && defendersAlive <= 0) return "mutual";
  if (defendersAlive <= 0) return "attacker_wins";
  if (attackersAlive <= 0) return "defender_wins";
  return "undecided";
}
