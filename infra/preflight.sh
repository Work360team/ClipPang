#!/usr/bin/env bash
# Clip360 — preflight: วัดว่า VPS เครื่องนี้รันงานเรนเดอร์ไหวไหม
#
# รันบน VPS ที่เพิ่งเปิดเครื่อง ก่อนติดตั้งอะไรทั้งสิ้น (อ่านอย่างเดียว + stress test)
# ใช้เวลา ~5 นาที · ไม่ลงแพ็กเกจอะไรเลยนอกจาก curl ถ้ายังไม่มี
#
#   bash preflight.sh
#
# สามข้อที่หน้าเว็บผู้ให้บริการไม่เคยบอก และสคริปต์นี้วัดให้:
#   1. KVM หรือ container  → container = Chrome สตาร์ตไม่ขึ้น
#   2. CPU โดน throttle ไหมเมื่อรัน 100% ต่อเนื่อง  → งานเรนเดอร์ทำแบบนี้ทุกงาน
#   3. /dev/shm ใหญ่พอให้ Chrome ไหม

set -uo pipefail

PASS=0; WARN=0; FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

printf '\n\033[1mClip360 preflight\033[0m — %s\n' "$(date '+%Y-%m-%d %H:%M')"

# ---------- 1. virtualization ----------
head_ "1. ชนิดของเครื่อง"
VIRT="$(systemd-detect-virt 2>/dev/null || echo unknown)"
case "$VIRT" in
  kvm|qemu)      ok "virtualization = $VIRT — Chrome รันได้" ;;
  none)          ok "bare metal — Chrome รันได้" ;;
  lxc|openvz|lxc-libvirt)
                 bad "virtualization = $VIRT (container) — Chrome มักสตาร์ตไม่ขึ้นเพราะ user namespace ถูกปิด" ;;
  *)             warn "virtualization = $VIRT — ไม่รู้จัก ต้องทดสอบ Chrome จริงด้วย verify.sh" ;;
