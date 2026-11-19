// Export every layered unit file to its 80×56 card strip.
//
//   npm run animate:batch
//   npm run animate:batch -- --faction UK --unit tank
//   npm run animate:batch -- --check
//   npm run animate:batch -- --normalize-grain
//
// Reads   assets/layered/<FACTION>/<unitTypeId>.json
// Writes  public/assets/units/cards/<FACTION>/<unitTypeId>.png   eight cards side by side, 640×56
//         public/assets/units/cards/index.json                    what is in each strip
//
// The strip's cells, left to right: idle, move_1, idle_2, move_2, fire_windup, fire_peak,
// fire_recover, idle_settle. Each cell is the plate scaled down by its display divisor with the
// ground point on (40, 52). The pixels are the painted ones only. The ink outline is added by
// figureGround.ts when a card is drawn, so it is not in these files.
//
// The same file always gives the same strip. Nothing here calls a network or a model.
// A unit whose shifts are not whole card pixels, or whose ink leaves the card, is reported and not
// written, and the run exits with 1. --check reports and writes nothing.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeRgbaPng } from "../dev/pngRgba.mjs";
import { fromLayeredFile, normalizePlateGrain, renderCardStrip, toLayeredFile } from "../src/art/layeredUnit.ts";
import { POSE_FPS } from "../src/art/motionPreview.ts";
import { SHEET_FOOT_ANCHOR } from "../src/art/skeletonSchema.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAYERED = path.join("assets", "layered");
const CARDS = path.join("public", "assets", "units", "cards");

export function parseBatchArgs(argv) {
  const args = { faction: null, unit: null, check: false, normalizeGrain: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") {
      args.check = true;
    } else if (arg === "--normalize-grain") {
      args.normalizeGrain = true;
    } else if (arg === "--faction" || arg === "--unit") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      args[arg.slice(2)] = arg === "--faction" ? value.toUpperCase() : value.toLowerCase();
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return args;
}

const portable = (relative) => relative.replaceAll("\\", "/");

async function layeredFiles(args) {
  const root = path.join(WEB_ROOT, LAYERED);
  const factions = (await readdir(root).catch(() => [])).sort();
  const files = [];
  for (const faction of factions) {
    if (args.faction && faction !== args.faction) {
      continue;
    }
    const names = (await readdir(path.join(root, faction)).catch(() => [])).sort();
    for (const name of names) {
      if (name.endsWith(".json") && (!args.unit || name === `${args.unit}.json`)) {
        files.push(path.join(LAYERED, faction, name));
      }
    }
  }
  return files;
}

/** One index row: where the strip is and how to read it. No date, so a rerun writes the same bytes. */
export function indexEntry(doc, strip, layeredPath, cardPath) {
  return {
    factionId: doc.blueprint.factionId,
    unitTypeId: doc.blueprint.unitTypeId,
    blueprintId: doc.blueprint.blueprintId,
    card: portable(cardPath).replace(/^public\//, ""),
    layered: portable(layeredPath),
    cell: strip.cell,
    beats: strip.beats,
    fps: POSE_FPS,
    footAnchor: { ...SHEET_FOOT_ANCHOR },
    displayDivisor: doc.blueprint.displayDivisor ?? 1,
    outline: "drawn at display time",
  };
}

async function main() {
  const args = parseBatchArgs(process.argv.slice(2));
  const files = await layeredFiles(args);
  if (files.length === 0) {
    console.log(`No layered unit under ${portable(LAYERED)} matches. Import a plate first: npm run plate:import -- --faction UK --unit tank`);
    process.exitCode = 1;
    return;
  }
  const indexFile = path.join(WEB_ROOT, CARDS, "index.json");
  const index = new Map();
  try {
    for (const entry of JSON.parse(await readFile(indexFile, "utf8")).cards ?? []) {
      index.set(`${entry.factionId}:${entry.unitTypeId}`, entry);
    }
  } catch {
    // No index yet.
  }
  let failed = 0;
  for (const relative of files) {
    let doc;
    let strip;
    try {
      doc = fromLayeredFile(JSON.parse(await readFile(path.join(WEB_ROOT, relative), "utf8")));
      if (args.normalizeGrain) {
        const grain = normalizePlateGrain(doc);
        const before = `${doc.blueprint.canvasSize.width}×${doc.blueprint.canvasSize.height}`;
        doc = grain.doc;
        const after = `${doc.blueprint.canvasSize.width}×${doc.blueprint.canvasSize.height}`;
        if (grain.applied > 1 && !args.check) {
          await writeFile(path.join(WEB_ROOT, relative), `${JSON.stringify(toLayeredFile(doc), null, 1)}\n`);
        }
        console.log(`grain   ${portable(relative)}  ${grain.detected}× -> ${grain.applied > 1 ? after : `kept ${before}`}`);
      }
      strip = renderCardStrip(doc);
    } catch (error) {
      failed += 1;
      console.log(`failed  ${portable(relative)}: ${error?.message ?? error}`);
      continue;
    }
    if (strip.problems.length > 0) {
      failed += 1;
      console.log(`failed  ${portable(relative)}`);
      for (const problem of strip.problems) {
        console.log(`          ${problem}`);
      }
      continue;
    }
    const cardPath = path.join(CARDS, doc.blueprint.factionId, `${doc.blueprint.unitTypeId}.png`);
    if (!args.check) {
      await mkdir(path.dirname(path.join(WEB_ROOT, cardPath)), { recursive: true });
      await writeFile(path.join(WEB_ROOT, cardPath), encodeRgbaPng(strip.width, strip.height, strip.rgba));
      index.set(`${doc.blueprint.factionId}:${doc.blueprint.unitTypeId}`, indexEntry(doc, strip, relative, cardPath));
    }
    console.log(`${args.check ? "fits  " : "wrote "}  ${portable(cardPath)}  divisor ${doc.blueprint.displayDivisor ?? 1}`);
  }
  if (!args.check && index.size > 0) {
    const cards = [...index.values()].sort((a, b) => `${a.factionId}:${a.unitTypeId}`.localeCompare(`${b.factionId}:${b.unitTypeId}`));
    await mkdir(path.dirname(indexFile), { recursive: true });
    await writeFile(indexFile, `${JSON.stringify({ cards }, null, 2)}\n`, "utf8");
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
