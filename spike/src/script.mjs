// script — brief → สคริปต์ขายของภาษาไทย 5 เวอร์ชัน  →  อนาคตคือ packages/ai
import { chunkText, graphemeCount } from "./core.mjs";

/**
 * ความเร็วพูดไทย หน่วยเป็น "ตัวอักษรที่มองเห็น" (grapheme) ต่อวินาที
 * 6.4 คือค่าที่วัดจริงจาก edge-tts th-TH-Premwadee ที่ speed 1.0 (10 ท่อน / 24.2 วินาที)
 * ใช้ประเมินความยาวก่อนยิง TTS เท่านั้น — เวลาจริงยังมาจากไฟล์เสียงเสมอ
 * ปรับได้ด้วย SPEAK_GRAPHEMES_PER_SEC ใน .env เมื่อเปลี่ยน provider หรือเสียง
 */
export const CHARS_PER_SEC = Number(process.env.SPEAK_GRAPHEMES_PER_SEC || 6.4);
export const estimateMs = (text) => Math.round((graphemeCount(text) / CHARS_PER_SEC) * 1000);

const SYSTEM = `คุณคือครีเอเตอร์สาย TikTok Shop ไทยที่เขียนสคริปต์ขายของเก่งที่สุด
กติกา:
- ภาษาพูดจริง ไม่ใช่ภาษาโฆษณาแข็ง ๆ ห้ามคำว่า "ที่สุดในโลก" "รักษาโรค" หรือคำเกินจริงที่ผิด อย.
- 3 วินาทีแรกต้องหยุดนิ้วคนดูให้ได้
- แต่ละท่อนคือข้อความหนึ่งจอ ยาว 2-5 คำ ไม่เกิน 22 ตัวอักษร เพราะต้องอ่านทันบนมือถือ
- ปิดท้ายด้วย CTA ให้กดตะกร้าเสมอ
- ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

function userPrompt(brief, targetSec, variants) {
  return `เขียนสคริปต์พากย์เสียงขายสินค้า ${variants} เวอร์ชัน ความยาวพูดจริงประมาณ ${targetSec} วินาที (≈ ${Math.round(targetSec * CHARS_PER_SEC)} ตัวอักษรต่อเวอร์ชัน)

สินค้า: ${brief.name}
ราคา: ${brief.price ?? "-"}
จุดขาย: ${(brief.features || []).join(" / ")}
กลุ่มเป้าหมาย: ${brief.audience || "คนทั่วไป"}
โทน: ${brief.tone || "สนุก เป็นกันเอง"}
CTA: ${brief.cta || "กดตะกร้าส้มด้านล่างเลย"}
${brief.avoid?.length ? `ห้ามใช้คำ: ${brief.avoid.join(", ")}` : ""}

ตอบเป็น JSON รูปแบบนี้เป๊ะ ๆ:
{"variants":[{"id":"v1","hookType":"สั้น ๆ ว่าใช้มุกอะไรเปิด","chunks":[{"text":"ข้อความหนึ่งจอ","role":"hook|body|cta","emphasis":["คำที่ควรเน้น"]}]}]}
ให้ทุกเวอร์ชันเปิดด้วยมุกที่ต่างกันจริง ๆ (ปัญหา / ตัวเลข / คำถาม / เปรียบเทียบ / ความรู้สึก)`;
}

/* ---------- ผู้ให้บริการ ---------- */

async function withClaude(brief, targetSec, variants) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.SCRIPT_MODEL || "claude-sonnet-5";
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
      messages: [{ role: "user", content: userPrompt(brief, targetSec, variants) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const text = (data.content || []).map((p) => p.text || "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  return { provider: `claude:${model}`, variants: parsed.variants };
}

/**
 * ตัวสร้างสคริปต์แบบออฟไลน์ — ไม่ต้องมี API key
 * ใช้เพื่อพิสูจน์ pipeline และเป็น fallback เวลา LLM ล่ม ไม่ได้ตั้งใจให้แทน LLM
 */
function withTemplate(brief, targetSec, variants) {
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
    const budget = targetSec * CHARS_PER_SEC;
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

export async function generateScript(brief, { targetSec = 30, variants = 5, provider = "auto" } = {}) {
  const canClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  const pick = provider === "auto" ? (canClaude ? "claude" : "template") : provider;

  if (pick === "claude" && !canClaude) {
    throw new Error("ต้องตั้ง ANTHROPIC_API_KEY ใน .env ก่อนใช้ --script-provider claude");
  }

  let result;
  if (pick === "claude") {
    try {
      result = await withClaude(brief, targetSec, variants);
    } catch (e) {
      result = { ...withTemplate(brief, targetSec, variants), fallbackFrom: `claude (${e.message.slice(0, 120)})` };
    }
  } else {
    result = withTemplate(brief, targetSec, variants);
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
    const estMs = chunks.reduce((a, c) => a + estimateMs(c.text), 0);
    return { id: v.id || `v${vi + 1}`, hookType: v.hookType || "-", chunks, estDurationMs: estMs };
  });
  return result;
}
