// Dev-server only: the campaign coast tuner writes coastTune.json straight into the repo.
//
//   POST /__dev/coast-tune   body: the tune the panel has live
//
// The file is checked before it is written, and written through a temp file so a crash cannot leave
// a half-written tune. It is never part of the production server (apply: "serve").
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const COAST_TUNE_ROUTE = "/__dev/coast-tune";
const MAX_BYTES = 64 * 1024;

const FIELDS = {
  reachPx: [0, 64],
  periodS: [0.05, 120],
  wavelength: [1, 4000],
  grainPx: [0, 16],
  bloomRestPx: [0, 120],
  bloomBrushPx: [0, 120],
  bloomBlurPx: [0, 80],
  bloomAlpha: [0, 1],
  cliffLip: [0, 4],
};

function inRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Returns an error message, or "" when the body is a tune the map can load. */
export function validateCoastTune(json) {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return "The tune is not an object.";
  }
  for (const [key, [min, max]] of Object.entries(FIELDS)) {
    if (!inRange(json[key], min, max)) {
      return `The tune's ${key} is missing or out of range.`;
    }
  }
  const overrides = json.cliffOverrides;
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    return "Cliff overrides must be an object.";
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (id === "" || !inRange(value, 0, 4)) {
      return "A cliff override is not a height.";
    }
  }
  return "";
}

function canonical(json) {
  const cliffOverrides = {};
  for (const id of Object.keys(json.cliffOverrides).sort()) {
    cliffOverrides[id] = json.cliffOverrides[id];
  }
  return {
    reachPx: json.reachPx,
    periodS: json.periodS,
    wavelength: json.wavelength,
    grainPx: json.grainPx,
    bloomRestPx: json.bloomRestPx,
    bloomBrushPx: json.bloomBrushPx,
    bloomBlurPx: json.bloomBlurPx,
    bloomAlpha: json.bloomAlpha,
    cliffLip: json.cliffLip,
    cliffOverrides,
  };
}

export function saveCoastTunePlugin() {
  return {
    name: "save-coast-tune",
    apply: "serve",
    configureServer(server) {
      const target = path.resolve(server.config.root, "src/ui/map/coastTune.json");
      server.middlewares.use(COAST_TUNE_ROUTE, (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") {
          return reply(405, { ok: false, error: "Use POST." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return reply(415, { ok: false, error: "Send application/json." });
        }
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            tooBig = true;
          } else {
            chunks.push(chunk);
          }
        });
        req.on("end", async () => {
          if (tooBig) {
            return reply(413, { ok: false, error: "The tune is too large." });
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            return reply(400, { ok: false, error: "The body is not valid JSON." });
          }
          const problem = validateCoastTune(json);
          if (problem !== "") {
            return reply(422, { ok: false, error: problem });
          }
          try {
            const temp = `${target}.tmp`;
            const body = `${JSON.stringify(canonical(json), null, 2)}\n`;
            await writeFile(temp, body, "utf8");
            await rename(temp, target);
            return reply(200, { ok: true, path: path.basename(target) });
          } catch (error) {
            return reply(500, { ok: false, error: String(error?.message ?? error) });
          }
        });
      });
    },
  };
}
