// voice-clones — เสียงต้นแบบที่ผู้ใช้อัดไว้เอง สำหรับให้ JaiTTS โคลนตาม
//
// เก็บเป็นโฟลเดอร์ต่อหนึ่งตัวอย่าง: data/voices/<id>/ref.wav + voice.json
// ไม่เก็บลงฐานข้อมูลเพราะตัวไฟล์เสียงต้องอยู่บนดิสก์อยู่แล้ว (worker อ่านจาก path)
// การมีที่เดียวทำให้สำรองหรือย้ายเครื่องแค่ก๊อปโฟลเดอร์ไป
//
// คนหนึ่งคนมีได้หลายตัวอย่าง แยกตามโทนเสียง เพราะ F5-TTS โคลนตามที่ได้ยินในตัวอย่าง
// เท่านั้น สั่งให้ "อ่านแบบตื่นเต้น" ด้วยข้อความไม่ได้เหมือน Gemini — อยากได้โทนไหน
// ต้องมีตัวอย่างที่พูดด้วยโทนนั้น
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TONE, VOICE_GENDERS, VOICE_TONES } from "./core.mjs";
import { sha256 } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** ต้นแบบสั้นกว่านี้ F5-TTS จับโทนเสียงไม่ทัน ยาวกว่านี้ก็ไม่ได้ช่วยให้ดีขึ้น */
export const MIN_REF_MS = 3000;
export const MAX_REF_MS = 15_000;

export function clonesDir(root = ROOT) {
  return path.join(root, "data", "voices");
}

/**
 * id ผูกกับเนื้อไฟล์เสียง ไม่ใช่ชื่อที่ผู้ใช้ตั้ง
 *
 * อัดใหม่ทับของเดิม = id ใหม่ = คีย์แคช TTS เปลี่ยนตาม ท่อนเก่าที่แคชไว้ด้วยเสียงเดิม
 * จึงไม่ถูกหยิบมาใช้ผิดตัว โดยไม่ต้องไปไล่ล้างแคชเอง
 */
export function cloneIdFor(wavBuffer) {
  return `clone-${sha256(wavBuffer.toString("base64")).slice(0, 12)}`;
}

function knownTone(value) {
  const text = String(value ?? "").trim();
  return VOICE_TONES.some((tone) => tone.id === text) ? text : DEFAULT_TONE;
}

function knownGender(value) {
  const text = String(value ?? "").trim();
  return VOICE_GENDERS.includes(text) ? text : null;
}

function readMeta(dir, id) {
  const metaFile = path.join(dir, id, "voice.json");
  const wav = path.join(dir, id, "ref.wav");
  if (!fs.existsSync(metaFile) || !fs.existsSync(wav)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (!meta?.text?.trim()) return null;
    const speaker = String(meta.speaker || meta.name || "เสียงของฉัน");
    const tone = knownTone(meta.tone);
    return {
      id,
      speaker,
      tone,
      // คนเขียนสคริปต์ต้องรู้ ไม่งั้นเสียงผู้ชายอาจได้สคริปต์ที่ลงท้ายด้วย ค่ะ
      gender: knownGender(meta.gender),
      label: `${speaker} · ${tone}`,
      text: String(meta.text),
      durationMs: Number(meta.durationMs) || null,
      createdAt: meta.createdAt || null,
      wav,
      provider: "jaitts",
    };
  } catch {
    // ไฟล์ meta พังไม่ควรทำให้เสียงอื่นหายไปทั้งหมด ข้ามตัวนี้ไป
    return null;
  }
}

/** ตัวอย่างเสียงทั้งหมดที่ใช้ได้จริง เรียงจากใหม่ไปเก่า */
export function listClones({ dir = clonesDir() } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMeta(dir, entry.name))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/** จัดกลุ่มตามคน — หน้าจอเลือกเสียงคิดเป็น "คน" ไม่ใช่ "ไฟล์ตัวอย่าง" */
export function listSpeakers({ dir = clonesDir() } = {}) {
  const grouped = new Map();
  for (const clone of listClones({ dir })) {
    if (!grouped.has(clone.speaker)) grouped.set(clone.speaker, { speaker: clone.speaker, tones: [] });
    grouped.get(clone.speaker).tones.push(clone);
  }
  return [...grouped.values()];
}

