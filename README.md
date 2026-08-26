# Clip360 Local

Clip360 เปลี่ยนคลิปสินค้าดิบหลายไฟล์เป็นวิดีโอแนวตั้งพร้อมโพสต์: เรียงและตัดต่อคลิปบน Timeline ช่วยเขียนสคริปต์ขาย พากย์เสียงไทย ใส่ซับ Kanit ตามคำพูด และส่งออก MP4/SRT/ASS/ภาพปกจากเครื่องของคุณเอง

เวอร์ชัน 0.3.0 ทำงานจริงแบบ local-first แล้ว มี Local API, SQLite, render queue, FFmpeg, Gemini TTS, สคริปต์ Gemini/Claude, ซับ libass และซับพรีเมียม HyperFrames ไม่ใช่เพียงหน้าจอจำลอง

## Timeline Editor

- อัปโหลดวิดีโอพร้อมกันได้สูงสุด 12 ไฟล์ แล้วนำเข้า Timeline อัตโนมัติ
- ลากเรียงลำดับคลิป ตัดหัว/ท้าย แยกคลิปตรง playhead และลบช่วงที่ไม่ต้องการได้
- คลิปต้นฉบับยังอยู่ใน Media Bin เมื่อลบช่วงออกจาก Timeline จึงกดเพิ่มกลับหรือใช้ไฟล์เดิมซ้ำได้โดยไม่ต้องอัปโหลดใหม่
- ดูตัวอย่างต่อเนื่องตามลำดับจริง พร้อม seek ข้ามช่วงและเล่นไฟล์เดิมซ้ำได้หลัง Split
- Timeline หนึ่งงานรองรับได้สูงสุด 24 ช่วง และความยาวรวมไม่เกิน 60 วินาที
- FFmpeg เรนเดอร์ตามลำดับและช่วง In/Out ที่เลือก โดยยึดความยาว Timeline เป็นความยาวผลลัพธ์จริง
- ถ้าเสียงพากย์สั้นกว่า Timeline ระบบเติมช่วงเงียบให้ครบ; ถ้าเสียงพากย์ยาวกว่า ระบบจะหยุดและให้ย่อสคริปต์แทนการเปลี่ยนลำดับหรือยืดคลิปโดยอัตโนมัติ

## เปิดใช้งานเร็วที่สุด

