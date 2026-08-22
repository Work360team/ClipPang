// tts-quota — จำสถานะโควตาล่าสุดที่ "การเรียกจริง" เจอ แยกรายคีย์
//
// ทำไมต้องมี: การเช็คสุขภาพด้วย models.get บอกได้แค่ว่าคีย์ถูกและมีโมเดล
// แต่ **บอกโควตาไม่ได้** — คีย์ที่โควตาหมดยัง get ผ่าน 200 แล้วไปตาย 429 ตอน
// generateContent จริง ๆ ซึ่งเป็นสาเหตุที่พบบ่อยที่สุดที่งานเรนเดอร์ค้าง
//
// ไม่มี API ไหนของ Google บอกโควตาคงเหลือให้คีย์แบบ AI Studio จึงต้องอาศัย
// การจำ 429 ครั้งล่าสุดจากการใช้งานจริงแทน — ไม่ต้องยิงเพิ่ม ไม่กินโควตา
//
// เก็บแยกรายคีย์เพราะโควตานับต่อโปรเจกต์ คีย์ใบหนึ่งหมดไม่ได้แปลว่าใบอื่นหมดด้วย

import fs from "node:fs";

/** keyId → สถานะ 429 ล่าสุดของคีย์นั้น */
const states = new Map();

const GLOBAL = "__global__";

/**
 * ไฟล์จำสถานะข้ามการรีสตาร์ต
 *
 * โควตารายวันของ Google กินเวลาถึงเที่ยงคืนแปซิฟิกกว่าจะคืน แต่สถานะเดิมอยู่ใน
 * หน่วยความจำล้วน ปิดโปรแกรมแล้วเปิดใหม่ระบบจึงลืมหมดและไปยิงคีย์ที่เต็มอยู่ซ้ำ
 * ผู้ใช้ต้องนั่งรอ timeout ทีละใบกว่าจะรู้ว่าต้องข้าม
 *
 * keyId เป็น sha256 ของคีย์ตัดมา 12 ตัว จึงคงที่ข้ามการรีสตาร์ตและไม่เปิดเผยคีย์
 * ไฟล์นี้ไม่มีความลับอยู่ข้างใน
 */
let storeFile = null;
let saveTimer = null;

export function configureQuotaStore(file) {
  storeFile = file || null;
  if (!storeFile) return;
  try {
    const saved = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    const now = Date.now();
    for (const state of Array.isArray(saved?.states) ? saved.states : []) {
      if (!state?.keyId) continue;
      // ทิ้งอันที่หมดอายุไปแล้ว จะได้ไม่บล็อกคีย์ที่กลับมาใช้ได้แล้วตั้งแต่ตอนปิดเครื่อง
      if (!statusFor(state, now, 0).limited) continue;
      states.set(state.keyId, state);
    }
  } catch {
    // ไม่มีไฟล์หรืออ่านไม่ได้ = เริ่มจากว่าง ไม่ใช่เรื่องผิดปกติ
  }
}

function persist() {
  if (!storeFile) return;
  // รวบการเขียนไว้รอบเดียว งานเรนเดอร์หนึ่งอาจชน 429 หลายครั้งติดกัน
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(storeFile, JSON.stringify({ savedAt: Date.now(), states: [...states.values()] }));
    } catch {
      // เขียนไม่ได้ก็ยังทำงานต่อได้ แค่ลืมสถานะเมื่อรีสตาร์ตเหมือนเดิม
    }
  }, 200);
  saveTimer.unref?.();
}

/**
 * เรียกเมื่อ provider เจอ 429 จากการสร้างเสียงจริง
 *
 * ต้องแยกให้ออกว่าเป็นโควตา "ต่อนาที" หรือ "ต่อวัน" เพราะ Google ส่ง retryDelay
 * สั้น ๆ (30-60 วินาที) มาให้เหมือนกันทั้งสองแบบ ถ้าเชื่อค่านั้นตรง ๆ กับโควตา
 * รายวัน เราจะบอกผู้ใช้ว่า "รออีกนาทีเดียว" ทั้งที่จริงต้องรอถึงเที่ยงคืนแปซิฟิก
 */