esac
grep -q 'unprivileged_userns_clone' /proc/sys/kernel/* 2>/dev/null && \
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ] && \
  warn "unprivileged_userns_clone = 0 → Chrome ต้องรันด้วย --no-sandbox"

# ---------- 2. CPU / RAM / disk ----------
head_ "2. สเปกเครื่อง"
CORES="$(nproc)"
MODEL="$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//')"
RAM_MB="$(free -m | awk '/^Mem:/{print $2}')"
SWAP_MB="$(free -m | awk '/^Swap:/{print $2}')"
DISK_FREE_MB="$(df -m --output=avail / | tail -1 | tr -d ' ')"
SHM_MB="$(df -m --output=size /dev/shm | tail -1 | tr -d ' ')"

printf '  CPU: %s\n  คอร์: %s · RAM: %s MB · swap: %s MB · ดิสก์ว่าง: %s MB\n' \
  "$MODEL" "$CORES" "$RAM_MB" "$SWAP_MB" "$DISK_FREE_MB"

[ "$CORES" -ge 4 ]            && ok "คอร์ $CORES — รันเลน B พร้อมกัน 2 งานได้"       || warn "คอร์ $CORES — เหลือ concurrency 1 งาน"
[ "$RAM_MB" -ge 7500 ]        && ok "RAM พอสำหรับ Chrome 2 ตัว + Redis"              || bad "RAM $RAM_MB MB น้อยเกินไป (ต้องการ ≥ 8GB)"
[ "$SHM_MB" -ge 1024 ]        && ok "/dev/shm = $SHM_MB MB"                          || warn "/dev/shm = $SHM_MB MB (< 1GB) → Chrome ต้องใช้ --disable-dev-shm-usage"
[ "$DISK_FREE_MB" -ge 40000 ] && ok "ดิสก์ว่างพอสำหรับไฟล์ชั่วคราว"                   || warn "ดิสก์ว่าง $DISK_FREE_MB MB — ProRes ระหว่างทางกินครั้งละ ~100MB"
[ "$SWAP_MB" -ge 2048 ]       && ok "มี swap $SWAP_MB MB"                            || warn "ไม่มี swap — provision.sh จะสร้างให้ 4GB กัน Chrome โดน OOM kill"

# ---------- 3. CPU throttle ----------
head_ "3. รัน CPU 100% ต่อเนื่อง 3 นาที (หา throttle)"
echo "  งานเรนเดอร์กิน CPU เต็มครั้งละ 1–3 นาทีทุกงาน ถ้าผู้ให้บริการ throttle จะเห็นตรงนี้"

cpu_window() { # $1 = วินาที, $2 = จำนวน process
  local secs="$1" procs="$2" tmp total=0 f
  tmp="$(mktemp -d)"
  for ((i = 0; i < procs; i++)); do
    (
      end=$((SECONDS + secs)); n=0
      while ((SECONDS < end)); do n=$((n + 1)); done
      echo "$n" > "$tmp/$i"
    ) &
  done
  wait
  for f in "$tmp"/*; do total=$((total + $(cat "$f"))); done
  rm -rf "$tmp"
  echo "$total"
}

FIRST=0; LAST=0; MIN=0; MAX=0
for w in 1 2 3 4 5 6; do
  N="$(cpu_window 30 "$CORES")"
  printf '  ช่วงที่ %s (30 วิ): %s ops\n' "$w" "$N"
  [ "$w" = 1 ] && { FIRST="$N"; MIN="$N"; MAX="$N"; }
  [ "$N" -lt "$MIN" ] && MIN="$N"
  [ "$N" -gt "$MAX" ] && MAX="$N"
  LAST="$N"
done

RATIO=$(( LAST * 100 / (FIRST > 0 ? FIRST : 1) ))
SPREAD=$(( (MAX - MIN) * 100 / (MAX > 0 ? MAX : 1) ))
printf '  ช่วงสุดท้าย = %s%% ของช่วงแรก · แกว่ง %s%%\n' "$RATIO" "$SPREAD"
if [ "$RATIO" -ge 90 ] && [ "$SPREAD" -le 15 ]; then
  ok "ไม่มีสัญญาณ throttle — รันงานยาวได้"
elif [ "$RATIO" -ge 75 ]; then
  warn "ประสิทธิภาพตกเล็กน้อย อาจเป็นเพื่อนบ้านแย่ง CPU — รันซ้ำคนละช่วงเวลาเพื่อยืนยัน"
else
  bad "ตกเหลือ $RATIO% — เครื่องนี้ถูก throttle เมื่อรันงานยาว ไม่เหมาะกับงานเรนเดอร์"
fi

# ---------- 4. disk ----------
head_ "4. ความเร็วดิสก์"
DD_OUT="$(dd if=/dev/zero of=./_ddtest bs=1M count=1024 oflag=direct conv=fdatasync 2>&1 | tail -1)"
rm -f ./_ddtest
echo "  $DD_OUT"
DD_MBS="$(echo "$DD_OUT" | grep -oE '[0-9.]+ MB/s' | grep -oE '[0-9.]+' | head -1)"
if [ -n "$DD_MBS" ] && [ "${DD_MBS%.*}" -ge 150 ]; then
  ok "เขียน ${DD_MBS} MB/s — SSD จริง"
else
  warn "เขียน ${DD_MBS:-?} MB/s — ช้ากว่าที่ควรสำหรับ SSD จะกระทบขั้นเขียนเฟรม"
fi

# ---------- 5. network ----------
head_ "5. ความเร็วเน็ต (ดาวน์โหลดจาก Cloudflare — ปลายทางเดียวกับ R2)"
command -v curl >/dev/null || { echo "  ติดตั้ง curl…"; apt-get -qq update && apt-get -qq install -y curl; }
NET="$(curl -o /dev/null -s -w '%{speed_download}' --max-time 60 \
       'https://speed.cloudflare.com/__down?bytes=104857600' 2>/dev/null || echo 0)"
NET_MBPS=$(( ${NET%.*} * 8 / 1000000 ))
NET_MBS=$(( ${NET%.*} / 1000000 ))
printf '  ดาวน์โหลด ~%s MB/s (~%s Mbps)\n' "$NET_MBS" "$NET_MBPS"
if [ "$NET_MBPS" -ge 80 ]; then
  ok "เต็มพอร์ต 100 Mbps"
elif [ "$NET_MBPS" -ge 40 ]; then
  warn "ได้ครึ่งพอร์ต — ขั้น ingest ไฟล์ใหญ่จะช้า ต้อง normalize ครั้งเดียวให้ได้จริง"
else
  bad "ช้ากว่า 40 Mbps — ดึงคลิปต้นทางจะกลายเป็นคอขวดแทนการเรนเดอร์"
fi

# ---------- สรุป ----------
head_ "สรุป"
printf '  ผ่าน %s · เตือน %s · ไม่ผ่าน %s\n\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  \033[31mเครื่องนี้ยังไม่เหมาะ\033[0m — แก้ข้อที่ ✗ หรือเปลี่ยนเครื่อง/ผู้ให้บริการก่อน\n\n'
  exit 1
fi
printf '  \033[32mผ่านขั้นนี้\033[0m — รัน provision.sh ต่อได้ แล้วปิดท้ายด้วย verify.sh\n\n'
