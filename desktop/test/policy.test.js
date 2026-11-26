"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isAllowedAppUrl,
  isAllowedNetworkRequest,
  decideNavigation,
} = require("../src/nav-policy");
const {
  isAllowedOrigin,
  isAllowedHidDevice,
  pickPreferredHidDevice,
} = require("../src/hid-policy");
const {
  OFFLINE_CSP,
  resolveStaticFile,
  startLocalServer,
} = require("../src/local-server");
const {
  USER_GPU_PREFS_KEY,
  upsertHighPerformancePref,
  parseRegQueryValue,
  hasHighPerformancePref,
  ensureWindowsHighPerformanceGpu,
  classifyGpuDevice,
  analyzeGpuSelection,
  formatGpuSummary,
} = require("../src/windows-gpu");

const ORIGIN = "http://127.0.0.1:41234";

describe("nav-policy (strict air-gapped offline)", () => {
  it("allows in-app navigation only on the active loopback origin", () => {
    assert.deepEqual(decideNavigation(`${ORIGIN}/play`, ORIGIN), {
      allowInApp: true,
      openExternal: false,
    });
    assert.deepEqual(decideNavigation(`${ORIGIN}/?track=rwanda_official`, ORIGIN), {
      allowInApp: true,
      openExternal: false,
    });
    assert.equal(isAllowedAppUrl(`${ORIGIN}/about`, ORIGIN), true);
    assert.equal(isAllowedAppUrl("http://127.0.0.1:9999/play", ORIGIN), false);
    assert.equal(isAllowedAppUrl("https://librecorsa.org/play", ORIGIN), false);
  });

  it("blocks all external URLs and dangerous schemes completely", () => {
    for (const url of [
      "https://librecorsa.org/play",
      "https://github.com/librecorsa/librecorsa",
      "http://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "smb://192.168.1.2/share",
      "data:text/html,hi",
      "",
      null,
      undefined,
      "not a url",
    ]) {
      assert.deepEqual(decideNavigation(url, ORIGIN), {
        allowInApp: false,
        openExternal: false,
      });
    }
  });

  it("enforces Chromium egress firewall via isAllowedNetworkRequest", () => {
    assert.equal(isAllowedNetworkRequest(`${ORIGIN}/play`, ORIGIN), true);
    assert.equal(isAllowedNetworkRequest(`${ORIGIN}/lc26/lc26.glb`, ORIGIN), true);
    assert.equal(isAllowedNetworkRequest(`blob:${ORIGIN}/abc-123`, ORIGIN), true);
    assert.equal(isAllowedNetworkRequest("data:image/png;base64,AAAA", ORIGIN), true);
    assert.equal(isAllowedNetworkRequest("ws://127.0.0.1:47821", ORIGIN), true);
    assert.equal(isAllowedNetworkRequest("ws://localhost:47821", ORIGIN), true);

    assert.equal(isAllowedNetworkRequest("https://librecorsa.org/api/board", ORIGIN), false);
    assert.equal(isAllowedNetworkRequest("https://fonts.googleapis.com/css", ORIGIN), false);
    assert.equal(isAllowedNetworkRequest("wss://relay.librecorsa.org", ORIGIN), false);
    assert.equal(isAllowedNetworkRequest("http://127.0.0.1:9999/other", ORIGIN), false);
    assert.equal(isAllowedNetworkRequest("blob:https://evil.com/abc", ORIGIN), false);
    assert.equal(isAllowedNetworkRequest("file:///etc/hosts", ORIGIN), false);
  });
});

