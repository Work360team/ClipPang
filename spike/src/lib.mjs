// lib — helpers ที่ทุก stage ใช้ร่วมกัน  →  อนาคตคือ packages/shared
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ---------- console ---------- */

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
};
export { C };

let stageNo = 0;
const stageTimings = {};

export function stage(name) {
  stageNo += 1;
  const label = `${String(stageNo).padStart(2, "0")} ${name}`;
  const t0 = Date.now();
  process.stdout.write(`${C.c("▸")} ${C.bold(label)}\n`);
  return {
    note: (msg) => process.stdout.write(`   ${C.dim(msg)}\n`),
    warn: (msg) => process.stdout.write(`   ${C.y("!")} ${msg}\n`),
    done: (msg = "") => {
      const ms = Date.now() - t0;
      stageTimings[name] = ms;
      process.stdout.write(`   ${C.g("✓")} ${msg} ${C.dim(`${(ms / 1000).toFixed(1)}s`)}\n`);
      return ms;
    },
  };
}
export const timings = () => ({ ...stageTimings });

export function die(msg) {
  process.stderr.write(`\n${C.r("✗")} ${msg}\n`);
  process.exit(1);
}

/* ---------- process ---------- */

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`สั่ง ${cmd} ไม่สำเร็จ: ${e.message} — ติดตั้งแล้วอยู่ใน PATH หรือยัง?`)),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve({ out, err });
      const tail = (err || out).split("\n").slice(-14).join("\n");
      reject(new Error(`${cmd} exit ${code}\n${tail}`));
    });
  });
}

export const ffmpeg = (args, opts) => run(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-nostdin", ...args], opts);
export const ffprobe = (args, opts) => run(process.env.FFPROBE_PATH || "ffprobe", args, opts);

/** ความยาวไฟล์สื่อจริง (ms) — แหล่งความจริงเดียวเรื่องเวลา ห้ามเดาจากข้อความ */
export async function durationMs(file) {
  const { out } = await ffprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const sec = Number.parseFloat(out.trim());
  if (!Number.isFinite(sec)) throw new Error(`อ่านความยาวไฟล์ไม่ได้: ${file}`);
  return Math.round(sec * 1000);
}

/* ---------- fs ---------- */

export const ensureDir = (p) => (fs.mkdirSync(p, { recursive: true }), p);
export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** โหลด .env แบบง่าย (ไม่ทับค่าที่ตั้งไว้ใน environment แล้ว) */
export function loadEnv(root) {
  const f = path.join(root, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
}

/* ---------- format ---------- */

export const ms2s = (ms) => (ms / 1000).toFixed(3);

/** 0:00:01.24 สำหรับ ASS */
export function assTime(ms) {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** 00:00:01,240 สำหรับ SRT */
export function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(t % 1000).padStart(3, "0")}`;
}
