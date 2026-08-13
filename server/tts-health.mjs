// tts-health — เช็คว่า Gemini TTS พร้อมใช้ก่อนสั่งสร้างคลิป โดยไม่กินโควตา
//
// ใช้ models.get ซึ่งเป็นการอ่าน metadata ของโมเดล ไม่ใช่ generateContent
// จึงไม่นับเป็นการสร้างเสียงและไม่กินโควตา TTS ของผู้ใช้แม้แต่ครั้งเดียว
// (เช็คทุกครั้งก่อนเรนเดอร์ ถ้าไปเรียก generateContent ทดสอบจะเผาโควตาฟรี ๆ)
//
// รองรับหลายคีย์: พร้อมใช้งานถ้ามีคีย์ที่ยังไม่ติดโควตาอย่างน้อยหนึ่งใบ
import { listGeminiKeys } from "../pipeline/gemini-keys.mjs";
import { keyQuotaStatus, quotaStatus } from "../pipeline/tts-quota.mjs";
import { resolvedEnvironment } from "../pipeline/providers.mjs";

const CACHE_MS = 60_000;
const TIMEOUT_MS = 8000;

let cache = null;

export function ttsModelName(environment = process.env) {
  return environment.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
}

/** ตรวจคีย์ใบเดียวด้วย models.get — บอกได้ว่าคีย์ถูกและมีสิทธิ์เรียกโมเดลนี้ */
async function probeKey(entry, model, signal) {
  const started = Date.now();
  try {
    const signals = [signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
      headers: { "x-goog-api-key": entry.key },
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });
    const latencyMs = Date.now() - started;
    if (response.ok) return { valid: true, latencyMs };
    const byStatus = {
      400: ["BAD_KEY", "คีย์ไม่ถูกต้องหรือหมดอายุ"],
      401: ["BAD_KEY", "คีย์ไม่ถูกต้องหรือหมดอายุ"],
      403: ["NO_ACCESS", "คีย์นี้ยังไม่มีสิทธิ์เรียกโมเดลเสียง — เปิด Generative Language API ในโปรเจกต์ของคีย์"],
      404: ["NO_MODEL", `บัญชีของคีย์นี้ยังไม่มีสิทธิ์ใช้โมเดล ${model}`],
    };
    const [code, reason] = byStatus[response.status] ?? ["UNAVAILABLE", `Gemini ตอบกลับ ${response.status}`];
    return { valid: false, code, reason, status: response.status, latencyMs };
  } catch (error) {
    const aborted = error?.name === "AbortError" || error?.name === "TimeoutError";
    return {
      valid: false,
      code: aborted ? "TIMEOUT" : "NETWORK",
      reason: aborted ? "ต่อ Gemini ไม่ทันใน 8 วินาที" : `ต่ออินเทอร์เน็ตไปหา Gemini ไม่ได้: ${String(error?.message || error).slice(0, 90)}`,
      latencyMs: Date.now() - started,
    };
  }
}

function describeDaily(quota) {
  const reset = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })
    .format(new Date(quota.resetAt));
  const hours = Math.floor(quota.retryInMs / 3_600_000);
  const minutes = Math.round((quota.retryInMs % 3_600_000) / 60_000);
  const cap = quota.quotaValue ? `วันละ ${quota.quotaValue} คำขอ` : "รายวัน";
  return { reset, hours, minutes, cap };
}

/**
 * คืนสถานะพร้อม/ไม่พร้อม พร้อมเหตุผลที่ผู้ใช้อ่านรู้เรื่องและทำตามได้
 * ผลถูกแคช 60 วินาที เพราะเรียกก่อนทุกงานเรนเดอร์
 */
