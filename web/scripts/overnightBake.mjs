/**
 * Unattended Retro Diffusion v2 batch.
 *
 *   npm run bake:overnight
 *   npm run bake:overnight -- --run --seeds 3 --max-usd 9.50
 *   npm run bake:overnight -- --run --faction GER --unit battleship --seeds 1 --style rd_lite__simple
 *
 * Without --run every job is sent with check_cost and nothing is spent.
 * With --run each seed is generated in order. Idempotency keys are written to
 * web/assets/candidates/overnight_ledger.json before the paid request, so a
 * restart resumes the same task instead of buying it twice.
 *
 * Input is the sliced plate at its own size (see historicalUnits.mjs) at strength 0.45,
 * standing on the bottom row of a canvas the model accepts. Land units go to RD Fast.
 * Aircraft and ships are larger than Fast allows, so they go to Core.
 * reference_images is not sent. Results land in web/assets/candidates.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FACTION_MILITARY_MAPPINGS, activePalette } from "../dev/militaryStrip.mjs";
import { candidateRelativePath, quantizeToActiveKeys } from "../dev/bakeUnitPlugin.mjs";
import { encodeRgbaPng } from "../dev/pngRgba.mjs";
import { FACTIONS, LAND_UNITS, UNIT_TYPES, bakePromptFor, blueprintIdFor } from "./historicalUnits.mjs";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATE_DIR = path.join(WEB_ROOT, "reference_plates");
const CANDIDATE_DIR = path.join(WEB_ROOT, "assets", "candidates");
const LEDGER_PATH = path.join(CANDIDATE_DIR, "overnight_ledger.json");
const MANIFEST_PATH = path.join(CANDIDATE_DIR, "manifest.json");
const RD_INFERENCES = "https://api.retrodiffusion.ai/v2/inferences";
const ENV_PATH = path.join(WEB_ROOT, ".env.local");

/** Land units fit RD Fast. */
export const LAND_STYLE = "rd_fast__default";
/** Aircraft and ships need the 512 side that Core allows. */
export const LARGE_STYLE = "rd_core__simple";
/** The smallest and largest side each model accepts. */
export const STYLE_LIMITS = {
  rd_fast__default: { min: 64, max: 384 },
  rd_core__simple: { min: 16, max: 512 },
  rd_lite__simple: { min: 16, max: 512 },
};
/** 45% of the way from the reference plate toward a new drawing. */
export const INPUT_STRENGTH = 0.45;
/** Canvas sides are rounded up to this. The plate is padded, never scaled. */
const CANVAS_STEP = 16;
const POLL_MS = 2000;
const BACKOFF_MS = 30_000;
const TASK_TIMEOUT_MS = 180_000;

export function styleFor(unitTypeId) {
  return LAND_UNITS.has(unitTypeId) ? LAND_STYLE : LARGE_STYLE;
}

/** The image size to ask for: the plate's size, padded up to what the model accepts. */
export function canvasFor(width, height, style) {
  const limits = STYLE_LIMITS[style];
  if (!limits) {
    throw new Error(`No size limits for ${style}`);
  }
  const side = (value) => Math.max(limits.min, Math.ceil(value / CANVAS_STEP) * CANVAS_STEP);
  const canvas = { width: side(width), height: side(height) };
  if (canvas.width > limits.max || canvas.height > limits.max) {
    throw new Error(`A ${width}×${height} plate does not fit ${style}, which stops at ${limits.max}`);
  }
  return canvas;
}

