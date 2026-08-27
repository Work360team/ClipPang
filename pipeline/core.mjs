// core — ตัดคำไทย / ตัดท่อน / ประกอบ timeline / duration fitting
//        →  อนาคตคือ packages/core   (ไม่มีการเรียก I/O ใด ๆ ในไฟล์นี้ ทดสอบได้ล้วน ๆ)

const MAX_CHARS_PER_CHUNK = 22;
const MAX_WORDS_PER_CHUNK = 5;

/* ---------- ภาษาไทย ---------- */

const graphemer = new Intl.Segmenter("th", { granularity: "grapheme" });
const worder = new Intl.Segmenter("th", { granularity: "word" });

/** นับ "ตัวอักษรที่มองเห็น" — สระลอยและวรรณยุกต์ไม่นับเป็นตัวใหม่ */
export function graphemeCount(s) {
  return Array.from(graphemer.segment(s)).length;
}

/**
 * ตัดคำไทยด้วย ICU ที่ติดมากับ Node (ใช้ dictionary เดียวกับที่เบราว์เซอร์ใช้)
 * คืนค่าเป็นช่วง index ในสตริงต้นฉบับ เพื่อประกอบข้อความกลับได้เป๊ะ รวมช่องว่างเดิม
 */
export function segmentWords(text) {
  const raw = [];
  for (const seg of worder.segment(text)) {
    if (!seg.segment.trim()) {
      // ช่องว่าง/วรรค — ผนวกเข้ากับคำก่อนหน้า ไม่ให้เป็นคำลอย
      if (raw.length) raw.at(-1).e = seg.index + seg.segment.length;
      continue;
    }
    raw.push({ s: seg.index, e: seg.index + seg.segment.length });
  }
  if (!raw.length && text.trim()) raw.push({ s: 0, e: text.length });

  // ICU ตัดละเอียดกว่าที่ตาอ่าน ("พก|พา", "น้ำ|หนัก") — รวมเศษสั้น ๆ กลับเข้ากับคำข้างเคียง
  // ไม่งั้นไฮไลต์จะกระพริบถี่จนอ่านไม่ทัน
  const merged = [];
  for (const w of raw) {
    const prev = merged.at(-1);
    const short = graphemeCount(text.slice(w.s, w.e).trim()) <= 2;
    if (prev && short && graphemeCount(text.slice(prev.s, w.e).trim()) <= 8) {
      prev.e = w.e;
      continue;
    }
    merged.push({ ...w });
  }
  return merged.map((w) => ({ text: text.slice(w.s, w.e), s: w.s, e: w.e }));
}

/**
 * ตัดข้อความยาวเป็นท่อนสำหรับ "หนึ่งจอ" — 2–5 คำ ไม่เกิน 22 ตัวอักษร
 * ตัดที่ขอบวลีก่อนเสมอ และห้ามตัดกลาง grapheme cluster
 */
export function chunkText(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const BREAK_AFTER = new Set(["ที่", "แล้ว", "เพราะ", "แต่", "ก็", "และ", "หรือ", "ครับ", "ค่ะ", "นะ", "เลย"]);
  const words = segmentWords(clean);
  const chunks = [];
  let cur = [];
  let curChars = 0;

  const flush = () => {
    if (!cur.length) return;
    chunks.push(clean.slice(cur[0].s, cur.at(-1).e).trim());
    cur = [];
    curChars = 0;
  };

  for (const w of words) {
    const n = graphemeCount(w.text);
    if (cur.length && (curChars + n > MAX_CHARS_PER_CHUNK || cur.length >= MAX_WORDS_PER_CHUNK)) flush();
    cur.push(w);
    curChars += n;
    const hardStop = /[.!?…]$/.test(w.text) || BREAK_AFTER.has(w.text.trim());
    if (hardStop && curChars >= 8) flush();
  }
  flush();
  return chunks.filter(Boolean);
}

