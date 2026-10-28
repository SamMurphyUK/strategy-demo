import { describe, expect, it } from "vitest";
import type { FiringUnit, HitTarget, RankedUnit } from "../../src/battle/rules";
import {
  aaShotCount,
  assignHits,
  battleOutcome,
  compareByCostThenRank,
  createBattleDice,
  hitsOn,
  nextCombatPhase,
  rankCanFire,
  resolveHit,
  resolveRanks,
} from "../../src/battle/rules";

const fighter = (uid: string, active = true): RankedUnit => ({ uid, type: "fighter", active });

describe("dice", () => {
  it("replays a seed and stays on a d6", () => {
    const a = createBattleDice(12345);
    const b = createBattleDice(12345);
    const rollsA = Array.from({ length: 12 }, () => a());
    const rollsB = Array.from({ length: 12 }, () => b());
    expect(rollsA).toEqual(rollsB);
    expect(rollsA.every((roll) => roll >= 1 && roll <= 6)).toBe(true);
    const otherDice = createBattleDice(7);
    const other = Array.from({ length: 12 }, () => otherDice());
    expect(other).not.toEqual(rollsA);
    expect(hitsOn(3, 3)).toBe(true);
    expect(hitsOn(4, 3)).toBe(false);
  });
});

describe("ranks", () => {
  it("pairs each artillery with one attacking infantry", () => {
    const units: RankedUnit[] = [
      { uid: "i1", type: "infantry", active: true },
      { uid: "i2", type: "infantry", active: true },
      { uid: "a1", type: "artillery", active: true },
    ];
    const ranks = resolveRanks(units, "attacker", "eastern");
    expect(ranks.find((r) => r.uid === "i1")).toMatchObject({ effectiveRank: 2, hasSynergyBonus: true, pairedWithUid: "a1" });
    expect(ranks.find((r) => r.uid === "i2")?.effectiveRank).toBe(1);
    expect(ranks.find((r) => r.uid === "a1")?.pairedWithUid).toBe("i1");
  });

  it("does not pair a unit that is already out of the fight", () => {
    const ranks = resolveRanks(
      [
        { uid: "i1", type: "infantry", active: false },
        { uid: "a1", type: "artillery", active: true },
      ],
      "attacker",
      "eastern",
    );
    expect(ranks.find((r) => r.uid === "i1")?.effectiveRank).toBe(1);
    expect(ranks.find((r) => r.uid === "a1")?.pairedWithUid).toBeUndefined();
  });

  it("raises a tactical bomber to rank 4 beside a tank or fighter", () => {
    const ranks = resolveRanks(
      [
        { uid: "b", type: "tactical_bomber", active: true },
        { uid: "t", type: "tank", active: true },
      ],
      "attacker",
      "north_africa",
    );
    expect(ranks.find((r) => r.uid === "b")).toMatchObject({ effectiveRank: 4, hasSynergyBonus: true });
  });

  it("uses the navy rank table and skips land pairing", () => {
    const ranks = resolveRanks(
      [
        { uid: "c", type: "carrier", active: true },
        { uid: "s", type: "submarine", active: true },
        { uid: "f", type: "fighter", active: true },
      ],
      "attacker",
      "navy_test",
    );
    expect(ranks.map((r) => r.effectiveRank)).toEqual([1, 2, 3]);
    expect(ranks.every((r) => !r.hasSynergyBonus)).toBe(true);

    const defending = resolveRanks([fighter("f")], "defender", "navy_test");
    expect(defending[0].effectiveRank).toBe(4);
  });
});

