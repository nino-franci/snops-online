@echo off
setlocal
cd /d "%~dp0"
echo.
set /p MSG=Commit message: 
if "%MSG%"=="" set MSG=Update Snops Online
git add -A
git commit -m "%MSG%"
if errorlevel 1 goto :end
git push origin main
:end
echo.
pause
