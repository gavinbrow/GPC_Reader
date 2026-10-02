@echo off
cd /d "%~dp0backend"
if not exist data mkdir data
python -c "import fastapi" 2>nul
if errorlevel 1 (
    echo  Installing backend dependencies...
    pip install -r requirements.txt
)
echo.
echo  Backend starting on http://localhost:8000
echo  Press Ctrl+C to stop.
echo.
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause