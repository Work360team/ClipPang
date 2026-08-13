// tts-quota — จำสถานะโควตาล่าสุดที่ "การเรียกจริง" เจอ
//
// ทำไมต้องมี: การเช็คสุขภาพด้วย models.get บอกได้แค่ว่าคีย์ถูกและมีโมเดล
// แต่ **บอกโควตาไม่ได้** — คีย์ที่โควตาหมดยัง get ผ่าน 200 แล้วไปตาย 429 ตอน
// generateContent จริง ๆ ซึ่งเป็นสาเหตุที่พบบ่อยที่สุดที่งานเรนเดอร์ค้าง
//
// ไม่มี API ไหนของ Google บอกโควตาคงเหลือให้คีย์แบบ AI Studio จึงต้องอาศัย
// การจำ 429 ครั้งล่าสุดจากการใช้งานจริงแทน — ไม่ต้องยิงเพิ่ม ไม่กินโควตา

let state = null;

/** เรียกเมื่อ provider เจอ 429 จากการสร้างเสียงจริง */
export function noteRateLimited({ provider = "gemini", retryAfterMs = 0, detail = "" } = {}) {
  state = {
    provider,
    at: Date.now(),
    retryAfterMs: Math.max(0, Number(retryAfterMs) || 0),
    detail: String(detail || "").slice(0, 200),
  };
}

/** เรียกเมื่อสร้างเสียงสำเร็จ — ถือว่าโควตากลับมาใช้ได้แล้ว */
export function noteQuotaOk(provider = "gemini") {
  if (state?.provider === provider) state = null;
}

/**
 * สถานะโควตาที่รู้ล่าสุด
 * ถือว่า "ยังติดโควตา" เฉพาะเมื่อ 429 เพิ่งเกิดและยังไม่ถึงเวลาที่ Google บอกให้รอ
 * ถ้าเลยเวลานั้นแล้วให้ถือว่าไม่รู้ (อาจกลับมาใช้ได้) ไม่ใช่บล็อกผู้ใช้ไปเรื่อย ๆ
 */
export function quotaStatus({ now = Date.now(), graceMs = 15_000 } = {}) {
  if (!state) return { limited: false };
  const clearsAt = state.at + state.retryAfterMs + graceMs;
  if (now >= clearsAt) return { limited: false, lastLimitedAt: state.at };
  return {
    limited: true,
    provider: state.provider,
    lastLimitedAt: state.at,
    retryInMs: clearsAt - now,
    detail: state.detail,
  };
}

export function resetQuotaState() {
  state = null;
}
