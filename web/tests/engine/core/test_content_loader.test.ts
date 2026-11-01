import { beforeEach, describe, expect, it } from "vitest";
import { ContentLoader, type GameState } from "../../../src/engine";

describe("core/test_content_loader", () => {
  let state: GameState;

  beforeEach(() => {
    const loader = new ContentLoader();
    state = loader.loadScenario("res://data/scenario_1940_minimal.json") as GameState;
  });

  it("test_scenario_loaded", () => {
    expect(state).not.toBeNull();
    expect("germany" in state.factions).toBe(true);
    expect("uk" in state.factions).toBe(true);
    expect("germany" in state.regions).toBe(true);
    expect("uk" in state.regions).toBe(true);
    expect("germany" in state.region_units).toBe(true);
  });

  it("test_starting_ipc_and_units", () => {
    expect(state.getFactionIpc("germany")).toBe(30);
    expect(state.getFactionIpc("uk")).toBe(28);

    let infCount = 0;
    for (const u of state.region_units["germany"]) {
      if (u.unit_type_id === "infantry") {
        infCount += u.count;
      }
    }
    expect(infCount).toBe(6);
  });

  it("test_rules_and_turn_order", () => {
    expect(state.rules.victory_conditions.type).toBe("all_enemy_capitals");
    expect(state.current_phase).toBe("purchase");
    expect(state.game_round).toBe(1);
    expect(["germany", "uk"].includes(state.current_faction_id)).toBe(true);
  });
});
