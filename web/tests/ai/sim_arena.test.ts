import { describe, expect, it } from "vitest";
import { formatArenaReport, parseArenaArgs } from "../../src/ai/arenaCli";
import { playScenarioMatch, summarizeScenario, type ScenarioGame } from "../../src/ai/scenarioArena";

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
    objectivesCompleted: 0,
    objectivesPossible: 0,
    blocInvasions: 0,
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
    expect(formatArenaReport(report)).toContain("Axis 50.0%");
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
    expect(played.turnMs.length).toBeGreaterThan(0);
    expect(played.winnerTeam === "" || played.winnerTeam === "axis" || played.winnerTeam === "allies").toBe(true);
  }, 60000);
});
