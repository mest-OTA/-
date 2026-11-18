@echo off
chcp 936 >nul
title Stylish Game - Allow phone access
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Need admin rights. Confirmation box will pop up, please click Yes.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Allowing TCP 18888 ...
netsh advfirewall firewall delete rule name="StylishGame LAN 18888" >nul 2>&1
netsh advfirewall firewall add rule name="StylishGame LAN 18888" dir=in action=allow protocol=TCP localport=18888 profile=any
echo.
echo Done. Open http://127.0.0.1:18888/ or use the public URL in the game page.
echo.
pause
