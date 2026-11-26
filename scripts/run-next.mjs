#!/usr/bin/env node
/**
 * Cross-platform Next.js CLI runner (Windows cmd/PowerShell, Linux, macOS).
 * Disables Next.js telemetry in process.env without relying on POSIX-only
 * inline `VAR=1 cmd` shell syntax.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
