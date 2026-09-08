// เสียงประกอบอัตโนมัติ — วางเสียงตามจังหวะที่สายพานรู้อยู่แล้ว
//
// ไม่ต้องเรียก AI เพิ่มเลยสักครั้ง เพราะสองอย่างที่ต้องรู้มีอยู่ในไทม์ไลน์ครบแล้ว:
//   - คำไหนสำคัญ  → chunk.words[].emphasis ซึ่งตัวเขียนสคริปต์มาร์กไว้ให้ทำสีไฮไลต์
//   - พูดตอนไหน   → chunk.words[].startMs ซึ่งได้จาก whisper ตอนจับคำให้ซับ
//
// ชุดเสียงเก็บเป็นไฟล์ JSON ใบละชุดใน pipeline/sfx/ แบบเดียวกับสไตล์ซับและสไตล์ภาพ
// เพิ่มชุดใหม่ = วางไฟล์เพิ่ม ไม่ต้องแก้โค้ด

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KITS_DIR = path.join(HERE, "sfx");
const AUDIO_DIR = path.join(KITS_DIR, "audio");

/** จังหวะที่ชุดเสียงหนึ่งชุดรองรับ ชุดไหนไม่มีเสียงของจังหวะไหนก็แค่ข้ามจังหวะนั้นไป */
export const SFX_CUES = ["open", "transition", "accent", "close"];

export function sfxAudioDir() {
  return AUDIO_DIR;
}

/** อ่านชุดเสียงทั้งหมด เรียงตามชื่อไฟล์ให้ลำดับคงที่ทุกครั้ง */
export function listSfxKits({ dir = KITS_DIR } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const kit = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      return { ...kit, slug: kit.slug || path.basename(name, ".json") };
    });
}

export function getSfxKit(slug, options = {}) {
  if (!slug || slug === "none") return null;
  return listSfxKits(options).find((kit) => kit.slug === slug) || null;
}

/**
 * ตัดคิวที่อยู่ชิดกันเกินไปออก
 *
 * เสียงที่ดังรัวติดกันฟังเป็นเสียงรบกวน ไม่ใช่เสียงประกอบ เก็บตัวที่สำคัญกว่าไว้
 * (คิวที่มาก่อนในรายการคือตัวที่สำคัญกว่า เพราะเรียงลำดับความสำคัญมาแล้ว)
 */
function thinOut(cues, minGapMs) {
  const kept = [];
  for (const cue of cues) {
    if (kept.some((other) => Math.abs(other.atMs - cue.atMs) < minGapMs)) continue;
    kept.push(cue);
  }
  return kept.sort((a, b) => a.atMs - b.atMs);
}

/**
 * คำนวณว่าเสียงไหนต้องดังตอนไหน
 *
 * @param {{durationMs:number, chunks:{startMs:number,endMs:number,words:{startMs:number,emphasis:boolean}[]}[]}} timeline
 * @param {object} kit ชุดเสียงจาก getSfxKit
 * @param {{maxCues?:number, minGapMs?:number, gainDb?:number, tailMs?:number}} options
 * @returns {{cue:string, file:string, atMs:number, gainDb:number}[]} เรียงตามเวลา
 */
export function planSfxCues(timeline, kit, options = {}) {
  if (!kit || !timeline || !Array.isArray(timeline.chunks) || !timeline.chunks.length) return [];

  const {
    // เพดานกันไม่ให้คลิปกลายเป็นเสียงเอฟเฟกต์รัวทั้งเรื่อง สามสิบวินาทีราว ๆ สิบครั้งกำลังดี
    maxCues = 12,
    // ต่ำกว่านี้หูแยกไม่ออกว่าเป็นสองเสียง ฟังเป็นเสียงเดียวที่เพี้ยน
    minGapMs = 600,
    gainDb = -14,
    // เสียงที่ลงท้ายคลิปพอดีจะโดนตัดกลางคัน เผื่อที่ให้หางเสียงไว้
    tailMs = 400,
  } = options;

  const sounds = kit.cues || {};
  const limitMs = Number(timeline.durationMs) || 0;
  const within = (ms) => ms >= 0 && (!limitMs || ms <= limitMs - tailMs);

  const make = (name, atMs) => {
    const sound = sounds[name];
    if (!sound || !sound.file) return null;
    if (!within(atMs)) return null;
    return {
      cue: name,
      file: sound.file,
      atMs: Math.round(atMs),
      gainDb: Number(sound.gainDb ?? gainDb),
    };
  };

  // เรียงตามความสำคัญ ไม่ใช่ตามเวลา เพราะ thinOut เก็บตัวที่มาก่อนเมื่อชนกัน
  const candidates = [];

  // เปิดเรื่อง — คลิปที่ขึ้นมาเงียบ ๆ แล้วมีแต่เสียงพูดจะกลืนไปกับฟีด
  const opening = make("open", timeline.chunks[0].startMs);
  if (opening) candidates.push(opening);

  // คำที่สคริปต์สั่งให้เน้น คือจุดที่คนดูควรจำให้ได้ ให้เสียงช่วยตอกอีกที
  for (const chunk of timeline.chunks) {
    for (const word of chunk.words || []) {
      if (!word.emphasis) continue;
      const accent = make("accent", word.startMs);
      if (accent) candidates.push(accent);
    }
  }

  // รอยต่อระหว่างท่อน — ข้ามท่อนแรกเพราะชนกับเสียงเปิดเรื่องอยู่แล้ว
  for (let index = 1; index < timeline.chunks.length; index += 1) {
    const transition = make("transition", timeline.chunks[index].startMs);
    if (transition) candidates.push(transition);
  }

  return thinOut(candidates, minGapMs).slice(0, maxCues);
}

/** เติมพาธเต็มให้คิว และทิ้งคิวที่หาไฟล์เสียงไม่เจอ */
export function resolveSfxCues(cues, { dir = AUDIO_DIR } = {}) {
  return cues
    .map((cue) => ({ ...cue, path: path.join(dir, cue.file) }))
    .filter((cue) => fs.existsSync(cue.path));
}
