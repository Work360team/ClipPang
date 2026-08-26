// whisper-setup — ติดตั้ง whisper.cpp ครั้งแรกให้อัตโนมัติ แบบเดียวกับ FFmpeg
//
// whisper.cpp ใช้หาว่าแต่ละท่อนของสคริปต์อยู่ช่วงเวลาไหน ตอนที่เรายิง TTS รวดเดียว
// ทั้งคลิป (ดู pipeline/tts-align.mjs) ถ้าไม่มีตัวนี้ ระบบยังทำงานได้แต่จะถอยไปยิง
// ทีละท่อน ซึ่งกินโควตา Gemini มากกว่าราว 15 เท่า
//
// ต่างจาก FFmpeg สองอย่าง:
//   1. ต้องเก็บทั้งโฟลเดอร์ ไม่ใช่ไฟล์เดียว เพราะไบนารีต้องใช้ DLL ข้าง ๆ มัน
//   2. มีไฟล์โมเดลอีกก้อนที่ต้องโหลดแยก และใหญ่กว่าไบนารีมาก
//
// เลือกไบนารีตามเครื่อง: มีการ์ด NVIDIA ใช้ตัว CUDA (เร็วกว่ามาก แต่ไฟล์ใหญ่)
// ไม่มีก็ใช้ตัว CPU ที่เล็กกว่า 30 เท่า จะได้ไม่บังคับให้คนโหลดของที่ใช้ไม่ได้

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { SecurityError } from "./security.mjs";
import { ensureDirectories, paths } from "./config.mjs";

// ตรึงรุ่นไว้เพื่อให้ทุกเครื่องได้ของชุดเดียวกัน — ถ้าจะอัปเกรดให้แก้ที่นี่ที่เดียว
// แล้วทดสอบกับเสียงไทยจริงก่อน เพราะรุ่นใหม่เคยเปลี่ยนรูปแบบ JSON ที่เราอ่าน
const RELEASE = "b4938";
const MODEL_NAME = "ggml-large-v3.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;

const INSTALL_DIRNAME = "whisper";
const MAX_BINARY_BYTES = 1024 * 1024 * 1024;
const MAX_MODEL_BYTES = 4 * 1024 * 1024 * 1024;
const VERIFY_TIMEOUT_MS = 30_000;

export let whisperCliPath = null;
export let whisperModelPath = null;

/**
 * เครื่องนี้มีการ์ด NVIDIA ไหม
 *
 * ใช้ nvidia-smi เป็นตัวชี้ขาดเพราะมันมาพร้อมไดรเวอร์เสมอ ถ้าเรียกไม่ได้แปลว่า
 * ไม่มีไดรเวอร์ ซึ่งเท่ากับใช้ตัว CUDA ไม่ได้อยู่ดี
 */
export function hasNvidiaGpu(options = {}) {
  const { platform = process.platform } = options;
  if (typeof options.probe === "function") return options.probe();
  const command = platform === "win32" ? "nvidia-smi.exe" : "nvidia-smi";
  try {
    const result = spawnSync(command, ["--query-gpu=name", "--format=csv,noheader"], {
      encoding: "utf8", timeout: 8_000, windowsHide: true,
    });
    return result.status === 0 && String(result.stdout || "").trim().length > 0;
  } catch {
    return false;
  }
}