ต้องมี [Node.js](https://nodejs.org/) 22.13 ขึ้นไปอย่างเดียวก่อนเริ่ม ส่วน FFmpeg ติดตั้งจากหน้า Setup ของ Clip360 ได้

โหลดตัวโปรแกรมจาก [Work360team/ClipPang](https://github.com/Work360team/ClipPang) — กด **Code → Download ZIP** แล้วแตกไฟล์ หรือ `git clone https://github.com/Work360team/ClipPang.git`

แนะนำวิธี `git clone` เพราะ **ตัวเปิดโปรแกรมจะดึงเวอร์ชันล่าสุดให้เองทุกครั้งที่เปิด** ส่วนวิธี ZIP ต้องโหลดใหม่เองเมื่ออยากอัปเดต

การอัปเดตอัตโนมัติจะข้ามให้เองเมื่อ: ไม่ได้ติดตั้งผ่าน git · ไม่มี git ในเครื่อง · มีไฟล์ที่คุณแก้ไว้ค้างอยู่ · หรือดึงไม่สำเร็จ (เน็ตไม่ต่อ, ประวัติแยกกัน) ทุกกรณีโปรแกรมจะเปิดด้วยเวอร์ชันที่มีอยู่ต่อ ไม่ค้าง

ปิดการอัปเดตถาวรได้ด้วยการตั้ง `CLIP360_SKIP_UPDATE=1`

### Windows

ดับเบิลคลิก `เริ่มโปรแกรม.bat`

### macOS

ครั้งแรกเปิด Terminal ในโฟลเดอร์นี้แล้วรัน:

```bash
chmod +x start.command start.sh
./start.command
```

หลังจากนั้นดับเบิลคลิก `start.command` ได้

### Linux

```bash
chmod +x start.sh
./start.sh
```

Launcher จะตรวจ Node, ติดตั้ง dependency เมื่อขาด, build หน้าเว็บเมื่อ source ใหม่กว่า build เดิม แล้วเปิด `http://127.0.0.1:4321` อัตโนมัติ หากพอร์ต 4321 ถูกใช้ ระบบจะเลือกพอร์ตถัดไปและแสดง URL จริงใน Terminal

## เปิดค้างไว้เป็นบริการ (Windows)

เครื่องที่เปิดให้คนอื่นเข้าใช้ผ่านโดเมน ควรกลับมาเองหลังรีสตาร์ตเครื่อง:

```powershell
powershell -ExecutionPolicy Bypass -File scriptsutostart-windows.ps1
```

สร้าง Scheduled Task ในบัญชีผู้ใช้ปัจจุบัน (ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ) เปิด Clip360 ทุกครั้งที่ล็อกอิน
ยกเลิกด้วย `-Remove` · ตัวเปิดโปรแกรมเองจะสตาร์ตเซิร์ฟเวอร์ใหม่ให้อัตโนมัติถ้าโปรเซสล้ม
(สูงสุด 20 ครั้งติดกันแล้วหยุด เพื่อไม่ให้วนไม่รู้จบเวลามีปัญหาที่แก้ไม่ได้เอง)

## ตั้งค่าครั้งแรก

1. เปิดหน้า `/setup` แล้วให้ระบบตรวจ FFmpeg; ถ้ายังไม่มี กดติดตั้งจากหน้านี้
2. ขอ Gemini API key จาก [Google AI Studio](https://aistudio.google.com/app/apikey) แล้ววางในหน้า Setup
   จากนั้นขั้นที่ 4 จะเสนอให้ติดตั้ง whisper.cpp (ไม่บังคับ แต่ช่วยประหยัดโควตามาก — ดูหัวข้อถัดไป)
3. อัปโหลดคลิปพร้อมกันได้สูงสุด 12 ไฟล์ หรือวางไฟล์ไว้ในโฟลเดอร์ `input/`
4. เรียงและตัดต่อบน Timeline ให้ไม่เกิน 24 ช่วง/60 วินาที แล้วกดเสร็จสิ้นการตัดต่อ
5. กรอกสินค้า เลือก 1 จาก 30 เสียง Gemini เลือกสคริปต์และสไตล์ซับ
6. ตรวจสรุปแล้วกดสร้างคลิป ติดตาม progress ได้แม้เปลี่ยนหน้า แล้วดาวน์โหลดผลลัพธ์จากหน้าโปรเจกต์

ข้อมูลอยู่ในเครื่องนี้:

- `data/clip360.db` — โปรเจกต์และสถานะคิว SQLite
- `input/` — คลิปที่นำเข้า
- `projects/<id>/out/` — MP4, ภาพปก, เสียง, SRT, ASS, script, timeline และ report
- `.env` — API key ที่บันทึกจากหน้า Setup (ถูก ignore จาก Git)
- `data/cache/` และ `projects/<id>/.cache/` — แคชเสียงเพื่อลดการยิงซ้ำ
- `data/bin/whisper/` — whisper.cpp และโมเดลถอดเสียง (ถ้าติดตั้งไว้)

เซิร์ฟเวอร์ฟังเฉพาะ `127.0.0.1`; คลิปและไฟล์ผลลัพธ์ไม่ถูกอัปโหลดออกจากเครื่อง ข้อความสินค้า/สคริปต์จะถูกส่งไปยังผู้ให้บริการ AI เฉพาะเมื่อเลือกใช้ Gemini หรือ Claude

## ประหยัดโควตาด้วย whisper.cpp

โควตา TTS ของ Gemini นับเป็น **ต่อโปรเจกต์ต่อโมเดล ไม่ใช่ต่อคีย์** (`GenerateRequestsPerMinutePerProjectPerModel`)
free tier ให้ราว 3 คำขอ/นาที และราว 15 คำขอ/วัน คีย์หลายใบจากโปรเจกต์เดียวกันจึงไม่ได้เพิ่มโควตา
ต้องเป็นคนละโปรเจกต์หรือคนละบัญชีเท่านั้น

คลิป 30 วินาทีมีบทพูดราว 9 ท่อน ถ้ายิงทีละท่อนจะได้ไม่ถึงวันละคลิป ระบบจึงยิงทั้งคลิปในคำขอเดียว
แล้วตัดกลับเป็นรายท่อน ทำให้ได้ราว 15 คลิป/วัน/โปรเจกต์

การตัดกลับมีสองวิธี เรียงตามความน่าเชื่อถือ:

1. **จับคู่ข้อความ** (`pipeline/tts-align.mjs`) — ใช้ whisper.cpp หา timestamp แล้วเทียบกับสคริปต์ที่เรารู้อยู่แล้ว
   ตัวถอดเสียงอ่านคำไทยผิดบ้างไม่กระทบ เพราะใช้แค่ "เวลา" ไม่ใช้ "คำ" ที่มันเดา
2. **ช่วงเงียบ** (`splitOnSilence`) — ทางสำรองเมื่อยังไม่ได้ติดตั้ง whisper.cpp

วัดกับเสียงจริงแล้ววิธีที่ 2 ใช้กับ Gemini แทบไม่ได้เลย เพราะโมเดลไม่ทำตามคำสั่งเว้นจังหวะ
บางท่อนถูกอ่านติดกันจนไม่มีความเงียบให้ตัด ไม่ว่าจะตั้งเกณฑ์เท่าไรก็หารอยต่อที่ไม่มีอยู่จริงไม่เจอ

ติดตั้งจากหน้า `/setup` ขั้นที่ 4 หรือยิง `POST /api/setup/whisper` ระบบจะเลือกไบนารีให้เอง —
มีการ์ด NVIDIA ใช้รุ่น CUDA (~640 MB) ไม่มีก็ใช้รุ่น CPU (~20 MB) บวกโมเดล ~2.9 GB
ถ้า build เองหรือใช้ `brew install whisper-cpp` ให้ตั้ง `WHISPER_CLI_PATH` กับ `WHISPER_MODEL_PATH` ใน `.env` แทน

รายงานเรนเดอร์บอกผลไว้ที่ `tts.batched`, `tts.batchMethod` (`align`/`silence`) และ `tts.batchReason` เมื่อรวมคำขอไม่สำเร็จ

## ต้นทุน Gemini

ค่าเริ่มต้นของเสียงคือ `gemini-2.5-flash-preview-tts` และเปลี่ยนได้ด้วย `GEMINI_TTS_MODEL` รุ่นนี้รองรับภาษาไทยและเสียงสำเร็จรูป 30 เสียง

ตาม [ราคา Gemini API อย่างเป็นทางการ](https://ai.google.dev/gemini-api/docs/pricing) ณ 11 สิงหาคม 2026:

- Free tier: input/output ของ Gemini 2.5 Flash Preview TTS ไม่มีค่าใช้จ่าย แต่มี rate limit
- Paid tier: text input $0.50 ต่อ 1M tokens และ audio output $10 ต่อ 1M tokens
- report ของ Clip360 ประมาณ audio ที่ 32 tokens/วินาที: เสียง 30 วินาทีประมาณ `$0.0096` บวก text input เล็กน้อย

ยอดจริงขึ้นกับ audio tokens ใน `usageMetadata`, รุ่นโมเดล, tier และราคาปัจจุบัน ควรดูหน้า pricing/Google AI billing ก่อนใช้งานปริมาณมาก แคช TTS ผูกกับ provider + voice + speed + tone + text จึงไม่คิดซ้ำเมื่อประโยคเดิมถูกใช้ซ้ำ

## คำสั่งที่ใช้บ่อย

```bash
npm install             # ติดตั้ง dependency
npm run build           # build หน้าเว็บสำหรับ Local server
npm run local           # เปิด Local server จริงและเปิดเบราว์เซอร์
npm run local:mock      # โหมดออฟไลน์: template script + เสียง tone สำหรับทดสอบ ไม่เรียก AI
npm run test:local      # unit/security/store + mock render จริงโดยไม่เรียก API ภายนอก
npm run dev             # development server พร้อม HMR
npm run lint
npm test                # production web build + rendered HTML test
```

`local:mock` สร้าง WAV ที่ถูกต้องด้วย FFmpeg แต่เป็นเสียง tone ไม่ใช่เสียงพูด ใช้ตรวจ pipeline/คิว/หน้าผลลัพธ์เท่านั้น

## Render pipeline

`pipeline/index.mjs` เปิด API ระดับสูง:

- `runPipeline(options)` → `{ outputs, timeline, report }`
- `generateScripts`, `regenerateChunk`
- `synthesizePreview`, `listVoices`, `listStyles`

ทุก child process รองรับ `AbortSignal` และ timeout, stderr ถูกจำกัดขนาด, scratch/output ครึ่งงานถูกล้างใน `finally`, ชื่อไฟล์ไทยรักษาวรรณยุกต์และมี timestamp+random suffix ป้องกันชนกัน

ซับทุก preset ใช้ฟอนต์ Kanit จาก `pipeline/fonts/` และ FFmpeg ได้รับ `fontsdir` ตรง ๆ สไตล์ HyperFrames ตรวจ alpha ทั้ง pixel format และค่าจริงของเฟรม หาก alpha ใช้ไม่ได้ ระบบจะถอยเป็น ASS/Kanit แทนการปล่อยพื้นดำทับวิดีโอ

## ข้อจำกัดที่ยังทราบ

- โปรเจกต์เดิมแบบคลิปเดียวที่ยังไม่มี Timeline จะใช้การเลือกช็อตอัตโนมัติด้วย scene score/bitrate และ round-robin ซึ่งยังไม่จับความหมายภาพกับแต่ละประโยค; งานที่สร้างด้วย Timeline Editor จะยึดลำดับและช่วงตัดของผู้ใช้แทน
- HyperFrames `0.7.106` ถูก pin เพื่อ render ซ้ำได้เหมือนเดิม; overlay พรีเมียมใหญ่กว่า ASS และใช้เวลามากกว่า
- Gemini TTS เป็น preview model จึงอาจเปลี่ยน quota/ชื่อรุ่นได้ ตั้ง `GEMINI_TTS_MODEL` เพื่อย้ายรุ่นโดยไม่แก้โค้ด
- Offline template และ mock tone มีไว้ fallback/test คุณภาพไม่เท่า AI จริง

สถาปัตยกรรมและเหตุผลเชิงผลิตภัณฑ์ฉบับเต็มอยู่ที่ `docs/blueprint-local.html`
