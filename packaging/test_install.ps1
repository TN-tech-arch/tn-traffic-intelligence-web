# Install the built installer silently into a test directory, start the installed
# application, verify the API, then uninstall again (real installation evidence).
param(
    [string]$Target = "E:\codex\codex10.16\packaging\install-test"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $PSScriptRoot "dist\TN-Traffic-Intelligence-Setup-3.2.0.exe"
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
if (-not $health.environment.native_runtime.loaded -or -not $health.environment.torch) {
    throw "installed app did not load the bundled native runtime or PyTorch"
}
Write-Host ("[test] installed native runtime: torch={0}, runtime={1}" -f `
        $health.environment.torch, $health.environment.native_runtime.path)

$modelRegistry = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/models/registry" -TimeoutSec 30
$prophet = $modelRegistry.models | Where-Object { $_.key -eq "prophet" } | Select-Object -First 1
$transformer = $modelRegistry.models | Where-Object { $_.key -eq "transformer" } | Select-Object -First 1
$prophetDefaults = @{}
$prophet.params | ForEach-Object { $prophetDefaults[$_.key] = $_.default }
$transformerDefaults = @{}
$transformer.params | ForEach-Object { $transformerDefaults[$_.key] = $_.default }
if (-not $prophet -or -not $transformer) {
    throw "installed model registry is missing Prophet or Transformer"
}
if ($prophetDefaults["daily_fourier_order"] -ne 4 -or
    $prophetDefaults["holiday_country"] -ne "auto" -or
    $prophetDefaults["random_seed"] -ne 42 -or
    $prophetDefaults.ContainsKey("refit_interval") -or
    $prophetDefaults.ContainsKey("calibration_days") -or
    $prophetDefaults.ContainsKey("interval_width")) {
    throw "installed Prophet defaults are not the validated profile"
}
if ($transformerDefaults["d_model"] -ne 64 -or
    $transformerDefaults["n_heads"] -ne 4 -or
    $transformerDefaults["encoder_layers"] -ne 2 -or
    $transformerDefaults["dim_feedforward"] -ne 128 -or
    $transformerDefaults["learning_rate"] -ne 0.0005 -or
    $transformerDefaults["patience"] -ne 8) {
    throw "installed Transformer defaults are not the validated profile"
}
Write-Host "[test] installed Prophet and Transformer defaults match the validated profiles"

$initialDashboard = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/dashboard" -TimeoutSec 30
$initialHistory = @{
    clusters = [int]$initialDashboard.counts.cluster_runs
    datasets = [int]$initialDashboard.counts.datasets
    experiments = [int]$initialDashboard.counts.experiments
    batches = [int]$initialDashboard.counts.batches
    evaluations = [int]$initialDashboard.counts.evaluations
}
if (@($initialHistory.Values | Where-Object { $_ -ne 0 }).Count -ne 0) {
    throw "fresh installation contains module history: $($initialHistory | ConvertTo-Json -Compress)"
}
Write-Host "[test] fresh installation has zero Module 2-5 history records"

$sources = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/data/sources" -TimeoutSec 20
Write-Host ("[test] installed data baseline: sources={0} series_regions={1} gis_regions={2} no_data={3}" -f `
        $sources.totals.sources, $sources.totals.series_regions, $sources.totals.gis_regions, $sources.totals.no_data_regions)
if ($sources.totals.series_regions -ne 459) { throw "installed instance does not report 459 valid regions" }

$validationSchema = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/validation/schema" -TimeoutSec 20
$m3Keys = @($validationSchema.modules.m3 | ForEach-Object { $_.key })
foreach ($removedField in @("frequency", "aggregation", "label")) {
    if ($m3Keys -contains $removedField) {
        throw "installed Module 3 schema still exposes removed field: $removedField"
    }
}

$index = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8077/" -TimeoutSec 20
Write-Host "[test] installed UI served: HTTP $($index.StatusCode), $($index.Content.Length) bytes"

Write-Host "[test] deep verification: all-region requests are rejected"
$rejectedAllPreview = @{
    source_key = "milano"
    scope = "all"
    region_id = "ADRIANO"
    input_length = 24
    output_length = 6
    step = 1
    train_ratio = 0.7
    val_ratio = 0.15
    test_ratio = 0.15
    missing_mode = "automatic"
    scaling = "standard"
}
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/datasets/preview" `
        -ContentType "application/json" -Body (@{ values = $rejectedAllPreview } | ConvertTo-Json -Depth 6) `
        -TimeoutSec 30 | Out-Null
    throw "installed Module 3 unexpectedly accepted a full-region preview"
} catch {
    $statusCode = [int]$_.Exception.Response.StatusCode
    if ($statusCode -notin @(409, 422)) {
        throw "installed Module 3 full-region rejection returned HTTP $statusCode instead of 409/422"
    }
}

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
    time_start = "2013-11-01 00:00:00"
    time_end = "2013-11-07 23:50:00"
}
$previewBody = @{ values = $previewValues } | ConvertTo-Json -Depth 6
$preview = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/datasets/preview" `
    -ContentType "application/json" -Body $previewBody -TimeoutSec 60
if ($preview.frequency -ne "native" -or $preview.frequency_minutes -ne 10) {
    throw "installed preview did not use Milano native 10-minute frequency"
}
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
if ($dataset_id -ne "DS-MILANO-ADRIANO-0001" -or
    $dataset_id -notmatch "^DS-MILANO-ADRIANO-\d{4,}$") {
    throw "installed dataset ID is not readable: $dataset_id"
}
if ($built.label -ne $dataset_id) {
    throw "installed dataset primary label is not the DS ID"
}
if ($built.display_id -ne $dataset_id) {
    throw "installed dataset display_id is not the persisted DS business ID"
}
if ($built.time_start -ne "2013-11-01 00:00:00" -or $built.time_end -ne "2013-11-07 23:50:00") {
    throw "installed dataset did not preserve the selected Milano range"
}
$datasetList = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/datasets?include_archived=true" -TimeoutSec 20
$installedDataset = $datasetList.datasets | Where-Object { $_.dataset_id -eq $dataset_id } | Select-Object -First 1
if (-not $installedDataset -or $installedDataset.display_id -ne $dataset_id) {
    throw "installed dataset list does not expose the persisted DS display ID"
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
if ($run.experiment_id -ne "EXP-MILANO-ADRIANO-RANDOM-FOREST-0001") {
    throw "installed experiment ID is not readable: $($run.experiment_id)"
}
if ($run.display_id -ne $run.experiment_id) {
    throw "installed experiment response is missing its persisted EXP display ID"
}
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
if ($experiment.display_id -ne $run.experiment_id -or $experiment.dataset_display_id -ne $dataset_id) {
    throw "installed experiment detail does not expose DS/EXP display IDs"
}
$wallSeconds = ([datetimeoffset]::Parse($experiment.ended_at) - [datetimeoffset]::Parse($experiment.started_at)).TotalSeconds
if ([math]::Abs($wallSeconds - [double]$experiment.metrics.duration_seconds) -gt 0.001) {
    throw "installed experiment duration does not match its displayed start/end timestamps"
}
if ($null -eq $experiment.metrics.processing_seconds) {
    throw "installed experiment detail is missing precise processing_seconds"
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
if ($evaluation.evaluation_id -ne "EVAL-0001") {
    throw "installed first evaluation ID did not start at EVAL-0001: $($evaluation.evaluation_id)"
}
$evaluationState = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    $evaluationState = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/evaluations/$($evaluation.evaluation_id)" -TimeoutSec 20
    if ($evaluationState.status -in @("Completed", "Failed")) { break }
}
if ($evaluationState.status -ne "Completed" -or $evaluationState.prediction_count -le 0) {
    throw "installed Module 5 evaluation failed or produced no predictions"
}
$installedMember = $evaluationState.experiments | Where-Object { $_.experiment_id -eq $run.experiment_id } | Select-Object -First 1
if (-not $installedMember -or $installedMember.display_id -ne $run.experiment_id) {
    throw "installed Module 5 evaluation does not expose the EXP display ID"
}
Write-Host ("[test] installed core: dataset={0}, experiment={1}, evaluation={2}, predictions={3}" -f `
        $dataset_id, $experiment.experiment_id, $evaluationState.evaluation_id, $evaluationState.prediction_count)

Write-Host "[test] deep verification: one-region all-models batch"
$batchBody = @{
    dataset_id = $dataset_id
    scope = "single"
    model_configs = @{}
    execution_policy = @{
        continue_on_error = $true
        skip_unavailable_after_confirmation = $true
        max_concurrent_gpu_jobs = 1
    }
} | ConvertTo-Json -Depth 8
$batch = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/batches/run" `
    -ContentType "application/json" -Body $batchBody -TimeoutSec 120
if ($batch.scope -ne "single" -or $batch.region_count -ne 1 -or `
    $batch.algorithm_count -ne 12 -or $batch.planned_region_model_tasks -ne 12 -or `
    @($batch.experiments).Count -ne 12) {
    throw "installed all-models batch did not plan exactly 12 models for one region"
}
$batchState = $null
for ($i = 0; $i -lt 1800; $i++) {
    Start-Sleep -Seconds 2
    $batchState = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/batches/$($batch.batch_id)" -TimeoutSec 30
    $terminal = @("Completed", "Partial", "Failed", "Stopped", "Stopping")
    if ($batchState.status -in $terminal -and
        @($batchState.experiments | Where-Object { $_.status -in @("Queued", "Running") }).Count -eq 0) {
        break
    }
}
if (-not $batchState -or $batchState.status -notin @("Completed", "Partial")) {
    throw "installed one-region all-models batch did not finish successfully: $($batchState.status)"
}
if ($batchState.display_id -ne "BATCH-MILANO-ADRIANO-MODELS-0001") {
    throw "installed first batch ID did not start at 0001: $($batchState.display_id)"
}
if ($batchState.scope -ne "single" -or $batchState.region_count -ne 1 -or
    @($batchState.experiments).Count -ne 12 -or
    @($batchState.region_summary | Where-Object { $_.region_id -ne "ADRIANO" }).Count -ne 0) {
    throw "installed all-models batch contains an invalid region scope or member count"
}
$successfulBatchExperiments = @($batchState.experiments | Where-Object { $_.status -eq "Completed" })
if ($successfulBatchExperiments.Count -ne 12) {
    throw "installed all-models batch completed $($successfulBatchExperiments.Count) of 12 models"
}
Write-Host ("[test] installed batch: {0}, status={1}, models={2}, completed={3}" -f `
        $batchState.display_id, $batchState.status, @($batchState.experiments).Count,
        $successfulBatchExperiments.Count)

Write-Host "[test] deep verification: Module 5 single-region multi-model evaluation"
$multiEvaluationBody = @{
    dataset_id = $dataset_id
    scope = "single"
    region_id = "ADRIANO"
    experiment_ids = @($successfulBatchExperiments | ForEach-Object { $_.experiment_id })
    test_selection = "full"
} | ConvertTo-Json -Depth 6
$multiEvaluation = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8077/api/evaluations/run" `
    -ContentType "application/json" -Body $multiEvaluationBody -TimeoutSec 120
$multiEvaluationState = $null
for ($i = 0; $i -lt 300; $i++) {
    Start-Sleep -Seconds 2
    $multiEvaluationState = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/evaluations/$($multiEvaluation.evaluation_id)" -TimeoutSec 30
    if ($multiEvaluationState.status -in @("Completed", "Partial", "Failed", "Stopped")) { break }
}
if ($multiEvaluationState.status -ne "Completed" -or $multiEvaluationState.prediction_count -le 0) {
    throw "installed Module 5 multi-model evaluation failed or produced no predictions"
}
if ($multiEvaluationState.scope -ne "single" -or $multiEvaluationState.region_id -ne "ADRIANO" -or
    @($multiEvaluationState.experiments).Count -ne $successfulBatchExperiments.Count) {
    throw "installed Module 5 multi-model evaluation does not contain the expected single-region members"
}
$evaluatedWape = @($multiEvaluationState.metrics_summary.experiments | ForEach-Object { $_.macro.wape })
$rankedWape = @($multiEvaluationState.metrics_summary.ranking | ForEach-Object { $_.macro.wape })
if ($evaluatedWape.Count -ne $successfulBatchExperiments.Count -or
    @($evaluatedWape | Where-Object { $_ -eq $null }).Count -ne 0) {
    throw "installed Module 5 evaluation does not expose WAPE for every completed model"
}
if ($rankedWape.Count -ne $successfulBatchExperiments.Count) {
    throw "installed Module 5 WAPE ranking does not contain every completed model"
}
for ($i = 1; $i -lt $rankedWape.Count; $i++) {
    if ([double]$rankedWape[$i - 1] -gt [double]$rankedWape[$i]) {
        throw "installed Module 5 ranking is not sorted ascending by WAPE"
    }
}
Write-Host ("[test] installed multi-model evaluation: {0}, members={1}, predictions={2}" -f `
        $multiEvaluationState.evaluation_id, @($multiEvaluationState.experiments).Count,
        $multiEvaluationState.prediction_count)

Write-Host "[test] deep verification: all history APIs expose only single-region records"
$installedDatasets = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/datasets?include_archived=true" -TimeoutSec 30
$installedExperiments = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/experiments?limit=500" -TimeoutSec 30
$installedBatches = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/batches?limit=200" -TimeoutSec 30
$installedEvaluations = Invoke-RestMethod -Uri "http://127.0.0.1:8077/api/evaluations?limit=200" -TimeoutSec 30
if (@($installedDatasets.datasets | Where-Object { $_.scope -ne "single" }).Count -ne 0 -or
    @($installedExperiments.experiments | Where-Object { $_.scope -ne "single" }).Count -ne 0 -or
    @($installedBatches.batches | Where-Object { $_.scope -ne "single" }).Count -ne 0 -or
    @($installedEvaluations.evaluations | Where-Object { $_.scope -ne "single" }).Count -ne 0) {
    throw "installed history APIs expose a non-single-region record"
}

Write-Host "[test] deep verification: installed Module 4 two-column UI"
$oldUiBase = $env:TN_UI_BASE
Push-Location (Join-Path $root "frontend")
try {
    $env:TN_UI_BASE = "http://127.0.0.1:8077"
    & node "tests\check_m4_redesign.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "installed Module 4 Playwright regression failed"
    }
    & node "tests\check_training_time_format.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "installed Module 4 time-format regression failed"
    }
    & node "tests\check_history_panels.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "installed Module 2-5 history-panel regression failed"
    }
    & node "tests\check_m1_layout.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "installed Module 1 layout and comparison-color regression failed"
    }
    & node "tests\check_m5_redesign.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "installed Module 5 redesign regression failed"
    }
    & node "tests\check_single_region_workflow.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "installed single-region Playwright regression failed"
    }
} finally {
    $env:TN_UI_BASE = $oldUiBase
    Pop-Location
}

Write-Host "[test] database-level full-region cleanup audit"
$oldInstalledDataDir = $env:TN_DATA_DIR
$env:TN_DATA_DIR = Join-Path $Target "data"
try {
    $scopeAuditJson = & $python (Join-Path $root "scripts\audit_single_region_db.py")
} finally {
    $env:TN_DATA_DIR = $oldInstalledDataDir
}
if ($LASTEXITCODE -ne 0) { throw "installed database scope audit failed to execute" }
$scopeAudit = ($scopeAuditJson | Select-Object -Last 1) | ConvertFrom-Json
if ($scopeAudit.datasets -ne 0 -or $scopeAudit.experiments -ne 0 -or
    $scopeAudit.batches -ne 0 -or $scopeAudit.evaluations -ne 0 -or
    $scopeAudit.foreign_key_violations -ne 0) {
    throw "installed database contains full-region or orphaned records"
}
Write-Host "[test] installed database cleanup audit: zero non-single records, zero foreign-key violations"

Write-Host "[test] packaged history-ID migration against pre-migration snapshot"
$legacyBackup = Get-ChildItem -LiteralPath (Join-Path $root "data\backups") `
    -Filter "tn_traffic-before-history-id-migration-*.db" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($legacyBackup) {
    $migrationDir = Join-Path $Target "migration-check"
    New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
    $migrationDb = Join-Path $migrationDir "legacy.db"
    Copy-Item -LiteralPath $legacyBackup.FullName -Destination $migrationDb -Force
    $oldDbPath = $env:TN_DB_PATH
    $oldDataDir = $env:TN_DATA_DIR
    $oldPythonPath = $env:PYTHONPATH
    try {
        $env:TN_DB_PATH = $migrationDb
        $env:TN_DATA_DIR = $migrationDir
        $env:PYTHONPATH = Join-Path $Target "backend"
        $migrationJson = & $python -c "from app.db.migrate import run_migrations; from app.db.history_ids import migrate_readable_history_ids; import json; run_migrations(); print(json.dumps(migrate_readable_history_ids()))"
        if ($LASTEXITCODE -ne 0) { throw "packaged history-ID migration process failed" }
        $migrationResult = ($migrationJson | Select-Object -Last 1) | ConvertFrom-Json
        if ($migrationResult.after.issues -ne 0 -or $migrationResult.after.datasets -ne 15 -or `
            $migrationResult.after.clusters -ne 10 -or $migrationResult.after.experiments -ne 96 -or `
            $migrationResult.after.batches -ne 6) {
            throw "packaged history-ID migration counts or issues are unexpected"
        }
        Write-Host ("[test] packaged migration: datasets={0}, clusters={1}, experiments={2}, region_experiments={3}, batches={4}, mappings={5}, issues={6}" -f `
                $migrationResult.after.datasets, $migrationResult.after.clusters, $migrationResult.after.experiments, `
                $migrationResult.after.region_experiments, $migrationResult.after.batches, `
                $migrationResult.after.mappings, $migrationResult.after.issues)
    } finally {
        $env:TN_DB_PATH = $oldDbPath
        $env:TN_DATA_DIR = $oldDataDir
        $env:PYTHONPATH = $oldPythonPath
        $resolvedMigration = (Resolve-Path -LiteralPath $migrationDir).Path
        if ((Split-Path -Parent $resolvedMigration) -ne (Resolve-Path -LiteralPath $Target).Path) {
            throw "refusing to remove migration-check outside install target"
        }
        Remove-Item -LiteralPath $resolvedMigration -Recurse -Force
    }
} else {
    throw "pre-migration backup missing; packaged migration could not be verified"
}

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
