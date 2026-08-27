// jaitts — เสียงพากย์ไทยที่รันในเครื่อง (JaiTTS / F5-TTS) แบบโคลนเสียงจากตัวอย่างสั้น ๆ
//
// ตัวนี้คุม worker ฝั่ง Python ที่โหลดโมเดลค้างไว้ตัวเดียว แล้วส่งงานเข้าไปทีละท่อน
// เหตุผลอยู่ในหัวไฟล์ jaitts-worker.py — เรียกสคริปต์ของต้นทางตรง ๆ จะเสียเวลา
// โหลดโมเดลใหม่ทุกท่อน (วัดได้ 40.7 วินาที/ครั้ง เทียบกับเวลาสังเคราะห์จริง ~4 วินาที)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { throwIfAborted, toAbortError } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKER = path.join(HERE, "jaitts-worker.py");

/** โหลดโมเดลรอบแรกอ่านไฟล์เป็นกิกะไบต์ ให้เวลามันพอสมควร */
const START_TIMEOUT_MS = 180_000;
/** ท่อนหนึ่งวัดได้ ~4 วินาทีบน RTX 5080 เผื่อไว้มากพอสำหรับเครื่องที่ช้ากว่า */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * ที่ติดตั้ง JaiTTS
 *
 * ปกติคือ data/bin/jaitts ซึ่งเป็นที่ที่ตัวติดตั้งในหน้าตั้งค่าจะวางไว้ ตั้ง JAITTS_HOME
 * ใน .env เพื่อชี้ไปที่อื่นได้ เช่นเครื่องที่ติดตั้งเองไว้แล้วก่อนหน้านี้
 */
export function jaittsHome() {
  const configured = process.env.JAITTS_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(ROOT, "data", "bin", "jaitts");
}

function pythonPath(home) {
  return process.platform === "win32"
    ? path.join(home, ".venv-tts", "Scripts", "python.exe")
    : path.join(home, ".venv-tts", "bin", "python");
}

/**
 * ตรวจว่าติดตั้งครบพร้อมใช้หรือยัง
 *
 * เช็คสามอย่างแยกกันเพื่อบอกได้ว่าขาดอะไร — "ยังไม่ได้ติดตั้ง" กับ "ติดตั้งแล้วแต่ venv พัง"
 * ต้องแก้คนละทาง การรวมเป็น true/false เฉย ๆ ทำให้ผู้ใช้ไม่รู้จะไปต่อยังไง
 */
export function discoverJaitts() {
  const home = jaittsHome();
  if (!fs.existsSync(home)) {
    return { ready: false, home, python: null, reason: "ยังไม่ได้ติดตั้งเสียงพากย์ในเครื่อง" };
  }
  if (!fs.existsSync(path.join(home, "jaitts_synth.py"))) {
    return { ready: false, home, python: null, reason: "โฟลเดอร์ JaiTTS ไม่สมบูรณ์ — ไม่เจอ jaitts_synth.py" };
  }
  const python = pythonPath(home);
  if (!fs.existsSync(python)) {
    return { ready: false, home, python: null, reason: "ไม่เจอ Python ของ JaiTTS — ติดตั้งใหม่อีกครั้ง" };
  }
  return { ready: true, home, python, reason: null };
}

let worker = null;

function killWorker(reason) {
  if (!worker) return;
  const current = worker;
  worker = null;
  for (const pending of current.pending.values()) pending.reject(new Error(reason));
  current.pending.clear();
  current.queue.length = 0;
  try {
    current.child.stdin.end();
  } catch {
    // ปิด stdin ไม่ได้แปลว่าโปรเซสตายไปแล้ว ไม่ต้องทำอะไรต่อ
  }
  current.child.kill();
}

/** ปิด worker — ใช้ตอนปิดโปรแกรมหรือจบเทสต์ ไม่งั้นโปรเซสจะค้าง */
export function shutdownJaitts() {
  killWorker("ปิดการทำงานของเสียงพากย์ในเครื่องแล้ว");
}

function spawnWorker(install) {
  const child = spawn(install.python, [WORKER], {
    cwd: install.home,
    env: {
      ...process.env,
      JAITTS_HOME: install.home,
      // ไลบรารีพิมพ์ข้อความไทยระหว่างทำงาน ถ้า stdout เป็น cp1252 จะล้มทุกครั้งที่สังเคราะห์
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      // เอาต์พุตต้องออกมาทีละบรรทัดทันที ไม่ใช่รอ buffer เต็ม
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const state = {
    child,
    ready: false,
    pending: new Map(),
    queue: [],
    busy: false,
    nextId: 1,
    stderr: "",
    device: null,
  };

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) handleLine(state, line);
      index = buffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    // เก็บไว้ท้าย ๆ พอสำหรับบอกสาเหตุตอนพัง ไม่ให้โตไม่จำกัด
    state.stderr = (state.stderr + chunk).slice(-4000);
  });

  child.on("exit", (code) => {
    if (worker !== state) return;
    const detail = state.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
    killWorker(`เสียงพากย์ในเครื่องหยุดทำงาน (code ${code})${detail ? `: ${detail}` : ""}`);
  });

  child.on("error", (error) => {
    if (worker !== state) return;
    killWorker(`เรียก Python ของ JaiTTS ไม่ได้: ${error.message}`);
  });

  return state;
}

