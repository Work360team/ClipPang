// tts-health — เช็คว่า Gemini TTS พร้อมใช้ก่อนสั่งสร้างคลิป โดยไม่กินโควตา
//
// ใช้ models.get ซึ่งเป็นการอ่าน metadata ของโมเดล ไม่ใช่ generateContent
// จึงไม่นับเป็นการสร้างเสียงและไม่กินโควตา TTS ของผู้ใช้แม้แต่ครั้งเดียว
// (เช็คทุกครั้งก่อนเรนเดอร์ ถ้าไปเรียก generateContent ทดสอบจะเผาโควตาฟรี ๆ)
import { getGeminiKeyStatus } from "./security.mjs";
import { resolvedEnvironment } from "../pipeline/providers.mjs";
import { quotaStatus } from "../pipeline/tts-quota.mjs";

const CACHE_MS = 60_000;
const TIMEOUT_MS = 8000;

let cache = null;

export function ttsModelName(environment = process.env) {
  return environment.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
}

function readKey(environment) {
  const value = environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY;
  return value ? String(value).trim() : "";
}

/**
 * คืนสถานะพร้อม/ไม่พร้อม พร้อมเหตุผลที่ผู้ใช้อ่านรู้เรื่องและทำตามได้
 * ผลถูกแคช 60 วินาที เพราะเรียกก่อนทุกงานเรนเดอร์
 */
export async function checkTtsHealth({ force = false, signal, environment } = {}) {
  // ปกติไม่ส่ง environment มา → รวม process.env กับไฟล์ .env ตามที่แอปใช้จริง
  // แต่ถ้าผู้เรียกส่งมาเอง ให้ใช้ตามนั้นตรง ๆ ไม่งั้นค่าใน .env จะทับจนทดสอบเคส
  // "ไม่มีคีย์" ไม่ได้เลย
  const env = environment ? environment : resolvedEnvironment(process.env);
  const model = ttsModelName(env);
  const key = readKey(env);

  // แคชได้ ยกเว้นเพิ่งเจอ 429 จากการใช้งานจริง — กรณีนั้นผลเก่าที่บอกว่าพร้อมจะหลอกผู้ใช้
  const fresh = cache && cache.model === model && Date.now() - cache.checkedAt < CACHE_MS;
  if (!force && fresh && !(cache.ok && quotaStatus().limited)) {
    return { ...cache, cached: true };
  }

  const keyStatus = (() => {
    try {
      return getGeminiKeyStatus();
    } catch {
      return { configured: Boolean(key), last4: key ? key.slice(-4) : null };
    }
  })();

  const base = {
    model,
    checkedAt: Date.now(),
    key: { configured: Boolean(key), last4: keyStatus?.last4 ?? (key ? key.slice(-4) : null) },
    cached: false,
  };

  if (!key) {
    return (cache = {
      ...base,
      ok: false,
      code: "NO_KEY",
      reason: "ยังไม่ได้ใส่ Gemini API key — ไปที่หน้าตั้งค่าเพื่อใส่คีย์ก่อนสร้างคลิป",
    });
  }

  const started = Date.now();
  try {
    const signals = [signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
      headers: { "x-goog-api-key": key },
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });
    const latencyMs = Date.now() - started;

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      const methods = Array.isArray(data.supportedGenerationMethods) ? data.supportedGenerationMethods : [];

      // models.get ผ่านไม่ได้แปลว่าโควตาเหลือ — คีย์ที่โควตาหมดยัง get ได้ 200
      // แล้วไปตาย 429 ตอนสร้างเสียงจริง จึงต้องดูสถานะ 429 ครั้งล่าสุดจากการใช้งานจริงด้วย
      const quota = quotaStatus();
      if (quota.limited) {
        const seconds = Math.ceil(quota.retryInMs / 1000);
        return (cache = {
          ...base,
          ok: false,
          code: "RATE_LIMITED",
          reason: `โควตา Gemini เต็มเมื่อครู่นี้ — ลองใหม่อีกครั้งในราว ${seconds} วินาที (การเช็คนี้ไม่ได้ใช้โควตา)`,
          latencyMs,
          retryInMs: quota.retryInMs,
        });
      }
      return (cache = { ...base, ok: true, code: "READY", reason: null, latencyMs, supportedGenerationMethods: methods });
    }

    const body = (await response.text().catch(() => "")).slice(0, 240);
    const byStatus = {
      400: ["BAD_KEY", "คีย์ไม่ถูกต้องหรือหมดอายุ — ตรวจคีย์ในหน้าตั้งค่าอีกครั้ง"],
      401: ["BAD_KEY", "คีย์ไม่ถูกต้องหรือหมดอายุ — ตรวจคีย์ในหน้าตั้งค่าอีกครั้ง"],
      403: ["NO_ACCESS", "คีย์นี้ยังไม่มีสิทธิ์เรียกโมเดลเสียง — เปิดใช้ Generative Language API ในโปรเจกต์ Google Cloud ของคีย์"],
      404: ["NO_MODEL", `บัญชีนี้ยังไม่มีสิทธิ์ใช้โมเดล ${model} — เปลี่ยนชื่อรุ่นด้วย GEMINI_TTS_MODEL ใน .env`],
      429: ["RATE_LIMITED", "ตอนนี้โควตาเต็มชั่วคราว รอสักครู่แล้วลองใหม่ (การเช็คนี้ไม่ได้ใช้โควตา)"],
    };
    const [code, reason] = byStatus[response.status] ?? ["UNAVAILABLE", `Gemini ตอบกลับ ${response.status} — ลองใหม่อีกครั้ง`];
    return (cache = { ...base, ok: false, code, reason, status: response.status, latencyMs, detail: body });
  } catch (error) {
    const aborted = error?.name === "AbortError" || error?.name === "TimeoutError";
    return (cache = {
      ...base,
      ok: false,
      code: aborted ? "TIMEOUT" : "NETWORK",
      reason: aborted
        ? "ต่อ Gemini ไม่ทันใน 8 วินาที — เช็คอินเทอร์เน็ตแล้วลองใหม่"
        : `ต่ออินเทอร์เน็ตไปหา Gemini ไม่ได้: ${String(error?.message || error).slice(0, 120)}`,
      latencyMs: Date.now() - started,
    });
  }
}

/** ล้างแคชเมื่อผู้ใช้เปลี่ยนคีย์ ไม่งั้นจะยังเห็นสถานะเก่าอีกนาทีหนึ่ง */
export function resetTtsHealthCache() {
  cache = null;
}
