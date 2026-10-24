@echo off
rem Stop the TN Traffic Intelligence background processes started by launch_tn.bat.
echo [TN] stopping API and worker...
set "APPDIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:APPDIR; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and ($_.CommandLine -match 'app.desktop|uvicorn|app.workers.runner') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo [TN] services stopped. Your Dataset / Experiment / Evaluation records stay in data\tn_traffic.db
