import { describe, expect, it } from "vitest";
import { Faction, GameSession, GameState, Region, Unit } from "../../src/engine";
import { playArenaGame, summarizeArena } from "../../src/ai/arenaMatch";
import { planTurn } from "../../src/ai/planTurn";
import { AI_DIFFICULTY_PROFILES, FACTION_PERSONAS, personaFor } from "../../src/ai/types/aiTypes";

function duel(attackers: number, defenders: number): GameState {
  const state = new GameState();
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 9, team: "axis" });
  state.factions.blue = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000ff", starting_ipc: 9, team: "allies" });
  state.ipc.red = 9;
  state.turn_order = ["red", "blue"];
  state.current_faction_id = "red";
  state.current_phase = "purchase";
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
  state.region_units.home = [{ faction_id: "red", unit_type_id: "infantry", count: attackers }];
  state.region_units.away = [{ faction_id: "blue", unit_type_id: "infantry", count: defenders }];
  return state;
}

describe("hybrid planner", () => {
  it("keeps the difficulty profiles and faction personas", () => {
    expect(AI_DIFFICULTY_PROFILES.EASY.beamWidth).toBe(2);
    expect(AI_DIFFICULTY_PROFILES.EASY.lookaheadPly).toBe(1);
    expect(AI_DIFFICULTY_PROFILES.NORMAL.fastOddsIterations).toBe(250);
    expect(AI_DIFFICULTY_PROFILES.HARD.deepOddsIterations).toBe(1500);
    expect(AI_DIFFICULTY_PROFILES.HARD.enableStrategicStaging).toBe(true);
    expect(FACTION_PERSONAS.GERMANY.personaId).toBe("BLITZKRIEG");
    expect(FACTION_PERSONAS.UNITED_KINGDOM.personaId).toBe("MARITIME");
    expect(personaFor("ger").holdWinThreshold).toBe(0.72);
    expect(personaFor("red").personaId).toBe("ATTRITIONAL");
  });

  it("attacks a weak tile and holds against a stack it cannot trade", () => {
    const session = new GameSession();
    session.bindArena(duel(6, 1), 4);
    const attack = planTurn(session.state, { difficulty: "EASY", seed: 4 });
    expect(attack.commands.some((command) => command.type === "move_units")).toBe(true);
    expect(attack.commands.some((command) => command.type === "end_turn")).toBe(true);
    expect(attack.evaluatedPlans).toBeGreaterThan(0);
    for (const command of attack.commands) {
      const result = session.applyCommand({
        command_id: command.command_id,
        player_id: command.player_id,
        type: command.type,
        payload: command.payload,
      });
      expect(result.result_type, `${command.type} ${result.error?.message ?? ""}`).toBe("ok");
    }
    expect(session.state.current_faction_id).toBe("blue");

    const hold = planTurn(duel(1, 6), { difficulty: "EASY", seed: 4 });
    expect(hold.commands.some((command) => command.type === "move_units")).toBe(false);
    expect(hold.expectedScoreDelta).toBe(0);
  });

  it("plays a seeded arena game without spending another faction's treasury", () => {
    const game = playArenaGame(3, "EASY", "EASY");
    expect(game.turns).toBeGreaterThan(0);
    expect(game.turns).toBeLessThanOrEqual(8);
    expect(game.ioSpent).toBeGreaterThanOrEqual(0);
    const report = summarizeArena([game, playArenaGame(4, "EASY", "EASY")]);
    expect(report.games).toBe(2);
    expect(report.botV2Wins + report.botV1Wins + report.draws).toBe(2);
  });
});