/* ---------- ตำแหน่งซับ ---------- */

export const ANCHORS = ["top", "middle", "bottom"];

/**
 * ทำให้ค่า anchor เป็นหนึ่งใน top | middle | bottom
 * ทั้งสองเลนต้องอ่านค่าเดียวกันนี้ ไม่งั้นสไตล์เดียวกันจะไปโผล่คนละที่
 */
export function normalizeAnchor(value) {
  const s = String(value || "bottom").toLowerCase();
  if (s.startsWith("top")) return "top";
  if (s.startsWith("mid") || s.startsWith("center")) return "middle";
  return "bottom";
}

/**
 * marginV แปลว่า "ห่างจากขอบที่ยึด" เสมอ
 *   top    → ห่างจากขอบบน
 *   bottom → ห่างจากขอบล่าง
 *   middle → ไม่ใช้ (กลางจอพอดี)
 */
export function anchorMarginV(anchor, marginV) {
  return normalizeAnchor(anchor) === "middle" ? 0 : (marginV ?? 400);
}

/* ---------- timeline ---------- */

export const DEFAULT_TIMING = {
  leadInMs: 250,   // เงียบนำหน้า กันเสียงชนเฟรมแรก
  padMs: 400,      // ช่องว่างระหว่างท่อน — ต้องเท่ากับจังหวะ "ปกติ" ใน NARRATION_PACES
  tailMs: 500,     // ยืดท้ายให้ CTA อ่านจบ
};

/**
 * จังหวะการเว้นวรรคระหว่างท่อนพูด
 *
 * คลิปขายของสั้น ๆ ต้องการความไว ท่อนติดกันหมดฟังแล้วเร่งเร้ากว่า ส่วนเนื้อหาที่
 * ต้องให้คนย่อยตาม เว้นจังหวะแล้วฟังสบายกว่า เป็นเรื่องรสนิยมและประเภทคลิป
 * ไม่มีค่าไหนถูกที่สุด จึงให้ผู้ใช้เลือกเอง
 *
 * ปรับเฉพาะช่องว่างระหว่างท่อน ไม่แตะเงียบนำหน้าและหางท้าย เพราะสองอันนั้น
 * แก้ปัญหาคนละเรื่อง (เสียงชนเฟรมแรก และ CTA ถูกตัดจบ)
 */
/*
 * ตัวเลขนี้คือช่องว่างที่ได้ยินจริง เพราะ normalizeAudio ตัดความเงียบท้ายท่อนออกแล้ว
 * ก่อนหน้านี้แต่ละท่อนติดหางเงียบมาราว 380 มิลลิวินาที ค่าที่ตั้งไว้จึงถูกกลบจนปรับ
 * แล้วไม่รู้สึกอะไร — "ปกติ" ตั้งไว้ 400 เพื่อให้ใกล้เคียงกับที่คนเคยได้ยิน (90 + หาง)
 */
export const NARRATION_PACES = [
  { id: "tight", label: "กระชับ", padMs: 0, note: "ท่อนต่อกันสนิท ไม่เว้นจังหวะเลย เร่งเร้า เหมาะกับคลิปสั้น" },
  { id: "normal", label: "ปกติ", padMs: 400, note: "เว้นพอหายใจ ฟังลื่นเป็นธรรมชาติ ใกล้เคียงของเดิม" },
  { id: "relaxed", label: "เว้นจังหวะ", padMs: 750, note: "เว้นชัดเจน ให้เวลาคนดูตามทัน เหมาะกับเนื้อหาที่ต้องย่อย" },
];

export const DEFAULT_PACE = "normal";

