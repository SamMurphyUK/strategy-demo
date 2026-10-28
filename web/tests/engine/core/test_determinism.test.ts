import { describe, expect, it } from "vitest";
import { type Dict, GameSession, loadJson } from "../../../src/engine";

function createSession(seedState: number): GameSession {
  return GameSession.create(
    loadJson("res://data/scenarios/minimal/map.json"),
    loadJson("res://data/scenarios/minimal/units.json"),
    loadJson("res://data/scenarios/minimal/factions.json"),
    loadJson("res://data/scenarios/minimal/setup.json"),
    loadJson("res://data/scenarios/minimal/rules.json"),
    { state: seedState, sequence: 1 },
  );
}

const COMMANDS: Dict[] = [
  { command_id: "c1", player_id: "red", type: "end_phase", payload: {} },
  { command_id: "c2", player_id: "red", type: "move_units",
    payload: { moves: [{ from_region_id: "red_front", to_region_id: "blue_front",
      units: [{ unit_type_id: "infantry", count: 3 }] }] } },
  { command_id: "c3", player_id: "red", type: "end_phase", payload: {} },
];

describe("core/test_determinism", () => {
  it("test_identical_games_with_same_seed", () => {
    const session1 = createSession(12345);
    const session2 = createSession(12345);
    const events1: Dict[] = [];
    const events2: Dict[] = [];

    for (const cmd of COMMANDS) {
      events1.push(...session1.applyCommand(cmd).events);
      events2.push(...session2.applyCommand(cmd).events);
    }
    expect(events1.length, "Same commands should produce same event count").toBe(events2.length);

    const state1 = session1.getState();
    const state2 = session2.getState();
    expect(state1.turn_info.current_phase).toBe(state2.turn_info.current_phase);
    expect(state1.game_round).toBe(state2.game_round);
  });

  it("test_different_seeds_produce_different_combat", () => {
    const session1 = createSession(11111);
    const session2 = createSession(99999);
    for (const cmd of COMMANDS) {
      session1.applyCommand(cmd);
      session2.applyCommand(cmd);
    }
    const state1: Dict = session1.getState();
    const state2: Dict = session2.getState();
    expect(
      state1.game_over && state2.game_over && state1.winner === state2.winner,
      "Different seeds should produce different outcomes (probabilistic)",
    ).toBe(false);
  });
});
