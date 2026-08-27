// jaitts-setup — ติดตั้งเสียงพากย์ไทยที่รันในเครื่อง (JaiTTS / F5-TTS) ให้อัตโนมัติ
//
// ต่างจาก whisper.cpp ตรงที่ไม่ใช่ไบนารีสำเร็จรูป แต่เป็นโปรเจกต์ Python ที่ต้อง
// สร้างสภาพแวดล้อมของตัวเอง ขั้นตอนจึงยาวกว่า และมีสามจุดที่ README ของต้นทาง
// ไม่ได้บอกไว้แต่พังจริงบนเครื่อง Windows:
//
//   1. torch จาก PyPI บน Windows เป็นรุ่น CPU ต้องดึงจาก index ของ PyTorch เอง
//      และการ์ด Blackwell (RTX 50xx) ต้องใช้ cu128 ขึ้นไป ไม่งั้นเจอ
//      "no kernel image is available"
//   2. torchaudio โยนงานอ่านไฟล์ให้ torchcodec ซึ่งต้องการ FFmpeg แบบ shared
//      แต่ FFmpeg บน Windows ส่วนใหญ่เป็น static build ที่ไม่มี DLL เลย
//   3. ไลบรารีพิมพ์ข้อความไทยออก stdout ซึ่งล้มทันทีถ้า encoding เป็น cp1252
//      (ข้อนี้จัดการที่ตอนเรียก worker ใน pipeline/jaitts.mjs แล้ว)
//
// ตัวติดตั้งนี้จัดการข้อ 1 และ 2 ให้ เพราะเป็นจุดที่ผู้ใช้ทั่วไปเจอแล้วไปต่อไม่ถูก
import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.mjs";
import { downloadTo, extractArchive, findDirectory, report, runCli } from "./installer-lib.mjs";
import { hasNvidiaGpu } from "./whisper-setup.mjs";

/**
 * ตรึงรุ่นไว้ทั้งหมด เพื่อให้ทุกเครื่องได้ของชุดเดียวกัน
 *
 * JaiTTS-Easy เป็นโปรเจกต์ที่ชุมชนประกอบขึ้น ไม่ใช่ของทีม JTS โดยตรง และเพิ่งสร้าง
 * เมื่อ ส.ค. 2569 การชี้ไปที่ main ตรง ๆ แปลว่าเครื่องที่ติดตั้งคนละวันอาจได้คนละของ
 */
const REPO_COMMIT = "c95d6594580d981470ddd278b4e887508cb13a87";
const REPO_ZIP = `https://codeload.github.com/aiunlocked1412/JaiTTS-Easy/zip/${REPO_COMMIT}`;
const UV_VERSION = "0.12.6";
/** FFmpeg แบบ shared สำหรับ torchcodec — LGPL build ของ BtbN มี DLL ครบ */
const FFMPEG_SHARED_ZIP = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip";

const INSTALL_DIRNAME = "jaitts";
const MAX_REPO_BYTES = 64 * 1024 * 1024;
const MAX_UV_BYTES = 64 * 1024 * 1024;
const MAX_FFMPEG_BYTES = 256 * 1024 * 1024;
const PIP_TIMEOUT_MS = 45 * 60_000;
const VENV_TIMEOUT_MS = 10 * 60_000;

export function jaittsInstallRoot(appPaths = paths) {
  return path.join(appPaths.bin, INSTALL_DIRNAME);
}

function venvPython(home) {
  return process.platform === "win32"
    ? path.join(home, ".venv-tts", "Scripts", "python.exe")
    : path.join(home, ".venv-tts", "bin", "python");
}

/**
 * ติดตั้งได้อัตโนมัติเฉพาะเครื่องที่มีล้อ torch ให้โหลด
 *
 * บอกเหตุผลกลับไปด้วย เพราะ "ยังไม่ได้ติดตั้ง" กับ "เครื่องนี้ติดตั้งอัตโนมัติไม่ได้"
 * ต้องแสดงผลคนละแบบ — อย่างหลังต้องบอกทางไปติดตั้งเอง ไม่ใช่ให้กดปุ่มซ้ำ
 */
export function jaittsSupported(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform === "win32" && arch === "x64") return { supported: true, reason: null };
  if (platform === "linux" && arch === "x64") return { supported: true, reason: null };
  if (platform === "darwin") return { supported: true, reason: null };
  return {
    supported: false,
    reason: `ยังไม่มีตัวติดตั้งอัตโนมัติสำหรับ ${platform}/${arch} — ติดตั้งเองแล้วตั้ง JAITTS_HOME ใน .env ได้`,
  };
}