export function noteRateLimited({ provider = "gemini", keyId = GLOBAL, retryAfterMs = 0, detail = "" } = {}) {
  const text = String(detail || "");
  const quotaId = /"quotaId"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? "";
  const quotaValue = Number(/"quotaValue"\s*:\s*"?(\d+)"?/.exec(text)?.[1] || 0) || null;
  states.set(keyId, {
    provider,
    keyId,
    at: Date.now(),
    retryAfterMs: Math.max(0, Number(retryAfterMs) || 0),
    quotaId,
    quotaValue,
    daily: /PerDay/i.test(quotaId),
    detail: text.slice(0, 400),
  });
  persist();
}

/** เรียกเมื่อสร้างเสียงด้วยคีย์นี้สำเร็จ — ถือว่าโควตาของคีย์นี้กลับมาใช้ได้ */
export function noteQuotaOk(keyId = GLOBAL) {
  if (states.delete(keyId)) persist();
}

function statusFor(state, now, graceMs) {
  if (!state) return { limited: false };

  // โควตารายวันไม่คืนภายในไม่กี่วินาที — ถือว่าติดไปจนถึงเที่ยงคืนแปซิฟิก
  // ซึ่งเป็นเวลาที่ Google รีเซ็ตตัวนับ free tier
  if (state.daily) {
    const resetAt = nextPacificMidnight(now);
    if (now >= resetAt) return { limited: false, lastLimitedAt: state.at };
    return {
      limited: true,
      daily: true,
      provider: state.provider,
      keyId: state.keyId,
      quotaId: state.quotaId,
      quotaValue: state.quotaValue,
      lastLimitedAt: state.at,
      retryInMs: resetAt - now,
      resetAt,
      detail: state.detail,
    };
  }

  const clearsAt = state.at + state.retryAfterMs + graceMs;
  if (now >= clearsAt) return { limited: false, lastLimitedAt: state.at };
  return {
    limited: true,
    daily: false,
    provider: state.provider,
    keyId: state.keyId,
    lastLimitedAt: state.at,
    retryInMs: clearsAt - now,
    detail: state.detail,
  };
}

/** สถานะของคีย์ใบเดียว */
export function keyQuotaStatus(keyId, { now = Date.now(), graceMs = 15_000 } = {}) {
  return statusFor(states.get(keyId), now, graceMs);
}

/**
 * ภาพรวม — ถือว่า "ติดโควตา" ก็ต่อเมื่อคีย์ที่มีทั้งหมดติดหมด
 * ถ้ายังเหลือคีย์ที่ใช้ได้แม้ใบเดียว ระบบก็ยังเดินต่อได้ ไม่ควรบล็อกผู้ใช้
 * ส่งเวลา retry ของใบที่จะคืนเร็วที่สุด เพราะนั่นคือเวลาที่ระบบกลับมาใช้ได้จริง
 */
export function quotaStatus({ keyIds = null, now = Date.now(), graceMs = 15_000 } = {}) {
  const ids = keyIds?.length ? keyIds : [...states.keys()];
  if (!ids.length) return { limited: false, keys: [] };

  const perKey = ids.map((id) => ({ keyId: id, ...statusFor(states.get(id), now, graceMs) }));
  const blocked = perKey.filter((entry) => entry.limited);
  if (blocked.length < perKey.length) {
    return { limited: false, keys: perKey, availableCount: perKey.length - blocked.length, totalCount: perKey.length };
  }

  const soonest = blocked.reduce((best, entry) => (entry.retryInMs < best.retryInMs ? entry : best), blocked[0]);
  return { ...soonest, limited: true, keys: perKey, availableCount: 0, totalCount: perKey.length };
}

/** เที่ยงคืนถัดไปตามเวลาแปซิฟิก — จุดที่ Google รีเซ็ตโควตารายวันของ free tier */
export function nextPacificMidnight(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsedMs = ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second")) * 1000;
  return now + (86_400_000 - elapsedMs);
}

export function resetQuotaState() {
  states.clear();
  persist();
}
