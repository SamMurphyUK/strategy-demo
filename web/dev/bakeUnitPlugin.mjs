// Dev-server only: bakes a unit blockout through Retro Diffusion, quantizes the
// result onto the faction's military keys, and can promote one candidate.
// It also saves the part rig, and repaints one part of it through Retro Diffusion's inpainting.
//
//   POST /__dev/bake-unit
//   POST /__dev/promote-candidate
//   POST /__dev/save-unit
//   POST /__dev/save-rig
//   POST /__dev/generate-part
//
// apply: "serve", so the production build never registers these routes. The token
// stays in RD_API_TOKEN on the dev server. Paths resolve from the Vite root (web/).
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { activePalette } from "./militaryStrip.mjs";
import { decodeRgbaPng, encodeRgbaPng } from "./pngRgba.mjs";

export const BAKE_ROUTE = "/__dev/bake-unit";
export const PROMOTE_ROUTE = "/__dev/promote-candidate";
export const SAVE_UNIT_ROUTE = "/__dev/save-unit";
export const SAVE_RIG_ROUTE = "/__dev/save-rig";
export const GENERATE_PART_ROUTE = "/__dev/generate-part";

const FRAME_NAME = /^(idle|walk|fire)_\d+$/;
const PART_ID = /^[a-z0-9_]+$/;
const PART_LAYERS = new Set(["legs", "torso", "head", "weapon"]);
/** The inpainting tool takes pictures up to this size, and prices each one the same. */
const INPAINT_MAX_SIDE = 256;
const INPAINT_POLL_MS = 3000;
/** The tool's own estimate is about 150 seconds a picture. */
const INPAINT_TIMEOUT_MS = 420_000;
const MAX_PROMPT = 1000;
export const MANIFEST_RELATIVE = path.join("assets", "candidates", "manifest.json");

const RD_BASE = "https://api.retrodiffusion.ai/v2";
const POLL_MS = 1500;
const TIMEOUT_MS = 180_000;
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_REFERENCES = 9;

const ROSTER_IDS = new Set(["GER", "USSR", "UK", "US", "JAP", "MINOR"]);

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Reject empty paths and anything that resolves outside root. */
export function resolveInsideRoot(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "" || relativePath.includes("\0")) {
    throw new Error("Path is empty");
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, relativePath);
  const rel = path.relative(rootResolved, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the project: ${relativePath}`);
  }
  return resolved;
}

function plainId(label, value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be a plain id`);
  }
  return value;
}

export function seedToken(seed) {
  const text = String(seed ?? "");
  if (!/^[0-9]+$/.test(text)) {
    throw new Error("seed must be an integer");
  }
  return `seed${text}`;
}

function rosterFaction(factionId) {
  const faction = plainId("factionId", factionId);
  if (!ROSTER_IDS.has(faction)) {
    throw new Error(`factionId "${faction}" is not a roster id`);
  }
  return faction;
}

/** assets/candidates/<factionId>/<blueprintId>_seed<N>.raw.png, relative to the Vite root. */
export function candidateRelativePath(factionId, blueprintId, seed) {
  const faction = rosterFaction(factionId);
  const blueprint = plainId("blueprintId", blueprintId);
  return path.join("assets", "candidates", faction, `${blueprint}_${seedToken(seed)}.raw.png`);
}

export function quantizedRelativePath(factionId, blueprintId, seed) {
  return candidateRelativePath(factionId, blueprintId, seed).replace(/\.raw\.png$/, ".quantized.png");
}

/** assets/units/authored/<factionId>/<blueprintId>.json, relative to the Vite root. */
export function authoredUnitRelativePath(factionId, blueprintId) {
  const faction = rosterFaction(factionId);
  const blueprint = plainId("blueprintId", blueprintId);
  return path.join("assets", "units", "authored", faction, `${blueprint}.json`);
}

/** public/assets/units/rigs/<unitId>/, relative to the Vite root. */
export function rigRelativeDir(unitId) {
  return path.join("public", "assets", "units", "rigs", plainId("unitId", unitId));
}

/** assets/candidates/parts/<unitId>/<layer>_seed<N>_<taskId>, without an extension. */
export function partCandidateRelativeStem(unitId, layer, seed, taskId) {
  if (!PART_LAYERS.has(layer)) {
    throw new Error(`"${layer}" is not a layer`);
  }
  return path.join("assets", "candidates", "parts", plainId("unitId", unitId), `${layer}_${seedToken(seed)}_${plainId("taskId", taskId)}`);
}

