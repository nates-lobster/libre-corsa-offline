#!/usr/bin/env node
/**
 * Post-build step for LibreCorsa Offline:
 * Scans the static export in `out/`, hashes built files, and generates `out/sw.js`
 * with a Cache-First precache manifest for the core app shell + default bundled
 * simulator content so it runs 100% offline in any browser / PWA.
 *
 * Extra synced content packs (hosted cars under `cars/*` other than `f12026`,
 * extra circuits under `tracks/*` other than `rwanda_official*`, `/gt3/*`, and
 * `/music/*`) are served straight from disk by the local/desktop server and
 * cached on demand by `sw.js`'s runtime Cache-First handler so installing the
 * PWA stays fast and stays well within browser Cache Storage quotas.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "out");
const TEMPLATE_PATH = path.join(ROOT, "public", "sw.js");
const OUT_SW_PATH = path.join(OUT_DIR, "sw.js");
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

if (!fs.existsSync(OUT_DIR)) {
  console.error(`[generate-offline-sw] Missing ${OUT_DIR}. Run \`next build\` first.`);
  process.exit(1);
}

/** Recursively enumerate all files under `dir`, returning POSIX relative paths. */
function walk(dir, prefix = "") {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, rel));
    } else if (entry.isFile()) {
      results.push({ rel, full });
    }
  }
  return results;
}

/** Returns true for extra synced content packs that should be runtime-cached on demand rather than eagerly precached. */
function isExtraContentPack(rel) {
  if (rel.startsWith("music/") || rel.startsWith("gt3/")) return true;
  if (rel.startsWith("cars/") && !rel.startsWith("cars/f12026/")) return true;
  if (
    rel.startsWith("tracks/") &&
    rel !== "tracks/index.json" &&
    !rel.startsWith("tracks/rwanda_official/") &&
    !rel.startsWith("tracks/rwanda_official_short/")
  ) {
    return true;
  }
  return false;
}

const files = walk(OUT_DIR)
  .filter(({ rel }) => {
    if (rel === "sw.js") return false;
    if (rel === "404.html" || rel.startsWith("_not-found")) return false;
    if (rel.endsWith(".txt") && rel.startsWith("__next")) return false;
    if (rel.endsWith(".map")) return false;
    return true;
  })
  .sort((a, b) => a.rel.localeCompare(b.rel));

const hash = crypto.createHash("sha256");
let precacheBytes = 0;
let extraPackFiles = 0;
const precacheUrls = new Set();

for (const { rel, full } of files) {
  if (isExtraContentPack(rel)) {
    const stat = fs.statSync(full);
    hash.update(`${rel}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    extraPackFiles++;
    continue;
  }
  const buf = fs.readFileSync(full);
  precacheBytes += buf.byteLength;
  hash.update(rel);
  hash.update(buf);
  precacheUrls.add(`${BASE_PATH}/${rel}`);
}

// Include clean route aliases so direct navigation to `/`, `/play`, `/about` hits cache immediately.
for (const route of ["/", "/play", "/about"]) {
  const target = route === "/" ? "index.html" : `${route.slice(1)}.html`;
  if (fs.existsSync(path.join(OUT_DIR, target))) {
    precacheUrls.add(`${BASE_PATH}${route}`);
  }
}

const version = hash.digest("hex").slice(0, 12);
const cacheName = `librecorsa-offline-${version}`;
const sortedUrls = [...precacheUrls].sort();

const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
const generated = template
  .replace(/const CACHE_NAME = "[^"]+";/, `const CACHE_NAME = ${JSON.stringify(cacheName)};`)
  .replace(/const PRECACHE_URLS = \[\];/, `const PRECACHE_URLS = ${JSON.stringify(sortedUrls, null, 2)};`);

if (!generated.includes(cacheName)) {
  console.error("[generate-offline-sw] Failed to inject CACHE_NAME into sw.js template.");
  process.exit(1);
}

fs.writeFileSync(OUT_SW_PATH, generated, "utf8");
const mb = (precacheBytes / (1024 * 1024)).toFixed(2);
const extraNote = extraPackFiles > 0 ? `, +${extraPackFiles} extra content-pack files cached on demand` : "";
console.log(`[generate-offline-sw] Wrote out/sw.js (${cacheName}, ${sortedUrls.length} precached entries, ${mb} MB${extraNote})`);