/** ชื่อไฟล์ปฏิบัติการตามระบบ */
function cliName(platform) {
  return platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

/**
 * เลือกไฟล์ติดตั้งตามเครื่อง
 *
 * macOS ยังไม่มีไบนารีสำเร็จรูปแบบ CLI ใน release (มีแต่ xcframework สำหรับนักพัฒนา)
 * จึงบอกให้ติดตั้งเองผ่าน brew แทนที่จะดาวน์โหลดของที่ใช้ไม่ได้มาให้
 */
export function getWhisperBinarySpec(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const gpu = options.gpu ?? (platform === "win32" && hasNvidiaGpu({ platform }));
  const base = `https://github.com/ggml-org/whisper.cpp/releases/download/${RELEASE}`;

  if (platform === "win32" && arch === "x64") {
    const filename = gpu ? "whisper-cublas-12.4.0-bin-x64.zip" : "whisper-blas-bin-x64.zip";
    return {
      platform, arch, gpu, archive: "zip", filename,
      url: `${base}/${filename}`,
      provider: "github.com/ggml-org/whisper.cpp",
      approxBytes: gpu ? 671_000_000 : 21_200_000,
    };
  }
  if (platform === "linux" && ["x64", "arm64"].includes(arch)) {
    const filename = `whisper-bin-ubuntu-${arch === "x64" ? "x64" : "arm64"}.tar.gz`;
    return {
      platform, arch, gpu: false, archive: "tar.gz", filename,
      url: `${base}/${filename}`,
      provider: "github.com/ggml-org/whisper.cpp",
      approxBytes: arch === "x64" ? 9_500_000 : 4_600_000,
    };
  }

  throw new SecurityError(
    platform === "darwin"
      ? "macOS ยังไม่มีตัวติดตั้ง whisper.cpp อัตโนมัติ ติดตั้งเองด้วย `brew install whisper-cpp` แล้วตั้ง WHISPER_CLI_PATH ใน .env"
      : `ยังไม่มีตัวติดตั้ง whisper.cpp อัตโนมัติสำหรับ ${platform}/${arch}`,
    { code: "UNSUPPORTED_WHISPER_PLATFORM", statusCode: 422 },
  );
}

export function getWhisperModelSpec() {
  return {
    filename: MODEL_NAME,
    url: MODEL_URL,
    provider: "huggingface.co/ggerganov/whisper.cpp",
    approxBytes: 3_095_000_000,
  };
}

function installRoot(appPaths) {
  return path.join(appPaths.bin, INSTALL_DIRNAME);
}

function activate(cli, model, environment) {
  whisperCliPath = cli;
  whisperModelPath = model;
  if (environment && typeof environment === "object") {
    try {
      environment.WHISPER_CLI_PATH = cli;
      environment.WHISPER_MODEL_PATH = model;
    } catch {
      // environment ที่ถูก freeze ในเทสต์ ไม่ควรทำให้การค้นหาล้ม
    }
  }
}

function runCli(command, args, timeoutMs = VERIFY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve({ code: -1, out: "", err: String(error?.message ?? error) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (chunk) => { if (out.length < 65_536) out += chunk; });
    child.stderr?.on("data", (chunk) => { if (err.length < 65_536) err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, out, err: String(error.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

/**
 * หาว่าติดตั้งไว้แล้วหรือยัง — ดูใน data/bin ก่อน แล้วค่อยดูค่าที่ตั้งมาจาก .env
 *
 * ยอมให้ตั้งเองผ่าน WHISPER_CLI_PATH ได้ เพื่อให้คนที่ build เองหรือใช้ brew
 * ชี้มาที่ไบนารีของตัวเองได้โดยไม่ต้องให้เราดาวน์โหลดซ้ำ
 */
export async function discoverWhisper(options = {}) {
  const {
    appPaths = paths,
    environment = process.env,
    platform = process.platform,
  } = options;

  const candidates = [];
  const local = path.join(installRoot(appPaths), cliName(platform));
  candidates.push({ cli: local, source: "data/bin" });
  if (environment.WHISPER_CLI_PATH) {
    candidates.push({ cli: environment.WHISPER_CLI_PATH, source: ".env" });
  }

  const modelCandidates = [
    path.join(installRoot(appPaths), "models", MODEL_NAME),
    environment.WHISPER_MODEL_PATH || "",
  ].filter(Boolean);

  const model = modelCandidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;

  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate.cli).isFile()) continue;
    } catch {
      continue;
    }
    if (!model) {
      return { ready: false, found: true, cli: candidate.cli, model: null, source: candidate.source, reason: "มีโปรแกรมแล้วแต่ยังไม่มีไฟล์โมเดล" };
    }
    const probe = await runCli(candidate.cli, ["--help"]);
    // --help คืนรหัสไม่เป็นศูนย์ในบางรุ่น จึงดูจากข้อความที่พิมพ์ออกมาเป็นหลัก
    const usable = /whisper|usage/i.test(`${probe.out}${probe.err}`);
    if (!usable) continue;
    activate(candidate.cli, model, environment);
    return { ready: true, found: true, cli: candidate.cli, model, source: candidate.source, release: RELEASE };
  }

  whisperCliPath = null;
  whisperModelPath = null;
  return {
    ready: false,
    found: false,
    cli: null,
    model,
    source: null,
    reason: "ยังไม่ได้ติดตั้ง whisper.cpp",
  };
}

function report(callback, update) {
  if (typeof callback !== "function") return;
  try { callback(Object.freeze({ ...update })); } catch { /* ผู้ฟังหลุดไปแล้ว ไม่ใช่เรื่องผิดปกติ */ }
}

/** ดาวน์โหลดไฟล์เดียวพร้อมรายงานความคืบหน้า — ใช้ทั้งกับไบนารีและโมเดล */
async function downloadTo(url, destination, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    signal,
    maxBytes,
    onProgress,
    label = "ไฟล์",
  } = options;

  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new SecurityError(`อนุญาตให้ดาวน์โหลด${label}ผ่าน HTTPS เท่านั้น`, {
      code: "INSECURE_DOWNLOAD_URL", statusCode: 403,
    });
  }

  const response = await fetchImpl(target, { redirect: "follow", signal });
  if (!response.ok || !response.body) throw new Error(`ดาวน์โหลด${label}ไม่สำเร็จ (HTTP ${response.status})`);
  if (response.url && new URL(response.url).protocol !== "https:") {
    throw new SecurityError(`ปลายทางดาวน์โหลด${label}ไม่ได้ใช้ HTTPS`, {
      code: "INSECURE_DOWNLOAD_REDIRECT", statusCode: 403,
    });
  }

  const announced = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body.cancel();
    throw new Error(`${label}มีขนาดใหญ่ผิดปกติ`);
  }

  const handle = await fs.promises.open(destination, "w", 0o600);
  let received = 0;
  let lastPercent = -1;
  try {
    const reader = response.body.getReader();
    while (true) {
      if (signal?.aborted) {
        const error = new Error("ยกเลิกการทำงานแล้ว");
        error.name = "AbortError";
        throw error;
      }
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error(`${label}มีขนาดใหญ่ผิดปกติ`);
      }
      await handle.write(Buffer.from(value));
      const percent = Number.isFinite(announced) && announced > 0
        ? Math.min(100, Math.floor((received / announced) * 100))
        : null;
      if (percent !== lastPercent) {
        lastPercent = percent;
        report(onProgress, { phase: "downloading", label, receivedBytes: received, totalBytes: Number.isFinite(announced) ? announced : null, percent });
      }
    }
  } catch (error) {
    await handle.close();
    await fs.promises.rm(destination, { force: true });
    throw error;
  }
  await handle.close();
  return { path: destination, receivedBytes: received };
}

