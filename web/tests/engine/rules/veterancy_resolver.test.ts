import { describe, expect, it } from "vitest";
import { GameState, Unit } from "../../../src/engine";
import type { ActiveBattle, BattleUnitState } from "../../../src/engine/model/battle";
import { restrictedCasualties } from "../../../src/engine/combat/battle_rules";
import { acceptBattleOdds, estimateBattle } from "../../../src/engine/rules/optional/montecarlo";
import {
  AWAITING_PROMOTION_CHOICE,
  autoPromote,
  choosePromotion,
  grantVictoryExperience,
  markVeteranReroll,
  promotionState,
  veteranMayReroll,
  type BattleStrength,
} from "../../../src/engine/rules/optional/veterancy";
import { DEFAULT_LEGACY_RULESET } from "../../../src/engine/types/ruleset";

function piece(id: string, unitTypeId: string): BattleUnitState {
  return { id, faction_id: "red", unit_type_id: unitTypeId, hp: 1, max_hp: 1 };
}

function report(over: Partial<BattleStrength>): BattleStrength {
  return {
    attacker: 10,
    defender: 8,
    attackerLost: 2,
    defenderLost: 2,
    attackerSurvivors: [piece("a", "infantry")],
    defenderSurvivors: [],
    winner: "attacker",
    attackerCost: 30,
    defenderCost: 24,
    ...over,
  };
}

describe("unit veterancy and battle odds", () => {
  it("requires a surviving winner, a winner casualty, and production-cost parity", () => {
    const state = new GameState();
    state.rulesetConfig.unitVeterancy = true;
    state.unit_types.infantry = Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3 });
    state.unit_types.tank = Unit.fromDict({ id: "tank", name: "Tank", category: "land", attack: 3, defense: 3, movement: 2, cost: 6 });
    grantVictoryExperience(state, report({ attackerLost: 0, defenderLost: 4 }));
    expect(state.unitExperience.a).toBeUndefined();
    grantVictoryExperience(state, report({ attackerSurvivors: [], defenderSurvivors: [] }));
    expect(state.unitExperience.a).toBeUndefined();
    grantVictoryExperience(state, report({ attackerCost: 30, defenderCost: 10 }));
    expect(state.unitExperience.a).toBeUndefined();

    state.unitExperience.a = { xp: 1, veteran: false };
    state.unitExperience.tank = { xp: 1, veteran: false };
    grantVictoryExperience(
      state,
      report({
        winner: "defender",
        defenderSurvivors: [piece("a", "infantry"), piece("tank", "tank")],
        attackerSurvivors: [],
      }),
    );
    expect(state.unitExperience.a).toEqual({ xp: 2, veteran: false });
    expect(state.unitExperience.tank).toEqual({ xp: 3, veteran: true });
    expect(promotionState(state)).toBe("");

    state.unitExperience.a = { xp: 1, veteran: false };
    state.unitExperience.b = { xp: 1, veteran: false };
    grantVictoryExperience(state, report({ attackerSurvivors: [piece("a", "infantry"), piece("b", "tank")] }));
    expect(promotionState(state)).toBe(AWAITING_PROMOTION_CHOICE);
    expect(autoPromote(state)).toBe("");
    expect(state.unitExperience.b).toEqual({ xp: 3, veteran: true });
    expect(choosePromotion(state, "a")).toBe("That unit is not waiting for a promotion.");

    state.rulesetConfig.unitVeterancy = false;
    state.unitExperience.c = { xp: 0, veteran: false };
    grantVictoryExperience(state, report({ attackerSurvivors: [piece("c", "infantry")] }));
    expect(state.unitExperience.c).toEqual({ xp: 0, veteran: false });
  });

  it("rerolls one miss per round only at xp 3 and takes low xp first", () => {
    const state = new GameState();
    state.rulesetConfig.unitVeterancy = true;
    state.unitExperience.ace = { xp: 2, veteran: true };
    expect(veteranMayReroll(state, "ace")).toBe(false);
    state.unitExperience.ace = { xp: 3, veteran: true };
    state.active_battle = {
      region_id: "field",
      attacker_faction_id: "red",
      defender_faction_id: "blue",
      battle_type: "land",
      round: 1,
      stage: "awaiting_roll",
      attackers: [],
      defenders: [],
      attacker_hits_to_take: 0,
      last_dice: [],
      last_casualties: [],
    } satisfies ActiveBattle;
    expect(veteranMayReroll(state, "ace")).toBe(true);
    markVeteranReroll(state, "ace");
    expect(veteranMayReroll(state, "ace")).toBe(false);
    state.active_battle.round = 2;
    expect(veteranMayReroll(state, "ace")).toBe(true);

    const green = piece("green", "infantry");
    const ace = piece("ace", "infantry");
    state.unitExperience.green = { xp: 0, veteran: false };
    const types = {
      infantry: Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3 }),
    };
    const ordered = restrictedCasualties([ace, green], { any: 1, skipAir: 0, skipSub: 0 }, "attacker", types, new Map(), state.unitExperience);
    expect(ordered.plan[0]?.unit_id).toBe("green");
    const classic = restrictedCasualties([ace, green], { any: 1, skipAir: 0, skipSub: 0 }, "attacker", types, new Map());
    expect(classic.plan[0]?.unit_id).toBe("ace");
  });

  it("repeats a seeded 1,500-trial estimate and drops a stale request", () => {
    const ruleset = { ...DEFAULT_LEGACY_RULESET, unitVeterancy: true };
    const first = estimateBattle([3, 3], [2], 1500, 7, ruleset, [3, 0], [0], 4);
    const second = estimateBattle([3, 3], [2], 1500, 7, ruleset, [3, 0], [0], 4);
    expect(first).toEqual(second);
    expect(first.trials).toBe(1500);
    expect(first.attackerWins + first.defenderWins + first.draws).toBe(1500);
    expect(acceptBattleOdds(4, first)).toEqual(first);
    expect(acceptBattleOdds(5, first)).toBeNull();
  });
});
