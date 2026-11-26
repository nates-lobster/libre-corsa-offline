<#
.SYNOPSIS
  Configures Windows 10/11 High-Performance (discrete) GPU preference for LibreCorsa Offline
  (and optionally installed web browsers) without requiring Administrator privileges.

.DESCRIPTION
  Writes `GpuPreference=2;` into:
    HKCU:\Software\Microsoft\DirectX\UserGpuPreferences
  This is the exact per-app Graphics Preference used by Windows 10/11 Settings
  (System -> Display -> Graphics -> High performance) on hybrid laptops with both an
  integrated GPU (Intel / AMD APU) and a discrete GPU (NVIDIA / AMD Radeon / Intel Arc).

.PARAMETER IncludeBrowsers
  Also configure installed Chromium/Firefox browsers (Chrome, Edge, Brave, Vivaldi, Firefox)
  to prefer the discrete GPU when running LibreCorsa Offline in browser/PWA mode.

.PARAMETER Reset
  Remove the High-Performance GPU preference entries for the matched executables.

.PARAMETER Check
  Print detected GPUs and current preference status without modifying the registry.

.PARAMETER ExtraExe
  Additional executable path(s) to configure.
#>
[CmdletBinding()]
param(
  [switch]$IncludeBrowsers,
  [switch]$Reset,
  [switch]$Check,
  [string[]]$ExtraExe = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RegPath = "HKCU:\Software\Microsoft\DirectX\UserGpuPreferences"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Show-DetectedGpus {
  Write-Host "Detected Windows GPU adapters:" -ForegroundColor Cyan
  try {
    $adapters = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop
    foreach ($gpu in $adapters) {
      $vramGb = if ($gpu.AdapterRAM -and $gpu.AdapterRAM -gt 0) {
        "{0:N1} GB" -f ($gpu.AdapterRAM / 1GB)
      } else {
        "n/a"
      }
      Write-Host ("  - {0} (Driver {1}, VRAM {2})" -f $gpu.Name, $gpu.DriverVersion, $vramGb)
    }
  } catch {
    Write-Host "  (Could not query Win32_VideoController: $($_.Exception.Message))" -ForegroundColor Yellow
  }
  Write-Host ""
}

function Upsert-HighPerfValue([string]$Existing) {
  if ([string]::IsNullOrWhiteSpace($Existing)) {
    return "GpuPreference=2;"
  }
  $parts = @($Existing.Split(";") | ForEach-Object { $_.Trim() } | Where-Object { $_ -and ($_ -notmatch "^GpuPreference=") })
  $parts += "GpuPreference=2"
  return ($parts -join ";") + ";"
}

function Find-TargetExecutables {
  $targets = [System.Collections.Generic.List[string]]::new()

  # 1. Local Electron binary in desktop/node_modules/electron
  $electronPkg = Join-Path $RepoRoot "desktop\node_modules\electron"
  $pathTxt = Join-Path $electronPkg "path.txt"
  if (Test-Path $pathTxt) {
    $rel = (Get-Content -Raw $pathTxt).Trim()
    $resolved = Join-Path $electronPkg $rel
    if (Test-Path $resolved) {
      $targets.Add((Resolve-Path $resolved).Path)
    }
  }
  $fallbackElectron = Join-Path $electronPkg "dist\electron.exe"
  if ((Test-Path $fallbackElectron) -and (-not $targets.Contains((Resolve-Path $fallbackElectron).Path))) {
    $targets.Add((Resolve-Path $fallbackElectron).Path)
  }

  # 2. Packaged desktop executable if present
  $distDir = Join-Path $RepoRoot "desktop\dist"
  if (Test-Path $distDir) {
    Get-ChildItem -Path $distDir -Filter "*LibreCorsa*.exe" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $targets.Add($_.FullName)
    }
  }

  # 3. Optional browsers for browser/PWA mode
  if ($IncludeBrowsers) {
    $pf = $env:ProgramFiles
    $pfx86 = ${env:ProgramFiles(x86)}
    $localApp = $env:LOCALAPPDATA
    $browserCandidates = @(
      (Join-Path $pf "Google\Chrome\Application\chrome.exe"),
      (Join-Path $pfx86 "Google\Chrome\Application\chrome.exe"),
      (Join-Path $localApp "Google\Chrome\Application\chrome.exe"),
      (Join-Path $pfx86 "Microsoft\Edge\Application\msedge.exe"),
      (Join-Path $pf "Microsoft\Edge\Application\msedge.exe"),
      (Join-Path $pf "BraveSoftware\Brave-Browser\Application\brave.exe"),
      (Join-Path $localApp "BraveSoftware\Brave-Browser\Application\brave.exe"),
      (Join-Path $localApp "Vivaldi\Application\vivaldi.exe"),
      (Join-Path $pf "Mozilla Firefox\firefox.exe"),
      (Join-Path $pfx86 "Mozilla Firefox\firefox.exe")
    )
    foreach ($b in $browserCandidates) {
      if ($b -and (Test-Path $b)) {
        $targets.Add((Resolve-Path $b).Path)
      }
    }
  }

  # 4. Any user-supplied executables
  foreach ($extra in $ExtraExe) {
    if ($extra -and (Test-Path $extra)) {
      $targets.Add((Resolve-Path $extra).Path)
    }
  }

  return @($targets | Select-Object -Unique)
}

Show-DetectedGpus
$exes = Find-TargetExecutables

if ($exes.Count -eq 0) {
  Write-Host "No LibreCorsa Offline Electron executable found yet." -ForegroundColor Yellow
  Write-Host "Run 'npm run desktop:setup' (or double-click windows\play-desktop.bat) first," -ForegroundColor Yellow
  Write-Host "or re-run this script with -IncludeBrowsers to configure Chrome/Edge/Brave/Firefox." -ForegroundColor Yellow
  exit 0
}

if (-not $Check -and -not (Test-Path $RegPath)) {
  New-Item -Path $RegPath -Force | Out-Null
}

foreach ($exe in $exes) {
  $existing = $null
  if (Test-Path $RegPath) {
    $props = Get-ItemProperty -Path $RegPath -ErrorAction SilentlyContinue
    if ($props -and ($props.PSObject.Properties.Name -contains $exe)) {
      $existing = [string]$props.$exe
    }
  }

  if ($Check) {
    $state = if ($existing) { $existing } else { "(default - Let Windows decide)" }
    Write-Host ("  [CHECK] {0}`n          -> {1}" -f $exe, $state)
    continue
  }

  if ($Reset) {
    if ($null -ne $existing) {
      Remove-ItemProperty -Path $RegPath -Name $exe -ErrorAction SilentlyContinue
      Write-Host ("  [RESET] {0}" -f $exe) -ForegroundColor Yellow
    } else {
      Write-Host ("  [SKIP]  {0} (no custom preference set)" -f $exe)
    }
    continue
  }

  $nextVal = Upsert-HighPerfValue $existing
  if ($existing -eq $nextVal) {
    Write-Host ("  [OK]    {0} (already High Performance)" -f $exe) -ForegroundColor Green
  } else {
    New-ItemProperty -Path $RegPath -Name $exe -PropertyType String -Value $nextVal -Force | Out-Null
    Write-Host ("  [SET]   {0}`n          -> {1}" -f $exe, $nextVal) -ForegroundColor Green
  }
}

if (-not $Check -and -not $Reset) {
  Write-Host ""
  Write-Host "Done. Restart LibreCorsa Offline (or your browser if -IncludeBrowsers was used) for Windows to assign the discrete GPU." -ForegroundColor Cyan
}
