// สร้างไฟล์เสียงประกอบชุดเริ่มต้นด้วย ffmpeg
//
//   node scripts/make-sfx.mjs [--force]
//
// สังเคราะห์เอาแทนการไปโหลดจากคลังเสียงภายนอก ด้วยเหตุผลสามข้อ:
//   1. ไม่มีเรื่องลิขสิทธิ์ให้ต้องตามทีหลัง เสียงที่คำนวณขึ้นเองไม่มีเจ้าของ
//   2. ไฟล์เล็กมาก (ไม่กี่สิบ KB ทั้งชุด) ติดไปกับ repo ได้โดยไม่ถ่วง
//   3. ผู้ใช้เอาไฟล์ .wav ของตัวเองมาวางทับได้ตลอด ระบบอ่านจากโฟลเดอร์อยู่แล้ว
//
// เสียงทุกตัวเป็น mono 24000 Hz ให้ตรงกับเสียงพากย์ จะได้ไม่ต้องแปลงตอนผสม

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sfxAudioDir } from "../pipeline/sfx.mjs";

const FORCE = process.argv.includes("--force");
const OUT = sfxAudioDir();

/**
 * สูตรเสียงแต่ละตัว
 *
 * เสียงกวาด (whoosh) ใช้ noise ที่ค่อย ๆ ดังแล้วเบาลง — หูตีความว่าเป็นการเคลื่อนที่
 * ส่วนเสียงเน้น (pop/ding/tick) ใช้คลื่นไซน์ที่สลายตัวเร็ว ซึ่งคือรูปคลื่นของการเคาะจริง ๆ
 */
const SOUNDS = {
  "whoosh-soft.wav":
    "anoisesrc=color=brown:amplitude=0.55:duration=0.5,highpass=f=280,lowpass=f=3800," +
    "afade=t=in:st=0:d=0.22:curve=exp,afade=t=out:st=0.22:d=0.28",

  "whoosh-deep.wav":
    "anoisesrc=color=brown:amplitude=0.7:duration=0.75,highpass=f=90,lowpass=f=1600," +
    "afade=t=in:st=0:d=0.34:curve=exp,afade=t=out:st=0.36:d=0.39",

  "whoosh-tight.wav":
    "anoisesrc=color=pink:amplitude=0.5:duration=0.3,highpass=f=600,lowpass=f=6500," +
    "afade=t=in:st=0:d=0.1:curve=exp,afade=t=out:st=0.11:d=0.19",

  // สลายตัวเร็ว (exp -26t) ให้ได้เสียงสั้นแบบเคาะ ไม่ใช่เสียงบี๊บที่ลากยาว
  "pop.wav": "aevalsrc='sin(2*PI*640*t)*exp(-26*t)':d=0.2:s=24000",

  // ใส่ฮาร์มอนิกที่สองเข้าไปครึ่งหนึ่ง เสียงจะเป็นกระดิ่งแทนที่จะเป็นไซน์เปล่า ๆ
  "ding.wav": "aevalsrc='(sin(2*PI*1180*t)+0.45*sin(2*PI*2360*t))*exp(-8.5*t)':d=0.7:s=24000",

  "tick.wav": "aevalsrc='sin(2*PI*1750*t)*exp(-68*t)':d=0.09:s=24000",

  // ความถี่ไต่ขึ้นตามเวลา (220 → ~900) ให้ความรู้สึกว่ากำลังจะเริ่มอะไรบางอย่าง
  "rise.wav": "aevalsrc='sin(2*PI*(220+680*t)*t)*min(1,t*7)*exp(-2.1*t)':d=0.75:s=24000",

  "sweep-down.wav": "aevalsrc='sin(2*PI*(760-520*t)*t)*min(1,t*9)*exp(-3.4*t)':d=0.6:s=24000",
};

function run(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (data) => { err += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.split("\n").slice(-6).join("\n")));
      resolve(capture ? err : "");
    });
  });
}

/** ยอดคลื่นสูงสุดของไฟล์ หน่วย dBFS */
async function peakDb(file) {
  const log = await run(["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { capture: true });
  const found = /max_volume:\s*(-?[\d.]+) dB/.exec(log);
  if (!found) throw new Error(`อ่านระดับเสียงของ ${file} ไม่ได้`);
  return Number(found[1]);
}

/**
 * ปรับยอดคลื่นทุกเสียงให้เท่ากัน
 *
 * สูตรที่เขียนไว้ให้ระดับต่างกันเองถึง 16 dB (ding ชนเพดาน ส่วน whoosh-tight เบากว่ามาก)
 * ถ้าไม่ปรับ ค่า gainDb ที่ตั้งไว้ในชุดเสียงจะแปลว่าคนละอย่างกันในแต่ละเสียง
 * เว้นหัวไว้ 3 dB กันไม่ให้คลิปตอนแปลงเป็น aac ทีหลัง
 */
const TARGET_PEAK_DB = -3;
async function normalize(file) {
  const peak = await peakDb(file);
  const adjust = TARGET_PEAK_DB - peak;
  if (Math.abs(adjust) < 0.2) return peak;
  const temp = `${file}.tmp.wav`;
  await run(["-v", "error", "-i", file, "-af", `volume=${adjust.toFixed(2)}dB`, "-ac", "1", "-ar", "24000", "-y", temp]);
  fs.renameSync(temp, file);
  return TARGET_PEAK_DB;
}

fs.mkdirSync(OUT, { recursive: true });

let made = 0;
let kept = 0;
for (const [name, filter] of Object.entries(SOUNDS)) {
  const target = path.join(OUT, name);
  if (fs.existsSync(target) && !FORCE) { kept += 1; continue; }
  // -ac 1 -ar 24000 ให้ตรงกับเสียงพากย์ ตัวผสมจะได้ไม่ต้องรีแซมเปิลตอนเรนเดอร์
  await run(["-v", "error", "-f", "lavfi", "-i", filter, "-ac", "1", "-ar", "24000", "-y", target]);
  await normalize(target);
  made += 1;
}

const total = Object.keys(SOUNDS).length;
const bytes = Object.keys(SOUNDS).reduce((sum, name) => {
  const file = path.join(OUT, name);
  return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0);
}, 0);

console.log(`สร้างใหม่ ${made} ไฟล์ · มีอยู่แล้ว ${kept} ไฟล์ · รวม ${total} เสียง ${(bytes / 1024).toFixed(0)} KB`);
console.log(`เก็บที่ ${OUT}`);
