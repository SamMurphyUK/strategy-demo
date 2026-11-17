import { describe, expect, it } from "vitest";
import type { BattlePhase, TheaterId, UnitType } from "../../../src/ui/battle/combatTypes";
import { UNIT_DEFINITIONS } from "../../../src/ui/battle/combatTypes";
import {
  assignHits,
  battleOutcome,
  hitsOn,
  nextCombatPhase,
  resolveRanks,
  type FiringUnit,
} from "../../../src/ui/battle/rules";

interface Piece {
  uid: string;
  type: UnitType;
  hp: number;
  rank: number;
  fired: boolean;
}

function army(side: "attacker" | "defender", types: UnitType[], theater: TheaterId): Piece[] {
  const units = types.map((type, i) => ({ uid: `${side[0]}${i}_${type}`, type, active: true }));
  const ranks = resolveRanks(units, side, theater);
  return units.map((unit, i) => ({
    uid: unit.uid,
    type: unit.type,
    hp: UNIT_DEFINITIONS[unit.type].maxHp,
    rank: ranks[i].effectiveRank,
    fired: false,
  }));
}

const firing = (pieces: Piece[]): FiringUnit[] =>
  pieces.map((p) => ({ type: p.type, active: p.hp > 0, effectiveRank: p.rank, hasFiredThisRound: p.fired }));

/** One sandbox round, headless: the same phase walk the battle screen takes. */
function playRound(attackers: Piece[], defenders: Piece[], dice: number[], theater: TheaterId = "eastern") {
  const rolled: string[] = [];
  let attackerHits = 0;
  let defenderHits = 0;
  let phase: BattlePhase = "IDLE";
  const query = () => ({
    theater,
    round: 2,
    current: phase,
    aaResolved: true,
    shoreFired: true,
    attackers: firing(attackers),
    defenders: firing(defenders),
    attackerHits,
    defenderHitPoints: defenders.reduce((sum, p) => sum + p.hp, 0),
  });

  phase = nextCombatPhase(query());
  while (phase !== "ALLOCATION") {
    const attacking = phase.startsWith("ATK_RANK_");
    const rank = Number(phase.slice(-1));
    const shooters = (attacking ? attackers : defenders).filter((p) => p.hp > 0 && p.rank === rank && !p.fired);
    for (const shooter of shooters) {
      const die = dice.shift();
      if (die == null) throw new Error(`ran out of dice at ${shooter.uid}`);
      rolled.push(shooter.uid);
      shooter.fired = true;
      if (hitsOn(die, rank)) {
        if (attacking) attackerHits += 1;
        else defenderHits += 1;
      }
    }
    phase = nextCombatPhase(query());
  }

  const applyHits = (pieces: Piece[], hits: number) => {
    for (const step of assignHits(
      pieces.filter((p) => p.hp > 0).map((p) => ({ uid: p.uid, type: p.type, rank: p.rank, currentHp: p.hp, maxHp: UNIT_DEFINITIONS[p.type].maxHp })),
      hits,
    )) {
      pieces.find((p) => p.uid === step.uid)!.hp = step.hpAfter;
    }
  };
  applyHits(defenders, attackerHits);
  applyHits(attackers, defenderHits);

  const outcome = battleOutcome(
    attackers.filter((p) => p.hp > 0).length,
    defenders.filter((p) => p.hp > 0).length,
  );
  return { rolled, outcome };
}

describe("immediate victory once every defender is hit", () => {
  it("stops the tanks and planes when the infantry has already wiped out the defenders", () => {
    const attackers = army("attacker", ["infantry", "infantry", "infantry", "tank", "fighter"], "eastern");
    const defenders = army("defender", ["infantry", "infantry"], "eastern");

    // Three infantry dice, all hits. Then the two defenders return fire and miss.
    const { rolled, outcome } = playRound(attackers, defenders, [1, 1, 1, 6, 6]);

    expect(rolled.filter((uid) => uid.startsWith("a"))).toEqual(["a0_infantry", "a1_infantry", "a2_infantry"]);
    expect(rolled).not.toContain("a3_tank");
    expect(rolled).not.toContain("a4_fighter");
    expect(rolled.filter((uid) => uid.startsWith("d"))).toEqual(["d0_infantry", "d1_infantry"]);
    expect(defenders.every((p) => p.hp === 0)).toBe(true);
    expect(outcome).toBe("attacker_wins");
  });

  it("still fires the later ranks when the infantry falls short", () => {
    const attackers = army("attacker", ["infantry", "infantry", "tank"], "eastern");
    const defenders = army("defender", ["infantry", "infantry"], "eastern");

    const { rolled } = playRound(attackers, defenders, [1, 6, 6, 6, 6]);

    expect(rolled).toContain("a2_tank");
  });

  it("counts a two-hit battleship as two hits to clear", () => {
    const attackers = army("attacker", ["destroyer", "cruiser"], "navy_test");
    const defenders = army("defender", ["battleship"], "navy_test");

    const { rolled } = playRound(attackers, defenders, [1, 6, 6], "navy_test");

    expect(rolled).toContain("a1_cruiser");
  });
});
