@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   ClipPang Local
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto node_missing

node -e "const order=process.versions.node.localeCompare('22.13.0',undefined,{numeric:true});process.exit(order===-1?1:0)" >nul 2>nul
if errorlevel 1 goto node_old

where npm.cmd >nul 2>nul
if errorlevel 1 goto npm_missing

if not exist "node_modules\.package-lock.json" goto install
if not exist "node_modules\hyperframes\package.json" goto install
node -e "const fs=require('fs');let ok=false;try{ok=Math.sign(fs.statSync('node_modules/.package-lock.json').mtimeMs-fs.statSync('package-lock.json').mtimeMs)!==-1}catch{}process.exit(ok?0:1)" >nul 2>nul
if errorlevel 1 goto install
echo [1/3] แพ็กเกจพร้อมแล้ว
goto after_install

:install
echo [1/3] กำลังติดตั้งแพ็กเกจที่จำเป็น...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto install_failed

:after_install
if not exist "dist\server\index.js" goto build
node -e "const fs=require('fs'),p=require('path'),out='dist/server/index.js',built=fs.statSync(out).mtimeMs;let newer=false;for(const f of ['package.json','package-lock.json','vite.config.ts','next.config.ts']){if(fs.existsSync(f)){if(Math.sign(fs.statSync(f).mtimeMs-built)===1)newer=true}}function walk(d){if(newer)return;if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(Math.sign(fs.statSync(f).mtimeMs-built)===1){newer=true;break}}}for(const d of ['app','public','worker'])walk(d);process.exit(newer?1:0)" >nul 2>nul
if errorlevel 1 goto build
echo [2/3] หน้าเว็บพร้อมแล้ว
goto after_build

:build
echo [2/3] กำลัง build หน้าเว็บ...
call npm.cmd run build
if errorlevel 1 goto build_failed

:after_build
if "%CLIPPANG_LAUNCHER_CHECK_ONLY%"=="1" goto check_ok
echo [3/3] กำลังเปิด ClipPang ที่ http://127.0.0.1:4321
echo กด Ctrl+C เมื่อต้องการปิด ClipPang
echo.
call npm.cmd run local
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0
echo.
echo ClipPang หยุดทำงานด้วยรหัส %EXIT_CODE%
pause
exit /b %EXIT_CODE%

:check_ok
echo [3/3] ตรวจ Launcher ผ่านแล้ว
exit /b 0

:node_missing
echo ไม่พบ Node.js กรุณาติดตั้ง Node.js 22.13 ขึ้นไปจาก https://nodejs.org/
pause
exit /b 1

:node_old
for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
echo Node.js %NODE_VERSION% เก่าเกินไป กรุณาอัปเดตเป็น 22.13 ขึ้นไป
pause
exit /b 1

:npm_missing
echo ไม่พบ npm กรุณาติดตั้ง Node.js ใหม่จาก https://nodejs.org/
pause
exit /b 1

:install_failed
echo.
echo ติดตั้งแพ็กเกจไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่
pause
exit /b 1

:build_failed
echo.
echo Build หน้าเว็บไม่สำเร็จ กรุณาดูข้อความด้านบนแล้วลองใหม่
pause
exit /b 1
