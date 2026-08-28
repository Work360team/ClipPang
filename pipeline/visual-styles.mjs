// visual-styles — คลังสไตล์ภาพสำหรับคลิปเล่าเรื่อง
//
// วางโครงเดียวกับคลังสไตล์ซับใน pipeline/styles/ โดยตั้งใจ: เพิ่มสไตล์ใหม่ = วางไฟล์ JSON
// เพิ่มหนึ่งใบ ไม่ต้องแตะโค้ด เพราะเทรนด์ภาพเปลี่ยนทุกไม่กี่เดือน ถ้าต้องแก้โค้ดทุกครั้ง
// สุดท้ายก็จะไม่มีใครเพิ่ม
//
// ทุกใบมีฟิลด์ preview ชี้ไปที่ภาพตัวอย่างที่สร้างจาก promptFragment ของตัวเอง
// เพราะหน้าเลือกสไตล์ต้องให้ผู้ใช้ "เห็นว่าหน้าตาแบบไหน" ไม่ใช่อ่านชื่อแล้วเดา

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STYLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "visual-styles");

function readStyle(file) {
  return JSON.parse(fs.readFileSync(path.join(STYLES_DIR, file), "utf8"));
}

/** สไตล์ทั้งหมด เรียงตามชื่อไทย */
export function listVisualStyles() {
  return fs.readdirSync(STYLES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map(readStyle)
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
}

/** สไตล์เดียวตาม slug — โยนข้อผิดพลาดที่บอกตัวเลือกที่มี ไม่ใช่แค่บอกว่าไม่เจอ */
export function getVisualStyle(slug) {
  const file = path.join(STYLES_DIR, `${String(slug || "").replace(/[^a-z0-9-]/gi, "")}.json`);
  if (!fs.existsSync(file)) {
    const available = listVisualStyles().map((style) => style.slug).join(", ");
    throw new Error(`ไม่รู้จักสไตล์ภาพ “${slug}” — ที่มีอยู่: ${available}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** พาธเต็มของภาพตัวอย่าง (อาจยังไม่มีไฟล์ถ้ายังไม่ได้สร้าง) */
export function previewPath(style) {
  return path.join(STYLES_DIR, style.preview);
}

export { STYLES_DIR as VISUAL_STYLES_DIR };
