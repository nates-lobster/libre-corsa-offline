# LibreCorsa Offline

An air-gapped, **100% offline** adaptation of [LibreCorsa](https://github.com/librecorsa/librecorsa) designed to run locally in any modern browser (including installable offline PWA) or natively on **Windows** and **Arch Linux** via Electron — with **zero internet connection, zero remote APIs, zero telemetry, and zero external requests**.

## What Changed From Upstream

All online-only features were removed or replaced with strictly local equivalents while keeping the complete motorsport simulator intact:

- **Removed online dependencies**: Cloudflare Workers/R2 APIs, WebRTC/P2P multiplayer rooms, scheduled online races, online leaderboards, weekly challenge fetches, cloud accounts / WebAuthn passkeys, live player counters, usage pings, update checkers, press kit, and feedback/bug-report upload forms.
- **Kept 100% of the local simulator**:
  - 500 Hz fixed-timestep vehicle physics running in a dedicated Web Worker (9-node thermal/pressure tyre model, ground-effect aero, 2026 active aero & ERS, suspension, brake thermals, track evolution & wet/dry weather)
  - Bundled **2026 Formula Prototype (`LC26`)** + **RISE Motordrome** (Full & Short layouts) + full local Three.js PBR renderer, physically based atmosphere/clouds, local fonts (`next/font/local`), and procedural/sample-based WebAudio engine acoustics
  - Full **AI Races** (configurable field size, laps, standing/rolling starts, skill, damage, podium ceremony, local race history)
  - **Local Personal Best Laps & Ghost Racing** stored in IndexedDB with sector splits, theoretical best, JSON ghost export/import, setup sharing/recall, and built-in **Lap Telemetry Analysis**
  - **Replay & Flashback** mode, TV/Free/Onboard cameras, customizable HUD layouts (13 styles + live layout editor), and **12 full UI localizations**
  - **Keyboard, Mouse Steer, Gamepad, Touch Controls, WebXR VR, DualSense/DualShock 4 adaptive triggers, and WebHID Force Feedback Steering Wheels**
- **Added strict offline runtime**:
  - **Cache-First precaching Service Worker** (`scripts/generate-offline-sw.mjs` -> `out/sw.js`) that precaches every built HTML, JS, CSS, font, GLB, track, audio, and Basis KTX2 WASM file so the app runs offline in a browser even after closing the local server
  - **Zero-dependency local HTTP server** (`scripts/serve-offline.mjs`) with air-gapped Content-Security-Policy headers, Range support, and clean routes
  - **Air-gapped native desktop shell** (`desktop/`) for **Windows, Arch Linux, and macOS** with a Chromium-level egress firewall (`session.webRequest.onBeforeRequest`) blocking all non-loopback traffic, automatic WebHID grants for wheels & controllers, Linux Wayland/X11 GPU flags, and **automatic Windows discrete GPU selection** on dual-GPU laptops
  - **Windows one-click launchers & GPU utility** (`windows/play-desktop.bat`, `windows/play-browser.bat`, `windows/set-high-performance-gpu.ps1`)
  - **Arch Linux packaging** (`arch/PKGBUILD`, launcher, `.desktop` entry, and WebHID `udev` rules)

> **Why not a Rust rewrite?** Upstream LibreCorsa is ~200,000 lines of verified TypeScript implementing a 500 Hz Web Worker physics solver, Three.js atmosphere/clouds/PBR, custom WebAudio synthesis, 13 HUD layouts, 12 translations, WebHID FFB/DualSense protocols, and 120 automated physics/graphics test suites. Keeping the validated engine and wrapping it in an air-gapped static PWA + native Arch system-Electron shell delivers immediate smooth 60–144+ Hz hardware-accelerated performance with full fidelity and zero regressions.

---

## Option 1: Run Offline in Browser (or Install as Offline PWA)

Requirements: **Node.js 20+** and **npm** (only needed once to build `out/`).

```bash
# 1. Install build dependencies (while online once)
npm install

# 2. Build the static offline export + Cache-First precache Service Worker
npm run build

# 3. Serve locally on 127.0.0.1:18420 and open the simulator
npm run play
# Or without auto-opening a browser:
npm run serve
```

Then open `http://127.0.0.1:18420/play` (or `http://127.0.0.1:18420/` for the Home Hub).

- **True offline browser mode**: Once opened once in Chromium/Brave/Edge/Firefox, the generated `sw.js` precaches the entire simulator (~39 MB). You can click **Install app** from the title bar (Chromium browsers) and launch LibreCorsa Offline anytime — even with Wi-Fi off and the local server stopped.
- **Custom host/port**: `node scripts/serve-offline.mjs --host 0.0.0.0 --port 8080`

---

## Option 2: Run on Windows (with Automatic Discrete GPU Support)

Requirements: **Node.js 20+ LTS** (`winget install OpenJS.NodeJS.LTS` or from [nodejs.org](https://nodejs.org/)).

### Recommended: Native Air-Gapped Desktop App (Automatic Discrete GPU)

Double-click **`windows\play-desktop.bat`** in File Explorer, or run from PowerShell / Command Prompt:

```powershell
npm install
npm run build
npm run desktop:setup
npm run desktop
```

Optional flags: `npm run desktop -- --fullscreen`, `npm run desktop -- --hub`, or `npm run desktop:gpu` to print the active GPU adapter.

### How Discrete GPU Selection Works on Windows Dual-GPU Laptops

On Windows 10/11 laptops with both an integrated GPU (Intel UHD/Iris/Core Ultra or AMD Ryzen APU) and a discrete GPU (NVIDIA GeForce/RTX, AMD Radeon RX, or Intel Arc), LibreCorsa Offline enforces the discrete GPU across **three layers**:

1. **Windows Per-App Graphics Preference (no Admin required)**: Before launching `electron.exe`, `scripts/run-desktop.mjs` (and `desktop/src/main.js` if launched directly) registers `GpuPreference=2;` (**High performance**) in `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` for the exact `electron.exe` path. If launched directly and Windows booted the first process on an integrated GPU while a discrete GPU is present, the app registers the preference and performs a one-time relaunch onto the discrete GPU.
2. **Chromium / ANGLE DXGI Preference**: Launches with `--force_high_performance_gpu`, `--use-angle=d3d11`, `--enable-gpu-rasterization`, and `--ignore-gpu-blocklist` (override ANGLE with `LIBRECORSA_ANGLE=vulkan` or opt out with `LIBRECORSA_NO_GPU_OVERRIDES=1` / `LIBRECORSA_NO_GPU_PREF=1`).
3. **WebGL2 High-Performance Context**: Both the Three.js renderer and GPU probe explicitly request `{ powerPreference: "high-performance" }`.

To verify which GPU is active at any time inside the desktop app, press `Alt` -> **View -> Active GPU Info...** (or run `npm run desktop:gpu`).

### Running in a Windows Browser (Chrome / Edge / Brave / Firefox)

Double-click **`windows\play-browser.bat`** (or run `npm install && npm run build && npm run play`).

Because Windows 10/11 defaults web browsers to the integrated GPU on dual-GPU laptops, you can configure your browser(s) for High Performance GPU without Admin rights by running:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\set-high-performance-gpu.ps1 -IncludeBrowsers
```

Use `-Check` to inspect current GPU preferences or `-Reset` to restore Windows defaults.

---

## Option 3: Run Natively on Arch Linux

### Quick run from checkout (uses system `electron`)

```bash
sudo pacman -S nodejs npm electron
npm install
npm run build
npm run desktop
```

Pass `--fullscreen` to start fullscreen or `--hub` to open the Home Hub instead of going straight to `/play`.

### Install as a native Arch Linux package (`PKGBUILD`)

Building via `makepkg` installs the air-gapped desktop app using your system `electron` (no duplicate 200 MB Electron runtime), adds the application launcher, icon, `.desktop` entry, and WebHID steering wheel / DualSense `udev` rules:

```bash
sudo pacman -S --needed base-devel nodejs npm electron
cd arch
makepkg -si
```

Reload `udev` rules so Force Feedback wheels and DualSense/DualShock 4 controllers work over WebHID without root:

```bash
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then launch **LibreCorsa Offline** from your application launcher (Wayland/Hyprland/Sway/KDE/GNOME/X11) or run:

```bash
librecorsa-offline
librecorsa-offline --fullscreen
librecorsa-offline --hub
```

Optional Chromium/Electron flags can be placed one per line in `~/.config/librecorsa-offline-flags.conf`. If a GPU driver has issues with Chromium overrides, set `LIBRECORSA_NO_GPU_OVERRIDES=1`.

---

## Controls

| Action | Default Key |
| --- | --- |
| Throttle / Brake | `W` / `S` or `↑` / `↓` |
| Steer Left / Right | `A` / `D` or `←` / `→` |
| Shift Up / Down | `E` / `Q` (or automatic gearbox) |
| Active Aero / Boost | `Space` / `Shift` |
| Cycle Camera | `C` |
| Toggle Racing Line | `R` |
| Instant Replay / Flashback | `T` |
| Autopilot | `P` |
| Restart / Flying Lap | `Backspace` |
| Pause Menu | `Esc` |
| Fullscreen (Desktop) | `F11` |

All bindings, wheel axes/FFB gain, DualSense triggers, and HUD layouts can be configured inside **Settings** and are persisted locally on your device.

---

## Verification & Testing

```bash
# TypeScript check across app and scripts
npm run typecheck

# Strict offline invariants (zero remote URLs, offline config, local assets, CSP)
npx tsx scripts/verify-offline.ts

# Desktop air-gap egress firewall, WebHID policy, and loopback server tests
npm run desktop:test

# Build static export + generate precaching Service Worker
npm run build

# Full physics, audio, graphics, HUD, and i18n verification suite (~120 suites)
npm run verify
```

---

## License & Credits

- **Code** is licensed under the [GNU Affero General Public License v3.0](LICENSE) or any later version (`AGPL-3.0-or-later`).
- **3D models and audio** are for non-commercial, personal, and educational use; each retains its own license (see [CREDITS.md](CREDITS.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- **Upstream project**: adapted from [librecorsa/librecorsa](https://github.com/librecorsa/librecorsa).
- **Upstream code contributors**: thank you to [**adamikoo**](https://github.com/adamikoo) ([#162](https://github.com/librecorsa/librecorsa/pull/162), [#182](https://github.com/librecorsa/librecorsa/pull/182), [#192](https://github.com/librecorsa/librecorsa/pull/192)), [**dardalo-si**](https://github.com/dardalo-si) ([#17](https://github.com/librecorsa/librecorsa/pull/17)), and [**Ravi Giri**](https://github.com/Ravigiri2022) ([#130](https://github.com/librecorsa/librecorsa/pull/130)).
