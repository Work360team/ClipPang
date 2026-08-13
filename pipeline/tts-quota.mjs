// tts-quota — จำสถานะโควตาล่าสุดที่ "การเรียกจริง" เจอ
//
// ทำไมต้องมี: การเช็คสุขภาพด้วย models.get บอกได้แค่ว่าคีย์ถูกและมีโมเดล
// แต่ **บอกโควตาไม่ได้** — คีย์ที่โควตาหมดยัง get ผ่าน 200 แล้วไปตาย 429 ตอน
// generateContent จริง ๆ ซึ่งเป็นสาเหตุที่พบบ่อยที่สุดที่งานเรนเดอร์ค้าง
//
// ไม่มี API ไหนของ Google บอกโควตาคงเหลือให้คีย์แบบ AI Studio จึงต้องอาศัย
// การจำ 429 ครั้งล่าสุดจากการใช้งานจริงแทน — ไม่ต้องยิงเพิ่ม ไม่กินโควตา

let state = null;

/**
 * เรียกเมื่อ provider เจอ 429 จากการสร้างเสียงจริง
 *
 * ต้องแยกให้ออกว่าเป็นโควตา "ต่อนาที" หรือ "ต่อวัน" เพราะ Google ส่ง retryDelay
 * สั้น ๆ (30-60 วินาที) มาให้เหมือนกันทั้งสองแบบ ถ้าเชื่อค่านั้นตรง ๆ กับโควตา
 * รายวัน เราจะบอกผู้ใช้ว่า "รออีกนาทีเดียว" ทั้งที่จริงต้องรอถึงเที่ยงคืนแปซิฟิก
 */
export function noteRateLimited({ provider = "gemini", retryAfterMs = 0, detail = "" } = {}) {
  const text = String(detail || "");
  const quotaId = /"quotaId"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? "";
  const quotaValue = Number(/"quotaValue"\s*:\s*"?(\d+)"?/.exec(text)?.[1] || 0) || null;
  state = {
    provider,
    at: Date.now(),
    retryAfterMs: Math.max(0, Number(retryAfterMs) || 0),
    quotaId,
    quotaValue,
    daily: /PerDay/i.test(quotaId),
    detail: text.slice(0, 400),
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

  // โควตารายวันไม่คืนภายในไม่กี่วินาที — ถือว่าติดไปจนถึงเที่ยงคืนแปซิฟิก
  // ซึ่งเป็นเวลาที่ Google รีเซ็ตตัวนับ free tier
  if (state.daily) {
    const resetAt = nextPacificMidnight(now);
    if (now >= resetAt) return { limited: false, lastLimitedAt: state.at };
    return {
      limited: true,
      daily: true,
      provider: state.provider,
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
    lastLimitedAt: state.at,
    retryInMs: clearsAt - now,
    detail: state.detail,
  };
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
  state = null;
}
