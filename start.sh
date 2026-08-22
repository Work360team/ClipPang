#!/usr/bin/env sh
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR" || exit 1

echo ""
echo "========================================"
echo "  ClipPang Local"
echo "========================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "ไม่พบ Node.js กรุณาติดตั้ง Node.js 22.13 ขึ้นไปจาก https://nodejs.org/" >&2
  exit 1
fi

if ! node -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>22||(v[0]===22&&(v[1]>13||(v[1]===13&&v[2]>=0)))?0:1)' >/dev/null 2>&1; then
  echo "Node.js $(node -p 'process.versions.node') เก่าเกินไป กรุณาอัปเดตเป็น 22.13 ขึ้นไป" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ไม่พบ npm กรุณาติดตั้ง Node.js ใหม่จาก https://nodejs.org/" >&2
  exit 1
fi

NEED_INSTALL=0
if [ ! -f "node_modules/.package-lock.json" ] || [ ! -f "node_modules/hyperframes/package.json" ]; then
  NEED_INSTALL=1
elif [ "package-lock.json" -nt "node_modules/.package-lock.json" ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  echo "[1/3] กำลังติดตั้งแพ็กเกจที่จำเป็น..."
  if ! npm install --no-audit --no-fund; then
    echo "ติดตั้งแพ็กเกจไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง" >&2
    exit 1
  fi
else
  echo "[1/3] แพ็กเกจพร้อมแล้ว"
fi

BUILD_OUTPUT="dist/server/index.js"
NEED_BUILD=0
if [ ! -f "$BUILD_OUTPUT" ]; then
  NEED_BUILD=1
else
  for FILE in package.json package-lock.json vite.config.ts next.config.ts; do
    if [ -f "$FILE" ] && [ "$FILE" -nt "$BUILD_OUTPUT" ]; then
      NEED_BUILD=1
      break
    fi
  done
  if [ "$NEED_BUILD" -eq 0 ]; then
    for DIR in app public worker; do
      if [ -d "$DIR" ] && find "$DIR" -type f -newer "$BUILD_OUTPUT" -print -quit | grep -q .; then
        NEED_BUILD=1
        break
      fi
    done
  fi
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  echo "[2/3] กำลัง build หน้าเว็บครั้งแรก..."
  if ! npm run build; then
    echo "Build หน้าเว็บไม่สำเร็จ กรุณาดูข้อความด้านบนแล้วลองอีกครั้ง" >&2
    exit 1
  fi
else
  echo "[2/3] หน้าเว็บพร้อมแล้ว"
fi

if [ "${CLIPPANG_LAUNCHER_CHECK_ONLY:-0}" = "1" ]; then
  echo "[3/3] Launcher check passed."
  exit 0
fi

echo "[3/3] กำลังเปิด ClipPang ที่ http://127.0.0.1:4321"
echo "กด Ctrl+C เมื่อต้องการปิดโปรแกรม"
echo ""

# ออกด้วยรหัส 0 = ผู้ใช้สั่งปิดเอง · รหัสอื่น = ล้มเอง ให้เปิดใหม่
# เครื่องที่เปิดให้คนอื่นใช้ผ่านโดเมนด้วย ถ้าดับแล้วไม่มีใครรู้จนกว่าจะมีคนทัก
restarts=0
while true; do
  npm run local
  code=$?
  [ "$code" -eq 0 ] && exit 0
  # 130 = Ctrl+C, 143 = SIGTERM — ทั้งคู่คือคนสั่งปิด ไม่ใช่ของล้ม
  if [ "$code" -eq 130 ] || [ "$code" -eq 143 ]; then exit "$code"; fi
  restarts=$((restarts + 1))
  if [ "$restarts" -ge 20 ]; then
    echo ""
    echo "ClipPang ล้มซ้ำ $restarts ครั้งติดกัน หยุดเปิดใหม่แล้ว — ดูข้อความข้างบนเพื่อหาสาเหตุ" >&2
    exit "$code"
  fi
  echo ""
  echo "ClipPang หยุดทำงานด้วยรหัส $code — เปิดใหม่ครั้งที่ $restarts ใน 3 วินาที"
  sleep 3
done
