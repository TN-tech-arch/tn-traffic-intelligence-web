# Shared environment for all TN Traffic Intelligence scripts.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:TN_PROJECT_ROOT = $root
$env:PYTHONPATH = Join-Path $root "backend"
$env:TN_DATA_DIR = Join-Path $root "data"
$env:TN_MODEL_CACHE = Join-Path $root "models_cache"
$env:TN_DB_PATH = Join-Path $root "data\tn_traffic.db"
$env:TN_HOST = "127.0.0.1"
$env:TN_PORT = "8077"
# HuggingFace is not reachable from some networks; the official mirror is used
# unless the user already configured HF_ENDPOINT.
if (-not $env:HF_ENDPOINT) { $env:HF_ENDPOINT = "https://hf-mirror.com" }
$env:HF_HOME = Join-Path $root "models_cache\hf"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:PYTHONUNBUFFERED = "1"
$script:Python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $script:Python)) {
    throw "Python virtual environment not found: $script:Python . Run scripts/setup_env.ps1 first."
}
function Get-TnPython { return $script:Python }
