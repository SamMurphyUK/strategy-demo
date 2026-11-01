import { beforeEach, describe, expect, it } from "vitest";
import { Command, GameEventType, GameState, MovementEngine, Region, Unit } from "../../../src/engine";

describe("core/test_movement", () => {
  let state: GameState;
  let movement: MovementEngine;

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
    state.regions["land_a"] = Region.fromDict({
      id: "land_a", name: "Land A", type: "land",
      ipc_value: 3, owner_faction_id: "red",
      is_capital: false, has_factory: false,
    });
    state.regions["land_b"] = Region.fromDict({
      id: "land_b", name: "Land B", type: "land",
      ipc_value: 3, owner_faction_id: "red",
      is_capital: false, has_factory: false,
    });
    state.regions["sea_1"] = Region.fromDict({
      id: "sea_1", name: "Sea 1", type: "sea",
      ipc_value: 0, owner_faction_id: "",
      is_capital: false, has_factory: false,
    });

    state.adjacency["land_a"] = ["land_b", "sea_1"];
    state.adjacency["land_b"] = ["land_a"];
    state.adjacency["sea_1"] = ["land_a"];

    state.region_units["land_a"] = [{ faction_id: "red", unit_type_id: "infantry", count: 5 }];
    state.region_units["land_b"] = [];
    state.region_units["sea_1"] = [];

    const transportId = "transport_red_001";
    state.transport_instances[transportId] = {
      instance_id: transportId,
      unit_type_id: "transport",
      cargo: [],
      region_id: "sea_1",
    };
    state.region_units["sea_1"] = [{
      faction_id: "red",
      unit_type_id: "transport",
      instance_id: transportId,
      count: 1,
    }];

    movement = new MovementEngine(state);
  });

  function moveCmd(count: number): Command {
    return Command.fromDict({
      command_id: "c1", player_id: "red", type: "move_units",
      payload: { moves: [{
        from_region_id: "land_a",
        to_region_id: "land_b",
        units: [{ unit_type_id: "infantry", count }],
      }] },
    });
  }

  it("test_move_units_transfers_between_regions", () => {
    movement.processMove(moveCmd(3));
    const landAUnits = state.getFactionUnitsInRegion("land_a", "red");
    const landBUnits = state.getFactionUnitsInRegion("land_b", "red");
    expect(landAUnits[0].count, "Land A should have 2 infantry left").toBe(2);
    expect(landBUnits[0].count, "Land B should have 3 infantry").toBe(3);
  });

  it("test_move_units_emits_event", () => {
    const events = movement.processMove(moveCmd(2));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.UNITS_MOVED);
    expect(events[0].payload.faction_id).toBe("red");
  });

  it("test_arrived_units_cannot_move_again_this_phase", () => {
    state.current_phase = "combat_move";
    movement.processMove(moveCmd(1));
    expect(state.movableStackCount("red", "land_b", "infantry")).toBe(0);
    expect(state.movableStackCount("red", "land_a", "infantry")).toBe(4);
  });

  it("test_move_all_units_removes_stack", () => {
    movement.processMove(moveCmd(5));
    const landAUnits = state.getFactionUnitsInRegion("land_a", "red");
    expect(landAUnits.length, "Land A should have no red units").toBe(0);
  });

  it("test_load_transport", () => {
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "load_transport",
      payload: {
        transport_instance_id: "transport_red_001",
        from_region_id: "land_a",
        units: [{ unit_type_id: "infantry", count: 2 }],
      },
    });
    movement.processLoad(cmd);

    const landAUnits = state.getFactionUnitsInRegion("land_a", "red");
    expect(landAUnits[0].count, "Land A should have 3 infantry left").toBe(3);

    const transport = state.transport_instances["transport_red_001"];
    expect(transport.cargo.length, "Transport should have cargo").toBe(1);
    expect(transport.cargo[0].unit_type_id).toBe("infantry");
    expect(transport.cargo[0].count).toBe(2);
  });

  it("test_load_transport_emits_event", () => {
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "load_transport",
      payload: {
        transport_instance_id: "transport_red_001",
        from_region_id: "land_a",
        units: [{ unit_type_id: "infantry", count: 1 }],
      },
    });
    const events = movement.processLoad(cmd);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.TRANSPORT_LOADED);
    expect(events[0].payload.transport_instance_id).toBe("transport_red_001");
  });

  it("test_unload_transport", () => {
    state.transport_instances["transport_red_001"].cargo = [{ unit_type_id: "infantry", count: 2 }];
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "unload_transport",
      payload: {
        transport_instance_id: "transport_red_001",
        to_region_id: "land_a",
        units: [{ unit_type_id: "infantry", count: 2 }],
      },
    });
    movement.processUnload(cmd);

    const transport = state.transport_instances["transport_red_001"];
    expect(transport.cargo.length, "Transport should be empty").toBe(0);
    const landAUnits = state.getFactionUnitsInRegion("land_a", "red");
    expect(landAUnits[0].count, "Land A should have 7 infantry").toBe(7);
  });

  it("test_unload_transport_emits_event", () => {
    state.transport_instances["transport_red_001"].cargo = [{ unit_type_id: "infantry", count: 1 }];
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "unload_transport",
      payload: {
        transport_instance_id: "transport_red_001",
        to_region_id: "land_a",
        units: [{ unit_type_id: "infantry", count: 1 }],
      },
    });
    const events = movement.processUnload(cmd);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.TRANSPORT_UNLOADED);
  });
});
