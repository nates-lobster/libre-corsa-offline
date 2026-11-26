"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const USER_GPU_PREFS_KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
const HIGH_PERFORMANCE_PREF = "GpuPreference=2;";

const VENDOR_NVIDIA = 0x10de;
const VENDOR_AMD = 0x1002;
const VENDOR_INTEL = 0x8086;
const VENDOR_MICROSOFT = 0x1414;
const VENDOR_QUALCOMM = 0x5143;

const VENDOR_NAMES = new Map([
  [VENDOR_NVIDIA, "NVIDIA"],
  [VENDOR_AMD, "AMD"],
  [VENDOR_INTEL, "Intel"],
  [VENDOR_MICROSOFT, "Microsoft"],
  [VENDOR_QUALCOMM, "Qualcomm"],
]);

const SOFTWARE_RE = /microsoft basic render|swiftshader|llvmpipe|softpipe|lavapipe|\bwarp\b/i;
const INTEL_DISCRETE_ARC_RE = /\barc(?:\s*\((?:tm|r)\))?\s+(?:pro\s+)?[ab]\d{3,4}m?\b/i;
const AMD_DISCRETE_RE = /\brx\s*\d{3,4}|\bradeon\s+pro\b|\bradeon\s+vii\b|\bfirepro\b|\bradeon\s+r[79]\s*[23]\d{2}\b|\bvega\s*(56|64|frontier)\b/i;
const AMD_INTEGRATED_RE = /\bradeon(\(tm\))?\s+graphics\b|\bradeon(\(tm\))?\s+(610|660|680|740|760|780|840|860|880|890)m\b|\bvega\s*([3-9]|1[01])\b|\brenoir\b|\bcezanne\b|\brembrandt\b|\bphoenix\b|\bhawk\s*point\b|\bstrix\b/i;

/**
 * Format a PCI vendor ID as a readable name.
 * @param {number | undefined} vendorId
 * @returns {string}
 */
function vendorName(vendorId) {
  if (typeof vendorId !== "number" || !Number.isFinite(vendorId)) return "Unknown";
  return VENDOR_NAMES.get(vendorId) || `0x${vendorId.toString(16).padStart(4, "0")}`;
}

/**
 * Update or append `GpuPreference=2;` in a Windows UserGpuPreferences value string,
 * preserving any other semicolon-delimited DirectX flags the user may have set.
 * @param {string | null | undefined} existing
 * @returns {string}
 */
function upsertHighPerformancePref(existing) {
  const raw = typeof existing === "string" ? existing.trim() : "";
  if (!raw) return HIGH_PERFORMANCE_PREF;
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^GpuPreference=/i.test(p));
  parts.push("GpuPreference=2");
  return `${parts.join(";")};`;
}

/**
 * Parse `reg.exe query` output for a specific executable value and extract its string data.
 * @param {string} stdout
 * @returns {string | null}
 */
function parseRegQueryValue(stdout) {
  if (typeof stdout !== "string") return null;
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/\bREG_SZ\s+(.+?)\s*$/i);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Return true if the existing DirectX UserGpuPreferences string already enforces High Performance (2).
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function hasHighPerformancePref(value) {
  return typeof value === "string" && /(?:^|;)GpuPreference=2(?:;|$)/i.test(value.trim());
}

/**
 * Register Windows 10/11 per-app High Performance (discrete) GPU preference in
 * `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` (no administrator privileges required).
 *
 * Must run BEFORE Windows creates the graphics device for `exePath` to take effect on that launch.
 *
 * @param {string} exePath
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, runReg?: (args: string[]) => { status: number | null, stdout: string, stderr: string } }} [opts]
 * @returns {{ status: "skipped" | "already-set" | "updated" | "failed", changed: boolean, exePath: string, value?: string, reason?: string }}
 */
