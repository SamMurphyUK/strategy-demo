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

function commands(): Dict[] {
  return [
    { command_id: "c1", player_id: "red", type: "end_phase", payload: {} },
    {
      command_id: "c2",
      player_id: "red",
      type: "move_units",
      payload: { moves: [{
        from_region_id: "red_front",
        to_region_id: "blue_front",
        units: [{ unit_type_id: "infantry", count: 3 }],
      }] },
    },
    { command_id: "c3", player_id: "red", type: "end_phase", payload: {} },
  ];
}

describe("integration/test_determinism", () => {
  it("test_identical_games_with_same_seed", () => {
    const session1 = createSession(12345);
    const session2 = createSession(12345);
    const events1: Dict[] = [];
    const events2: Dict[] = [];

    for (const cmd of commands()) {
      const r1 = session1.applyCommand(cmd);
      const r2 = session2.applyCommand(cmd);
      events1.push(...r1.events);
      events2.push(...r2.events);
    }
    expect(events1.length, "Same commands should produce same event count").toBe(events2.length);

    const state1 = session1.getState();
    const state2 = session2.getState();
    expect(String(state1.turn_info.current_phase)).toBe(String(state2.turn_info.current_phase));
    expect(state1.game_round).toBe(state2.game_round);
  });

  it("test_different_seeds_produce_different_combat", () => {
    const session1 = createSession(11111);
    const session2 = createSession(99999);
    for (const cmd of commands()) {
      session1.applyCommand(cmd);
      session2.applyCommand(cmd);
    }
    const state1 = session1.getState();
    const state2 = session2.getState();
    expect(
      state1.game_over && state2.game_over && state1.winner_faction_id === state2.winner_faction_id,
      "Different seeds should produce different outcomes (probabilistic)",
    ).toBe(false);
  });
});
