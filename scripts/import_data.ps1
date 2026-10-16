. "$PSScriptRoot\env.ps1"
$python = Get-TnPython
$script = Join-Path $PSScriptRoot "import_data.py"
& $python $script
if ($LASTEXITCODE -ne 0) { throw "data import failed with exit code $LASTEXITCODE" }