/**
 * โทนเสียงที่เลือกได้
 *
 * ค่าที่เก็บคือข้อความไทยตรง ๆ ไม่ใช่ id เพราะโปรเจกต์เก่าบันทึกไว้แบบนี้อยู่แล้ว
 * และ Gemini ใช้ข้อความนี้เป็นคำสั่งบอกสไตล์การอ่านโดยตรง
 *
 * สองเครื่องยนต์ใช้โทนคนละทาง:
 *   gemini — ส่งเป็น style hint ไปกับคำขอ เปลี่ยนโทนได้ทันทีโดยไม่ต้องเตรียมอะไร
 *   jaitts — เลือกจากเสียงต้นแบบที่ผู้ใช้อัดไว้ในโทนนั้น เพราะโมเดลโคลนตามตัวอย่าง
 *            เท่านั้น สั่งด้วยข้อความไม่ได้
 *
 * sample คือประโยคสำหรับอ่านตอนอัดเสียงต้นแบบ ยาวประมาณ 4-6 วินาทีเมื่ออ่านปกติ
 * ซึ่งอยู่ในช่วง 3-10 วินาทีที่ F5-TTS ทำงานได้ดีที่สุด
 */
export const VOICE_TONES = [
  { id: "เป็นกันเอง", sample: "สวัสดีค่ะ วันนี้มีของดีมาแนะนำ ลองฟังกันสักนิดนะคะ รับรองว่าไม่ผิดหวังแน่นอน" },
  { id: "มั่นใจ", sample: "ตัวนี้ผมใช้เองมาสามเดือนแล้ว บอกได้เลยว่าดีจริง ไม่ได้พูดเกินเลยสักคำ" },
  { id: "ตื่นเต้น", sample: "โอ้โห อันนี้ต้องรีบบอกต่อเลยนะ ของมันดีจริง ๆ รีบดูก่อนของจะหมดนะคะ" },
  { id: "นุ่มนวล", sample: "ค่อย ๆ ฟังนะคะ ไม่ต้องรีบ อยากให้ลองพิจารณาดูดี ๆ ก่อนตัดสินใจค่ะ" },
  { id: "สุขุม", sample: "เรื่องนี้ต้องดูกันยาว ๆ ครับ ผมจะอธิบายให้ฟังทีละข้อ ค่อย ๆ ทำความเข้าใจไปด้วยกัน" },
  { id: "น่าเชื่อถือ", sample: "ข้อมูลทั้งหมดนี้มีที่มาชัดเจนครับ ตรวจสอบได้ทุกข้อ ไม่มีอะไรปิดบัง" },
];

export const DEFAULT_TONE = VOICE_TONES[0].id;

/** แปลงจังหวะที่ผู้ใช้เลือกเป็นค่า timing — ค่าที่ไม่รู้จักถือว่าใช้ค่าปกติ */
export function timingForPace(pace, timing = DEFAULT_TIMING) {
  const chosen = NARRATION_PACES.find((item) => item.id === pace)
    ?? NARRATION_PACES.find((item) => item.id === DEFAULT_PACE);
  return { ...DEFAULT_TIMING, ...timing, padMs: chosen.padMs };
}

/**
 * ปักเวลาให้ทุกท่อนจาก "ความยาวไฟล์เสียงจริง" — prefix sum ล้วน ๆ ไม่มีการเดา
 * takes: [{ i, text, role, audioFile, durationMs }]
 */
export function buildChunkTimeline(takes, timing = DEFAULT_TIMING) {
  const { leadInMs, padMs, tailMs } = { ...DEFAULT_TIMING, ...timing };
  let t = leadInMs;
  const chunks = takes.map((take, idx) => {
    const startMs = t;
    const endMs = startMs + take.durationMs;
    t = endMs + (idx === takes.length - 1 ? 0 : padMs);
    return {
      i: take.i,
      text: take.text,
      role: take.role || "body",
      audioFile: take.audioFile,
      startMs,
      endMs,
      words: distributeWords(take.text, startMs, endMs, take.emphasis || []),
    };
  });
  return { chunks, durationMs: t + tailMs, timing: { leadInMs, padMs, tailMs } };
}

