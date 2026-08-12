# clippang-spike — สัปดาห์ที่ 1

CLI ตัวเดียวที่รันจบตั้งแต่ `mp4 หลายไฟล์ + ข้อมูลสินค้า` → `คลิปพร้อมโพสต์`
ไม่มีเว็บ ไม่มี DB

เป้าหมายของ spike นี้ไม่ใช่ความสวย แต่คือ **พิสูจน์ว่าตัวเลขใน blueprint จริงหรือเปล่า**
ก่อนจะลงแรงเขียน API และ UI

---

## ต้องมีอะไรบ้าง

| | |
|---|---|
| Node.js | ≥ 22 (ทดสอบบน 26.3.1) |
| ffmpeg + ffprobe | ต้องมี libass — build ของ gyan.dev บน Windows ใช้ได้เลย |
| `npm install` | เฉพาะเลน B (HyperFrames) · โค้ดหลักไม่มี dependency เลย |

```bash
npm install          # ติดตั้ง hyperframes (ใช้เฉพาะเลน B)
cp .env.example .env # แล้วเติม API key เท่าที่มี
```

ฟอนต์ Kanit และ GSAP ถูก vendor ไว้ในโปรเจกต์แล้ว (`fonts/`, `vendor/`) ถ้าหายให้ดึงใหม่:

```bash
curl -Lo fonts/Kanit-ExtraBold.ttf https://raw.githubusercontent.com/google/fonts/main/ofl/kanit/Kanit-ExtraBold.ttf
curl -Lo vendor/gsap.min.js https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js
```

---

## เริ่มใช้

```bash
node src/cli.mjs --in ../asset --brief brief.example.json --duration 20
```

ได้ผลลัพธ์ใน `out/<ชื่อสินค้า>-<เวลา>/`

```
final.mp4      คลิปพร้อมโพสต์ 1080×1920 30fps
poster.jpg     ภาพปก
captions.ass   ซับของเลน A (แก้แล้ว re-render ได้)
captions.srt   ซับสำหรับอัปโหลดแยก
voice.wav      เสียงพากย์อย่างเดียว
script.json    สคริปต์ทั้ง 5 เวอร์ชัน
timeline.json  timeline ที่ใช้จริง — ทั้งซับและภาพอ้างอิงไฟล์นี้ไฟล์เดียว
report.json    เวลาแต่ละ stage + ต้นทุนประมาณการ
```

---

## สองเลนของซับ

**เลน B (`kanit-hf` + Gemini TTS) คือค่าเริ่มต้นที่เลือกใช้แล้ว** — เลน A ยังอยู่ในระบบสำหรับ
โหมดร่างและ batch เพราะ 10 คลิปต่อสินค้าด้วยเลน B กินเวลา ~20 นาที

เลือกด้วย `--style` ระบบดูค่า `lane` ในไฟล์สไตล์แล้วเลือกเส้นทางเอง ผู้ใช้ไม่ต้องรู้

| | เลน A · libass | เลน B · HyperFrames |
|---|---|---|
| สไตล์ | `karaoke-pop` `box-bold` `reveal-clean` | `kanit-hf` |
| วิธีทำงาน | คอมไพล์ `.ass` แล้วให้ ffmpeg เบิร์นลงภาพ | คอมไพล์ composition HTML → Chrome เรนเดอร์เป็นเลเยอร์โปร่งใส → ffmpeg วางทับ |
| เวลา (คลิป 16 วิ) | **~3 วินาที** | **~64 วินาที** (479 เฟรม ≈ 7.5 fps) |
| ฟอนต์ | ฟอนต์ที่ติดตั้งในเครื่อง | ฝังเป็น data URI ในไฟล์ composition |
| ทำอะไรได้ | สี ขอบ เงา เด้ง ไฮไลต์รายคำ | ทุกอย่างที่ CSS/GSAP ทำได้ — เบลอเข้า ยกตัว เด้งแบบ back-ease |

