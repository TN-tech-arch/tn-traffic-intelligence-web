# Restart the API and the worker in the background (dev helper).
. "$PSScriptRoot\env.ps1"
$root = $env:TN_PROJECT_ROOT
$logDir = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*workers.runner*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","$PSScriptRoot\start_api.ps1" `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "api.out.log") `
    -RedirectStandardError (Join-Path $logDir "api.err.log")
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","$PSScriptRoot\start_worker.ps1" `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "worker.out.log") `
    -RedirectStandardError (Join-Path $logDir "worker.err.log")

Start-Sleep -Seconds 10
try {
    $health = Invoke-RestMethod -Uri "http://$($env:TN_HOST):$($env:TN_PORT)/api/health" -TimeoutSec 20
    Write-Host "[TN] API restarted: status=$($health.status) version=$($health.version) db_ok=$($health.database.ok)" -ForegroundColor Green
} catch {
    Write-Host "[TN] API not responding yet - see data\logs\api.err.log" -ForegroundColor Yellow
}
Write-Host "[TN] worker log: $logDir\worker.out.log"
