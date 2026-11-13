@echo off
title Publish mcp-ink-design to NPM
setlocal enabledelayedexpansion

rem Single source of truth: read the version from package.json so this
rem script can never drift from the published package version again.
set PKG_VERSION=
for /f "tokens=2 delims=:," %%v in ('findstr /R /C:"\"version\"" package.json') do (
    set "RAW_VERSION=%%v"
    set "PKG_VERSION=!RAW_VERSION: =!"
    set "PKG_VERSION=!PKG_VERSION:"=!"
)

if not defined PKG_VERSION (
    echo [ERROR] Could not read "version" from package.json. Aborting.
    exit /b 1
)

echo ===================================================
echo  mcp-ink-design v%PKG_VERSION% - Publishing to NPM Registry
echo ===================================================
echo.
echo Running npm publish --access public ...
echo.
call npm publish --access public
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================================
    echo  [SUCCESS] mcp-ink-design v%PKG_VERSION% is now live on npm!
    echo  View at: https://www.npmjs.com/package/mcp-ink-design
    echo ===================================================
) else (
    echo.
    echo ===================================================
    echo  [NOTICE] npm publish returned code %ERRORLEVEL%.
    echo  If not logged in, run: npm login
    echo ===================================================
)
echo.
pause