/**
 * เติมความเงียบให้ไทม์ไลน์ยาวเท่าเป้าหมาย และไม่ตัดคำพูดทิ้งเด็ดขาด
 *
 * ตัวนี้ไม่ตัดสินใจอะไรเอง ผู้เรียกเป็นคนกำหนดเป้าหมายมาแล้วผ่าน planNarrationFit
 * ว่าจะใช้ความยาวเดิมหรือความยาวที่ตัดให้พอดีเสียง ที่นี่แค่เติมส่วนต่างที่เหลือ
 * ซึ่งตอนนี้เป็นแค่หางท้ายสั้น ๆ ไม่ใช่ความเงียบหลายวินาทีเหมือนเดิม
 *
 * ลำดับช็อตและจุดเริ่มของแต่ละช็อตที่ผู้ใช้เลือกยังไม่ถูกแตะเหมือนเดิม
 */
export function padNarrationTimeline(timeline, targetDurationMs, attempted = []) {
  const target = Math.round(Number(targetDurationMs));
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error("ความยาวไทม์ไลน์ต้องมากกว่า 0ms");
  }
  const narrationMs = Math.round(Number(timeline?.durationMs));
  if (!Number.isFinite(narrationMs) || narrationMs <= 0) {
    throw new Error("ความยาวเสียงพากย์ไม่ถูกต้อง");
  }
  if (narrationMs > target) {
    // บอกด้วยว่าระบบพยายามอะไรไปแล้ว ผู้ใช้จะได้ไม่ไปทำซ้ำสิ่งที่ทำไปแล้ว
    // และรู้ว่าเหลือทางเลือกอะไรจริง ๆ
    const tried = attempted.length ? `ระบบ${attempted.join("และ")}ให้แล้วแต่ยังไม่พอ ` : "";
    const over = Number(((narrationMs - target) / 1000).toFixed(2));
    const error = new Error(
      `เสียงพากย์ยาว ${Number((narrationMs / 1000).toFixed(2))} วินาที แต่ไทม์ไลน์ยาว ${Number((target / 1000).toFixed(2))} วินาที ` +
      `(เกิน ${over} วินาที) ${tried}` +
      "กรุณาลดข้อความ หรือเพิ่มช่วงคลิปโดยให้รวมไม่เกิน 60 วินาที",
    );
    error.code = "NARRATION_TOO_LONG";
    error.status = 400;
    error.details = { narrationMs, targetDurationMs: target };
    throw error;
  }
  return {
    ...timeline,
    durationMs: target,
    narrationFit: {
      mode: narrationMs === target ? "exact" : "pad-silence",
      narrationMs,
      paddedMs: target - narrationMs,
      targetDurationMs: target,
    },
  };
}

/**
 * ความเงียบท้ายคลิปที่ยอมให้เหลือได้
 *
 * ไม่ใช่ศูนย์เพราะซับท่อนสุดท้ายต้องมีเวลาให้อ่านจบ และคลิปที่ตัดจบทันทีที่เสียงหยุด
 * ดูเหมือนไฟล์ขาด ที่เกินจากนี้คือความเงียบที่ไม่ได้ทำหน้าที่อะไร
 */
export const TAIL_SILENCE_BUDGET_MS = 800;

/** ยืดช่องว่างระหว่างท่อนรวมกันได้ไม่เกินเท่านี้ มากกว่านี้ฟังออกว่าเสียงค้าง */
export const MAX_STRETCH_MS = 1500;

/** และแต่ละช่องเพิ่มได้ไม่เกินเท่านี้ ไม่งั้นคลิปที่มีสองท่อนจะเว้นทีเดียวยาวผิดหู */
export const MAX_EXTRA_GAP_MS = 250;

/** ชิ้นวิดีโอที่สั้นกว่านี้กลายเป็นภาพแวบเดียวที่ดูไม่ทัน */
export const MIN_SEGMENT_MS = 400;

