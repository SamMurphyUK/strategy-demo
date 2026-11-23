import { describe, expect, it } from "vitest";
import { CombatEngine, EconomyEngine, Faction, GameState, MovementValidator, PCG, Region, Ruleset, Unit, firingRanks } from "../../../src/engine";
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
    expect(movementEnterCost(state, "infantry", "city", "dune", 2, 0)).toBe(1);
    expect(movementEnterCost(state, "tank", "city", "dune", 2, 0)).toBe(1);
    expect(movementEnterCost(state, "tank", "dune", "dune", 2, 0)).toBe(0.5);
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

  it("sorts cover infantry by experience and lets guerrillas fight in the wood", () => {
    const state = board();
    state.applyCampaignLaunch({ scenarioId: "SCENARIO_GLOBAL_1940", ruleset: { terrainModifiers: true } });
    state.unit_types.artillery = Unit.fromDict({
      id: "artillery",
      name: "Artillery",
      category: "land",
      attack: 2,
      defense: 2,
      movement: 1,
      cost: 4,
    });
    state.unit_types.chinese_guerrilla = Unit.fromDict({
      id: "chinese_guerrilla",
      name: "Chinese Guerrilla",
      category: "land",
      attack: 1,
      defense: 1,
      movement: 1,
      cost: 3,
    });
    state.regions.city.land_cover = "URBAN";
    state.unitExperience.a = { xp: 2, veteran: false };
    state.unitExperience.b = { xp: 2, veteran: false };
    const defenders = [
      piece("a", "infantry"),
      piece("b", "infantry"),
      piece("c", "infantry"),
      piece("e", "infantry"),
      piece("d", "chinese_guerrilla"),
    ];
    const ranks = optionalCombatRanks(state, "city", 1, defenders, "defender");
    expect(ranks.get("c")).toBe(3);
    expect(ranks.get("e")).toBe(3);
    expect(ranks.get("a")).toBe(3);
    expect(ranks.get("b")).toBe(2);
    expect(ranks.get("d")).toBe(1);
    state.terrainSuppressed.city = state.game_round;
    state.regions.peak = Region.fromDict({ id: "peak", name: "Peak", type: "land", land_cover: "MOUNTAIN" });
    const held = optionalCombatRanks(state, "peak", 1, [piece("c", "infantry"), piece("a", "infantry"), piece("b", "infantry")], "defender");
    expect(held.get("c")).toBe(3);
    expect(held.get("b")).toBe(2);

    const attack = optionalCombatRanks(
      state,
      "woods",
      1,
      [piece("gun", "artillery"), piece("scout", "chinese_guerrilla"), piece("rifle", "infantry")],
      "attacker",
    );
    expect(attack.get("rifle")).toBe(2);
    expect(attack.get("scout")).toBe(1);

    state.regions.woods = Region.fromDict({
      id: "woods",
      name: "Woods",
      type: "land",
      owner_faction_id: "blue",
      land_cover: "FOREST",
    });
    state.regions.home = Region.fromDict({ id: "home", name: "Home", type: "land", owner_faction_id: "red" });
    state.adjacency.woods = ["home"];
    state.adjacency.home = ["woods"];
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.region_units.woods = [
      { faction_id: "red", unit_type_id: "chinese_guerrilla", count: 1 },
      { faction_id: "blue", unit_type_id: "infantry", count: 1 },
    ];
    state.unit_types.chinese_guerrilla.attack = 6;
    const combat = new CombatEngine(state, new PCG(1, 1));
    expect(combat.startBattle("woods", "red").ok).toBe(true);
    const rolled = combat.applyBattleCommand("battle_roll", "red", {});
    expect(rolled?.ok).toBe(true);
    const dice = rolled?.events.find((event) => event.type === "dice_rolled");
    expect(Array.isArray(dice?.payload.dice) ? dice?.payload.dice.length : 0).toBe(1);
    expect(state.region_units.woods?.some((unit) => unit.faction_id === "blue" && unit.count > 0)).toBe(false);
  });

  it("stops on mountain and snow and lets armor cross two desert tiles", () => {
    const state = board();
    state.applyCampaignLaunch({ scenarioId: "SCENARIO_GLOBAL_1940", ruleset: { terrainModifiers: true } });
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.unit_types.mech_infantry = Unit.fromDict({
      id: "mech_infantry",
      name: "Mechanised Infantry",
      category: "land",
      attack: 1,
      defense: 2,
      movement: 1,
      cost: 4,
    });
    state.unit_types.tank.movement = 1;
    const link = (a: string, b: string) => {
      state.adjacency[a] = [...(state.adjacency[a] ?? []), b];
      state.adjacency[b] = [...(state.adjacency[b] ?? []), a];
    };
    state.regions.a = Region.fromDict({ id: "a", name: "A", type: "land", land_cover: "DESERT", owner_faction_id: "red" });
    state.regions.b = Region.fromDict({ id: "b", name: "B", type: "land", land_cover: "DESERT", owner_faction_id: "red" });
    state.regions.c = Region.fromDict({ id: "c", name: "C", type: "land", land_cover: "DESERT", owner_faction_id: "red" });
    link("a", "b");
    link("b", "c");
    state.region_units.a = [{ faction_id: "red", unit_type_id: "tank", count: 1 }];
    const ruleset = new Ruleset();
    const moves = new MovementValidator();
    expect(moves.getLegalDestinationsForStack("a", "tank", "red", state, ruleset).sort()).toEqual(["b", "c"]);
    state.region_units.a = [{ faction_id: "red", unit_type_id: "infantry", count: 1 }];
    expect(moves.getLegalDestinationsForStack("a", "infantry", "red", state, ruleset)).toEqual(["b"]);

    state.regions.gate = Region.fromDict({ id: "gate", name: "Gate", type: "land", land_cover: "OPEN", owner_faction_id: "red" });
    state.regions.peak = Region.fromDict({ id: "peak", name: "Peak", type: "land", land_cover: "MOUNTAIN", owner_faction_id: "red" });
    state.regions.far = Region.fromDict({ id: "far", name: "Far", type: "land", land_cover: "OPEN", owner_faction_id: "red" });
    link("gate", "peak");
    link("peak", "far");
    state.unit_types.infantry.movement = 2;
    state.region_units.gate = [{ faction_id: "red", unit_type_id: "infantry", count: 1 }];
    expect(moves.getLegalDestinationsForStack("gate", "infantry", "red", state, ruleset)).toEqual(["peak"]);
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
