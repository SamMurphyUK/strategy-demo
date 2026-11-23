import { parentPort } from "node:worker_threads";
import { playScenarioMatch, type ScenarioGame } from "./scenarioArena";
import type { ScenarioId } from "../engine/types/ruleset";
import type { AIDifficulty } from "./types/aiTypes";

interface MatchJob {
  seed: number;
  scenario: ScenarioId;
  difficulty: AIDifficulty;
  allies?: AIDifficulty;
}

interface ArenaJob {
  matches?: MatchJob[];
}

parentPort?.on("message", (job: ArenaJob) => {
  const games: ScenarioGame[] = [];
  for (const match of job.matches ?? []) {
    games.push(playScenarioMatch(match));
  }
  parentPort?.postMessage(games);
  parentPort?.close();
});