/**
 * ตัดสินว่าจะทำอย่างไรเมื่อเสียงพากย์สั้นกว่าคลิปที่ผู้ใช้เลือกไว้
 *
 * เดิมระบบเติมความเงียบท้ายคลิปเสมอไม่ว่าจะขาดไปเท่าไหร่ วัดจากงานจริง 23 ชิ้น
 * พบว่าเติมทุกชิ้น ตั้งแต่ 5% ถึง 50% ของความยาวคลิป — ครึ่งคลิปเป็นความเงียบ
 * โดยไม่มีอะไรบอกผู้ใช้เลยสักคำ
 *
 * บันไดสามขั้น เรียงตามความเสียหายที่เกิดกับงานของผู้ใช้จากน้อยไปมาก:
 *   keep    — ขาดนิดเดียว ปล่อยเป็นหางท้ายตามเดิม
 *   stretch — ขาดไม่มาก เกลี่ยเข้าไปในช่องว่างระหว่างท่อน ไม่มีใครดูออก
 *             และไม่ต้องแตะภาพที่ผู้ใช้เลือกมาเลย
 *   trim    — ขาดเยอะ ตัดคลิปให้พอดีเสียง เพราะคลิปสั้นที่แน่นทั้งคลิป
 *             ดีกว่าคลิปยาวที่เงียบครึ่งหลัง
 */
export function planNarrationFit({ narrationMs = 0, targetMs = 0, chunkCount = 0, timing = DEFAULT_TIMING } = {}) {
  const narration = Math.round(Number(narrationMs));
  const target = Math.round(Number(targetMs));
  const slackMs = target - narration;
  // เสียงยาวเกินคลิปเป็นคนละเรื่อง มี fitNarrationToTimeline ดูแลอยู่แล้ว
  if (!Number.isFinite(slackMs) || slackMs <= TAIL_SILENCE_BUDGET_MS) {
    return { action: "keep", targetMs: target, slackMs };
  }

  const excess = slackMs - TAIL_SILENCE_BUDGET_MS;
  const gaps = Math.max(0, Math.round(Number(chunkCount)) - 1);
  if (excess <= MAX_STRETCH_MS && gaps > 0) {
    const extraGapMs = Math.floor(excess / gaps);
    if (extraGapMs > 0 && extraGapMs <= MAX_EXTRA_GAP_MS) {
      const padMs = Math.round(Number(timing?.padMs ?? DEFAULT_TIMING.padMs)) + extraGapMs;
      return { action: "stretch", targetMs: target, slackMs, extraGapMs, padMs };
    }
  }
  return { action: "trim", targetMs: narration + TAIL_SILENCE_BUDGET_MS, slackMs };
}

/**
 * หดไทม์ไลน์ภาพให้พอดีกับเสียง
 *
 * หดทุกชิ้นตามสัดส่วนแทนที่จะตัดชิ้นท้ายทิ้ง เพราะแต่ละชิ้นคือมุมสินค้าคนละมุม
 * ที่ผู้ใช้ตั้งใจเลือกมา ตัดทิ้งทั้งชิ้นเท่ากับลบของที่เขาเลือกไว้ ส่วนการหดคือ
 * ทุกมุมยังอยู่ครบ แค่อยู่บนจอสั้นลง — และตัดจากปลายของแต่ละชิ้นเพราะจังหวะที่
 * ตั้งใจถ่ายมักอยู่ต้นช็อต
 *
 * ชิ้นที่สั้นอยู่แล้วไม่ถูกหั่นต่อ ถ้าหดทุกชิ้นจนถึงขั้นต่ำแล้วยังไม่พอ
 * ค่อยตัดชิ้นท้ายทิ้ง
 */
