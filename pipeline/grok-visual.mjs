// grok-visual — สั่ง Grok CLI ให้สร้างภาพและขยับภาพเป็นวิดีโอ
//
// Grok CLI ถือ tool image_gen และ image_to_video มาในตัว และรวมอยู่ในค่า subscription
// ที่ผู้ใช้จ่ายไปแล้ว จึงไม่มีบิลต่อคลิปเหมือนบริการเจนวิดีโอทั่วไป
//
// เพดานที่วัดมาจริงบนเครื่อง (28 ส.ค. 2026, grok 1.0.5):
//   image_gen      เลือกได้แค่อัตราส่วน ไม่มีพารามิเตอร์ความละเอียด — 9:16 ได้ 720x1280
//   image_to_video 480p หรือ 720p เท่านั้น ความยาวเลือกได้แค่ 6 หรือ 10 วินาที
//   เวลาต่อช็อต    ภาพ ~60 วินาที + วิดีโอ ~60 วินาที
//
// ตัวแทนงานเป็น agent ไม่ใช่ API จึงไม่การันตีว่าจะเซฟไฟล์ตามชื่อที่สั่ง โมดูลนี้จึง
// ตรวจไฟล์จริงด้วย ffprobe ทุกครั้งแทนที่จะเชื่อข้อความที่มันตอบกลับมา

import fs from "node:fs";
import path from "node:path";
import { runProcess } from "./providers.mjs";
import { durationMs, ensureDir, ffprobe } from "./lib.mjs";
import { probe } from "./media.mjs";

/**
 * ขนาดของภาพนิ่ง
 *
 * ใช้ ffprobe ตรง ๆ ไม่ใช่ probe() ของ media.mjs เพราะตัวนั้นบังคับว่าต้องอ่านความยาว
 * ได้ ซึ่งภาพนิ่งไม่มี — เรียกไปก็มีแต่จะโยนข้อผิดพลาดที่ไม่ได้บอกอะไรเลย
 */
async function imageSize(file, opts = {}) {
  const { out } = await ffprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    file,
  ], opts);
  const stream = JSON.parse(out)?.streams?.[0] ?? {};
  return { width: Number(stream.width) || 0, height: Number(stream.height) || 0 };
}

export const GROK_COMMAND = "grok";

/** ความยาวที่ image_to_video รับ — ค่าอื่นถูกปัดลงมาที่ค่าที่ใกล้ที่สุด */
export const SHOT_SECONDS = [6, 10];

// เผื่อไว้มากกว่าที่วัดได้จริงหลายเท่า เพราะบริการช้าลงมากเมื่อใช้ติดกันนาน ๆ
// วัดจริง: ภาพใบแรก ๆ ของวัน 60 วินาที แต่หลังเจนไปราว 25 ใบในชั่วโมงเดียว
// ภาพเดี่ยว ๆ ใบเดียวใช้ 363 วินาที — คอขวดคือการถูกจำกัดอัตรา ไม่ใช่ความเร็วเครื่อง
// ค่าที่ต่ำเกินไปแปลว่าทิ้งงานที่กำลังจะเสร็จ ซึ่งแพงกว่ารอ
export const IMAGE_TIMEOUT_MS = 900_000;
export const VIDEO_TIMEOUT_MS = 900_000;

export function nearestShotSeconds(seconds) {
  const wanted = Number(seconds) || 6;
  return SHOT_SECONDS.reduce(
    (best, option) => (Math.abs(option - wanted) < Math.abs(best - wanted) ? option : best),
    SHOT_SECONDS[0],
  );
}

/**
 * รัน Grok CLI หนึ่งรอบแบบ headless
 *
 * พรอมป์ไปทางไฟล์เพราะ grok ไม่อ่าน stdin และพรอมป์ภาพยาวเกินกว่าจะฝากไว้ใน argv
 * ของ Windows ได้อย่างปลอดภัย — เหตุผลเดียวกับที่ callCliProvider ทำใน providers.mjs
 *
 * cwd ตั้งเป็นโฟลเดอร์ปลายทางเสมอ แล้วสั่งด้วยชื่อไฟล์แบบสัมพัทธ์ ตัวแทนจะได้ไม่ต้อง
 * เดาพาธเต็มบน Windows ซึ่งมีทั้งช่องว่างและ backslash
 */
