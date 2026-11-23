import { describe, expect, it } from "vitest";
import { Faction, GameState, Region, Unit } from "../../src/engine";
import { threatAt, threatMap } from "../../src/ai/threatMap";

function board(): GameState {
  const state = new GameState();
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 10, team: "axis" });
  state.factions.blue = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000ff", starting_ipc: 10, team: "allies" });
  state.current_faction_id = "red";
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
  state.unit_types.fighter = Unit.fromDict({
    id: "fighter",
    name: "Fighter",
    category: "air",
    attack: 3,
    defense: 4,
    movement: 1,
    cost: 10,
  });
  return state;
}

function land(id: string, owner: string, ipc: number, extra: Record<string, unknown> = {}): Region {
  return Region.fromDict({ id, name: id, type: "land", ipc_value: ipc, owner_faction_id: owner, ...extra });
}

describe("threat map", () => {
  it("prices output, capitals, victory cities, and facilities from the rules that are on", () => {
    const state = board();
    state.regions.home = land("home", "red", 4, { is_capital: true, base_output: 4, major_factory: true, airbase: true });
    state.regions.away = land("away", "blue", 2, { is_capital: true, forward_depot: true, harbor: true });
    state.regions.london = land("london", "blue", 6);
    const plain = threatAt(threatMap(state, "red", false), "home");
    expect(plain.strategicValue).toBe(4 * 2.5 + 40);
    expect(threatAt(threatMap(state, "red", false), "away").strategicValue).toBe(2 * 2.5 + 35);

    state.rulesetConfig.facilitiesAndPatrols = true;
    expect(threatAt(threatMap(state, "red", false), "home").strategicValue).toBe(4 * 2.5 + 40 + 10 + 3);
    expect(threatAt(threatMap(state, "red", false), "away").strategicValue).toBe(2 * 2.5 + 35 + 4 + 3);

    state.scenarioId = "SCENARIO_GLOBAL_1940";
    expect(threatAt(threatMap(state, "red", false), "london").strategicValue).toBe(6 * 2.5 + 18);
  });

  it("adds eight when the tile finishes an objective and subtracts twenty-five for a heavy domino", () => {
    const state = board();
    state.factions.germany = Faction.fromDict({ id: "germany", name: "Germany", color: "#444", starting_ipc: 10, team: "axis" });
    state.rulesetConfig.nationalObjectivesAndNeutrals = true;
    state.regions.caucasus = land("caucasus", "", 2);
    state.regions.persia = land("persia", "", 2);
    state.regions.iraq = land("iraq", "", 2);
    expect(threatAt(threatMap(state, "germany", true), "caucasus").strategicValue).toBe(2 * 2.5 + 8);
    expect(threatAt(threatMap(state, "germany", false), "caucasus").strategicValue).toBe(2 * 2.5);

    state.regions.spain = land("spain", "", 1);
    state.regions.portugal = land("portugal", "", 3);
    state.neutralBlocs = [{ id: "iberia", members: ["spain", "portugal"], joins: "united_kingdom", oppose: true, garrison: 1 }];
    const punished = threatAt(threatMap(state, "germany", false), "spain").strategicValue;
    expect(punished).toBe(1 * 2.5 - 25);
    state.rulesetConfig.nationalObjectivesAndNeutrals = false;
    expect(threatAt(threatMap(state, "germany", true), "spain").strategicValue).toBe(1 * 2.5);
  });

  it("classifies the rear, a held border, and a dead zone from one-turn reach", () => {
    const state = board();
    state.regions.rear = land("rear", "red", 1);
    state.regions.line = land("line", "red", 3, { is_capital: true });
    state.regions.front = land("front", "blue", 1);
    state.adjacency.rear = ["line"];
    state.adjacency.line = ["rear", "front"];
    state.adjacency.front = ["line"];
    state.region_units.line = [{ faction_id: "red", unit_type_id: "infantry", count: 4 }];
    state.region_units.front = [{ faction_id: "blue", unit_type_id: "infantry", count: 1 }];
    const held = threatMap(state, "red", false);
    expect(threatAt(held, "rear").zoneClassification).toBe("SAFE_REAR");
    expect(threatAt(held, "rear").enemyThreat1Turn).toBe(0);
    expect(threatAt(held, "line").zoneClassification).toBe("HOLD_LINE");
    expect(threatAt(held, "line").enemyThreat1Turn).toBe(1);

    state.region_units.line = [];
    state.region_units.front = [{ faction_id: "blue", unit_type_id: "infantry", count: 6 }];
    const dead = threatMap(state, "red", false);
    expect(threatAt(dead, "line").zoneClassification).toBe("DEAD_ZONE");
    expect(threatAt(dead, "line").friendlyReach1Turn).toBe(0);
  });

  it("stops on mountain, blitzes desert, and grants an operational airbase an extra step", () => {
    const state = board();
    state.rulesetConfig.terrainModifiers = true;
    state.regions.a = land("a", "blue", 1, { land_cover: "OPEN" });
    state.regions.b = land("b", "red", 1, { land_cover: "MOUNTAIN" });
    state.regions.c = land("c", "red", 1, { land_cover: "OPEN" });
    state.adjacency.a = ["b"];
    state.adjacency.b = ["a", "c"];
    state.adjacency.c = ["b"];
    state.region_units.a = [{ faction_id: "blue", unit_type_id: "tank", count: 1 }];
    const stopped = threatMap(state, "red", false);
    expect(threatAt(stopped, "b").enemyThreat1Turn).toBe(3);
    expect(threatAt(stopped, "c").enemyThreat1Turn).toBe(0);

    state.rulesetConfig.terrainModifiers = false;
    expect(threatAt(threatMap(state, "red", false), "c").enemyThreat1Turn).toBe(3);

    state.rulesetConfig.terrainModifiers = true;
    state.regions.a = land("a", "blue", 1, { land_cover: "DESERT" });
    state.regions.b = land("b", "", 1, { land_cover: "DESERT" });
    state.regions.c = land("c", "red", 1, { land_cover: "DESERT" });
    state.unit_types.tank.movement = 1;
    state.region_units.a = [{ faction_id: "blue", unit_type_id: "tank", count: 1 }];
    expect(threatAt(threatMap(state, "red", false), "c").enemyThreat1Turn).toBe(3);
    state.rulesetConfig.terrainModifiers = false;
    expect(threatAt(threatMap(state, "red", false), "c").enemyThreat1Turn).toBe(0);

    state.unit_types.tank.movement = 2;
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.regions.a = land("a", "blue", 1, { airbase: true });
    state.regions.b = land("b", "", 1);
    state.regions.c = land("c", "red", 1);
    state.region_units.a = [{ faction_id: "blue", unit_type_id: "fighter", count: 1 }];
    expect(threatAt(threatMap(state, "red", false), "c").enemyThreat1Turn).toBe(3);
    state.rulesetConfig.facilitiesAndPatrols = false;
    expect(threatAt(threatMap(state, "red", false), "c").enemyThreat1Turn).toBe(0);
  });
});
