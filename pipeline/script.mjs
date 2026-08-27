// script — brief → สคริปต์ขายของภาษาไทย 5 เวอร์ชัน  →  อนาคตคือ packages/ai
import { chunkText, DEFAULT_TIMING, graphemeCount } from "./core.mjs";
import { characterBudget, chunkMs } from "./speech-rate.mjs";
import {
  callCliProvider,
  callOpenAICompatible,
  extractJson,
  getProvider,
  pickAvailableProvider,
} from "./providers.mjs";

/**
 * ความเร็วพูดไทย หน่วยเป็น "ตัวอักษรที่มองเห็น" (grapheme) ต่อวินาที
 * 6.4 คือค่าที่วัดจริงจาก edge-tts th-TH-Premwadee ที่ speed 1.0 (10 ท่อน / 24.2 วินาที)
 * ใช้ประเมินความยาวก่อนยิง TTS เท่านั้น — เวลาจริงยังมาจากไฟล์เสียงเสมอ
 * ปรับได้ด้วย SPEAK_GRAPHEMES_PER_SEC ใน .env เมื่อเปลี่ยน provider หรือเสียง
 */
export const CHARS_PER_SEC = 6.4;

/** Read runtime configuration lazily so loadEnv() can run after imports. */
export function speakingRate(override) {
  const value = Number(override ?? process.env.SPEAK_GRAPHEMES_PER_SEC ?? CHARS_PER_SEC);
  return Number.isFinite(value) && value > 0 ? value : CHARS_PER_SEC;
}

export const estimateMs = (text, charsPerSec) =>
  Math.round((graphemeCount(text) / speakingRate(charsPerSec)) * 1000);

const SYSTEM = `คุณคือครีเอเตอร์สาย TikTok Shop ไทยที่เขียนสคริปต์ขายของเก่งที่สุด
กติกา:
- ภาษาพูดจริง ไม่ใช่ภาษาโฆษณาแข็ง ๆ ห้ามคำว่า "ที่สุดในโลก" "รักษาโรค" หรือคำเกินจริงที่ผิด อย.
- 3 วินาทีแรกต้องหยุดนิ้วคนดูให้ได้
- แต่ละท่อนคือข้อความหนึ่งจอ ยาว 2-5 คำ ไม่เกิน 22 ตัวอักษร เพราะต้องอ่านทันบนมือถือ
- ปิดท้ายด้วย CTA ให้กดตะกร้าเสมอ
- ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value == null) return [];
  return String(value).split(/[,/\n;]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeBrief(brief) {
  return { ...brief, features: asList(brief?.features), avoid: asList(brief?.avoid) };
}

/**
 * บอกเพศของคนพากย์ให้คนเขียนสคริปต์รู้
 *
 * ภาษาไทยลงท้ายต่างกันตามเพศผู้พูด ก่อนหน้านี้พรอมต์ไม่มีข้อมูลนี้เลย สคริปต์จึง
 * สุ่มลงท้าย ครับ/ค่ะ เอง แล้วบางทีก็สวนทางกับเสียงที่เลือกไว้
 */
function speakerLine(gender) {
  if (gender === "ชาย") return "ผู้พากย์: ผู้ชาย — ใช้ ผม/ครับ ห้ามใช้ ค่ะ และห้ามใช้ ดิฉัน เป็นสรรพนามแทนผู้พูด";
  if (gender === "หญิง") return "ผู้พากย์: ผู้หญิง — ใช้ ค่ะ/นะคะ ห้ามใช้ ครับ และห้ามใช้ ผม เป็นสรรพนามแทนผู้พูด (คำว่า ผม ที่หมายถึงเส้นผมยังใช้ได้)";
  return "";
}

export function buildScriptPrompt(brief, targetSec, variants, budget, speakerGender) {
  return `เขียนสคริปต์พากย์เสียงขายสินค้า ${variants} เวอร์ชัน ความยาวพูดจริงประมาณ ${targetSec} วินาที (≈ ${budget} ตัวอักษรต่อเวอร์ชัน)

สินค้า: ${brief.name}
ราคา: ${brief.price ?? "-"}
จุดขาย: ${(brief.features || []).join(" / ")}
กลุ่มเป้าหมาย: ${brief.audience || "คนทั่วไป"}
โทน: ${brief.tone || "สนุก เป็นกันเอง"}
${speakerLine(speakerGender)}
CTA: ${brief.cta || "กดตะกร้าส้มด้านล่างเลย"}
${brief.avoid?.length ? `ห้ามใช้คำ: ${brief.avoid.join(", ")}` : ""}

