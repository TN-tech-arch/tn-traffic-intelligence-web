@echo off
rem Launch the installed TN Traffic Intelligence application.
setlocal
set "APPDIR=%~dp0"
set "PY=%APPDIR%python\python.exe"
set "PYW=%APPDIR%python\pythonw.exe"

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

echo [TN] starting desktop application...
start "" /B "%PYW%" -m app.desktop
echo [TN] The desktop window manages its own local API and worker processes.
endlocal
