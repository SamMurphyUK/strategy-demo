import { beforeEach, describe, expect, it } from "vitest";
import { GameSession, loadJson } from "../../../src/engine";

describe("core/test_game_session", () => {
  let session: GameSession;

  beforeEach(() => {
    const map = loadJson("res://data/scenarios/minimal/map.json");
    const units = loadJson("res://data/scenarios/minimal/units.json");
    const factions = loadJson("res://data/scenarios/minimal/factions.json");
    const setup = loadJson("res://data/scenarios/minimal/setup.json");
    const rules = loadJson("res://data/scenarios/minimal/rules.json");
    session = GameSession.create(map, units, factions, setup, rules, { state: 12345, sequence: 1 });
  });

  it("test_initial_state", () => {
    const state = session.getState();
    expect(state.turn_info.current_faction_id).toBe("red");
    expect(String(state.turn_info.current_phase)).toBe("purchase");
  });

  it("test_end_phase", () => {
    const result = session.applyCommand({
      command_id: "c1",
      player_id: "red",
      type: "end_phase",
      payload: {},
    });
    expect(String(result.result_type)).toBe("ok");
    expect(String(result.new_state.turn_info.current_phase)).toBe("combat_move");
  });
});
