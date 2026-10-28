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

describe("core/test_full_turn", () => {
  let session: GameSession;

  beforeEach(() => {
    session = createSession();
  });

  it("test_initial_state", () => {
    const state = session.getState();
    expect(state.turn_info.current_faction_id).toBe("red");
    expect(String(state.turn_info.current_phase)).toBe("purchase");
    expect(state.turn_info.turn_number).toBe(1);
    expect(state.game_round).toBe(1);
    expect(state.ipc.red).toBe(24);
    expect(state.ipc.blue).toBe(24);
  });

  it("test_complete_peaceful_turn", () => {
    let result = session.applyCommand({
      command_id: "c1", player_id: "red", type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 2 }] },
    });
    expect(String(result.result_type)).toBe("ok");
    expect(result.new_state.ipc.red).toBe(18);

    result = session.applyCommand({ command_id: "c2", player_id: "red", type: "end_phase", payload: {} });
    expect(String(result.new_state.turn_info.current_phase)).toBe("combat_move");

    result = session.applyCommand({ command_id: "c3", player_id: "red", type: "end_phase", payload: {} });
    expect(String(result.new_state.turn_info.current_phase)).toBe("combat");

    result = session.applyCommand({ command_id: "c3b", player_id: "red", type: "end_phase", payload: {} });
    expect(String(result.new_state.turn_info.current_phase)).toBe("noncombat_move");

    result = session.applyCommand({ command_id: "c4", player_id: "red", type: "end_phase", payload: {} });
    expect(String(result.new_state.turn_info.current_phase)).toBe("mobilize");

    result = session.applyCommand({
      command_id: "c5", player_id: "red", type: "place_units",
      payload: { placements: [{
        region_id: "red_capital",
        units: [{ unit_type_id: "infantry", count: 2 }],
      }] },
    });
    expect(String(result.result_type)).toBe("ok");

    result = session.applyCommand({ command_id: "c6", player_id: "red", type: "end_phase", payload: {} });
    expect(String(result.new_state.turn_info.current_phase)).toBe("collect_income");

    result = session.applyCommand({ command_id: "c7", player_id: "red", type: "end_turn", payload: {} });
    expect(result.new_state.turn_info.current_faction_id).toBe("blue");
    expect(String(result.new_state.turn_info.current_phase)).toBe("purchase");
    expect(result.new_state.ipc.red).toBe(30);
  });

  it("test_movement_into_combat", () => {
    session.applyCommand({ command_id: "c1", player_id: "red", type: "end_phase", payload: {} });

    let result = session.applyCommand({
      command_id: "c2",
      player_id: "red",
      type: "move_units",
      payload: {
        moves: [{
          from_region_id: "red_front",
          to_region_id: "blue_front",
          units: [{ unit_type_id: "infantry", count: 3 }],
        }],
      },
    });
    expect(String(result.result_type)).toBe("ok");

    result = session.applyCommand({ command_id: "c3", player_id: "red", type: "end_phase", payload: {} });
    expect(String(result.new_state.turn_info.current_phase)).toBe("combat");

    result = session.applyCommand({ command_id: "c3b", player_id: "red", type: "end_phase", payload: {} });

    let hasBattle = false;
    for (const e of result.events) {
      if (String(e.type ?? "") === "battle_started") {
        hasBattle = true;
        break;
      }
    }
    expect(hasBattle, "Should have battle event").toBe(true);
  });

  it("test_out_of_turn_rejected", () => {
    const result = session.applyCommand({
      command_id: "c1", player_id: "blue", type: "purchase_units",
      payload: { purchases: [] },
    });
    expect(String(result.result_type)).toBe("error");
    expect(String(result.error?.code)).toBe("OUT_OF_TURN");
  });

  it("test_wrong_phase_command_rejected", () => {
    const result = session.applyCommand({
      command_id: "c1", player_id: "red", type: "move_units",
      payload: { moves: [] },
    });
    expect(String(result.result_type)).toBe("error");
    expect(String(result.error?.code)).toBe("ILLEGAL_ACTION");
  });
});
