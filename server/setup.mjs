import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  HOST,
  MIN_NODE_VERSION,
  ROOT_DIR,
  ensureDirectories,
  paths,
} from "./config.mjs";
import {
  SecurityError,
  getGeminiKeyStatus,
  saveGeminiApiKey,
} from "./security.mjs";

const PROCESS_TIMEOUT_MS = 12_000;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 350 * 1024 * 1024;

export let ffmpegPath = null;
export let ffprobePath = null;

function activateFfmpeg(candidatePath, environment, platform) {
  ffmpegPath = candidatePath;
  const probeName = platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const companion = path.join(path.dirname(candidatePath), probeName);
  try {
    ffprobePath = fs.statSync(companion).isFile() ? companion : null;
  } catch {
    ffprobePath = null;
  }

  // The migrated pipeline resolves binaries through these environment values.
  // Updating only the supplied environment object keeps tests isolated while
  // making a data/bin installation usable immediately in the live process.
  if (environment && typeof environment === "object") {
    try {
      environment.FFMPEG_PATH = candidatePath;
      if (ffprobePath) environment.FFPROBE_PATH = ffprobePath;
    } catch {
      // A frozen test environment should not make discovery fail.
    }
  }
}

function abortError() {
  const error = new Error("ยกเลิกการทำงานแล้ว");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function runProcess(command, args, options = {}) {
  const {
    signal,
    timeoutMs = PROCESS_TIMEOUT_MS,
    maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
    cwd,
    environment = process.env,
  } = options;

  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const collect = (bucket, counterName) => (chunk) => {
      const current = counterName === "stdout" ? stdoutBytes : stderrBytes;
      if (current >= maxOutputBytes) return;
      const remaining = maxOutputBytes - current;
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      bucket.push(kept);
      if (counterName === "stdout") stdoutBytes += kept.length;
      else stderrBytes += kept.length;
    };

    child.stdout.on("data", collect(stdout, "stdout"));
    child.stderr.on("data", collect(stderr, "stderr"));

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(abortError()));
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, childSignal) => finish(() => resolve({
      code,
      signal: childSignal,
      timedOut,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    })));
  });
}