```bash
node src/cli.mjs --in ../asset --brief brief.example.json --style karaoke-pop   # เลน A
node src/cli.mjs --in ../asset --brief brief.example.json --style kanit-hf      # เลน B
```

เลน B ไม่แตะคลิปต้นฉบับเลย — เรนเดอร์เฉพาะตัวหนังสือออกมาเป็นไฟล์ที่มี alpha
แล้วค่อยวางทับด้วย ffmpeg คลิปจึงไม่ถูก re-encode ผ่าน Chrome

---

## ตัวเลือกที่ใช้บ่อย

```
--position top | middle | bottom   ตำแหน่งซับ (ทับค่าของสไตล์)
--margin-v 400            ระยะห่างจากขอบที่ยึด — top วัดจากขอบบน, bottom วัดจากขอบล่าง,
                          middle ไม่ใช้ค่านี้
--style karaoke-pop | box-bold | reveal-clean | kanit-hf   (--list-styles)
--tts   auto | gemini | edge | silence                     (--list-voices)
--voice <id>              เสียงของ provider นั้น
--speed 1.0               ความเร็วพูด 0.8–1.3
--variant v1..v5          เลือกเวอร์ชันสคริปต์
--duration 20             ความยาวเป้าหมาย (วินาที)
--bgm song.mp3            เพลงประกอบ + ducking อัตโนมัติ
--on-burned raise|ignore  เจอซับเดิมในคลิปแล้วจะยกซับใหม่ขึ้นหรือไม่
--overlay-format mov|webm รูปแบบเลเยอร์ซับของเลน B
--keep-work               เก็บไฟล์ระหว่างทาง (seg/, hf/, video.mp4) ไว้ตรวจ
```

---

## ตำแหน่งซับ

รองรับ 3 ตำแหน่ง เหมือนกันทั้งสองเลน เก็บเป็น `position.anchor` ในไฟล์สไตล์ และทับได้ด้วย `--position`

```bash
node src/cli.mjs --in ../asset --brief brief.example.json --position top
```

| anchor | ASS `Alignment` | CSS ของเลน B | `marginV` หมายถึง |
|---|---|---|---|
| `top` | 8 | `top: <marginV>px` | ห่างจากขอบบน |
| `middle` | 5 | `top:50%; translateY(-50%)` | ไม่ใช้ |
| `bottom` | 2 | `bottom: <marginV>px` | ห่างจากขอบล่าง |

การยกซับหนีซับเบิร์นเดิมอัตโนมัติ **ทำงานเฉพาะตอน anchor เป็น `bottom`** เท่านั้น
เพราะ top กับ middle พ้นแถบซับเดิมอยู่แล้ว

---

## API key

| ขั้นตอน | มี key | ไม่มี key |
|---|---|---|
| เขียนสคริปต์ | Claude — คอปปี้ขายของภาษาไทยระดับใช้งานจริง | ตัวสร้าง template ออฟไลน์ (อ่านรู้เรื่อง แต่ไม่ขาย) |
| พากย์เสียง | Gemini TTS — 30 เสียง คุมอารมณ์ได้ | `edge-tts` ในโฟลเดอร์ `.venv` |

> `edge-tts` เป็นบริการที่ไม่มี SLA และไม่มีสัญญาเชิงพาณิชย์ — **ใช้ได้แค่ตอน spike**

ติดตั้ง edge-tts (ทำครั้งเดียว):

```bash
python -m venv .venv && .venv/Scripts/python -m pip install edge-tts
```

---

## ผลวัดจริงจากคลิปตัวอย่าง

คลิปจีน 720×1280 / 29.7 วินาที หนึ่งไฟล์ → คลิป 1080×1920

| Stage | เลน A + edge-tts | เลน B + Gemini TTS |
|---|---:|---:|
| Ingest + Analyze | 1.6s | 1.4s |
| Script (template ออฟไลน์) | 0.0s | 0.0s |
| Voice — 7 ท่อน ยิงใหม่ | 8.7s | 10.1s |
| Voice — โดนแคช | 0.2s | 0.5s |
| Timeline | 0.0s | 0.0s |
| Caption | 0.0s | **63.6s** |
| Compose | 4.2s | 3.3s |
| Mix | 0.7s | 0.6s |
| Package | 7.8s | 8.1s |
| **รวม (แคชแล้ว)** | **~14s** | **~77s** |

