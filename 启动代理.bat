@echo off
chcp 65001 >nul
title Fullstack AI 本地代理
cd /d "%~dp0"
echo ============================================
echo   全栈 AI 工作台 · 本地 CORS 代理
echo   保持本窗口开着，然后刷新 fullstack-map.html
echo   关闭本窗口 = 停止代理
echo ============================================
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python proxy_server.py
  goto end
)
where py >nul 2>nul
if %errorlevel%==0 (
  py proxy_server.py
  goto end
)
echo 未找到 Python。请先安装 Python 3（python.org 下载勾选 Add to PATH），
echo 或换用页面里的「公共代理」连接方式（免安装，较慢）。
pause
:end
pause
