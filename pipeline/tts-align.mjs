// tts-align — หาว่าแต่ละท่อนของสคริปต์อยู่ช่วงเวลาไหนในไฟล์เสียงที่ยิงรวดเดียว
//
// ทำไมไม่ใช้ช่วงเงียบ: Gemini ไม่ทำตามคำสั่ง "เว้นจังหวะระหว่างบรรทัด" เสมอไป
// วัดจากของจริงแล้วพบว่ามันอ่านติดกันบางคู่ ทำให้จำนวนช่วงเสียงน้อยกว่าจำนวนท่อน
// ไม่ว่าจะตั้งเกณฑ์ความเงียบเท่าไรก็หารอยต่อที่ไม่มีอยู่จริงไม่เจอ
//
// วิธีนี้ใช้ข้อได้เปรียบที่ว่า **เรารู้สคริปต์อยู่แล้ว** จึงเอาตัวอักษรที่ถอดได้ไป
// จับคู่กับสคริปต์ต้นฉบับ แล้วอ่านเวลาจากตัวอักษรที่ตรงกัน — ไม่ต้องพึ่งความเงียบเลย
//
// ตัวถอดเสียงอ่านคำผิดบ้างเป็นเรื่องปกติ (ไทยไม่มีเว้นวรรค) แต่ไม่กระทบ เพราะเรา
// ทิ้งคำที่มันเดาแล้วใช้แต่ "เวลา" ส่วนที่อ่านผิดจะถูกข้ามไปตอนจับคู่

/** ตัดช่องว่างออกให้เทียบกันได้ — ตัวถอดเสียงเว้นวรรคไม่เหมือนสคริปต์ */
const squash = (text) => String(text ?? "").replace(/\s+/gu, "");

/**
 * จับคู่ตัวอักษรสองสายด้วย LCS
 *
 * ใช้ตารางเต็มเพราะสคริปต์หนึ่งคลิปยาวไม่กี่ร้อยตัวอักษร (200×200 = 40,000 ช่อง)
 * เร็วกว่าที่จะรู้สึกได้ และให้ผลดีที่สุดเสมอ ต่างจากการไล่จับคู่แบบโลภที่พลาดง่าย
 * เมื่อตัวถอดเสียงแทรกหรือตกตัวอักษรกลางประโยค
 *
 * คืน Map: ดัชนีใน a → ดัชนีใน b
 */
export function matchIndexes(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return new Map();

  // table[i][j] = ความยาว LCS ของ a[i..] กับ b[j..]
  const table = new Int32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[at(i, j)] = a[i] === b[j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }

  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.set(i, j);
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * แปลง token ที่ได้จากตัวถอดเสียง เป็นสายตัวอักษรพร้อมเวลาประจำตัวอักษร
 * tokens: [{ text, startMs, endMs }]
 */
function flattenTokens(tokens) {
  let text = "";
  const times = [];
  for (const token of tokens) {
    const piece = squash(token?.text);
    if (!piece) continue;
    const startMs = Number(token.startMs);
    const endMs = Number(token.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    // ทุกตัวอักษรในโทเคนใช้ช่วงเวลาเดียวกัน — ละเอียดพอสำหรับหารอยต่อระหว่างท่อน
    for (let index = 0; index < piece.length; index += 1) times.push([startMs, endMs]);
    text += piece;
  }
  return { text, times };
}

/** หาเวลาของตัวอักษรตำแหน่ง refIndex โดยขยับหาตัวที่จับคู่ได้ใกล้ที่สุด */
function timeNear(pairs, times, refIndex, span) {
  for (let distance = 0; distance <= span; distance += 1) {
    for (const candidate of [refIndex - distance, refIndex + distance]) {
      const mapped = pairs.get(candidate);
      if (mapped != null && mapped < times.length) return times[mapped];
    }
  }
  return null;
}

/**
 * หาช่วงเวลาของแต่ละท่อนจากไฟล์เสียงรวม
 *
 * คืน null พร้อมเหตุผลเมื่อผลลัพธ์ไม่น่าเชื่อถือ — ผู้เรียกต้องถอยไปยิงทีละท่อน
 * ยอมเสียโควตาหนึ่งครั้งดีกว่าปล่อยให้ซับเลื่อนไม่ตรงเสียงทั้งคลิป
 *
 * @param {string[]} texts ข้อความของแต่ละท่อน เรียงตามลำดับที่ส่งให้โมเดลอ่าน
 * @param {{text:string,startMs:number,endMs:number}[]} tokens ผลจากตัวถอดเสียง
 * @param {{totalMs:number, minCoverage?:number, minChunkMs?:number, searchSpan?:number}} options
 */
export function alignChunks(texts, tokens, options = {}) {
  const {
    totalMs,
    // ต่ำกว่านี้แปลว่าตัวถอดเสียงได้ยินคนละเรื่องกับสคริปต์ เชื่อเวลาไม่ได้
    minCoverage = 0.7,
    // ท่อนที่สั้นกว่านี้แทบแน่นอนว่าจับคู่ผิด ไม่ใช่คนพูดเร็ว
    minChunkMs = 200,
    searchSpan = 30,
  } = options;

  const lines = texts.map((text) => squash(text));
  if (lines.length < 2) return { ok: false, reason: "มีท่อนเดียว ไม่ต้องตัด" };
  if (lines.some((line) => !line)) return { ok: false, reason: "มีท่อนที่ไม่มีข้อความ" };
  if (!Number.isFinite(totalMs) || totalMs <= 0) return { ok: false, reason: "ไม่รู้ความยาวไฟล์เสียง" };

  const reference = lines.join("");
  const ends = [];
  let cursor = 0;
  for (const line of lines) {
    cursor += line.length;
    ends.push(cursor);
  }

  const { text: hypothesis, times } = flattenTokens(tokens);
  if (!hypothesis) return { ok: false, reason: "ตัวถอดเสียงไม่คืนคำใด ๆ" };

  const pairs = matchIndexes(reference, hypothesis);
  const coverage = pairs.size / reference.length;
  if (coverage < minCoverage) {
    return {
      ok: false,
      reason: `ข้อความที่ถอดได้ตรงกับสคริปต์แค่ ${Math.round(coverage * 100)}%`,
      coverage,
    };
  }

  // รอยต่อ = เวลาจบของตัวอักษรสุดท้ายในแต่ละท่อน (ยกเว้นท่อนสุดท้าย)
  const boundaries = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const found = timeNear(pairs, times, ends[index] - 1, searchSpan);
    if (!found) return { ok: false, reason: `หารอยต่อของท่อนที่ ${index + 1} ไม่เจอ`, coverage };
    boundaries.push(found[1]);
  }

  const spans = [];
  for (let index = 0; index < lines.length; index += 1) {
    const startMs = index === 0 ? 0 : boundaries[index - 1];
    const endMs = index === lines.length - 1 ? totalMs : boundaries[index];
    // เรียงผิดลำดับ = จับคู่พลาด อย่าเดาต่อ
    if (!(endMs > startMs)) {
      return { ok: false, reason: `ท่อนที่ ${index + 1} ได้ช่วงเวลาที่ย้อนกลับ`, coverage };
    }
    if (endMs - startMs < minChunkMs) {
      return { ok: false, reason: `ท่อนที่ ${index + 1} สั้นผิดปกติ (${Math.round(endMs - startMs)} มิลลิวินาที)`, coverage };
    }
    spans.push({ index, startSec: startMs / 1000, endSec: Math.min(totalMs, endMs) / 1000 });
  }

  return { ok: true, coverage, spans };
}