async function extract(archivePath, outputDirectory, spec, options = {}) {
  if (typeof options.extractor === "function") {
    await options.extractor({ archivePath, outputDirectory, spec, signal: options.signal });
    return;
  }
  const commands = spec.archive === "tar.gz"
    ? [["tar", ["-xzf", archivePath, "-C", outputDirectory]]]
    : [
      ["tar.exe", ["-xf", archivePath, "-C", outputDirectory]],
      ["tar", ["-xf", archivePath, "-C", outputDirectory]],
      ["unzip", ["-q", archivePath, "-d", outputDirectory]],
    ];

  let lastError = null;
  for (const [command, args] of commands) {
    const result = await runCli(command, args, 300_000);
    if (result.code === 0) return;
    lastError = new Error(`แตกไฟล์ whisper.cpp ไม่สำเร็จ: ${String(result.err).slice(0, 200)}`);
  }
  throw lastError ?? new Error("ไม่พบเครื่องมือสำหรับแตกไฟล์ whisper.cpp");
}

/** หาไฟล์ตามชื่อในโฟลเดอร์ที่แตกไว้ */
async function findFile(root, wanted) {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0 && visited < 10_000) {
    const directory = pending.shift();
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return full;
      if (entry.isDirectory()) pending.push(full);
    }
  }
  return null;
}

/**
 * ติดตั้ง whisper.cpp ให้พร้อมใช้ — โหลดไบนารีและโมเดล แล้วตรวจว่าเรียกได้จริง
 *
 * แยกสองขั้นตอนชัดเจนเพราะโมเดลใหญ่กว่าไบนารีหลายเท่า ถ้าโหลดโมเดลค้างกลางคัน
 * ผู้ใช้จะได้เห็นว่าติดตรงไหน ไม่ใช่แค่แถบค้างอยู่เฉย ๆ
 */
