@echo off
rem Launch the installed TN Traffic Intelligence application.
setlocal
set "APPDIR=%~dp0"
set "PY=%APPDIR%python\python.exe"

if not exist "%PY%" (
  echo [TN] bundled Python runtime not found: %PY%
  pause
  exit /b 1
)

set "TN_PROJECT_ROOT=%APPDIR%"
set "PYTHONPATH=%APPDIR%backend"
set "TN_DATA_DIR=%APPDIR%data"
set "TN_MODEL_CACHE=%APPDIR%models_cache"
set "TN_DB_PATH=%APPDIR%data\tn_traffic.db"
set "TN_HOST=127.0.0.1"
set "TN_PORT=8077"
if not defined HF_ENDPOINT set "HF_ENDPOINT=https://hf-mirror.com"
set "HF_HOME=%APPDIR%models_cache\hf"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "PYTHONUNBUFFERED=1"

if not exist "%APPDIR%data\tn_traffic.db" (
  echo [TN] first run: initialising database and importing the six source files...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APPDIR%first_run.ps1"
)

echo [TN] starting background worker and API...
start "TN Worker" /MIN "%PY%" -m app.workers.runner
start "TN API" /MIN "%PY%" -m uvicorn app.main:app --host %TN_HOST% --port %TN_PORT%

echo [TN] waiting for the API to become ready...
for /l %%i in (1,1,40) do (
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8077/api/health' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto ready
)
echo [TN] API did not answer in time - opening the browser anyway.
:ready
start "" "http://127.0.0.1:8077/"
echo [TN] UI should now be open in your browser. Use stop_tn.bat to stop the services.
endlocal