/** สถานะสำหรับหน้าตั้งค่า — แยก "ยังไม่ติดตั้ง" ออกจาก "ติดตั้งแล้วแต่ยังไม่ครบ" */
export function getJaittsStatus(options = {}) {
  const home = options.home ?? (process.env.JAITTS_HOME?.trim()
    ? path.resolve(process.env.JAITTS_HOME.trim())
    : jaittsInstallRoot());
  const support = jaittsSupported(options);
  const hasRepo = fs.existsSync(path.join(home, "jaitts_synth.py"));
  const hasPython = fs.existsSync(venvPython(home));
  return {
    home,
    supported: support.supported,
    installed: hasRepo && hasPython,
    reason: support.supported
      ? (hasRepo && hasPython ? null : hasRepo ? "ติดตั้งไว้บางส่วน — ยังไม่มีสภาพแวดล้อม Python" : "ยังไม่ได้ติดตั้ง")
      : support.reason,
    gpu: options.gpu ?? hasNvidiaGpu(options),
    // ประมาณจากการติดตั้งจริงบนเครื่องทดสอบ: venv 5.4 GB + โมเดล 1.3 GB
    approxBytes: 7 * 1024 * 1024 * 1024,
  };
}

/** หา uv ที่ใช้ได้ — ของที่ผู้ใช้มีอยู่แล้วก่อน ไม่มีค่อยโหลดตัวพกพามาไว้ใน data/bin */
async function ensureUv({ appPaths, signal, onProgress }) {
  const existing = await runCli("uv", ["--version"], 15_000);
  if (existing.code === 0) return "uv";

  const localDir = path.join(appPaths.bin, "uv");
  const localUv = path.join(localDir, process.platform === "win32" ? "uv.exe" : "uv");
  if (fs.existsSync(localUv)) return localUv;

  report(onProgress, { phase: "downloading", percent: 3, step: "uv", message: "กำลังดาวน์โหลดตัวจัดการ Python (uv)" });
  const asset = process.platform === "win32"
    ? "uv-x86_64-pc-windows-msvc.zip"
    : process.platform === "darwin"
      ? "uv-aarch64-apple-darwin.tar.gz"
      : "uv-x86_64-unknown-linux-gnu.tar.gz";
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`;

  fs.mkdirSync(localDir, { recursive: true });
  const archive = path.join(localDir, asset);
  await downloadTo(url, archive, { signal, maxBytes: MAX_UV_BYTES, label: " uv" });
  await extractArchive(archive, localDir, {
    signal,
    archive: asset.endsWith(".zip") ? "zip" : "tar.gz",
    label: " uv",
  });
  fs.rmSync(archive, { force: true });

  if (fs.existsSync(localUv)) return localUv;
  // บางรุ่นห่อไว้ในโฟลเดอร์ชั้นเดียว
  const nested = await findDirectory(localDir, asset.replace(/\.(zip|tar\.gz)$/, "").toLowerCase());
  const nestedUv = nested ? path.join(nested, path.basename(localUv)) : null;
  if (nestedUv && fs.existsSync(nestedUv)) return nestedUv;
  throw new Error("แตกไฟล์ uv แล้วแต่ไม่เจอตัวโปรแกรม");
}

/**
 * ก๊อป DLL ของ FFmpeg แบบ shared ไปไว้ข้าง torchcodec
 *
 * ctypes โหลด DLL ด้วย LOAD_WITH_ALTERED_SEARCH_PATH ซึ่งค้นโฟลเดอร์ของตัว DLL เอง
 * การวางไว้ตรงนั้นจึงพอ ไม่ต้องไปแก้ PATH ของระบบซึ่งกระทบโปรแกรมอื่นทั้งเครื่อง
 */
async function fixTorchcodec({ home, signal, onProgress }) {
  if (process.platform !== "win32") return { applied: false, reason: "เฉพาะ Windows" };
  const sitePackages = path.join(home, ".venv-tts", "Lib", "site-packages", "torchcodec");
  if (!fs.existsSync(sitePackages)) return { applied: false, reason: "ไม่พบ torchcodec" };
  if (fs.readdirSync(sitePackages).some((name) => name.toLowerCase().startsWith("avcodec"))) {
    return { applied: false, reason: "มี DLL อยู่แล้ว" };
  }

  report(onProgress, { phase: "downloading", percent: 88, step: "ffmpeg", message: "กำลังดาวน์โหลด FFmpeg สำหรับอ่านไฟล์เสียง" });
  const workDir = fs.mkdtempSync(path.join(paths.bin, ".ffmpeg-shared-"));
  try {
    const archive = path.join(workDir, "ffmpeg-shared.zip");
    await downloadTo(FFMPEG_SHARED_ZIP, archive, { signal, maxBytes: MAX_FFMPEG_BYTES, label: " FFmpeg" });
    await extractArchive(archive, workDir, { signal, archive: "zip", label: " FFmpeg" });
    const binDir = await findDirectory(workDir, "bin");
    if (!binDir) throw new Error("แตกไฟล์ FFmpeg แล้วแต่ไม่เจอโฟลเดอร์ bin");
    let copied = 0;
    for (const name of fs.readdirSync(binDir)) {
      if (!name.toLowerCase().endsWith(".dll")) continue;
      fs.copyFileSync(path.join(binDir, name), path.join(sitePackages, name));
      copied += 1;
    }
    if (!copied) throw new Error("ไม่เจอไฟล์ DLL ในชุด FFmpeg ที่โหลดมา");
    return { applied: true, copied };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function runStep(uv, args, { home, timeoutMs, label, onProgress, percent }) {
  report(onProgress, { phase: "installing", percent, message: label });
  const result = await runCli(uv, args, timeoutMs, { cwd: home });
  if (result.code !== 0) {
    const detail = String(result.err || result.out).trim().split("\n").slice(-3).join(" ").slice(0, 300);
    throw new Error(`${label}ไม่สำเร็จ${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

/**
 * ติดตั้งให้พร้อมใช้ — โหลดซอร์ส สร้าง venv ลง torch ที่ตรงกับการ์ดจอ แล้วตรวจว่าเรียกได้จริง
 *
 * ไม่ดาวน์โหลดโมเดลตรงนี้ เพราะ 1.3 GB นั้นถูกเก็บในแคชของ HuggingFace ที่ใช้ร่วมกัน
 * ทุกโปรเจกต์อยู่แล้ว และ worker โหลดเองได้ตอนใช้งานครั้งแรก
 */
export async function installJaitts(options = {}) {
  const { signal, onProgress, appPaths = paths } = options;
  const support = jaittsSupported(options);
  if (!support.supported) throw new Error(support.reason);

  const home = jaittsInstallRoot(appPaths);
  const status = getJaittsStatus({ ...options, home });
  if (status.installed) {
    report(onProgress, { phase: "ready", percent: 100, message: "ติดตั้งเสียงพากย์ในเครื่องไว้แล้ว" });
    return { home, alreadyInstalled: true };
  }

  fs.mkdirSync(appPaths.bin, { recursive: true });
  const uv = await ensureUv({ appPaths, signal, onProgress });

  if (!fs.existsSync(path.join(home, "jaitts_synth.py"))) {
    report(onProgress, { phase: "downloading", percent: 8, step: "repo", message: "กำลังดาวน์โหลดโปรแกรมเสียงพากย์" });
    const workDir = fs.mkdtempSync(path.join(appPaths.bin, ".jaitts-src-"));
    try {
      const archive = path.join(workDir, "jaitts.zip");
      await downloadTo(REPO_ZIP, archive, { signal, maxBytes: MAX_REPO_BYTES, label: "โปรแกรมเสียงพากย์" });
      await extractArchive(archive, workDir, { signal, archive: "zip", label: "โปรแกรมเสียงพากย์" });
      const extracted = await findDirectory(workDir, `jaitts-easy-${REPO_COMMIT}`);
      if (!extracted) throw new Error("แตกไฟล์แล้วแต่ไม่เจอโฟลเดอร์ของโปรแกรม");
      fs.mkdirSync(path.dirname(home), { recursive: true });
      fs.rmSync(home, { recursive: true, force: true });
      fs.renameSync(extracted, home);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  await runStep(uv, ["venv", "--python", "3.11", ".venv-tts"], {
    home, timeoutMs: VENV_TIMEOUT_MS, onProgress, percent: 14,
    label: "สร้างสภาพแวดล้อม Python",
  });

  // torch ต้องมาก่อน requirements เพราะ "torch==2.8.0" ใน requirements จะยอมรับ
  // "2.8.0+cu128" ที่ลงไว้แล้ว แต่ถ้าปล่อยให้ requirements ลงเองจะได้รุ่น CPU
  const gpu = options.gpu ?? hasNvidiaGpu(options);
  const torchArgs = ["pip", "install", "torch", "torchaudio"];
  if (gpu && process.platform !== "darwin") {
    torchArgs.push("--index-url", "https://download.pytorch.org/whl/cu128");
  }
  await runStep(uv, torchArgs, {
    home, timeoutMs: PIP_TIMEOUT_MS, onProgress, percent: 22,
    label: gpu ? "ติดตั้ง PyTorch รุ่นที่ใช้การ์ดจอ (ไฟล์ใหญ่ ใช้เวลาสักครู่)" : "ติดตั้ง PyTorch",
  });

  await runStep(uv, ["pip", "install", "-r", "requirements-tts.txt"], {
    home, timeoutMs: PIP_TIMEOUT_MS, onProgress, percent: 62,
    label: "ติดตั้งไลบรารีที่เหลือ",
  });

  const codec = await fixTorchcodec({ home, signal, onProgress });

  report(onProgress, { phase: "verifying", percent: 94, message: "กำลังตรวจว่าใช้งานได้จริง" });
  const python = venvPython(home);
  const check = await runCli(python, ["-c", "import torch, flowtts; print(torch.cuda.is_available())"], 180_000, {
    cwd: home,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (check.code !== 0) {
    const detail = String(check.err || check.out).trim().split("\n").slice(-2).join(" ").slice(0, 300);
    throw new Error(`ติดตั้งแล้วแต่เรียกใช้ไม่ได้${detail ? `: ${detail}` : ""}`);
  }

  report(onProgress, { phase: "ready", percent: 100, message: "เสียงพากย์ในเครื่องพร้อมใช้งานแล้ว" });
  return {
    home,
    alreadyInstalled: false,
    gpu,
    cudaAvailable: String(check.out).trim().endsWith("True"),
    torchcodec: codec,
  };
}
