@echo off
cd /d "%~dp0frontend"
if not exist node_modules (
    echo  Installing frontend dependencies...
    npm install
)
echo.
echo  Frontend starting on http://localhost:5173
echo  Press Ctrl+C to stop.
echo.
npm run dev
pause