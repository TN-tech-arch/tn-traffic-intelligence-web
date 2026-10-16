@echo off
rem Stop the TN Traffic Intelligence background processes started by launch_tn.bat.
echo [TN] stopping API and worker...
for /f "tokens=2 delims=," %%p in ('tasklist /fi "imagename eq python.exe" /fo csv /nh') do (
  wmic process where "ProcessId=%%~p" get CommandLine 2>nul | findstr /i "uvicorn app.workers.runner" >nul && taskkill /pid %%~p /f >nul 2>&1
)
echo [TN] services stopped. Your Dataset / Experiment / Evaluation records stay in data\tn_traffic.db
