@echo off
title Minhas Financas - Servidor Local
echo ========================================================
echo   Minhas Financas - Servidor Local (Node.js + SQLite)
echo ========================================================
echo.
echo   Reiniciando porta 3001 (se houver instancia antiga)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo   Abrindo o app em http://localhost:3001 ...
echo   IMPORTANTE: Mantenha esta janela aberta enquanto
echo   estiver usando o aplicativo! (Atualiza sozinho com --watch)
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"
cd /d "%~dp0backend"
node --watch src/server.js
pause