/** How many pixels of a mask are open to repainting. The tool treats alpha above 12 as open. */
export function maskCoverage(mask) {
  const total = mask.width * mask.height;
  let open = 0;
  for (let index = 0; index < total; index += 1) {
    if (mask.data[index * 4 + 3] > 12) {
      open += 1;
    }
  }
  return { open, total };
}

/** The file extension for a picture, from its first bytes. Null when it is not a picture. */
export function pictureKind(bytes) {
  const head = Buffer.from(bytes).subarray(0, 12);
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "png";
  }
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "jpeg";
  }
  if (head.length >= 4 && head.toString("ascii", 0, 4) === "GIF8") {
    return "gif";
  }
  return null;
}

/** public/assets/units/promoted/<factionId>/<blueprintId>.png */
export function promotedRelativePath(factionId, blueprintId) {
  const faction = rosterFaction(factionId);
  const blueprint = plainId("blueprintId", blueprintId);
  return path.join("public", "assets", "units", "promoted", faction, `${blueprint}.png`);
}

function portable(relative) {
  return relative.split(path.sep).join("/");
}

export function emptyManifest() {
  return { candidates: [] };
}

export function upsertCandidate(manifest, entry) {
  const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
  const rest = candidates.filter(
    (item) =>
      !(
        item?.factionId === entry.factionId &&
        item?.blueprintId === entry.blueprintId &&
        String(item?.seed) === String(entry.seed)
      ),
  );
  return { candidates: [...rest, entry] };
}

/** One promoted file per blueprint. The chosen seed is marked; its siblings are cleared. */
export function markPromoted(manifest, factionId, blueprintId, seed) {
  const promotedPath = portable(promotedRelativePath(factionId, blueprintId));
  let found = false;
  const candidates = (Array.isArray(manifest?.candidates) ? manifest.candidates : []).map((item) => {
    if (item?.factionId !== factionId || item?.blueprintId !== blueprintId) {
      return item;
    }
    const chosen = String(item.seed) === String(seed);
    if (chosen) {
      found = true;
    }
    return { ...item, promoted: chosen, promotedPath: chosen ? promotedPath : null };
  });
  if (!found) {
    throw new Error(`No candidate for ${blueprintId} seed ${seed}`);
  }
  return { candidates };
}

function nearestKey(r, g, b, palette) {
  let best = palette[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const dr = r - entry.r;
    const dg = g - entry.g;
    const db = b - entry.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best;
}

/**
 * Snap opaque pixels onto the faction palette and score the silhouette against the blockout mask.
 * Throws when the candidate's pixel count does not match the blockout.
 */
export function quantizeToActiveKeys(rgba, width, height, albedoKeys, palette) {
  const pixels = width * height;
  if (albedoKeys.length !== pixels || rgba.length !== pixels * 4) {
    throw new Error(`Candidate ${width}×${height} does not match blockout of ${albedoKeys.length} pixels`);
  }
  if (!palette || palette.length === 0) {
    throw new Error("The faction palette is empty");
  }
  const quantizedKeys = new Array(pixels);
  const out = new Uint8ClampedArray(pixels * 4);
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    const candidateOpaque = rgba[offset + 3] >= 128;
    const blockoutOpaque = albedoKeys[i] != null;
    if (candidateOpaque && blockoutOpaque) {
      intersection += 1;
    }
    if (candidateOpaque || blockoutOpaque) {
      union += 1;
    }
    if (!candidateOpaque) {
      quantizedKeys[i] = null;
      continue;
    }
    const chosen = nearestKey(rgba[offset], rgba[offset + 1], rgba[offset + 2], palette);
    quantizedKeys[i] = chosen.key;
    out[offset] = chosen.r;
    out[offset + 1] = chosen.g;
    out[offset + 2] = chosen.b;
    out[offset + 3] = 255;
  }
  return {
    quantizedKeys,
    rgba: out,
    silhouetteIoU: union === 0 ? 1 : intersection / union,
  };
}

function maskFromBlockout(decoded) {
  const keys = new Array(decoded.width * decoded.height);
  for (let i = 0; i < keys.length; i++) {
    keys[i] = decoded.data[i * 4 + 3] >= 128 ? "steel" : null;
  }
  return keys;
}

