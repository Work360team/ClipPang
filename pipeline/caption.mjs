/**
 * แคปชั่นและแฮชแท็กสำหรับโพสต์ลง TikTok Shop
 *
 * แยกจาก script.mjs เพราะเป็นคนละงาน: สคริปต์คือสิ่งที่ "พูด" ในคลิป ส่วนแคปชั่น
 * คือสิ่งที่ "พิมพ์" ใต้โพสต์ ซึ่งมีข้อจำกัดคนละแบบ (สั้น อ่านผ่านตา มีแฮชแท็ก
 * และห้ามซ้ำกับเสียงพากย์เป๊ะ ๆ ไม่งั้นคนดูรู้สึกว่าอ่านของเดิมสองรอบ)
 *
 * ใช้ผู้ให้บริการเดียวกับสคริปต์ และถ้าไม่มีเลยก็ยังได้แคปชั่นจากตัวสำรองในเครื่อง
 */
import {
  callCliProvider,
  callOpenAICompatible,
  extractJson,
  getProvider,
  pickAvailableProvider,
} from "./providers.mjs";

/** แนวแคปชั่นที่ให้ผู้ใช้เลือก — คนละวิธีเปิด ไม่ใช่คำเดิมจัดเรียงใหม่ */
export const CAPTION_ANGLES = [
  { id: "hook", label: "ตะขอ", hint: "เปิดด้วยปัญหาที่คนดูเจอจริง ให้หยุดนิ้ว" },
  { id: "story", label: "เล่าเรื่อง", hint: "เล่าจากประสบการณ์ตัวเอง อ่านแล้วเชื่อ" },
  { id: "list", label: "สรุปสั้น", hint: "ข้อดีเป็นข้อ ๆ อ่านจบใน 3 วินาที" },
  { id: "question", label: "ชวนคุย", hint: "ถามคนดูตรง ๆ เพื่อดันคอมเมนต์" },
  { id: "urgent", label: "เร่งตัดสินใจ", hint: "บอกเหตุผลที่ควรกดตอนนี้ ไม่ใช่พรุ่งนี้" },
];

const SYSTEM = `คุณคือครีเอเตอร์สาย TikTok Shop ไทยที่เขียนแคปชั่นใต้คลิปเก่งที่สุด
เขียนภาษาไทยแบบคนจริงพูด ไม่ใช่ภาษาโฆษณาแข็ง ๆ
ห้ามกล่าวอ้างสรรพคุณเกินจริงหรือคำที่ผิดกฎหมายโฆษณา เช่น รักษาหายขาด ลดน้ำหนักได้แน่นอน
ตอบเป็น JSON เท่านั้น`;

function userPrompt(brief, spoken, angles) {
  return `เขียนแคปชั่นใต้โพสต์ TikTok Shop ${angles.length} แบบ แบบละหนึ่งแนว

สินค้า: ${brief.name}
จุดขาย: ${(brief.features || []).join(" / ") || "-"}
กลุ่มเป้าหมาย: ${brief.audience || "คนทั่วไป"}
โทน: ${brief.tone || "สนุก เป็นกันเอง"}
CTA: ${brief.cta || "กดตะกร้าส้มด้านล่างเลย"}
${spoken?.length ? `เสียงพากย์ในคลิปพูดว่า: ${spoken.join(" / ")}` : ""}

แนวที่ต้องการ:
${angles.map((angle) => `- ${angle.id}: ${angle.hint}`).join("\n")}

กติกา:
- แคปชั่นยาว 1-3 บรรทัด รวมไม่เกิน 150 ตัวอักษร
- ห้ามลอกประโยคจากเสียงพากย์มาทั้งดุ้น ให้เขียนใหม่
- อีโมจิได้ไม่เกิน 3 ตัวต่อแคปชั่น
- แฮชแท็ก 5-8 อัน ต่อแคปชั่น เป็นภาษาไทยผสมอังกฤษได้ ไม่ต้องใส่ # นำหน้าใน JSON

ตอบเป็น JSON: {"captions":[{"angle":"hook","text":"...","hashtags":["..."]}]}`;
}

/** ตัวสำรองในเครื่อง — ไม่ต้องมี API key และไม่กินโควตา */
function withTemplate(brief, angles) {
  const name = brief.name;
  const features = (brief.features || []).filter(Boolean);
  const first = features[0] || "ของดีที่อยากบอกต่อ";
  const second = features[1] || first;
  const cta = brief.cta || "กดตะกร้าส้มด้านล่างเลย";
  const audience = brief.audience || "ใครที่กำลังมองหาอยู่";

  const byAngle = {
    hook: `ถ้ายังหา${name}ที่ใช่ไม่เจอ ลองดูตัวนี้ 👀\n${first}\n${cta}`,
    story: `ใช้${name}มาสักพักแล้วขอเล่าตรง ๆ\nที่ชอบสุดคือ${first} ส่วน${second}ก็โอเคเลย\n${cta}`,
    list: `${name} สรุปสั้น ๆ\n• ${first}\n• ${second}\n• ${cta}`,
    question: `${audience} เคยเจอปัญหานี้ไหม 🤔\nเราแก้ด้วย${name} ${first}\nคอมเมนต์บอกกันหน่อยว่าใช้ตัวไหนอยู่`,
    urgent: `รอบนี้ของมีจำกัดจริง ๆ ⏳\n${name} ${first}\n${cta}`,
  };

  return {
    provider: "template:offline",
    captions: angles.map((angle) => ({
      angle: angle.id,
      text: byAngle[angle.id] ?? byAngle.hook,
      hashtags: baseHashtags(brief),
    })),
  };
}