export async function runGrokTask(instruction, { cwd, timeoutMs = IMAGE_TIMEOUT_MS, signal, label = "งาน" } = {}) {
  ensureDir(cwd);
  const promptFile = path.join(cwd, `.grok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(promptFile, instruction, "utf8");
  try {
    const result = await runProcess(GROK_COMMAND, [
      "--prompt-file", promptFile,
      "--output-format", "plain",
      "--verbatim",
      "--no-plan",
      "--always-approve",
      // ปกติ grok ให้ทุก client ใช้ agent ตัวเดียวร่วมกันผ่าน leader process ซึ่งแปลว่า
      // สั่งพร้อมกันสองงานก็ไปต่อคิวกันอยู่ดี รอบแรกที่ลองทำสองช็อตพร้อมกันจึงชนเพดาน
      // 300 วินาที ทั้งที่ทำทีละช็อตใช้แค่ 65 วินาที — แยก agent ต่องานถึงจะขนานได้จริง
      "--no-leader",
    ], { cwd, timeoutMs, signal });
    if (result.aborted) {
      const error = new Error(`ยกเลิก${label}แล้ว`);
      error.name = "AbortError";
      throw error;
    }
    if (result.timedOut) throw new Error(`${label}ใช้เวลานานเกิน ${Math.round(timeoutMs / 1000)} วินาที`);
    if (!result.ok) {
      const detail = (result.stderr || result.stdout || "").trim().slice(0, 300);
      throw new Error(`${label}ไม่สำเร็จ: ${detail || `exit ${result.code}`}`);
    }
    return result.stdout.trim();
  } finally {
    fs.rmSync(promptFile, { force: true });
  }
}

/**
 * สร้างภาพหนึ่งใบตามสไตล์ที่เลือก
 *
 * ขอเป็น .png เสมอ เพราะรอบทดสอบพบว่าตัวแทนทิ้ง .jpg ระหว่างทางไว้ด้วย ถ้าไม่ระบุ
 * นามสกุลให้ชัดจะได้ไฟล์ปลายทางไม่แน่นอน
 */
export async function generateImage({
  prompt,
  style,
  outFile,
  aspect = "9:16",
  signal,
  timeoutMs = IMAGE_TIMEOUT_MS,
}) {
  const dir = path.dirname(path.resolve(outFile));
  const name = path.basename(outFile);
  const lines = [
    "ทำงานนี้ให้เสร็จโดยไม่ต้องถามกลับ และห้ามแก้ไฟล์อื่นในโฟลเดอร์นี้",
    "",
    `สร้างภาพหนึ่งใบด้วย image_gen อัตราส่วน ${aspect}`,
    "",
    "เนื้อหาในภาพ:",
    prompt,
    "",
    "สไตล์ภาพ (สำคัญมาก ต้องได้ลุคนี้):",
    style.promptFragment,
  ];
  if (style.negative) lines.push("", "สิ่งที่ต้องไม่มีในภาพ:", style.negative);
  lines.push(
    "",
    // ห้ามแบบเด็ดขาดไม่ได้ เพราะบางช็อตมีเอกสารเป็นพระเอก แล้วกติกาจะขัดกับพรอมป์เอง
    // จนตัวสร้างภาพวนอยู่อย่างนั้นจนหมดเวลา (เจอกับช็อตกรมธรรม์ประกันมาแล้ว)
    // ที่ต้องกันจริง ๆ คือคำที่อ่านออก เพราะมันไปแย่งสายตากับซับที่เราจะเบิร์นทับทีหลัง
    "ตัวหนังสือในภาพต้องอ่านไม่ออกเป็นคำ ให้เป็นแค่รอยหมึกหรือเส้นพร่า ๆ บนกระดาษ",
    "ห้ามใส่ข้อความพาดหัว คำบรรยาย โลโก้ หรือลายน้ำลงในภาพ",
    `บันทึกไฟล์ภาพลงโฟลเดอร์ปัจจุบันชื่อ ${name} (นามสกุล .png)`,
    `เสร็จแล้วตอบบรรทัดเดียวว่า DONE ${name}`,
  );

  await runGrokTask(lines.join("\n"), { cwd: dir, timeoutMs, signal, label: "การสร้างภาพ" });

  const produced = path.join(dir, name);
  if (!fs.existsSync(produced)) throw new Error(`สร้างภาพแล้วแต่ไม่พบไฟล์ ${name}`);
  const size = await imageSize(produced, { signal });
  if (!size.width || !size.height) throw new Error(`อ่านขนาดภาพ ${name} ไม่ได้`);
  return { file: produced, ...size };
}

/**
 * ขยับภาพนิ่งให้เป็นวิดีโอ
 *
 * ขอ 720p เสมอ ค่าเริ่มต้นของเครื่องมือคือ 480p ซึ่งได้ 400x736 — อัปเป็น 1080x1920
 * แล้วเละ ส่วน 720p ได้ 720x1280 ซึ่งอัปแค่ 1.5 เท่า
 */
export async function animateImage({
  imageFile,
  motion,
  style,
  outFile,
  seconds = 6,
  signal,
  timeoutMs = VIDEO_TIMEOUT_MS,
}) {
  const dir = path.dirname(path.resolve(outFile));
  const name = path.basename(outFile);
  const source = path.relative(dir, path.resolve(imageFile)) || path.basename(imageFile);
  const duration = nearestShotSeconds(seconds);
  const lines = [
    "ทำงานนี้ให้เสร็จโดยไม่ต้องถามกลับ และห้ามแก้ไฟล์อื่นในโฟลเดอร์นี้",
    "",
    `ใช้ไฟล์ภาพ ${source} สร้างวิดีโอด้วย image_to_video`,
    `ตั้งความละเอียด 720p และความยาว ${duration} วินาที`,
    "",
    "การเคลื่อนไหวที่ต้องการ:",
    motion,
    style.motionFragment ? `โดยรวมให้คงลุค: ${style.motionFragment}` : "",
    "",
    "ห้ามเพิ่มตัวหนังสือ ห้ามเปลี่ยนองค์ประกอบในภาพ ขยับกล้องและรายละเอียดเล็ก ๆ เท่านั้น",
    `บันทึกวิดีโอลงโฟลเดอร์ปัจจุบันชื่อ ${name}`,
    `เสร็จแล้วตอบบรรทัดเดียวว่า DONE ${name}`,
  ].filter(Boolean);

  await runGrokTask(lines.join("\n"), { cwd: dir, timeoutMs, signal, label: "การสร้างวิดีโอ" });

  const produced = path.join(dir, name);
  if (!fs.existsSync(produced)) throw new Error(`สร้างวิดีโอแล้วแต่ไม่พบไฟล์ ${name}`);
  const ms = await durationMs(produced, { signal });
  if (!(ms > 0)) throw new Error(`อ่านความยาววิดีโอ ${name} ไม่ได้`);
  const meta = await probe(produced, { signal });
  return { file: produced, durationMs: ms, width: meta?.width ?? null, height: meta?.height ?? null };
}
