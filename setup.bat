@echo off
echo ===================================================
echo    Simplex Project - Automated Environment Setup
echo ===================================================

echo.
echo Checking for Python 3.11 installation...
py -3.11 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python 3.11 is not installed. Installing Python 3.11 automatically...
    winget install --id Python.Python.3.11 --exact --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo Error installing Python 3.11! Please check your internet connection or install manually.
        exit /b 1
    )
    echo Python 3.11 installed successfully.
) else (
    echo Python 3.11 is already installed.
)

echo.
echo Removing old broken virtual environment...
if exist "venv" (
    rmdir /s /q "venv"
)

echo.
echo Creating new virtual environment with Python 3.11...
py -3.11 -m venv venv
if %errorlevel% neq 0 (
    echo Error creating virtual environment!
    exit /b 1
)

echo.
echo Activating virtual environment and installing dependencies...
call venv\Scripts\activate.bat

echo Updating pip...
python -m pip install --upgrade pip >nul

echo Installing requirements...
pip install -r requirements.txt

echo.
echo ===================================================
echo Setup complete! Starting the application...
echo ===================================================
echo.

python app.py
