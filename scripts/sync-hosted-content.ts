#!/usr/bin/env tsx
/**
 * LibreCorsa Offline — Content Pack Sync Tool
 *
 * Upstream LibreCorsa only commits RISE Motordrome (`rwanda_official*`) and the
 * 2026 Prototype (`lc26`) in Git; all other cars (GT3, LMDh, classic touring,
 * road cars), circuits (Monaco, Red Bull Ring, Watkins Glen, Le Mans '82,
 * Istanbul Park, Okayama, VIR, etc.), shared tyre packs, and the classical
 * soundtrack live on https://librecorsa.org and are gitignored under `public/`.
 *
 * Run this script ONCE while online to download any or all of those assets into
 * local `public/`. After `npm run build`, LibreCorsa Offline automatically
 * detects every locally installed car, circuit, tyre pack, and music track and
 * runs 100% air-gapped offline with zero runtime network traffic.
 *
 * Examples:
 *   npm run sync:content                          # Download ALL cars, circuits, tyres & soundtrack
 *   npm run sync:content -- --list                # Show available & installed cars/circuits
 *   npm run sync:content -- --cars                # Download all hosted cars + shared tyres
 *   npm run sync:content -- --tracks              # Download all hosted circuits
 *   npm run sync:content -- --music               # Download all 28 classical soundtrack MP3s
 *   npm run sync:content -- --car=amg-gt3,liana   # Download specific car(s)
 *   npm run sync:content -- --track=monaco,vir    # Download specific circuit(s) or venue(s)
 *   npm run sync:content -- --no-skins            # Skip extra car skin packs (faster)
 *   npm run sync:content -- --no-music            # Download cars & tracks without music
 *   npm run sync:content -- --force               # Re-download existing files
 */

// Enable full catalog visibility BEFORE dynamically importing registries.
process.env.NEXT_PUBLIC_HOSTED_CONTENT = "1";

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");
const DEFAULT_SOURCE = "https://librecorsa.org";
const DEFAULT_CONCURRENCY = 6;

const SHARED_TYRE_EXTRA_URLS = [
  "/cars/shared/tyres/pirelli-2025-ps-slick.webp",
  "/cars/shared/tyres/pirelli-2025-ps-intermediate.webp",
  "/cars/shared/tyres/pirelli-2025-ps-art.webp",
];

interface CliOptions {
  source: string;
  concurrency: number;
  listOnly: boolean;
  force: boolean;
  noSkins: boolean;
  noMusic: boolean;
  wantCars: boolean;
  wantTracks: boolean;
  wantMusic: boolean;
  carFilter: Set<string> | null;
  trackFilter: Set<string> | null;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let source = DEFAULT_SOURCE;
  let concurrency = DEFAULT_CONCURRENCY;
  let listOnly = false;
  let force = false;
  let noSkins = false;
  let noMusic = false;
  let carsFlag = false;
  let tracksFlag = false;
  let musicFlag = false;
  let carFilter: Set<string> | null = null;
  let trackFilter: Set<string> | null = null;
  let help = false;

  const parseCsv = (val: string) =>
    val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--list") listOnly = true;
    else if (a === "--force") force = true;
    else if (a === "--no-skins") noSkins = true;
    else if (a === "--no-music") noMusic = true;
    else if (a === "--cars") carsFlag = true;
    else if (a === "--tracks" || a === "--circuits") tracksFlag = true;
    else if (a === "--music") musicFlag = true;
    else if (a.startsWith("--source=")) source = a.slice("--source=".length).replace(/\/+$/, "");
    else if (a === "--source" && argv[i + 1]) source = argv[++i].replace(/\/+$/, "");
    else if (a.startsWith("--concurrency=")) concurrency = Math.max(1, Math.min(16, Number(a.slice("--concurrency=".length)) || DEFAULT_CONCURRENCY));
    else if (a === "--concurrency" && argv[i + 1]) concurrency = Math.max(1, Math.min(16, Number(argv[++i]) || DEFAULT_CONCURRENCY));
    else if (a.startsWith("--car=") || a.startsWith("--cars=")) {
      carFilter ??= new Set();
      for (const id of parseCsv(a.slice(a.indexOf("=") + 1))) carFilter.add(id);
    } else if (a === "--car" && argv[i + 1]) {
      carFilter ??= new Set();
      for (const id of parseCsv(argv[++i])) carFilter.add(id);
    } else if (a.startsWith("--track=") || a.startsWith("--tracks=") || a.startsWith("--circuit=")) {
      trackFilter ??= new Set();
      for (const id of parseCsv(a.slice(a.indexOf("=") + 1))) trackFilter.add(id);
    } else if ((a === "--track" || a === "--circuit") && argv[i + 1]) {
      trackFilter ??= new Set();
      for (const id of parseCsv(argv[++i])) trackFilter.add(id);
    } else {
      console.warn(`[sync-content] Ignoring unknown option: ${a}`);
    }
  }

  const anyExplicit = carsFlag || tracksFlag || musicFlag || carFilter !== null || trackFilter !== null;
  const wantCars = anyExplicit ? carsFlag || carFilter !== null : true;
  const wantTracks = anyExplicit ? tracksFlag || trackFilter !== null : true;
  const wantMusic = (anyExplicit ? musicFlag : true) && !noMusic;

  return {
    source,
    concurrency,
    listOnly,
    force,
    noSkins,
    noMusic,
    wantCars,
    wantTracks,
    wantMusic,
    carFilter,
    trackFilter,
    help,
  };
}