function executableNames(name, platform, environment) {
  if (platform !== "win32") return [name];
  const extensions = (environment.PATHEXT || ".EXE;.COM;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const names = extensions.map((extension) => `${name}${extension}`);
  if (!names.includes(`${name}.exe`)) names.unshift(`${name}.exe`);
  return names;
}

export function findExecutableOnPath(name, options = {}) {
  const {
    environment = process.env,
    platform = process.platform,
  } = options;
  const pathValue = environment.PATH || environment.Path || environment.path || "";
  const accessMode = platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK;

  for (const entry of pathValue.split(path.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (!directory) continue;
    for (const executable of executableNames(name, platform, environment)) {
      const candidate = path.resolve(directory, executable);
      try {
        fs.accessSync(candidate, accessMode);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep searching PATH in its declared order.
      }
    }
  }
  return null;
}

function readableFfmpegVersion(output) {
  const match = output.match(/^ffmpeg version\s+([^\s]+)/im);
  return match?.[1] ?? null;
}

export async function verifyFfmpeg(candidatePath, options = {}) {
  if (typeof candidatePath !== "string" || !candidatePath) {
    return {
      ready: false,
      found: false,
      libass: false,
      path: null,
      version: null,
      reason: "ไม่พบ FFmpeg",
    };
  }

  try {
    const versionCheck = await runProcess(candidatePath, ["-hide_banner", "-version"], options);
    const versionOutput = `${versionCheck.stdout}\n${versionCheck.stderr}`;
    const version = readableFfmpegVersion(versionOutput);
    if (versionCheck.timedOut || versionCheck.code !== 0) {
      return {
        ready: false,
        found: true,
        libass: false,
        path: candidatePath,
        version,
        reason: versionCheck.timedOut ? "FFmpeg ไม่ตอบสนองภายในเวลาที่กำหนด" : "เปิด FFmpeg ไม่สำเร็จ",
      };
    }

    const filterCheck = await runProcess(candidatePath, ["-hide_banner", "-filters"], options);
    const filterOutput = `${filterCheck.stdout}\n${filterCheck.stderr}`;
    const hasSubtitleFilter = /(?:^|\n)\s*[TSC.]{3,}\s+(?:ass|subtitles)\s+V->V\b/im.test(filterOutput)
      || /\b(?:ass|subtitles)\s+V->V\b[\s\S]{0,120}\blibass\b/i.test(filterOutput);
    const hasLibass = filterCheck.code === 0 && !filterCheck.timedOut && hasSubtitleFilter;

    return {
      ready: hasLibass,
      found: true,
      libass: hasLibass,
      path: candidatePath,
      version,
      reason: hasLibass ? null : "FFmpeg ตัวนี้ไม่มี libass สำหรับเรนเดอร์ซับภาษาไทย",
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ready: false,
      found: false,
      libass: false,
      path: candidatePath,
      version: null,
      reason: error?.code === "ENOENT" ? "ไม่พบ FFmpeg" : "ตรวจ FFmpeg ไม่สำเร็จ",
    };
  }
}

function localFfmpegCandidates(appPaths, platform) {
  const preferred = platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg", "ffmpeg.exe"];
  return preferred.map((name) => path.join(appPaths.bin, name));
}

export async function discoverFfmpeg(options = {}) {
  const {
    appPaths = paths,
    environment = process.env,
    platform = process.platform,
    signal,
  } = options;
  const candidates = [];

  // Required discovery order: Clip360-managed data/bin first, then PATH.
  for (const candidate of localFfmpegCandidates(appPaths, platform)) {
    try {
      if (fs.statSync(candidate).isFile()) candidates.push({ path: candidate, source: "data/bin" });
    } catch {
      // Missing local candidate is expected during first run.
    }
  }

  const fromPath = findExecutableOnPath("ffmpeg", { environment, platform });
  if (fromPath) candidates.push({ path: fromPath, source: "PATH" });

  const seen = new Set();
  let firstFailure = null;
  for (const candidate of candidates) {
    const identity = platform === "win32" ? candidate.path.toLowerCase() : candidate.path;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const result = await verifyFfmpeg(candidate.path, { signal, environment });
    if (result.ready) {
      activateFfmpeg(candidate.path, environment, platform);
      return { ...result, source: candidate.source };
    }
    firstFailure ??= { ...result, source: candidate.source };
  }

  ffmpegPath = null;
  return firstFailure ?? {
    ready: false,
    found: false,
    libass: false,
    path: null,
    source: null,
    version: null,
    reason: "ยังไม่พบ FFmpeg ใน data/bin หรือ PATH",
  };
}

function versionParts(version) {
  const [major = 0, minor = 0, patch = 0] = String(version).replace(/^v/i, "").split(".");
  return [major, minor, patch].map((part) => Number.parseInt(part, 10) || 0);
}

function versionAtLeast(current, minimum) {
  const left = versionParts(current);
  const right = versionParts(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}

export function getNodeStatus(options = {}) {
  const current = options.version ?? process.versions.node;
  const required = options.minimum ?? MIN_NODE_VERSION;
  return {
    ready: versionAtLeast(current, required),
    version: current,
    required,
  };
}

export function getKanitStatus(options = {}) {
  const fontDirectories = options.fontDirectories ?? [
    paths.fonts,
    path.join(ROOT_DIR, "pipeline", "fonts"),
    // The proven spike remains a safe fallback while migrating existing users.
    path.join(ROOT_DIR, "spike", "fonts"),
  ];

  for (const directory of fontDirectories) {
    try {
      const files = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^Kanit[-_].*\.(?:ttf|otf)$/i.test(entry.name))
        .filter((entry) => {
          try {
            return fs.statSync(path.join(directory, entry.name)).size > 1024;
          } catch {
            return false;
          }
        })
        .map((entry) => entry.name)
        .sort();
      if (files.length > 0) {
        return { ready: true, directory, files };
      }
    } catch {
      // Try the next known local font directory.
    }
  }

  return {
    ready: false,
    directory: fontDirectories[0] ?? null,
    files: [],
    reason: "ยังไม่พบฟอนต์ Kanit ในโฟลเดอร์โปรเจกต์",
  };
}

export async function getSetupStatus(options = {}) {
  const appPaths = options.appPaths ?? paths;
  const node = getNodeStatus(options.node);
  const kanit = getKanitStatus({
    fontDirectories: options.fontDirectories ?? [
      appPaths.fonts,
      path.join(appPaths.root, "pipeline", "fonts"),
      path.join(appPaths.root, "spike", "fonts"),
    ],
  });
  const key = getGeminiKeyStatus({
    envFile: options.envFile ?? appPaths.env,
    environment: options.environment ?? process.env,
  });
  const ffmpeg = await discoverFfmpeg({
    appPaths,
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    signal: options.signal,
  });

  return {
    ready: node.ready && kanit.ready && ffmpeg.ready && key.configured,
    host: HOST,
    node,
    kanit,
    ffmpeg,
    key,
  };
}

export function getFfmpegDownloadSpec(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  if (platform === "win32" && arch === "x64") {
    return {
      platform,
      arch,
      archive: "zip",
      filename: "ffmpeg-release-essentials.zip",
      url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
      provider: "gyan.dev",
    };
  }
  if (platform === "linux" && ["x64", "arm64"].includes(arch)) {
    const buildArch = arch === "x64" ? "amd64" : "arm64";
    return {
      platform,
      arch,
      archive: "tar.xz",
      filename: `ffmpeg-release-${buildArch}-static.tar.xz`,
      url: `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${buildArch}-static.tar.xz`,
      provider: "johnvansickle.com",
    };
  }
  if (platform === "darwin" && arch === "x64") {
    return {
      platform,
      arch,
      archive: "zip",
      filename: "ffmpeg-macos-release.zip",
      url: "https://evermeet.cx/ffmpeg/getrelease/zip",
      provider: "evermeet.cx",
    };
  }

  throw new SecurityError(
    `ยังไม่มีตัวติดตั้ง FFmpeg อัตโนมัติสำหรับ ${platform}/${arch} กรุณาติดตั้ง FFmpeg ที่มี libass แล้วลองใหม่`,
    { code: "UNSUPPORTED_FFMPEG_PLATFORM", statusCode: 422 },
  );
}

function reportProgress(callback, update) {
  if (typeof callback !== "function") return;
  try {
    const numericProgress = Number.isFinite(update.progress)
      ? update.progress
      : (Number.isFinite(update.percent) ? update.percent : null);
    callback(Object.freeze({
      ...update,
      ...(numericProgress == null ? {} : { percent: numericProgress, progress: numericProgress }),
    }));
  } catch {
    // A disconnected SSE client must not leave a half-installed binary.
  }
}

export async function downloadFfmpegArchive(options = {}) {
  const {
    spec = getFfmpegDownloadSpec(options),
    destination,
    fetchImpl = globalThis.fetch,
    onProgress,
    signal,
    maxBytes = MAX_DOWNLOAD_BYTES,
  } = options;

  if (typeof fetchImpl !== "function") throw new Error("ระบบนี้ไม่รองรับการดาวน์โหลดผ่าน fetch");
  if (typeof destination !== "string" || !destination) throw new TypeError("destination is required");

  const sourceUrl = new URL(spec.url);
  if (sourceUrl.protocol !== "https:") {
    throw new SecurityError("อนุญาตให้ดาวน์โหลด FFmpeg ผ่าน HTTPS เท่านั้น", {
      code: "INSECURE_DOWNLOAD_URL",
      statusCode: 403,
    });
  }

  const response = await fetchImpl(sourceUrl, { redirect: "follow", signal });
  if (!response.ok || !response.body) {
    throw new Error(`ดาวน์โหลด FFmpeg ไม่สำเร็จ (HTTP ${response.status})`);
  }
  if (response.url && new URL(response.url).protocol !== "https:") {
    throw new SecurityError("ปลายทางดาวน์โหลด FFmpeg ไม่ได้ใช้ HTTPS", {
      code: "INSECURE_DOWNLOAD_REDIRECT",
      statusCode: 403,
    });
  }

  const announcedSize = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(announcedSize) && announcedSize > maxBytes) {
    await response.body.cancel();
    throw new Error("ไฟล์ติดตั้ง FFmpeg มีขนาดใหญ่ผิดปกติ");
  }

  const handle = await fs.promises.open(destination, "wx", 0o600);
  let receivedBytes = 0;
  let lastPercent = -1;
  try {
    const reader = response.body.getReader();
    while (true) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new Error("ไฟล์ติดตั้ง FFmpeg มีขนาดใหญ่ผิดปกติ");
      }
      const chunk = Buffer.from(value);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (bytesWritten <= 0) throw new Error("เขียนไฟล์ติดตั้ง FFmpeg ไม่สำเร็จ");
        offset += bytesWritten;
      }

      const percent = Number.isFinite(announcedSize) && announcedSize > 0
        ? Math.min(100, Math.floor((receivedBytes / announcedSize) * 100))
        : null;
      if (percent === null || percent !== lastPercent) {
        lastPercent = percent;
        reportProgress(onProgress, {
          phase: "downloading",
          receivedBytes,
          totalBytes: Number.isFinite(announcedSize) ? announcedSize : null,
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
  return { path: destination, receivedBytes, spec };
}

async function extractArchive(archivePath, outputDirectory, spec, options = {}) {
  if (typeof options.extractor === "function") {
    await options.extractor({ archivePath, outputDirectory, spec, signal: options.signal });
    return;
  }

  const platform = spec.platform;
  const commands = [];
  if (spec.archive === "tar.xz") {
    commands.push(["tar", ["-xJf", archivePath, "-C", outputDirectory]]);
  } else if (spec.archive === "zip" && platform === "darwin") {
    commands.push(["/usr/bin/ditto", ["-x", "-k", archivePath, outputDirectory]]);
  } else if (spec.archive === "zip" && platform === "win32") {
    commands.push(["tar.exe", ["-xf", archivePath, "-C", outputDirectory]]);
    commands.push([
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force", archivePath, outputDirectory],
    ]);
  } else if (spec.archive === "zip") {
    commands.push(["unzip", ["-q", archivePath, "-d", outputDirectory]]);
  }

  let lastError = null;
  for (const [command, args] of commands) {
    try {
      const result = await runProcess(command, args, {
        signal: options.signal,
        timeoutMs: 120_000,
        maxOutputBytes: 256 * 1024,
      });
      if (result.code === 0 && !result.timedOut) return;
      lastError = new Error("แตกไฟล์ติดตั้ง FFmpeg ไม่สำเร็จ");
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error("ไม่พบเครื่องมือสำหรับแตกไฟล์ติดตั้ง FFmpeg");
}

async function findExtractedBinary(root, wantedNames) {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0 && visited < 10_000) {
    const directory = pending.shift();
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isFile() && wantedNames.has(entry.name.toLowerCase())) return fullPath;
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return null;
}

export async function installFfmpeg(options = {}) {
  const {
    appPaths = paths,
    onProgress,
    signal,
    environment = process.env,
    platform = process.platform,
    arch = process.arch,
    fetchImpl = globalThis.fetch,
    extractor,
  } = options;

  ensureDirectories(appPaths);
  reportProgress(onProgress, { phase: "checking", percent: 0 });
  const existing = await discoverFfmpeg({ appPaths, environment, platform, signal });
  if (existing.ready) {
    reportProgress(onProgress, { phase: "ready", percent: 100, version: existing.version });
    return existing;
  }

  const spec = options.spec ?? getFfmpegDownloadSpec({ platform, arch });
  const installDirectory = await fs.promises.mkdtemp(path.join(appPaths.bin, ".ffmpeg-install-"));
  const archivePath = path.join(installDirectory, spec.filename);
  const extractDirectory = path.join(installDirectory, "extracted");
  await fs.promises.mkdir(extractDirectory);

  try {
    await downloadFfmpegArchive({
      spec,
      destination: archivePath,
      fetchImpl,
      signal,
      onProgress: (event) => {
        const downloadPercent = event.percent == null ? null : 5 + Math.round(event.percent * 0.65);
        reportProgress(onProgress, { ...event, percent: downloadPercent });
      },
    });

    reportProgress(onProgress, { phase: "extracting", percent: 75 });
    await extractArchive(archivePath, extractDirectory, spec, { signal, extractor });

    const executableName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const probeName = platform === "win32" ? "ffprobe.exe" : "ffprobe";
    const extractedFfmpeg = await findExtractedBinary(extractDirectory, new Set([executableName]));
    if (!extractedFfmpeg) throw new Error("ไฟล์ติดตั้งไม่มี FFmpeg ตามที่คาดไว้");

    const stagedFfmpeg = path.join(installDirectory, executableName);
    await fs.promises.copyFile(extractedFfmpeg, stagedFfmpeg);
    if (platform !== "win32") await fs.promises.chmod(stagedFfmpeg, 0o755);

    reportProgress(onProgress, { phase: "verifying", percent: 88 });
    const verified = await verifyFfmpeg(stagedFfmpeg, { signal, environment });
    if (!verified.ready) {
      throw new Error("FFmpeg ที่ดาวน์โหลดมาไม่มี libass จึงยังใช้ทำซับภาษาไทยไม่ได้");
    }

    const destination = path.join(appPaths.bin, executableName);
    await fs.promises.copyFile(stagedFfmpeg, destination);
    if (platform !== "win32") await fs.promises.chmod(destination, 0o755);

    const extractedProbe = await findExtractedBinary(extractDirectory, new Set([probeName]));
    if (extractedProbe) {
      const probeDestination = path.join(appPaths.bin, probeName);
      await fs.promises.copyFile(extractedProbe, probeDestination);
      if (platform !== "win32") await fs.promises.chmod(probeDestination, 0o755);
    }

    const finalCheck = await verifyFfmpeg(destination, { signal, environment });
    if (!finalCheck.ready) throw new Error("ตรวจ FFmpeg หลังติดตั้งไม่ผ่าน กรุณาลองใหม่");
    activateFfmpeg(destination, environment, platform);
    const result = { ...finalCheck, source: "data/bin" };
    reportProgress(onProgress, { phase: "ready", percent: 100, version: result.version });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const safeError = new Error("โหลด FFmpeg ไม่สำเร็จ (เน็ตหลุด?) กดลองใหม่ หรือดาวน์โหลดเองแล้ววางไว้ที่ data/bin/");
    safeError.code = error?.code || "FFMPEG_INSTALL_FAILED";
    safeError.cause = error;
    throw safeError;
  } finally {
    await fs.promises.rm(installDirectory, { recursive: true, force: true });
  }
}

function safeKeyStatus(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return {
    configured: key.length > 0,
    last4: key ? key.slice(-4) : null,
    masked: key ? `••••${key.slice(-4)}` : null,
  };
}

/** Validate a submitted key without putting it in a URL, response, or log. */
export async function testGeminiApiKey(apiKey, options = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key.length < 16 || key.length > 512 || !/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new SecurityError("รูปแบบ API key ไม่ถูกต้อง กรุณาคัดลอกจาก Google AI Studio แล้วลองใหม่", {
      code: "INVALID_API_KEY",
      statusCode: 400,
    });
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("ระบบนี้ไม่รองรับการทดสอบ API key ผ่าน fetch");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  timeout.unref?.();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      method: "GET",
      headers: { "x-goog-api-key": key },
      signal: controller.signal,
      redirect: "error",
    });
    await response.body?.cancel?.();
    if (response.ok) return { ok: true, ...safeKeyStatus(key) };

    const invalid = [400, 401, 403].includes(response.status);
    throw new SecurityError(
      invalid
        ? "Google ไม่ยอมรับ API key นี้ กรุณาตรวจแล้วลองใหม่"
        : "บริการ Google Gemini ยังไม่พร้อม กรุณาลองใหม่อีกครั้ง",
      {
        code: invalid ? "API_KEY_REJECTED" : "GEMINI_UNAVAILABLE",
        statusCode: invalid ? 400 : 502,
      },
    );
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (error instanceof SecurityError) throw error;
    throw new SecurityError(
      controller.signal.aborted
        ? "ทดสอบ API key ใช้เวลานานเกินไป กรุณาลองใหม่"
        : "ติดต่อ Google Gemini ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต",
      {
        code: controller.signal.aborted ? "GEMINI_TIMEOUT" : "GEMINI_UNAVAILABLE",
        statusCode: controller.signal.aborted ? 504 : 502,
      },
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function saveAndTestGeminiApiKey(apiKey, options = {}) {
  await testGeminiApiKey(apiKey, options);
  const saved = saveGeminiApiKey(apiKey, {
    envFile: options.envFile ?? paths.env,
    environment: options.environment ?? process.env,
  });
  return { ok: true, ...saved };
}

export async function getFfmpegPath(options = {}) {
  const discovered = await discoverFfmpeg(options);
  return discovered.ready ? discovered.path : null;
}

export { ensureDirectories, getGeminiKeyStatus, saveGeminiApiKey };
