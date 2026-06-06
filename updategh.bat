@echo off
cd /d "%~dp0"

git add .
git diff --cached --quiet

if %errorlevel%==0 (
    echo Khong co thay doi.
    pause
    exit
)

git commit -m "Auto Update"
git push origin main

pause