describe("hid-policy (loopback origin + wheels & controllers)", () => {
  it("validates exact loopback origin", () => {
    assert.equal(isAllowedOrigin(ORIGIN, ORIGIN), true);
    assert.equal(isAllowedOrigin(`${ORIGIN}/play`, ORIGIN), true);
    assert.equal(isAllowedOrigin("https://librecorsa.org/play", ORIGIN), false);
    assert.equal(isAllowedOrigin("http://127.0.0.1:9999/play", ORIGIN), false);
    assert.equal(isAllowedOrigin("", ORIGIN), false);
    assert.equal(isAllowedOrigin(null, ORIGIN), false);
  });

  it("allows DualSense, DualSense Edge, DualShock 4, wheels, and PID devices", () => {
    assert.equal(
      isAllowedHidDevice({
        vendorId: 0x054c,
        productId: 0x0ce6,
        collections: [{ usagePage: 0x01, usage: 0x05 }],
      }),
      true,
    );
    assert.equal(
      isAllowedHidDevice({
        vendorId: 0x054c,
        productId: 0x09cc,
        collections: [],
      }),
      true,
    );
    assert.equal(
      isAllowedHidDevice({
        vendorId: 0x044f,
        productId: 0xb66e,
        collections: [],
      }),
      true,
    );
    assert.equal(
      isAllowedHidDevice({
        vendorId: 0x346e,
        productId: 0x0002,
        collections: [{ usagePage: 0x01, usage: 0x04, children: [{ usagePage: 0x0f, usage: 0x01 }] }],
      }),
      true,
    );
  });

  it("rejects keyboards, mice, headsets, and security keys", () => {
    assert.equal(
      isAllowedHidDevice({
        vendorId: 0x046d,
        productId: 0xc52b,
        collections: [{ usagePage: 0x01, usage: 0x02 }, { usagePage: 0x01, usage: 0x06 }],
      }),
      false,
    );
    assert.equal(
      isAllowedHidDevice({
        vendorId: 0x1050,
        productId: 0x0407,
        collections: [{ usagePage: 0xf1d0, usage: 0x01 }],
      }),
      false,
    );
    assert.equal(isAllowedHidDevice(null), false);
  });

  it("prefers FFB-capable wheel interface on loopback origin and refuses unauthorized origins", () => {
    const g920InputOnly = {
      deviceId: "g920-in",
      vendorId: 0x046d,
      productId: 0xc262,
      collections: [{ usagePage: 0x01, usage: 0x04, outputReports: [] }],
    };
    const g920Hidpp = {
      deviceId: "g920-hidpp",
      vendorId: 0x046d,
      productId: 0xc262,
      collections: [{ usagePage: 0xff00, usage: 0x01, outputReports: [{ reportId: 0x11 }] }],
    };
    const chosen = pickPreferredHidDevice([g920InputOnly, g920Hidpp], `${ORIGIN}/play`, ORIGIN);
    assert.equal(chosen && chosen.deviceId, "g920-hidpp");
    assert.equal(pickPreferredHidDevice([g920Hidpp], "https://librecorsa.org/play", ORIGIN), null);
  });
});

