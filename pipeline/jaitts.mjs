// jaitts — เสียงพากย์ไทยที่รันในเครื่อง (JaiTTS / F5-TTS) แบบโคลนเสียงจากตัวอย่างสั้น ๆ
//
// ตัวนี้คุม worker ฝั่ง Python ที่โหลดโมเดลค้างไว้ตัวเดียว แล้วส่งงานเข้าไปทีละท่อน
// เหตุผลอยู่ในหัวไฟล์ jaitts-worker.py — เรียกสคริปต์ของต้นทางตรง ๆ จะเสียเวลา
// โหลดโมเดลใหม่ทุกท่อน (วัดได้ 40.7 วินาที/ครั้ง เทียบกับเวลาสังเคราะห์จริง ~4 วินาที)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { throwIfAborted, toAbortError } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKER = path.join(HERE, "jaitts-worker.py");

/** โหลดโมเดลรอบแรกอาจต้องดาวน์โหลดไฟล์ราว 1.3 GB ก่อน จึงให้เวลามากกว่ารอบที่ cache แล้ว */
const DEFAULT_START_TIMEOUT_MS = 600_000;
const PYTHON_PROBE_TIMEOUT_MS = 8_000;
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

const pythonProbeCache = new Map();

function compactDetail(value, maxLength = 300) {
  return String(value || "").trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ").slice(0, maxLength);
}

function pythonRepairHint() {
  return "รัน uv python install 3.11 แล้วเปิด Clip360 ใหม่ หรือกดติดตั้ง JaiTTS ใหม่ในหน้าตั้งค่า";
}

