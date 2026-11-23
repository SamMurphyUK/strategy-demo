import { parentPort } from "node:worker_threads";
import { playArenaGame, type ArenaGame } from "./arenaMatch";

interface ArenaJob {
  seeds: number[];
}

parentPort?.on("message", (job: ArenaJob) => {
  const games: ArenaGame[] = [];
  for (const seed of job.seeds ?? []) {
    games.push(playArenaGame(seed));
  }
  parentPort?.postMessage(games);
  parentPort?.close();
});