export async function checkTtsHealth({ force = false, signal, environment } = {}) {
  const env = environment ? environment : resolvedEnvironment(process.env);
  const model = ttsModelName(env);
  const entries = listGeminiKeys(env);

  // แคชได้ ยกเว้นสถานะโควตาเปลี่ยนไปจากตอนที่แคชไว้ (คีย์เพิ่งเต็ม หรือเพิ่งคืน)
  const liveAvailable = entries.filter((entry) => !keyQuotaStatus(entry.id).limited).length;
  const fresh = cache && cache.model === model && cache.totalKeys === entries.length && Date.now() - cache.checkedAt < CACHE_MS;
  if (!force && fresh && cache.availableKeys === liveAvailable) return { ...cache, cached: true };

  const base = { model, checkedAt: Date.now(), cached: false, totalKeys: entries.length };

  if (!entries.length) {
    return (cache = {
      ...base,
      ok: false,
      code: "NO_KEY",
      reason: "ยังไม่ได้ใส่ Gemini API key — ไปที่หน้าตั้งค่าเพื่อใส่คีย์ก่อนสร้างคลิป",
      availableKeys: 0,
      keys: [],
    });
  }

  const probes = await Promise.all(entries.map((entry) => probeKey(entry, model, signal)));
  const keys = entries.map((entry, index) => {
    const probe = probes[index];
    const quota = keyQuotaStatus(entry.id);
    const usable = probe.valid && !quota.limited;
    let note = null;
    if (!probe.valid) note = probe.reason;
    else if (quota.limited && quota.daily) {
      const { reset, cap } = describeDaily(quota);
      note = `โควตา${cap}หมด — คืนประมาณ ${reset} น.`;
    } else if (quota.limited) note = `ยิงถี่เกินโควตาต่อนาที — รออีก ${Math.ceil(quota.retryInMs / 1000)} วินาที`;
    return {
      slot: entry.slot,
      last4: entry.last4,
      usable,
      code: probe.valid ? (quota.limited ? (quota.daily ? "QUOTA_DAILY" : "RATE_LIMITED") : "READY") : probe.code,
      note,
      latencyMs: probe.latencyMs,
    };
  });

  const usable = keys.filter((key) => key.usable);
  if (usable.length) {
    return (cache = {
      ...base,
      ok: true,
      code: "READY",
      reason: null,
      availableKeys: usable.length,
      keys,
      latencyMs: Math.min(...usable.map((key) => key.latencyMs ?? 0)),
    });
  }

  // ไม่เหลือคีย์ที่ใช้ได้เลย — บอกเหตุผลของ "ใบที่ใกล้กลับมาใช้ได้ที่สุด" เป็นหลัก
  const quota = quotaStatus({ keyIds: entries.map((entry) => entry.id) });
  if (quota.limited && quota.daily) {
    const { reset, hours, minutes, cap } = describeDaily(quota);
    const many = entries.length > 1 ? `ทั้ง ${entries.length} คีย์` : "คีย์ที่ใส่ไว้";
    return (cache = {
      ...base,
      ok: false,
      code: "QUOTA_DAILY",
      reason:
        `${many}ใช้โควตา Gemini free tier ${cap} หมดแล้ว — ใบที่คืนเร็วที่สุดประมาณ ${reset} น. ` +
        `(อีก ${hours > 0 ? `${hours} ชม. ` : ""}${minutes} นาที) · เพิ่มคีย์อีกใบหรือเปิด billing เพื่อใช้ต่อได้ทันที`,
      availableKeys: 0,
      keys,
      retryInMs: quota.retryInMs,
      resetAt: quota.resetAt,
    });
  }
  if (quota.limited) {
    return (cache = {
      ...base,
      ok: false,
      code: "RATE_LIMITED",
      reason: `ทุกคีย์ยิงถี่เกินโควตาต่อนาที — รออีกราว ${Math.ceil(quota.retryInMs / 1000)} วินาที (การเช็คนี้ไม่ได้ใช้โควตา)`,
      availableKeys: 0,
      keys,
      retryInMs: quota.retryInMs,
    });
  }

  const first = keys.find((key) => key.note) ?? keys[0];
  return (cache = {
    ...base,
    ok: false,
    code: first?.code ?? "UNAVAILABLE",
    reason: entries.length > 1
      ? `ไม่มีคีย์ที่ใช้ได้เลยจาก ${entries.length} ใบ — ${first?.note ?? "ตรวจคีย์ในหน้าตั้งค่า"}`
      : first?.note ?? "ตรวจคีย์ในหน้าตั้งค่า",
    availableKeys: 0,
    keys,
  });
}

/** ล้างแคชเมื่อผู้ใช้เปลี่ยนคีย์ ไม่งั้นจะยังเห็นสถานะเก่าอีกนาทีหนึ่ง */
export function resetTtsHealthCache() {
  cache = null;
}
