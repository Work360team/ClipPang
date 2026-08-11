// lib — helpers ที่ทุก stage ใช้ร่วมกัน  →  อนาคตคือ packages/shared
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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

const DEFAULT_STDOUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_STDERR_BYTES = 256 * 1024;

function appendBounded(current, chunk, maxBytes) {
  if (maxBytes <= 0) return "";
  const next = current + String(chunk);
  if (Buffer.byteLength(next) <= maxBytes) return next;

  // stderr is primarily diagnostic, so preserve its tail. Convert through a
  // Buffer to keep the memory ceiling meaningful for UTF-8 Thai text too.
  const bytes = Buffer.from(next);
  return bytes.subarray(Math.max(0, bytes.length - maxBytes)).toString("utf8");
}

export class ProcessTimeoutError extends Error {
  constructor(cmd, timeoutMs) {
    super(`คำสั่ง ${cmd} ใช้เวลาเกิน ${timeoutMs}ms`);
    this.name = "ProcessTimeoutError";
    this.code = "PROCESS_TIMEOUT";
    this.command = cmd;
    this.timeoutMs = timeoutMs;
  }
}

export function toAbortError(reason = "ยกเลิกการทำงานแล้ว") {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const error = new Error(reason instanceof Error ? reason.message : String(reason));
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  if (reason instanceof Error) error.cause = reason;
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw toAbortError(signal.reason);
}

/**
 * Spawn without a shell, with cooperative cancellation and a hard timeout.
 * Captured output is bounded so a noisy ffmpeg process cannot exhaust worker
 * memory. opts.signal is intentionally managed here instead of passed to
 * spawn: this gives us one consistent terminate/escalate path on Windows and
 * Unix.
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const {
      cwd,
      env = process.env,
      signal,
      timeoutMs = 0,
      maxStdoutBytes = DEFAULT_STDOUT_BYTES,
      maxStderrBytes = DEFAULT_STDERR_BYTES,
      killGraceMs = 1_500,
    } = opts;

    try {
      throwIfAborted(signal);
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(cmd, args, { cwd, env, windowsHide: true, shell: false });
    let out = "";
    let err = "";
    let settled = false;
    let stopReason = null;
    let timeout = null;
    let escalation = null;
    let hardStop = null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      if (hardStop) clearTimeout(hardStop);
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const terminate = (reason) => {
      if (stopReason || settled) return;
      stopReason = reason;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        escalation = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, killGraceMs);
        escalation.unref?.();
        hardStop = setTimeout(() => finish(stopReason), killGraceMs * 2);
        hardStop.unref?.();
      }
    };

    function onAbort() {
      terminate(toAbortError(signal?.reason));
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => { out = appendBounded(out, d, maxStdoutBytes); });
    child.stderr?.on("data", (d) => { err = appendBounded(err, d, maxStderrBytes); });
    child.on("error", (cause) => {
      const error = new Error(`สั่ง ${cmd} ไม่สำเร็จ: ${cause.message} — ติดตั้งแล้วอยู่ใน PATH หรือยัง?`, { cause });
      error.code = cause.code;
      error.command = cmd;
      finish(stopReason || error);
    });
    child.on("close", (code) => {
      if (stopReason) return finish(stopReason);
      if (code === 0) return finish(null, { out, err, code });
      const tail = (err || out).split("\n").slice(-14).join("\n");
      const error = new Error(`${cmd} exit ${code}\n${tail}`);
      error.code = code;
      error.command = cmd;
      error.args = [...args];
      error.stderr = err;
      error.stdout = out;
      finish(error);
    });

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (timeoutMs > 0) {
      timeout = setTimeout(() => terminate(new ProcessTimeoutError(cmd, timeoutMs)), timeoutMs);
      timeout.unref?.();
    }
  });
}

export const ffmpeg = (args, opts = {}) => run(
  process.env.FFMPEG_PATH || "ffmpeg",
  ["-hide_banner", "-nostdin", ...args],
  { ...opts, timeoutMs: opts.timeoutMs ?? Number(process.env.FFMPEG_TIMEOUT_MS || 15 * 60_000) },
);
export const ffprobe = (args, opts = {}) => run(
  process.env.FFPROBE_PATH || "ffprobe",
  args,
  { ...opts, timeoutMs: opts.timeoutMs ?? Number(process.env.FFPROBE_TIMEOUT_MS || 30_000) },
);

/** ความยาวไฟล์สื่อจริง (ms) — แหล่งความจริงเดียวเรื่องเวลา ห้ามเดาจากข้อความ */
export async function durationMs(file, opts = {}) {
  const { out } = await ffprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ], opts);
  const sec = Number.parseFloat(out.trim());
  if (!Number.isFinite(sec)) throw new Error(`อ่านความยาวไฟล์ไม่ได้: ${file}`);
  return Math.round(sec * 1000);
}

/* ---------- fs ---------- */

export const ensureDir = (p) => (fs.mkdirSync(p, { recursive: true }), p);
export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const graphemeSegmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

/** Preserve Thai combining marks and never split a grapheme at the length cap. */
export function slugify(value, maxGraphemes = 48) {
  const normalized = String(value ?? "").normalize("NFC").trim().toLowerCase();
  const safe = normalized
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const clipped = Array.from(graphemeSegmenter.segment(safe), (item) => item.segment)
    .slice(0, Math.max(1, maxGraphemes))
    .join("")
    .replace(/-+$/g, "");
  return clipped || "clip";
}

/** Milliseconds plus random entropy avoid collisions between concurrent jobs. */
export function createRunName(label = "clip", { now = new Date(), suffix } = {}) {
  const stamp = now.toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  const unique = suffix ?? randomBytes(4).toString("hex");
  return `${slugify(label)}-${stamp}-${unique}`;
}

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
