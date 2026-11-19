@echo off
title Minhas Financas - Servidor Local
echo ========================================================
echo   Minhas Financas - Servidor Local (Node.js + SQLite)
echo ========================================================
echo.
echo   Abrindo o app em http://localhost:3001 ...
echo   IMPORTANTE: Mantenha esta janela aberta enquanto
echo   estiver usando o aplicativo!
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"
cd /d "%~dp0backend"
node src/server.js
pause
