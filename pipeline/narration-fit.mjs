// narration-fit — ย่อเสียงพากย์ให้ลงไทม์ไลน์ก่อนจะไปโยน error ใส่ผู้ใช้
//
// ไทม์ไลน์ที่ผู้ใช้ตัดมาเป็นใหญ่เสมอ (ดู padNarrationTimeline) เสียงที่ยาวเกินจึงต้อง
// ย่อฝั่งเสียง ไม่ใช่ยืดภาพ และห้ามตัดคำพูดทิ้งเด็ดขาด เหลือสองทางที่ปลอดภัย:
//
//   1. ตัดความเงียบท้ายท่อน — TTS มักทิ้งหางเงียบไว้ ไม่มีผลต่อคำพูดเลย
//   2. เร่งจังหวะพูดเล็กน้อย — เกินไม่กี่เปอร์เซ็นต์แทบไม่มีใครฟังออก
//
// ถ้าสองทางนี้ยังไม่พอ ค่อยบอกผู้ใช้ พร้อมบอกด้วยว่าเราพยายามอะไรไปแล้ว
// จะได้ไม่ต้องเดาว่าควรลดข้อความเท่าไร
//
// normalizeAudio ตัดความเงียบ "หัว" ให้แล้วตอนสร้างเสียง แต่ไม่ได้ตัดท้าย
// ที่นี่จึงตัดท้ายอย่างเดียว

import fs from "node:fs";
import { durationMs, ffmpeg } from "./lib.mjs";
import { DEFAULT_TIMING } from "./core.mjs";

/** เพดานการเร่งเสียง — เกินกว่านี้ภาษาไทยเริ่มฟังรัวจนเสียอรรถรส */
export const MAX_SPEEDUP = 1.15;

/** เวลาที่ไม่ได้มาจากคำพูด: ช่วงนำ ช่องว่างระหว่างท่อน และหางท้ายคลิป */
function fixedOverheadMs(count, timing) {
  const { leadInMs, padMs, tailMs } = { ...DEFAULT_TIMING, ...timing };
  return leadInMs + Math.max(0, count - 1) * padMs + tailMs;
}

async function rewrite(file, filters, { signal, timeoutMs }) {
  const temporary = `${file}.fit.wav`;
  await ffmpeg([
    "-i", file,
    "-af", filters,
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
    "-y", temporary,
  ], { signal, timeoutMs });
  fs.renameSync(temporary, file);
}

/** ตัดความเงียบท้ายไฟล์ — กลับด้าน ตัดหัว แล้วกลับด้านคืน */
async function trimTail(file, options) {
  await rewrite(
    file,
    "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse",
    options,
  );
}

/**
 * ทำให้เสียงพากย์รวมแล้วไม่เกินไทม์ไลน์
 *
 * แก้ไฟล์เสียงในโฟลเดอร์งานโดยตรง (ไม่แตะแคช เพราะแคชต้องเก็บต้นฉบับไว้ให้เรนเดอร์
 * ครั้งอื่นที่ไทม์ไลน์ยาวไม่เท่ากันใช้ได้ด้วย) แล้วคืนค่าความยาวใหม่ให้ผู้เรียก
 *
 * @returns {{ applied: string[], narrationMs: number, rate: number, fits: boolean }}
 */
export async function fitNarrationToTimeline(takes, options = {}) {
  const {
    targetMs,
    timing,
    maxRate = MAX_SPEEDUP,
    signal,
    timeoutMs,
  } = options;

  const applied = [];
  const overhead = fixedOverheadMs(takes.length, timing);
  const budget = targetMs - overhead;
  const total = () => takes.reduce((sum, take) => sum + take.durationMs, 0);

  if (!(budget > 0)) {
    // ช่องว่างกับหางกินเวลาหมดแล้ว เร่งเสียงก็ไม่ช่วย ปล่อยให้ผู้เรียกแจ้งผู้ใช้
    return { applied, narrationMs: total() + overhead, rate: 1, fits: false };
  }
  if (total() <= budget) return { applied, narrationMs: total() + overhead, rate: 1, fits: true };

  // 1) ตัดหางเงียบก่อน — ได้มาฟรี ไม่กระทบเสียงพูด
  for (const take of takes) {
    await trimTail(take.file, { signal, timeoutMs });
    take.durationMs = await durationMs(take.file, { signal });
  }
  applied.push("ตัดความเงียบท้ายท่อน");
  if (total() <= budget) return { applied, narrationMs: total() + overhead, rate: 1, fits: true };

  // 2) เร่งจังหวะพูดเท่าที่จำเป็น แต่ไม่เกินเพดาน
  const needed = total() / budget;
  if (needed > maxRate) {
    return { applied, narrationMs: total() + overhead, rate: needed, fits: false };
  }
  // เผื่อไว้เล็กน้อยกัน atempo ปัดเศษแล้วยังเกินอยู่นิดเดียว
  const rate = Math.min(maxRate, needed * 1.005);
  for (const take of takes) {
    await rewrite(take.file, `atempo=${rate.toFixed(3)}`, { signal, timeoutMs });
    take.durationMs = await durationMs(take.file, { signal });
  }
  applied.push(`เร่งเสียง ${rate.toFixed(2)} เท่า`);

  return { applied, narrationMs: total() + overhead, rate, fits: total() <= budget };
}