function probeJaittsPython(python) {
  let stat;
  try {
    stat = fs.statSync(python);
  } catch (error) {
    return {
      ready: false,
      code: "JAITTS_PYTHON_BROKEN",
      reason: `อ่าน Python ของ JaiTTS ไม่ได้: ${compactDetail(error?.message || error)} — ${pythonRepairHint()}`,
      checkedAt: Date.now(),
    };
  }
  const cacheKey = `${python}:${stat.size}:${stat.mtimeMs}`;
  const cached = pythonProbeCache.get(cacheKey);
  const cacheMs = cached?.ready ? 30_000 : 2_000;
  if (cached && Date.now() - cached.checkedAt < cacheMs) return cached;

  let probe;
  try {
    probe = spawnSync(python, ["-c", "import sys; print(sys.version_info[:2])"], {
      encoding: "utf8",
      timeout: PYTHON_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    const result = {
      ready: false,
      code: "JAITTS_PYTHON_BROKEN",
      reason: `Python ของ JaiTTS เปิดไม่ได้: ${compactDetail(error?.message || error)} — ${pythonRepairHint()}`,
      checkedAt: Date.now(),
    };
    pythonProbeCache.set(cacheKey, result);
    return result;
  }

  if (probe.error || probe.status !== 0) {
    const timedOut = probe.error?.code === "ETIMEDOUT";
    const detail = compactDetail(probe.stderr || probe.stdout || probe.error?.message);
    const result = {
      ready: false,
      code: "JAITTS_PYTHON_BROKEN",
      reason: timedOut
        ? `Python ของ JaiTTS ไม่ตอบสนองภายใน ${Math.round(PYTHON_PROBE_TIMEOUT_MS / 1000)} วินาที — ${pythonRepairHint()}`
        : `Python ของ JaiTTS เปิดไม่ได้${detail ? `: ${detail}` : ""} — ${pythonRepairHint()}`,
      checkedAt: Date.now(),
    };
    pythonProbeCache.set(cacheKey, result);
    return result;
  }

  const result = { ready: true, code: null, reason: null, checkedAt: Date.now() };
  pythonProbeCache.set(cacheKey, result);
  return result;
}

function startTimeoutMs() {
  const configured = Number(process.env.JAITTS_START_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : DEFAULT_START_TIMEOUT_MS;
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
  const pythonProbe = probeJaittsPython(python);
  if (!pythonProbe.ready) {
    return { ready: false, home, python, reason: pythonProbe.reason, code: pythonProbe.code };
  }
  return { ready: true, home, python, reason: null, code: null };
}

let worker = null;

function workerError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function settleStartup(state, error = null) {
  if (!state || state.startupSettled) return;
  state.startupSettled = true;
  if (state.startupTimer) clearTimeout(state.startupTimer);
  if (error) state.rejectReady(error);
  else state.resolveReady(state);
}

function killWorker(reason) {
  if (!worker) return;
  const current = worker;
  worker = null;
  const error = reason instanceof Error ? reason : new Error(reason);
  settleStartup(current, error);
  for (const pending of current.pending.values()) pending.reject(error);
  current.pending.clear();
  for (const queued of current.queue) queued.reject(error);
  current.queue.length = 0;
  try {
    current.child.stdin.end();
  } catch {
    // ปิด stdin ไม่ได้แปลว่าโปรเซสตายไปแล้ว ไม่ต้องทำอะไรต่อ
  }
  if (current.child.exitCode === null && current.child.signalCode === null) current.child.kill();
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
    startupSettled: false,
    startupTimer: null,
    resolveReady: null,
    rejectReady: null,
  };
  state.readyPromise = new Promise((resolve, reject) => {
    state.resolveReady = resolve;
    state.rejectReady = reject;
  });
  const startupTimeoutMs = startTimeoutMs();
  state.startupTimer = setTimeout(() => {
    const detail = compactDetail(state.stderr, 200);
    const error = workerError(
      `โหลดโมเดลเสียงพากย์ในเครื่องนานเกิน ${Math.round(startupTimeoutMs / 1000)} วินาที${detail ? `: ${detail}` : ""}`,
      "JAITTS_START_TIMEOUT",
    );
    settleStartup(state, error);
    if (worker === state) killWorker(error);
  }, startupTimeoutMs);

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

  child.on("exit", (code, signal) => {
    const detail = compactDetail(state.stderr);
    const phase = state.ready ? "หยุดทำงาน" : "หยุดทำงานก่อนพร้อม";
    const error = workerError(
      `เสียงพากย์ในเครื่อง${phase} (${signal ? `signal ${signal}` : `code ${code}`})${detail ? `: ${detail}` : ""}`,
      "JAITTS_WORKER_EXITED",
    );
    settleStartup(state, error);
    if (worker === state) killWorker(error);
  });

  child.on("error", (error) => {
    const wrapped = workerError(`เรียก Python ของ JaiTTS ไม่ได้: ${error.message}`, "JAITTS_WORKER_SPAWN_FAILED", error);
    settleStartup(state, wrapped);
    if (worker === state) killWorker(wrapped);
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
    settleStartup(state);
    return;
  }
  if (message.ready === false) {
    const error = workerError(message.error || "โหลดโมเดล JaiTTS ไม่สำเร็จ", "JAITTS_MODEL_LOAD_FAILED");
    settleStartup(state, error);
    if (worker === state) killWorker(error);
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

function abortJob(state, job, error, deadline) {
  const queuedIndex = state.queue.indexOf(job);
  if (queuedIndex >= 0) {
    state.queue.splice(queuedIndex, 1);
    job.reject(error);
    return "queued";
  }
  if (state.pending.get(job.id) === job) {
    // ผู้เรียกไม่ต้องรอ แต่ยังเก็บ job ไว้เพื่อรับคำตอบจาก Python แล้วปลด busy/drain คิว
    // ถ้า Python ไม่ตอบภายใน deadline เดิม watchdog จะทิ้ง worker แล้วเริ่มใหม่รอบหน้า
    job.reject(error);
    job.workerWatchdog = setTimeout(() => {
      if (state.pending.get(job.id) !== job || worker !== state) return;
      killWorker(workerError("ยกเลิกแล้วแต่เสียงพากย์ในเครื่องไม่ยอมหยุด", "JAITTS_ABORT_TIMEOUT"));
    }, Math.max(1, deadline - Date.now()));
    return "active";
  }
  job.reject(error);
  return "settled";
}

// เปิดเฉพาะ state machine เล็ก ๆ ให้ regression test จำลอง worker ได้โดยไม่ต้องโหลดโมเดล 1.3 GB
export const __jaittsTesting = Object.freeze({ abortJob, handleLine });

async function ensureWorker(install, { signal } = {}) {
  if (worker?.ready) return worker;
  if (!worker) {
    worker = spawnWorker(install);
  }
  throwIfAborted(signal);
  if (!signal) return worker.readyPromise;
  const current = worker;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(toAbortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    current.readyPromise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
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
    error.code = install.code || "JAITTS_NOT_INSTALLED";
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
    const requestTimeoutMs = Number(timeoutMs ?? REQUEST_TIMEOUT_MS);
    const deadline = Date.now() + requestTimeoutMs;
    const job = {
      id,
      signal,
      workerWatchdog: null,
      request: {
        id,
        text,
        ref_wav: path.resolve(refWav),
        ref_text: refText,
        out: path.resolve(outFile),
        speed,
      },
    };

    let timer = null;
    function onAbort() {
      abortJob(state, job, toAbortError(signal?.reason), deadline);
    }

    const done = (fn) => (value) => {
      if (timer) clearTimeout(timer);
      if (job.workerWatchdog) clearTimeout(job.workerWatchdog);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    job.resolve = done(resolve);
    job.reject = done(reject);

    timer = setTimeout(() => {
      // ค้างหนึ่งงานแปลว่า worker น่าจะค้างทั้งตัว เริ่มใหม่ปลอดภัยกว่าปล่อยไว้
      const error = workerError("สังเคราะห์เสียงในเครื่องนานเกินกำหนด", "JAITTS_REQUEST_TIMEOUT");
      if (worker === state) killWorker(error);
      else job.reject(error);
    }, requestTimeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    state.queue.push(job);
    drain(state);
  });
}
