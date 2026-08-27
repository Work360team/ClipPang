// speech-rate — อัตราการพูดที่ "วัดจากงานจริง" แทนการเดาด้วยค่าคงที่ตัวเดียว
import { graphemeCount } from "./core.mjs";

/**
 * ทำไมต้องวัดเอง
 *
 * ของเดิมใช้ค่าคงที่ 6.4 ตัวอักษร/วินาที ซึ่งวัดมาจาก edge-tts th-TH-Premwadee
 * แต่ผู้ใช้จริงเรนเดอร์ด้วย Gemini คนละเอนจินกัน วัดจากงานจริงได้ 10.7 ตัวอักษร/วินาที
 * การขอสคริปต์ด้วยอัตราที่ช้ากว่าความจริงเกือบเท่าตัว ทำให้ได้สคริปต์สั้นกว่าคลิป
 * แทบทุกครั้ง แล้วท้ายคลิปก็เงียบยาว
 *
 * ค่านี้ยังขยับได้อีกเมื่อเปลี่ยนเสียง เปลี่ยนความเร็ว หรือแม้แต่เปลี่ยน pipeline เสียง
 * (ตอนที่ยังไม่ตัดหางเงียบท้ายท่อน วัดได้ 5.8–7.8 เพราะนับความเงียบเป็นเสียงพูดด้วย)
 * จึงไม่ควรฝังเป็นค่าคงที่อีก แต่ให้เก็บสถิติจากงานที่เรนเดอร์จริงแล้วใช้ค่านั้น
 *
 * ใช้อัตราส่วนตรง ๆ ไม่ใช่เส้นตรงที่มีค่าคงที่ต่อท่อน เพราะทดสอบกับข้อมูลจริงแล้ว
 * แม่นเท่ากัน (คลาดเคลื่อนเฉลี่ย 127ms/ท่อน ทั้งคู่) และท่อนในระบบนี้ยาว 11–16
 * ตัวอักษรเกือบทั้งหมด ช่วงแคบเกินกว่าจะหาค่าคงที่ต่อท่อนได้อย่างน่าเชื่อถือ
 */

/** คีย์ในตาราง settings ที่เก็บสถิติสะสม */
export const SPEECH_RATE_SETTING = "speechRates";

/** ค่าตั้งต้นก่อนมีข้อมูลของตัวเอง หน่วยเป็นตัวอักษร/วินาที */
/**
 * gemini มาจากการวัดงานจริงหลัง pipeline เสียงตัดหางเงียบแล้ว (10.7)
 * jaitts วัดจากการสังเคราะห์จริงบนเครื่องนี้ได้ราว 9-12 ตัวอักษร/วินาที
 * ทั้งคู่ตั้งไว้ต่ำกว่าที่วัดได้เล็กน้อย เพราะพลาดทางช้าปลอดภัยกว่า — สคริปต์สั้นไป
 * ระบบตัดคลิปให้พอดีได้ แต่สคริปต์ยาวเกินจะไปจบที่ error ที่ผู้ใช้ต้องแก้เอง
 */
const DEFAULT_RATES = { gemini: 9.5, jaitts: 9.5 };
export const FALLBACK_GRAPHEMES_PER_SEC = 6.4;

/** ท่อนที่สั้นหรือยาวผิดปกติมักมาจากไฟล์เสียงพัง ไม่ใช่ลักษณะการพูดจริง */
const MIN_CHUNK_MS = 200;
const MAX_CHUNK_MS = 20000;

/** ต่ำกว่านี้ยังไม่เชื่อค่าที่วัดได้ ใช้ค่าตั้งต้นไปก่อน */
const MIN_SAMPLES = 6;

/**
 * รุ่นของวิธีวัด
 *
 * ค่าที่เก็บไว้ก่อนหน้านี้นับตัวอักษรจากคำที่พูดจริง แต่จับเวลาจากเสียงที่ยังข้าม
 * ตัวเลขไปเงียบ ๆ อัตราที่ได้จึงเร็วเกินจริงเกือบเท่าตัว (วัดได้ 15.87 ตัว/วินาที
 * ทั้งที่ของจริงราว 8-10) ทิ้งค่าที่วัดด้วยวิธีเก่าแล้วเริ่มนับใหม่ ดีกว่าปล่อยให้
 * ค่าเพี้ยนไปกำหนดความยาวสคริปต์
 */
