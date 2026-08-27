// voice-clones — เสียงต้นแบบที่ผู้ใช้อัดไว้เอง สำหรับให้ JaiTTS โคลนตาม
//
// เก็บเป็นโฟลเดอร์ต่อหนึ่งเสียง: data/voices/<id>/ref.wav + voice.json
// ไม่เก็บลงฐานข้อมูลเพราะตัวไฟล์เสียงต้องอยู่บนดิสก์อยู่แล้ว (worker อ่านจาก path)
// การมีที่เดียวทำให้สำรองหรือย้ายเครื่องแค่ก๊อปโฟลเดอร์ไป
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

function readMeta(dir, id) {
  const metaFile = path.join(dir, id, "voice.json");
  const wav = path.join(dir, id, "ref.wav");
  if (!fs.existsSync(metaFile) || !fs.existsSync(wav)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (!meta?.text?.trim()) return null;
    return {
      id,
      name: String(meta.name || id),
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

/** เสียงโคลนทั้งหมดที่ใช้ได้จริง เรียงจากใหม่ไปเก่า */
export function listClones({ dir = clonesDir() } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMeta(dir, entry.name))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

export function readClone(id, { dir = clonesDir() } = {}) {
  if (!id || typeof id !== "string" || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return readMeta(dir, id);
}

/**
 * บันทึกเสียงต้นแบบใหม่
 *
 * ข้อความต้องตรงกับที่พูดในไฟล์เป๊ะ ๆ ไม่งั้น F5-TTS จะเพี้ยน — ผู้เรียกควรถอดข้อความ
 * ด้วย whisper ที่ติดตั้งอยู่แล้วแทนที่จะให้ผู้ใช้พิมพ์เอง
 */
export function saveClone({ wavBuffer, text, name, durationMs }, { dir = clonesDir() } = {}) {
  if (!Buffer.isBuffer(wavBuffer) || !wavBuffer.length) throw new Error("ไม่มีไฟล์เสียงต้นแบบ");
  if (!text?.trim()) throw new Error("ต้องมีข้อความที่ตรงกับเสียงต้นแบบ");
  const id = cloneIdFor(wavBuffer);
  const target = path.join(dir, id);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "ref.wav"), wavBuffer);
  const meta = {
    id,
    name: String(name || "เสียงของฉัน").slice(0, 60),
    text: String(text).trim(),
    durationMs: Number(durationMs) || null,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(target, "voice.json"), JSON.stringify(meta, null, 2), "utf8");
  return { ...meta, wav: path.join(target, "ref.wav"), provider: "jaitts" };
}

export function deleteClone(id, { dir = clonesDir() } = {}) {
  const clone = readClone(id, { dir });
  if (!clone) return false;
  fs.rmSync(path.join(dir, id), { recursive: true, force: true });
  return true;
}
