// tts-batch — ยิงหลายท่อนในคำขอเดียว แล้วตัดเสียงกลับเป็นรายท่อน
//
// ทำไมต้องมี: Gemini free tier ให้ 10 คำขอต่อวันต่อคีย์ แต่คลิป 30 วินาทีมีสคริปต์
// ราว 9 ท่อน = 9 คำขอ คลิปเดียวกินโควตาของคีย์ทั้งวัน การรวมเป็นคำขอเดียวจึงเพิ่ม
// จำนวนคลิปต่อวันได้หลายเท่า
//
// ความเสี่ยงคือการตัดกลับ: ถ้าตัดผิดตำแหน่ง ซับจะเลื่อนไม่ตรงเสียงทั้งคลิป ซึ่งแย่กว่า
// เปลืองโควตามาก โค้ดนี้จึงตัดจากช่วงเงียบจริงในไฟล์ แล้ว **ต้องได้จำนวนช่วงเท่ากับ
// จำนวนท่อนพอดี** ไม่งั้นถือว่าใช้ไม่ได้และให้ผู้เรียกถอยไปยิงทีละท่อนแทน

import { ffmpeg } from "./lib.mjs";

/** ให้โมเดลเว้นจังหวะให้ชัดพอที่ silencedetect จะจับได้ */
export function buildBatchPrompt(texts, styleHint = "") {
  const lines = texts.map((text) => String(text).trim()).filter(Boolean);
  return [
    "Read each line below aloud in order, verbatim and in its original language.",
    "Pause silently for about one second between lines.",
    "Do not read the line breaks, numbers, or any symbol aloud. Do not add or skip words.",
    styleHint ? `Style: ${styleHint}.` : "",
    "",
    lines.join("\n\n"),
  ].filter(Boolean).join("\n");
}

/**
 * หาช่วงที่ "มีเสียงพูด" จากไฟล์เดียว โดยดูจากช่วงเงียบที่คั่นอยู่
 * คืน null เมื่อจำนวนช่วงไม่เท่ากับที่คาด — แปลว่าตัดไม่ได้ อย่าเดา
 */
export async function splitOnSilence(file, expected, { noiseDb = -38, minSilenceSec = 0.32, minSpeechSec = 0.25, signal, timeoutMs } = {}) {
  if (!(expected > 1)) return null;
  const { err } = await ffmpeg([
    "-i", file,
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
    "-f", "null", "-",
  ], { signal, timeoutMs });

  const duration = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(err);
  const total = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : 0;
  if (!total) return null;

  const silences = [];
  const starts = [...err.matchAll(/silence_start:\s*(-?\d+\.?\d*)/g)].map((m) => Number(m[1]));
  const ends = [...err.matchAll(/silence_end:\s*(-?\d+\.?\d*)/g)].map((m) => Number(m[1]));
  for (let i = 0; i < starts.length; i += 1) {
    const start = Math.max(0, starts[i]);
    const end = ends[i] != null ? ends[i] : total;
    if (end > start) silences.push([start, end]);
  }

  // ช่วงพูด = ที่ว่างระหว่างช่วงเงียบ
  const spans = [];
  let cursor = 0;
  for (const [start, end] of silences) {
    if (start - cursor >= minSpeechSec) spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (total - cursor >= minSpeechSec) spans.push([cursor, total]);

  if (spans.length !== expected) return null;
  return spans.map(([start, end], index) => ({
    index,
    // เผื่อหัวท้ายเล็กน้อย กันตัดพยางค์แรกหรือท้ายขาด
    startSec: Math.max(0, start - 0.06),
    endSec: Math.min(total, end + 0.12),
  }));
}

/** ตัดไฟล์รวมออกเป็นไฟล์ย่อยตามช่วงที่หามาได้ */
export async function cutSpans(sourceFile, spans, outFiles, { signal, timeoutMs } = {}) {
  if (spans.length !== outFiles.length) throw new Error("จำนวนช่วงกับไฟล์ปลายทางไม่เท่ากัน");
  for (let i = 0; i < spans.length; i += 1) {
    await ffmpeg([
      "-ss", spans[i].startSec.toFixed(3),
      "-to", spans[i].endSec.toFixed(3),
      "-i", sourceFile,
      "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
      "-y", outFiles[i],
    ], { signal, timeoutMs });
  }
  return outFiles;
}