export function trimSourcePlan(sourcePlan, targetMs, { minSegmentMs = MIN_SEGMENT_MS } = {}) {
  const segments = sourcePlan?.segments;
  const total = Math.round(Number(sourcePlan?.totalMs));
  const target = Math.round(Number(targetMs));
  if (!Array.isArray(segments) || !segments.length) return sourcePlan;
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(total) || target >= total) return sourcePlan;

  const floorOf = (segment) => Math.min(segment.srcDurMs, minSegmentMs);
  const kept = segments.slice();
  while (kept.length > 1 && kept.reduce((sum, segment) => sum + floorOf(segment), 0) > target) kept.pop();

  const floors = kept.map(floorOf);
  const floorTotal = floors.reduce((sum, value) => sum + value, 0);
  const available = kept.reduce((sum, segment) => sum + segment.srcDurMs, 0);
  const wanted = Math.max(floorTotal, Math.min(target, available));
  const shrinkable = available - floorTotal;
  const remove = available - wanted;

  let acc = 0;
  const trimmed = kept.map((segment, index) => {
    const floor = floors[index];
    const room = segment.srcDurMs - floor;
    const cut = shrinkable > 0 ? Math.round(remove * (room / shrinkable)) : 0;
    // ชิ้นสุดท้ายรับเศษจากการปัดของชิ้นก่อนหน้า ผลรวมจะได้ตรงเป๊ะ
    const raw = index === kept.length - 1 ? wanted - acc : segment.srcDurMs - cut;
    const durationMs = Math.min(segment.srcDurMs, Math.max(floor, Math.round(raw)));
    const startMs = acc;
    acc += durationMs;
    return { ...segment, srcDurMs: durationMs, outMs: durationMs, startMs, trimEndMs: segment.inMs + durationMs };
  });

  return {
    ...sourcePlan,
    segments: trimmed,
    totalMs: acc,
    mode: "narration-trim",
    ratio: Number((acc / total).toFixed(3)),
    trimmedFromMs: total,
    droppedSegments: segments.length - kept.length,
  };
}

/** แบ่งเวลาภายในท่อนให้แต่ละคำตามสัดส่วนจำนวนตัวอักษร */
export function distributeWords(text, startMs, endMs, emphasis = []) {
  const words = segmentWords(text);
  const weights = words.map((w) => Math.max(1, graphemeCount(w.text.trim())));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(1, endMs - startMs);
  let acc = startMs;
  return words.map((w, i) => {
    const dur = i === words.length - 1 ? startMs + span - acc : Math.round((weights[i] / total) * span);
    const out = {
      text: w.text.trim(),
      s: w.s,
      e: w.e,
      startMs: Math.round(acc),
      endMs: Math.round(acc + dur),
      emphasis: emphasis.some((k) => k && w.text.includes(k)),
    };
    acc += dur;
    return out;
  });
}

/* ---------- ภาพให้พอดีเสียง ---------- */

/**
 * แตกคลิปต้นทางเป็น "ชิ้น" ตามจุดตัดฉาก แล้วสลับคลิปไปมาให้ได้จังหวะแบบ TikTok
 * sources: [{ file, meta, cuts, score }]
 */
export function buildPieces(sources, { minMs = 1400, maxMs = 4200 } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("ต้องมี video source อย่างน้อยหนึ่งไฟล์");
  }
  const perSource = sources.map((src) => {
    const marks = [0, ...src.cuts, src.meta.durationMs].sort((a, b) => a - b);
    const pieces = [];
    for (let i = 0; i < marks.length - 1; i += 1) {
      let a = marks[i];
      const b = marks[i + 1];
      if (b - a < minMs) continue;
      while (b - a > maxMs * 1.4) {
        pieces.push({ src: src.file, inMs: a, srcDurMs: maxMs, score: src.score });
        a += maxMs;
      }
      if (b - a >= minMs) pieces.push({ src: src.file, inMs: a, srcDurMs: b - a, score: src.score });
    }
    if (!pieces.length) {
      pieces.push({
        src: src.file,
        inMs: 0,
        srcDurMs: Math.min(src.meta.durationMs, maxMs),
        score: src.score,
      });
    }
    return pieces;
  });

  // สลับคลิปไปมา (round-robin) เพื่อไม่ให้ดูค้างอยู่คลิปเดียวนาน ๆ
  const ordered = [];
  for (let round = 0; ordered.length < perSource.flat().length; round += 1) {
    for (const pieces of perSource) if (pieces[round]) ordered.push(pieces[round]);
  }

  // ชิ้นที่คะแนนสูงสุดขึ้นก่อน — 3 วินาทีแรกชี้เป็นชี้ตาย
  const best = ordered.reduce((a, b, i) => (b.score > ordered[a].score ? i : a), 0);
  if (best > 0) ordered.unshift(...ordered.splice(best, 1));
  return ordered;
}

