#!/usr/bin/env node
/**
 * ตรวจว่าป้ายเพศของเสียงตรงกับเสียงจริงไหม โดยวัดความถี่มูลฐาน (F0) จากไฟล์ตัวอย่าง
 *
 * ทำไมต้องมีสคริปต์นี้: Google ไม่ได้ประกาศเพศของเสียงทั้ง 30 ตัวไว้ในเอกสาร
 * (ระบุไว้แค่ลักษณะเสียง เช่น Bright, Firm) ป้าย ชาย/หญิง ใน VOICES จึงมาจากการวัด
 * ไม่ใช่จากเอกสาร ถ้าวันหนึ่ง Google เปลี่ยนเสียงเบื้องหลัง รันสคริปต์นี้จะรู้ทันที
 *
 * วิธีใช้: node scripts/make-voice-samples.mjs --force   (สร้าง wav ลง .cache ก่อน)
 *          node scripts/audit-voice-gender.mjs
 *
 * ผลที่ได้ตอนตรวจล่าสุด: ชาย 16 เสียงอยู่ที่ 94-139 Hz หญิง 14 เสียงอยู่ที่ 182-264 Hz
 * มีช่องว่างคั่นชัดเจน ยกเว้น Fenrir ที่ 159 Hz ซึ่งอยู่กึ่งกลางระหว่างสองกลุ่ม
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VOICES } from "../pipeline/tts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 22050;
const TMP = path.join(ROOT, ".cache", "voice-samples");
const TEXT = {
  "หญิง": "สวัสดีค่ะ ตัวนี้ใช้ดีมาก บอกเลยว่าคุ้มมาก กดตะกร้าส้มได้เลยค่ะ",
  "ชาย": "สวัสดีครับ ตัวนี้ใช้ดีมาก บอกเลยว่าคุ้มมาก กดตะกร้าส้มได้เลยครับ",
};
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

function pcm(file) {
  const r = spawnSync("ffmpeg", ["-v","error","-i",file,"-ac","1","-ar",String(RATE),"-f","s16le","-"], { maxBuffer: 1<<28 });
  const b = r.stdout, o = new Float32Array(b.length/2);
  for (let i=0;i<o.length;i++) o[i]=b.readInt16LE(i*2)/32768;
  return o;
}

/**
 * YIN (de Cheveigné & Kawahara 2002) — เลือก lag "แรกสุด" ที่ผ่านเกณฑ์ ไม่ใช่ lag ที่
 * correlation สูงสุด จึงไม่หลุดไปทวีคูณของคาบเสียงเหมือน autocorrelation ธรรมดา
 */
function yin(x, s, W, threshold = 0.15) {
  const maxTau = Math.floor(RATE / 65);
  const minTau = Math.floor(RATE / 400);
  const d = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) { const diff = x[s+i] - x[s+i+tau]; sum += diff*diff; }
    d[tau] = sum;
  }
  const dp = new Float64Array(maxTau + 1); dp[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) { running += d[tau]; dp[tau] = d[tau] * tau / running; }
  let tau = minTau;
  while (tau <= maxTau && dp[tau] >= threshold) tau++;
  if (tau > maxTau) return null;
  while (tau + 1 <= maxTau && dp[tau+1] < dp[tau]) tau++;          // ลงไปหาก้นหลุม
  const a = dp[tau-1], b = dp[tau], c = dp[tau+1] ?? b;            // ประมาณจุดต่ำสุดแบบพาราโบลา
  const shift = (a - c) ? 0.5 * (a - c) / (a - 2*b + c) : 0;
  return RATE / (tau + shift);
}

function track(x) {
  const W = 2048, hop = 1024, out = [];
  for (let s = 0; s + W + Math.floor(RATE/65) < x.length; s += hop) {
    let e = 0; for (let i=0;i<W;i++) e += x[s+i]*x[s+i];
    if (Math.sqrt(e/W) < 0.03) continue;
    const f = yin(x, s, W);
    if (f && f > 60 && f < 400) out.push(f);
  }
  return out;
}
const med = a => { const s=[...a].sort((p,q)=>p-q); return s[Math.floor(s.length/2)]; };

const rows = [];
for (const v of VOICES.gemini) {
  const text = TEXT[v.gender] ?? TEXT["หญิง"];
  const key = sha256(["gemini", v.id, 1, "เป็นกันเอง", text].join("\0")).slice(0, 24);
  const wav = path.join(TMP, `preview-${key}.wav`);
  if (!fs.existsSync(wav)) { rows.push({ id: v.id, label: v.gender, f0: null }); continue; }
  const f = track(pcm(wav));
  rows.push({ id: v.id, label: v.gender, f0: f.length ? Math.round(med(f)) : null, n: f.length });
}
rows.sort((a,b)=>(a.f0??0)-(b.f0??0));
console.log(" F0   ป้าย   วัดได้  เฟรม  id");
const bad=[];
for (const r of rows) {
  const m = r.f0==null ? "?" : r.f0 < 145 ? "ชาย" : r.f0 > 165 ? "หญิง" : "ก้ำกึ่ง";
  const flag = m!=="ก้ำกึ่ง" && m!=="?" && m!==r.label;
  if (flag) bad.push(`${r.id}  ${r.label} -> ${m} (${r.f0}Hz)`);
  console.log(String(r.f0??"-").padStart(4)," ",r.label.padEnd(5),m.padEnd(7),String(r.n??0).padStart(4)," ",r.id, flag?"  <<<":"");
}
console.log("\nต้องแก้ป้าย " + bad.length + " เสียง"); bad.forEach(b=>console.log("  "+b));