ตอบเป็น JSON รูปแบบนี้เป๊ะ ๆ:
{"variants":[{"id":"v1","hookType":"สั้น ๆ ว่าใช้มุกอะไรเปิด","chunks":[{"text":"ข้อความหนึ่งจอ","role":"hook|body|cta","emphasis":["คำที่ควรเน้น"]}]}]}
ให้ทุกเวอร์ชันเปิดด้วยมุกที่ต่างกันจริง ๆ (ปัญหา / ตัวเลข / คำถาม / เปรียบเทียบ / ความรู้สึก)`;
}

/* ---------- ผู้ให้บริการ ---------- */

async function withClaude(brief, targetSec, variants, { budget, speakerGender, signal, timeoutMs = 45_000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.SCRIPT_MODEL || "claude-sonnet-5";
  const signals = [signal, AbortSignal.timeout(timeoutMs)].filter(Boolean);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: buildScriptPrompt(brief, targetSec, variants, budget, speakerGender) }],
    }),
    signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const text = (data.content || []).map((p) => p.text || "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  return { provider: `claude:${model}`, variants: parsed.variants };
}

async function withGemini(brief, targetSec, variants, { budget, speakerGender, signal, timeoutMs = 45_000 } = {}) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const model = process.env.GEMINI_SCRIPT_MODEL || "gemini-2.5-flash";
  const signals = [signal, AbortSignal.timeout(timeoutMs)].filter(Boolean);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM}\n\n${buildScriptPrompt(brief, targetSec, variants, budget, speakerGender)}` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
    }),
    signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
  });
  if (!res.ok) throw new Error(`Gemini Script ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  return { provider: `gemini:${model}`, variants: parsed.variants };
}

/**
 * เรียกผู้ให้บริการตามทะเบียนใน providers.mjs
 * claude/gemini ยังใช้ฟังก์ชันเดิมเพราะรูปแบบ request ต่างจาก OpenAI
 */
async function runProvider(id, brief, targetSec, variants, { budget, speakerGender, signal, timeoutMs } = {}) {
  if (id === "claude") return withClaude(brief, targetSec, variants, { budget, speakerGender, signal, timeoutMs });
  if (id === "gemini") return withGemini(brief, targetSec, variants, { budget, speakerGender, signal, timeoutMs });

  const provider = getProvider(id);
  if (!provider) throw new Error(`ไม่รู้จักผู้ให้บริการ "${id}"`);
  const payload = { system: SYSTEM, user: buildScriptPrompt(brief, targetSec, variants, budget, speakerGender), signal, timeoutMs };
  const { text, model } = provider.kind === "cli"
    ? await callCliProvider(provider, payload)
    : await callOpenAICompatible(provider, payload);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed?.variants) || !parsed.variants.length) {
    throw new Error(`${provider.label} ตอบกลับมาไม่มี variants`);
  }
  return { provider: `${provider.id}:${model}`, variants: parsed.variants };
}

/**
 * ตัวสร้างสคริปต์แบบออฟไลน์ — ไม่ต้องมี API key
 * ใช้เพื่อพิสูจน์ pipeline และเป็น fallback เวลา LLM ล่ม ไม่ได้ตั้งใจให้แทน LLM
 */
function withTemplate(brief, targetSec, variants, budget) {
  const f = (brief.features || []).filter(Boolean);
  const price = brief.price ? `${brief.price}` : null;
  const cta = brief.cta || "กดตะกร้าส้มด้านล่างเลย";

  const hooks = [
    { type: "ปัญหา-ทางออก", lines: [`ใครมีปัญหา ${brief.pain || "ของเกะกะ"}`, "ต้องดูอันนี้เลย"] },
    { type: "ตัวเลข", lines: [`${f.length || 3} เหตุผล`, `ที่ต้องมี ${brief.name}`] },
    { type: "คำถาม", lines: [`รู้ไหมว่า ${brief.name}`, "ทำอะไรได้บ้าง"] },
    { type: "เปรียบเทียบ", lines: ["ของเดิมใช้ยาก", "ลองเปลี่ยนมาใช้ตัวนี้"] },
    { type: "ความรู้สึก", lines: ["ซื้อมาแล้วไม่ผิดหวัง", `บอกเลยว่า ${brief.name} ดีจริง`] },
  ];

  const closers = [
    [price ? `ราคาแค่ ${price} บาท` : "ราคาน่ารักมาก", cta],
    ["ของมีจำนวนจำกัด", cta],
    [price ? `เท่านี้ได้ของดี ${price} บาท` : "คุ้มเกินราคา", cta],
  ];

  const out = [];
  for (let v = 0; v < variants; v += 1) {
    const hook = hooks[v % hooks.length];
    const closer = closers[v % closers.length];
    const body = [];
    const rotated = f.slice(v % Math.max(1, f.length)).concat(f.slice(0, v % Math.max(1, f.length)));
    for (const feat of rotated) body.push(...chunkText(feat));

    const chunks = [
      ...hook.lines.flatMap((l) => chunkText(l)).map((text) => ({ text, role: "hook" })),
      ...body.map((text) => ({ text, role: "body" })),
      ...closer.flatMap((l) => chunkText(l)).map((text) => ({ text, role: "cta" })),
    ];

    // ตัดให้ลงความยาวเป้าหมาย โดยไม่ทิ้ง hook และ cta
    let used = chunks.reduce((a, c) => a + graphemeCount(c.text), 0);
    while (used > budget) {
      const idx = chunks.findLastIndex((c) => c.role === "body");
      if (idx < 0) break;
      used -= graphemeCount(chunks[idx].text);
      chunks.splice(idx, 1);
    }

    out.push({
      id: `v${v + 1}`,
      hookType: hook.type,
      chunks: chunks.map((c, i) => ({ ...c, i, emphasis: [] })),
    });
  }
  return { provider: "template:offline", variants: out };
}

/* ---------- ทางเข้าเดียว ---------- */

export async function generateScript(
  brief,
  { targetSec = 30, variants = 5, provider = "auto", charsPerSec, speech, timing, speakerGender, signal, timeoutMs } = {},
) {
  if (!brief?.name) throw new Error("ข้อมูลสินค้าต้องมี brief.name");
  brief = normalizeBrief(brief);
  const rate = speakingRate(charsPerSec);
  const model = speech?.msPerGrapheme > 0 ? speech : { msPerGrapheme: 1000 / rate, graphemesPerSec: rate };
  // งบตัวอักษรต้องหักเวลาที่ไม่ใช่การพูดออกก่อน — เงียบนำหน้า หางท้าย และช่องว่าง
  // ระหว่างท่อนตามจังหวะที่ผู้ใช้เลือก ของเดิมคิดแค่ targetSec × อัตรา จึงขอสั้นเกินจริง
  const budget = characterBudget(model, {
    targetMs: Math.round(targetSec * 1000),
    timing: timing ?? DEFAULT_TIMING,
  });
  const pick = provider === "template" ? "template" : await pickAvailableProvider({ preferred: provider });

  let result;
  if (pick === "template") {
    result = withTemplate(brief, targetSec, variants, budget);
  } else {
    try {
      result = await runProvider(pick, brief, targetSec, variants, { budget, speakerGender, signal, timeoutMs });
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      // ยังได้สคริปต์เสมอ แต่ต้องบอกให้รู้ว่าตกมาใช้ตัวสำรอง ไม่ใช่เงียบ ๆ
      result = { ...withTemplate(brief, targetSec, variants, budget), fallbackFrom: `${pick} (${e.message.slice(0, 160)})` };
    }
  }

  // ทำให้ทุกเวอร์ชันมีรูปร่างเดียวกัน ไม่ว่ามาจากไหน
  result.variants = result.variants.map((v, vi) => {
    const chunks = [];
    for (const c of v.chunks || []) {
      for (const piece of chunkText(String(c.text || ""))) {
        chunks.push({
          i: chunks.length,
          text: piece,
          role: c.role || (chunks.length === 0 ? "hook" : "body"),
          emphasis: Array.isArray(c.emphasis) ? c.emphasis : [],
        });
      }
    }
    const estMs = chunks.reduce((a, c) => a + chunkMs(model, c.text), 0);
    return { id: v.id || `v${vi + 1}`, hookType: v.hookType || "-", chunks, estDurationMs: estMs };
  });
  return result;
}
