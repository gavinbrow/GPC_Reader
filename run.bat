@echo off
REM ============================================================
REM  Astra Reader - Development Launcher
REM  Starts both backend (FastAPI) and frontend (Vite) servers
REM ============================================================

echo.
echo  ===============================================
echo   Astra Reader - Development Environment
echo  ===============================================
echo.

REM --- Start backend ---
echo  [1/2] Starting backend  (http://localhost:8000) ...
start "Astra Reader - Backend" "%~dp0_start_backend.bat"

REM --- Start frontend ---
echo  [2/2] Starting frontend (http://localhost:5173) ...
start "Astra Reader - Frontend" "%~dp0_start_frontend.bat"

echo.
echo  -----------------------------------------------
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo  -----------------------------------------------
echo.
echo  Two command windows have been opened.
echo  Close them or press Ctrl+C to stop each server.
echo.

REM --- Open the browser after a short delay ---
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo  Opening browser to http://localhost:5173 ...
echo.
pause