// whisper — เรียก whisper.cpp เพื่อขอ timestamp ระดับ token
//
// ใช้แค่ "เวลา" ที่มันคืนมา ไม่ใช้ "คำ" ที่มันเดา เพราะเรารู้สคริปต์อยู่แล้ว
// (ดู tts-align.mjs) การถอดคำไทยผิดบ้างจึงไม่กระทบผลลัพธ์
//
// เลือก whisper.cpp แทน faster-whisper เพราะวัดกับเสียงจริงแล้วรอยต่อตกใน
// ช่วงเงียบ 7 จาก 8 จุด ส่วน faster-whisper ปิดท้ายคำเร็วไปทุกจุด (0 จาก 8)
// และ whisper.cpp เป็นไบนารีตัวเดียว ไม่ต้องมี Python หรือ CUDA แยกติดตั้ง

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, throwIfAborted } from "./lib.mjs";

/** ค่าเริ่มต้น: ใช้ทุกคอร์ที่มี — ค่าปริยายของ whisper.cpp คือ 4 ซึ่งช้ากว่า 4 เท่า */
const defaultThreads = () => Math.max(1, Math.min(16, os.cpus()?.length || 4));

/**
 * whisper.cpp บนวินโดวส์อ่านอาร์กิวเมนต์เป็น ANSI ไม่ใช่ UTF-8
 * path ที่มีอักษรไทยจึงกลายเป็น "???" แล้วมันบอกว่าหาไฟล์ไม่เจอ
 * ชื่อโปรเจกต์ในระบบนี้เป็นภาษาไทยแทบทุกอัน จึงต้องกันไว้ทุกเส้นทางที่ส่งเข้าไป
 */
const isAsciiPath = (value) => /^[ -~]*$/.test(String(value ?? ""));

export function whisperPaths(environment = process.env) {
  return {
    cli: environment.WHISPER_CLI_PATH || "",
    model: environment.WHISPER_MODEL_PATH || "",
  };
}

export function whisperReady(environment = process.env) {
  const { cli, model } = whisperPaths(environment);
  if (!cli || !model) return false;
  try {
    return fs.statSync(cli).isFile() && fs.statSync(model).isFile();
  } catch {
    return false;
  }
}

/**
 * อ่านไฟล์ JSON ของ whisper.cpp ให้เป็นรายการ token พร้อมเวลา
 *
 * โครงสร้างคือ transcription[].tokens[] โดยเวลาอยู่ใน offsets (มิลลิวินาที)
 * token พิเศษขึ้นต้นด้วย [_ เช่น [_BEG_] ต้องข้าม ไม่งั้นจะไปกินตำแหน่งตอนจับคู่
 */
export function parseWhisperJson(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  const tokens = [];
  for (const segment of data?.transcription ?? []) {
    for (const token of segment?.tokens ?? []) {
      const value = String(token?.text ?? "");
      if (!value || value.startsWith("[_")) continue;
      const startMs = Number(token?.offsets?.from);
      const endMs = Number(token?.offsets?.to);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      tokens.push({ text: value, startMs, endMs });
    }
  }
  return tokens;
}

/**
 * ถอดเสียงไฟล์เดียวแล้วคืน token พร้อมเวลา
 *
 * เขียนผลลัพธ์ลงโฟลเดอร์ชั่วคราวแล้วลบทิ้งเสมอ เพราะ whisper.cpp เขียนไฟล์ JSON
 * ข้างไฟล์เสียงโดยปริยาย ซึ่งจะไปปนกับไฟล์ของโปรเจกต์ผู้ใช้
 */
export async function transcribeTokens(audioFile, options = {}) {
  const {
    environment = process.env,
    language = "th",
    threads = Number(environment.WHISPER_THREADS) || defaultThreads(),
    signal,
    timeoutMs = Number(environment.WHISPER_TIMEOUT_MS || 10 * 60_000),
  } = options;

  const { cli, model } = { ...whisperPaths(environment), ...options };
  if (!cli || !model) throw new Error("ยังไม่ได้ติดตั้ง whisper.cpp");

  throwIfAborted(signal);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-whisper-"));
  const outBase = path.join(workDir, "out");
  // คัดลอกไฟล์เสียงมาไว้ในโฟลเดอร์ชั่วคราวก่อน เพราะไฟล์ต้นทางอยู่ใต้ชื่อโปรเจกต์
  // ซึ่งเป็นภาษาไทย และ whisper.cpp เปิดไม่ได้
  const input = path.join(workDir, "input.wav");
  try {
    if (!isAsciiPath(workDir) || !isAsciiPath(model)) {
      throw new Error(
        "เส้นทางของโฟลเดอร์ชั่วคราวหรือไฟล์โมเดลมีอักขระที่ whisper.cpp อ่านไม่ได้ " +
        "(รองรับเฉพาะอักษรอังกฤษ) ย้ายโปรแกรมไปไว้ในเส้นทางที่เป็นอังกฤษล้วนแล้วลองใหม่",
      );
    }
    fs.copyFileSync(audioFile, input);
    const { code, err } = await run(cli, [
      "-m", model,
      "-f", input,
      "-l", language,
      "-t", String(threads),
      // token timestamps — ต้องมี ไม่งั้น JSON จะไม่มีเวลาให้จับคู่
      "-ojf",
      "-of", outBase,
      // ปิดผลลัพธ์ที่ไม่ได้ใช้ ลดงานที่ต้องทำต่อคลิป
      "-np",
    ], { signal, timeoutMs });

    if (code !== 0) throw new Error(`whisper.cpp จบด้วยรหัส ${code}: ${String(err).slice(0, 300)}`);

    const jsonFile = `${outBase}.json`;
    const tokens = parseWhisperJson(fs.readFileSync(jsonFile, "utf8"));
    if (!tokens.length) throw new Error("whisper.cpp ไม่คืน token ใด ๆ");
    return tokens;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
