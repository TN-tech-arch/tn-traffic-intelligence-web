. "$PSScriptRoot\env.ps1"
$python = Get-TnPython
Write-Host "[TN] starting background worker" -ForegroundColor Cyan
& $python -m app.workers.runner
