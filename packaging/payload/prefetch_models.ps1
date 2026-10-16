# Optional installer step: download the two official foundation model checkpoints.
$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $appDir "python\python.exe"
$env:HF_HOME = Join-Path $appDir "models_cache\hf"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
if (-not $env:HF_ENDPOINT) { $env:HF_ENDPOINT = "https://hf-mirror.com" }

Write-Host "[TN] downloading Chronos and TimesFM weights (Apache-2.0) ..."
& $python -c "import os; os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com'); from huggingface_hub import snapshot_download; snapshot_download('amazon/chronos-bolt-tiny'); snapshot_download('google/timesfm-2.5-200m-pytorch'); print('weights ready')"
Write-Host "[TN] foundation weights are available in $env:HF_HOME"
