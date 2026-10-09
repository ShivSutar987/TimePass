@echo off
title PaniPari - Room Water Turn Manager
echo ========================================================
echo   💧 PaniPari - Room Water Turn Manager
echo ========================================================
echo.
cd /d "%~dp0backend"

echo Starting server...
echo Local Address:  http://localhost:3000
echo.
node server.js
pause
