"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ktx2": "image/ktx2",
  ".bin": "application/octet-stream",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

const OFFLINE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: ws://127.0.0.1:47821 ws://localhost:47821",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * Locate the built static web root (`index.html`).
 * Priority:
 *  1. explicit `webDir` option or `LIBRECORSA_WEB_DIR` env var
 *  2. packaged sibling `../web` (Arch `/usr/lib/librecorsa-offline/web`)
 *  3. repository root `../../out` (from `desktop/src`)
 * @param {string | undefined} explicitDir
 * @returns {string}
 */
function resolveWebRoot(explicitDir) {
  const candidates = [
    explicitDir,
    process.env.LIBRECORSA_WEB_DIR,
    process.resourcesPath ? path.join(process.resourcesPath, "web") : null,
    path.resolve(__dirname, "..", "web"),
    path.resolve(__dirname, "..", "..", "out"),
  ].filter(Boolean);

  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (fs.existsSync(path.join(resolved, "index.html"))) {
      return resolved;
    }
  }
  throw new Error(
    `Could not find built LibreCorsa static files (checked: ${candidates.join(", ")}). Run \`npm run build\` first.`,
  );
}

/**
 * Resolve a request path inside `rootDir`, preventing directory traversal.
 * @param {string} rootDir
 * @param {string} rawPathname
 * @returns {{ full: string, stat: fs.Stats } | null}
 */
function resolveStaticFile(rootDir, rawPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }
  const clean = decoded.split("?")[0].replace(/\0/g, "");
  const rootResolved = path.resolve(rootDir);

  const candidates = [];
  if (clean === "/" || clean === "") {
    candidates.push("index.html");
  } else {
    const trimmed = clean.replace(/^\/+/, "").replace(/\/+$/, "");
    candidates.push(trimmed);
    if (!path.extname(trimmed)) {
      candidates.push(`${trimmed}.html`, path.join(trimmed, "index.html"));
    }
  }

  for (const rel of candidates) {
    const full = path.resolve(rootResolved, rel);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) continue;
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) return { full, stat };
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Stable loopback port for the Electron desktop app so Chromium keeps the same
 * origin (`http://127.0.0.1:18421`) across launches — preserving localStorage
 * and IndexedDB (settings, graphics preset, bindings, personal bests, ghosts,
 * garage setups, race history, and AI learning). Distinct from the browser
 * offline server default (18420) so both can run side-by-side without conflict.
 */
const DEFAULT_DESKTOP_PORT = 18421;

/**
 * Start a strictly loopback-only HTTP server on 127.0.0.1 for the Electron shell.
 * Uses a fixed default port (18421) so persistent browser storage (localStorage &
 * IndexedDB) keeps the same origin across app restarts; falls back to nearby ports
 * if 18421 is busy.
 * @param {{ webDir?: string, port?: number }} [opts]
 * @returns {Promise<{ server: http.Server, origin: string, playUrl: string, port: number, webRoot: string, close: () => Promise<void> }>}
 */
function startLocalServer(opts = {}) {
  const webRoot = resolveWebRoot(opts.webDir);
  const explicitPort =
    opts.port !== undefined
      ? opts.port
      : process.env.LIBRECORSA_PORT !== undefined && process.env.LIBRECORSA_PORT !== ""
        ? Number(process.env.LIBRECORSA_PORT)
        : null;
  const candidatePorts =
    explicitPort !== null
      ? [explicitPort]
      : [
          DEFAULT_DESKTOP_PORT,
          ...Array.from({ length: 9 }, (_, i) => DEFAULT_DESKTOP_PORT + 1 + i),
          0,
        ];

  const server = http.createServer((req, res) => {
    const method = req.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    const url = new URL(req.url || "/", "http://127.0.0.1");
    const found = resolveStaticFile(webRoot, url.pathname);
    if (!found) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Security-Policy": OFFLINE_CSP,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(method === "HEAD" ? undefined : "Not Found");
      return;
    }

    const { full, stat } = found;
    const ext = path.extname(full).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const isImmutable = url.pathname.includes("/_next/static/");
    const headers = {
      "Content-Type": contentType,
      "Content-Security-Policy": OFFLINE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": isImmutable ? "public, max-age=31536000, immutable" : "no-cache",
      "Accept-Ranges": "bytes",
      "X-File-Size": String(stat.size),
    };

    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [startStr, endStr] = range.replace(/^bytes=/, "").split("-");
      let start = startStr === "" ? 0 : Number(startStr);
      let end = endStr === "" ? stat.size - 1 : Number(endStr);
      if (startStr === "" && endStr !== "") {
        start = Math.max(0, stat.size - Number(endStr));
        end = stat.size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
      });
      if (method === "HEAD") res.end();
      else fs.createReadStream(full, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...headers, "Content-Length": String(stat.size) });
    if (method === "HEAD") res.end();
    else fs.createReadStream(full).pipe(res);
  });

  return new Promise((resolve, reject) => {
    let idx = 0;

    const tryNext = () => {
      const targetPort = candidatePorts[idx];
      const onError = (err) => {
        server.removeListener("listening", onListening);
        if (err && err.code === "EADDRINUSE" && idx + 1 < candidatePorts.length) {
          idx++;
          tryNext();
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : targetPort;
        if (explicitPort === null && port !== DEFAULT_DESKTOP_PORT) {
          console.warn(
            `[librecorsa-offline] Default port ${DEFAULT_DESKTOP_PORT} was busy; using ${port} (settings/saves are tied to origin port).`,
          );
        }
        const origin = `http://127.0.0.1:${port}`;
        resolve({
          server,
          origin,
          playUrl: `${origin}/play`,
          port,
          webRoot,
          close: () => new Promise((done) => server.close(() => done())),
        });
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(targetPort, "127.0.0.1");
    };

    tryNext();
  });
}

module.exports = {
  DEFAULT_DESKTOP_PORT,
  OFFLINE_CSP,
  resolveWebRoot,
  resolveStaticFile,
  startLocalServer,
};