function destPathFor(urlPath: string): string {
  const clean = urlPath.replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC, clean);
  if (!resolved.startsWith(PUBLIC + path.sep)) {
    throw new Error(`Refusing to write outside public/: ${urlPath}`);
  }
  return resolved;
}

function hasLocalFile(urlPath: string): boolean {
  try {
    return fs.statSync(destPathFor(urlPath)).size > 0;
  } catch {
    return false;
  }
}

interface DownloadStats {
  downloaded: number;
  skipped: number;
  missingOptional: number;
  failed: string[];
  bytes: number;
}

async function downloadFile(
  source: string,
  urlPath: string,
  opts: { force: boolean; optional?: boolean },
  stats: DownloadStats,
  seen: Set<string>
): Promise<boolean> {
  const normalized = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
  if (seen.has(normalized)) return hasLocalFile(normalized);
  seen.add(normalized);

  const dest = destPathFor(normalized);
  if (!opts.force && hasLocalFile(normalized)) {
    stats.skipped++;
    return true;
  }

  const url = `${source}${normalized}`;
  const tmp = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LibreCorsa-Offline-ContentSync/0.2" },
        redirect: "follow",
      });
      if (res.status === 404 || res.status === 410) {
        if (opts.optional) {
          stats.missingOptional++;
          return false;
        }
        stats.failed.push(`${normalized} (HTTP ${res.status})`);
        return false;
      }
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const out = fs.createWriteStream(tmp);
      await pipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream), out);
      const size = fs.statSync(tmp).size;
      if (size === 0) {
        fs.rmSync(tmp, { force: true });
        throw new Error("Empty response body");
      }
      fs.renameSync(tmp, dest);
      stats.downloaded++;
      stats.bytes += size;
      return true;
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      if (attempt === 3) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.optional) {
          stats.missingOptional++;
        } else {
          stats.failed.push(`${normalized} (${msg})`);
        }
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  return false;
}

async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/** Recursively extract all `"file"` string entries from a car audio `manifest.json`. */
function collectManifestFiles(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectManifestFiles(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.file === "string" && obj.file.trim()) out.add(obj.file.trim());
  for (const val of Object.values(obj)) collectManifestFiles(val, out);
}

