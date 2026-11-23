import { hitsOn } from "../../combat/battle_rules";

export interface VolleyOdds {
  trials: number;
  attackerWins: number;
  defenderWins: number;
  draws: number;
}

export interface MonteCarloRequest {
  attacker: number[];
  defender: number[];
  trials: number;
  seed: number;
}

/** A tiny deterministic roller so a worker and a test share one sequence. */
export function roller(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state % 6) + 1;
  };
}

function volley(ranks: number[], roll: () => number): number {
  let hits = 0;
  for (const rank of ranks) {
    if (hitsOn(roll(), rank)) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Fight both lines until one is gone, or 100 rounds. Each hit removes one rank
 * from the end of that line. This is an estimate, not the board's casualty picker.
 */
export function estimateBattle(attacker: number[], defender: number[], trials: number, seed: number): VolleyOdds {
  const count = Math.max(1, Math.min(200, Math.trunc(trials)));
  const roll = roller(seed);
  const odds: VolleyOdds = { trials: count, attackerWins: 0, defenderWins: 0, draws: 0 };
  for (let trial = 0; trial < count; trial += 1) {
    const atk = attacker.slice();
    const def = defender.slice();
    for (let round = 0; round < 100 && atk.length > 0 && def.length > 0; round += 1) {
      const atkHits = volley(atk, roll);
      const defHits = volley(def, roll);
      def.splice(Math.max(0, def.length - atkHits), atkHits);
      atk.splice(Math.max(0, atk.length - defHits), defHits);
    }
    if (atk.length > 0 && def.length === 0) odds.attackerWins += 1;
    else if (def.length > 0 && atk.length === 0) odds.defenderWins += 1;
    else odds.draws += 1;
  }
  return odds;
}

export function monteCarloMessage(data: MonteCarloRequest): VolleyOdds {
  return estimateBattle(data.attacker ?? [], data.defender ?? [], data.trials ?? 1, data.seed ?? 1);
}
