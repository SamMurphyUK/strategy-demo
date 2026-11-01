import { beforeEach, describe, expect, it } from "vitest";
import { GameState, Region } from "../../../src/engine";

describe("core/test_game_state", () => {
  let state: GameState;

  beforeEach(() => {
    state = new GameState();
    state.regions["region_a"] = Region.fromDict({
      id: "region_a", name: "Region A", type: "land",
      ipc_value: 5, owner_faction_id: "red",
      is_capital: true, has_factory: true,
    });
    state.regions["region_b"] = Region.fromDict({
      id: "region_b", name: "Region B", type: "land",
      ipc_value: 3, owner_faction_id: "blue",
      is_capital: false, has_factory: false,
    });
    state.regions["sea_1"] = Region.fromDict({
      id: "sea_1", name: "Sea Zone 1", type: "sea",
      ipc_value: 0, owner_faction_id: "",
      is_capital: false, has_factory: false,
    });

    state.adjacency["region_a"] = ["region_b", "sea_1"];
    state.adjacency["region_b"] = ["region_a"];
    state.adjacency["sea_1"] = ["region_a"];

    state.region_units["region_a"] = [];
    state.region_units["region_b"] = [];
    state.region_units["sea_1"] = [];

    state.ipc["red"] = 20;
    state.ipc["blue"] = 15;
  });

  it("test_get_adjacent_regions", () => {
    const adjacent = state.getAdjacentRegions("region_a");
    expect(adjacent.length).toBe(2);
    expect(adjacent.includes("region_b")).toBe(true);
    expect(adjacent.includes("sea_1")).toBe(true);
  });

  it("test_get_adjacent_regions_empty", () => {
    expect(state.getAdjacentRegions("nonexistent").length).toBe(0);
  });

  it("test_is_adjacent", () => {
    expect(state.isAdjacent("region_a", "region_b")).toBe(true);
    expect(state.isAdjacent("region_a", "sea_1")).toBe(true);
    expect(state.isAdjacent("region_b", "sea_1")).toBe(false);
  });

  it("test_get_region_owner", () => {
    expect(state.getRegionOwner("region_a")).toBe("red");
    expect(state.getRegionOwner("region_b")).toBe("blue");
    expect(state.getRegionOwner("sea_1")).toBe("");
  });

  it("test_set_region_owner", () => {
    state.setRegionOwner("region_b", "red");
    expect(state.getRegionOwner("region_b")).toBe("red");
  });

  it("test_ipc_operations", () => {
    expect(state.getFactionIpc("red")).toBe(20);
    state.modifyIpc("red", 5);
    expect(state.getFactionIpc("red")).toBe(25);
    state.modifyIpc("red", -10);
    expect(state.getFactionIpc("red")).toBe(15);
  });

  it("test_generate_instance_id_unique", () => {
    const id1 = state.generateInstanceId("transport", "red");
    const id2 = state.generateInstanceId("transport", "red");
    const id3 = state.generateInstanceId("transport", "blue");
    expect(id1).not.toBe(id2);
    expect(id1.startsWith("transport_red_")).toBe(true);
    expect(id3.startsWith("transport_blue_")).toBe(true);
  });

  it("test_get_faction_units_in_region", () => {
    state.region_units["region_a"] = [
      { faction_id: "red", unit_type_id: "infantry", count: 3 },
      { faction_id: "blue", unit_type_id: "infantry", count: 2 },
    ];
    const redUnits = state.getFactionUnitsInRegion("region_a", "red");
    const blueUnits = state.getFactionUnitsInRegion("region_a", "blue");
    expect(redUnits.length).toBe(1);
    expect(redUnits[0].count).toBe(3);
    expect(blueUnits.length).toBe(1);
  });

  it("test_get_enemy_units_in_region", () => {
    state.region_units["region_a"] = [
      { faction_id: "red", unit_type_id: "infantry", count: 3 },
      { faction_id: "blue", unit_type_id: "infantry", count: 2 },
    ];
    const enemies = state.getEnemyUnitsInRegion("region_a", "red");
    expect(enemies.length).toBe(1);
    expect(enemies[0].faction_id).toBe("blue");
  });

  it("test_to_snapshot", () => {
    state.current_faction_id = "red";
    state.current_phase = "purchase";
    state.turn_number = 1;
    state.game_round = 1;

    const snapshot = state.toSnapshot();
    expect(snapshot.turn_info.current_faction_id).toBe("red");
    expect(String(snapshot.turn_info.current_phase)).toBe("purchase");
    expect(snapshot.game_round).toBe(1);
    expect("ipc" in snapshot).toBe(true);
    expect("regions" in snapshot).toBe(true);
  });
});
