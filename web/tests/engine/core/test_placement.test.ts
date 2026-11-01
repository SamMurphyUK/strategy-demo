import { beforeEach, describe, expect, it } from "vitest";
import { Command, Faction, GameEventType, GameState, PlacementEngine, Region, Unit } from "../../../src/engine";

describe("core/test_placement", () => {
  let state: GameState;
  let placement: PlacementEngine;

  beforeEach(() => {
    state = new GameState();
    state.unit_types["infantry"] = Unit.fromDict({
      id: "infantry", name: "Infantry", category: "land",
      attack: 1, defense: 2, movement: 1, cost: 3,
    });
    state.unit_types["transport"] = Unit.fromDict({
      id: "transport", name: "Transport", category: "sea",
      attack: 0, defense: 0, movement: 2, cost: 7,
      container: { capacity: 2, allowed_cargo_categories: ["land"] },
    });
    state.factions["red"] = Faction.fromDict({ id: "red", name: "Red", color: "#FF0000", starting_ipc: 20 });
    state.regions["factory_region"] = Region.fromDict({
      id: "factory_region", name: "Factory", type: "land",
      ipc_value: 8, owner_faction_id: "red",
      is_capital: true, has_factory: true,
    });
    state.regions["sea_zone"] = Region.fromDict({
      id: "sea_zone", name: "Sea Zone", type: "sea",
      ipc_value: 0, owner_faction_id: "",
      is_capital: false, has_factory: false,
    });
    state.adjacency["factory_region"] = ["sea_zone"];
    state.adjacency["sea_zone"] = ["factory_region"];
    state.region_units["factory_region"] = [];
    state.region_units["sea_zone"] = [];
    state.pending_purchases["red"] = [{ unit_type_id: "infantry", count: 3 }];
    state.factories_controlled_at_turn_start["red"] = ["factory_region"];
    placement = new PlacementEngine(state);
  });

  function placeCmd(regionId: string, unitTypeId: string, count: number): Command {
    return Command.fromDict({
      command_id: "c1", player_id: "red", type: "place_units",
      payload: { placements: [{
        region_id: regionId,
        units: [{ unit_type_id: unitTypeId, count }],
      }] },
    });
  }

  it("test_placement_adds_units_to_region", () => {
    placement.processPlacement(placeCmd("factory_region", "infantry", 3));
    const units = state.getFactionUnitsInRegion("factory_region", "red");
    expect(units.length, "Should have 1 unit stack").toBe(1);
    expect(units[0].unit_type_id).toBe("infantry");
    expect(units[0].count).toBe(3);
  });

  it("test_placement_clears_pending_purchases", () => {
    placement.processPlacement(placeCmd("factory_region", "infantry", 3));
    expect(state.pending_purchases["red"].length, "Pending should be cleared").toBe(0);
  });

  it("test_placement_consumes_pending_incrementally", () => {
    state.pending_purchases["red"] = [{ unit_type_id: "infantry", count: 3 }];
    placement.processPlacement(placeCmd("factory_region", "infantry", 1));
    expect(state.pending_purchases["red"].length).toBe(1);
    expect(Math.trunc(state.pending_purchases["red"][0].count)).toBe(2);
  });

  it("test_placement_emits_event", () => {
    const events = placement.processPlacement(placeCmd("factory_region", "infantry", 2));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.UNITS_PLACED);
  });

  it("test_placement_creates_transport_instances", () => {
    state.pending_purchases["red"] = [{ unit_type_id: "transport", count: 2 }];
    placement.processPlacement(placeCmd("sea_zone", "transport", 2));
    let instanceCount = 0;
    for (const key of Object.keys(state.transport_instances)) {
      if (key.startsWith("transport_red_")) {
        instanceCount += 1;
      }
    }
    expect(instanceCount, "Should create 2 transport instances").toBe(2);
  });

  it("test_check_forfeited_when_factory_lost", () => {
    state.regions["factory_region"].owner_faction_id = "blue";
    state.pending_purchases["red"] = [{ unit_type_id: "infantry", count: 3 }];
    const events = placement.checkForfeited("red");
    expect(events.length, "Should emit forfeiture event").toBe(1);
    expect(events[0].type).toBe(GameEventType.PLACEMENT_FORFEITED);
    expect(events[0].payload.ipc_lost).toBe(9);
  });

  it("test_no_forfeiture_when_factory_retained", () => {
    const events = placement.checkForfeited("red");
    expect(events.length, "No forfeiture if factory retained").toBe(0);
  });
});
