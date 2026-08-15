@echo off
rem start-dsh.cmd — 一键启动 DSH web 服务并打开网页（服务端 + 网页端合一）
rem 用法：双击本文件，或在终端运行 start-dsh.cmd
rem 依赖：dsh 在 PATH 中（或本目录旁已有 dsh 部署），curl 可用（Win10 自带）
setlocal enabledelayedexpansion
set "URL=http://127.0.0.1:3080"
set /a TRIES=0

echo [start-dsh] 目标：%URL%

rem ── 已运行则直接开页 ──────────────────────────────────────────────
set "CODE=000"
for /f %%c in ('curl -s -o nul -w "%%{http_code}" "%URL%" 2^>nul') do set "CODE=%%c"
if not "%CODE%"=="000" (
  echo [start-dsh] 服务已在运行，直接打开网页
  start "" "%URL%"
  exit /b 0
)

rem ── 启动服务（新窗口，最小化）────────────────────────────────────
echo [start-dsh] 启动 dsh --profile web ...
start "DSH web" /min cmd /k dsh --profile web

rem ── 轮询等待就绪（ping 每轮约 1s，最多约 60s）────────────────────
:wait
ping -n 2 127.0.0.1 > nul
set "CODE=000"
for /f %%c in ('curl -s -o nul -w "%%{http_code}" "%URL%" 2^>nul') do set "CODE=%%c"
set /a TRIES+=1
if "%CODE%"=="000" (
  if %TRIES% lss 60 goto wait
)

if "%CODE%"=="000" (
  echo [start-dsh] 等待 60s 仍未连上 %URL%，请查看 "DSH web" 窗口日志
  echo [start-dsh] 提示：确认 dsh 在 PATH 中，例如 set PATH=%%PATH%%;C:\path\to\deepseek-harness\node_modules\.bin
  exit /b 1
)

echo [start-dsh] 服务已就绪，打开网页
start "" "%URL%"
exit /b 0
