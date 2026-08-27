// installer-lib — ชิ้นส่วนที่ตัวติดตั้งทุกตัวใช้ร่วมกัน (ดาวน์โหลด แตกไฟล์ เรียกคำสั่ง)
//
// แยกออกมาเพราะตอนนี้มีตัวติดตั้งมากกว่าหนึ่ง (whisper.cpp และเสียงพากย์ในเครื่อง)
// และทุกตัวต้องการเรื่องเดียวกัน: ดาวน์โหลดไฟล์ใหญ่พร้อมรายงานความคืบหน้า จำกัด
// ขนาดไม่ให้โตผิดปกติ บังคับ HTTPS และแตกไฟล์ด้วยเครื่องมือที่มีอยู่ในเครื่อง
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { SecurityError } from "./security.mjs";

const DEFAULT_CLI_TIMEOUT_MS = 30_000;

/** ส่งความคืบหน้ากลับไปให้ผู้เรียก — ผู้ฟังที่พังไม่ควรทำให้การติดตั้งล้ม */
export function report(callback, update) {
  if (typeof callback !== "function") return;
  try { callback(Object.freeze({ ...update })); } catch { /* ผู้ฟังหลุดไปแล้ว ไม่ใช่เรื่องผิดปกติ */ }
}

/** เรียกคำสั่งแล้วรอผล — ไม่โยน error เพราะผู้เรียกมักอยากอ่าน exit code เอง */
export function runCli(command, args, timeoutMs = DEFAULT_CLI_TIMEOUT_MS, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        cwd: options.cwd,
        env: options.env,
      });
    } catch (error) {
      resolve({ code: -1, out: "", err: String(error?.message ?? error) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (chunk) => { if (out.length < 65_536) out += chunk; });
    child.stderr?.on("data", (chunk) => {
      if (err.length < 65_536) err += chunk;
      report(options.onOutput, { text: String(chunk) });
    });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, out, err: String(error.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

/** ดาวน์โหลดไฟล์เดียวพร้อมรายงานความคืบหน้า — ใช้ทั้งกับไบนารีและโมเดล */
export async function downloadTo(url, destination, options = {}) {
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
        report(onProgress, {
          phase: "downloading",
          label,
          receivedBytes: received,
          totalBytes: Number.isFinite(announced) ? announced : null,
          percent,
        });
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

/**
 * แตกไฟล์บีบอัดด้วยเครื่องมือที่มีอยู่แล้วในเครื่อง
 *
 * Windows 10 ขึ้นไปมี tar.exe มาให้ ส่วน unzip เก็บไว้เป็นทางสำรองของ Linux ที่ไม่มี tar
 * ที่รองรับ zip — ไล่ลองทีละตัวแล้วรายงานตัวสุดท้ายที่ล้มถ้าไม่ผ่านสักตัว
 */
export async function extractArchive(archivePath, outputDirectory, options = {}) {
  const { archive = "zip", extractor, signal, label = "ไฟล์" } = options;
  if (typeof extractor === "function") {
    await extractor({ archivePath, outputDirectory, archive, signal });
    return;
  }
  const commands = archive === "tar.gz"
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
    lastError = new Error(`แตกไฟล์${label}ไม่สำเร็จ: ${String(result.err).slice(0, 200)}`);
  }
  throw lastError ?? new Error(`ไม่พบเครื่องมือสำหรับแตกไฟล์${label}`);
}

/** หาไฟล์ตามชื่อในโฟลเดอร์ที่แตกไว้ — ข้าม symlink กันวนไม่รู้จบ */
export async function findFile(root, wanted) {
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

/** หาโฟลเดอร์ตามชื่อ — ใช้ตอนที่ไฟล์บีบอัดห่อทุกอย่างไว้ในโฟลเดอร์ชั้นเดียว */
export async function findDirectory(root, wanted) {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0 && visited < 10_000) {
    const directory = pending.shift();
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const full = path.join(directory, entry.name);
      if (entry.name.toLowerCase() === wanted) return full;
      pending.push(full);
    }
  }
  return null;
}
