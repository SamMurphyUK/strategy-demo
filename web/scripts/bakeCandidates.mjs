// Price or bake starter blueprints through the dev server.
//
//   npm run bake:candidates -- --faction GER --unit infantry --seeds 3
//   npm run bake:candidates -- --faction GER --unit infantry --seeds 3 --confirm
//
// Without --confirm every matching blueprint is sent with dryRunOnly so Retro Diffusion
// only runs check_cost. With --confirm the same request is paid for and written.
// A promoted faction hero PNG is reference_images[0] when that file is already on disk.
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rasterBlueprintAlbedo } from "../src/art/blockoutCompiler.ts";
import { bakePrompt, factionHeroBlueprintId, referencePlatesFor } from "../src/art/bakeReview.ts";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS } from "../src/art/starterParts.ts";
import { MILITARY } from "../src/ui/theme/militaryPalette.ts";
import { encodeRgbaPng } from "../dev/pngRgba.mjs";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BAKE_URL = process.env.BAKE_URL || "http://127.0.0.1:5173/__dev/bake-unit";

export function parseBakeArgs(argv) {
  const args = { faction: null, unit: null, seeds: 1, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") {
      args.confirm = true;
    } else if (arg === "--faction") {
      args.faction = requiredValue(argv, ++i, "--faction");
    } else if (arg === "--unit") {
      args.unit = requiredValue(argv, i + 1, "--unit");
      i += 1;
    } else if (arg === "--seeds") {
      const text = requiredValue(argv, ++i, "--seeds");
      const count = Number(text);
      if (!Number.isInteger(count) || count < 1 || count > 12) {
        throw new Error("--seeds must be an integer from 1 to 12");
      }
      args.seeds = count;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return args;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

export function selectBlueprints(blueprints, args) {
  const faction = args.faction?.toUpperCase() ?? null;
  const unit = args.unit?.toLowerCase() ?? null;
  return blueprints.filter((blueprint) => {
    if (faction && blueprint.factionId !== faction) {
      return false;
    }
    if (!unit) {
      return true;
    }
    return blueprint.blueprintId.toLowerCase() === unit || blueprint.unitTypeId.toLowerCase() === unit;
  });
}

export function seedList(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function creditCost(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of ["credits", "cost", "total"]) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) {
        return value[key];
      }
    }
  }
  return null;
}

export function totalCreditCost(costs) {
  return costs.reduce((sum, cost) => sum + (creditCost(cost) ?? 0), 0);
}

async function heroAvailable(factionId) {
  const relative = `public/assets/units/promoted/${factionId}/${factionHeroBlueprintId(factionId)}.png`;
  try {
    await access(path.join(WEB_ROOT, relative));
    return true;
  } catch {
    return false;
  }
}

function blockoutPng(blueprint) {
  const raster = rasterBlueprintAlbedo(blueprint, FACTION_MILITARY_MAPPINGS[blueprint.factionId]);
  const rgba = new Uint8ClampedArray(raster.albedoKeys.length * 4);
  for (let i = 0; i < raster.albedoKeys.length; i++) {
    const key = raster.albedoKeys[i];
    if (key == null) {
      continue;
    }
    const rgb = Number.parseInt(MILITARY[key].slice(1), 16);
    const offset = i * 4;
    rgba[offset] = (rgb >> 16) & 255;
    rgba[offset + 1] = (rgb >> 8) & 255;
    rgba[offset + 2] = rgb & 255;
    rgba[offset + 3] = 255;
  }
  return {
    albedoKeys: raster.albedoKeys,
    base64: encodeRgbaPng(blueprint.canvasSize.width, blueprint.canvasSize.height, rgba).toString("base64"),
  };
}

async function postBake(body) {
  let response;
  try {
    response = await fetch(BAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`The bake server at ${BAKE_URL} is not running (${error?.message ?? error})`);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.error || `Bake failed with ${response.status}`);
  }
  return json;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseBakeArgs(argv);
  const blueprints = selectBlueprints(STARTER_BLUEPRINTS, args);
  if (blueprints.length === 0) {
    throw new Error("No blueprints match that faction and unit.");
  }
  const seeds = seedList(args.seeds);
  const costs = [];
  for (const blueprint of blueprints) {
    const hero = await heroAvailable(blueprint.factionId);
    const plates = referencePlatesFor(blueprint, hero);
    const blockout = blockoutPng(blueprint);
    for (const seed of seeds) {
      const result = await postBake({
        factionId: blueprint.factionId,
        blueprintId: blueprint.blueprintId,
        width: blueprint.canvasSize.width,
        height: blueprint.canvasSize.height,
        prompt: bakePrompt(blueprint),
        blockoutBase64: blockout.base64,
        albedoKeys: blockout.albedoKeys,
        referencePlatePaths: plates,
        seed,
        dryRunOnly: !args.confirm,
      });
      costs.push(result.cost);
      if (args.confirm) {
        console.log(
          `${blueprint.blueprintId} seed ${seed}  IoU ${Number(result.silhouetteIoU).toFixed(3)}  ${result.quantizedPath}`,
        );
      } else {
        console.log(`${blueprint.blueprintId} seed ${seed}  cost ${JSON.stringify(result.cost)}`);
      }
    }
  }
  const total = totalCreditCost(costs);
  const jobs = blueprints.length * seeds.length;
  console.log(`${jobs} ${args.confirm ? "bakes" : "dry runs"} · total credit cost ${total}`);
  if (!args.confirm) {
    console.log("Dry run only. Re-run with --confirm to bake.");
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
