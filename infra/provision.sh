#!/usr/bin/env bash
# Clip360 — provision: ติดตั้งทุกอย่างที่ worker ต้องใช้บน Ubuntu 22.04/24.04
#
#   sudo bash provision.sh --plesk-ip <ไอพีของเซิร์ฟเวอร์ Plesk>
#
# ติดตั้ง: Node 22 · ffmpeg · Chrome + ฟอนต์ไทย · Redis (มีรหัสผ่าน) · swap · ufw · systemd unit
# ทุกขั้นตอน idempotent — รันซ้ำได้ไม่พัง

set -euo pipefail

PLESK_IP=""
APP_USER="clip360"
APP_DIR="/opt/clip360"
REDIS_PASS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --plesk-ip)    PLESK_IP="$2"; shift 2 ;;
    --redis-pass)  REDIS_PASS="$2"; shift 2 ;;
    --user)        APP_USER="$2"; shift 2 ;;
    *) echo "ไม่รู้จักตัวเลือก $1"; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย sudo"; exit 1; }
[ -n "$PLESK_IP" ] || { echo "ต้องระบุ --plesk-ip <ip> เพื่อจำกัดว่าใครเข้า Redis ได้"; exit 1; }
[ -n "$REDIS_PASS" ] || REDIS_PASS="$(openssl rand -base64 36 | tr -d '/+=' | head -c 40)"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "อัปเดตระบบ"
export DEBIAN_FRONTEND=noninteractive
apt-get -qq update
apt-get -qq install -y ca-certificates curl gnupg git ufw unzip xz-utils

step "swap 4GB (กัน Chrome โดน OOM kill ตอน RAM ตึง)"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -qw vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "  สร้าง swap แล้ว"
else
  echo "  มี swap อยู่แล้ว ข้าม"
fi

step "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get -qq install -y nodejs
fi
echo "  node $(node -v) · npm $(npm -v)"

step "ffmpeg (ต้องมี libass สำหรับซับเลน A)"
apt-get -qq install -y ffmpeg
ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' ass ' \
  && echo "  ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3) · มี libass" \
  || { echo "  ffmpeg ไม่มี libass — ซับเลน A จะใช้ไม่ได้"; exit 1; }

step "Chrome + ไลบรารีที่ headless ต้องใช้"
apt-get -qq install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
  libpango-1.0-0 libcairo2 libatspi2.0-0 2>/dev/null || \
apt-get -qq install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 libatspi2.0-0

step "ฟอนต์ไทย (Kanit + Noto Sans Thai) — ไม่มีฟอนต์ = ซับขึ้นเป็นกล่องสี่เหลี่ยม"
apt-get -qq install -y fonts-noto-core fontconfig
install -d /usr/local/share/fonts/clip360
for W in Regular SemiBold Bold ExtraBold; do
  F="/usr/local/share/fonts/clip360/Kanit-$W.ttf"
  [ -f "$F" ] || curl -fsSL -o "$F" \
    "https://raw.githubusercontent.com/google/fonts/main/ofl/kanit/Kanit-$W.ttf"
done
NOTO="/usr/local/share/fonts/clip360/NotoSansThai-Bold.ttf"
[ -f "$NOTO" ] || curl -fsSL -o "$NOTO" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf" || true
fc-cache -f >/dev/null
echo "  ฟอนต์ไทยที่ระบบเห็น: $(fc-list :lang=th family | sort -u | tr '\n' ' ' | cut -c1-120)"

step "Redis (ตั้งรหัสผ่าน + ให้เข้าได้เฉพาะ Plesk)"
apt-get -qq install -y redis-server
CONF=/etc/redis/redis.conf
cp -n "$CONF" "$CONF.orig"
sed -i "s/^# *requirepass .*/requirepass $REDIS_PASS/; s/^requirepass .*/requirepass $REDIS_PASS/" "$CONF"
grep -q "^requirepass" "$CONF" || echo "requirepass $REDIS_PASS" >> "$CONF"
sed -i 's/^bind .*/bind 0.0.0.0/' "$CONF"
sed -i 's/^protected-mode .*/protected-mode no/' "$CONF"
# BullMQ ต้องการ noeviction — ถ้า Redis ทิ้งคีย์ทิ้ง งานในคิวจะหายเงียบ ๆ
grep -q '^maxmemory-policy noeviction' "$CONF" || echo 'maxmemory-policy noeviction' >> "$CONF"
systemctl enable --now redis-server >/dev/null
systemctl restart redis-server
redis-cli -a "$REDIS_PASS" --no-auth-warning ping >/dev/null && echo "  Redis ตอบ PONG"

step "ไฟร์วอลล์ — เปิด Redis ให้เฉพาะ IP ของ Plesk"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow from "$PLESK_IP" to any port 6379 proto tcp >/dev/null
ufw --force enable >/dev/null
echo "  พอร์ต 6379 เปิดให้ $PLESK_IP เท่านั้น · SSH เปิดทุกที่"

step "ผู้ใช้และโฟลเดอร์แอป"
id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$APP_DIR/tmp"

step "systemd unit สำหรับ worker"
cat > /etc/systemd/system/clip360-worker.service <<UNIT
[Unit]
Description=Clip360 render worker
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node apps/worker/index.mjs
Restart=always
RestartSec=5
# ให้เวลางานที่ค้างอยู่ทำจนจบก่อนดับ ไม่งั้น deploy ทีงานหายที
KillSignal=SIGTERM
TimeoutStopSec=150
# กันงานเดียวกินเครื่องทั้งลูก
MemoryMax=6G
Nice=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
echo "  สร้าง clip360-worker.service แล้ว (ยังไม่ start เพราะยังไม่มีโค้ด)"

step "cron ล้างไฟล์ชั่วคราว — ดิสก์เต็มคือสาเหตุอันดับหนึ่งที่ระบบวิดีโอล่ม"
cat > /etc/cron.daily/clip360-cleanup <<CRON
#!/bin/sh
find $APP_DIR/tmp -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf {} +
find /tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -mtime +1 -exec rm -rf {} +
CRON
chmod +x /etc/cron.daily/clip360-cleanup

cat <<SUMMARY

$(printf '\033[1mเสร็จแล้ว\033[0m')

เอาค่านี้ไปใส่ .env ฝั่ง Plesk:

  REDIS_URL=redis://:$REDIS_PASS@$(curl -s -4 ifconfig.me 2>/dev/null || echo '<ไอพี-vps>'):6379

เก็บรหัสผ่านนี้ไว้ให้ดี ไม่ได้บันทึกไว้ที่อื่น:

  $REDIS_PASS

ขั้นต่อไป
  1. bash verify.sh          ทดสอบ Chrome + ffmpeg + เรนเดอร์จริง
  2. เอาโค้ดขึ้น $APP_DIR แล้ว systemctl start clip360-worker
  3. deploy probe/ ขึ้น Plesk เพื่อทดสอบ SSE และการต่อ Redis ข้ามเครื่อง

หมายเหตุความปลอดภัย: Redis เปิดออกอินเทอร์เน็ตโดยมีรหัสผ่าน + ufw จำกัด IP
ถ้า IP ของ Plesk เปลี่ยนได้ (dynamic) ให้เปลี่ยนไปใช้ WireGuard แทนการเปิดพอร์ตตรง
SUMMARY
