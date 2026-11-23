import { describe, expect, it } from "vitest";
import { formatArenaReport, parseArenaArgs } from "../../src/ai/arenaCli";
import { playScenarioMatch, summarizeScenario, type ScenarioGame } from "../../src/ai/scenarioArena";
import { emptyDiagnostics } from "../../src/ai/simDiagnostics";

function game(patch: Partial<ScenarioGame>): ScenarioGame {
  return {
    seed: 1,
    scenario: "SCENARIO_GLOBAL_1940",
    winner: "",
    winnerTeam: "",
    winReason: "",
    rounds: 0,
    turnMs: [],
    capitalCaptures: 0,
    victoryCityCaptures: 0,
    io: {},
    battles: {},
    combatMoves: {},
    raids: {},
    roundsPlayed: 0,
    rejections: 0,
    rejectionNotes: [],
    stalled: false,
    factionsWithUnits: [],
    objectivesCompleted: 0,
    objectivesPossible: 0,
    blocInvasions: 0,
    diagnostics: emptyDiagnostics(),
    ...patch,
  };
}

describe("arena cli", () => {
  it("reads the scenario, difficulty, game count, and seed", () => {
    const args = parseArenaArgs(["--games", "500", "--scenario", "SCENARIO_GLOBAL_1940", "--difficulty", "NORMAL", "--seed", "1940"]);
    expect(args).toEqual({
      games: 500,
      scenarios: ["SCENARIO_GLOBAL_1940"],
      difficulty: "NORMAL",
      seed: 1940,
    });
    expect(parseArenaArgs([]).scenarios).toEqual(["SCENARIO_1942_QUICK", "SCENARIO_GLOBAL_1940"]);
    expect(parseArenaArgs([]).games).toBe(4);
  });

  it("splits axis and allied wins, city and capital victories, and industrial output", () => {
    const report = summarizeScenario([
      game({
        winnerTeam: "axis",
        winReason: "victory_cities",
        rounds: 4,
        turnMs: [10, 30],
        io: { ger: { spent: 10, destroyed: 20 } },
        objectivesCompleted: 1,
        objectivesPossible: 9,
        blocInvasions: 2,
        battles: {
          ger: {
            team: "axis",
            offense: { fought: 2, won: 2, lost: 0, draws: 0 },
            defense: { fought: 1, won: 0, lost: 1, draws: 0 },
          },
        },
        combatMoves: { ger: 2 },
        roundsPlayed: 3,
        rejections: 3,
        rejectionNotes: [{ faction: "ger", phase: "combat_move", round: 2, type: "move_units", code: "MOVE_INVALID", message: "No path", count: 1 }],
        stalled: true,
      }),
      game({
        winnerTeam: "allies",
        winReason: "capital_capture",
        rounds: 6,
        turnMs: [20],
        io: { ger: { spent: 10, destroyed: 0 }, ussr: { spent: 0, destroyed: 5 } },
        objectivesCompleted: 0,
        objectivesPossible: 9,
        blocInvasions: 0,
      }),
    ]);
    expect(report.axisWinPercent).toBe(50);
    expect(report.alliesWinPercent).toBe(50);
    expect(report.wins).toEqual({ victoryCities: 1, capitalCaptures: 1 });
    expect(report.averageRounds).toBe(5);
    expect(report.averageTurnMs).toBe(20);
    expect(report.ioEfficiency.ger).toBe(1);
    expect(report.ioEfficiency.ussr).toBe(0);
    expect(report.nationalObjectiveCompletionRate).toBeCloseTo(1 / 18);
    expect(report.neutralBlocInvasionFrequency).toBe(1);
    expect(report.battles.axis.offense).toEqual({ fought: 2, won: 2, lost: 0, draws: 0 });
    expect(report.battles.axis.defense).toEqual({ fought: 1, won: 0, lost: 1, draws: 0 });
    expect(report.battles.byFaction.ger.offense.won).toBe(2);
    expect(report.combatMoves.ger).toBe(2);
    expect(report.averageRoundsPlayed).toBe(1.5);
    expect(report.ioLedger.ger).toEqual({ spent: 20, destroyed: 20 });
    expect(report.illegalRejections).toBe(3);
    expect(report.rejectionReasons).toEqual([
      { faction: "ger", phase: "combat_move", round: 2, type: "move_units", code: "MOVE_INVALID", message: "No path", count: 1 },
    ]);
    expect(report.stalledGames).toBe(1);
    expect(formatArenaReport(report)).toContain("Axis 50.0%");
    expect(formatArenaReport(report)).toContain("Attacks Axis 2 fought, 2 won / 0 lost / 0 draw");
    expect(formatArenaReport(report)).toContain("ger spent 20 destroyed 20");
    expect(formatArenaReport(report)).toContain("MOVE_INVALID No path x1");
    expect(formatArenaReport(report)).toContain("Victory city wins 1");
  });

  it("plays one 1942 round on the demo map", () => {
    const played = playScenarioMatch({
      seed: 1940,
      scenario: "SCENARIO_1942_QUICK",
      difficulty: "EASY",
      maxRounds: 1,
    });
    expect(played.scenario).toBe("SCENARIO_1942_QUICK");
    expect(played.rounds).toBeGreaterThan(0);
    expect(played.turnMs.length).toBeGreaterThan(1);
    expect(played.stalled).toBe(false);
    expect(played.rounds).toBeGreaterThanOrEqual(2);
    expect(played.winnerTeam === "" || played.winnerTeam === "axis" || played.winnerTeam === "allies").toBe(true);
  }, 60000);

  it("gives the 1940 powers the units on the copied map and keeps playing", () => {
    const played = playScenarioMatch({
      seed: 1940,
      scenario: "SCENARIO_GLOBAL_1940",
      difficulty: "EASY",
      maxRounds: 1,
    });
    expect(played.factionsWithUnits).toEqual(expect.arrayContaining(["germany", "soviet_union", "japan", "united_kingdom", "united_states"]));
    expect(played.turnMs.length).toBeGreaterThan(1);
    expect(played.stalled).toBe(false);
    expect(played.rounds).toBeGreaterThanOrEqual(2);
  }, 60000);
});
