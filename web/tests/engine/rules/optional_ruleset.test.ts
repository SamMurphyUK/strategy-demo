import { describe, expect, it } from "vitest";
import { EconomyEngine, Faction, GameState, Region, Unit, firingRanks } from "../../../src/engine";
import {
  applyRuleToggle,
  classifyUnit,
  normalizeLaunch,
  normalizeRuleset,
  treasuryOf,
  type OptionalRulesetConfig,
} from "../../../src/engine/types/ruleset";
import { optionalCombatRanks } from "../../../src/engine/rules/optional/combat_ranks";
import { declarePreparatoryBombardment, movementEnterCost } from "../../../src/engine/rules/optional/terrain";
import { bloodyParity, grantVictoryExperience, type BattleStrength } from "../../../src/engine/rules/optional/veterancy";
import { researchRoll } from "../../../src/engine/rules/optional/tech";
import { neutralDomino, objectiveBonus } from "../../../src/engine/rules/optional/objectives";
import { validateLaunch } from "../../../src/engine/rules/optional/validate";
import { estimateBattle } from "../../../src/engine/rules/optional/montecarlo";
import type { BattleUnitState } from "../../../src/engine/model/battle";

function piece(id: string, unitTypeId: string): BattleUnitState {
  return { id, faction_id: "red", unit_type_id: unitTypeId, hp: 1, max_hp: 1 };
}

function board(): GameState {
  const state = new GameState();
  state.unit_types.infantry = Unit.fromDict({
    id: "infantry",
    name: "Infantry",
    category: "land",
    attack: 1,
    defense: 2,
    movement: 1,
    cost: 3,
  });
  state.unit_types.tank = Unit.fromDict({
    id: "tank",
    name: "Tank",
    category: "land",
    attack: 3,
    defense: 3,
    movement: 2,
    cost: 6,
  });
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 10 });
  state.ipc.red = 10;
  state.regions.city = Region.fromDict({
    id: "city",
    name: "City",
    type: "land",
    ipc_value: 3,
    owner_faction_id: "red",
  });
  state.regions.dune = Region.fromDict({
    id: "dune",
    name: "Dune",
    type: "land",
    ipc_value: 1,
    owner_faction_id: "red",
    land_cover: "DESERT",
  });
  state.regions.snow = Region.fromDict({
    id: "snow",
    name: "Snow",
    type: "land",
    ipc_value: 1,
    owner_faction_id: "red",
    land_cover: "SNOW",
  });
  return state;
}

