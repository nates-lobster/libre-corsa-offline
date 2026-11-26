<#
.SYNOPSIS
  Builds (if needed) and launches LibreCorsa Offline Desktop on Windows using the discrete GPU.
#>
[CmdletBinding()]
param(
  [switch]$Fullscreen,
  [switch]$Hub,
  [switch]$GpuInfo,
  [switch]$NoGpuPref,
  [ValidateSet("", "d3d11", "vulkan", "gl")]
  [string]$Angle = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[LibreCorsa Offline] Node.js 20+ is required." -ForegroundColor Red
  Write-Host "Install Node.js LTS from https://nodejs.org/ (or via: winget install OpenJS.NodeJS.LTS)" -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
  Write-Host "[LibreCorsa Offline] Installing build dependencies..." -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $GpuInfo -and -not (Test-Path (Join-Path $RepoRoot "out\index.html"))) {
  Write-Host "[LibreCorsa Offline] Building offline bundle..." -ForegroundColor Cyan
  & npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$electronPkg = Join-Path $RepoRoot "desktop\node_modules\electron"
if (-not (Test-Path $electronPkg)) {
  Write-Host "[LibreCorsa Offline] Installing local Electron desktop runtime (one-time)..." -ForegroundColor Cyan
  & npm run desktop:setup
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($Angle) {
  $env:LIBRECORSA_ANGLE = $Angle
}
if ($NoGpuPref) {
  $env:LIBRECORSA_NO_GPU_PREF = "1"
}

$launchArgs = [System.Collections.Generic.List[string]]::new()
$launchArgs.Add("scripts/run-desktop.mjs")
if ($Fullscreen) { $launchArgs.Add("--fullscreen") }
if ($Hub) { $launchArgs.Add("--hub") }
if ($GpuInfo) { $launchArgs.Add("--gpu-info") }
if ($NoGpuPref) { $launchArgs.Add("--no-gpu-pref") }

& node @launchArgs
exit $LASTEXITCODE