describe("casualties", () => {
  const target = (uid: string, type: HitTarget["type"], hp = 1, max = hp, rank = 1): HitTarget => ({
    uid,
    type,
    rank,
    currentHp: hp,
    maxHp: max,
  });

  it("removes the cheapest unit first", () => {
    const hits = assignHits([target("tank", "tank", 1, 1, 3), target("inf", "infantry")], 1);
    expect(hits).toEqual([{ uid: "inf", result: "destroyed", hpAfter: 0 }]);
    expect(compareByCostThenRank({ type: "infantry", effectiveRank: 2 }, { type: "tank", effectiveRank: 1 })).toBeLessThan(0);
  });

  it("lets a battleship absorb one hit and sink on the second", () => {
    const ship = target("bb", "battleship", 2, 2, 4);
    expect(resolveHit(2, 2)).toBe("damaged");
    expect(assignHits([ship], 1)).toEqual([{ uid: "bb", result: "damaged", hpAfter: 1 }]);
    expect(assignHits([ship], 2)).toEqual([
      { uid: "bb", result: "damaged", hpAfter: 1 },
      { uid: "bb", result: "destroyed", hpAfter: 0 },
    ]);
  });

  it("spends hits on cheaper ships before finishing a damaged battleship", () => {
    const hits = assignHits([target("bb", "battleship", 2, 2, 4), target("dd", "destroyer")], 2);
    expect(hits.map((hit) => hit.uid)).toEqual(["dd", "bb"]);
    expect(hits[1].result).toBe("damaged");
  });
});

describe("anti-aircraft", () => {
  it("fires at most three shots per gun and at most one per aircraft", () => {
    expect(aaShotCount(1, 5)).toBe(3);
    expect(aaShotCount(2, 4)).toBe(4);
    expect(aaShotCount(0, 5)).toBe(0);
  });
});

describe("phase order", () => {
  const unit = (type: FiringUnit["type"], rank: number, fired = false): FiringUnit => ({
    type,
    active: true,
    effectiveRank: rank,
    hasFiredThisRound: fired,
  });

  it("opens round 1 with anti-aircraft, then the Normandy bombardment, then ranks", () => {
    const attackers = [unit("fighter", 3), unit("infantry", 1)];
    const defenders = [unit("aaa", 1), unit("infantry", 2)];
    const base = { theater: "normandy" as const, round: 1, aaResolved: false, shoreFired: false, attackers, defenders };
    expect(nextCombatPhase({ ...base, current: "IDLE" })).toBe("DEF_AA_ATTACK");
    expect(nextCombatPhase({ ...base, current: "AA_ALLOCATION", aaResolved: true })).toBe("ATK_SHORE_BOMBARDMENT");
    expect(nextCombatPhase({ ...base, current: "ATK_SHORE_BOMBARDMENT", aaResolved: true, shoreFired: true })).toBe(
      "ATK_RANK_1",
    );
  });

  it("skips empty ranks and stops after the defenders have fired", () => {
    const query = {
      theater: "eastern" as const,
      round: 2,
      current: "ATK_RANK_2" as const,
      aaResolved: true,
      shoreFired: true,
      attackers: [unit("artillery", 2, true), unit("tank", 3)],
      defenders: [unit("infantry", 2, true), unit("fighter", 4)],
    };
    expect(nextCombatPhase(query)).toBe("ATK_RANK_3");
    expect(nextCombatPhase({ ...query, current: "ATK_RANK_3" })).toBe("DEF_RANK_4");
    expect(nextCombatPhase({ ...query, current: "DEF_RANK_4" })).toBe("ALLOCATION");
  });

  it("gives submarines a surprise strike unless the enemy has a destroyer", () => {
    const attackers = [unit("submarine", 2)];
    const open = {
      theater: "navy_test" as const,
      round: 1,
      current: "IDLE" as const,
      aaResolved: true,
      shoreFired: true,
      attackers,
      defenders: [unit("cruiser", 3)],
    };
    expect(nextCombatPhase(open)).toBe("ATK_SUB_SURPRISE");
    expect(nextCombatPhase({ ...open, defenders: [unit("destroyer", 2), unit("cruiser", 3)] })).toBe("ATK_RANK_2");
  });

  it("lets a navy carrier's fighters fire at rank 4", () => {
    const carrier: FiringUnit = {
      type: "carrier",
      active: true,
      effectiveRank: 2,
      hasFiredThisRound: true,
      carrierFightersFired: false,
    };
    expect(rankCanFire([carrier], "defender", 4, "navy_test")).toBe(true);
    expect(rankCanFire([{ ...carrier, carrierFightersFired: true }], "defender", 4, "navy_test")).toBe(false);
  });
});

describe("outcome", () => {
  it("treats both sides being eliminated as a draw", () => {
    expect(battleOutcome(0, 0)).toBe("mutual");
    expect(battleOutcome(2, 0)).toBe("attacker_wins");
    expect(battleOutcome(0, 3)).toBe("defender_wins");
    expect(battleOutcome(1, 1)).toBe("undecided");
  });
});
