@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-high-performance-gpu.ps1" %*
if errorlevel 1 pause
