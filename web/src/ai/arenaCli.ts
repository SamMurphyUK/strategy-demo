import type { ScenarioId } from "../engine/types/ruleset";
import type { AIDifficulty } from "./types/aiTypes";
import type { ScenarioReport } from "./scenarioArena";
import { formatDiagnostics } from "./simDiagnostics";

export interface ArenaArgs {
  games: number;
  scenarios: ScenarioId[];
  difficulty: AIDifficulty;
  seed: number;
}

function flag(argv: readonly string[], name: string): string {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline != null) {
    return inline.slice(name.length + 1);
  }
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

function fightLine(label: string, row: { fought: number; won: number; lost: number; draws: number }): string {
  return `${label} ${row.fought} fought, ${row.won} won / ${row.lost} lost / ${row.draws} draw`;
}

function countLine(rows: Record<string, number>): string {
  const text = Object.entries(rows)
    .filter(([, count]) => count > 0)
    .map(([factionId, count]) => `${factionId} ${count}`)
    .join(", ");
  return text || "none";
}

export function formatArenaReport(report: ScenarioReport): string {
  const efficiency = Object.entries(report.ioLedger)
    .map(([factionId, row]) => `${factionId} spent ${row.spent} destroyed ${row.destroyed} (${report.ioEfficiency[factionId].toFixed(2)})`)
    .join(", ");
  const attacks = [
    fightLine("Axis", report.battles.axis.offense),
    fightLine("Allies", report.battles.allies.offense),
  ].join(". ");
  const defense = [
    fightLine("Axis", report.battles.axis.defense),
    fightLine("Allies", report.battles.allies.defense),
  ].join(". ");
  const factions = Object.entries(report.battles.byFaction)
    .map(([factionId, row]) => `${factionId} attacked ${row.offense.fought} (${row.offense.won}-${row.offense.lost}-${row.offense.draws}), defended ${row.defense.fought} (${row.defense.won}-${row.defense.lost}-${row.defense.draws})`)
    .join("; ");
  const rejections = report.rejectionReasons
    .map((note) => `${note.faction} round ${note.round} ${note.phase} ${note.type} ${note.code} ${note.message} x${note.count}`)
    .join("; ");
  return [
    `Axis ${report.axisWinPercent.toFixed(1)}%  Allies ${report.alliesWinPercent.toFixed(1)}%  Draws ${report.draws}`,
    `Victory city wins ${report.wins.victoryCities}  Capital capture wins ${report.wins.capitalCaptures}`,
    `Rounds played ${report.averageRoundsPlayed.toFixed(2)}  Clock ${report.averageRounds.toFixed(2)}  Average turn ${report.averageTurnMs.toFixed(1)} ms`,
    `IO ${efficiency || "none"}`,
    `Attacks ${attacks}`,
    `Defense ${defense}`,
    `Factions ${factions || "none"}`,
    `Combat moves ${countLine(report.combatMoves)}  Raids ${countLine(report.raids)}`,
    `Illegal rejections ${report.illegalRejections}  Stalled games ${report.stalledGames}${rejections ? `  ${rejections}` : ""}`,
    `National objective completion ${(report.nationalObjectiveCompletionRate * 100).toFixed(1)}%  Neutral bloc invasions ${report.neutralBlocInvasionFrequency.toFixed(2)} per game`,
    ...formatDiagnostics(report.diagnostics, report.scenario1940),
  ].join("\n");
}