/** แฮชแท็กพื้นฐานจากตัวสินค้าเอง ใช้ทั้งตอนเป็นตัวสำรองและตอนเติมให้ครบ */
function baseHashtags(brief) {
  const fromName = String(brief.name || "")
    .split(/[\s/·|,-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1)
    .slice(0, 2);
  return [...new Set([...fromName, "รีวิวของดี", "ของมันต้องมี", "ติดเทรนด์", "TikTokShop", "ช้อปปิ้งออนไลน์"])].slice(0, 7);
}

function cleanHashtag(tag) {
  return String(tag).replace(/^#+/, "").replace(/\s+/g, "").trim();
}

/**
 * สร้างแคปชั่นพร้อมแฮชแท็กหลายแนวให้เลือก
 * @param {object} brief ข้อมูลสินค้าเดียวกับที่ใช้เขียนสคริปต์
 * @param {{spoken?: string[], provider?: string, signal?: AbortSignal, timeoutMs?: number}} options
 */
export async function generateCaptions(brief, { spoken = [], provider = "auto", signal, timeoutMs } = {}) {
  if (!brief?.name) throw new Error("ข้อมูลสินค้าต้องมี brief.name");
  const angles = CAPTION_ANGLES;
  let pick = provider === "template" ? "template" : await pickAvailableProvider({ preferred: provider });
  // Gemini free tier นับโควตารวมกับเสียงพากย์ (วันละ 10 คำขอต่อคีย์) แคปชั่นเป็นของ
  // ที่แก้เองได้ ไม่ควรไปแย่งโควตาที่จำเป็นต่อการเรนเดอร์ ถ้ามีแต่ Gemini ใช้ตัวสำรอง
  if (pick === "gemini" && provider === "auto") pick = "template";
  // claude/gemini แบบ API มี payload เฉพาะตัวที่ script.mjs จัดการไว้ ที่นี่รองรับเฉพาะ
  // ตัวที่คุยแบบ OpenAI-compatible กับ CLI ที่ล็อกอินไว้แล้ว
  if (pick === "claude") pick = "template";

  let result;
  if (pick === "template") {
    result = withTemplate(brief, angles);
  } else {
    try {
      result = await runProvider(pick, brief, spoken, angles, { signal, timeoutMs });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      // ได้แคปชั่นเสมอ แต่บอกให้รู้ว่าตกมาใช้ตัวสำรอง ไม่ใช่เงียบ ๆ
      result = { ...withTemplate(brief, angles), fallbackFrom: `${pick} (${String(error.message).slice(0, 160)})` };
    }
  }

  // ทำให้ทุกแนวมีรูปร่างเดียวกันไม่ว่ามาจากไหน และเรียงตามลำดับแนวที่เรากำหนด
  const byAngle = new Map(result.captions.map((caption) => [caption.angle, caption]));
  return {
    provider: result.provider,
    fallbackFrom: result.fallbackFrom ?? null,
    captions: angles.map((angle) => {
      const found = byAngle.get(angle.id) ?? result.captions[angles.indexOf(angle)] ?? {};
      const hashtags = (Array.isArray(found.hashtags) ? found.hashtags : [])
        .map(cleanHashtag)
        .filter(Boolean);
      return {
        angle: angle.id,
        label: angle.label,
        hint: angle.hint,
        text: String(found.text || withTemplate(brief, [angle]).captions[0].text).trim(),
        hashtags: (hashtags.length ? hashtags : baseHashtags(brief)).slice(0, 8),
      };
    }),
  };
}

async function runProvider(id, brief, spoken, angles, { signal, timeoutMs } = {}) {
  const provider = getProvider(id);
  if (!provider) throw new Error(`ไม่รู้จักผู้ให้บริการ "${id}"`);
  const payload = { system: SYSTEM, user: userPrompt(brief, spoken, angles), signal, timeoutMs };
  const { text, model } = provider.kind === "cli"
    ? await callCliProvider(provider, payload)
    : await callOpenAICompatible(provider, payload);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed?.captions) || !parsed.captions.length) {
    throw new Error(`${provider.label} ตอบกลับมาไม่มี captions`);
  }
  return { provider: `${provider.id}:${model}`, captions: parsed.captions };
}