function stripDataUrl(value) {
  const text = String(value ?? "");
  const comma = text.indexOf(",");
  if (text.startsWith("data:") && comma !== -1) {
    return text.slice(comma + 1);
  }
  return text;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      const error = new Error("The bake request is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function quotedCost(payload) {
  const value = payload?.balance_cost ?? payload?.cost ?? payload?.result?.balance_cost;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorText(json, status) {
  const detail = json?.error ?? json?.message;
  if (typeof detail === "string" && detail !== "") {
    return detail;
  }
  const issues = detail?.details?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const lines = issues.map((issue) => {
      const where = Array.isArray(issue.location) ? issue.location.join(".") : "";
      return where ? `${where}: ${issue.message}` : issue.message;
    });
    return lines.join("; ");
  }
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }
  return `Retro Diffusion returned ${status}`;
}

async function postInference(token, body, idempotencyKey) {
  const headers = {
    "Content-Type": "application/json",
    "X-RD-Token": token,
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const response = await fetch(`${RD_BASE}/inferences`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errorText(json, response.status));
    error.status = 502;
    throw error;
  }
  return json;
}

/**
 * Poll GET /v2/inferences/tasks/{task_id} until succeeded or failed.
 * The clock stops at 180s.
 */
async function pollTask(token, taskId) {
  const deadline = Date.now() + TIMEOUT_MS;
  const url = `${RD_BASE}/inferences/tasks/${encodeURIComponent(taskId)}`;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { "X-RD-Token": token } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(json?.message || json?.error || `Retro Diffusion returned ${response.status}`);
      error.status = 502;
      throw error;
    }
    const status = json.status;
    if (status === "failed") {
      const error = new Error(json.error || "Retro Diffusion marked the task failed");
      error.status = 502;
      throw error;
    }
      if (status === "succeeded") {
      const image = json.result?.base64_images?.[0];
      if (!image) {
        const error = new Error("Retro Diffusion succeeded without an image");
        error.status = 502;
        throw error;
      }
      return { image: stripDataUrl(image), cost: quotedCost(json.result) ?? quotedCost(json) };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const error = new Error("Retro Diffusion timed out after 180s");
  error.status = 504;
  throw error;
}

