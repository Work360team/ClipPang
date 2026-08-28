// storyboard — แปลงคอนเทนต์ที่เขียนไว้แล้ว ให้เป็นรายการช็อตพร้อมพรอมป์ภาพ
//
// หลักการที่ต่างจากขั้นเขียนสคริปต์ขายสินค้า: ตรงนั้น AI เป็นคนเขียนคำพูด แต่ตรงนี้
// **คำพูดเป็นของผู้ใช้อยู่แล้ว** งานของ AI คือแบ่งเป็นช็อตและคิดว่าแต่ละช็อตควรเห็นภาพอะไร
// ห้ามเขียนคำพูดใหม่เด็ดขาด เพราะคนที่เอาคอนเทนต์ตัวเองมาใส่ ไม่ได้อยากได้คอนเทนต์ของ AI
//
// พรอมป์ภาพเขียนเป็นภาษาอังกฤษ เพราะโมเดลภาพเข้าใจได้ตรงกว่า และต้องระบุของสมัยใหม่
// ให้ชัด (smartphone ไม่ใช่ phone) — รอบทดสอบเจอว่าพอบอกแค่ "โทรศัพท์" กับสไตล์งานฝีมือ
// โมเดลวาดโทรศัพท์หมุนยุคเก่ามาให้

import { getProvider, callCliProvider, extractJson } from "./providers.mjs";
import { getVisualStyle } from "./visual-styles.mjs";
import { graphemeCount } from "./core.mjs";
import { nearestShotSeconds } from "./grok-visual.mjs";

/** ความเร็วพูดไทยโดยประมาณ ใช้กะจำนวนช็อตก่อนรู้ความยาวเสียงจริง */
const CHARS_PER_SECOND = 9.5;

const SYSTEM = [
  "คุณเป็นผู้กำกับคลิปสั้นแนวเล่าเรื่องสำหรับ TikTok และ Reels",
  "คุณจะได้บทพากย์ที่ลูกค้าเขียนมาเองแล้ว หน้าที่ของคุณคือแบ่งเป็นช็อตและออกแบบภาพให้แต่ละช็อต",
  "",
  "กฎที่ห้ามฝ่าฝืน:",
  "1. ห้ามแก้ เพิ่ม ตัด หรือเรียบเรียงคำพูดของลูกค้าใหม่ ใช้ข้อความเดิมทุกตัวอักษร",
  "2. เมื่อรวมข้อความ narration ของทุกช็อตเรียงกัน ต้องได้ข้อความต้นฉบับกลับมาครบถ้วนตามลำดับเดิม",
  "3. ตัดบรรทัดที่ขึ้นต้นด้วย # และบรรทัดที่มีแค่จุด ออกไปไม่ต้องเอามาเป็น narration",
  "4. ห้ามให้ตัวหนังสือที่ต้องอ่านออกเป็นใจความหลักของช็อต เพราะภาพจะมีซับทับอยู่แล้ว",
  "   ถ้าจะสื่อถึงเอกสาร ให้เล่าด้วยมือ ท่าทาง หรือวัตถุรอบ ๆ แทนการโฟกัสที่ข้อความบนกระดาษ",
  "5. ตอบเป็น JSON อย่างเดียว ห้ามมี markdown fence ห้ามมีคำอธิบายนอก JSON",
].join("\n");

function shape(shotCount) {
  return [
    "{",
    '  "title": "ชื่อคลิปสั้น ๆ ภาษาไทย",',
    '  "shots": [',
    "    {",
    '      "narration": "ข้อความพากย์ของช็อตนี้ ตัดมาจากต้นฉบับตรง ๆ",',
    '      "image": "English prompt describing exactly what is seen in this frame. Concrete nouns, one clear subject, describe composition and mood. Say smartphone / laptop / modern Thai apartment explicitly when you mean modern things. Do not mention art style, that is added separately.",',
    '      "motion": "English description of the small movement in this shot, camera and subject"',
    "    }",
    "  ]",
    "}",
    "",
    `ทำให้ได้ประมาณ ${shotCount} ช็อต`,
  ].join("\n");
}

