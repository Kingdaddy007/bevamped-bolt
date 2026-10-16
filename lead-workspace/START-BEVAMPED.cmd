@echo off
setlocal
set "BEVAMPED_NODE=C:\Users\Oviks\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BEVAMPED_NODE%" goto launch
set "BEVAMPED_NODE=node"
:launch
"%BEVAMPED_NODE%" "%~dp0start-desk.mjs"
if errorlevel 1 pause
