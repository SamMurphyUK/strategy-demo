import { hitsOn } from "../../combat/battle_rules";
import type { OptionalRulesetConfig } from "../../types/ruleset";

export interface VolleyOdds {
  trials: number;
  attackerWins: number;
  defenderWins: number;
  draws: number;
  requestId: number;
}

export interface MonteCarloRequest {
  attacker: number[];
  defender: number[];
  trials: number;
  seed: number;
  requestId?: number;
  ruleset?: OptionalRulesetConfig;
  attackerXp?: number[];
  defenderXp?: number[];
}

const RANKS = 13;

/** Mulberry32. The same seed returns the same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny deterministic roller so a worker and a test share one sequence. */
export function roller(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state % 6) + 1;
  };
}

function pack(ranks: number[], xp: number[] | undefined, counts: Int16Array, vets: Int16Array): void {
  counts.fill(0);
  vets.fill(0);
  for (let i = 0; i < ranks.length; i += 1) {
    const rank = Math.max(0, Math.min(RANKS - 1, ranks[i] | 0));
    counts[rank] += 1;
    if (xp != null && (xp[i] ?? 0) >= 3) {
      vets[rank] += 1;
    }
  }
}

function living(counts: Int16Array): number {
  let total = 0;
  for (let rank = 0; rank < RANKS; rank += 1) {
    total += counts[rank];
  }
  return total;
}

function fire(counts: Int16Array, vetLeft: Int16Array, reroll: boolean, roll: () => number): number {
  let hits = 0;
  for (let rank = 1; rank < RANKS; rank += 1) {
    const count = counts[rank];
    for (let i = 0; i < count; i += 1) {
      let face = 1 + ((roll() * 6) | 0);
      if (!hitsOn(face, rank) && reroll && vetLeft[rank] > 0) {
        vetLeft[rank] -= 1;
        face = 1 + ((roll() * 6) | 0);
      }
      if (hitsOn(face, rank)) {
        hits += 1;
      }
    }
  }
  return hits;
}

function applyHits(counts: Int16Array, vets: Int16Array, hits: number): void {
  let left = hits;
  for (let rank = 0; rank < RANKS && left > 0; rank += 1) {
    const take = Math.min(counts[rank], left);
    counts[rank] -= take;
    if (vets[rank] > counts[rank]) {
      vets[rank] = counts[rank];
    }
    left -= take;
  }
}

/**
 * Fight both lines until one is gone, or 100 rounds.
 * Buckets stay in fixed arrays so the trial loop does not allocate.
 * unitVeterancy lets an xp-3 bucket reroll one miss per round.
 */
export function estimateBattle(
  attacker: number[],
  defender: number[],
  trials: number,
  seed: number,
  ruleset?: OptionalRulesetConfig,
  attackerXp?: number[],
  defenderXp?: number[],
  requestId = 0,
): VolleyOdds {
  const count = Math.max(1, Math.min(1500, Math.trunc(trials) || 1));
  const reroll = ruleset?.unitVeterancy === true;
  const roll = mulberry32(seed >>> 0 || 1);
  const baseA = new Int16Array(RANKS);
  const baseD = new Int16Array(RANKS);
  const baseAV = new Int16Array(RANKS);
  const baseDV = new Int16Array(RANKS);
  const workA = new Int16Array(RANKS);
  const workD = new Int16Array(RANKS);
  const vetA = new Int16Array(RANKS);
  const vetD = new Int16Array(RANKS);
  const vetLeftA = new Int16Array(RANKS);
  const vetLeftD = new Int16Array(RANKS);
  pack(attacker, attackerXp, baseA, baseAV);
  pack(defender, defenderXp, baseD, baseDV);
  const odds: VolleyOdds = { trials: count, attackerWins: 0, defenderWins: 0, draws: 0, requestId };
  for (let trial = 0; trial < count; trial += 1) {
    workA.set(baseA);
    workD.set(baseD);
    vetA.set(baseAV);
    vetD.set(baseDV);
    for (let round = 0; round < 100 && living(workA) > 0 && living(workD) > 0; round += 1) {
      vetLeftA.set(vetA);
      vetLeftD.set(vetD);
      const atkHits = fire(workA, vetLeftA, reroll, roll);
      const defHits = fire(workD, vetLeftD, reroll, roll);
      applyHits(workD, vetD, atkHits);
      applyHits(workA, vetA, defHits);
    }
    const atkLeft = living(workA);
    const defLeft = living(workD);
    if (atkLeft > 0 && defLeft === 0) odds.attackerWins += 1;
    else if (defLeft > 0 && atkLeft === 0) odds.defenderWins += 1;
    else odds.draws += 1;
  }
  return odds;
}

export function acceptBattleOdds<T extends { requestId: number }>(latestRequestId: number, message: T): T | null {
  return message.requestId === latestRequestId ? message : null;
}

export function monteCarloMessage(data: MonteCarloRequest): VolleyOdds {
  return estimateBattle(
    data.attacker ?? [],
    data.defender ?? [],
    data.trials ?? 1500,
    data.seed ?? 1,
    data.ruleset,
    data.attackerXp,
    data.defenderXp,
    data.requestId ?? 0,
  );
}