describe("local-server (loopback static hosting)", () => {
  it("serves clean routes, Range requests, CSP headers, and blocks path traversal", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lc-offline-srv-"));
    try {
      fs.writeFileSync(path.join(tmp, "index.html"), "<h1>Home</h1>");
      fs.writeFileSync(path.join(tmp, "play.html"), "<h1>Play</h1>");
      fs.writeFileSync(path.join(tmp, "sample.bin"), "0123456789");

      assert.equal(resolveStaticFile(tmp, "/../etc/passwd"), null);
      assert.ok(OFFLINE_CSP.includes("default-src 'self'"));

      const srv = await startLocalServer({ webDir: tmp, port: 0 });
      try {
        assert.ok(srv.origin.startsWith("http://127.0.0.1:"));

        const playRes = await fetch(srv.playUrl);
        assert.equal(playRes.status, 200);
        assert.equal(await playRes.text(), "<h1>Play</h1>");
        assert.equal(playRes.headers.get("content-security-policy"), OFFLINE_CSP);

        const rangeRes = await fetch(`${srv.origin}/sample.bin`, { headers: { Range: "bytes=2-5" } });
        assert.equal(rangeRes.status, 206);
        assert.equal(await rangeRes.text(), "2345");
        assert.equal(rangeRes.headers.get("content-range"), "bytes 2-5/10");

        const missRes = await fetch(`${srv.origin}/does-not-exist`);
        assert.equal(missRes.status, 404);
      } finally {
        await srv.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("windows-gpu (Windows discrete GPU preference & hybrid GPU detection)", () => {
  it("builds and parses DirectX UserGpuPreferences values while preserving existing flags", () => {
    assert.equal(upsertHighPerformancePref(null), "GpuPreference=2;");
    assert.equal(upsertHighPerformancePref(""), "GpuPreference=2;");
    assert.equal(upsertHighPerformancePref("GpuPreference=1;"), "GpuPreference=2;");
    assert.equal(
      upsertHighPerformancePref("SwapEffectUpgradeEnable=1;GpuPreference=1;AutoHDREnable=1;"),
      "SwapEffectUpgradeEnable=1;AutoHDREnable=1;GpuPreference=2;",
    );

    assert.equal(hasHighPerformancePref("GpuPreference=2;"), true);
    assert.equal(hasHighPerformancePref("SwapEffectUpgradeEnable=1;GpuPreference=2;"), true);
    assert.equal(hasHighPerformancePref("GpuPreference=1;"), false);
    assert.equal(hasHighPerformancePref(null), false);

    const sampleReg = [
      "",
      "HKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
      "    C:\\Apps\\LibreCorsa\\electron.exe    REG_SZ    SwapEffectUpgradeEnable=1;GpuPreference=2;",
      "",
    ].join("\r\n");
    assert.equal(parseRegQueryValue(sampleReg), "SwapEffectUpgradeEnable=1;GpuPreference=2;");
  });

  it("writes HKCU UserGpuPreferences on win32 when missing, skips when set or disabled", () => {
    const exe = "C:\\Users\\Alex\\libre-corsa-offline\\desktop\\node_modules\\electron\\dist\\electron.exe";

    // Skips on non-Windows
    assert.equal(ensureWindowsHighPerformanceGpu(exe, { platform: "linux", env: {} }).status, "skipped");
    // Skips when disabled by env
    assert.equal(
      ensureWindowsHighPerformanceGpu(exe, { platform: "win32", env: { LIBRECORSA_NO_GPU_PREF: "1" } }).status,
      "skipped",
    );
    // Skips non-.exe paths (e.g. .cmd wrapper)
    assert.equal(
      ensureWindowsHighPerformanceGpu("C:\\app\\electron.cmd", { platform: "win32", env: {} }).status,
      "skipped",
    );

    // Writes when query fails (key/value absent)
    const calls = [];
    const written = ensureWindowsHighPerformanceGpu(exe, {
      platform: "win32",
      env: {},
      runReg(args) {
        calls.push(args);
        if (args[0] === "query") return { status: 1, stdout: "", stderr: "ERROR: not found" };
        return { status: 0, stdout: "The operation completed successfully.", stderr: "" };
      },
    });
    assert.equal(written.status, "updated");
    assert.equal(written.changed, true);
    assert.equal(written.value, "GpuPreference=2;");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], [
      "add",
      USER_GPU_PREFS_KEY,
      "/v",
      exe,
      "/t",
      "REG_SZ",
      "/d",
      "GpuPreference=2;",
      "/f",
    ]);

    // No-op when already set to GpuPreference=2;
    const already = ensureWindowsHighPerformanceGpu(exe, {
      platform: "win32",
      env: {},
      runReg(args) {
        assert.equal(args[0], "query");
        return {
          status: 0,
          stdout: `    ${exe}    REG_SZ    GpuPreference=2;\r\n`,
          stderr: "",
        };
      },
    });
    assert.equal(already.status, "already-set");
    assert.equal(already.changed, false);

    // Fails gracefully if reg.exe fails
    const failed = ensureWindowsHighPerformanceGpu(exe, {
      platform: "win32",
      env: {},
      runReg(args) {
        if (args[0] === "query") return { status: 1, stdout: "", stderr: "" };
        return { status: 1, stdout: "", stderr: "Access is denied." };
      },
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.changed, false);
  });

  it("detects integrated vs discrete GPU combinations and triggers relaunch only when needed", () => {
    // Classic Intel UHD + NVIDIA Optimus laptop booted on Intel iGPU -> should relaunch
    const optimusOnIgpu = analyzeGpuSelection({
      gpuDevice: [
        { vendorId: 0x8086, deviceId: 0x9a49, active: true, description: "Intel(R) Iris(R) Xe Graphics" },
        { vendorId: 0x10de, deviceId: 0x28a0, active: false, description: "NVIDIA GeForce RTX 4060 Laptop GPU" },
      ],
    });
    assert.equal(optimusOnIgpu.hasDiscrete, true);
    assert.equal(optimusOnIgpu.usingDiscrete, false);
    assert.equal(optimusOnIgpu.shouldRelaunchForDiscrete, true);

    // Same laptop booted on NVIDIA dGPU -> usingDiscrete, no relaunch
    const optimusOnDgpu = analyzeGpuSelection({
      gpuDevice: [
        { vendorId: 0x8086, deviceId: 0x9a49, active: false },
        { vendorId: 0x10de, deviceId: 0x28a0, active: true },
      ],
    });
    assert.equal(optimusOnDgpu.hasDiscrete, true);
    assert.equal(optimusOnDgpu.usingDiscrete, true);
    assert.equal(optimusOnDgpu.shouldRelaunchForDiscrete, false);

    // AMD Ryzen APU + NVIDIA dGPU (without descriptions, Chromium basic info)
    const ryzenNvidia = analyzeGpuSelection({
      gpuDevice: [
        { vendorId: 0x1002, deviceId: 0x15bf, active: true },
        { vendorId: 0x10de, deviceId: 0x2520, active: false },
      ],
    });
    assert.equal(ryzenNvidia.activeDevice.role, "integrated");
    assert.equal(ryzenNvidia.shouldRelaunchForDiscrete, true);

    // Dual AMD Advantage laptop (Radeon 780M iGPU + Radeon RX 7700S dGPU)
    const amdAdvantage = analyzeGpuSelection({
      gpuDevice: [
        { vendorId: 0x1002, deviceId: 0x15bf, active: true, description: "AMD Radeon 780M Graphics" },
        { vendorId: 0x1002, deviceId: 0x7480, active: false, description: "AMD Radeon RX 7700S" },
      ],
    });
    assert.equal(amdAdvantage.activeDevice.role, "integrated");
    assert.equal(amdAdvantage.hasDiscrete, true);
    assert.equal(amdAdvantage.shouldRelaunchForDiscrete, true);

    // Dedicated Intel Arc A770 vs Core Ultra integrated Intel Arc
    assert.equal(
      classifyGpuDevice({ vendorId: 0x8086, description: "Intel(R) Arc(TM) A770 Graphics" }),
      "discrete",
    );
    assert.equal(
      classifyGpuDevice({ vendorId: 0x8086, description: "Intel(R) Arc(TM) Graphics" }),
      "integrated",
    );

    // Single integrated GPU laptop -> never relaunches
    const singleIgpu = analyzeGpuSelection({
      gpuDevice: [{ vendorId: 0x8086, deviceId: 0x5917, active: true, description: "Intel(R) UHD Graphics 620" }],
    });
    assert.equal(singleIgpu.hasDiscrete, false);
    assert.equal(singleIgpu.shouldRelaunchForDiscrete, false);

    const summary = formatGpuSummary(
      { gpuDevice: [{ vendorId: 0x10de, deviceId: 0x28a0, active: true, description: "NVIDIA GeForce RTX 4060" }] },
      { webglRenderer: "NVIDIA GeForce RTX 4060 Direct3D11", regStatus: "already-set" },
    );
    assert.ok(summary.includes("NVIDIA GeForce RTX 4060"));
    assert.ok(summary.includes("already-set"));
  });
});