/**
 * Build the visual track directly from the user's edit decision list. Unlike
 * buildPieces(), this intentionally does no scene scoring, round-robin, speed
 * change, looping, or best-shot promotion.
 */
export function buildOrderedSourcePlan(sources, selections, {
  maxAssets = 12,
  maxClips = 24,
  maxTotalMs = 60_000,
} = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("ต้องมี video source อย่างน้อยหนึ่งไฟล์");
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error("ต้องมีชิ้นวิดีโอบนไทม์ไลน์อย่างน้อยหนึ่งชิ้น");
  }
  if (sources.length > maxAssets) {
    const error = new Error(`ใช้ไฟล์ต้นฉบับได้สูงสุด ${maxAssets} ไฟล์ต่อโปรเจกต์`);
    error.code = "TOO_MANY_SOURCE_ASSETS";
    error.status = 400;
    throw error;
  }
  if (selections.length > maxClips) {
    const error = new Error(`ไทม์ไลน์มีได้สูงสุด ${maxClips} ชิ้น`);
    error.code = "TOO_MANY_TIMELINE_CLIPS";
    error.status = 400;
    throw error;
  }

  const sourceByFile = new Map(sources.map((source) => [source.file, source]));
  const orders = new Set();
  selections.forEach((selection, index) => {
    const order = selection.order == null ? index : Number(selection.order);
    if (!Number.isInteger(order) || order < 0 || order >= selections.length || orders.has(order)) {
      const error = new Error(`ลำดับชิ้นวิดีโอต้องเป็นเลขจำนวนเต็มไม่ซ้ำ ตั้งแต่ 0 ถึง ${selections.length - 1}`);
      error.code = "INVALID_TIMELINE_ORDER";
      error.status = 400;
      throw error;
    }
    orders.add(order);
  });
  const ordered = selections
    .map((selection, index) => ({ selection, index }))
    .sort((a, b) => {
      const left = a.selection.order == null ? a.index : Number(a.selection.order);
      const right = b.selection.order == null ? b.index : Number(b.selection.order);
      return left - right || a.index - b.index;
    })
    .map(({ selection }) => selection);

  let totalMs = 0;
  const segments = ordered.map((selection, index) => {
    const source = sourceByFile.get(selection.file);
    if (!source) {
      const error = new Error(`ชิ้นวิดีโอ “${selection.id || index + 1}” อ้างถึงไฟล์ที่ไม่ได้เตรียมไว้`);
      error.code = "TIMELINE_ASSET_NOT_FOUND";
      error.status = 400;
      throw error;
    }
    const inMs = Math.round(Number(selection.trimStartMs ?? selection.inMs ?? 0));
    const trimEnd = selection.trimEndMs == null
      ? inMs + Math.round(Number(selection.selectedDurationMs))
      : Math.round(Number(selection.trimEndMs));
    const actualDurationMs = Math.round(Number(source.meta?.durationMs ?? selection.actualDurationMs));
    if (!Number.isFinite(inMs) || inMs < 0 || !Number.isFinite(trimEnd) || trimEnd <= inMs) {
      const error = new Error(`ช่วงเวลาของชิ้น “${selection.id || index + 1}” ไม่ถูกต้อง`);
      error.code = "INVALID_CLIP_TRIM";
      error.status = 400;
      throw error;
    }
    if (!Number.isFinite(actualDurationMs) || trimEnd > actualDurationMs) {
      const error = new Error(
        `ช่วงของชิ้น “${selection.id || index + 1}” เกินความยาวจริงของไฟล์ต้นฉบับ`,
      );
      error.code = "CLIP_TRIM_OUT_OF_RANGE";
      error.status = 400;
      throw error;
    }
    const durationMs = trimEnd - inMs;
    const startMs = totalMs;
    totalMs += durationMs;
    if (totalMs > maxTotalMs) {
      const error = new Error(`ความยาวรวมเกิน ${maxTotalMs / 1000} วินาที`);
      error.code = "TIMELINE_DURATION_LIMIT";
      error.status = 400;
      throw error;
    }
    return {
      id: selection.id ?? `clip-${index + 1}`,
      assetName: selection.assetName ?? source.meta?.name,
      src: source.file,
      inMs,
      srcDurMs: durationMs,
      outMs: durationMs,
      startMs,
      speed: 1,
      order: selection.order ?? index,
      trimEndMs: trimEnd,
    };
  });

  if (totalMs <= 0) {
    const error = new Error("ความยาวรวมของไทม์ไลน์ต้องมากกว่า 0 วินาที");
    error.code = "INVALID_TIMELINE_DURATION";
    error.status = 400;
    throw error;
  }
  return {
    segments,
    totalMs,
    mode: "ordered-trim",
    ratio: 1,
  };
}

