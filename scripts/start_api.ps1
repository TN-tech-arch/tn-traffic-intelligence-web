. "$PSScriptRoot\env.ps1"
$python = Get-TnPython
Write-Host "[TN] starting API on http://$($env:TN_HOST):$($env:TN_PORT)" -ForegroundColor Cyan
& $python -m uvicorn app.main:app --host $env:TN_HOST --port $env:TN_PORT --log-level info
