// Dev-server only: the emblem stamps placed on a polished unit PNG in the sprite editor.
//
//   GET  /__dev/unit-stamps?path=assets/candidates/<F>/<stem>.outlined.polished.png
//   POST /__dev/unit-stamps   a stamps file; written to <stem>.stamps.json beside the PNG
//   POST /__dev/bake-stamps   { path }: npm run stamp:units, then vectorize:units --stamped, for that unit only
//
// The polished PNG is never written. apply: "serve", so the production build has none of this.
// The checks here are the shape only; stamp:units reads the file with readStampSidecar in
// src/art/spriteStamps.ts and refuses a bad emblem or size. A test keeps the paths the same.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveInsideRoot } from "./bakeUnitPlugin.mjs";

export const UNIT_STAMPS_ROUTE = "/__dev/unit-stamps";
export const BAKE_STAMPS_ROUTE = "/__dev/bake-stamps";
const MAX_BYTES = 256 * 1024;
const MAX_STAMPS = 64;
const BAKE_TIMEOUT_MS = 300_000;
const POLISHED_PATH = /^assets\/candidates\/(GER|USSR|UK|US|JAP|MINOR)\/([A-Za-z0-9_-]+)\.outlined\.polished\.png$/;

function polishedParts(polished) {
  const match = POLISHED_PATH.exec(String(polished ?? "").replaceAll("\\", "/"));
  if (!match) {
    throw new Error(`${polished} is not a polished unit PNG under assets/candidates/<country>/.`);
  }
  return { faction: match[1], stem: match[2] };
}

export function stampsPathFor(polished) {
  const { faction, stem } = polishedParts(polished);
  return `assets/candidates/${faction}/${stem}.stamps.json`;
}

export function stampedPngPathFor(polished) {
  const { faction, stem } = polishedParts(polished);
  return `assets/candidates/${faction}/${stem}.outlined.stamped.png`;
}

/** The stamped SVG vectorize_units.py writes for a polished PNG. */
export function stampedSvgPathFor(polished) {
  const { faction, stem } = polishedParts(polished);
  return `assets/units/vector/${faction}/${stem}.stamped.svg`;
}

const whole = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

/** The stamps file as the editor sends it. Throws on a wrong shape. */
export function checkStampsFile(file) {
  if (file?.kind !== "unit-stamps" || file.version !== 1) {
    throw new Error('The stamps file must say kind "unit-stamps" and version 1.');
  }
  polishedParts(file.source);
  if (!whole(file.width, 4096) || !whole(file.height, 4096) || file.width < 1 || file.height < 1) {
    throw new Error("width and height must be whole numbers.");
  }
  if (!Array.isArray(file.stamps) || file.stamps.length > MAX_STAMPS) {
    throw new Error(`stamps must be a list of at most ${MAX_STAMPS}.`);
  }
  file.stamps.forEach((stamp, index) => {
    const ok =
      typeof stamp?.emblem === "string" &&
      /^[a-z_]+$/.test(stamp.emblem) &&
      whole(stamp.size, 512) &&
      whole(stamp.x, file.width - 1) &&
      whole(stamp.y, file.height - 1) &&
      ["flip", "turn", "onlyOnSprite"].every((key) => stamp[key] === undefined || typeof stamp[key] === "boolean");
    if (!ok) {
      throw new Error(`Stamp ${index + 1} is not an emblem, a size and a pixel on the sprite.`);
    }
  });
  return {
    kind: file.kind,
    version: file.version,
    source: file.source,
    width: file.width,
    height: file.height,
    stamps: file.stamps.map((stamp) => ({
      emblem: stamp.emblem,
      size: stamp.size,
      x: stamp.x,
      y: stamp.y,
      flip: stamp.flip ?? false,
      turn: stamp.turn ?? false,
      onlyOnSprite: stamp.onlyOnSprite ?? true,
    })),
  };
}

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      const error = new Error("The stamps file is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The body is not valid JSON.");
    error.status = 400;
    throw error;
  }
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let output = "";
    const timer = setTimeout(() => child.kill(), BAKE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}${error.message}\n` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

export function unitStampsPlugin() {
  return {
    name: "unit-stamps",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      let baking = false;

      server.middlewares.use(UNIT_STAMPS_ROUTE, async (req, res) => {
        try {
          if (req.method === "GET") {
            const query = new URLSearchParams(req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "");
            const sidecar = stampsPathFor(query.get("path") ?? "");
            try {
              const text = await readFile(resolveInsideRoot(root, sidecar), "utf8");
              return reply(res, 200, { ok: true, path: sidecar, file: checkStampsFile(JSON.parse(text)) });
            } catch (error) {
              if (error?.code === "ENOENT") {
                return reply(res, 200, { ok: true, path: sidecar, file: null });
              }
              throw error;
            }
          }
          if (req.method === "POST") {
            if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
              return reply(res, 415, { ok: false, error: "Send application/json." });
            }
            const file = checkStampsFile(await readJson(req));
            const sidecar = stampsPathFor(file.source);
            const target = resolveInsideRoot(root, sidecar);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
            return reply(res, 200, { ok: true, path: sidecar, stamps: file.stamps.length });
          }
          return reply(res, 405, { ok: false, error: "Use GET or POST." });
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : 422;
          return reply(res, status, { ok: false, error: String(error?.message ?? error) });
        }
      });

      server.middlewares.use(BAKE_STAMPS_ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          return reply(res, 405, { ok: false, error: "Use POST." });
        }
        if (baking) {
          return reply(res, 409, { ok: false, error: "A bake is already running." });
        }
        baking = true;
        try {
          const body = await readJson(req);
          const sidecar = stampsPathFor(String(body?.path ?? ""));
          const stamped = stampedPngPathFor(String(body?.path ?? ""));
          const stamp = await run(process.execPath, ["--import", "tsx", "scripts/stampUnits.mjs", sidecar], root);
          if (stamp.code !== 0) {
            return reply(res, 500, { ok: false, error: "npm run stamp:units failed.", output: stamp.output });
          }
          const stampedOnDisk = await readFile(resolveInsideRoot(root, stamped)).then(
            () => true,
            () => false,
          );
          // An empty stamps file removed the stamped PNG: tracing with no input drops the stale vector.
          const trace = await run(process.env.PYTHON || "python", ["scripts/vectorize_units.py", "--stamped", ...(stampedOnDisk ? [stamped] : [])], root);
          if (trace.code !== 0) {
            return reply(res, 500, { ok: false, error: "npm run vectorize:units -- --stamped failed.", output: stamp.output + trace.output });
          }
          return reply(res, 200, { ok: true, svg: stampedOnDisk ? stampedSvgPathFor(String(body.path)) : null, output: stamp.output + trace.output });
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : 422;
          return reply(res, status, { ok: false, error: String(error?.message ?? error) });
        } finally {
          baking = false;
        }
      });
    },
  };
}