function upstreamError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** POST to the inpainting tool. An empty suffix would run it and wait, so only /estimate and /tasks are used. */
async function postInpainting(token, suffix, body) {
  const response = await fetch(`${RD_BASE}/edit/tools/inpainting${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RD-Token": token },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw upstreamError(errorText(json, response.status));
  }
  return json;
}

/** Poll GET /v2/edit/tasks/{task_id} until the picture is ready, then fetch it. */
async function pollInpainting(token, taskId) {
  const deadline = Date.now() + INPAINT_TIMEOUT_MS;
  const url = `${RD_BASE}/edit/tasks/${encodeURIComponent(taskId)}`;
  const lost = `Retro Diffusion keeps the result for 24 hours under task ${taskId}.`;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { "X-RD-Token": token } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw upstreamError(`${errorText(json, response.status)} ${lost}`);
    }
    if (json.status === "failed") {
      const detail = json.error?.message ?? json.error?.detail?.message ?? json.error;
      throw upstreamError(`${typeof detail === "string" && detail !== "" ? detail : "Retro Diffusion marked the task failed."} A failed run is refunded.`);
    }
    if (json.status === "succeeded") {
      const result = json.result ?? {};
      const inline = Array.isArray(result.base64_images) ? result.base64_images[0] : null;
      const hosted = Array.isArray(result.output_urls) ? result.output_urls[0] : null;
      let bytes;
      if (typeof inline === "string" && inline !== "") {
        bytes = Buffer.from(stripDataUrl(inline), "base64");
      } else if (typeof hosted === "string" && /^https:\/\//.test(hosted)) {
        const picture = await fetch(hosted);
        if (!picture.ok) {
          throw upstreamError(`The picture was made but could not be fetched (${picture.status}). ${lost}`);
        }
        bytes = Buffer.from(await picture.arrayBuffer());
      } else {
        throw upstreamError(`Retro Diffusion succeeded without a picture. ${lost}`);
      }
      return { bytes, cost: quotedCost(result) };
    }
    await new Promise((resolve) => setTimeout(resolve, INPAINT_POLL_MS));
  }
  throw upstreamError(`Retro Diffusion took longer than ${INPAINT_TIMEOUT_MS / 1000}s. ${lost}`, 504);
}

async function readManifest(file) {
  try {
    const text = await readFile(file, "utf8");
    const json = JSON.parse(text);
    return json && Array.isArray(json.candidates) ? json : emptyManifest();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyManifest();
    }
    throw error;
  }
}

let manifestChain = Promise.resolve();

function withManifest(root, mutate) {
  const run = manifestChain.then(async () => {
    const file = resolveInsideRoot(root, MANIFEST_RELATIVE);
    const manifest = await readManifest(file);
    const next = await mutate(manifest);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  });
  manifestChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function httpError(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  return { status, error: String(error?.message ?? error) };
}

export function bakeUnitPlugin() {
  return {
    name: "bake-unit",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;

      server.middlewares.use(BAKE_ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          return reply(res, 405, { ok: false, error: "Use POST." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return reply(res, 415, { ok: false, error: "Send application/json." });
        }
        const token = process.env.RD_API_TOKEN;
        if (!token) {
          return reply(res, 500, { ok: false, error: "RD_API_TOKEN is not set on the dev server." });
        }
        try {
          const text = await readBody(req);
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            return reply(res, 400, { ok: false, error: "The body is not valid JSON." });
          }

          const factionId = rosterFaction(body.factionId);
          const blueprintId = plainId("blueprintId", body.blueprintId);
          const palette = activePalette(factionId);
          const platePaths = Array.isArray(body.referencePlatePaths) ? body.referencePlatePaths : [];
          if (platePaths.length > MAX_REFERENCES) {
            return reply(res, 422, { ok: false, error: `At most ${MAX_REFERENCES} reference plates.` });
          }
          const referenceImages = [];
          for (const plate of platePaths) {
            const file = resolveInsideRoot(root, plate);
            const bytes = await readFile(file);
            referenceImages.push(bytes.toString("base64"));
          }

          const prompt = typeof body.prompt === "string" ? body.prompt : "";
          const width = body.width;
          const height = body.height;
          if (width !== 48 && width !== 64) {
            return reply(res, 422, { ok: false, error: "width must be 48 or 64." });
          }
          if (height !== 48 && height !== 64) {
            return reply(res, 422, { ok: false, error: "height must be 48 or 64." });
          }
          const inputImage = stripDataUrl(body.blockoutBase64 ?? "");
          if (inputImage === "") {
            return reply(res, 422, { ok: false, error: "blockoutBase64 is empty." });
          }

          const inference = {
            prompt_style: "rd_pro__default",
            prompt,
            width,
            height,
            num_images: 1,
            input_image: inputImage,
            remove_bg: true,
            upscale_output_factor: 1,
            strength: typeof body.strength === "number" ? body.strength : 0.5,
            seed: body.seed,
          };
          if (referenceImages.length > 0) {
            inference.reference_images = referenceImages;
          }

          const costCheck = await postInference(token, { ...inference, check_cost: true }, null);
          if (body.dryRunOnly === true) {
            return reply(res, 200, { ok: true, dryRun: true, cost: quotedCost(costCheck), taskId: null, path: null });
          }

          const seed = seedToken(body.seed);
          const rawRelative = candidateRelativePath(factionId, blueprintId, body.seed);
          const quantizedRelative = quantizedRelativePath(factionId, blueprintId, body.seed);
          const rawPath = resolveInsideRoot(root, rawRelative);
          const quantizedPath = resolveInsideRoot(root, quantizedRelative);

          const submitted = await postInference(token, { ...inference, check_cost: false }, randomUUID());
          const taskId = submitted.task_id ?? submitted.id;
          if (typeof taskId !== "string" || taskId === "") {
            return reply(res, 502, { ok: false, error: "Retro Diffusion did not return a task id." });
          }
          const result = await pollTask(token, taskId);
          const rawBytes = Buffer.from(result.image, "base64");
          const candidate = decodeRgbaPng(rawBytes);
          const blockout = decodeRgbaPng(Buffer.from(inputImage, "base64"));
          if (candidate.width !== blockout.width || candidate.height !== blockout.height) {
            const error = new Error(
              `Candidate ${candidate.width}×${candidate.height} does not match blockout ${blockout.width}×${blockout.height}`,
            );
            error.status = 422;
            throw error;
          }
          const albedoKeys = Array.isArray(body.albedoKeys) ? body.albedoKeys : maskFromBlockout(blockout);
          let scored;
          try {
            scored = quantizeToActiveKeys(candidate.data, candidate.width, candidate.height, albedoKeys, palette);
          } catch (error) {
            error.status = 422;
            throw error;
          }

          await mkdir(path.dirname(rawPath), { recursive: true });
          await writeFile(rawPath, rawBytes);
          const quantizedPng = encodeRgbaPng(candidate.width, candidate.height, scored.rgba);
          await writeFile(quantizedPath, quantizedPng);
          const entry = {
            factionId,
            blueprintId,
            seed: Number(seed.slice(4)),
            raw: portable(rawRelative),
            quantized: portable(quantizedRelative),
            silhouetteIoU: scored.silhouetteIoU,
            promoted: false,
            promotedPath: null,
            taskId,
            cost: result.cost,
            updatedAt: new Date().toISOString(),
          };
          await withManifest(root, (manifest) => upsertCandidate(manifest, entry));
          return reply(res, 200, {
            ok: true,
            dryRun: false,
            taskId,
            cost: result.cost,
            seed: entry.seed,
            silhouetteIoU: scored.silhouetteIoU,
            path: entry.raw,
            quantizedPath: entry.quantized,
            base64: result.image,
            quantizedBase64: quantizedPng.toString("base64"),
          });
        } catch (error) {
          const http = httpError(error);
          return reply(res, http.status, { ok: false, error: http.error });
        }
      });

      server.middlewares.use(SAVE_UNIT_ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          return reply(res, 405, { ok: false, error: "Use POST." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return reply(res, 415, { ok: false, error: "Send application/json." });
        }
        try {
          const text = await readBody(req);
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            return reply(res, 400, { ok: false, error: "The body is not valid JSON." });
          }
          if (body?.kind !== "unit-paint" || !body.blueprint) {
            return reply(res, 422, { ok: false, error: "The body is not a unit paint file." });
          }
          const relative = authoredUnitRelativePath(body.blueprint.factionId, body.blueprint.blueprintId);
          const target = resolveInsideRoot(root, relative);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, `${JSON.stringify(body, null, 2)}\n`, "utf8");
          return reply(res, 200, { ok: true, path: portable(relative) });
        } catch (error) {
          const http = httpError(error);
          return reply(res, http.status, { ok: false, error: http.error });
        }
      });

      server.middlewares.use(SAVE_RIG_ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          return reply(res, 405, { ok: false, error: "Use POST." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return reply(res, 415, { ok: false, error: "Send application/json." });
        }
        try {
          const text = await readBody(req);
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            return reply(res, 400, { ok: false, error: "The body is not valid JSON." });
          }
          if (body?.rig?.kind !== "part-rig" || !Array.isArray(body.rig.parts) || !Array.isArray(body.parts) || !Array.isArray(body.frames)) {
            return reply(res, 422, { ok: false, error: "The body is not a rig with its parts and frames." });
          }
          const relativeDir = rigRelativeDir(body.rig.unitId);
          const dir = resolveInsideRoot(root, relativeDir);
          const files = [];
          const partIds = new Set();
          for (const item of body.parts) {
            const id = String(item?.file?.id ?? "");
            if (!PART_ID.test(id) || item?.file?.kind !== "rig-part") {
              return reply(res, 422, { ok: false, error: `"${id}" is not a part.` });
            }
            const png = Buffer.from(stripDataUrl(item.pngBase64 ?? ""), "base64");
            decodeRgbaPng(png);
            partIds.add(id);
            files.push([`part_${id}.json`, `${JSON.stringify(item.file)}\n`], [`part_${id}.png`, png]);
          }
          const unsaved = body.rig.parts.find((part) => !partIds.has(part?.id));
          if (unsaved) {
            return reply(res, 422, { ok: false, error: `The part "${unsaved?.id}" came without its drawings.` });
          }
          for (const item of body.frames) {
            const name = String(item?.name ?? "");
            if (!FRAME_NAME.test(name)) {
              return reply(res, 422, { ok: false, error: `"${name}" is not a frame name.` });
            }
            const png = Buffer.from(stripDataUrl(item.pngBase64 ?? ""), "base64");
            decodeRgbaPng(png);
            files.push([`${name}.png`, png]);
          }
          files.push(["rig.json", `${JSON.stringify(body.rig)}\n`]);
          // Everything is checked before the first write, so a bad request leaves the folder as it was.
          await mkdir(dir, { recursive: true });
          const keep = new Set(files.map(([name]) => name));
          for (const [name, content] of files) {
            await writeFile(resolveInsideRoot(root, path.join(relativeDir, name)), content);
          }
          for (const file of await readdir(dir)) {
            const stem = file.replace(/\.(json|png)$/, "");
            if (!keep.has(file) && stem !== file && (FRAME_NAME.test(stem) || /^part_[a-z0-9_]+$/.test(stem))) {
              await rm(resolveInsideRoot(root, path.join(relativeDir, file)));
            }
          }
          return reply(res, 200, { ok: true, path: portable(relativeDir), parts: body.parts.length, frames: body.frames.length });
        } catch (error) {
          const http = httpError(error);
          return reply(res, http.status, { ok: false, error: http.error });
        }
      });

      // Repaint one part of the rig. The editor sends a picture of the soldier and a mask of the
      // pixels the new part may cover. dryRunOnly asks the price and spends nothing. A paid run
      // needs agreedCost, the price the editor showed, and stops when the price has gone up.
      server.middlewares.use(GENERATE_PART_ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          return reply(res, 405, { ok: false, error: "Use POST." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return reply(res, 415, { ok: false, error: "Send application/json." });
        }
        const token = process.env.RD_API_TOKEN;
        if (!token) {
          return reply(res, 500, { ok: false, error: "RD_API_TOKEN is not set on the dev server." });
        }
        try {
          const text = await readBody(req);
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            return reply(res, 400, { ok: false, error: "The body is not valid JSON." });
          }
          const unitId = plainId("unitId", body.unitId);
          const layer = String(body.layer ?? "");
          if (!PART_LAYERS.has(layer)) {
            return reply(res, 422, { ok: false, error: `"${layer}" is not a layer.` });
          }
          const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
          if (prompt === "" || prompt.length > MAX_PROMPT) {
            return reply(res, 422, { ok: false, error: `Say what to draw, in ${MAX_PROMPT} characters or fewer.` });
          }
          if (!Number.isSafeInteger(body.seed) || body.seed < 0) {
            return reply(res, 422, { ok: false, error: "The seed must be a whole number." });
          }
          const inputImage = stripDataUrl(body.inputBase64 ?? "");
          const maskImage = stripDataUrl(body.maskBase64 ?? "");
          let input;
          let mask;
          try {
            input = decodeRgbaPng(Buffer.from(inputImage, "base64"));
            mask = decodeRgbaPng(Buffer.from(maskImage, "base64"));
          } catch (error) {
            return reply(res, 422, { ok: false, error: `The picture or its mask could not be read: ${error.message}.` });
          }
          if (input.width !== mask.width || input.height !== mask.height) {
            return reply(res, 422, {
              ok: false,
              error: `The picture is ${input.width}×${input.height} and its mask is ${mask.width}×${mask.height}.`,
            });
          }
          if (input.width > INPAINT_MAX_SIDE || input.height > INPAINT_MAX_SIDE) {
            return reply(res, 422, {
              ok: false,
              error: `The picture is ${input.width}×${input.height}. The tool takes ${INPAINT_MAX_SIDE}×${INPAINT_MAX_SIDE} at most.`,
            });
          }
          const coverage = maskCoverage(mask);
          if (coverage.open === 0 || coverage.open === coverage.total) {
            return reply(res, 422, {
              ok: false,
              error: coverage.open === 0 ? "The mask opens no pixels to repaint." : "The mask opens the whole picture.",
            });
          }

          const request = {
            input_image: inputImage,
            mask_image: maskImage,
            prompt,
            seed: Number(body.seed),
            soft_inpaint: false,
          };
          const estimate = await postInpainting(token, "/estimate", request);
          const cost = quotedCost(estimate);
          const seconds = typeof estimate.estimate_seconds === "number" ? estimate.estimate_seconds : null;
          if (body.dryRunOnly === true) {
            return reply(res, 200, { ok: true, dryRun: true, cost, seconds, taskId: null, path: null });
          }
          if (cost === null || typeof body.agreedCost !== "number" || body.agreedCost + 1e-9 < cost) {
            return reply(res, 409, {
              ok: false,
              cost,
              error:
                cost === null
                  ? "Retro Diffusion gave no price, so nothing was run."
                  : `This costs $${cost.toFixed(2)} and that price was not agreed. Check the price again.`,
            });
          }

          // custom_id makes a retry of this one submission safe. A new click is a new run.
          const submitted = await postInpainting(token, "/tasks", { ...request, custom_id: randomUUID() });
          const taskId = submitted.task_id;
          if (typeof taskId !== "string" || taskId === "") {
            return reply(res, 502, { ok: false, error: "Retro Diffusion did not return a task id." });
          }
          const result = await pollInpainting(token, taskId);
          const kind = pictureKind(result.bytes);
          if (!kind) {
            return reply(res, 502, { ok: false, error: `Retro Diffusion returned something that is not a picture. Task ${taskId}.` });
          }
          // The paid picture is on disk before anything reads it, with what was sent beside it.
          const stem = partCandidateRelativeStem(unitId, layer, body.seed, taskId);
          const rawRelative = `${stem}.${kind}`;
          await mkdir(path.dirname(resolveInsideRoot(root, rawRelative)), { recursive: true });
          await writeFile(resolveInsideRoot(root, rawRelative), result.bytes);
          await writeFile(resolveInsideRoot(root, `${stem}.input.png`), Buffer.from(inputImage, "base64"));
          await writeFile(resolveInsideRoot(root, `${stem}.mask.png`), Buffer.from(maskImage, "base64"));
          const paid = result.cost ?? cost;
          const record = {
            unitId,
            layer,
            prompt,
            seed: Number(body.seed),
            taskId,
            cost: paid,
            width: input.width,
            height: input.height,
            picture: portable(rawRelative),
            createdAt: new Date().toISOString(),
          };
          await writeFile(resolveInsideRoot(root, `${stem}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
          return reply(res, 200, {
            ok: true,
            dryRun: false,
            cost: paid,
            taskId,
            path: portable(rawRelative),
            mime: `image/${kind}`,
            base64: result.bytes.toString("base64"),
          });
        } catch (error) {
          const http = httpError(error);
          return reply(res, http.status, { ok: false, error: http.error });
        }
      });

      server.middlewares.use(PROMOTE_ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          return reply(res, 405, { ok: false, error: "Use POST." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return reply(res, 415, { ok: false, error: "Send application/json." });
        }
        try {
          const text = await readBody(req);
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            return reply(res, 400, { ok: false, error: "The body is not valid JSON." });
          }
          const factionId = rosterFaction(body.factionId);
          const blueprintId = plainId("blueprintId", body.blueprintId);
          const sourceRelative = quantizedRelativePath(factionId, blueprintId, body.seed);
          const destRelative = promotedRelativePath(factionId, blueprintId);
          const source = resolveInsideRoot(root, sourceRelative);
          const dest = resolveInsideRoot(root, destRelative);
          try {
            await readFile(source);
          } catch (error) {
            if (error?.code === "ENOENT") {
              return reply(res, 404, { ok: false, error: "That quantized candidate is not on disk." });
            }
            throw error;
          }
          await mkdir(path.dirname(dest), { recursive: true });
          await copyFile(source, dest);
          await withManifest(root, (manifest) => {
            const present = (manifest.candidates ?? []).some(
              (item) =>
                item?.factionId === factionId &&
                item?.blueprintId === blueprintId &&
                String(item?.seed) === String(body.seed),
            );
            const withEntry = present
              ? manifest
              : upsertCandidate(manifest, {
                  factionId,
                  blueprintId,
                  seed: Number(body.seed),
                  raw: portable(candidateRelativePath(factionId, blueprintId, body.seed)),
                  quantized: portable(sourceRelative),
                  silhouetteIoU: null,
                  promoted: false,
                  promotedPath: null,
                  updatedAt: new Date().toISOString(),
                });
            return markPromoted(withEntry, factionId, blueprintId, body.seed);
          });
          return reply(res, 200, {
            ok: true,
            path: portable(destRelative),
            source: portable(sourceRelative),
          });
        } catch (error) {
          const http = httpError(error);
          return reply(res, http.status, { ok: false, error: http.error });
        }
      });
    },
  };
}
