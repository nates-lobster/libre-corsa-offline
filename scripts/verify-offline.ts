/**
 * Verifies strict offline invariants for LibreCorsa Offline:
 *  - online-config reports all network features permanently disabled
 *  - MultiplayerSyncManager stub stays idle with zero remote peers
 *  - All offline-bundled car & circuit assets exist locally in public/
 *  - Zero remote http(s) fetch / WebSocket / WebRTC endpoints exist in src/
 *  - Local offline static server resolves clean routes and blocks traversal
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { onlineApiBase, boardStateOf, readOnlineConfig } from "../src/lib/net/online-config";
import { MultiplayerSyncManager } from "../src/lib/sim/multiplayer-sync";
import { REPO_CAR_IDS, REPO_TRACK_IDS } from "../src/lib/hosted-content";
import { TRACKS } from "../src/lib/track-registry";
import { OFFLINE_CSP, resolveStaticFile } from "./serve-offline.mjs";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const SRC_DIR = path.join(ROOT, "src");

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

async function main() {
  console.log("Verifying LibreCorsa Offline invariants...");

  await check("online-config disables all network features", async () => {
    assert.equal(onlineApiBase, null);
    const snap = await readOnlineConfig();
    assert.equal(snap.reach, "none");
    assert.equal(snap.config.board, false);
    assert.equal(snap.config.rooms, false);
    assert.equal(snap.config.relay, false);
    assert.equal(snap.config.accounts, false);
    assert.equal(snap.config.races, false);
    assert.equal(snap.config.usage, false);
    assert.equal(snap.config.live, false);
    assert.equal(boardStateOf(snap), "off");
  });

  await check("MultiplayerSyncManager stub stays idle with zero peers", () => {
    const mp = new MultiplayerSyncManager();
    assert.equal(mp.status.state, "idle");
    assert.equal(mp.lobby, null);
    assert.equal(mp.isHost, false);
    assert.deepEqual(mp.update(1000, null), []);
  });

  await check("Offline-bundled car and circuit files exist locally in public/", () => {
    assert.ok(REPO_CAR_IDS.size >= 1, "At least one local car is bundled");
    assert.ok(REPO_TRACK_IDS.size >= 2, "At least two local circuits are bundled");
    for (const trackId of REPO_TRACK_IDS) {
      const track = TRACKS.find((t) => t.id === trackId);
      assert.ok(track, `Track ${trackId} exists in registry`);
      if (track.dataUrl) {
        const dataPath = path.join(PUBLIC_DIR, track.dataUrl.replace(/^\/+/, ""));
        assert.ok(fs.existsSync(dataPath), `Missing local track data: ${track.dataUrl}`);
      }
    }
    for (const file of [
      "tracks/index.json",
      "tracks/rwanda_official/track_data.json",
      "tracks/rwanda_official_short/track_data.json",
      "audio/f1_real_v6_low.wav",
      "basis/basis_transcoder.js",
      "basis/basis_transcoder.wasm",
      "sw.js",
    ]) {
      assert.ok(fs.existsSync(path.join(PUBLIC_DIR, file)), `Missing bundled asset: public/${file}`);
    }
  });

  await check("Zero remote fetch / RTCPeerConnection / remote WebSocket calls in src/", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    for (const file of walk(SRC_DIR)) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      assert.ok(!/\bRTCPeerConnection\b/.test(src), `Unexpected RTCPeerConnection in ${rel}`);
      assert.ok(!/fetch\s*\(\s*["'`]https?:\/\//.test(src), `Remote fetch() in ${rel}`);
      assert.ok(!/new\s+WebSocket\s*\(\s*["'`]wss?:\/\/(?!127\.0\.0\.1|localhost)/.test(src), `Remote WebSocket in ${rel}`);
      assert.ok(!/navigator\.sendBeacon\b/.test(src), `Unexpected sendBeacon in ${rel}`);
    }
  });

  await check("Offline server CSP blocks external origins and resolveStaticFile blocks traversal", () => {
    assert.ok(OFFLINE_CSP.includes("default-src 'self'"));
    assert.ok(OFFLINE_CSP.includes("connect-src 'self'"));
    assert.ok(!OFFLINE_CSP.includes("https://"));
    const traversal = resolveStaticFile(PUBLIC_DIR, "/../package.json");
    assert.equal(traversal, null, "Path traversal must be blocked");
    const sw = resolveStaticFile(PUBLIC_DIR, "/sw.js");
    assert.ok(sw && sw.full.endsWith(path.join("public", "sw.js")));
  });

  console.log(`All ${passed} offline checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
