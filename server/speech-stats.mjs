// speech-stats — สะสมความเร็วพูดที่วัดได้จากงานจริง เก็บในตาราง settings
import { SPEECH_RATE_SETTING, lookupSpeechModel, mergeSamples } from "../pipeline/speech-rate.mjs";

/**
 * เก็บเป็น JSON ก้อนเดียวในตาราง settings แทนที่จะทำตารางใหม่
 *
 * ข้อมูลคือผลรวมไม่กี่ตัวต่อคู่ (provider, เสียง, ความเร็ว) ไม่โตตามจำนวนงาน
 * และไม่มีใครต้อง query มัน การเพิ่มตารางจึงแลกมาด้วย migration ที่ไม่คุ้ม
 */
export function readSpeechRates(store) {
  try {
    const raw = store?.getSettings?.()?.[SPEECH_RATE_SETTING];
    if (!raw) return {};
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // ค่าที่อ่านไม่ออกไม่ควรทำให้ทั้งระบบใช้ไม่ได้ — เริ่มนับใหม่ยังดีกว่า
    return {};
  }
}

/** บันทึกสถิติของงานที่เพิ่งเรนเดอร์เสร็จ ล้มเหลวเงียบ ๆ ได้เพราะไม่ใช่ผลงานของผู้ใช้ */
export function recordSpeechSample(store, sample) {
  if (!store?.setSetting || !sample?.key || !(sample.n > 0)) return false;
  try {
    const rates = readSpeechRates(store);
    const merged = mergeSamples(rates[sample.key], { n: sample.n, graphemes: sample.graphemes, ms: sample.ms });
    if (!merged) return false;
    store.setSetting(SPEECH_RATE_SETTING, JSON.stringify({ ...rates, [sample.key]: merged }));
    return true;
  } catch {
    return false;
  }
}

/** แบบจำลองความเร็วพูดที่ใกล้เคียงที่สุดสำหรับเสียงที่กำลังจะใช้ */
export function speechModelFor(store, voice) {
  return lookupSpeechModel(readSpeechRates(store), voice);
}
