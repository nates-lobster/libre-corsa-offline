"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, screen, session } = require("electron");
const { startLocalServer } = require("./local-server");
const { decideNavigation, isAllowedNetworkRequest } = require("./nav-policy");
const { isAllowedHidDevice, isAllowedOrigin, pickPreferredHidDevice } = require("./hid-policy");
const {
  analyzeGpuSelection,
  ensureWindowsHighPerformanceGpu,
  formatGpuSummary,
} = require("./windows-gpu");

const ALLOWED_PERMISSIONS = new Set([
  "hid",
  "fullscreen",
  "pointerLock",
  "clipboard-sanitized-write",
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {{ origin: string, playUrl: string, close: () => Promise<void> } | null} */
let localServer = null;

const noGpuPref = process.argv.includes("--no-gpu-pref") || process.env.LIBRECORSA_NO_GPU_PREF === "1";
const noGpuOverrides = process.env.LIBRECORSA_NO_GPU_OVERRIDES === "1";
const printGpuInfoOnly = process.argv.includes("--gpu-info");

// On Windows 10/11 hybrid GPU laptops (Intel/AMD iGPU + NVIDIA/AMD/Arc dGPU),
// ensure HKCU\Software\Microsoft\DirectX\UserGpuPreferences assigns High Performance (2)
// to this Electron binary (no administrator privileges required).
const winGpuPrefResult =
  process.platform === "win32" && !noGpuPref
    ? ensureWindowsHighPerformanceGpu(process.execPath)
    : { status: "skipped", changed: false, exePath: process.execPath };

// Prefer discrete GPU & smooth hardware WebGL2 rendering across Windows, Linux, and macOS.
if (!noGpuOverrides) {
  app.commandLine.appendSwitch("force_high_performance_gpu");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");

  if (process.platform === "win32") {
    // ANGLE D3D11 honors DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE + Windows UserGpuPreferences.
    app.commandLine.appendSwitch("use-angle", process.env.LIBRECORSA_ANGLE || "d3d11");
  } else if (process.platform === "linux") {
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    app.commandLine.appendSwitch("enable-zero-copy");
  }
} else if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

if (process.platform === "win32") {
  app.setAppUserModelId("org.librecorsa.offline");
}

const gotSingleInstanceLock = printGpuInfoOnly ? true : app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function toggleFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

async function queryLiveWebglRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    return await mainWindow.webContents.executeJavaScript(
      `(() => {
        try {
          const cached = window.localStorage && window.localStorage.getItem("bugesera.gpu");
          if (cached) return cached;
          const c = document.createElement("canvas");
          const gl = c.getContext("webgl2", { powerPreference: "high-performance" }) || c.getContext("webgl", { powerPreference: "high-performance" });
          if (!gl) return null;
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          const name = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
          const lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
          return typeof name === "string" ? name : null;
        } catch { return null; }
      })()`,
      true,
    );
  } catch {
    return null;
  }
}

async function showActiveGpuDialog() {
  const gpuInfo = await app.getGPUInfo("basic").catch(() => null);
  const webglRenderer = await queryLiveWebglRenderer();
  const analysis = analyzeGpuSelection(gpuInfo);
  const summary = formatGpuSummary(gpuInfo, {
    webglRenderer,
    regStatus: process.platform === "win32" ? winGpuPrefResult.status : null,
    exePath: process.platform === "win32" ? process.execPath : null,
  });

  const canRelaunchDiscrete =
    process.platform === "win32" && analysis.shouldRelaunchForDiscrete;
  const buttons = canRelaunchDiscrete
    ? ["Relaunch on High-Performance GPU", "OK"]
    : ["OK"];

  const res = await dialog.showMessageBox(mainWindow || undefined, {
    type: canRelaunchDiscrete ? "warning" : "info",
    title: "LibreCorsa Offline — Active GPU",
    message: analysis.usingDiscrete
      ? "Running on Discrete High-Performance GPU"
      : analysis.shouldRelaunchForDiscrete
        ? "Integrated GPU is Active (Discrete GPU Detected)"
        : "Graphics Adapter Information",
    detail: summary,
    buttons,
    defaultId: 0,
  });

  if (canRelaunchDiscrete && res.response === 0) {
    ensureWindowsHighPerformanceGpu(process.execPath);
    const relaunchArgs = process.argv.slice(1).filter((a) => a !== "--gpu-relaunch-done");
    relaunchArgs.push("--gpu-relaunch-done");
    app.relaunch({ args: relaunchArgs });
    app.exit(0);
  }
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Fullscreen",
          accelerator: "F11",
          registerAccelerator: false,
          click: () => toggleFullscreen(),
        },
        ...(isMac ? [{ role: "togglefullscreen" }] : []),
        { type: "separator" },
        {
          label: "Home Hub",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed() && localServer) {
              void mainWindow.loadURL(`${localServer.origin}/`);
            }
          },
        },
        {
          label: "Simulator",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed() && localServer) {
              void mainWindow.loadURL(localServer.playUrl);
            }
          },
        },
        { type: "separator" },
        {
          label: "Active GPU Info...",
          click: () => {
            void showActiveGpuDialog();
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
      ],
    },
    ...(isMac
      ? [
          {
            label: "Window",
            submenu: [{ role: "minimize" }, { role: "close" }],
          },
        ]
      : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Configure strict air-gapped network firewall + silent WebHID grants for DualSense and racing wheels.
 * @param {Electron.Session} ses
 * @param {string} allowedOrigin
 */
function configureSessionSecurity(ses, allowedOrigin) {
  // Hard Chromium-level egress firewall: cancels every outbound request to non-loopback hosts.
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedNetworkRequest(details.url, allowedOrigin) });
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const origin = (details && details.securityOrigin) || requestingOrigin;
    return (
      !(details && details.embeddingOrigin) &&
      isAllowedOrigin(origin, allowedOrigin) &&
      ALLOWED_PERMISSIONS.has(permission)
    );
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || (webContents && webContents.getURL()) || "";
    const isMainFrame = !details || details.isMainFrame !== false;
    callback(isMainFrame && isAllowedOrigin(origin, allowedOrigin) && ALLOWED_PERMISSIONS.has(permission));
  });

  ses.setDevicePermissionHandler((details) => {
    return (
      details.deviceType === "hid" &&
      isAllowedOrigin(details.origin, allowedOrigin) &&
      isAllowedHidDevice(details.device)
    );
  });

  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const frameUrl = details.frame ? details.frame.url : "";
    const chosen = pickPreferredHidDevice(details.deviceList, frameUrl, allowedOrigin);
    callback(chosen ? chosen.deviceId : undefined);
  });
}

