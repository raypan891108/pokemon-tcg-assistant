@echo off
rem Runs autostart.ps1 without changing the PowerShell execution policy
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" %*
