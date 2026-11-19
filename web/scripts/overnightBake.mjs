/**
 * Unattended Retro Diffusion v2 batch on RD Fast.
 *
 *   npm run bake:overnight
 *   npm run bake:overnight -- --run --seeds 3 --max-usd 9.50
 *
 * Without --run every job is sent with check_cost and nothing is spent.
 * With --run each seed is generated in order. Idempotency keys are written to
 * web/assets/candidates/overnight_ledger.json before the paid request, so a
 * restart resumes the same task instead of buying it twice.
 *
 * Input is the sliced 48×48 plate (or its blockout) at strength 0.45.
 * reference_images is not sent. Results land in web/assets/candidates.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { activePalette } from "../dev/militaryStrip.mjs";
import {
  candidateRelativePath,
  quantizeToActiveKeys,
  quantizedRelativePath,
  upsertCandidate,
} from "../dev/bakeUnitPlugin.mjs";
import { decodeRgbaPng, encodeRgbaPng } from "../dev/pngRgba.mjs";
import { FACTIONS, UNIT_TYPES, bakePromptFor, blueprintIdFor } from "./historicalUnits.mjs";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATE_DIR = path.join(WEB_ROOT, "reference_plates");
const CANDIDATE_DIR = path.join(WEB_ROOT, "assets", "candidates");
const LEDGER_PATH = path.join(CANDIDATE_DIR, "overnight_ledger.json");
const MANIFEST_PATH = path.join(CANDIDATE_DIR, "manifest.json");
const RD_INFERENCES = "https://api.retrodiffusion.ai/v2/inferences";
const ENV_PATH = path.join(WEB_ROOT, ".env.local");

export const PROMPT_STYLE = "rd_fast__default";
/** 45% of the way from the reference plate toward a new drawing. */
export const INPUT_STRENGTH = 0.45;
const PLATE = 48;
/** rd_fast__default rejects anything under 64. 96 is 2× the plate, so the result scales back cleanly. */
const GENERATE = 96;
const POLL_MS = 2000;
const BACKOFF_MS = 30_000;
const TASK_TIMEOUT_MS = 180_000;

export function parseOvernightArgs(argv) {
  const args = { run: false, seeds: 3, maxUsd: 9.5, limit: null, unit: null };
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

export function jobKey(factionId, blueprintId, seed) {
  return `${factionId}/${blueprintId}/seed${seed}`;
}

export function buildQueue(seeds, unit) {
  const jobs = [];
  const units = unit ? UNIT_TYPES.filter((unitTypeId) => unitTypeId === unit) : UNIT_TYPES;
  if (unit && units.length === 0) {
    throw new Error(`Unknown unit ${unit}`);
  }
  for (const factionId of FACTIONS) {
    for (const unitTypeId of units) {
      const blueprintId = blueprintIdFor(factionId, unitTypeId);
      for (let seed = 1; seed <= seeds; seed++) {
        jobs.push({
          factionId,
          unitTypeId,
          blueprintId,
          seed,
          prompt: bakePromptFor(factionId, unitTypeId),
          platePath: path.join(PLATE_DIR, factionId, `${unitTypeId}.png`),
        });
      }
    }
  }
  return jobs;
}

export function inferenceBody(prompt, inputImage, seed, checkCost) {
  return {
    prompt_style: PROMPT_STYLE,
    prompt,
    width: GENERATE,
    height: GENERATE,
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
  return { promptStyle: PROMPT_STYLE, strength: INPUT_STRENGTH, jobs: {} };
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

async function plateBase64(platePath) {
  const bytes = await readFile(platePath);
  const fitted = await sharp(bytes)
    .resize(PLATE, PLATE, {
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const decoded = decodeRgbaPng(fitted);
  const albedoKeys = new Array(PLATE * PLATE);
  for (let i = 0; i < albedoKeys.length; i++) {
    albedoKeys[i] = decoded.data[i * 4 + 3] >= 128 ? "steel" : null;
  }
  const input = await sharp(fitted).resize(GENERATE, GENERATE, { kernel: "nearest" }).png().toBuffer();
  return { base64: input.toString("base64"), albedoKeys };
}

async function toPlatePng(bytes) {
  const decoded = decodeRgbaPng(bytes);
  if (decoded.width === PLATE && decoded.height === PLATE) return { bytes, decoded };
  const fitted = await sharp(bytes)
    .resize(PLATE, PLATE, { fit: "fill", kernel: "nearest" })
    .png()
    .toBuffer();
  return { bytes: fitted, decoded: decodeRgbaPng(fitted) };
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
  const jobs = buildQueue(args.seeds, args.unit).slice(0, args.limit ?? Infinity);
  const ledger = await readJson(LEDGER_PATH, emptyLedger);
  if (!ledger.jobs) ledger.jobs = {};
  let manifest = await readJson(MANIFEST_PATH, () => ({ candidates: [] }));
  if (!Array.isArray(manifest.candidates)) manifest = { candidates: [] };

  console.log(
    `${jobs.length} images · ${PROMPT_STYLE} · strength ${INPUT_STRENGTH} · ${args.run ? "run" : "dry run"} · cap ${money(args.maxUsd)}`,
  );
  let quotedTotal = 0;
  let unknownQuotes = 0;

  for (const job of jobs) {
    const key = jobKey(job.factionId, job.blueprintId, job.seed);
    const prior = ledger.jobs[key];
    const plate = await plateBase64(job.platePath);
    const body = inferenceBody(job.prompt, plate.base64, job.seed, true);

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

    const rawBytes = Buffer.from(result.image, "base64");
    const fitted = await toPlatePng(rawBytes);
    const scored = quantizeToActiveKeys(
      fitted.decoded.data,
      fitted.decoded.width,
      fitted.decoded.height,
      plate.albedoKeys,
      activePalette(job.factionId),
    );
    const rawRelative = candidateRelativePath(job.factionId, job.blueprintId, job.seed);
    const quantizedRelative = quantizedRelativePath(job.factionId, job.blueprintId, job.seed);
    const rawPath = path.join(WEB_ROOT, rawRelative);
    const quantizedPath = path.join(WEB_ROOT, quantizedRelative);
    await mkdir(path.dirname(rawPath), { recursive: true });
    await writeFile(rawPath, fitted.bytes);
    await writeFile(quantizedPath, encodeRgbaPng(PLATE, PLATE, scored.rgba));

    const previous = (manifest.candidates ?? []).find(
      (item) => item?.factionId === job.factionId && item?.blueprintId === job.blueprintId && String(item?.seed) === String(job.seed),
    );
    const entry = {
      factionId: job.factionId,
      unitTypeId: job.unitTypeId,
      blueprintId: job.blueprintId,
      seed: job.seed,
      raw: portable(rawRelative),
      quantized: portable(quantizedRelative),
      silhouetteIoU: scored.silhouetteIoU,
      promoted: previous?.promoted === true,
      promotedPath: previous?.promoted ? previous.promotedPath : null,
      taskId,
      cost: result.cost ?? quote,
      promptStyle: PROMPT_STYLE,
      strength: INPUT_STRENGTH,
      updatedAt: new Date().toISOString(),
    };
    manifest = upsertCandidate(manifest, entry);
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
