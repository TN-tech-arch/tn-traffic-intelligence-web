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

Write-Host "[test] deep verification: Module 3 preview/window navigation"
$previewValues = @{
    source_key = "milano"
    scope = "single"
    region_id = "ADRIANO"
    frequency = "native"
    aggregation = "mean"
    input_length = 24
    output_length = 6
    step = 1
    train_ratio = 0.7
    val_ratio = 0.15
    test_ratio = 0.15
    missing_mode = "automatic"
    scaling = "standard"
    label = "install acceptance"
}
$previewBody = @{ values = $previewValues } | ConvertTo-Json -Depth 6
$preview = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/datasets/preview" `
    -ContentType "application/json" -Body $previewBody -TimeoutSec 60
if ($preview.preview_window_total -le 2) {
    throw "installed preview still exposes only $($preview.preview_window_total) windows"
}
$windowBody = @{
    values = $previewValues
    split = $preview.preview_split
    window_index = 1
    preview_region_id = $preview.preview_region_id
} | ConvertTo-Json -Depth 6
$window = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/datasets/preview-window" `
    -ContentType "application/json" -Body $windowBody -TimeoutSec 60
if ($window.window.X.Count -ne 24 -or $window.window.Y.Count -ne 6) {
    throw "installed window X/Y dimensions are incorrect"
}
Write-Host ("[test] installed preview: split={0}, total={1}, selected={2}, X/Y=24/6" -f `
        $window.split, $window.total_windows, ($window.window_index + 1))

Write-Host "[test] deep verification: build dataset"
$built = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/datasets/build" `
    -ContentType "application/json" -Body $previewBody -TimeoutSec 180
$dataset_id = $built.dataset_id
if (-not $dataset_id -or $built.status -ne "Built") {
    throw "installed dataset build failed"
}

Write-Host "[test] deep verification: Module 4 Random Forest experiment"
$experimentBody = @{
    dataset_id = $dataset_id
    algorithm_key = "random_forest"
    params = @{
        n_estimators = 30
        max_depth = 6
        n_jobs = 2
        random_state = 42
    }
} | ConvertTo-Json -Depth 6
$run = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/experiments/run" `
    -ContentType "application/json" -Body $experimentBody -TimeoutSec 60
$experiment = $null
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    $experiment = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/experiments/$($run.experiment_id)" -TimeoutSec 20
    if ($experiment.status -in @("Completed", "Partial", "Failed")) { break }
}
if ($experiment.status -notin @("Completed", "Partial")) {
    throw "installed Module 4 experiment did not complete: $($experiment.status)"
}
$logs = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/experiments/$($run.experiment_id)/logs" -TimeoutSec 20
if ($logs.logs.Count -eq 0) {
    throw "installed Module 4 experiment produced no logs"
}

Write-Host "[test] deep verification: Module 5 full-test evaluation"
$evaluationBody = @{
    dataset_id = $dataset_id
    scope = "single"
    region_id = "ADRIANO"
    experiment_ids = @($run.experiment_id)
    test_selection = "full"
} | ConvertTo-Json -Depth 6
$evaluation = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/evaluations/run" `
    -ContentType "application/json" -Body $evaluationBody -TimeoutSec 60
$evaluationState = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    $evaluationState = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/evaluations/$($evaluation.evaluation_id)" -TimeoutSec 20
    if ($evaluationState.status -in @("Completed", "Failed")) { break }
}
if ($evaluationState.status -ne "Completed" -or $evaluationState.prediction_count -le 0) {
    throw "installed Module 5 evaluation failed or produced no predictions"
}
Write-Host ("[test] installed core: dataset={0}, experiment={1}, evaluation={2}, predictions={3}" -f `
        $dataset_id, $experiment.experiment_id, $evaluationState.evaluation_id, $evaluationState.prediction_count)

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