/** Read a GLB's JSON chunk without loading the whole binary into RAM and extract any `extras.skinMaps` filenames. */
function readGlbSkinMapFiles(glbPath: string): string[] {
  try {
    const fd = fs.openSync(glbPath, "r");
    try {
      const head = Buffer.alloc(20);
      if (fs.readSync(fd, head, 0, 20, 0) < 20) return [];
      if (head.readUInt32LE(0) !== 0x46546c67) return []; // "glTF"
      const jsonLen = head.readUInt32LE(12);
      if (jsonLen <= 0 || jsonLen > 32 * 1024 * 1024) return [];
      const buf = Buffer.alloc(jsonLen);
      fs.readSync(fd, buf, 0, jsonLen, 20);
      const gltf = JSON.parse(buf.toString("utf8")) as {
        nodes?: Array<{ extras?: { skinMaps?: Record<string, unknown> } }>;
      };
      const files = new Set<string>();
      for (const node of gltf.nodes ?? []) {
        const maps = node.extras?.skinMaps;
        if (maps && typeof maps === "object") {
          for (const val of Object.values(maps)) {
            if (typeof val === "string" && val.trim()) files.add(val.trim());
          }
        }
      }
      return [...files];
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printHelp(): void {
  console.log(`
LibreCorsa Offline — Content Pack Sync Tool

Downloads hosted cars, circuits, shared tyre packs, and soundtrack MP3s from
https://librecorsa.org into local public/ so LibreCorsa Offline can run them
100% offline with zero network connections at runtime.

Usage:
  npm run sync:content                          Download everything (cars + circuits + music)
  npm run sync:content -- --list                List all cars & circuits and local status
  npm run sync:content -- --cars                Download all hosted cars + shared tyres
  npm run sync:content -- --tracks              Download all hosted circuits
  npm run sync:content -- --music               Download all classical soundtrack MP3s
  npm run sync:content -- --car=amg-gt3,liana   Download specific car(s)
  npm run sync:content -- --track=monaco,vir    Download specific circuit(s) or venue(s)
  npm run sync:content -- --no-skins            Skip extra car livery texture packs
  npm run sync:content -- --no-music            Skip soundtrack MP3s
  npm run sync:content -- --force               Re-download files already present locally
  npm run sync:content -- --concurrency=6       Parallel downloads (1-16, default 6)
  npm run sync:content -- --source=URL          Custom asset origin (default ${DEFAULT_SOURCE})

After syncing, rebuild once so LibreCorsa Offline registers the new local content:
  npm run build
  npm run desktop
`.trim());
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const [
    { REPO_CAR_IDS, REPO_TRACK_IDS },
    { CARS, carThumbUrl, carSkinThumbUrl, carSkinBaseUrl },
    { TRACKS, CIRCUIT_VENUES, VENUE_HERO_WIDTHS, venueHeroUrl },
    { venueModelFiles },
    { MUSIC_TRACKS, musicUrl },
    { GT_TYRE_PACKS },
    { PIRELLI_SIDEWALL_URL },
  ] = await Promise.all([
    import("../src/lib/hosted-content"),
    import("../src/lib/cars/car-registry"),
    import("../src/lib/track-registry"),
    import("../src/lib/venue-models"),
    import("../src/lib/audio/music-catalog"),
    import("../src/lib/render/gt-tyre-sidewall"),
    import("../src/lib/render/pirelli-sidewall"),
  ]);

  const hostedCars = CARS.filter((c) => !REPO_CAR_IDS.has(c.id));
  const hostedTracks = TRACKS.filter((t) => !REPO_TRACK_IDS.has(t.id));

  if (opts.listOnly) {
    console.log(`\nCars (${CARS.length} total, ${hostedCars.length} hosted):`);
    for (const c of CARS) {
      const modelUrl = c.modelUrl ?? "/cars/f12026/model/f12026.glb";
      const tag = REPO_CAR_IDS.has(c.id) ? "bundled  " : hasLocalFile(modelUrl) ? "installed" : "not local";
      console.log(`  [${tag}] ${c.id.padEnd(18)} ${c.title} (${c.classId}, ${c.year})`);
    }
    console.log(`\nCircuits (${TRACKS.length} total, ${hostedTracks.length} hosted):`);
    for (const t of TRACKS) {
      const tag = REPO_TRACK_IDS.has(t.id) ? "bundled  " : t.dataUrl && hasLocalFile(t.dataUrl) ? "installed" : "not local";
      console.log(`  [${tag}] ${t.id.padEnd(24)} ${t.name} — ${t.layout} (${t.country})`);
    }
    const localMusicCount = MUSIC_TRACKS.filter((m) => hasLocalFile(musicUrl(m))).length;
    console.log(`\nSoundtrack: ${localMusicCount}/${MUSIC_TRACKS.length} tracks installed in public/music/\n`);
    return;
  }

  const selectedCars = opts.wantCars
    ? hostedCars.filter((c) => !opts.carFilter || opts.carFilter.has(c.id))
    : [];

  const selectedTracks = opts.wantTracks
    ? hostedTracks.filter((t) => {
        if (!opts.trackFilter) return true;
        if (opts.trackFilter.has(t.id)) return true;
        // Also allow matching by venue id (e.g. `--track=vir` grabs all VIR layouts)
        const venue = CIRCUIT_VENUES.find((v) => v.layouts.some((l) => l.id === t.id));
        return Boolean(venue && opts.trackFilter.has(venue.id));
      })
    : [];

  const stats: DownloadStats = { downloaded: 0, skipped: 0, missingOptional: 0, failed: [], bytes: 0 };
  const seen = new Set<string>();

  console.log(
    `[sync-content] Source: ${opts.source} | Cars: ${selectedCars.length} | Circuits: ${selectedTracks.length} | Music: ${opts.wantMusic ? MUSIC_TRACKS.length : 0}`
  );

  // 1. Shared tyre textures (used across F1, GT3, LMDh, and classic cars)
  if (selectedCars.length > 0) {
    const tyreUrls = new Set<string>([PIRELLI_SIDEWALL_URL, ...SHARED_TYRE_EXTRA_URLS]);
    for (const pack of Object.values(GT_TYRE_PACKS)) {
      tyreUrls.add(pack.url);
      if (pack.wetUrl) tyreUrls.add(pack.wetUrl);
    }
    console.log(`[sync-content] Syncing ${tyreUrls.size} shared tyre textures...`);
    await runPool([...tyreUrls], opts.concurrency, async (u) => {
      await downloadFile(opts.source, u, { force: opts.force, optional: true }, stats, seen);
    });
  }

  // 2. Hosted cars: GLB model, thumbnail, audio manifest + all .ogg/.wav files, and skin packs
  for (let i = 0; i < selectedCars.length; i++) {
    const car = selectedCars[i];
    console.log(`[sync-content] Car ${i + 1}/${selectedCars.length}: ${car.title} (${car.id})`);

    const modelUrl = car.modelUrl;
    if (modelUrl) {
      await downloadFile(opts.source, modelUrl, { force: opts.force }, stats, seen);
    }
    await downloadFile(opts.source, carThumbUrl(car.id), { force: opts.force, optional: true }, stats, seen);

    // Sound bank manifest + all referenced audio samples
    const assetDir = car.sound.assetDir.endsWith("/") ? car.sound.assetDir : `${car.sound.assetDir}/`;
    const manifestUrl = `${assetDir}manifest.json`;
    const manifestOk = await downloadFile(opts.source, manifestUrl, { force: opts.force }, stats, seen);
    if (manifestOk) {
      try {
        const manifest = JSON.parse(fs.readFileSync(destPathFor(manifestUrl), "utf8"));
        const audioFiles = new Set<string>();
        collectManifestFiles(manifest, audioFiles);
        await runPool([...audioFiles], opts.concurrency, async (file) => {
          await downloadFile(opts.source, `${assetDir}${file}`, { force: opts.force }, stats, seen);
        });
      } catch (err) {
        stats.failed.push(`${manifestUrl} (invalid JSON: ${err instanceof Error ? err.message : String(err)})`);
      }
    }

    // Skins + skin thumbnails
    const skins = car.skins ?? [];
    if (skins.length > 0) {
      const thumbTasks = skins.map((s) => carSkinThumbUrl(car.id, s.id));
      await runPool(thumbTasks, opts.concurrency, async (u) => {
        await downloadFile(opts.source, u, { force: opts.force, optional: true }, stats, seen);
      });

      if (!opts.noSkins) {
        const glbSkinFiles = modelUrl && hasLocalFile(modelUrl) ? readGlbSkinMapFiles(destPathFor(modelUrl)) : [];
        const skinDownloads: Array<{ url: string; optional: boolean }> = [];
        for (const skin of skins) {
          if (skin.procedural) continue;
          const base = carSkinBaseUrl(car.id, skin.id);
          if (skin.files && skin.files.length > 0) {
            for (const f of skin.files) skinDownloads.push({ url: `${base}/${f}`, optional: false });
          } else if (glbSkinFiles.length > 0) {
            for (const f of glbSkinFiles) skinDownloads.push({ url: `${base}/${f}`, optional: true });
          }
        }
        await runPool(skinDownloads, opts.concurrency, async (item) => {
          await downloadFile(opts.source, item.url, { force: opts.force, optional: item.optional }, stats, seen);
        });
      }
    }
  }

  // 3. Hosted circuits: track_data.json, GLB or split venue pair (shared + layout), scenery GLBs, and hero stills
  const heroVenues = new Set<string>();
  for (let i = 0; i < selectedTracks.length; i++) {
    const track = selectedTracks[i];
    console.log(`[sync-content] Circuit ${i + 1}/${selectedTracks.length}: ${track.name} — ${track.layout} (${track.id})`);

    const dataUrl = track.dataUrl;
    const dataOk = dataUrl ? await downloadFile(opts.source, dataUrl, { force: opts.force }, stats, seen) : false;
    await downloadFile(opts.source, `/tracks/${track.id}/LICENSE.md`, { force: opts.force, optional: true }, stats, seen);

    const venue = CIRCUIT_VENUES.find((v) => v.layouts.some((l) => l.id === track.id));
    if (venue) heroVenues.add(venue.id);

    let fullMeshUrl: string | null = null;
    let sceneryUrls: string[] = [];
    if (dataOk && dataUrl) {
      try {
        const data = JSON.parse(fs.readFileSync(destPathFor(dataUrl), "utf8")) as {
          metadata?: { mesh?: { url?: string; scenery?: string[] } };
        };
        if (typeof data?.metadata?.mesh?.url === "string") fullMeshUrl = data.metadata.mesh.url;
        if (Array.isArray(data?.metadata?.mesh?.scenery)) {
          sceneryUrls = data.metadata.mesh.scenery.filter((s): s is string => typeof s === "string");
        }
      } catch (err) {
        stats.failed.push(`${dataUrl} (invalid JSON: ${err instanceof Error ? err.message : String(err)})`);
      }
    }

    const split = venueModelFiles(track.id);
    let splitReady = false;
    if (split) {
      const sharedOk = await downloadFile(opts.source, split.sharedUrl, { force: opts.force, optional: Boolean(fullMeshUrl) }, stats, seen);
      const layoutOk = await downloadFile(opts.source, split.layoutUrl, { force: opts.force, optional: Boolean(fullMeshUrl) }, stats, seen);
      splitReady = sharedOk && layoutOk;
    }
    if (!splitReady && fullMeshUrl) {
      await downloadFile(opts.source, fullMeshUrl, { force: opts.force }, stats, seen);
    }

    if (sceneryUrls.length > 0) {
      await runPool(sceneryUrls, opts.concurrency, async (u) => {
        await downloadFile(opts.source, u, { force: opts.force }, stats, seen);
        const creditsUrl = path.posix.join(path.posix.dirname(u), "credits.json");
        await downloadFile(opts.source, creditsUrl, { force: opts.force, optional: true }, stats, seen);
      });
    }
  }

  if (heroVenues.size > 0) {
    const heroUrls: string[] = [];
    for (const vId of heroVenues) {
      for (const w of VENUE_HERO_WIDTHS) heroUrls.push(venueHeroUrl(vId, w));
    }
    await runPool(heroUrls, opts.concurrency, async (u) => {
      await downloadFile(opts.source, u, { force: opts.force, optional: true }, stats, seen);
    });
  }

  // 4. Classical soundtrack MP3s
  if (opts.wantMusic) {
    console.log(`[sync-content] Syncing ${MUSIC_TRACKS.length} soundtrack MP3s...`);
    await runPool(MUSIC_TRACKS, opts.concurrency, async (track) => {
      await downloadFile(opts.source, musicUrl(track), { force: opts.force }, stats, seen);
    });
  }

  console.log("");
  console.log(
    `[sync-content] Done: ${stats.downloaded} downloaded (${formatMb(stats.bytes)}), ${stats.skipped} already local` +
      (stats.failed.length > 0 ? `, ${stats.failed.length} failed` : "")
  );

  if (stats.failed.length > 0) {
    console.error("[sync-content] Failed downloads:");
    for (const f of stats.failed.slice(0, 20)) console.error(`  - ${f}`);
    if (stats.failed.length > 20) console.error(`  ... and ${stats.failed.length - 20} more`);
    process.exitCode = 1;
  } else {
    console.log("[sync-content] Next step: rebuild so LibreCorsa Offline registers the downloaded cars & circuits:");
    console.log("  npm run build");
    console.log("  npm run desktop");
  }
}

main().catch((err) => {
  console.error("[sync-content] Fatal error:", err);
  process.exit(1);
});