blueprint ประเมินเลน A ไว้ 40–55 วินาที และเลน B ไว้ 90–180 วินาที
ของจริง **เลน A เร็วกว่าที่ประเมิน 3 เท่า และเลน B เร็วกว่าขอบล่างของช่วงที่ประเมิน**

### สิ่งที่วัดได้แล้วต้องแก้จากที่เดาไว้ใน blueprint

1. **ความเร็วพูดไทยต่างกันตาม provider** — ต้องวัดต่อเสียง ไม่ใช่ค่าคงที่ค่าเดียว
   | provider · เสียง | grapheme/วินาที |
   |---|---:|
   | edge-tts · th-TH-Premwadee | 6.4 |
   | Gemini TTS · Kore | 9.1 |

   ค่านี้อยู่ใน `.env` → `SPEAK_GRAPHEMES_PER_SEC` ใช้แค่ตอนกะความยาวสคริปต์
   (เวลาจริงยังมาจาก `ffprobe` เสมอ) blueprint เดาไว้ 13 ตัวอักษร/วินาที — ผิดไปเท่าตัว

2. **Gemini TTS free tier ยิงขนานไม่ได้** — ยิงพร้อมกัน 4 คำขอโดน 429 ทันที
   ตอนนี้ยิงทีละคำขอ และอ่าน `retryDelay` ที่ Google ส่งกลับมาเป็นตัวกำหนดเวลารอ
   (ปรับด้วย `GEMINI_TTS_CONCURRENCY` เมื่อขึ้น paid tier)
   ยิงจริงใช้เวลา 3.1–5.5 วินาทีต่อท่อน ⇒ **แคช TTS ไม่ใช่ของฟุ่มเฟือย มันคือสิ่งที่ทำให้ทดลองซ้ำได้**

3. **ตัวตรวจซับเบิร์นต้องเทียบสองแถบ** — วัดความหนาแน่นขอบเฉพาะแถบล่างอย่างเดียวใช้ไม่ได้
   ต้องเทียบกับแถบกลางภาพ และเก็บ 3 จุดเวลาแล้วใช้ค่าสูงสุด เพราะซับโผล่แค่บางช่วง
   (คลิปตัวอย่างได้ ratio 2.97 → เกินเกณฑ์ 2.2 → ระบบยกซับใหม่ขึ้น 300px เอง)

4. **ไม่ต้องใช้ PyThaiNLP** — `Intl.Segmenter('th')` ที่ติดมากับ Node ตัดคำไทยได้เลย
   แต่ตัดละเอียดเกิน (`พก|พา`) จึงต้องมีขั้นรวมเศษสั้นกลับเข้ากับคำข้างเคียง

5. **webm ของ HyperFrames 0.7.106 ไม่มี alpha จริง** — ตรวจแล้วทั้งระดับ stream และ frame
   ได้ `yuv420p` ทั้งคู่ ต้องใช้ `mov` (ProRes 4444) ไฟล์ใหญ่กว่ามาก (45MB ต่อ 16 วินาที)
   แต่เป็นแค่ไฟล์ระหว่างทาง

### บั๊กที่เจอตอนตรวจภาพ (unit test จับไม่ได้)

- **ไฮไลต์คำไม่ขึ้นสี** — inline color tag ของ ASS ต้องเป็น 6 หลักปิดท้ายด้วย `&`
  (ต่างจากใน Style block ที่เป็น 8 หลักรวม alpha) libass parse ไม่ผ่านแล้วเงียบ ๆ
  ถอยไปใช้สีของ style โดยไม่มี error ให้เห็น
