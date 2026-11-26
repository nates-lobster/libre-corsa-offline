#!/usr/bin/env node
/**
 * Zero-dependency local HTTP server for LibreCorsa Offline.
 * Serves the static export in `out/` on loopback (127.0.0.1:18420 by default)
 * with strict air-gapped Content-Security-Policy headers, clean routes,
 * HTTP Range support for audio, and zero external network calls.
 *
 * Usage:
 *   node scripts/serve-offline.mjs [--host 127.0.0.1] [--port 18420] [--dir out] [--open]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

/**
 * Air-gapped CSP: blocks all outbound internet requests while allowing
 * local assets, WebGL/blob textures, Web Workers, WebAssembly (Basis KTX2),
 * and the optional loopback steering wheel FFB bridge (127.0.0.1:47821).
 */
export const OFFLINE_CSP = [
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

/** Safely resolve a request pathname inside `rootDir` (supports clean Next.js static export routes). */
export function resolveStaticFile(rootDir, rawPathname) {
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

export function startOfflineServer({
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out"),
  host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT ?? 18420),
} = {}) {
  const rootDir = path.resolve(dir);
  if (!fs.existsSync(path.join(rootDir, "index.html"))) {
    throw new Error(`Built static files not found in ${rootDir}. Run \`npm run build\` first.`);
  }

  const server = http.createServer((req, res) => {
    const method = req.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const found = resolveStaticFile(rootDir, url.pathname);
    if (!found) {
      const notFound = resolveStaticFile(rootDir, "/404.html");
      res.writeHead(404, {
        "Content-Type": notFound ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Security-Policy": OFFLINE_CSP,
        "X-Content-Type-Options": "nosniff",
      });
      if (method === "HEAD") {
        res.end();
      } else if (notFound) {
        fs.createReadStream(notFound.full).pipe(res);
      } else {
        res.end("Not Found");
      }
      return;
    }

    const { full, stat } = found;
    const ext = path.extname(full).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const isImmutable = url.pathname.includes("/_next/static/");
    const isSw = path.basename(full) === "sw.js";
    const cacheControl = isSw
      ? "no-cache"
      : isImmutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";

    const headers = {
      "Content-Type": contentType,
      "Content-Security-Policy": OFFLINE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": cacheControl,
      "Accept-Ranges": "bytes",
      "X-File-Size": String(stat.size),
      ...(isSw ? { "Service-Worker-Allowed": "/" } : {}),
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
      if (method === "HEAD") {
        res.end();
      } else {
        fs.createReadStream(full, { start, end }).pipe(res);
      }
      return;
    }

    res.writeHead(200, { ...headers, "Content-Length": String(stat.size) });
    if (method === "HEAD") {
      res.end();
    } else {
      fs.createReadStream(full).pipe(res);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      const boundHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      resolve({
        server,
        host,
        port: boundPort,
        url: `http://${boundHost}:${boundPort}`,
        playUrl: `http://${boundHost}:${boundPort}/play`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  } catch {
    // Headless environment; user can open the printed URL directly.
  }
}

function parseArgs(argv) {
  const opts = { host: process.env.HOST || "127.0.0.1", port: Number(process.env.PORT ?? 18420), open: false, dir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--open") opts.open = true;
    else if (arg === "--host" && argv[i + 1]) opts.host = argv[++i];
    else if (arg === "--port" && argv[i + 1]) opts.port = Number(argv[++i]);
    else if (arg === "--dir" && argv[i + 1]) opts.dir = argv[++i];
  }
  return opts;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const opts = parseArgs(process.argv.slice(2));
  startOfflineServer(opts)
    .then(({ url, playUrl, host, port }) => {
      console.log(`LibreCorsa Offline running at ${url} (listening on ${host}:${port})`);
      console.log(`Direct simulator route: ${playUrl}`);
      console.log("Strict offline mode: zero outbound internet requests.");
      if (opts.open) openBrowser(playUrl);
    })
    .catch((err) => {
      console.error(`[serve-offline] ${err.message}`);
      process.exit(1);
    });
}