export const SAMPLE_VERSION = 2;

/** กรอบที่เป็นไปได้ของภาษาพูด กันข้อมูลแปลก ๆ ทำให้ประเมินเพี้ยนไปคนละโลก */
const RATE_RANGE = [3, 25];

/** ความยาวท่อนโดยทั่วไปในระบบนี้ — พรอมต์กำหนดไว้ว่าไม่เกิน 22 ตัวอักษร */
export const TYPICAL_CHUNK_GRAPHEMES = 13;

export function speechKey({ provider, voice, speed } = {}) {
  const value = Number(speed);
  const safeSpeed = Number.isFinite(value) && value > 0 ? value : 1;
  return [provider || "?", voice || "?", safeSpeed.toFixed(2)].join("|");
}

/**
 * สรุปท่อนที่พูดจริงเป็นผลรวม เก็บผลรวมแทนที่จะเก็บทุกท่อน
 * เพราะได้ค่าเฉลี่ยเหมือนกันแต่ไม่โตขึ้นตามจำนวนงานที่เรนเดอร์
 */
export function sampleChunks(chunks) {
  let n = 0;
  let graphemes = 0;
  let ms = 0;
  for (const chunk of chunks ?? []) {
    const count = graphemeCount(String(chunk?.text ?? "").trim());
    const duration = Math.round(Number(chunk?.durationMs ?? ((chunk?.endMs ?? 0) - (chunk?.startMs ?? 0))));
    if (!count || !Number.isFinite(duration) || duration < MIN_CHUNK_MS || duration > MAX_CHUNK_MS) continue;
    n += 1;
    graphemes += count;
    ms += duration;
  }
  return n ? { v: SAMPLE_VERSION, n, graphemes, ms } : null;
}

export function mergeSamples(previous, next) {
  if (!next?.n) return previous ?? null;
  // ของเก่าที่วัดด้วยวิธีคนละรุ่นเอามารวมกันไม่ได้ ทิ้งแล้วเริ่มจากชุดใหม่
  if (!previous?.n || previous.v !== next.v) return { ...next };
  return {
    v: next.v,
    n: previous.n + next.n,
    graphemes: previous.graphemes + next.graphemes,
    ms: previous.ms + next.ms,
  };
}

function defaultRate(provider) {
  return DEFAULT_RATES[String(provider ?? "").toLowerCase()] ?? FALLBACK_GRAPHEMES_PER_SEC;
}

function modelFrom(sample, { provider, speed = 1, source } = {}) {
  const factor = Number(speed) > 0 ? Number(speed) : 1;
  const fallback = defaultRate(provider) * factor;
  const asDefault = { graphemesPerSec: fallback, msPerGrapheme: 1000 / fallback, samples: sample?.n ?? 0, source: "default" };
  if (!sample?.n || sample.v !== SAMPLE_VERSION || sample.n < MIN_SAMPLES || !(sample.graphemes > 0) || !(sample.ms > 0)) return asDefault;
  const rate = (sample.graphemes / sample.ms) * 1000;
  if (!(rate >= RATE_RANGE[0] && rate <= RATE_RANGE[1])) return asDefault;
  return { graphemesPerSec: rate, msPerGrapheme: 1000 / rate, samples: sample.n, source: source ?? "measured" };
}

/**
 * หาแบบจำลองที่ใกล้เคียงที่สุดที่มี
 *
 * ไล่จากตรงเป๊ะ → เสียงเดียวกันคนละความเร็ว (เทียบตามความเร็วตรง ๆ เพราะ atempo
 * ย่อเวลาเป็นสัดส่วน) → เสียงไหนก็ได้ของ provider เดียวกัน → ค่าตั้งต้น
 */
