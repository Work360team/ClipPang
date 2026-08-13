// gemini-keys — ทะเบียนคีย์ Gemini หลายใบสำหรับ failover
//
// ทำไมต้องหลายใบ: โควตา free tier นับ "ต่อโปรเจกต์" (GenerateRequestsPerDayPer
// ProjectPerModel) คีย์จากคนละโปรเจกต์จึงมีโควตาแยกกัน ทีมที่แต่ละคนมีคีย์ของตัวเอง
// หรือคนที่มีทั้งคีย์ฟรีและคีย์ที่เปิด billing แล้ว จะได้ไม่ต้องหยุดงานเพราะคีย์เดียวติด
//
// อ่านจาก .env:  GEMINI_API_KEY (ใบหลัก) และ GEMINI_API_KEY_2 … _9
// GOOGLE_API_KEY ยังรองรับเป็นชื่อเดิมของใบหลัก
import { createHash } from "node:crypto";
import { resolvedEnvironment } from "./providers.mjs";

export const MAX_KEYS = 9;

/** ชื่อ env ของทุกช่อง เรียงตามลำดับที่จะถูกใช้ */
export function keySlots() {
  return ["GEMINI_API_KEY", ...Array.from({ length: MAX_KEYS - 1 }, (_, i) => `GEMINI_API_KEY_${i + 2}`)];
}

/** ตัวระบุคีย์แบบไม่เปิดเผยคีย์ — ใช้เป็น key ของสถานะโควตาและแสดงใน log ได้ */
export function keyId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

/**
 * คีย์ทั้งหมดที่ตั้งไว้ เรียงตามช่อง
 * คีย์ซ้ำถูกตัดออก เพราะสองช่องที่ใส่คีย์เดียวกันไม่ได้เพิ่มโควตาอะไรเลย
 * แต่จะทำให้ระบบ failover วนไปหาคีย์ที่ติดโควตาอยู่แล้วซ้ำอีกรอบ
 */
export function listGeminiKeys(environment) {
  const env = environment ?? resolvedEnvironment(process.env);
  const seen = new Set();
  const keys = [];
  for (const slot of keySlots()) {
    const raw = slot === "GEMINI_API_KEY" ? env[slot] || env.GOOGLE_API_KEY : env[slot];
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    keys.push({ slot, key: value, id: keyId(value), last4: value.slice(-4) });
  }
  return keys;
}

/** ช่องว่างช่องแรกที่ยังใส่คีย์เพิ่มได้ */
export function nextFreeSlot(environment) {
  const env = environment ?? resolvedEnvironment(process.env);
  return keySlots().find((slot) => !String(env[slot] ?? "").trim()) ?? null;
}
