import { beforeEach, describe, expect, it } from "vitest";
import { Faction, GameEventType, GameState, Region, VictoryEngine } from "../../../src/engine";

describe("core/test_victory", () => {
  let state: GameState;
  let victory: VictoryEngine;

  beforeEach(() => {
    state = new GameState();
    state.factions["red"] = Faction.fromDict({ id: "red", name: "Red", color: "#FF0000", starting_ipc: 20 });
    state.factions["blue"] = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000FF", starting_ipc: 20 });
    state.regions["red_capital"] = Region.fromDict({
      id: "red_capital", name: "Red Capital", type: "land",
      ipc_value: 8, owner_faction_id: "red",
      is_capital: true, has_factory: true,
    });
    state.regions["blue_capital"] = Region.fromDict({
      id: "blue_capital", name: "Blue Capital", type: "land",
      ipc_value: 8, owner_faction_id: "blue",
      is_capital: true, has_factory: true,
    });
    state.rules = { victory_conditions: { type: "all_enemy_capitals" } };
    state.game_over = false;
    state.winner_faction_id = "";
    victory = new VictoryEngine(state);
  });

  it("test_no_victory_initially", () => {
    const events = victory.checkVictory();
    expect(events.length).toBe(0);
    expect(state.game_over).toBe(false);
  });

  it("test_victory_when_all_capitals_captured", () => {
    state.regions["blue_capital"].owner_faction_id = "red";
    const events = victory.checkVictory();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.GAME_FINISHED);
    expect(state.game_over).toBe(true);
    expect(state.winner_faction_id).toBe("red");
  });

  it("test_no_victory_with_partial_capture", () => {
    state.regions["neutral_capital"] = Region.fromDict({
      id: "neutral_capital", name: "Neutral", type: "land",
      ipc_value: 5, owner_faction_id: "neutral",
      is_capital: true, has_factory: true,
    });
    state.factions["neutral"] = Faction.fromDict({ id: "neutral", name: "Neutral", color: "#888888", starting_ipc: 10 });
    state.regions["blue_capital"].owner_faction_id = "red";
    const events = victory.checkVictory();
    expect(events.length).toBe(0);
    expect(state.game_over).toBe(false);
  });

  it("test_victory_event_payload", () => {
    state.regions["blue_capital"].owner_faction_id = "red";
    const events = victory.checkVictory();
    expect(events.length).toBe(1);
    expect(events[0].payload.winner_faction_id).toBe("red");
    expect(events[0].payload.reason).toBe("all_enemy_capitals_captured");
  });

  it("test_no_double_victory", () => {
    state.regions["blue_capital"].owner_faction_id = "red";
    victory.checkVictory();
    const events = victory.checkVictory();
    expect(events.length).toBe(0);
    expect(state.game_over).toBe(true);
  });
});