export function parseOvernightArgs(argv) {
  const args = { run: false, seeds: 3, maxUsd: 9.5, limit: null, unit: null, faction: null, style: null, except: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run") {
      args.run = true;
    } else if (arg === "--seeds") {
      const count = Number(required(argv, ++i, "--seeds"));
      if (!Number.isInteger(count) || count < 1 || count > 12) {
        throw new Error("--seeds must be an integer from 1 to 12");
      }
      args.seeds = count;
    } else if (arg === "--max-usd") {
      const amount = Number(required(argv, ++i, "--max-usd"));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("--max-usd must be a positive number");
      }
      args.maxUsd = amount;
    } else if (arg === "--limit") {
      const count = Number(required(argv, ++i, "--limit"));
      if (!Number.isInteger(count) || count < 1) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = count;
    } else if (arg === "--unit") {
      args.unit = required(argv, ++i, "--unit");
    } else if (arg === "--faction") {
      args.faction = required(argv, ++i, "--faction");
    } else if (arg === "--style") {
      args.style = required(argv, ++i, "--style");
    } else if (arg === "--except") {
      args.except = required(argv, ++i, "--except");
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return args;
}

function required(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

/** The model and size are part of the key, so a picture bought at another size is a different job. */
export function jobKey(job, canvas) {
  return `${job.factionId}/${job.blueprintId}/seed${job.seed}/${job.style}/${canvas.width}x${canvas.height}`;
}

export function buildQueue(seeds, unit = null, faction = null, style = null, except = null) {
  const jobs = [];
  if (except && !UNIT_TYPES.includes(except)) {
    throw new Error(`Unknown unit ${except}`);
  }
  const units = (unit ? UNIT_TYPES.filter((unitTypeId) => unitTypeId === unit) : UNIT_TYPES).filter(
    (unitTypeId) => unitTypeId !== except,
  );
  if (unit && units.length === 0) {
    throw new Error(`Unknown unit ${unit}`);
  }
  const factions = faction ? FACTIONS.filter((factionId) => factionId === faction) : FACTIONS;
  if (faction && factions.length === 0) {
    throw new Error(`Unknown faction ${faction}`);
  }
  if (style && !STYLE_LIMITS[style]) {
    throw new Error(`Unknown style ${style}`);
  }
  for (const factionId of factions) {
    for (const unitTypeId of units) {
      const blueprintId = blueprintIdFor(factionId, unitTypeId);
      for (let seed = 1; seed <= seeds; seed++) {
        jobs.push({
          factionId,
          unitTypeId,
          blueprintId,
          seed,
          style: style ?? styleFor(unitTypeId),
          prompt: bakePromptFor(factionId, unitTypeId),
          platePath: path.join(PLATE_DIR, factionId, `${unitTypeId}.png`),
        });
      }
    }
  }
  return jobs;
}

export function inferenceBody({ style, prompt, width, height, inputImage, seed, checkCost }) {
  return {
    prompt_style: style,
    prompt,
    width,
    height,
    num_images: 1,
    input_image: inputImage,
    strength: INPUT_STRENGTH,
    remove_bg: true,
    upscale_output_factor: 1,
    bypass_prompt_expansion: true,
    seed,
    check_cost: checkCost,
  };
}

/**
 * Where a job's pictures are saved. A style other than the unit's usual one is named in the
 * file, so a trial on another model sits beside the usual picture.
 */
export function candidatePaths(job) {
  const raw = candidateRelativePath(job.factionId, job.blueprintId, job.seed);
  const tag = job.style === styleFor(job.unitTypeId) ? "" : `.${job.style}`;
  return {
    raw: raw.replace(/\.raw\.png$/, `${tag}.raw.png`),
    quantized: raw.replace(/\.raw\.png$/, `${tag}.quantized.png`),
  };
}

/** One manifest row per faction, blueprint, seed and model. */
export function upsertStyled(manifest, entry) {
  const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
  const rest = candidates.filter(
    (item) =>
      !(
        item?.factionId === entry.factionId &&
        item?.blueprintId === entry.blueprintId &&
        String(item?.seed) === String(entry.seed) &&
        (item?.promptStyle ?? LAND_STYLE) === entry.promptStyle &&
        (item?.grade ?? "peeled") === (entry.grade ?? "peeled")
      ),
  );
  return { candidates: [...rest, entry] };
}

export function quotedUsd(payload) {
  const value = payload?.balance_cost ?? payload?.cost ?? payload?.result?.balance_cost;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function spentUsd(ledger) {
  const jobs = ledger?.jobs ?? {};
  return Object.values(jobs).reduce((sum, job) => {
    if (job?.status !== "succeeded") return sum;
    return sum + (typeof job.cost === "number" ? job.cost : 0);
  }, 0);
}

export function emptyLedger() {
  return { strength: INPUT_STRENGTH, jobs: {} };
}

function portable(relative) {
  return relative.split(path.sep).join("/");
}

async function loadEnv() {
  let text = "";
  try {
    text = await readFile(ENV_PATH, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    if (process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback();
    throw error;
  }
}

async function saveLedger(ledger) {
  await mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transient(status) {
  return status === 408 || status === 429 || status >= 500;
}

function errorText(json, status) {
  const detail = json?.error ?? json?.message;
  if (typeof detail === "string" && detail !== "") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
  return `Retro Diffusion returned ${status}`;
}

async function rdFetch(url, options) {
  const once = async () => {
    const response = await fetch(url, options);
    const json = await response.json().catch(() => ({}));
    return { response, json };
  };
  try {
    const first = await once();
    if (!transient(first.response.status)) return first;
    await sleep(BACKOFF_MS);
    return once();
  } catch (error) {
    await sleep(BACKOFF_MS);
    try {
      return once();
    } catch (retryError) {
      throw new Error(retryError?.message ?? error?.message ?? "Retro Diffusion request failed");
    }
  }
}

async function postInference(token, body, idempotencyKey) {
  const headers = { "Content-Type": "application/json", "X-RD-Token": token };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const { response, json } = await rdFetch(RD_INFERENCES, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(errorText(json, response.status));
  }
  return json;
}

function imageFromPayload(json) {
  const image = json?.base64_images?.[0] ?? json?.result?.base64_images?.[0];
  if (typeof image !== "string" || image === "") return null;
  return { image: stripDataUrl(image), cost: quotedUsd(json?.result) ?? quotedUsd(json) };
}

function stripDataUrl(value) {
  const text = String(value ?? "");
  const comma = text.indexOf(",");
  if (text.startsWith("data:") && comma !== -1) return text.slice(comma + 1);
  return text;
}

async function pollTask(token, taskId) {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  const url = `${RD_INFERENCES}/tasks/${encodeURIComponent(taskId)}`;
  while (Date.now() < deadline) {
    const { response, json } = await rdFetch(url, { headers: { "X-RD-Token": token } });
    if (!response.ok) {
      throw new Error(errorText(json, response.status));
    }
    if (json.status === "failed") {
      throw new Error(typeof json.error === "string" ? json.error : "Retro Diffusion marked the task failed");
    }
    if (json.status === "succeeded") {
      const image = json.result?.base64_images?.[0];
      if (!image) throw new Error("Retro Diffusion succeeded without an image");
      return { image: stripDataUrl(image), cost: quotedUsd(json.result) ?? quotedUsd(json) };
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Retro Diffusion timed out after ${TASK_TIMEOUT_MS / 1000}s`);
}

/**
 * Stand the plate on the bottom row of the canvas, centred, at one plate pixel per canvas pixel.
 * Pure so the placement can be tested without a file.
 */
export function placeOnCanvas(plateRgba, plateWidth, plateHeight, canvas) {
  const left = Math.floor((canvas.width - plateWidth) / 2);
  const top = canvas.height - plateHeight;
  const rgba = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  const albedoKeys = new Array(canvas.width * canvas.height).fill(null);
  for (let y = 0; y < plateHeight; y++) {
    for (let x = 0; x < plateWidth; x++) {
      const from = (y * plateWidth + x) * 4;
      if (plateRgba[from + 3] < 128) continue;
      const pixel = (top + y) * canvas.width + left + x;
      rgba[pixel * 4] = plateRgba[from];
      rgba[pixel * 4 + 1] = plateRgba[from + 1];
      rgba[pixel * 4 + 2] = plateRgba[from + 2];
      rgba[pixel * 4 + 3] = 255;
      albedoKeys[pixel] = "steel";
    }
  }
  return { rgba, albedoKeys };
}

async function plateInput(platePath, style) {
  const { data, info } = await sharp(await readFile(platePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const canvas = canvasFor(info.width, info.height, style);
  const placed = placeOnCanvas(data, info.width, info.height, canvas);
  const png = encodeRgbaPng(canvas.width, canvas.height, placed.rgba);
  return { base64: Buffer.from(png).toString("base64"), albedoKeys: placed.albedoKeys, canvas };
}

/**
 * Peel near-black pixels that touch transparency. A black ink contour is not on the military
 * strip, and snapping it would turn it into charcoal. Interior pixels are left for the palette.
 */
export function dropInkOutlines(rgba, width, height) {
  const out = new Uint8ClampedArray(rgba);
  const ink = (offset) => {
    if (out[offset + 3] < 128) return false;
    const max = Math.max(out[offset], out[offset + 1], out[offset + 2]);
    const min = Math.min(out[offset], out[offset + 1], out[offset + 2]);
    return max <= 24 && max - min <= 18;
  };
  for (let pass = 0; pass < 4; pass++) {
    const clear = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        if (!ink(offset)) continue;
        const touchesClear = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(([nx, ny]) => nx < 0 || ny < 0 || nx >= width || ny >= height || out[(ny * width + nx) * 4 + 3] < 128);
        if (touchesClear) clear.push(offset);
      }
    }
    if (clear.length === 0) break;
    for (const offset of clear) out[offset + 3] = 0;
  }
  return out;
}

/**
 * Grey paint has no faction hue, so it is moved onto that faction's hull colour before the
 * snap. Near-black stays on charcoal. A saturated pixel is left for the nearest strip colour.
 */
export function biasGreysToHull(rgba, palette, hullKey) {
  const hull = palette.find((entry) => entry.key === hullKey);
  const shadow = palette.find((entry) => entry.key === "charcoal") ?? hull;
  if (!hull) {
    throw new Error(`The faction palette has no ${hullKey}`);
  }
  const out = new Uint8ClampedArray(rgba);
  for (let offset = 0; offset < out.length; offset += 4) {
    if (out[offset + 3] < 128) continue;
    const max = Math.max(out[offset], out[offset + 1], out[offset + 2]);
    const min = Math.min(out[offset], out[offset + 1], out[offset + 2]);
    if (max - min > 36) continue;
    const target = max < 40 ? shadow : hull;
    out[offset] = target.r;
    out[offset + 1] = target.g;
    out[offset + 2] = target.b;
  }
  return out;
}

/** The outer charcoal pixels are the ink contour. Two passes turn that ring into the hull colour. */
export function liftEdgeShadow(rgba, width, height, palette, hullKey) {
  const hull = palette.find((entry) => entry.key === hullKey);
  const shadow = palette.find((entry) => entry.key === "charcoal");
  if (!hull || !shadow) return new Uint8ClampedArray(rgba);
  const out = new Uint8ClampedArray(rgba);
  const isShadow = (offset) =>
    out[offset + 3] >= 128 && out[offset] === shadow.r && out[offset + 1] === shadow.g && out[offset + 2] === shadow.b;
  for (let pass = 0; pass < 2; pass++) {
    const hits = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        if (!isShadow(offset)) continue;
        const open = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(([nx, ny]) => nx < 0 || ny < 0 || nx >= width || ny >= height || out[(ny * width + nx) * 4 + 3] < 128);
        if (open) hits.push(offset);
      }
    }
    for (const offset of hits) {
      out[offset] = hull.r;
      out[offset + 1] = hull.g;
      out[offset + 2] = hull.b;
    }
  }
  return out;
}

/** The result at the canvas size. It is only resized when the model returns another size. */
async function resultOnCanvas(bytes, canvas) {
  const meta = await sharp(bytes).metadata();
  const same = meta.width === canvas.width && meta.height === canvas.height;
  const png = same
    ? bytes
    : await sharp(bytes).resize(canvas.width, canvas.height, { fit: "fill", kernel: "nearest" }).png().toBuffer();
  const data = await sharp(png).ensureAlpha().raw().toBuffer();
  return { png, data, returned: { width: meta.width, height: meta.height } };
}

function money(value) {
  return value == null ? "unknown" : `$${value.toFixed(4)}`;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseOvernightArgs(argv);
  await loadEnv();
  const token = process.env.RD_API_TOKEN;
  if (!token) {
    throw new Error("RD_API_TOKEN is not set in web/.env.local");
  }
  const jobs = buildQueue(args.seeds, args.unit, args.faction, args.style, args.except).slice(0, args.limit ?? Infinity);
  const ledger = await readJson(LEDGER_PATH, emptyLedger);
  if (!ledger.jobs) ledger.jobs = {};
  let manifest = await readJson(MANIFEST_PATH, () => ({ candidates: [] }));
  if (!Array.isArray(manifest.candidates)) manifest = { candidates: [] };

  console.log(`${jobs.length} images · strength ${INPUT_STRENGTH} · ${args.run ? "run" : "dry run"} · cap ${money(args.maxUsd)}`);
  let quotedTotal = 0;
  let unknownQuotes = 0;

  for (const job of jobs) {
    const plate = await plateInput(job.platePath, job.style);
    const canvas = plate.canvas;
    const key = jobKey(job, canvas);
    const prior = ledger.jobs[key];
    const body = inferenceBody({
      style: job.style,
      prompt: job.prompt,
      width: canvas.width,
      height: canvas.height,
      inputImage: plate.base64,
      seed: job.seed,
      checkCost: true,
    });

    if (args.run && prior?.status === "succeeded") {
      console.log(`${key} already saved ${money(prior.cost)}`);
      continue;
    }
    if (args.run && prior?.status === "failed" && !prior.taskId) {
      console.log(`${key} failed before a task id was saved. Not buying it again.`);
      continue;
    }

    const quoteJson = await postInference(token, body, null);
    const quote = quotedUsd(quoteJson);
    if (quote == null) unknownQuotes += 1;
    else quotedTotal += quote;
    console.log(`${key} quote ${money(quote)}`);

    if (!args.run) continue;

    const alreadyBought = Boolean(prior?.taskId);
    const spent = spentUsd(ledger);
    if (!alreadyBought && quote == null) {
      console.log(`${key} did not return a USD quote. Skipped.`);
      continue;
    }
    if (!alreadyBought && spent + quote > args.maxUsd) {
      console.log(`Stop. ${money(spent)} spent and the next image is ${money(quote)}, over the ${money(args.maxUsd)} cap.`);
      break;
    }

    const record = prior?.idempotencyKey
      ? { ...prior }
      : {
          idempotencyKey: randomUUID(),
          factionId: job.factionId,
          unitTypeId: job.unitTypeId,
          blueprintId: job.blueprintId,
          seed: job.seed,
          promptStyle: job.style,
          width: canvas.width,
          height: canvas.height,
          status: "pending",
        };
    record.quotedCost = quote;
    ledger.jobs[key] = record;
    await saveLedger(ledger);

    let result = null;
    let taskId = record.taskId ?? null;
    if (!taskId) {
      let submitted;
      try {
        submitted = await postInference(token, { ...body, check_cost: false }, record.idempotencyKey);
      } catch (error) {
        record.status = "failed";
        record.error = error?.message ?? String(error);
        await saveLedger(ledger);
        console.log(`${key} ${record.error}`);
        continue;
      }
      result = imageFromPayload(submitted);
      taskId = submitted.task_id ?? submitted.id ?? null;
      if (!result && (typeof taskId !== "string" || taskId === "")) {
        record.status = "failed";
        record.error = "Retro Diffusion did not return a task id";
        await saveLedger(ledger);
        console.log(`${key} ${record.error}`);
        continue;
      }
      if (taskId) {
        record.taskId = taskId;
        record.status = result ? "succeeded" : "submitted";
        await saveLedger(ledger);
      }
    }

    if (!result) {
      try {
        result = await pollTask(token, taskId);
      } catch (error) {
        record.status = "failed";
        record.error = error?.message ?? String(error);
        await saveLedger(ledger);
        console.log(`${key} ${record.error}`);
        continue;
      }
    }

    const fitted = await resultOnCanvas(Buffer.from(result.image, "base64"), canvas);
    if (fitted.returned.width !== canvas.width || fitted.returned.height !== canvas.height) {
      console.log(`${key} came back ${fitted.returned.width}×${fitted.returned.height} and was resized to ${canvas.width}×${canvas.height}`);
    }
    const palette = activePalette(job.factionId);
    const painted = biasGreysToHull(
      dropInkOutlines(fitted.data, canvas.width, canvas.height),
      palette,
      FACTION_MILITARY_MAPPINGS[job.factionId].primary_uniform_or_hull,
    );
    const scored = quantizeToActiveKeys(painted, canvas.width, canvas.height, plate.albedoKeys, palette);
    const hullKey = FACTION_MILITARY_MAPPINGS[job.factionId].primary_uniform_or_hull;
    scored.rgba = liftEdgeShadow(scored.rgba, canvas.width, canvas.height, palette, hullKey);
    const files = candidatePaths(job);
    const rawPath = path.join(WEB_ROOT, files.raw);
    const quantizedPath = path.join(WEB_ROOT, files.quantized);
    await mkdir(path.dirname(rawPath), { recursive: true });
    await writeFile(rawPath, fitted.png);
    await writeFile(quantizedPath, encodeRgbaPng(canvas.width, canvas.height, scored.rgba));

    const previous = (manifest.candidates ?? []).find(
      (item) =>
        item?.factionId === job.factionId &&
        item?.blueprintId === job.blueprintId &&
        String(item?.seed) === String(job.seed) &&
        (item?.promptStyle ?? LAND_STYLE) === job.style,
    );
    const entry = {
      factionId: job.factionId,
      unitTypeId: job.unitTypeId,
      blueprintId: job.blueprintId,
      seed: job.seed,
      raw: portable(files.raw),
      quantized: portable(files.quantized),
      width: canvas.width,
      height: canvas.height,
      silhouetteIoU: scored.silhouetteIoU,
      promoted: previous?.promoted === true,
      promotedPath: previous?.promoted ? previous.promotedPath : null,
      taskId,
      cost: result.cost ?? quote,
      promptStyle: job.style,
      strength: INPUT_STRENGTH,
      updatedAt: new Date().toISOString(),
    };
    manifest = upsertStyled(manifest, entry);
    await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    record.status = "succeeded";
    record.cost = entry.cost;
    record.silhouetteIoU = scored.silhouetteIoU;
    delete record.error;
    await saveLedger(ledger);
    console.log(`${key} IoU ${scored.silhouetteIoU.toFixed(3)}  ${money(entry.cost)}  ${entry.quantized}`);
  }

  if (!args.run) {
    console.log(`${jobs.length} dry runs · quoted ${money(quotedTotal)}${unknownQuotes ? ` · ${unknownQuotes} quotes missing` : ""}`);
    console.log("Dry run only. Re-run with --run to bake.");
  } else {
    console.log(`Spent ${money(spentUsd(ledger))} of ${money(args.maxUsd)}.`);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