function handleLine(state, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    // บรรทัดที่ไม่ใช่ JSON แปลว่ามีอะไรหลุดมาจากไลบรารี ปล่อยผ่านดีกว่าล้มทั้ง worker
    return;
  }
  if (message.ready === true) {
    state.ready = true;
    state.device = message.device ?? null;
    state.onReady?.(null);
    return;
  }
  if (message.ready === false) {
    state.onReady?.(new Error(message.error || "โหลดโมเดล JaiTTS ไม่สำเร็จ"));
    return;
  }
  const pending = state.pending.get(message.id);
  if (!pending) return;
  state.pending.delete(message.id);
  state.busy = false;
  if (message.ok) pending.resolve({ ms: message.ms ?? null });
  else pending.reject(new Error(message.error || "สังเคราะห์เสียงไม่สำเร็จ"));
  drain(state);
}

function drain(state) {
  if (state.busy || !state.ready || !state.queue.length) return;
  const job = state.queue.shift();
  if (job.signal?.aborted) {
    job.reject(toAbortError());
    drain(state);
    return;
  }
  state.busy = true;
  state.pending.set(job.id, job);
  try {
    state.child.stdin.write(`${JSON.stringify(job.request)}\n`);
  } catch (error) {
    state.pending.delete(job.id);
    state.busy = false;
    job.reject(error);
  }
}

async function ensureWorker(install, { signal } = {}) {
  if (worker?.ready) return worker;
  if (!worker) {
    const state = spawnWorker(install);
    worker = state;
    state.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const detail = state.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 200);
        killWorker(`โหลดโมเดลเสียงพากย์นานเกินไป${detail ? `: ${detail}` : ""}`);
        reject(new Error("โหลดโมเดลเสียงพากย์ในเครื่องนานเกินไป"));
      }, START_TIMEOUT_MS);
      state.onReady = (error) => {
        clearTimeout(timer);
        if (error) {
          killWorker(error.message);
          reject(error);
        } else {
          resolve(state);
        }
      };
    });
  }
  throwIfAborted(signal);
  return worker.readyPromise;
}

/**
 * สังเคราะห์หนึ่งท่อน
 *
 * ส่งทีละคำขอเสมอ (ไม่ขนานกัน) เพราะทั้งหมดใช้ GPU ตัวเดียวกัน ยิงพร้อมกันไม่ได้เร็วขึ้น
 * มีแต่จะแย่ง VRAM กันเอง
 */
export async function jaittsTts({ text, refWav, refText, speed = 1, signal, timeoutMs }, outFile) {
  throwIfAborted(signal);
  const install = discoverJaitts();
  if (!install.ready) {
    const error = new Error(install.reason);
    error.code = "JAITTS_NOT_INSTALLED";
    throw error;
  }
  if (!refWav || !fs.existsSync(refWav)) {
    throw new Error("เสียงต้นแบบของเสียงโคลนหายไป — เลือกเสียงใหม่หรืออัดใหม่อีกครั้ง");
  }
  if (!refText?.trim()) {
    throw new Error("เสียงโคลนนี้ยังไม่มีข้อความของเสียงต้นแบบ");
  }

  const state = await ensureWorker(install, { signal });
  const id = state.nextId++;

  return new Promise((resolve, reject) => {
    const job = {
      id,
      signal,
      request: {
        id,
        text,
        ref_wav: path.resolve(refWav),
        ref_text: refText,
        out: path.resolve(outFile),
        speed,
      },
    };

    const timer = setTimeout(() => {
      state.pending.delete(id);
      // ค้างหนึ่งงานแปลว่า worker น่าจะค้างทั้งตัว เริ่มใหม่ปลอดภัยกว่าปล่อยไว้
      killWorker("สังเคราะห์เสียงนานเกินกำหนด");
      reject(new Error("สังเคราะห์เสียงในเครื่องนานเกินกำหนด"));
    }, timeoutMs ?? REQUEST_TIMEOUT_MS);

    const onAbort = () => {
      state.pending.delete(id);
      clearTimeout(timer);
      // ตัดกลางคันไม่ได้ งานที่ส่งไปแล้วต้องปล่อยให้จบเอง แต่ผู้เรียกไม่ต้องรอ
      reject(toAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const done = (fn) => (value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    job.resolve = done(resolve);
    job.reject = done(reject);

    state.queue.push(job);
    drain(state);
  });
}
