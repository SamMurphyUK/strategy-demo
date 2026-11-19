// Open baked pictures as layered unit files, at the size they were baked.
//
//   npm run plate:import -- --faction UK --unit tank
//   npm run plate:import -- --faction UK --unit tank --grade peeled --force
//   npm run plate:import -- --faction UK --unit tank --picture assets/candidates/UK/uk_tank_seed1.outlined.quantized.png
//   npm run plate:import -- --all
//
// The picture is cropped to its ink and put whole on the body layer of the unit's skeleton. Cutting it
// into layers is done in the sprite editor. Nothing here calls a network or a model.
//
// Which picture: --picture if given. Otherwise the candidates manifest row for that faction and unit:
// a promoted row first, then the asked-for grade (outlined by default, peeled when there is no
// outlined one), then the newest.
// A layered file already on disk is left alone unless --force is given, because it may hold cut layers.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeRgbaPng } from "../dev/pngRgba.mjs";
import { layeredUnitRelativePath, toLayeredFile } from "../src/art/layeredUnit.ts";
import { archetypeForUnitType, rosterUnitType } from "../src/art/archetypeLayers.ts";
import { plateDocument } from "../src/art/pixelPaint.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join("assets", "candidates", "manifest.json");
const GRADES = ["outlined", "peeled"];

export function parseImportArgs(argv) {
  const args = { faction: null, unit: null, grade: null, picture: null, all: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--faction" || arg === "--unit" || arg === "--grade" || arg === "--picture") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      args[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  if (args.faction) {
    args.faction = args.faction.toUpperCase();
  }
  if (args.unit) {
    args.unit = args.unit.toLowerCase();
  }
  if (args.grade && !GRADES.includes(args.grade)) {
    throw new Error(`--grade must be one of ${GRADES.join(", ")}`);
  }
  if (args.picture && (!args.faction || !args.unit)) {
    throw new Error("--picture needs --faction and --unit");
  }
  if (!args.all && !args.faction && !args.unit) {
    throw new Error("Say which plates: --faction, --unit, or --all");
  }
  return args;
}

/** The manifest row to import for each faction and unit, keyed "FACTION:unit". Riflemen are left out. */
export function choosePlates(candidates, args) {
  const wanted = args.grade ?? "outlined";
  const rank = (row) => {
    const grade = row.grade ?? "peeled";
    return [row.promoted ? 0 : 1, grade === wanted ? 0 : 1, -Date.parse(row.updatedAt ?? "1970-01-01T00:00:00Z")];
  };
  const chosen = new Map();
  for (const source of candidates) {
    // The manifest writes the bombers the short way. The layered file is named by the UNIT_DEFINITIONS key.
    const row = { ...source, unitTypeId: rosterUnitType(source.unitTypeId ?? "") };
    const archetype = archetypeForUnitType(row.unitTypeId);
    if (!archetype || archetype === "infantry" || typeof row.quantized !== "string") {
      continue;
    }
    if ((args.faction && row.factionId !== args.faction) || (args.unit && row.unitTypeId !== rosterUnitType(args.unit))) {
      continue;
    }
    const key = `${row.factionId}:${row.unitTypeId}`;
    const held = chosen.get(key);
    if (!held || compare(rank(row), rank(held)) < 0) {
      chosen.set(key, row);
    }
  }
  return [...chosen.values()].sort((a, b) => `${a.factionId}:${a.unitTypeId}`.localeCompare(`${b.factionId}:${b.unitTypeId}`));
}

function compare(left, right) {
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  return 0;
}

async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function importOne({ factionId, unitTypeId, blueprintId, picture }, force) {
  const relative = layeredUnitRelativePath(factionId, unitTypeId);
  const target = path.join(WEB_ROOT, relative);
  if (!force && (await exists(target))) {
    return { relative, skipped: true };
  }
  const decoded = decodeRgbaPng(await readFile(path.join(WEB_ROOT, picture)));
  const doc = plateDocument({
    factionId,
    unitTypeId,
    blueprintId,
    rgba: decoded.data,
    width: decoded.width,
    height: decoded.height,
    title: `${factionId} ${unitTypeId}`,
    sourcePath: picture.replaceAll("\\", "/"),
  });
  const file = toLayeredFile(doc);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(file, null, 1)}\n`, "utf8");
  return { relative, skipped: false, file };
}

async function main() {
  const args = parseImportArgs(process.argv.slice(2));
  let jobs;
  if (args.picture) {
    jobs = [{ factionId: args.faction, unitTypeId: rosterUnitType(args.unit), picture: args.picture }];
  } else {
    const manifest = JSON.parse(await readFile(path.join(WEB_ROOT, MANIFEST), "utf8"));
    jobs = choosePlates(manifest.candidates ?? [], args).map((row) => ({
      factionId: row.factionId,
      unitTypeId: row.unitTypeId,
      blueprintId: row.blueprintId,
      picture: row.quantized,
    }));
  }
  if (jobs.length === 0) {
    console.log("No baked picture matches.");
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await importOne(job, args.force);
      if (result.skipped) {
        console.log(`kept     ${result.relative} (already there, pass --force to replace it)`);
        continue;
      }
      const { canvasSize, displayDivisor } = result.file;
      console.log(
        `imported ${result.relative}  ${canvasSize.width}×${canvasSize.height}, divisor ${displayDivisor}, from ${job.picture}`,
      );
    } catch (error) {
      failed += 1;
      console.log(`failed   ${job.factionId} ${job.unitTypeId}: ${error?.message ?? error}`);
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
