@echo off
cd /d "%~dp0"
title 0xForge V2

chcp 65001 >nul

echo ============================================
echo   0xForge V2.0.0
echo   0xForge Tool
echo ============================================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Python.
    echo       Cai Python tai: https://www.python.org/downloads/
    pause
    exit /b 1
)

python --version

if not exist ".env" (
    echo [INFO] Tao file .env tu .env.example...
    copy .env.example .env >nul
    echo [INFO] Da tao .env, co the sua API key neu can.
    echo.
)

echo [INFO] Kiem tra thu vien...
python -c "import fastapi, uvicorn, pydub" 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Dang cai dat thu vien (lan dau se lau)...
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [LOI] Cai dat thu vien that bai.
        pause
        exit /b 1
    )
) else (
    echo [OK] Thu vien da duoc cai dat.
)

echo.
echo ============================================
echo   Dang khoi dong server...
echo   Mo trinh duyet: http://127.0.0.1:7860
echo   Ctrl+C de dung
echo ============================================
echo.

start http://127.0.0.1:7860

python -m backend.main

if %errorlevel% neq 0 (
    echo.
    echo [LOI] Server that bai. Kiem tra log phia tren.
    pause
)