export function readClone(id, { dir = clonesDir() } = {}) {
  if (!id || typeof id !== "string" || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return readMeta(dir, id);
}

/**
 * หาตัวอย่างที่ตรงกับคนและโทนที่เลือกไว้
 *
 * ไม่มีโทนนั้นก็ใช้โทนอื่นของคนเดียวกันแทน ดีกว่าปฏิเสธไม่ให้เรนเดอร์ — เสียงยังเป็น
 * คนเดิมอยู่ แค่โทนไม่ตรงเป๊ะ ผู้เรียกดูได้จาก matchedTone ว่าตรงหรือไม่ตรง
 */
export function findClone({ speaker, tone }, { dir = clonesDir() } = {}) {
  const all = listClones({ dir });
  if (!all.length) return null;
  const mine = speaker ? all.filter((clone) => clone.speaker === speaker) : all;
  const pool = mine.length ? mine : all;
  const exact = pool.find((clone) => clone.tone === tone);
  const chosen = exact ?? pool[0];
  return { ...chosen, matchedTone: Boolean(exact) };
}

/**
 * บันทึกตัวอย่างเสียงใหม่
 *
 * ข้อความต้องตรงกับที่พูดในไฟล์เป๊ะ ๆ ไม่งั้น F5-TTS จะเพี้ยน — ผู้เรียกควรถอดข้อความ
 * ด้วย whisper ที่ติดตั้งอยู่แล้วแทนที่จะให้ผู้ใช้พิมพ์เอง
 */
export function saveClone({ wavBuffer, text, speaker, tone, gender, durationMs }, { dir = clonesDir() } = {}) {
  if (!Buffer.isBuffer(wavBuffer) || !wavBuffer.length) throw new Error("ไม่มีไฟล์เสียงต้นแบบ");
  if (!text?.trim()) throw new Error("ต้องมีข้อความที่ตรงกับเสียงต้นแบบ");
  const normalizedGender = knownGender(gender);
  if (!normalizedGender) {
    throw Object.assign(new Error("กรุณาเลือกเพศของเสียงก่อนบันทึก"), {
      status: 400,
      code: "VOICE_GENDER_REQUIRED",
    });
  }
  const id = cloneIdFor(wavBuffer);
  const target = path.join(dir, id);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "ref.wav"), wavBuffer);
  const meta = {
    id,
    speaker: String(speaker || "เสียงของฉัน").slice(0, 60),
    tone: knownTone(tone),
    gender: normalizedGender,
    text: String(text).trim(),
    durationMs: Number(durationMs) || null,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(target, "voice.json"), JSON.stringify(meta, null, 2), "utf8");
  return readMeta(dir, id);
}

/** เพิ่มเพศให้เสียงที่อัดไว้ก่อนฟีเจอร์นี้ โดยไม่ต้องอัดเสียงใหม่ */
export function updateCloneGender(id, gender, { dir = clonesDir() } = {}) {
  const clone = readClone(id, { dir });
  if (!clone) return null;
  const normalizedGender = knownGender(gender);
  if (!normalizedGender) {
    throw Object.assign(new Error("กรุณาเลือกเพศของเสียง"), {
      status: 400,
      code: "INVALID_VOICE_GENDER",
    });
  }
  const metaFile = path.join(dir, id, "voice.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, gender: normalizedGender }, null, 2), "utf8");
  return readMeta(dir, id);
}

export function deleteClone(id, { dir = clonesDir() } = {}) {
  const clone = readClone(id, { dir });
  if (!clone) return false;
  fs.rmSync(path.join(dir, id), { recursive: true, force: true });
  return true;
}
