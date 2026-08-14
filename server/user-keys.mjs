/**
 * คีย์ Gemini ของแต่ละคน และการนับโควตารายคน
 *
 * โควตาของ Google ผูกกับ "คีย์" ไม่ใช่กับผู้ใช้ในระบบเรา การแยกโควตาให้จริงจึงทำได้
 * ทางเดียวคือให้แต่ละคนใช้คีย์ของตัวเอง ส่วนตัวเลขที่เรานับไว้เองเป็นแค่การมองเห็น
 * และเพดานกันคนใดคนหนึ่งใช้จนหมด ไม่ได้แทนโควตาจริงของ Google
 */

/** คีย์ของผู้ใช้ในรูปแบบ environment ที่ listGeminiKeys อ่านได้ */
export function userKeyEnvironment(store, userId) {
  if (!userId) return null;
  const keys = store.listUserKeys?.(userId) ?? [];
  if (!keys.length) return null;
  const env = {};
  keys.forEach((entry, index) => {
    env[index === 0 ? "GEMINI_API_KEY" : `GEMINI_API_KEY_${index + 1}`] = entry.key;
  });
  return env;
}

/**
 * ผู้ใช้คนนี้ใช้คีย์ชุดไหน
 * มีคีย์ของตัวเอง = ใช้ของตัวเอง, ไม่มี = ใช้ของเครื่อง (โหมดผู้ใช้เดียวแบบเดิม)
 */
export function keySourceFor(store, userId) {
  const env = userKeyEnvironment(store, userId);
  return {
    environment: env,
    scope: env ? "user" : "machine",
    count: env ? Object.keys(env).length : 0,
  };
}

/** เพดานคำขอต่อวันต่อคน — 0 หรือไม่ตั้ง = ไม่จำกัด */
export function dailyCap(store) {
  const raw = store.getSettings?.().dailyRequestCap;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * ยังยิงได้อีกไหม
 * เพดานใช้เฉพาะกับคนที่ใช้คีย์ของเครื่อง — ใครเอาคีย์ตัวเองมาใส่ก็จ่ายโควตาเอง
 * ไม่มีเหตุผลจะไปจำกัดเขา
 */
export function quotaGate(store, userId, { needed = 1 } = {}) {
  const cap = dailyCap(store);
  const { scope } = keySourceFor(store, userId);
  if (!cap || !userId || scope === "user") return { allowed: true, cap: 0, used: 0, remaining: Infinity, scope };
  const used = store.usageToday?.(userId) ?? 0;
  const remaining = Math.max(0, cap - used);
  return { allowed: remaining >= needed, cap, used, remaining, scope };
}