/**
 * duration fitting ตามกติกาใน blueprint §5.2
 * คืน segment list ที่รวมกันได้ "เท่ากับ" totalMs พอดี
 */
export function fitToDuration(pieces, totalMs) {
  if (!Array.isArray(pieces) || pieces.length === 0) {
    throw new Error("ไม่มีชิ้นวิดีโอสำหรับประกอบ timeline");
  }
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new Error("ความยาว timeline ต้องมากกว่า 0ms");
  }
  const avail = pieces.reduce((a, p) => a + p.srcDurMs, 0);
  if (!Number.isFinite(avail) || avail <= 0) {
    throw new Error("ความยาว video source ไม่ถูกต้อง");
  }
  const r = totalMs / avail;
  const out = [];
  let mode;

  if (r >= 0.87 && r <= 1.15) {
    // ใกล้พอดี → ปรับความเร็วทั้งหมดเท่า ๆ กัน ไม่ต้องวนซ้ำ ไม่ต้องตัดทิ้ง
    mode = r > 1 ? "slow" : "speed";
    const speed = avail / totalMs;
    let acc = 0;
    pieces.forEach((p, i) => {
      const outDur = i === pieces.length - 1 ? totalMs - acc : Math.round(p.srcDurMs / speed);
      out.push({ ...p, speed: Number(speed.toFixed(4)), outMs: outDur, startMs: acc });
      acc += outDur;
    });
  } else {
    // ไกลเกินไป → เรียงชิ้นวนไปเรื่อย ๆ แล้วตัดชิ้นสุดท้ายให้ลงพอดี
    mode = r > 1 ? "loop" : "trim";
    let acc = 0;
    for (let i = 0; acc < totalMs; i += 1) {
      const p = pieces[i % pieces.length];
      const remain = totalMs - acc;
      const take = Math.min(p.srcDurMs, remain);
      if (take < 250 && out.length) {
        out.at(-1).srcDurMs += take;
        out.at(-1).outMs += take;
        acc += take;
        break;
      }
      out.push({ ...p, srcDurMs: take, speed: 1, outMs: take, startMs: acc });
      acc += take;
      if (i > 200) break; // กันลูปไม่รู้จบ
    }
  }
  return { segments: out, mode, ratio: Number(r.toFixed(3)) };
}
