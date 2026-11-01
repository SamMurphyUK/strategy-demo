// Dev-server only: lets the in-browser map editor write demomap01.json straight into the repo.
//
//   POST /__dev/save-map   body: the map JSON the editor exports
//
// The file is checked before it is written, and written through a temp file so a crash cannot leave a
// half-written map. It is never part of the production build (apply: "serve").
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const SAVE_ROUTE = "/__dev/save-map";
const MAX_BYTES = 20 * 1024 * 1024;

/** Returns an error message, or "" when the map looks like one the app can load. */
export function validateMapJson(json) {
  if (typeof json !== "object" || json === null || !Array.isArray(json.regions) || json.regions.length === 0) {
    return "The file has no regions.";
  }
  const seen = new Set();
  for (const region of json.regions) {
    const id = region?.metadata?.region_id;
    if (typeof id !== "string" || id === "") {
      return "A region has no metadata.region_id.";
    }
    if (seen.has(id)) {
      return `Region id "${id}" appears twice.`;
    }
    seen.add(id);
    if (!Array.isArray(region.polygon) || region.polygon.length < 3) {
      return `Region "${id}" has fewer than 3 vertices.`;
    }
  }
  return "";
}

/** @param {{ file: string }} options the file to write, relative to the Vite root (or absolute) */
export function saveMapPlugin(options) {
  return {
    name: "save-map",
    apply: "serve",
    configureServer(server) {
      const target = path.resolve(server.config.root, options.file);
      server.middlewares.use(SAVE_ROUTE, (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") {
          return reply(405, { ok: false, error: "Use POST." });
        }
        // A JSON content type cannot be sent cross-site without a preflight, which this server refuses.
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
            return reply(413, { ok: false, error: "The map is too large." });
          }
          // Written as received: the editor already formats it the way the file is kept (one vertex per line).
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            return reply(400, { ok: false, error: "The body is not valid JSON." });
          }
          const problem = validateMapJson(json);
          if (problem !== "") {
            return reply(422, { ok: false, error: problem });
          }
          try {
            const temp = `${target}.tmp`;
            await writeFile(temp, text.endsWith("\n") ? text : `${text}\n`, "utf8");
            await rename(temp, target);
            return reply(200, { ok: true, path: path.basename(target), regions: json.regions.length });
          } catch (error) {
            return reply(500, { ok: false, error: String(error?.message ?? error) });
          }
        });
      });
    },
  };
}
