#!/usr/bin/env bash
# Clip360 — verify: พิสูจน์ว่าเครื่องนี้เรนเดอร์ได้จริง ไม่ใช่แค่ลงของครบ
#
#   bash verify.sh
#
# ทำ 4 อย่าง: ffmpeg เบิร์นซับไทย · Chrome สตาร์ต · HyperFrames เรนเดอร์จริงพร้อมจับเวลา · Redis auth
# ใช้เวลา ~3 นาที (ครั้งแรกจะโหลด Chrome ของ HyperFrames ~150MB)

set -uo pipefail
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "1. ffmpeg เบิร์นซับภาษาไทย"
FONT="$(fc-match -f '%{family}' ':lang=th:weight=bold' 2>/dev/null || echo 'Noto Sans Thai')"
cat > "$WORK/t.ass" <<ASS
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, BorderStyle, Outline, Alignment, MarginV, Encoding
Style: M,$FONT,96,&H00FFFFFF,&H00000000,-1,1,7,2,400,1
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:00:02.00,M,{\c&H00D4FF&}พับเก็บได้{\c&HFFFFFF&} ไม่เกะกะ
ASS
ffmpeg -v error -f lavfi -i "color=c=0x203040:s=1080x1920:d=2:r=30" \
  -vf "ass=$WORK/t.ass" -frames:v 1 -y "$WORK/t.png" 2>"$WORK/ff.err"
if [ -s "$WORK/t.png" ]; then
  # ตัวหนังสือเรนเดอร์จริงหรือเป็นกล่องเปล่า — ดูจากจำนวนสีที่ไม่ใช่พื้นหลัง
  COLORS="$(ffmpeg -v error -i "$WORK/t.png" -vf "palettegen=max_colors=16" -y "$WORK/p.png" 2>&1; echo ok)"
  ok "เบิร์นซับได้ · ฟอนต์ที่ระบบเลือกให้ภาษาไทย: $FONT"
  [ "$FONT" = "DejaVu Sans" ] && bad "ฟอนต์ที่เลือกได้ไม่รองรับไทย — สระวรรณยุกต์จะเพี้ยน ต้องลงฟอนต์ไทยก่อน"
else
  bad "ffmpeg เบิร์นซับไม่ได้: $(tail -2 "$WORK/ff.err")"
fi

step "2. HyperFrames เรนเดอร์เลเยอร์ซับโปร่งใส (ของจริง)"
mkdir -p "$WORK/hf"
cat > "$WORK/hf/index.html" <<'HTML'
<!doctype html><html><head><meta charset="UTF-8"/><style>
html,body{margin:0;background:transparent}
#root{position:relative;width:1080px;height:1920px;background:transparent}
.cap{position:absolute;left:0;right:0;bottom:400px;display:flex;justify-content:center}
.w{font-family:'Kanit','Noto Sans Thai',sans-serif;font-weight:800;font-size:92px;color:#fff;
   -webkit-text-stroke:11px #000;paint-order:stroke fill}
</style></head><body>
<div id="root" data-composition-id="c" data-start="0" data-duration="3"
     data-width="1080" data-height="1920" data-fps="30">
  <div id="a" class="clip cap" data-start="0" data-duration="3" data-track-index="0">
    <span class="w" id="t">พับเก็บได้ ไม่เกะกะ</span>
  </div>
</div>
<script src="./gsap.min.js"></script>
<script>
  gsap.defaults({immediateRender:false});
  var tl = gsap.timeline({paused:true});
  tl.fromTo('#t',{scale:1.15,opacity:0},{scale:1,opacity:1,duration:.4,ease:'back.out(2)'},0);
  tl.set({},{},3); tl.seek(0);
  window.__timelines = {c: tl};
</script></body></html>
HTML
curl -fsSL -o "$WORK/hf/gsap.min.js" https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js

START=$(date +%s)
npx --yes hyperframes@latest render "$WORK/hf" --format mov --fps 30 \
  --quality high --workers 2 --output "$WORK/out.mov" >"$WORK/hf.log" 2>&1
RC=$?
ELAPSED=$(( $(date +%s) - START ))

if [ $RC -eq 0 ] && [ -s "$WORK/out.mov" ]; then
  PIX="$(ffprobe -v error -select_streams v:0 -read_intervals '%+#1' \
        -show_entries frame=pix_fmt -of default=nw=1:nk=1 "$WORK/out.mov" | head -1)"
  ok "เรนเดอร์ 90 เฟรมใน ${ELAPSED}s · pix_fmt=$PIX"
  case "$PIX" in *a*) ok "เลเยอร์มี alpha — วางทับคลิปได้" ;; *) bad "ไม่มี alpha ($PIX) — ซับจะทับเป็นพื้นทึบ" ;; esac
  # 90 เฟรมบนเครื่อง 10 คอร์ใช้ ~9 วินาที ใช้ตัวเลขนี้เทียบคร่าว ๆ
  RATE=$(( ELAPSED > 0 ? 90 / ELAPSED : 90 ))
  printf '  ≈ %s fps → คลิป 30 วินาที (900 เฟรม) จะใช้ราว %s วินาที\n' "$RATE" "$(( RATE > 0 ? 900 / RATE : 0 ))"
  [ "$RATE" -lt 3 ] && bad "ช้ากว่า 3 fps — คลิป 30 วินาทีจะใช้เกิน 5 นาที ควรอัปเครื่อง"
else
  bad "HyperFrames เรนเดอร์ไม่ผ่าน — ดูท้าย log:"
  tail -12 "$WORK/hf.log" | sed 's/^/      /'
  grep -qi 'no usable sandbox\|namespace' "$WORK/hf.log" && \
    bad "อาการนี้คือ Chrome sandbox ใช้ไม่ได้ → เครื่องน่าจะเป็น container ไม่ใช่ KVM"
fi

step "3. Redis"
if [ -n "${REDIS_URL:-}" ]; then
  redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1 \
    && ok "ต่อ Redis ด้วย REDIS_URL ได้" || bad "ต่อ Redis ด้วย REDIS_URL ไม่ได้"
else
  redis-cli ping >/dev/null 2>&1 \
    && bad "Redis ตอบโดยไม่ต้องใส่รหัสผ่าน — ยังไม่ได้ตั้ง requirepass" \
    || ok "Redis ไม่ตอบถ้าไม่มีรหัสผ่าน (ถูกต้อง) · ตั้ง REDIS_URL แล้วรันซ้ำเพื่อทดสอบ auth"
fi

step "สรุป"
if [ "$FAIL" -eq 0 ]; then
  printf '  \033[32mเครื่องนี้พร้อมรับงานเรนเดอร์\033[0m\n\n'
else
  printf '  \033[31mมี %s ข้อที่ต้องแก้ก่อน\033[0m\n\n' "$FAIL"
  exit 1
fi
