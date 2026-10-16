param(
    [switch]$NoBrowser,
    [switch]$BuildFrontend
)
. "$PSScriptRoot\env.ps1"
$root = $env:TN_PROJECT_ROOT
$python = Get-TnPython

Write-Host "[TN] bootstrapping database and data sources..." -ForegroundColor Cyan
& $python -c "from app.main import bootstrap; import json; print(json.dumps(bootstrap(), ensure_ascii=False))"

if ($BuildFrontend) {
    Write-Host "[TN] building frontend (vite build)..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "frontend")
    npm run build
    Pop-Location
}

Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-File","$PSScriptRoot\start_worker.ps1" -WindowStyle Hidden
Start-Sleep -Seconds 2
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-File","$PSScriptRoot\start_api.ps1" -WindowStyle Hidden
Start-Sleep -Seconds 6

$url = "http://$($env:TN_HOST):$($env:TN_PORT)/api/health"
try {
    $health = Invoke-RestMethod -Uri $url -TimeoutSec 20
    Write-Host "[TN] API healthy: version $($health.version) db_ok=$($health.database.ok)" -ForegroundColor Green
} catch {
    Write-Host "[TN] API did not answer yet, check the API window for errors." -ForegroundColor Yellow
}

if (Test-Path (Join-Path $root "frontend\dist\index.html")) {
    Write-Host "[TN] Production build detected - open http://$($env:TN_HOST):$($env:TN_PORT)/" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "http://$($env:TN_HOST):$($env:TN_PORT)/" }
} else {
    Write-Host "[TN] Frontend dev server: cd frontend; npm run dev (http://localhost:5173)" -ForegroundColor Yellow
    if (-not $NoBrowser) { Start-Process "http://localhost:5173/" }
}
