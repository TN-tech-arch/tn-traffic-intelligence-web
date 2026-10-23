# Build the Windows installer payload: a portable Python runtime plus the app.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File packaging\build_package.ps1
#
# Produces: packaging\dist\TN-Traffic-Intelligence-Setup-<version>.exe
param(
    [string]$Version = "3.2.0",
    [switch]$SkipSitePackages,
    [switch]$SkipModelCache
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $PSScriptRoot "dist-stage"
$runtimeDir = Join-Path $build "python"
$appDir = Join-Path $build "app"
$distDir = Join-Path $PSScriptRoot "dist"

Write-Host "[pack] cleaning stage $build"
if (Test-Path $build) { Remove-Item -LiteralPath $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtimeDir, $appDir, $distDir | Out-Null

Write-Host "[pack] extracting portable Python (embeddable 3.12.10)"
Expand-Archive -LiteralPath (Join-Path $PSScriptRoot "runtime\python-embed.zip") -DestinationPath $runtimeDir -Force

# The embeddable distribution ships an isolated sys.path; enable site-packages.
$pth = Join-Path $runtimeDir "python312._pth"
@(
    "python312.zip",
    ".",
    "Lib\site-packages",
    "..\backend",
    "import site"
) | Set-Content -LiteralPath $pth -Encoding ascii

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "runtime\get-pip.py") -Destination (Join-Path $runtimeDir "get-pip.py") -Force

if (-not $SkipSitePackages) {
    Write-Host "[pack] copying installed dependencies (~1.4 GB, this takes a minute)"
    $siteSource = Join-Path $root ".venv\Lib\site-packages"
    $siteTarget = Join-Path $runtimeDir "Lib\site-packages"
    New-Item -ItemType Directory -Force -Path $siteTarget | Out-Null
    robocopy $siteSource $siteTarget /E /NFL /NDL /NJH /NJS /NP /XF *.pyc /XD __pycache__ | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
    Write-Host "[pack] dependencies copied"

    # PyTorch and LightGBM depend on msvcp140.dll. Some Windows machines keep
    # an older system copy, so vendor the compatible runtime in a stable path
    # that app.native_runtime preloads before importing native ML modules.
    $msvcpSource = Join-Path $siteSource "sklearn\.libs\msvcp140.dll"
    if (-not (Test-Path -LiteralPath $msvcpSource)) {
        throw "compatible msvcp140.dll not found in the dependency environment: $msvcpSource"
    }
    $runtimeTarget = Join-Path $runtimeDir "tn_runtime"
    New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null
    Copy-Item -LiteralPath $msvcpSource -Destination (Join-Path $runtimeTarget "msvcp140.dll") -Force
    Write-Host "[pack] bundled compatible MSVC runtime"
}

Write-Host "[pack] staging application files"
$dirsToCopy = @("backend", "scripts", "docs")
foreach ($dir in $dirsToCopy) {
    Copy-Item -LiteralPath (Join-Path $root $dir) -Destination (Join-Path $appDir $dir) -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "frontend") | Out-Null
Copy-Item -LiteralPath (Join-Path $root "frontend\dist") -Destination (Join-Path $appDir "frontend\dist") -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "data") | Out-Null
Copy-Item -LiteralPath (Join-Path $root "data\raw") -Destination (Join-Path $appDir "data\raw") -Recurse -Force
if (-not $SkipModelCache) {
    $modelCacheSource = Join-Path $root "models_cache"
    if (Test-Path $modelCacheSource) {
        Write-Host "[pack] bundling downloaded foundation-model checkpoints"
        $modelCacheTarget = Join-Path $appDir "models_cache"
        New-Item -ItemType Directory -Force -Path $modelCacheTarget | Out-Null
        robocopy $modelCacheSource $modelCacheTarget /E /NFL /NDL /NJH /NJS /NP /XF *.pyc /XD __pycache__ | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "model-cache robocopy failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "[pack] model cache not found; installer will require prefetch_models.ps1"
    }
}
foreach ($file in @("README.md", "PROJECT_SPEC.md", "CODEX_START.md", "ACCEPTANCE_CHECKLIST.md",
                    "CHANGES_v3_1.md", "DATA_MANIFEST_SHA256.txt", "requirements-core.txt",
                    "requirements-ml.txt", "requirements-models.txt", "requirements.lock.txt")) {
    $source = Join-Path $root $file
    if (Test-Path $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $appDir $file) -Force }
}

# Remove test/dev leftovers that are not needed at runtime.
foreach ($pattern in @("__pycache__", ".pytest_cache")) {
    Get-ChildItem -Path $appDir -Recurse -Directory -Filter $pattern -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}

Write-Host "[pack] staging launcher scripts"
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload\launch_tn.bat") -Destination (Join-Path $appDir "launch_tn.bat") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload\stop_tn.bat") -Destination (Join-Path $appDir "stop_tn.bat") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload\first_run.ps1") -Destination (Join-Path $appDir "first_run.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload\prefetch_models.ps1") -Destination (Join-Path $appDir "prefetch_models.ps1") -Force

$size = (Get-ChildItem $build -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("[pack] stage size: {0:N0} MB" -f $size)

# Inno Setup expects UTF-8 with BOM for non-ASCII script/text content, and the
# project files are stored without BOM. Normalise the installer inputs.
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
foreach ($file in @(
        (Join-Path $PSScriptRoot "tn_traffic_intelligence.iss"),
        (Join-Path $PSScriptRoot "payload\BEFORE_INSTALL.txt"),
        (Join-Path $PSScriptRoot "payload\LICENSE_NOTICES.txt"))) {
    $content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($file, $content, $utf8Bom)
}

$iscc = "C:\Program Files\Inno Setup 7\ISCC.exe"
if (-not (Test-Path $iscc)) { throw "Inno Setup compiler not found at $iscc" }
Write-Host "[pack] compiling installer with Inno Setup"
& $iscc "/DStageDir=$build" "/DAppVersion=$Version" (Join-Path $PSScriptRoot "tn_traffic_intelligence.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }
Get-ChildItem $distDir | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize | Out-String