export function lookupSpeechModel(rates, { provider, voice, speed } = {}) {
  const table = rates && typeof rates === "object" ? rates : {};
  const wanted = Number(speed);
  const targetSpeed = Number.isFinite(wanted) && wanted > 0 ? wanted : 1;

  const exact = table[speechKey({ provider, voice, speed })];
  if (exact?.n >= MIN_SAMPLES && exact?.v === SAMPLE_VERSION) return modelFrom(exact, { provider, speed: targetSpeed });

  const entries = Object.entries(table).filter(([, value]) => value?.n >= MIN_SAMPLES && value?.v === SAMPLE_VERSION);
  const sameVoice = entries.filter(([key]) => {
    const [keyProvider, keyVoice] = key.split("|");
    return keyProvider === (provider || "?") && keyVoice === (voice || "?");
  });
  if (sameVoice.length) {
    const [key, sample] = sameVoice.sort((a, b) => b[1].n - a[1].n)[0];
    const sampleSpeed = Number(key.split("|")[2]) || 1;
    const model = modelFrom(sample, { provider, speed: targetSpeed, source: "measured-scaled" });
    if (model.source === "default") return model;
    const factor = targetSpeed / sampleSpeed;
    return { ...model, graphemesPerSec: model.graphemesPerSec * factor, msPerGrapheme: model.msPerGrapheme / factor };
  }

  const sameProvider = entries.filter(([key]) => key.split("|")[0] === (provider || "?"));
  if (sameProvider.length) {
    const merged = sameProvider.reduce((acc, [, sample]) => mergeSamples(acc, sample), null);
    return modelFrom(merged, { provider, speed: targetSpeed, source: "measured-nearby" });
  }
  return modelFrom(null, { provider, speed: targetSpeed });
}

/** เวลาพูดของหนึ่งท่อน */
export function chunkMs(model, text) {
  const graphemes = graphemeCount(String(text ?? ""));
  if (!graphemes) return 0;
  return Math.round(graphemes * model.msPerGrapheme);
}

/** เวลาพากย์ทั้งชุด รวมเงียบนำหน้า ช่องว่างระหว่างท่อน และหางท้าย */
export function narrationMsFor(model, chunks, timing = {}) {
  const list = (chunks ?? []).filter((chunk) => String(chunk?.text ?? "").trim());
  if (!list.length) return 0;
  const { leadInMs = 0, padMs = 0, tailMs = 0 } = timing;
  const speak = list.reduce((total, chunk) => total + chunkMs(model, chunk.text), 0);
  return Math.round(leadInMs + speak + padMs * (list.length - 1) + tailMs);
}

/**
 * งบตัวอักษรที่ควรขอจากคนเขียนสคริปต์เพื่อให้พูดเต็มคลิปพอดี
 *
 * ต้องหักเวลาที่ไม่ใช่การพูดออกก่อน — เงียบนำหน้า หางท้าย และช่องว่างระหว่างท่อน
 * ของเดิมคิดแค่ targetSec × อัตรา จึงขอเกินมาเท่ากับเวลาเว้นวรรคทั้งหมด และพอผู้ใช้
 * เปลี่ยนจังหวะเป็น "เว้นจังหวะ" (750ms/ช่อง) ก็ยิ่งเพี้ยนขึ้นอีกโดยไม่มีใครรู้
 *
 * จำนวนท่อนขึ้นกับความยาวสคริปต์ซึ่งเป็นสิ่งที่กำลังจะหา จึงประเมินหยาบ ๆ ก่อน
 * แล้ววนกลับมาคิดอีกรอบ — พอสำหรับงานประเมิน ไม่ต้องแก้สมการ
 */
export function characterBudget(model, { targetMs, timing = {}, avgChunkGraphemes = TYPICAL_CHUNK_GRAPHEMES } = {}) {
  const { leadInMs = 0, padMs = 0, tailMs = 0 } = timing;
  const room = Math.max(0, Math.round(Number(targetMs) || 0) - leadInMs - tailMs);
  if (!room || !(model?.msPerGrapheme > 0)) return 0;
  const perChunk = avgChunkGraphemes * model.msPerGrapheme;
  const chunks = Math.max(1, Math.round(room / (perChunk + padMs)));
  const usable = Math.max(0, room - padMs * (chunks - 1));
  return Math.max(0, Math.round(usable / model.msPerGrapheme));
}
