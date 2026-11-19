@echo off
title Minhas Financas - Servidor Local
echo Iniciando Backend (Node.js + SQLite) e Frontend (React)...
start "Financeiro - Backend" cmd /k "cd /d "%~dp0backend" && npm start"
start "Financeiro - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 3 /nobreak >nul
start http://localhost:5173
echo App aberto em http://localhost:5173 !
