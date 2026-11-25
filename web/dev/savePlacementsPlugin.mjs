// Dev-server only: the placement editor writes placements.json straight into the repo, so a
// placement the editor locks in is part of the next build.
//
//   POST /__dev/placements   body: { version: 1, items: { "landmark:paris": { dx, dy, dz, mult, dturn, locked } } }
//
// Written through a temp file so a crash cannot leave half a file. Never part of the production server.
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLACEMENTS_ROUTE = "/__dev/placements";
const MAX_BYTES = 512 * 1024;
const KEY = /^[a-z]+:[A-Za-z0-9_-]+$/;

function num(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Returns an error message, or "" when the body is a placement file the board can load. */
export function validatePlacements(json) {
  if (typeof json !== "object" || json === null || json.version !== 1) {
    return "The file is not a version 1 placement file.";
  }
  const items = json.items;
  if (typeof items !== "object" || items === null || Array.isArray(items)) {
    return "Items must be an object.";
  }
  for (const [key, edit] of Object.entries(items)) {
    if (!KEY.test(key) || typeof edit !== "object" || edit === null) {
      return `"${key}" is not an object key.`;
    }
    if (!num(edit.dx, -500, 500) || !num(edit.dy, -500, 500) || !num(edit.dz, -2, 24)) {
      return `"${key}" has a position out of range.`;
    }
    if (!num(edit.mult, 0.25, 6) || !num(edit.dturn, -7, 7) || typeof edit.locked !== "boolean") {
      return `"${key}" has a size, turn, or lock that is not valid.`;
    }
  }
  return "";
}

export function savePlacementsPlugin() {
  return {
    name: "save-placements",
    apply: "serve",
    configureServer(server) {
      const target = path.resolve(server.config.root, "src/ui/viewport3d/placements.json");
      server.middlewares.use(PLACEMENTS_ROUTE, (req, res) => {
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
            return reply(413, { ok: false, error: "The file is too large." });
          }
          let json;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reply(400, { ok: false, error: "The body is not valid JSON." });
          }
          const problem = validatePlacements(json);
          if (problem !== "") {
            return reply(422, { ok: false, error: problem });
          }
          try {
            const items = {};
            for (const key of Object.keys(json.items).sort()) {
              const e = json.items[key];
              items[key] = { dx: e.dx, dy: e.dy, dz: e.dz, mult: e.mult, dturn: e.dturn, locked: e.locked };
            }
            const temp = `${target}.tmp`;
            await writeFile(temp, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, "utf8");
            await rename(temp, target);
            return reply(200, { ok: true, path: path.basename(target), count: Object.keys(items).length });
          } catch (error) {
            return reply(500, { ok: false, error: String(error?.message ?? error) });
          }
        });
      });
    },
  };
}
