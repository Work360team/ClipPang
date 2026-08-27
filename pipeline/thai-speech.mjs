// thai-speech — แปลงข้อความให้เป็นรูปที่ "อ่านออกเสียงได้" สำหรับเครื่องยนต์เสียงไทย
//
// JaiTTS (F5-TTS) อ่านได้เฉพาะอักษรไทย เจอตัวเลขหรือภาษาอังกฤษแล้ว "ข้ามไปเงียบ ๆ"
// ไม่ใช่อ่านเพี้ยน — วัดจริงแล้วประโยค "แบตเตอรี่ 20000 mAh ใช้ได้นาน" ได้เสียง 1.58
// วินาที ส่วนประโยคเดียวกันที่เขียนเป็นไทยได้ 2.93 วินาที คนดูจึงไม่ได้ยินตัวเลขเลย
// ซึ่งเป็นข้อมูลที่สำคัญที่สุดของคลิปขายของ
//
// ตัวแปลงนี้ใช้กับ "เสียงที่จะพูด" เท่านั้น ซับไตเติลยังใช้ข้อความเดิมที่มีตัวเลขปกติ
// เพราะบนจอ "20000mAh" อ่านง่ายกว่า "สองหมื่นมิลลิแอมป์"

const DIGIT_WORDS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACE_WORDS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/**
 * อ่านเลขไม่เกินหกหลัก
 *
 * ภาษาไทยมีข้อยกเว้นสามข้อที่ต้องจัดการ: หลักสิบที่เป็น 1 อ่านว่า "สิบ" ไม่ใช่ "หนึ่งสิบ",
 * หลักสิบที่เป็น 2 อ่านว่า "ยี่สิบ", และหลักหน่วยที่เป็น 1 เมื่อมีหลักอื่นนำหน้าอ่านว่า "เอ็ด"
 */
function readGroup(digits, forceEt = false) {
  const value = digits.replace(/^0+(?=\d)/, "");
  if (value === "0") return "ศูนย์";
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const digit = Number(value[index]);
    const place = value.length - index - 1;
    if (digit === 0) continue;
    if (place === 1) {
      out += digit === 1 ? "สิบ" : digit === 2 ? "ยี่สิบ" : `${DIGIT_WORDS[digit]}สิบ`;
    } else if (place === 0) {
      out += digit === 1 && (value.length > 1 || forceEt) ? "เอ็ด" : DIGIT_WORDS[digit];
    } else {
      out += DIGIT_WORDS[digit] + PLACE_WORDS[place];
    }
  }
  return out;
}

/** จำนวนเต็ม — เกินหกหลักตัดเป็นช่วง "ล้าน" แล้ววนอ่านช่วงหน้าแบบเดียวกัน */
function readInteger(digits, forceEt = false) {
  const value = digits.replace(/^0+(?=\d)/, "");
  if (value.length <= 6) return readGroup(value, forceEt);
  const head = value.slice(0, value.length - 6);
  const tail = value.slice(-6);
  const tailWords = Number(tail) ? readGroup(tail, true) : "";
  return `${readInteger(head)}ล้าน${tailWords}`;
}

/**
 * ตัวเลขเป็นคำอ่านไทย รองรับจุดทศนิยมและเครื่องหมายลบ
 * ทศนิยมอ่านทีละหลักตามธรรมเนียมไทย (2.55 = สองจุดห้าห้า ไม่ใช่ สองจุดห้าสิบห้า)
 */
export function readThaiNumber(input) {
  const raw = String(input ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return "";
  const negative = raw.startsWith("-");
  const [whole, fraction] = raw.replace(/^-/, "").split(".");
  let out = (negative ? "ลบ" : "") + readInteger(whole);
  if (fraction) {
    out += `จุด${[...fraction].map((digit) => DIGIT_WORDS[Number(digit)]).join("")}`;
  }
  return out;
}

/**
 * หน่วยและสัญลักษณ์ที่เจอบ่อยในคลิปขายของ
 *
 * เรียงจากยาวไปสั้นตอนสร้าง regex เพราะ mAh ต้องชนะ A และ kg ต้องชนะ g
 * ไม่ใส่หน่วยที่เดาความหมายไม่ได้ เช่น K ใน 4K ที่อาจเป็นความละเอียดหรือหลักพัน
 */
const UNITS = {
  mah: "มิลลิแอมป์",
  kwh: "กิโลวัตต์ชั่วโมง",
  kw: "กิโลวัตต์",
  gb: "กิกะไบต์",
  mb: "เมกะไบต์",
  tb: "เทระไบต์",
  kg: "กิโลกรัม",
  mg: "มิลลิกรัม",
  ml: "มิลลิลิตร",
  cm: "เซนติเมตร",
  mm: "มิลลิเมตร",
  km: "กิโลเมตร",
  hz: "เฮิรตซ์",
  w: "วัตต์",
  v: "โวลต์",
  a: "แอมป์",
  g: "กรัม",
  l: "ลิตร",
  m: "เมตร",
};

const SYMBOLS = {
  "%": "เปอร์เซ็นต์",
  "฿": "บาท",
  $: "ดอลลาร์",
  "°": "องศา",
  "\"": "นิ้ว",
};

const UNIT_PATTERN = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * ข้อความ → รูปที่พูดได้
 *
 * คืนคำที่ยังอ่านไม่ออกกลับมาด้วย เพราะคำภาษาอังกฤษอย่างชื่อแบรนด์ถอดเป็นไทยแบบ
 * อัตโนมัติไม่ได้ (Eloop จะอ่านว่า อีลูป หรือ เอลูป ก็ได้) การเดาแทนผู้ใช้แล้วอ่านผิด
 * แย่กว่าการบอกให้เขาไปแก้เอง
 */
export function toSpokenThai(input) {
  let text = String(input ?? "");
  if (!text.trim()) return { text, unread: [], changed: false };
  const original = text;

  // ตัวเลขที่ติดหน่วยมาด้วย ต้องจับคู่กันก่อนแยกอ่าน ไม่งั้น 20000mAh จะเหลือ mAh ค้าง
  text = text.replace(
    new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\b`, "gi"),
    (_match, number, unit) => `${readThaiNumber(number)}${UNITS[unit.toLowerCase()]}`,
  );

  // ตัวเลขที่เหลือ รวมที่มีจุลภาคคั่นหลัก
  text = text.replace(/\d[\d,]*(?:\.\d+)?/g, (match) => readThaiNumber(match) || match);

  for (const [symbol, word] of Object.entries(SYMBOLS)) {
    text = text.split(symbol).join(word);
  }

  // เหลืออักษรละตินอะไรบ้าง — ตัวที่ระบบอ่านให้ไม่ได้
  const unread = [...new Set(text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [])];
  return { text, unread, changed: text !== original };
}

/** คำที่เครื่องยนต์เสียงไทยจะอ่านไม่ออก ใช้เตือนผู้ใช้ก่อนเรนเดอร์ */
export function unreadableWords(input) {
  return toSpokenThai(input).unread;
}
