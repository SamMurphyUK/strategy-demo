import { Worker } from "node:worker_threads";
import { playArenaGame, summarizeArena, type ArenaGame } from "../src/ai/arenaMatch";

function gamesFromArgv(argv: readonly string[]): number {
  const index = argv.indexOf("--games");
  const raw = index >= 0 ? Number(argv[index + 1]) : 4;
  const games = Math.trunc(raw);
  if (!Number.isFinite(games) || games < 1) {
    return 4;
  }
  return games;
}

function runInWorkers(seeds: number[]): Promise<ArenaGame[]> {
  const url = new URL("../src/ai/aiPlanner.worker.ts", import.meta.url);
  const chunks: number[][] = [[], []];
  seeds.forEach((seed, index) => {
    chunks[index % chunks.length].push(seed);
  });
  const jobs = chunks.filter((chunk) => chunk.length > 0);
  return Promise.all(
    jobs.map(
      (chunk) =>
        new Promise<ArenaGame[]>((resolve, reject) => {
          const worker = new Worker(url, { execArgv: ["--import", "tsx"] });
          worker.once("message", (games: ArenaGame[]) => {
            void worker.terminate();
            resolve(games);
          });
          worker.once("error", reject);
          worker.postMessage({ seeds: chunk });
        }),
    ),
  ).then((parts) => parts.flat());
}

const games = gamesFromArgv(process.argv.slice(2));
const seeds = Array.from({ length: games }, (_, index) => 1000 + index * 97);

try {
  const played = await runInWorkers(seeds);
  const report = summarizeArena(played);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const played = seeds.map((seed) => playArenaGame(seed));
  const report = summarizeArena(played);
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ...report, workerFallback: message }, null, 2));
}
