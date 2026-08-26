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
  padMs: 90,       // ช่องว่างระหว่างท่อน
  tailMs: 500,     // ยืดท้ายให้ CTA อ่านจบ
};

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
 * The edit timeline is authoritative. Narration may be padded with silence to
 * reach it, but speech is never truncated and the user's visual trim points
 * are never stretched or reordered.
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
