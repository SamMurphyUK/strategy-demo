import { beforeEach, describe, expect, it } from "vitest";
import { Faction, GameEventType, GameState, Region, TurnEngine } from "../../../src/engine";

describe("core/test_turn_engine", () => {
  let state: GameState;
  let engine: TurnEngine;

  beforeEach(() => {
    state = new GameState();
    state.turn_order = ["red", "blue"];
    state.factions["red"] = Faction.fromDict({ id: "red", name: "Red", color: "#FF0000", starting_ipc: 20 });
    state.factions["blue"] = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000FF", starting_ipc: 15 });
    state.regions["capital"] = Region.fromDict({
      id: "capital", name: "Capital", type: "land",
      ipc_value: 10, owner_faction_id: "red",
      is_capital: true, has_factory: true,
    });
    engine = new TurnEngine(state);
  });

  it("test_start_game_sets_initial_state", () => {
    engine.startGame();
    expect(state.current_faction_id, "First faction should be red").toBe("red");
    expect(state.current_phase, "First phase should be purchase").toBe("purchase");
    expect(state.turn_number, "Turn number should be 1").toBe(1);
    expect(state.game_round, "Game round should be 1").toBe(1);
  });

  it("test_start_game_emits_phase_changed", () => {
    const events = engine.startGame();
    expect(events.length, "Should emit 1 event").toBe(1);
    expect(events[0].type).toBe(GameEventType.PHASE_CHANGED);
    expect(events[0].payload.faction_id).toBe("red");
    expect(events[0].payload.new_phase).toBe("purchase");
  });

  it("test_start_game_records_factories", () => {
    engine.startGame();
    const factories = state.factories_controlled_at_turn_start["red"] ?? [];
    expect(factories.includes("capital"), "Should record capital as factory").toBe(true);
  });

  it("test_advance_phase_cycles_through_all_phases", () => {
    engine.startGame();
    const expectedPhases = ["combat_move", "combat", "noncombat_move", "mobilize", "collect_income"];
    for (const expected of expectedPhases) {
      const events = engine.advancePhase();
      expect(state.current_phase, `Phase should be ${expected}`).toBe(expected);
      expect(events.length, "Should emit phase_changed event").toBe(1);
      expect(events[0].type).toBe(GameEventType.PHASE_CHANGED);
    }
  });

  it("test_advance_phase_stops_at_collect_income", () => {
    engine.startGame();
    for (let i = 0; i < 5; i++) {
      engine.advancePhase();
    }
    expect(state.current_phase).toBe("collect_income");
    const events = engine.advancePhase();
    expect(events.length, "Should not advance past collect_income").toBe(0);
    expect(state.current_phase).toBe("collect_income");
  });

  it("test_end_turn_switches_faction", () => {
    engine.startGame();
    state.current_phase = "collect_income";
    engine.endTurn();
    expect(state.current_faction_id, "Should switch to blue").toBe("blue");
    expect(state.current_phase, "Should reset to purchase").toBe("purchase");
    expect(state.turn_number, "Turn number should increment").toBe(2);
  });

  it("test_end_turn_increments_round_after_all_factions", () => {
    engine.startGame();
    state.current_phase = "collect_income";
    engine.endTurn();
    expect(state.game_round, "Still round 1 after red").toBe(1);

    state.current_phase = "collect_income";
    engine.endTurn();
    expect(state.current_faction_id, "Back to red").toBe("red");
    expect(state.game_round, "Now round 2").toBe(2);
  });

  it("test_end_turn_emits_turn_ended_and_phase_changed", () => {
    engine.startGame();
    state.current_phase = "collect_income";
    const events = engine.endTurn();
    expect(events.length, "Should emit 2 events").toBe(2);
    expect(events[0].type).toBe(GameEventType.TURN_ENDED);
    expect(events[1].type).toBe(GameEventType.PHASE_CHANGED);
  });
});
