import { describe, expect, it } from "vitest";
import { CombatEngine, GameState, PCG, Region, Unit } from "../../../src/engine";
import { bombardTargets, resolveOrderedBombardments } from "../../../src/engine/combat/bombardChoice";

function board(): { state: GameState; combat: CombatEngine } {
  const state = new GameState();
  state.unit_types.infantry = Unit.fromDict({
    id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3,
  });
  state.unit_types.artillery = Unit.fromDict({
    id: "artillery", name: "Artillery", category: "land", attack: 2, defense: 2, movement: 1, cost: 4,
  });
  state.unit_types.tactical_bomber = Unit.fromDict({
    id: "tactical_bomber", name: "Tactical bomber", category: "air", attack: 3, defense: 3, movement: 4, cost: 11,
  });
  state.unit_types.strategic_bomber = Unit.fromDict({
    id: "strategic_bomber", name: "Strategic bomber", category: "air", attack: 4, defense: 1, movement: 6, cost: 12,
  });
  state.regions.city = Region.fromDict({
    id: "city",
    name: "City",
    type: "land",
    ipc_value: 5,
    owner_faction_id: "blue",
    land_cover: "URBAN",
    has_factory: true,
    major_factory: true,
    airbase: true,
    harbor: true,
  });
  state.region_units.city = [{ faction_id: "blue", unit_type_id: "infantry", count: 1 }];
  return { state, combat: new CombatEngine(state, new PCG(1, 1)) };
}

describe("bombard choice", () => {
  it("offers nothing while the optional rules are off", () => {
    const { state } = board();
    expect(bombardTargets(state, "red", "city", "strategic_bomber")).toEqual(["factory"]);
    expect(bombardTargets(state, "red", "city", "artillery")).toEqual([]);
    expect(bombardTargets(state, "red", "city", "tactical_bomber")).toEqual([]);
  });

  it("lists the targets each unit is allowed to bombard", () => {
    const { state } = board();
    state.rulesetConfig = {
      ...state.rulesetConfig,
      terrainModifiers: true,
      preparatoryBombardment: true,
      facilitiesAndPatrols: true,
    };
    expect(bombardTargets(state, "red", "city", "artillery")).toEqual(["URBAN"]);
    expect(bombardTargets(state, "red", "city", "tactical_bomber")).toEqual(["airbase", "harbor"]);
    expect(bombardTargets(state, "red", "city", "strategic_bomber")).toEqual([
      "factory",
      "airbase",
      "harbor",
      "URBAN",
    ]);
  });

  it("resolves a factory raid before the battle and keeps that bomber out of the fight", () => {
    const { state, combat } = board();
    state.rulesetConfig = { ...state.rulesetConfig, facilitiesAndPatrols: true };
    state.current_phase = "combat";
    state.region_units.city.push({ faction_id: "red", unit_type_id: "strategic_bomber", count: 1 });
    state.region_units.city.push({ faction_id: "red", unit_type_id: "infantry", count: 1 });
    state.phase_orders.push({
      id: "ord_1",
      faction: "red",
      unitType: "strategic_bomber",
      count: 1,
      fromRegionId: "home",
      toRegionId: "city",
      path: [],
      stepsUsed: 1,
      bombard: "factory",
    });
    resolveOrderedBombardments(state, () => 6);
    expect(state.repairTokens.city).toBe(6);
    expect(combat.identifyBattles("red").length).toBe(1);
    const battle = combat.startBattle("city", "red");
    expect(battle.ok).toBe(true);
    const attackers = state.active_battle?.attackers.map((unit) => unit.unit_type_id) ?? [];
    expect(attackers).toEqual(["infantry"]);
  });

  it("does not offer a wood once it has been suppressed", () => {
    const { state } = board();
    state.regions.city.land_cover = "FOREST";
    state.regions.city.major_factory = false;
    state.regions.city.airbase = false;
    state.regions.city.harbor = false;
    state.rulesetConfig = {
      ...state.rulesetConfig,
      terrainModifiers: true,
      preparatoryBombardment: true,
    };
    expect(bombardTargets(state, "red", "city", "artillery")).toEqual(["FOREST"]);
    state.terrainSuppressed.city = state.game_round;
    expect(bombardTargets(state, "red", "city", "artillery")).toEqual([]);
  });
});