describe("optional ruleset", () => {
  it("treats a missing config as 1942 Quick with every toggle off", () => {
    const rules = normalizeRuleset(undefined);
    expect(rules).toEqual<OptionalRulesetConfig>({
      terrainModifiers: false,
      preparatoryBombardment: false,
      unitVeterancy: false,
      facilitiesAndPatrols: false,
      nationalObjectivesAndNeutrals: false,
      techTree: false,
    });
    expect(normalizeLaunch(undefined).scenarioId).toBe("SCENARIO_1942_QUICK");
    const forced = normalizeRuleset({ preparatoryBombardment: true, terrainModifiers: false });
    expect(forced.preparatoryBombardment).toBe(false);
    expect(
      applyRuleToggle({ ...forced, terrainModifiers: true, preparatoryBombardment: true }, "terrainModifiers", false)
        .preparatoryBombardment,
    ).toBe(false);
    expect(classifyUnit("tank")).toBe("ARMOR");
    expect(classifyUnit("chinese_guerrilla")).toBe("CHINESE_GUERRILLA");
    expect(treasuryOf({ red: 7 }, "red")).toBe(7);
  });

  it("leaves movement, ranks, income, and the snapshot alone while the flags are off", () => {
    const state = board();
    expect(movementEnterCost(state, "infantry", "city", "dune", 2, 0)).toBe(1);
    expect(movementEnterCost(state, "infantry", "city", "snow", 2, 0)).toBe(1);
    expect(state.regions.city.toDict()).not.toHaveProperty("land_cover");
    const defenders = [piece("a", "infantry"), piece("b", "infantry"), piece("c", "infantry"), piece("d", "infantry")];
    state.regions.city.land_cover = "URBAN";
    const plain = firingRanks(defenders, "defender", state.unit_types);
    const wrapped = optionalCombatRanks(state, "city", 1, defenders, "defender");
    expect(wrapped).toStrictEqual(plain);
    const economy = new EconomyEngine(state);
    expect(economy.calculateIncome("red")).toBe(economy.collectIncome("red")[0].payload.amount);
    const snapshot = state.toSnapshot();
    expect("rulesetConfig" in snapshot).toBe(false);
    expect("scenarioId" in snapshot).toBe(false);
  });

  it("applies desert, snow, and urban cover only after the terrain flag is on", () => {
    const state = board();
    state.applyCampaignLaunch({
      scenarioId: "SCENARIO_GLOBAL_1940",
      ruleset: { terrainModifiers: true },
    });
    expect(movementEnterCost(state, "infantry", "city", "dune", 2, 0)).toBe(2);
    expect(movementEnterCost(state, "infantry", "city", "snow", 2, 0)).toBe(2);
    expect(movementEnterCost(state, "fighter", "city", "dune", 4, 0)).toBe(1);
    state.regions.city.land_cover = "URBAN";
    const defenders = [piece("a", "infantry"), piece("b", "infantry"), piece("c", "infantry"), piece("d", "infantry")];
    const ranks = optionalCombatRanks(state, "city", 1, defenders, "defender");
    expect(ranks.get("a")).toBe(3);
    expect(ranks.get("d")).toBe(2);
    state.regions.dune.land_cover = "FOREST";
    const armor = [piece("tank-1", "tank")];
    const attack = optionalCombatRanks(state, "dune", 1, armor, "attacker");
    expect(attack.get("tank-1")).toBe(2);
    expect(declarePreparatoryBombardment(state, "city", ["gun"])).toBe("Preparatory bombardment needs terrain.");
  });

  it("promotes one veteran from a bloody win and ignores a quiet win", () => {
    const quiet: BattleStrength = {
      attacker: 10,
      defender: 1,
      attackerLost: 0,
      defenderLost: 1,
      attackerSurvivors: [],
      defenderSurvivors: [],
      winner: "attacker",
    };
    expect(bloodyParity(quiet)).toBe(false);
    const state = board();
    state.rulesetConfig = { ...state.rulesetConfig, unitVeterancy: true };
    state.unitExperience.vet = { xp: 1, veteran: false };
    state.unitExperience.second = { xp: 1, veteran: false };
    const bloody: BattleStrength = {
      attacker: 10,
      defender: 8,
      attackerLost: 5,
      defenderLost: 8,
      attackerSurvivors: [piece("vet", "infantry"), piece("second", "infantry")],
      defenderSurvivors: [],
      winner: "attacker",
    };
    grantVictoryExperience(state, bloody);
    expect(state.unitExperience.vet).toEqual({ xp: 2, veteran: true });
    expect(state.unitExperience.second).toEqual({ xp: 2, veteran: false });
  });

  it("carries a missed research pip and pays an objective only when the flag is on", () => {
    expect(researchRoll({ pity: 0, unlocked: [] }, 5, "radar").pity).toBe(1);
    expect(researchRoll({ pity: 1, unlocked: [] }, 5, "radar").unlocked).toEqual(["radar"]);
    const state = board();
    state.nationalObjectives = [{ id: "hold", factionId: "red", production: 5, holds: ["city"] }];
    expect(objectiveBonus(state, "red")).toBe(0);
    state.rulesetConfig = { ...state.rulesetConfig, nationalObjectivesAndNeutrals: true };
    expect(objectiveBonus(state, "red")).toBe(5);
    state.neutralBlocs = [{ id: "nordic", members: ["city", "dune"], joins: "blue" }];
    expect(neutralDomino(state, "city", "red")).toEqual(["dune"]);
    expect(state.regions.dune.owner_faction_id).toBe("blue");
    const checked = validateLaunch({ scenarioId: "nope", ruleset: { techTree: true } });
    expect(checked.config.scenarioId).toBe("SCENARIO_1942_QUICK");
    expect(checked.config.ruleset.techTree).toBe(true);
  });

  it("repeats a Monte Carlo estimate from the same seed", () => {
    const first = estimateBattle([3, 3], [2], 20, 7);
    const second = estimateBattle([3, 3], [2], 20, 7);
    expect(first).toEqual(second);
    expect(first.trials).toBe(20);
    expect(first.attackerWins + first.defenderWins + first.draws).toBe(20);
  });
});