function ensureWindowsHighPerformanceGpu(exePath, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  if (platform !== "win32") {
    return { status: "skipped", changed: false, exePath: String(exePath || ""), reason: "non-windows" };
  }
  if (env.LIBRECORSA_NO_GPU_PREF === "1" || env.LIBRECORSA_NO_GPU_OVERRIDES === "1") {
    return { status: "skipped", changed: false, exePath: String(exePath || ""), reason: "disabled-by-env" };
  }
  if (!exePath || typeof exePath !== "string" || !/\.exe$/i.test(exePath.trim())) {
    return { status: "skipped", changed: false, exePath: String(exePath || ""), reason: "not-exe" };
  }

  const normalizedExe = path.win32.resolve(exePath.trim());
  const runReg =
    opts.runReg ||
    ((args) => {
      const res = spawnSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
      return {
        status: res.status,
        stdout: res.stdout || "",
        stderr: res.stderr || (res.error ? res.error.message : ""),
      };
    });

  try {
    const query = runReg(["query", USER_GPU_PREFS_KEY, "/v", normalizedExe]);
    const currentValue = query.status === 0 ? parseRegQueryValue(query.stdout) : null;
    if (hasHighPerformancePref(currentValue)) {
      return { status: "already-set", changed: false, exePath: normalizedExe, value: currentValue };
    }

    const nextValue = upsertHighPerformancePref(currentValue);
    const write = runReg([
      "add",
      USER_GPU_PREFS_KEY,
      "/v",
      normalizedExe,
      "/t",
      "REG_SZ",
      "/d",
      nextValue,
      "/f",
    ]);
    if (write.status !== 0) {
      return {
        status: "failed",
        changed: false,
        exePath: normalizedExe,
        reason: (write.stderr || write.stdout || `exit ${write.status}`).trim(),
      };
    }
    return { status: "updated", changed: true, exePath: normalizedExe, value: nextValue };
  } catch (err) {
    return {
      status: "failed",
      changed: false,
      exePath: normalizedExe,
      reason: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * Classify a Chromium `gpuDevice` entry as discrete, integrated, software, or unknown,
 * taking all devices in the system into account (for dual-GPU vendor disambiguation).
 * @param {object} device
 * @param {object[]} allDevices
 * @returns {"discrete" | "integrated" | "software" | "unknown"}
 */
function classifyGpuDevice(device, allDevices = []) {
  const vendorId = Number(device && device.vendorId);
  const desc = [device && device.description, device && device.driverVendor, device && device.renderer]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (vendorId === VENDOR_MICROSOFT || SOFTWARE_RE.test(desc)) {
    return "software";
  }
  if (vendorId === VENDOR_NVIDIA) {
    return "discrete";
  }
  if (vendorId === VENDOR_INTEL) {
    if (INTEL_DISCRETE_ARC_RE.test(desc)) return "discrete";
    return "integrated";
  }
  if (vendorId === VENDOR_QUALCOMM) {
    return "integrated";
  }
  if (vendorId === VENDOR_AMD) {
    if (AMD_DISCRETE_RE.test(desc)) return "discrete";
    if (AMD_INTEGRATED_RE.test(desc)) return "integrated";
    // Disambiguate when Chromium basic info omits descriptions:
    const otherVendors = new Set(allDevices.map((d) => Number(d && d.vendorId)).filter((v) => v !== VENDOR_MICROSOFT));
    if (otherVendors.has(VENDOR_NVIDIA)) return "integrated"; // Ryzen APU paired with NVIDIA dGPU
    if (otherVendors.has(VENDOR_INTEL)) return "discrete"; // Intel CPU iGPU paired with AMD dGPU
    return "unknown";
  }
  return "unknown";
}

/**
 * Analyze Chromium's `app.getGPUInfo("basic")` (or `"complete"`) payload.
 * @param {any} gpuInfo
 */
function analyzeGpuSelection(gpuInfo) {
  const rawDevices = Array.isArray(gpuInfo && gpuInfo.gpuDevice) ? gpuInfo.gpuDevice : [];
  const devices = rawDevices.map((dev) => {
    const vendorId = Number(dev && dev.vendorId) || 0;
    const deviceId = Number(dev && dev.deviceId) || 0;
    const role = classifyGpuDevice(dev, rawDevices);
    const vName = vendorName(vendorId);
    const desc = typeof dev.description === "string" && dev.description.trim() ? dev.description.trim() : null;
    const hexId = deviceId ? `0x${deviceId.toString(16).padStart(4, "0")}` : "";
    const label = desc || `${vName} GPU${hexId ? ` (${hexId})` : ""}`;
    return {
      vendorId,
      deviceId,
      active: Boolean(dev && dev.active),
      role,
      label,
    };
  });

  const activeDevice = devices.find((d) => d.active) || devices[0] || null;
  const discreteDevices = devices.filter((d) => d.role === "discrete");
  const hasDiscrete = discreteDevices.length > 0;
  const usingDiscrete = Boolean(activeDevice && activeDevice.role === "discrete");
  const shouldRelaunchForDiscrete = Boolean(
    hasDiscrete && activeDevice && (activeDevice.role === "integrated" || activeDevice.role === "software"),
  );

  return {
    devices,
    activeDevice,
    discreteDevices,
    hasDiscrete,
    usingDiscrete,
    shouldRelaunchForDiscrete,
  };
}

/**
 * Build a readable summary of detected GPUs for CLI `--gpu-info` and the View menu dialog.
 * @param {any} gpuInfo
 * @param {{ webglRenderer?: string | null, regStatus?: string | null, exePath?: string | null }} [extra]
 * @returns {string}
 */
function formatGpuSummary(gpuInfo, extra = {}) {
  const analysis = analyzeGpuSelection(gpuInfo);
  const lines = [];
  if (extra.webglRenderer) {
    lines.push(`Active WebGL Renderer: ${extra.webglRenderer}`);
  }
  if (analysis.activeDevice) {
    lines.push(`Active Adapter: ${analysis.activeDevice.label} [${analysis.activeDevice.role}]`);
  }
  if (analysis.devices.length > 0) {
    lines.push("Detected Adapters:");
    for (const d of analysis.devices) {
      lines.push(`  ${d.active ? "*" : "-"} ${d.label} [${d.role}]`);
    }
  } else {
    lines.push("Detected Adapters: (none reported by Chromium)");
  }
  if (extra.regStatus) {
    lines.push(`Windows High-Performance Preference: ${extra.regStatus}`);
  }
  if (extra.exePath) {
    lines.push(`Executable: ${extra.exePath}`);
  }
  return lines.join("\n");
}

module.exports = {
  USER_GPU_PREFS_KEY,
  HIGH_PERFORMANCE_PREF,
  VENDOR_NVIDIA,
  VENDOR_AMD,
  VENDOR_INTEL,
  VENDOR_MICROSOFT,
  upsertHighPerformancePref,
  parseRegQueryValue,
  hasHighPerformancePref,
  ensureWindowsHighPerformanceGpu,
  classifyGpuDevice,
  analyzeGpuSelection,
  formatGpuSummary,
};
