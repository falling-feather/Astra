@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动融岗智训.ps1" %*
set "RONGGANG_EXIT_CODE=%ERRORLEVEL%"
if not "%RONGGANG_EXIT_CODE%"=="0" pause
exit /b %RONGGANG_EXIT_CODE%
