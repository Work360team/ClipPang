# ClipPang Local

ClipPang เปลี่ยนคลิปสินค้าดิบเป็นวิดีโอแนวตั้งพร้อมโพสต์: ช่วยเขียนสคริปต์ขาย พากย์เสียงไทย ใส่ซับ Kanit ตามคำพูด และส่งออก MP4/SRT/ASS/ภาพปกจากเครื่องของคุณเอง

เวอร์ชันนี้ทำงานจริงแบบ local-first แล้ว มี Local API, SQLite, render queue, FFmpeg, Gemini TTS, สคริปต์ Gemini/Claude, ซับ libass และซับพรีเมียม HyperFrames ไม่ใช่เพียงหน้าจอจำลอง

## เปิดใช้งานเร็วที่สุด

ต้องมี [Node.js](https://nodejs.org/) 22.13 ขึ้นไปอย่างเดียวก่อนเริ่ม ส่วน FFmpeg ติดตั้งจากหน้า Setup ของ ClipPang ได้

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

## ตั้งค่าครั้งแรก

1. เปิดหน้า `/setup` แล้วให้ระบบตรวจ FFmpeg; ถ้ายังไม่มี กดติดตั้งจากหน้านี้
2. ขอ Gemini API key จาก [Google AI Studio](https://aistudio.google.com/app/apikey) แล้ววางในหน้า Setup
3. อัปโหลดคลิป หรือวางไฟล์ไว้ในโฟลเดอร์ `input/`
4. สร้างโปรเจกต์ กรอกสินค้า เลือก 1 จาก 30 เสียง Gemini เลือกสคริปต์และสไตล์ซับ
5. สั่งสร้างร่าง/คลิปจริง ติดตาม progress ได้แม้เปลี่ยนหน้า แล้วดาวน์โหลดผลลัพธ์จากหน้าโปรเจกต์

ข้อมูลอยู่ในเครื่องนี้:

- `data/clippang.db` — โปรเจกต์และสถานะคิว SQLite
- `input/` — คลิปที่นำเข้า
- `projects/<id>/out/` — MP4, ภาพปก, เสียง, SRT, ASS, script, timeline และ report
- `.env` — API key ที่บันทึกจากหน้า Setup (ถูก ignore จาก Git)
- `data/cache/` และ `projects/<id>/.cache/` — แคชเสียงเพื่อลดการยิงซ้ำ

เซิร์ฟเวอร์ฟังเฉพาะ `127.0.0.1`; คลิปและไฟล์ผลลัพธ์ไม่ถูกอัปโหลดออกจากเครื่อง ข้อความสินค้า/สคริปต์จะถูกส่งไปยังผู้ให้บริการ AI เฉพาะเมื่อเลือกใช้ Gemini หรือ Claude

## ต้นทุน Gemini

ค่าเริ่มต้นของเสียงคือ `gemini-2.5-flash-preview-tts` และเปลี่ยนได้ด้วย `GEMINI_TTS_MODEL` รุ่นนี้รองรับภาษาไทยและเสียงสำเร็จรูป 30 เสียง

ตาม [ราคา Gemini API อย่างเป็นทางการ](https://ai.google.dev/gemini-api/docs/pricing) ณ 11 สิงหาคม 2026:

- Free tier: input/output ของ Gemini 2.5 Flash Preview TTS ไม่มีค่าใช้จ่าย แต่มี rate limit
- Paid tier: text input $0.50 ต่อ 1M tokens และ audio output $10 ต่อ 1M tokens
- report ของ ClipPang ประมาณ audio ที่ 32 tokens/วินาที: เสียง 30 วินาทีประมาณ `$0.0096` บวก text input เล็กน้อย

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

- การเลือกช็อตยังอาศัย scene score/bitrate และ round-robin ยังไม่จับความหมายภาพกับแต่ละประโยค
- HyperFrames `0.7.106` ถูก pin เพื่อ render ซ้ำได้เหมือนเดิม; overlay พรีเมียมใหญ่กว่า ASS และใช้เวลามากกว่า
- Gemini TTS เป็น preview model จึงอาจเปลี่ยน quota/ชื่อรุ่นได้ ตั้ง `GEMINI_TTS_MODEL` เพื่อย้ายรุ่นโดยไม่แก้โค้ด
- Offline template และ mock tone มีไว้ fallback/test คุณภาพไม่เท่า AI จริง

สถาปัตยกรรมและเหตุผลเชิงผลิตภัณฑ์ฉบับเต็มอยู่ที่ `docs/blueprint-local.html`