export async function installWhisper(options = {}) {
  const {
    appPaths = paths,
    environment = process.env,
    platform = process.platform,
    arch = process.arch,
    fetchImpl = globalThis.fetch,
    onProgress,
    signal,
    extractor,
  } = options;

  ensureDirectories(appPaths);
  report(onProgress, { phase: "checking", percent: 0, message: "ตรวจว่าติดตั้งไว้แล้วหรือยัง" });
  const existing = await discoverWhisper({ appPaths, environment, platform });
  if (existing.ready) {
    report(onProgress, { phase: "ready", percent: 100, message: "ติดตั้ง whisper.cpp ไว้แล้ว" });
    return existing;
  }

  const spec = options.spec ?? getWhisperBinarySpec({ platform, arch, gpu: options.gpu });
  const modelSpec = getWhisperModelSpec();
  const root = installRoot(appPaths);
  const modelsDir = path.join(root, "models");
  const staging = await fs.promises.mkdtemp(path.join(appPaths.bin, ".whisper-install-"));

  try {
    // ---- ไบนารี ----
    const needsBinary = !existing.found;
    if (needsBinary) {
      const archivePath = path.join(staging, spec.filename);
      const extractDir = path.join(staging, "extracted");
      await fs.promises.mkdir(extractDir, { recursive: true });

      await downloadTo(spec.url, archivePath, {
        fetchImpl, signal, maxBytes: MAX_BINARY_BYTES, label: "โปรแกรม whisper.cpp",
        onProgress: (event) => report(onProgress, {
          ...event,
          step: "binary",
          message: `กำลังโหลดโปรแกรม whisper.cpp${spec.gpu ? " (รุ่นใช้การ์ดจอ)" : ""}`,
          percent: event.percent == null ? null : Math.round(event.percent * 0.15),
        }),
      });

      report(onProgress, { phase: "extracting", percent: 16, step: "binary", message: "กำลังแตกไฟล์โปรแกรม" });
      await extract(archivePath, extractDir, spec, { signal, extractor });

      const extractedCli = await findFile(extractDir, cliName(platform).toLowerCase());
      if (!extractedCli) throw new Error("ไฟล์ที่โหลดมาไม่มี whisper-cli ตามที่คาดไว้");

      // ต้องยกมาทั้งโฟลเดอร์ ไบนารีเรียกใช้ DLL ที่วางอยู่ข้าง ๆ มัน
      await fs.promises.rm(root, { recursive: true, force: true });
      await fs.promises.mkdir(path.dirname(root), { recursive: true });
      await fs.promises.cp(path.dirname(extractedCli), root, { recursive: true });
      if (platform !== "win32") {
        await fs.promises.chmod(path.join(root, cliName(platform)), 0o755).catch(() => {});
      }
    }

    // ---- โมเดล ----
    await fs.promises.mkdir(modelsDir, { recursive: true });
    const modelPath = path.join(modelsDir, modelSpec.filename);
    let haveModel = false;
    try { haveModel = (await fs.promises.stat(modelPath)).size > 1_000_000; } catch { /* ยังไม่มี */ }

    if (!haveModel) {
      const partial = `${modelPath}.part`;
      await downloadTo(modelSpec.url, partial, {
        fetchImpl, signal, maxBytes: MAX_MODEL_BYTES, label: "โมเดลถอดเสียง",
        onProgress: (event) => report(onProgress, {
          ...event,
          step: "model",
          message: "กำลังโหลดโมเดลถอดเสียง (ไฟล์ใหญ่ ~3 GB ใช้เวลาสักครู่)",
          percent: event.percent == null ? null : 20 + Math.round(event.percent * 0.75),
        }),
      });
      await fs.promises.rename(partial, modelPath);
    }

    report(onProgress, { phase: "verifying", percent: 97, message: "ตรวจว่าเรียกใช้ได้จริง" });
    const verified = await discoverWhisper({ appPaths, environment, platform });
    if (!verified.ready) throw new Error(verified.reason || "ตรวจ whisper.cpp หลังติดตั้งไม่ผ่าน");

    report(onProgress, { phase: "ready", percent: 100, message: "ติดตั้ง whisper.cpp เรียบร้อย" });
    return verified;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const safe = new Error(
      `ติดตั้ง whisper.cpp ไม่สำเร็จ (${error.message}) — ระบบยังใช้งานได้ตามปกติ เพียงแต่จะยิงเสียงทีละท่อนซึ่งกินโควตามากกว่า`,
    );
    safe.code = error?.code || "WHISPER_INSTALL_FAILED";
    safe.cause = error;
    throw safe;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

/** สถานะสำหรับหน้าตั้งค่า */
export async function getWhisperStatus(options = {}) {
  const found = await discoverWhisper(options);
  let spec = null;
  try {
    spec = getWhisperBinarySpec(options);
  } catch {
    // แพลตฟอร์มที่ยังไม่รองรับ — ปล่อยให้ spec เป็น null แล้วบอกผู้ใช้ตามเหตุผลด้านล่าง
  }
  return {
    ready: found.ready,
    source: found.source,
    release: RELEASE,
    gpu: spec?.gpu ?? false,
    supported: Boolean(spec),
    approxBytes: spec ? spec.approxBytes + getWhisperModelSpec().approxBytes : null,
    reason: found.ready ? null : (found.reason ?? "ยังไม่ได้ติดตั้ง whisper.cpp"),
  };
}