/**
 * จำนวนช็อตที่ควรมี
 *
 * คิดจากความยาวข้อความ ไม่ใช่ให้ AI เดา เพราะ image_to_video ทำได้แค่ช็อตละ 6 หรือ 10
 * วินาที ถ้าได้ช็อตน้อยเกินไปคลิปจะสั้นกว่าเสียงแล้วต้องไปตัดเสียงทิ้ง
 */
export function planShotCount(narrationText, { secondsPerShot = 6 } = {}) {
  const seconds = graphemeCount(narrationText) / CHARS_PER_SECOND;
  return Math.max(3, Math.ceil(seconds / secondsPerShot));
}

/** ตัดแฮชแท็กและบรรทัดคั่นออก เหลือเฉพาะสิ่งที่ต้องอ่านออกเสียง */
export function narrationLines(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "." && !line.startsWith("#"));
}

export function hashtagsFrom(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#"));
}

/**
 * ตรวจว่าคำพูดที่ได้กลับมายังเป็นของลูกค้าจริง
 *
 * เทียบแบบตัดช่องว่างและวรรคตอนออก เพราะการแบ่งช็อตทำให้ช่องว่างต่างจากเดิมได้
 * แต่ตัวอักษรต้องครบและเรียงเหมือนเดิม ถ้าไม่ครบแปลว่า AI ไปเขียนใหม่ ซึ่งผิดกติกาข้อแรก
 */
function narrationMatches(shots, expected) {
  const strip = (value) => String(value || "").replace(/[\s.,!?"'“”‘’\-—]/g, "");
  return strip(shots.map((shot) => shot.narration).join("")) === strip(expected);
}

/**
 * สร้างสตอรี่บอร์ดจากคอนเทนต์ดิบ
 *
 * ใช้ผู้ให้บริการตัวเดียวกับที่หน้าตั้งค่าเลือกไว้ (ค่าเริ่มต้นคือ grok-cli) เพราะเป็น
 * ตัวเดียวกับที่จะไปสร้างภาพต่อ พรอมป์ภาพที่มันเขียนเองจึงเข้ากับเครื่องมือของมันเอง
 */
export async function buildStoryboard({
  content,
  styleId = "paper-collage",
  providerId = "grok-cli",
  secondsPerShot = 6,
  signal,
  timeoutMs,
} = {}) {
  const style = getVisualStyle(styleId);
  const lines = narrationLines(content);
  if (!lines.length) throw new Error("ไม่พบข้อความพากย์ในไฟล์คอนเทนต์");
  const narration = lines.join(" ");
  const shotCount = planShotCount(narration, { secondsPerShot });

  const provider = getProvider(providerId);
  if (!provider) throw new Error(`ไม่รู้จักผู้ให้บริการ ${providerId}`);

  const user = [
    "บทพากย์ของลูกค้า (แต่ละบรรทัดคือหนึ่งวรรค):",
    "",
    lines.join("\n"),
    "",
    `อารมณ์ของงาน: ${style.tagline}`,
    "",
    "ตอบตามรูปแบบนี้:",
    shape(shotCount),
  ].join("\n");

  const raw = await callCliProvider(provider, { system: SYSTEM, user, signal, timeoutMs });
  const parsed = extractJson(raw.text);
  const shots = Array.isArray(parsed?.shots) ? parsed.shots : [];
  if (!shots.length) throw new Error("สตอรี่บอร์ดที่ได้กลับมาไม่มีช็อตเลย");

  if (!narrationMatches(shots, narration)) {
    throw new Error(
      "คำพากย์ที่ได้กลับมาไม่ตรงกับต้นฉบับ — ผู้ช่วยเขียนคำใหม่แทนที่จะแค่แบ่งช็อต กรุณาสั่งใหม่อีกครั้ง",
    );
  }

  return {
    title: String(parsed.title || "คลิปเล่าเรื่อง").trim(),
    styleId: style.slug,
    styleName: style.name,
    hashtags: hashtagsFrom(content),
    shots: shots.map((shot, index) => ({
      id: `s${String(index + 1).padStart(2, "0")}`,
      narration: String(shot.narration || "").trim(),
      image: String(shot.image || "").trim(),
      motion: String(shot.motion || "slow gentle camera push in").trim(),
      seconds: nearestShotSeconds(secondsPerShot),
    })),
  };
}
