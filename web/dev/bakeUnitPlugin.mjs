// Dev-server only: bakes a unit blockout through Retro Diffusion, quantizes the
// result onto the faction's military keys, and can promote one candidate.
//
//   POST /__dev/bake-unit
//   POST /__dev/promote-candidate
//
// apply: "serve", so the production build never registers these routes. The token
// stays in RD_API_TOKEN on the dev server. Paths resolve from the Vite root (web/).
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { activePalette } from "./militaryStrip.mjs";
import { decodeRgbaPng, encodeRgbaPng } from "./pngRgba.mjs";

export const BAKE_ROUTE = "/__dev/bake-unit";
export const PROMOTE_ROUTE = "/__dev/promote-candidate";
export const SAVE_UNIT_ROUTE = "/__dev/save-unit";
export const MANIFEST_RELATIVE = path.join("assets", "candidates", "manifest.json");

const RD_BASE = "https://api.retrodiffusion.ai/v2";
const POLL_MS = 1500;
const TIMEOUT_MS = 60_000;
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

async function postInference(token, body, idempotencyKey) {
  const response = await fetch(`${RD_BASE}/inferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RD-Token": token,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.message || json?.error || `Retro Diffusion returned ${response.status}`);
    error.status = 502;
    throw error;
  }
  return json;
}

/**
 * Poll GET /v2/inferences/tasks/{task_id} until succeeded or failed.
 * The clock stops at 60s.
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
      return { image: stripDataUrl(image), cost: json.cost ?? null };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const error = new Error("Retro Diffusion timed out after 60s");
  error.status = 504;
  throw error;
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
            model: "rd_pro__default",
            prompt,
            width,
            height,
            input_image: inputImage,
            reference_images: referenceImages,
            remove_bg: true,
            upscale_output_factor: 1,
            strength: typeof body.strength === "number" ? body.strength : 0.5,
            seed: body.seed,
          };

          const costCheck = await postInference(token, { ...inference, check_cost: true }, randomUUID());
          if (body.dryRunOnly === true) {
            return reply(res, 200, { ok: true, dryRun: true, cost: costCheck.cost ?? costCheck, taskId: null, path: null });
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
