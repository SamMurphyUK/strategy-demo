import { describe, expect, it } from "vitest";
import { Faction, GameState, Region, Unit } from "../../src/engine";
import { planNonCombat } from "../../src/ai/nonCombatPlanner";
import { threatMap } from "../../src/ai/threatMap";
import { applyPatrolOrders } from "../../src/engine/rules/optional/airAndNavalRaiding";
import { Ruleset } from "../../src/engine/rules/ruleset";

function unit(id: string, category: string, movement: number): Unit {
  return Unit.fromDict({ id, name: id, category, attack: 1, defense: 2, movement, cost: 3 });
}

function board(): GameState {
  const state = new GameState();
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 10, team: "axis" });
  state.factions.blue = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000ff", starting_ipc: 10, team: "allies" });
  state.current_faction_id = "red";
  state.current_phase = "noncombat_move";
  state.unit_types.infantry = unit("infantry", "land", 1);
  state.unit_types.artillery = unit("artillery", "land", 1);
  state.unit_types.fighter = unit("fighter", "air", 4);
  state.unit_types.tactical_bomber = unit("tactical_bomber", "air", 4);
  state.unit_types.transport = unit("transport", "sea", 2);
  state.rulesetConfig.facilitiesAndPatrols = true;
  return state;
}

describe("noncombat stager", () => {
  it("lands fighters on a threatened airbase and patrols at most three", () => {
    const state = board();
    state.regions.base = Region.fromDict({
      id: "base",
      name: "Base",
      type: "land",
      owner_faction_id: "red",
      airbase: true,
    });
    state.regions.near = Region.fromDict({ id: "near", name: "Near", type: "land", owner_faction_id: "blue" });
    state.regions.sky = Region.fromDict({ id: "sky", name: "Sky", type: "sea", owner_faction_id: "" });
    state.adjacency.base = ["near", "sky"];
    state.adjacency.near = ["base"];
    state.adjacency.sky = ["base"];
    state.region_units.sky = [{ faction_id: "red", unit_type_id: "fighter", count: 4 }];
    state.region_units.near = [{ faction_id: "blue", unit_type_id: "tactical_bomber", count: 1 }];
    state.unit_types.fighter.special = { can_land_on_carrier: true };
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const plan = planNonCombat(state, "red", ruleset, [], true, threatMap(state, "red", true));
    expect(plan.moves.some((move) => move.unitType === "fighter" && move.to === "base")).toBe(true);
    expect(plan.patrols).toEqual([{ region_id: "base", count: 3 }]);
    const quiet = planNonCombat(state, "red", ruleset, [], false, []);
    expect(quiet.patrols).toEqual([]);
  });

  it("loads infantry and artillery at a safe harbor and skips a hostile coast", () => {
    const state = board();
    state.regions.port = Region.fromDict({
      id: "port",
      name: "Port",
      type: "land",
      owner_faction_id: "red",
      harbor: true,
    });
    state.regions.dock = Region.fromDict({ id: "dock", name: "Dock", type: "sea", owner_faction_id: "" });
    state.regions.road = Region.fromDict({ id: "road", name: "Road", type: "sea", owner_faction_id: "" });
    state.adjacency.port = ["dock"];
    state.adjacency.dock = ["port", "road"];
    state.adjacency.road = ["dock"];
    state.region_units.port = [
      { faction_id: "red", unit_type_id: "infantry", count: 2 },
      { faction_id: "red", unit_type_id: "artillery", count: 1 },
    ];
    state.region_units.road = [{ faction_id: "red", unit_type_id: "transport", count: 1, instance_id: "t1" }];
    state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "road", cargo: [] };
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const plan = planNonCombat(state, "red", ruleset, [], true, []);
    expect(plan.moves).toContainEqual({ from: "road", to: "dock", unitType: "transport", count: 1, instanceId: "t1" });
    expect(plan.loads).toEqual([
      { transportId: "t1", from: "port", unitType: "infantry", count: 1 },
      { transportId: "t1", from: "port", unitType: "artillery", count: 1 },
    ]);

    state.regions.beach = Region.fromDict({ id: "beach", name: "Beach", type: "land", owner_faction_id: "blue" });
    state.adjacency.dock = ["port", "road", "beach"];
    state.adjacency.beach = ["dock"];
    const blocked = planNonCombat(state, "red", ruleset, [], true, []);
    expect(blocked.loads).toEqual([]);
  });

  it("steps rear infantry one region toward the hold line", () => {
    const state = board();
    state.rulesetConfig.facilitiesAndPatrols = false;
    state.regions.rear = Region.fromDict({ id: "rear", name: "Rear", type: "land", owner_faction_id: "red" });
    state.regions.line = Region.fromDict({ id: "line", name: "Line", type: "land", owner_faction_id: "red" });
    state.regions.flank = Region.fromDict({ id: "flank", name: "Flank", type: "land", owner_faction_id: "blue" });
    state.adjacency.rear = ["line"];
    state.adjacency.line = ["rear", "flank"];
    state.adjacency.flank = ["line"];
    state.region_units.rear = [{ faction_id: "red", unit_type_id: "infantry", count: 2 }];
    state.region_units.line = [{ faction_id: "red", unit_type_id: "infantry", count: 4 }];
    state.region_units.flank = [{ faction_id: "blue", unit_type_id: "infantry", count: 1 }];
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const tiles = threatMap(state, "red", false);
    expect(tiles.find((tile) => tile.regionId === "line")?.zoneClassification).toBe("HOLD_LINE");
    const plan = planNonCombat(state, "red", ruleset, [], true, tiles);
    expect(plan.moves).toContainEqual({ from: "rear", to: "line", unitType: "infantry", count: 2 });
  });

  it("sets the patrol when noncombat ends", () => {
    const state = board();
    state.regions.base = Region.fromDict({
      id: "base",
      name: "Base",
      type: "land",
      owner_faction_id: "red",
      airbase: true,
    });
    state.region_units.base = [{ faction_id: "red", unit_type_id: "fighter", count: 3 }];
    applyPatrolOrders(state, "red", { patrols: [{ region_id: "base", count: 3 }] });
    expect(state.patrolCounts["red|base"]).toBe(3);
  });
});
