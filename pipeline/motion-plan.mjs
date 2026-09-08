// วางการ์ดโมชันให้เอง — ผู้ใช้ตัดสินแค่ว่าจะเปิดหรือไม่เปิด
//
// ข้อมูลที่ต้องใช้มีอยู่ในสคริปต์อยู่แล้ว: ท่อนที่มีตัวเลขคือท่อนที่มีอะไรให้อวด
// ("ความจุ 20,000mAh", "สมุนไพร 18 ชนิด") ระบบจึงหาเองได้โดยไม่ต้องเรียก AI เพิ่ม
// และไม่ต้องให้ผู้ใช้มานั่งบอกทีละใบว่าจะใส่ตรงไหน
//
// กับดักที่เจอจากสคริปต์จริงของผู้ใช้: "ผมพก Eloop EW55" มีเลขแต่เป็นรุ่นสินค้า
// ถ้าเอาขึ้นการ์ดจะได้การ์ดที่เขียนว่า "55" ซึ่งไม่มีความหมายอะไรเลย

/** หน่วยที่เจอบ่อยในคลิปขายของไทย ใช้ยืนยันว่าเลขที่เจอเป็นสเปกจริง ไม่ใช่เลขรุ่น */
const UNITS = [
  "%", "บาท", "เดือน", "ปี", "วัน", "ชั่วโมง", "นาที", "วินาที",
  "ชนิด", "รอบ", "ครั้ง", "เม็ด", "ชิ้น", "กล่อง", "ขวด", "ซอง", "แผง",
  "คน", "เท่า", "ระดับ", "สี", "แบบ", "สูตร",
  "mAh", "W", "V", "A", "ml", "mg", "g", "kg", "cm", "mm", "km", "GB", "TB", "K",
];

// เรียงหน่วยยาวก่อนสั้น ไม่งั้น "mAh" จะถูกจับเป็น "A" แล้วเหลือ "h" ค้างไว้
const UNIT_PATTERN = [...UNITS]
  .sort((a, b) => b.length - a.length)
  .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/**
 * ตัวเลขต้องขึ้นต้นเป็นคำของตัวเอง
 *
 * (?<![\w฀-๿]) กันไม่ให้จับเลขที่ติดอยู่ท้ายคำอย่าง EW55 หรือ iPhone15
 * ซึ่งเป็นชื่อรุ่น ไม่ใช่สเปกที่เอาไปขึ้นการ์ดได้
 */
const CLAIM = new RegExp(
  `(?<![A-Za-z\\u0E00-\\u0E7F])(\\d[\\d,\\.]*(?:\\s*[-–]\\s*\\d[\\d,\\.]*)?)\\s*(${UNIT_PATTERN})?`,
  "u",
);

/**
 * คำเชื่อมที่เคยอยู่หน้าตัวเลข พอตัดตัวเลขออกแล้วมันจะห้อยค้างท้ายคำอธิบาย
 *
 * "ทั่วไปประมาณ 3-4 รอบ" ถ้าไม่ตัด จะได้การ์ดที่เขียนว่า "ทั่วไปประมาณ" ซึ่งอ่านไม่จบความ
 * เรียงยาวก่อนสั้น เพราะ "ได้ตั้งแต่" ต้องถูกตัดก่อนที่ "ได้" จะไปคว้าไปเอง
 */
const DANGLING = ["ได้ตั้งแต่", "ตั้งแต่", "ประมาณ", "มากถึง", "สูงสุด", "เกือบ", "กว่า", "ถึง", "ราว", "ได้"];

function trimDangling(label) {
  let out = label;
  for (const word of DANGLING) {
    if (out.endsWith(word) && out.length > word.length) {
      out = out.slice(0, -word.length).trim();
      break;
    }
  }
  return out;
}

/**
 * ดึงตัวเลขที่ควรขึ้นการ์ดออกจากข้อความหนึ่งท่อน
 *
 * @returns {{value:string, suffix:string, label:string, score:number}|null}
 */
