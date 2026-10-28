import { beforeEach, describe, expect, it } from "vitest";
import { GameSession, loadJson } from "../../../src/engine";

function createSession(): GameSession {
  return GameSession.create(
    loadJson("res://data/scenarios/minimal/map.json"),
    loadJson("res://data/scenarios/minimal/units.json"),
    loadJson("res://data/scenarios/minimal/factions.json"),
    loadJson("res://data/scenarios/minimal/setup.json"),
    loadJson("res://data/scenarios/minimal/rules.json"),
    { state: 12345, sequence: 1 },
  );
}

describe("integration/test_amphibious", () => {
  let session: GameSession;

  beforeEach(() => {
    session = createSession();
    session.state.transport_instances["transport_red_001"] = {
      region_id: "sea_west",
      cargo: [],
    };
  });

  it("test_load_transport_from_adjacent_land", () => {
    session.applyCommand({ command_id: "c1", player_id: "red", type: "end_phase", payload: {} });

    const result = session.applyCommand({
      command_id: "c2",
      player_id: "red",
      type: "load_transport",
      payload: {
        transport_instance_id: "transport_red_001",
        from_region_id: "red_capital",
        units: [{ unit_type_id: "infantry", count: 2 }],
      },
    });
    expect(String(result.result_type)).toBe("ok");

    const cargo = session.state.transport_instances["transport_red_001"].cargo;
    expect(cargo.length).toBe(1);
    expect(cargo[0].unit_type_id).toBe("infantry");
    expect(cargo[0].count).toBe(2);
  });

  it("test_designate_amphibious_assault", () => {
    session.applyCommand({ command_id: "c1", player_id: "red", type: "end_phase", payload: {} });
    session.applyCommand({
      command_id: "c2",
      player_id: "red",
      type: "load_transport",
      payload: {
        transport_instance_id: "transport_red_001",
        from_region_id: "red_capital",
        units: [{ unit_type_id: "infantry", count: 2 }],
      },
    });

    const result = session.applyCommand({
      command_id: "c3",
      player_id: "red",
      type: "designate_amphibious",
      payload: {
        transport_instance_id: "transport_red_001",
        origin_sea_zone_id: "sea_west",
        target_region_id: "blue_capital",
      },
    });
    expect(String(result.result_type)).toBe("ok");

    const stateSnapshot = session.getState();
    expect(stateSnapshot.pending_amphibious_assaults.length).toBe(1);
  });
});
