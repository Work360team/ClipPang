// สร้างภาพตัวอย่างของทุกสไตล์ภาพ ด้วย promptFragment ของสไตล์นั้นเอง
//
// ภาพตัวอย่างต้องมาจากพรอมป์ชุดเดียวกับที่ใช้เจนจริง ไม่ใช่ภาพสวย ๆ ที่หามาแปะ
// ไม่งั้นผู้ใช้เลือกจากภาพหนึ่งแล้วได้อีกแบบหนึ่ง
//
// ใช้ฉากเดียวกันทุกสไตล์ จะได้เทียบกันได้ว่าต่างกันตรงสไตล์จริง ๆ ไม่ใช่ต่างกันเพราะเนื้อหา
//
//   node scripts/make-style-previews.mjs [slug ...]

import path from "node:path";
import fs from "node:fs";
import { listVisualStyles, getVisualStyle, VISUAL_STYLES_DIR } from "../pipeline/visual-styles.mjs";
import { generateImage } from "../pipeline/grok-visual.mjs";
import { ensureDir } from "../pipeline/lib.mjs";

const SCENE = "ผู้หญิงคนหนึ่งนั่งอยู่ริมหน้าต่างในห้องเล็ก ๆ มือถือโทรศัพท์อยู่ในมือ "
  + "มองออกไปนอกหน้าต่างตอนเช้า มีแก้วน้ำวางอยู่บนโต๊ะข้าง ๆ องค์ประกอบเรียบง่าย พื้นที่ว่างเยอะ";

const wanted = process.argv.slice(2);
const styles = wanted.length
  ? wanted.map((slug) => getVisualStyle(slug))
  : listVisualStyles();

ensureDir(path.join(VISUAL_STYLES_DIR, "previews"));

let made = 0;
for (const style of styles) {
  const out = path.join(VISUAL_STYLES_DIR, style.preview);
  if (fs.existsSync(out)) {
    console.log(`ข้าม ${style.slug} — มีภาพตัวอย่างแล้ว`);
    continue;
  }
  const started = Date.now();
  process.stdout.write(`กำลังสร้างตัวอย่าง ${style.slug} … `);
  try {
    // ขอเป็น .png แล้วค่อยเปลี่ยนชื่อ เพราะ generateImage บังคับนามสกุลไว้ให้ผลลัพธ์แน่นอน
    const temporary = out.replace(/\.jpg$/i, ".png");
    const result = await generateImage({ prompt: SCENE, style, outFile: temporary, aspect: "9:16" });
    if (temporary !== out) fs.renameSync(result.file, out);
    made += 1;
    console.log(`เสร็จ ${result.width}x${result.height} · ${((Date.now() - started) / 1000).toFixed(0)} วินาที`);
  } catch (error) {
    console.log(`ไม่สำเร็จ — ${error.message}`);
  }
}

console.log(`\nสร้างภาพตัวอย่างใหม่ ${made} ใบ จากทั้งหมด ${styles.length} สไตล์`);
