# Install the built installer silently into a test directory, start the installed
# application, verify the API, then uninstall again (real installation evidence).
param(
    [string]$Target = "E:\codex\codex10.16\packaging\install-test"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $PSScriptRoot "dist\TN-Traffic-Intelligence-Setup-3.1.0.exe"
$logDir = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $installer)) { throw "installer not found: $installer" }
if (Test-Path $Target) {
    $resolved = (Resolve-Path -LiteralPath $Target).Path
    if ($resolved -notlike "$root*") { throw "refusing to delete outside the project: $resolved" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

Write-Host "[test] silent install into $Target"
Start-Process -FilePath $installer -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
    "/DIR=$Target", "/LOG=$(Join-Path $logDir 'install.log')" -Wait

$python = Join-Path $Target "python\python.exe"
if (-not (Test-Path $python)) { throw "installed python runtime missing" }
$db = Join-Path $Target "data\tn_traffic.db"
if (-not (Test-Path $db)) { throw "database was not initialised during install" }
Write-Host "[test] installed tree OK (python + database present)"
Get-ChildItem $Target | Select-Object Name | ForEach-Object { Write-Host "   $($_.Name)" }

Write-Host "[test] starting the installed application (API + worker)"
Start-Process -FilePath $python -ArgumentList "-m", "app.workers.runner" -WorkingDirectory $Target -WindowStyle Hidden
Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
    "--port", "8077" -WorkingDirectory $Target -WindowStyle Hidden

$env:PYTHONPATH = Join-Path $Target "backend"
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/health" -TimeoutSec 5
        $healthy = $true
        break
    } catch { }
}
if (-not $healthy) { throw "installed application did not answer on /api/health" }
Write-Host ("[test] installed app healthy: version {0}, db_ok={1}, sources={2}" -f `
        $health.version, $health.database.ok, $health.database.counts.data_sources)

$sources = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/data/sources" -TimeoutSec 20
Write-Host ("[test] installed data baseline: sources={0} series_regions={1} gis_regions={2} no_data={3}" -f `
        $sources.totals.sources, $sources.totals.series_regions, $sources.totals.gis_regions, $sources.totals.no_data_regions)
if ($sources.totals.series_regions -ne 459) { throw "installed instance does not report 459 valid regions" }

$index = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8077/" -TimeoutSec 20
Write-Host "[test] installed UI served: HTTP $($index.StatusCode), $($index.Content.Length) bytes"

Write-Host "[test] stopping installed services"
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like "*$Target*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "[test] uninstalling"
$uninstaller = Join-Path $Target "unins000.exe"
if (-not (Test-Path $uninstaller)) { throw "uninstaller missing" }
Start-Process -FilePath $uninstaller -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait
Start-Sleep -Seconds 3
$left = Get-ChildItem $Target -ErrorAction SilentlyContinue
if ($left) {
    Write-Host "[test] leftover entries after uninstall:"
    $left | ForEach-Object { Write-Host "   $($_.Name)" }
    throw "uninstall left files behind"
}
Write-Host "[test] uninstall removed the installation cleanly"
Write-Host "[test] INSTALL / RUN / UNINSTALL VERIFICATION PASSED"
