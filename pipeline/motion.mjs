// ช็อตโมชันกราฟิก — การ์ดที่ลอยขึ้นมาทับฟุตเทจจริง ไม่ได้มาแทนภาพ
//
// ใช้ composition ใบเดียวกับซับ ไม่ได้เพิ่มชั้นวิดีโอใหม่ เพราะเลเยอร์ที่เรนเดอร์ออกมา
// มี alpha อยู่แล้ว การ์ดจึงโปร่งแสงทับภาพได้ตรง ๆ และภาพเบื้องหลังยังเล่นต่อ
// ตัวประกอบ MP4 ไม่ต้องแก้อะไรเลย
//
// กระจกฝ้าจริง (backdrop-filter) ทำไม่ได้ เพราะตอนเรนเดอร์ composition อยู่บนพื้น
// โปร่งใส ไม่มีภาพข้างหลังให้เบลอ ถ้าอยากได้จริงต้องเรนเดอร์ชั้นมาสก์เพิ่มอีกรอบ
// แล้วให้ ffmpeg เบลอวิดีโอเฉพาะในมาสก์ ซึ่งแลกมาด้วยเวลาเรนเดอร์อีกเท่าตัว
//
// เทมเพลตหนึ่งแบบ = ไฟล์ .mjs หนึ่งใบใน pipeline/motion/ แบบเดียวกับสไตล์ซับและชุดเสียง
// เพิ่มแบบใหม่ = วางไฟล์เพิ่ม

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(HERE, "motion");

let cache = null;

/** อ่านเทมเพลตทั้งหมด เรียงตามชื่อไฟล์ให้ลำดับคงที่ */
export async function listMotionTemplates({ dir = TEMPLATES_DIR, reload = false } = {}) {
  if (cache && !reload) return cache;
  if (!fs.existsSync(dir)) return (cache = []);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".mjs")).sort();
  const loaded = [];
  for (const name of files) {
    const template = await import(pathToUrl(path.join(dir, name)));
    if (typeof template.render !== "function") continue;
    loaded.push({
      slug: template.slug || path.basename(name, ".mjs"),
      name: template.name || path.basename(name, ".mjs"),
      tagline: template.tagline || "",
      fields: template.fields || [],
      render: template.render,
    });
  }
  return (cache = loaded);
}

function pathToUrl(file) {
  return new URL(`file://${path.resolve(file).replace(/\\/g, "/")}`).href;
}

export async function getMotionTemplate(slug, options = {}) {
  if (!slug) return null;
  return (await listMotionTemplates(options)).find((item) => item.slug === slug) || null;
}

/** ช็อตที่ไม่มีเวลาที่ใช้ได้จริงถูกทิ้ง ปล่อยผ่านไปจะได้ clip ที่ยาวติดลบ */
function usable(shot) {
  const startMs = Number(shot?.startMs);
  const endMs = Number(shot?.endMs);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && startMs >= 0;
}

/**
 * เขตที่ซับจองไว้ เทมเพลตต้องไม่วางอะไรทับ
 *
 * ช็อตโมชันกับซับอยู่คนละชั้นในเลเยอร์เดียวกัน ซับวาดทับเสมอ ถ้าเทมเพลตวางข้อความ
 * ตรงแถบเดียวกันจะซ้อนกันจนอ่านไม่ออกทั้งคู่ (วัดแล้ว: ซับกินแถบ 773–880 จาก 1280)
 */
function captionSafeArea(anchor, height) {
  const band = Math.round(height * 0.3);
  if (anchor === "top") return { top: band, bottom: 0 };
  if (anchor === "middle") return { top: Math.round(height * 0.08), bottom: Math.round(height * 0.22) };
  return { top: 0, bottom: band };
}

/**
 * รวมช็อตโมชันทั้งหมดเป็นชิ้นส่วนที่ยัดเข้า composition ได้
 *
 * @returns {{html:string, css:string, beats:object[], shots:object[]}}
 */
