#!/usr/bin/env node
/**
 * Cross-platform Next.js CLI runner (Windows cmd/PowerShell, Linux, macOS).
 *
 * 1. Disables Next.js telemetry in process.env without relying on POSIX-only
 *    inline `VAR=1 cmd` shell syntax.
 * 2. Scans `public/` for locally synced cars, circuits, shared tyre packs, and
 *    soundtrack MP3s (downloaded via `npm run sync:content`) and injects
 *    `NEXT_PUBLIC_LOCAL_*` so every installed car/circuit appears automatically.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");

/** Car id -> model GLB path under public/ (matches src/lib/cars/car-registry.ts) */
const CAR_MODEL_PATHS = {
  lc26: "cars/f12026/model/f12026.glb",
  "amg-gt3": "cars/amg-gt3-evo/model/amg-gt3-evo.glb",
  "bmw-m4-gt3": "cars/bmw-m4-gt3/model/bmw-m4-gt3.glb",
  "mtr-496r": "cars/mtr-496r/model/mtr-496r.glb",
  "lc-lmdh": "cars/lc-lmdh/model/lc-lmdh.glb",
  liana: "cars/liana/model/liana.glb",
  "nissan-r33-jgtc": "cars/nissan-r33-jgtc/model/nissan-r33-jgtc.glb",
  "nissan-r32-jtcc": "cars/nissan-r32-jtcc/model/nissan-r32-jtcc.glb",
  "bmw-m1-procar": "cars/bmw-m1-procar/model/bmw-m1-procar.glb",
  "vw-scirocco-gtx": "cars/vw-scirocco-gtx/model/vw-scirocco-gtx.glb",
  "chaparral-2d": "cars/chaparral-2d/model/chaparral-2d.glb",
  "chaparral-2d-67": "cars/chaparral-2d-67/model/chaparral-2d-67.glb",
  "porsche-934-rsr": "cars/porsche-934-rsr/model/porsche-934-rsr.glb",
};

function hasNonEmptyFile(relPath) {
  const full = path.join(PUBLIC, relPath.replace(/^\/+/, ""));
  try {
    return fs.statSync(full).size > 0;
  } catch {
    return false;
  }
}

function detectLocalCars() {
  const found = [];
  for (const [id, rel] of Object.entries(CAR_MODEL_PATHS)) {
    if (hasNonEmptyFile(rel)) found.push(id);
  }
  return found;
}

function detectLocalTracks() {
  const indexPath = path.join(PUBLIC, "tracks", "index.json");
  if (!fs.existsSync(indexPath)) return [];
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry?.id || !entry?.dataUrl) continue;
    const dataRel = entry.dataUrl.replace(/^\/+/, "");
    if (!hasNonEmptyFile(dataRel)) continue;
    // Also verify the track has at least one mesh GLB (full or split layout) locally so half-synced tracks never 404.
    const trackDir = path.join(PUBLIC, "tracks", entry.id);
    let hasMesh = false;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PUBLIC, dataRel), "utf8"));
      const meshUrl = data?.metadata?.mesh?.url;
      if (typeof meshUrl === "string" && hasNonEmptyFile(meshUrl)) hasMesh = true;
    } catch {
      // ignore parse errors; fall back to directory scan
    }
    if (!hasMesh && fs.existsSync(trackDir)) {
      try {
        hasMesh = fs.readdirSync(trackDir).some((f) => f.endsWith(".glb") && hasNonEmptyFile(path.join("tracks", entry.id, f)));
      } catch {
        hasMesh = false;
      }
    }
    if (hasMesh) found.push(entry.id);
  }
  return found;
}

function hasAnyFileWithExt(dirRel, ext) {
  const dir = path.join(PUBLIC, dirRel);
  if (!fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
      if (e.isDirectory()) return hasAnyFileWithExt(path.join(dirRel, e.name), ext);
      return e.isFile() && e.name.toLowerCase().endsWith(ext);
    });
  } catch {
    return false;
  }
}

const localCars = detectLocalCars();
const localTracks = detectLocalTracks();
const hasLocalMusic = hasAnyFileWithExt("music", ".mp3");
const hasSharedTyres = hasAnyFileWithExt(path.join("cars", "shared", "tyres"), ".webp");

if (localCars.length > 1 || localTracks.length > 2 || hasLocalMusic) {
  console.log(
    `[librecorsa-offline] Detected local content: ${localCars.length} car(s), ${localTracks.length} circuit(s)` +
      (hasLocalMusic ? ", soundtrack" : "") +
      (hasSharedTyres ? ", shared tyres" : "")
  );
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_LOCAL_CAR_IDS: process.env.NEXT_PUBLIC_LOCAL_CAR_IDS ?? localCars.join(","),
    NEXT_PUBLIC_LOCAL_TRACK_IDS: process.env.NEXT_PUBLIC_LOCAL_TRACK_IDS ?? localTracks.join(","),
    NEXT_PUBLIC_LOCAL_MUSIC: process.env.NEXT_PUBLIC_LOCAL_MUSIC ?? (hasLocalMusic ? "1" : "0"),
    NEXT_PUBLIC_LOCAL_SHARED_TYRES: process.env.NEXT_PUBLIC_LOCAL_SHARED_TYRES ?? (hasSharedTyres ? "1" : "0"),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