export function extractNumericClaim(text) {
  const line = String(text ?? "").trim();
  if (!line) return null;
  const found = CLAIM.exec(line);
  if (!found) return null;

  const value = found[1].trim();
  const suffix = (found[2] || "").trim();
  const digits = Number(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(digits)) return null;

  // เลขโดด ๆ ที่ไม่มีหน่วยกำกับ บอกอะไรคนดูไม่ได้ ("เหลือ 3" คือเหลืออะไร)
  if (!suffix) return null;

  // ศูนย์ไม่ใช่จุดขาย — "ทาได้ตั้งแต่ 0 เดือน" หมายถึงใช้ได้ตั้งแต่แรกเกิด
  // แต่การ์ดที่ขึ้นเลข 0 ตัวใหญ่กลางจอสื่อตรงข้ามกับที่ตั้งใจ
  if (digits <= 0) return null;

  // ข้อความที่เหลือหลังตัดตัวเลขกับหน่วยออก คือคำอธิบายของการ์ด
  const label = trimDangling(line.replace(found[0], " ").replace(/\s+/g, " ").trim());

  // เปอร์เซ็นต์กับเลขหลักใหญ่สะดุดตากว่า จึงได้คิวก่อนเมื่อมีให้เลือกหลายท่อน
  let score = 1;
  if (suffix === "%") score += 2;
  if (digits >= 1000) score += 1;
  if (label) score += 1;

  return { value, suffix, label, score };
}

/** ค่าปริยายของการวางการ์ดอัตโนมัติ — เลือกให้พอดีคลิป 30–60 วินาที */
export const MOTION_PLAN_DEFAULTS = {
  maxCards: 3,
  minGapMs: 5000,
  durationMs: 3500,
  template: "number-card",
  tone: "soft",
};

/**
 * เลือกว่าท่อนไหนควรมีการ์ด
 *
 * @param {{i:number, from?:number, text:string, startMs:number}[]} chunks ท่อนจากไทม์ไลน์ หรือข้อความดิบจากหน้าเว็บ
 * @returns {{template:string, atChunk:number, durationMs:number, data:object, auto:true}[]}
 */
export function planMotionCards(chunks, options = {}) {
  const { maxCards, minGapMs, durationMs, template, tone } = { ...MOTION_PLAN_DEFAULTS, ...options };
  const list = Array.isArray(chunks) ? chunks : [];

  const candidates = [];
  for (const [index, chunk] of list.entries()) {
    const text = typeof chunk === "string" ? chunk : String(chunk?.text ?? "");
    const claim = extractNumericClaim(text);
    if (!claim) continue;
    candidates.push({
      atChunk: typeof chunk === "string" ? index : (chunk.from ?? chunk.i ?? index),
      // ไม่มีเวลาก็เรียงตามลำดับท่อนแทน หน้าเว็บเรียกก่อนมีไทม์ไลน์ได้
      atMs: Number(chunk?.startMs),
      claim,
      text,
    });
  }

  // เลือกตัวที่น่าสนใจก่อน แล้วค่อยตัดตัวที่อยู่ชิดกันเกินไปออก
  // ถ้าเรียงตามเวลาแล้วหยิบตัวแรก ๆ จะได้การ์ดที่อ่อนที่สุดของคลิปเสมอ
  const ranked = [...candidates].sort((a, b) => b.claim.score - a.claim.score || a.atChunk - b.atChunk);
  const kept = [];
  for (const item of ranked) {
    if (kept.length >= maxCards) break;
    const tooClose = kept.some((other) => (
      Number.isFinite(item.atMs) && Number.isFinite(other.atMs)
        ? Math.abs(other.atMs - item.atMs) < minGapMs
        : Math.abs(other.atChunk - item.atChunk) < 2
    ));
    if (tooClose) continue;
    kept.push(item);
  }

  return kept
    .sort((a, b) => a.atChunk - b.atChunk)
    .map((item) => ({
      template,
      atChunk: item.atChunk,
      durationMs,
      auto: true,
      data: {
        value: item.claim.value,
        suffix: item.claim.suffix,
        label: item.claim.label,
        tone,
      },
    }));
}
