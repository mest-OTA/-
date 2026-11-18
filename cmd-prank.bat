@echo off
chcp 936 >nul
color 0A
mode con: cols=64 lines=22
title 非常格调的游戏 - 最终问题
echo.
echo   ====================================================
echo.
echo          最 终 问 题
echo.
echo         你还想要你的电脑吗？
echo.
echo   ====================================================
echo.
echo      [1] 不想        [2] 想
echo.
:ask
set /p c=     请输入 1 或 2，然后按回车: 
if "%c%"=="1" goto safe
if "%c%"=="2" goto prank
if "%c%"=="不想" goto safe
if "%c%"=="想" goto prank
if "%c%"=="no" goto safe
if "%c%"=="yes" goto prank
echo.
echo      输入无效，请重新输入。
goto ask
:safe
echo.
echo      很好，你的电脑将完好无损。
echo.
echo      关闭此窗口即可继续游戏。
echo.
pause
goto :eof
:prank
echo.
echo      正在处理你的请求...
ping -n 2 127.0.0.1 >nul
echo      正在处理你的请求...
ping -n 2 127.0.0.1 >nul
echo.
echo      You are a gay.
echo.
start "" wscript "%~dp0saygay.vbs"
echo      弹窗已送达。
echo.
pause
goto :eof
