#!/usr/bin/env node
/**
 * สร้างไฟล์เสียงตัวอย่างของทุกเสียงไว้ล่วงหน้า แล้วเก็บลง public/voice-samples/
 *
 * ทำไมต้องทำล่วงหน้า: หน้าเลือกเสียงมี 30 เสียง ถ้ากดฟังทีละเสียงแบบเรียกสด
 * จะกินโควตา Gemini หนึ่งคำขอต่อการกดหนึ่งครั้ง (free tier มีวันละ 10 ต่อคีย์)
 * ผู้ใช้เลือกเสียงยังไม่ทันเสร็จโควตาก็หมดแล้ว ไฟล์ชุดนี้จึงถูกสร้างครั้งเดียว
 * commit ไว้ในโปรเจกต์ แล้วทุกเครื่องที่ clone ไปก็ฟังได้ฟรีไม่จำกัด
 *
 * วิธีใช้:  node scripts/make-voice-samples.mjs [--only Kore,Puck] [--force]
 * ต้องมี GEMINI_API_KEY ใน .env และใช้โควตา 1 คำขอต่อหนึ่งเสียงที่สร้างใหม่
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VOICES } from "../pipeline/tts.mjs";
import { synthesizePreview } from "../pipeline/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "voice-samples");
const TMP_DIR = path.join(ROOT, ".cache", "voice-samples");

// ประโยคเดียวกันทุกเสียง เพื่อให้เทียบกันได้ว่าเสียงไหนเข้ากับคลิปมากกว่า
const SAMPLE_TEXT = "สวัสดีค่ะ ตัวนี้ใช้ดีมาก บอกเลยว่าคุ้มมาก กดตะกร้าส้มได้เลยค่ะ";

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyArg = args.find((arg) => arg.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1] || "").split(",").filter(Boolean))
  : null;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

/** แปลง wav 24kHz เป็น mp3 — ไฟล์เล็กลงราวหกเท่า เพราะต้อง commit ทั้ง 30 ไฟล์ */
function toMp3(source, target) {
  const result = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", source,
    "-ac", "1", "-ar", "24000", "-b:a", "48k",
    target,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg ล้มเหลว: ${result.stderr || result.error?.message}`);
}

const voices = VOICES.gemini.filter((voice) => !only || only.has(voice.id));
let made = 0;
let skipped = 0;
const failed = [];

for (const [index, voice] of voices.entries()) {
  const target = path.join(OUT_DIR, `${voice.id}.mp3`);
  if (!force && fs.existsSync(target)) {
    skipped += 1;
    continue;
  }
  process.stdout.write(`[${index + 1}/${voices.length}] ${voice.id} … `);
  try {
    const preview = await synthesizePreview({
      voiceId: voice.id,
      provider: "gemini",
      text: SAMPLE_TEXT,
      speed: 1,
      tone: "เป็นกันเอง",
      outDir: TMP_DIR,
    });
    toMp3(typeof preview === "string" ? preview : preview.file, target);
    made += 1;
    console.log(`${(fs.statSync(target).size / 1024).toFixed(0)} KB`);
  } catch (error) {
    failed.push(voice.id);
    console.log(`ไม่สำเร็จ — ${error instanceof Error ? error.message : error}`);
  }
}

// รายชื่อเสียงที่มีไฟล์ตัวอย่างจริง เพื่อให้หน้าเว็บรู้ล่วงหน้าว่าอันไหนกดฟังได้ทันที
// โดยไม่ต้องยิง 404 ทีละไฟล์ตอนเปิดหน้า
const ready = VOICES.gemini
  .filter((voice) => fs.existsSync(path.join(OUT_DIR, `${voice.id}.mp3`)))
  .map((voice) => voice.id);
fs.writeFileSync(path.join(OUT_DIR, "index.json"), `${JSON.stringify({ text: SAMPLE_TEXT, voices: ready }, null, 2)}\n`);

console.log(`\nสร้างใหม่ ${made} · มีอยู่แล้ว ${skipped} · ไม่สำเร็จ ${failed.length}`);
if (failed.length) {
  console.log(`ยังขาด: ${failed.join(", ")}`);
  console.log("รันซ้ำพรุ่งนี้หรือเพิ่มคีย์อีกใบ ไฟล์ที่สร้างไว้แล้วจะถูกข้าม");
  process.exitCode = 1;
}
