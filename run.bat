@echo off
REM ==========================================================================
REM  PromptShield - one-step Windows launcher.
REM  Usage:  run.bat            (installs deps, builds, and starts the server)
REM          run.bat dev        (hot-reload development mode)
REM          run.bat docker     (build & run via Docker instead)
REM ==========================================================================
setlocal

if "%1"=="docker" goto docker

REM --- Ensure an .env exists (fall back to the example) ---------------------
if not exist ".env" (
  echo [PromptShield] No .env found. Creating one from .env.example ...
  copy /Y ".env.example" ".env" >nul
)

REM --- Install dependencies if needed ---------------------------------------
if not exist "node_modules" (
  echo [PromptShield] Installing dependencies ...
  call npm install || goto error
)

if "%1"=="dev" (
  echo [PromptShield] Starting in DEV mode (hot reload) ...
  call npm run dev
  goto end
)

echo [PromptShield] Building ...
call npm run build || goto error
echo [PromptShield] Starting server ...
call npm start
goto end

:docker
echo [PromptShield] Building and starting via Docker Compose ...
call docker compose up --build
goto end

:error
echo [PromptShield] ERROR: a step failed. See the output above.
exit /b 1

:end
endlocal
