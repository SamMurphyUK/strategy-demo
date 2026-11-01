// Dev-server only. Vite keeps an in-memory list of public files and, after that list drops an
// entry, the request falls through to the SPA and comes back as index.html. A same-content
// rewrite of web/public did that to the land SVG: the file on disk was still valid XML, and the
// map reported "not valid XML" because it parsed the app page. Serve a public file from disk
// before that list is consulted.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const PREFIXES = ["/assets/", "/AUDIO/", "/battle-assets/"];

const TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export function publicDirPlugin() {
  return {
    name: "public-dir-from-disk",
    apply: "serve",
    configureServer(server) {
      const root = path.resolve(server.config.publicDir);
      const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }
        const pathname = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (!PREFIXES.some((prefix) => pathname.startsWith(prefix)) || pathname.includes("\0")) {
          return next();
        }
        const file = path.resolve(root, `.${pathname}`);
        if (file !== root && !file.startsWith(rootPrefix)) {
          return next();
        }
        stat(file)
          .then((info) => {
            if (!info.isFile()) {
              next();
              return;
            }
            const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
            res.statusCode = 200;
            res.setHeader("Content-Type", type);
            res.setHeader("Content-Length", info.size);
            res.setHeader("Cache-Control", "no-cache");
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            createReadStream(file).pipe(res);
          })
          .catch(() => next());
      });
    },
  };
}
