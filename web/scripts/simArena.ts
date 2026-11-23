import os from "node:os";
import { Worker } from "node:worker_threads";
import { formatArenaReport, parseArenaArgs } from "../src/ai/arenaCli";
import { playScenarioMatch, summarizeScenario, type ScenarioGame } from "../src/ai/scenarioArena";
import type { ScenarioId } from "../src/engine/types/ruleset";
import type { AIDifficulty } from "../src/ai/types/aiTypes";

interface MatchJob {
  seed: number;
  scenario: ScenarioId;
  difficulty: AIDifficulty;
}

function runInWorkers(matches: MatchJob[]): Promise<ScenarioGame[]> {
  const url = new URL("../src/ai/arena.worker.ts", import.meta.url);
  const workers = Math.max(1, Math.min(matches.length, os.cpus().length - 1));
  const chunks: MatchJob[][] = Array.from({ length: workers }, () => []);
  matches.forEach((match, index) => {
    chunks[index % workers].push(match);
  });
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<ScenarioGame[]>((resolve, reject) => {
          const worker = new Worker(url, { execArgv: ["--import", "tsx"] });
          worker.once("message", (games: ScenarioGame[]) => {
            void worker.terminate();
            resolve(games);
          });
          worker.once("error", reject);
          worker.postMessage({ matches: chunk });
        }),
    ),
  ).then((parts) => parts.flat());
}

const args = parseArenaArgs(process.argv.slice(2));
const matches: MatchJob[] = Array.from({ length: args.games }, (_, index) => ({
  seed: args.seed + index * 97,
  scenario: args.scenarios[index % args.scenarios.length],
  difficulty: args.difficulty,
}));

try {
  const played = await runInWorkers(matches);
  const report = summarizeScenario(played);
  console.log(formatArenaReport(report));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const played = matches.map((match) => playScenarioMatch(match));
  const report = summarizeScenario(played);
  const message = error instanceof Error ? error.message : String(error);
  console.log(formatArenaReport(report));
  console.log(JSON.stringify({ ...report, workerFallback: message }, null, 2));
}
