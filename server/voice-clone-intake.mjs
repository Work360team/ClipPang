// voice-clone-intake — รับเสียงต้นแบบจากเบราว์เซอร์แล้วเตรียมให้พร้อมสำหรับ JaiTTS
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VOICE_GENDERS } from "../pipeline/core.mjs";
import { durationMs, ffmpeg } from "../pipeline/lib.mjs";
import { transcribeTokens, whisperReady } from "../pipeline/whisper.mjs";
import { MAX_REF_MS, MIN_REF_MS, saveClone } from "../pipeline/voice-clones.mjs";

/** เผื่อให้อัดเกินได้นิดหน่อยแล้วค่อยบอก ไม่ใช่ตัดทิ้งกลางคัน */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export { MAX_UPLOAD_BYTES };

/**
 * รวมโทเคนจาก whisper เป็นข้อความเดียว
 *
 * whisper.cpp คืนโทเคนพร้อมช่องว่างนำหน้าแบบภาษาอังกฤษ ภาษาไทยไม่เว้นวรรคระหว่างคำ
 * ปล่อยไว้จะได้ข้อความที่มีช่องว่างแทรกเต็มไปหมด ซึ่งไม่ตรงกับที่พูดจริง
 */
export function joinTokens(tokens) {
  return tokens
    .map((token) => String(token?.text ?? ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * เสียงจาก MediaRecorder เป็น webm/opus ต้องแปลงเป็น wav ก่อนเสมอ
 *
 * 24kHz mono ตรงกับที่ทั้ง JaiTTS และ whisper.cpp ใช้ และเป็นรูปแบบเดียวกับที่ระบบ
 * ใช้ทั้ง pipeline อยู่แล้ว แปลงตรงนี้ทีเดียวจบ ไม่ต้องแปลงซ้ำตอนพากย์
 */
async function toReferenceWav(inputFile, outputFile, options = {}) {
  await ffmpeg([
    "-i", inputFile,
    // ตัดความเงียบหัวท้ายออกด้วย เพราะ F5-TTS นับตัวอย่างทั้งไฟล์รวมความเงียบ
    "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse",
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
    "-y", outputFile,
  ], options);
}

/**
 * รับไฟล์เสียงดิบ → ตรวจ → ถอดข้อความ → บันทึกเป็นเสียงต้นแบบ
 *
 * ข้อความต้องตรงกับที่พูดเป๊ะ ๆ ไม่งั้น F5-TTS จะเพี้ยน จึงถอดด้วย whisper แทนที่จะ
 * เชื่อประโยคที่ให้ผู้ใช้อ่าน เพราะคนอ่านมักไม่ตรงกับที่เขียนไว้ทุกคำ
 */
export async function intakeVoiceClone({ buffer, speaker, tone, gender, fallbackText, signal }) {
  if (!buffer?.length) throw Object.assign(new Error("ไม่มีไฟล์เสียง"), { status: 400, code: "EMPTY_UPLOAD" });
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error("ไฟล์เสียงใหญ่เกินไป"), { status: 413, code: "FILE_TOO_LARGE" });
  }
  if (!VOICE_GENDERS.includes(String(gender ?? "").trim())) {
    throw Object.assign(new Error("กรุณาเลือกเพศของเสียงก่อนเริ่มอัด"), {
      status: 400,
      code: "VOICE_GENDER_REQUIRED",
    });
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-voice-"));
  try {
    const raw = path.join(workDir, "raw");
    const wavFile = path.join(workDir, "ref.wav");
    fs.writeFileSync(raw, buffer);
    try {
      await toReferenceWav(raw, wavFile, { signal });
    } catch (error) {
      throw Object.assign(new Error(`อ่านไฟล์เสียงไม่ได้: ${error.message}`), { status: 400, code: "BAD_AUDIO" });
    }

    const length = await durationMs(wavFile, { signal });
    if (length < MIN_REF_MS) {
      throw Object.assign(
        new Error(`เสียงต้นแบบสั้นเกินไป (${(length / 1000).toFixed(1)} วินาที) ต้องยาวอย่างน้อย ${MIN_REF_MS / 1000} วินาที`),
        { status: 400, code: "REF_TOO_SHORT" },
      );
    }
    if (length > MAX_REF_MS) {
      throw Object.assign(
        new Error(`เสียงต้นแบบยาวเกินไป (${(length / 1000).toFixed(1)} วินาที) ให้อยู่ในราว ${MAX_REF_MS / 1000} วินาที`),
        { status: 400, code: "REF_TOO_LONG" },
      );
    }

    let text = String(fallbackText ?? "").trim();
    let transcribedBy = "user";
    if (whisperReady()) {
      const tokens = await transcribeTokens(wavFile, { signal });
      const heard = joinTokens(tokens);
      if (heard) {
        text = heard;
        transcribedBy = "whisper";
      }
    }
    if (!text) {
      throw Object.assign(
        new Error("ถอดข้อความจากเสียงไม่สำเร็จ — ติดตั้ง whisper.cpp ในหน้าตั้งค่า หรือพิมพ์ข้อความที่พูดเอง"),
        { status: 400, code: "NO_TRANSCRIPT" },
      );
    }

    const clone = saveClone({
      wavBuffer: fs.readFileSync(wavFile),
      text,
      speaker,
      tone,
      gender,
      durationMs: length,
    });
    return { ...clone, transcribedBy };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
