import { describe, expect, it } from "vitest";
import { Faction, GameState, Region, Unit } from "../../src/engine";
import { handlePlannerMessage, planAITurn, plannerSeed } from "../../src/ai/planAITurn";

function duel(): GameState {
  const state = new GameState();
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 9, team: "axis" });
  state.factions.blue = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000ff", starting_ipc: 9, team: "allies" });
  state.ipc.red = 9;
  state.turn_order = ["red", "blue"];
  state.current_faction_id = "red";
  state.current_phase = "purchase";
  state.game_round = 2;
  state.unit_types.infantry = Unit.fromDict({
    id: "infantry",
    name: "Infantry",
    category: "land",
    attack: 1,
    defense: 2,
    movement: 1,
    cost: 3,
  });
  state.regions.home = Region.fromDict({
    id: "home",
    name: "Home",
    type: "land",
    ipc_value: 3,
    owner_faction_id: "red",
    has_factory: true,
  });
  state.regions.away = Region.fromDict({
    id: "away",
    name: "Away",
    type: "land",
    ipc_value: 2,
    owner_faction_id: "blue",
  });
  state.adjacency.home = ["away"];
  state.adjacency.away = ["home"];
  state.region_units.home = [{ faction_id: "red", unit_type_id: "infantry", count: 6 }];
  state.region_units.away = [{ faction_id: "blue", unit_type_id: "infantry", count: 1 }];
  return state;
}

function signatures(state: GameState, faction: string, matchSeed: number) {
  return planAITurn(state, faction, "EASY", matchSeed).commands.map((command) => ({
    type: command.type,
    player_id: command.player_id,
    payload: command.payload,
  }));
}

describe("planAITurn", () => {
  it("draws the same Mulberry32 seed from the match, the round, and the faction", () => {
    expect(plannerSeed(11, 2, "red")).toBe(plannerSeed(11, 2, "Red"));
    expect(plannerSeed(11, 2, "red")).not.toBe(plannerSeed(11, 3, "red"));
    expect(plannerSeed(11, 2, "red")).not.toBe(plannerSeed(11, 2, "blue"));
    expect(plannerSeed(11, 2, "red")).not.toBe(plannerSeed(12, 2, "red"));
  });

  it("plans the same commands for two clients and for a cloned worker payload", () => {
    const first = signatures(duel(), "red", 11);
    const second = signatures(duel(), "red", 11);
    expect(second).toEqual(first);
    expect(first.some((command) => command.type === "move_units")).toBe(true);

    const cloned = structuredClone(duel());
    const fromWorker = handlePlannerMessage({ state: cloned, faction: "red", difficulty: "EASY", matchSeed: 11 });
    expect(fromWorker.commands.map((command) => command.type)).toEqual(first.map((command) => command.type));
  });
});
