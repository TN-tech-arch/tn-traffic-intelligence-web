. "$PSScriptRoot\env.ps1"
$root = $env:TN_PROJECT_ROOT
$python = Get-TnPython

Write-Host "=== TN Traffic Intelligence environment check ===" -ForegroundColor Cyan
Write-Host "project root : $root"
Write-Host "python       : $python"
& $python --version

$disk = Get-PSDrive -Name ($root.Substring(0,1)) -ErrorAction SilentlyContinue
if ($disk) { Write-Host ("disk free    : {0:N1} GB" -f ($disk.Free / 1GB)) }

Write-Host "`n-- raw data files --"
foreach ($file in @("milano_traffic_nid.csv","milano.geojson","trentino_traffic_nid.csv","trento.geojson","zte_4g_down.region.csv","zte_4g_down.traffic.geojson")) {
    $path = Join-Path $root "data\raw\$file"
    if (Test-Path $path) {
        $hash = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
        Write-Host ("  [ok]   {0}  sha256={1}" -f $file, $hash.Substring(0,16))
    } else {
        Write-Host ("  [MISS] {0}" -f $file) -ForegroundColor Red
    }
}

Write-Host "`n-- python packages --"
& $python -c @"
import importlib
modules = ['fastapi','uvicorn','pydantic','numpy','pandas','scipy','sklearn','statsmodels','joblib','pyarrow',
           'xgboost','lightgbm','torch','prophet','chronos','timesfm','psutil']
for name in modules:
    try:
        module = importlib.import_module(name)
        print(f'  [ok]   {name:<12} {getattr(module, "__version__", "unknown")}')
    except Exception as exc:
        print(f'  [MISS] {name:<12} {type(exc).__name__}: {exc}')
try:
    import torch
    print(f'  cuda available: {torch.cuda.is_available()}')
except Exception:
    print('  cuda available: unknown (torch missing)')
"@

Write-Host "`n-- ports --"
foreach ($port in 8077, 5173) {
    $inUse = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -ne $null
    Write-Host ("  port {0}: {1}" -f $port, ($(if ($inUse) { "in use" } else { "free" })))
}

Write-Host "`n-- model cache --"
$cache = Join-Path $root "models_cache\hf\hub"
if (Test-Path $cache) {
    Get-ChildItem $cache -Directory | ForEach-Object { Write-Host ("  " + $_.Name) }
} else {
    Write-Host "  (no checkpoints downloaded yet)"
}
Write-Host "`nHF_ENDPOINT = $($env:HF_ENDPOINT)"
