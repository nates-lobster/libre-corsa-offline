#!/usr/bin/env node
/**
 * Cross-platform launcher for LibreCorsa Offline's native air-gapped Electron shell.
 *
 * - Windows: resolves the native `electron.exe` directly (avoiding `.cmd` wrapper issues),
 *   registers `GpuPreference=2;` in `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`
 *   before launch so Windows assigns the discrete GPU on hybrid laptops, and starts Electron.
 * - Arch Linux: uses system `electron` (`sudo pacman -S electron`) or local `desktop/node_modules`.
 * - macOS: uses local `desktop/node_modules/electron` or system PATH `electron`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { ensureWindowsHighPerformanceGpu } = require("../desktop/src/windows-gpu.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_INDEX = path.join(ROOT, "out", "index.html");
const DESKTOP_DIR = path.join(ROOT, "desktop");
const extraArgs = process.argv.slice(2);
const gpuInfoOnly = extraArgs.includes("--gpu-info");

if (!gpuInfoOnly && !fs.existsSync(OUT_INDEX)) {
  console.error("[desktop] Missing built static export in out/. Run `npm run build` first.");
  process.exit(1);
}

/**
 * Resolve the actual Electron executable (native `electron.exe` on Windows, not `electron.cmd`).
 * @returns {string | null}
 */
function findElectronBinary() {
  if (process.env.ELECTRON_BIN && fs.existsSync(process.env.ELECTRON_BIN)) {
    return path.resolve(process.env.ELECTRON_BIN);
  }

  // Prefer the real binary pointed to by desktop/node_modules/electron/path.txt
  // (on Windows this is `desktop\node_modules\electron\dist\electron.exe`, avoiding Node 22 EINVAL on `.cmd`
  // and matching the exact `.exe` path Windows uses for UserGpuPreferences).
  const electronPkgDir = path.join(DESKTOP_DIR, "node_modules", "electron");
  const pathTxt = path.join(electronPkgDir, "path.txt");
  if (fs.existsSync(pathTxt)) {
    const rel = fs.readFileSync(pathTxt, "utf8").trim();
    const resolved = path.join(electronPkgDir, rel);
    if (fs.existsSync(resolved)) return resolved;
  }

  const directCandidates =
    process.platform === "win32"
      ? [
          path.join(electronPkgDir, "dist", "electron.exe"),
          path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
        ]
      : [
          path.join(DESKTOP_DIR, "node_modules", ".bin", "electron"),
          path.join(ROOT, "node_modules", ".bin", "electron"),
        ];
  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const probeCmd = process.platform === "win32" ? "where" : "which";
  const names =
    process.platform === "win32"
      ? ["electron.exe"]
      : ["electron", "electron36", "electron35", "electron34", "electron33", "electron32"];
  for (const name of names) {
    const res = spawnSync(probeCmd, [name], { encoding: "utf8", windowsHide: true });
    if (res.status === 0 && res.stdout.trim()) {
      const first = res.stdout.trim().split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) return first;
    }
  }
  return null;
}

const electronBin = findElectronBinary();
if (!electronBin) {
  console.error("[desktop] Could not find an Electron binary.");
  if (process.platform === "win32") {
    console.error("  Install Electron locally once:  npm run desktop:setup");
    console.error("  Or double-click:                windows\\play-desktop.bat");
  } else {
    console.error("  On Arch Linux:  sudo pacman -S electron");
    console.error("  Or locally:     npm run desktop:setup");
  }
  console.error("  Or run in your browser with zero extra installs: npm run play");
  process.exit(1);
}

// On Windows, register High-Performance (discrete) GPU preference BEFORE spawning electron.exe
// so DXGI picks the dedicated GPU immediately on the first process.
const noGpuPref = extraArgs.includes("--no-gpu-pref") || process.env.LIBRECORSA_NO_GPU_PREF === "1";
if (process.platform === "win32" && !noGpuPref) {
  const pref = ensureWindowsHighPerformanceGpu(electronBin);
  if (pref.status === "updated") {
    console.log(`[desktop] Configured Windows High-Performance (discrete) GPU preference for ${pref.exePath}`);
  } else if (pref.status === "failed") {
    console.warn(`[desktop] Could not register Windows GPU preference (${pref.reason}); falling back to --force_high_performance_gpu.`);
  }
}

const child = spawn(electronBin, [DESKTOP_DIR, ...extraArgs], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    LIBRECORSA_WEB_DIR: path.join(ROOT, "out"),
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
