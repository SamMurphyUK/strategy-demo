import type { ScenarioId } from "../engine/types/ruleset";
import type { AIDifficulty } from "./types/aiTypes";
import type { ScenarioReport } from "./scenarioArena";

export interface ArenaArgs {
  games: number;
  scenarios: ScenarioId[];
  difficulty: AIDifficulty;
  seed: number;
}

function flag(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? "") : "";
}

export function parseArenaArgs(argv: readonly string[]): ArenaArgs {
  const games = Math.trunc(Number(flag(argv, "--games") || "4"));
  const scenario = flag(argv, "--scenario");
  const difficulty = flag(argv, "--difficulty").toUpperCase();
  const seed = Math.trunc(Number(flag(argv, "--seed") || "1940"));
  const scenarios: ScenarioId[] =
    scenario === "SCENARIO_GLOBAL_1940"
      ? ["SCENARIO_GLOBAL_1940"]
      : scenario === "SCENARIO_1942_QUICK"
        ? ["SCENARIO_1942_QUICK"]
        : ["SCENARIO_1942_QUICK", "SCENARIO_GLOBAL_1940"];
  const profile: AIDifficulty = difficulty === "EASY" || difficulty === "HARD" || difficulty === "NORMAL" ? difficulty : "NORMAL";
  return {
    games: Number.isFinite(games) && games > 0 ? games : 4,
    scenarios,
    difficulty: profile,
    seed: Number.isFinite(seed) ? seed : 1940,
  };
}

export function formatArenaReport(report: ScenarioReport): string {
  const efficiency = Object.entries(report.ioEfficiency)
    .map(([factionId, value]) => `${factionId} ${value.toFixed(2)}`)
    .join(", ");
  return [
    `Axis ${report.axisWinPercent.toFixed(1)}%  Allies ${report.alliesWinPercent.toFixed(1)}%  Draws ${report.draws}`,
    `Victory city wins ${report.wins.victoryCities}  Capital capture wins ${report.wins.capitalCaptures}`,
    `Average rounds ${report.averageRounds.toFixed(2)}  Average turn ${report.averageTurnMs.toFixed(1)} ms`,
    `IO efficiency ${efficiency || "none"}`,
    `National objective completion ${(report.nationalObjectiveCompletionRate * 100).toFixed(1)}%  Neutral bloc invasions ${report.neutralBlocInvasionFrequency.toFixed(2)} per game`,
  ].join("\n");
}
