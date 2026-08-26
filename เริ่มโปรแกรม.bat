@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   Clip360 Local
echo ========================================
echo.

rem ---- อัปเดตโปรเจกต์จาก Git ----
rem หลักการ: การอัปเดตห้ามทำให้เปิดโปรแกรมไม่ได้เด็ดขาด ทุกทางที่ผิดพลาดให้ข้ามไป
rem แล้วใช้เวอร์ชันที่มีอยู่ต่อ เพราะคนใช้ต้องการทำคลิป ไม่ได้ต้องการเวอร์ชันล่าสุด
rem GIT_TERMINAL_PROMPT=0 สำคัญมาก ไม่งั้น git จะค้างรอถามรหัสผ่านจนโปรแกรมไม่เปิด
set "GIT_TERMINAL_PROMPT=0"
if "%CLIP360_SKIP_UPDATE%"=="1" (echo [1/4] ข้ามการอัปเดตตามที่ตั้งไว้ ^& goto after_update)
if not exist ".git" goto update_nogit
where git >nul 2>nul
if errorlevel 1 goto update_nogit

rem แก้ไฟล์ค้างไว้ = ของผู้ใช้สำคัญกว่าเวอร์ชันล่าสุด อย่าไปทับ
git diff --quiet HEAD >nul 2>nul
if errorlevel 1 goto update_dirty

echo [1/4] กำลังตรวจอัปเดตจาก Git...
rem --ff-only กันไม่ให้เกิด merge commit ในเครื่องผู้ใช้ ถ้าประวัติแยกกันให้ข้ามไป
git pull --ff-only >nul 2>nul
if errorlevel 1 goto update_failed
for /f "delims=" %%V in ('git log -1 --format^=%%h 2^>nul') do set "GITREV=%%V"
echo    อัปเดตแล้ว (เวอร์ชัน %GITREV%)
goto after_update

:update_nogit
echo [1/4] ข้ามการอัปเดต - ไม่ได้ติดตั้งผ่าน Git
goto after_update

:update_dirty
echo [1/4] ข้ามการอัปเดต - มีไฟล์ที่แก้ไว้ในเครื่อง
goto after_update

:update_failed
echo [1/4] อัปเดตไม่สำเร็จ - ใช้เวอร์ชันที่มีอยู่ต่อ

:after_update
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
echo [2/4] แพ็กเกจพร้อมแล้ว
goto after_install

:install
echo [2/4] กำลังติดตั้งแพ็กเกจที่จำเป็น...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto install_failed

:after_install
if not exist "dist\server\index.js" goto build
node -e "const fs=require('fs'),p=require('path'),out='dist/server/index.js',built=fs.statSync(out).mtimeMs;let newer=false;for(const f of ['package.json','package-lock.json','vite.config.ts','next.config.ts']){if(fs.existsSync(f)){if(Math.sign(fs.statSync(f).mtimeMs-built)===1)newer=true}}function walk(d){if(newer)return;if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(Math.sign(fs.statSync(f).mtimeMs-built)===1){newer=true;break}}}for(const d of ['app','public','worker'])walk(d);process.exit(newer?1:0)" >nul 2>nul
if errorlevel 1 goto build
echo [3/4] หน้าเว็บพร้อมแล้ว
goto after_build

:build
echo [3/4] กำลัง build หน้าเว็บ...
call npm.cmd run build
if errorlevel 1 goto build_failed

:after_build
if "%CLIP360_LAUNCHER_CHECK_ONLY%"=="1" goto check_ok
echo [4/4] กำลังเปิด Clip360 ที่ http://127.0.0.1:4321
echo กด Ctrl+C เมื่อต้องการปิด Clip360
echo.
set "RESTARTS=0"

:run_server
call npm.cmd run local
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0

rem ออกด้วยรหัสที่ไม่ใช่ 0 = ล้มเอง ไม่ใช่ผู้ใช้สั่งปิด — เปิดใหม่ให้เลย
rem เครื่องนี้เปิดให้คนอื่นใช้ผ่านโดเมนด้วย ถ้าปล่อยดับไว้จะไม่มีใครรู้จนกว่าจะมีคนทัก
if %RESTARTS% GEQ 20 goto too_many_restarts
set /a RESTARTS=%RESTARTS%+1
echo.
echo Clip360 หยุดทำงานด้วยรหัส %EXIT_CODE% — เปิดใหม่ครั้งที่ %RESTARTS% ใน 3 วินาที
echo (กด Ctrl+C ตอนนี้ถ้าไม่ต้องการให้เปิดใหม่)
timeout /t 3 /nobreak >nul
goto run_server

:too_many_restarts
echo.
echo Clip360 ล้มซ้ำ %RESTARTS% ครั้งติดกัน หยุดเปิดใหม่แล้ว
echo กรุณาดูข้อความข้างบนเพื่อหาสาเหตุ
pause
exit /b %EXIT_CODE%

:check_ok
echo [4/4] ตรวจ Launcher ผ่านแล้ว
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
