@echo off
rem Studio 64: rebuild the game engine after changing its C code (engine\src\studio, engine-upstream).
rem Uses the Node.js, compiler and Emscripten SDK the first-run setup installed. Takes a few minutes.
title Studio 64 - rebuild engine
cd /d "%~dp0"
set "NODE=%~dp0.runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
echo.
echo   Rebuilding the Studio 64 engine (only what changed is compiled again)...
echo.
"%NODE%" tools\build_engine.mjs
set RC=%ERRORLEVEL%
echo.
if %RC% neq 0 (
  echo   The build failed. The messages above say why.
) else (
  echo   Done. Reload the Studio 64 tab in your browser ^(Ctrl+F5^).
)
echo.
pause
