# First-run bootstrap executed by launch_tn.bat inside the installed application.
$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $appDir "python\python.exe"

$env:TN_PROJECT_ROOT = $appDir
$env:PYTHONPATH = Join-Path $appDir "backend"
$env:TN_DATA_DIR = Join-Path $appDir "data"
$env:TN_MODEL_CACHE = Join-Path $appDir "models_cache"
$env:TN_DB_PATH = Join-Path $appDir "data\tn_traffic.db"
$env:HF_HOME = Join-Path $appDir "models_cache\hf"
$env:PYTHONUNBUFFERED = "1"
if (-not $env:HF_ENDPOINT) { $env:HF_ENDPOINT = "https://hf-mirror.com" }

New-Item -ItemType Directory -Force -Path (Join-Path $appDir "data\processed"),
    (Join-Path $appDir "data\artifacts"), (Join-Path $appDir "data\logs"),
    (Join-Path $appDir "models_cache") | Out-Null

$bootstrap = @'
import json
from app.db.migrate import run_migrations
from app.services.ingest import import_all

print("migrations:", run_migrations())
report = import_all()
for key, value in report.items():
    print(
        "{0}: points={1} regions={2} gis={3} checks={4}".format(
            key, value["time_points"], value["region_columns"], value["gis_features"],
            value["all_expected_checks_passed"],
        )
    )
'@
$bootstrapPath = Join-Path $env:TEMP "tn_bootstrap_data.py"
Set-Content -LiteralPath $bootstrapPath -Value $bootstrap -Encoding UTF8
& $python $bootstrapPath
if ($LASTEXITCODE -ne 0) { throw "data bootstrap failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $bootstrapPath -Force -ErrorAction SilentlyContinue
Write-Host "[TN] bootstrap finished"