- **ช่องว่างระหว่างคำหายในเลน B** — ตอนตัดคำ ช่องว่างถูกผนวกไว้ท้ายคำแล้ว จึงต้องเช็ค
  จากข้อความต้นฉบับ ไม่ใช่ช่องว่างระหว่าง index ของคำ
- **บรรทัดล้นแล้วเหลือคำเดียวห้อย** — ต้องย่อฟอนต์ต่อท่อนให้พอดีหนึ่งบรรทัด
  ห้ามปล่อยให้ flex-wrap ตัดเอง
- **สองเลนตีความ `marginV` คนละแบบ** — เลน A ใช้ระยะจากขอบล่างตามมาตรฐาน ASS
  แต่เลน B เขียนเป็น `height - marginV` สไตล์เดียวกันจึงไปโผล่คนละที่ (ห่างกัน 500px)
  แก้แล้วโดยย้ายการตีความไปไว้ที่ `core.mjs` ให้ทั้งสองเลนเรียกฟังก์ชันเดียวกัน

---

## สถาปัตยกรรมของโค้ด

| ไฟล์ | หน้าที่ | จะกลายเป็น |
|---|---|---|
| `core.mjs` | ตัดคำไทย · ตัดท่อน · ประกอบ timeline · duration fitting | `packages/core` |
| `media.mjs` | probe · scene detect · normalize · concat | `packages/media` |
| `ass.mjs` | คอมไพล์ซับเลน A | `packages/media/ass` |
| `hyperframes.mjs` | คอมไพล์ composition + เรนเดอร์เลเยอร์ซับเลน B | `packages/media/hyperframes` |
| `render.mjs` | ประกอบภาพ+เสียง · เบิร์น/วางทับ · mux | `packages/media/render` |
| `script.mjs` | brief → สคริปต์ (Claude / template) | `packages/ai` |
| `tts.mjs` | TTSProvider interface + 3 เจ้า + แคช | `packages/ai/tts` |
| `cli.mjs` | ลำดับ 10 stage | จะถูกแทนด้วย worker ที่กินคิว |
| `styles/*.json` | สไตล์ซับทั้งสองเลน | จะย้ายไป collection `captionStyles` |

`core.mjs` ไม่แตะ I/O เลย — เขียน unit test ได้ทันทีโดยไม่ต้องมีไฟล์วิดีโอ

### หลักการที่ห้ามหลุด

- **timeline.json เป็นแหล่งความจริงเดียว** ทั้งซับ (ทั้งสองเลน) และภาพอ่านจากไฟล์เดียวกัน
  ซับจึงตรงเสียงโดยโครงสร้าง ไม่ใช่โดยบังเอิญ — และสลับเลนได้โดยไม่ต้องคำนวณเวลาใหม่
- **ความยาวเสียงมาจาก ffprobe เสมอ** ห้ามประมาณจากจำนวนตัวอักษร
- **แคช TTS ผูกกับ hash(provider+voice+speed+text)** พูดประโยคเดิมซ้ำไม่เสียเงินอีก
- **ห้ามเรียก `.cmd` ผ่าน spawn บน Windows** — Node บล็อกตั้งแต่ CVE-2024-27980
  เรียก entry `.mjs` ด้วย `process.execPath` แทน (กัน cmd.exe ทำ path ภาษาไทยพังด้วย)

---

## ยังไม่ได้ทำ (ไปต่อสัปดาห์ที่ 2)

- **เส้นทาง Claude ยังไม่ได้ทดสอบ** — ยังไม่มี `ANTHROPIC_API_KEY` โค้ดพร้อมแล้ว
  คลิปที่เห็นทั้งหมดใช้ตัวสร้างสคริปต์ offline ซึ่งอ่านรู้เรื่องแต่ไม่ขายของ
- BGM ducking เขียนแล้วยังไม่ได้ทดสอบกับไฟล์เพลงจริง
- จับคู่ท่อนสคริปต์กับช็อตยังใช้การเรียงตามเวลา ยังไม่ดูความหมายของภาพ
- ยังไม่มี unit test