/**
 * Lock down navigation and popups to the local loopback server only.
 * @param {Electron.WebContents} contents
 * @param {string} allowedOrigin
 */
function attachNavigationGuards(contents, allowedOrigin) {
  const guardNavigation = (event, url) => {
    const { allowInApp } = decideNavigation(url, allowedOrigin);
    if (!allowInApp) {
      event.preventDefault();
    }
  };

  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);

  contents.setWindowOpenHandler(({ url }) => {
    const { allowInApp } = decideNavigation(url, allowedOrigin);
    if (allowInApp && mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(url);
    }
    return { action: "deny" };
  });
}

function findWindowIcon() {
  const candidates =
    process.platform === "win32"
      ? [
          path.resolve(__dirname, "..", "build", "icon.ico"),
          path.resolve(__dirname, "..", "build", "icon.png"),
        ]
      : [
          path.resolve(__dirname, "..", "build", "icon.png"),
          "/usr/share/icons/hicolor/512x512/apps/librecorsa-offline.png",
        ];
  return candidates.find((p) => fs.existsSync(p));
}

function createMainWindow(startUrl) {
  const { width: workW, height: workH } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1920, Math.max(1024, Math.round(workW * 0.92)));
  const height = Math.min(1080, Math.max(640, Math.round(workH * 0.92)));
  const startFullscreen = process.argv.includes("--fullscreen");

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 540,
    fullscreen: startFullscreen,
    title: "LibreCorsa Offline",
    icon: findWindowIcon(),
    backgroundColor: "#08090D",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "F11" &&
      !input.isAutoRepeat &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift
    ) {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = win;
  void win.loadURL(startUrl);
}

app.on("web-contents-created", (_event, contents) => {
  if (localServer) attachNavigationGuards(contents, localServer.origin);
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("before-quit", () => {
  if (localServer) {
    void localServer.close();
    localServer = null;
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  const gpuInfo = await app.getGPUInfo("basic").catch(() => null);
  const gpuAnalysis = analyzeGpuSelection(gpuInfo);

  if (printGpuInfoOnly) {
    console.log(
      formatGpuSummary(gpuInfo, {
        regStatus: process.platform === "win32" ? winGpuPrefResult.status : "n/a",
        exePath: process.execPath,
      }),
    );
    app.exit(0);
    return;
  }

  // If launched directly on Windows (without scripts/run-desktop.mjs) and we just registered
  // High Performance GPU preference while Windows started this first process on an integrated GPU,
  // relaunch once so DXGI immediately assigns the discrete GPU.
  if (
    process.platform === "win32" &&
    !noGpuPref &&
    winGpuPrefResult.changed &&
    gpuAnalysis.shouldRelaunchForDiscrete &&
    !process.argv.includes("--gpu-relaunch-done")
  ) {
    console.log(
      "[librecorsa-offline] Registered Windows High-Performance GPU preference; relaunching on discrete GPU...",
    );
    app.relaunch({ args: [...process.argv.slice(1), "--gpu-relaunch-done"] });
    app.exit(0);
    return;
  }

  if (gpuAnalysis.activeDevice) {
    console.log(
      `[librecorsa-offline] Active GPU: ${gpuAnalysis.activeDevice.label} (${gpuAnalysis.activeDevice.role})`,
    );
  }

  localServer = await startLocalServer();
  const startUrl = process.argv.includes("--hub") ? `${localServer.origin}/` : localServer.playUrl;

  buildAppMenu();
  configureSessionSecurity(session.defaultSession, localServer.origin);
  createMainWindow(startUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && localServer) {
      createMainWindow(startUrl);
    }
  });
}).catch((err) => {
  console.error("[librecorsa-offline] Failed to start:", err && err.message ? err.message : err);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