export async function compileMotionShots(shots, { width, height, font, captionAnchor } = {}) {
  const list = (Array.isArray(shots) ? shots : []).filter(usable);
  if (!list.length) return { html: "", css: "", beats: [], shots: [] };

  const safe = captionSafeArea(captionAnchor, height);
  const htmlParts = [];
  const cssParts = [];
  const beats = [];
  const used = new Set();
  const accepted = [];

  for (const [index, shot] of list.entries()) {
    const template = await getMotionTemplate(shot.template);
    if (!template) continue;
    const id = `mo${index}`;
    const piece = template.render({
      shot,
      id,
      width,
      height,
      font,
      safe,
      data: shot.data || {},
    });
    if (!piece?.html) continue;

    const startSec = (shot.startMs / 1000).toFixed(3);
    const durSec = ((shot.endMs - shot.startMs) / 1000).toFixed(3);
    htmlParts.push(
      `<div id="${id}" class="clip mo" data-start="${startSec}" data-duration="${durSec}" data-track-index="0">` +
      `${piece.html}</div>`,
    );
    // CSS ของเทมเพลตแต่ละแบบใส่ครั้งเดียว ต่อให้ใช้เทมเพลตนั้นหลายช็อต
    if (piece.css && !used.has(template.slug)) {
      used.add(template.slug);
      cssParts.push(piece.css);
    }
    for (const beat of piece.beats || []) {
      beats.push({ ...beat, t: shot.startMs / 1000 + (beat.t || 0) });
    }
    accepted.push({ ...shot, id, template: template.slug });
  }

  return { html: htmlParts.join("\n      "), css: cssParts.join("\n"), beats, shots: accepted };
}

/** ความยาวเริ่มต้นของการ์ด ถ้าไม่ได้ระบุมา — พออ่านตัวเลขกับคำอธิบายจบพอดี */
export const DEFAULT_MOTION_MS = 3500;

/**
 * แปลงการ์ดที่ผูกกับ "ท่อนสคริปต์" ให้เป็นเวลาจริง
 *
 * หน้าเว็บผูกการ์ดไว้กับหมายเลขท่อนที่ผู้ใช้เขียน เพราะตอนอยู่ขั้นเลือกสคริปต์
 * ยังไม่มีใครรู้ว่าท่อนนั้นจะถูกพูดวินาทีที่เท่าไร — เวลาจริงเกิดหลังพากย์เสียง
 * และจับคำด้วย whisper เสร็จแล้วเท่านั้น
 *
 * ท่อนของผู้ใช้หนึ่งท่อนอาจถูกหั่นเป็นหลายท่อนในไทม์ไลน์ จึงจับจากฟิลด์ from
 * ที่ติดมากับแต่ละท่อน ไม่ใช่นับตำแหน่งในอาเรย์ซึ่งจะเลื่อนทันทีที่มีการหั่น
 */
export function resolveMotionShots(shots, timeline) {
  const chunks = timeline?.chunks || [];
  const totalMs = Number(timeline?.durationMs) || 0;
  return (Array.isArray(shots) ? shots : [])
    .map((shot) => {
      // ระบุเวลามาเองแล้วก็ใช้ตามนั้น (ทางที่สคริปต์บรรทัดคำสั่งใช้)
      if (Number.isFinite(Number(shot?.startMs)) && Number.isFinite(Number(shot?.endMs))) return shot;
      const at = Number(shot?.atChunk);
      if (!Number.isInteger(at)) return null;
      const anchor = chunks.find((chunk) => (chunk.from ?? chunk.i) === at);
      if (!anchor) return null;
      const durationMs = Number(shot.durationMs) || DEFAULT_MOTION_MS;
      const endMs = totalMs ? Math.min(totalMs, anchor.startMs + durationMs) : anchor.startMs + durationMs;
      return { ...shot, startMs: anchor.startMs, endMs };
    })
    .filter(Boolean)
    .filter((shot) => shot.endMs > shot.startMs);
}

/** ช่วงเวลาที่ถูกช็อตโมชันบังอยู่ ใช้เลี่ยงตอนสุ่มเฟรมไปตรวจ alpha */
export function motionCoverage(shots) {
  return (Array.isArray(shots) ? shots : [])
    .filter(usable)
    .map((shot) => [Number(shot.startMs), Number(shot.endMs)])
    .sort((a, b) => a[0] - b[0]);
}

export function isCoveredByMotion(ms, shots) {
  return motionCoverage(shots).some(([start, end]) => ms >= start && ms < end);
}
