/**
 * Bake the fifteen landed side-profile aircraft.
 *
 *   npm run bake:landed -- --only US:fighter
 *   npm run bake:landed -- --only US:fighter --run
 *   npm run bake:landed -- --run
 *
 * Without --run every picture is priced and nothing is spent.
 */
import { bakeLandedAir } from "./overnightBake.mjs";

function parse(argv) {
  const args = { seeds: 1, only: null, maxUsd: 9.5, run: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run") {
      args.run = true;
    } else if (arg === "--seeds") {
      args.seeds = Number(argv[++i]);
    } else if (arg === "--only") {
      args.only = argv[++i];
    } else if (arg === "--max-usd") {
      args.maxUsd = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  if (!Number.isInteger(args.seeds) || args.seeds < 1 || args.seeds > 12) {
    throw new Error("--seeds must be an integer from 1 to 12");
  }
  if (!Number.isFinite(args.maxUsd) || args.maxUsd <= 0) {
    throw new Error("--max-usd must be a positive number");
  }
  return args;
}

bakeLandedAir(parse(process.argv.slice(2))).catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
