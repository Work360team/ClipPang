import fs from "node:fs";
import path from "node:path";
import {
  ENV_FILE,
  INPUT_DIR,
  PROJECTS_DIR,
  ROOT_DIR,
} from "./config.mjs";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const VIDEO_HEADER_BYTES = 4096;

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const GEMINI_ENV_NAME = "GEMINI_API_KEY";

export class SecurityError extends Error {
  constructor(message, { code = "SECURITY_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "SecurityError";
    this.code = code;
    this.statusCode = statusCode;
    // server/api.mjs and many Node HTTP adapters conventionally read `status`.
    this.status = statusCode;
  }
}

function isInside(root, candidate, { allowRoot = true } = {}) {
  const relative = path.relative(root, candidate);
  if (relative === "") return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertNoSymlinkEscape(root, candidate, allowRoot) {
  if (!fs.existsSync(root)) return;

  const realRoot = fs.realpathSync.native(root);
  let existingAncestor = candidate;

  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) return;
    existingAncestor = parent;
  }

  const realAncestor = fs.realpathSync.native(existingAncestor);
  const remaining = path.relative(existingAncestor, candidate);
  const realCandidate = path.resolve(realAncestor, remaining);

  if (!isInside(realRoot, realCandidate, { allowRoot })) {
    throw new SecurityError("พาธนี้อยู่นอกโฟลเดอร์ที่ ClipPang อนุญาต", {
      code: "PATH_OUTSIDE_ROOT",
      statusCode: 403,
    });
  }
}

/**
 * Resolve a user-influenced path and prove it remains under the given root.
 * Existing symlinks are resolved too, so a symlink inside projects/ cannot be
 * used as a tunnel to another folder.
 */
export function resolveUnderRoot(root, requestedPath = ".", options = {}) {
  const { allowRoot = true, checkSymlinks = true } = options;

  if (typeof root !== "string" || root.length === 0) {
    throw new TypeError("root must be a non-empty string");
  }
  if (typeof requestedPath !== "string") {
    throw new SecurityError("พาธไฟล์ไม่ถูกต้อง", { code: "INVALID_PATH" });
  }
  if (requestedPath.includes("\0")) {
    throw new SecurityError("พาธไฟล์มีอักขระที่ไม่อนุญาต", { code: "INVALID_PATH" });
  }

  const resolvedRoot = path.resolve(root);
  // Treat both slash styles as separators on every OS. This keeps a path
  // crafted for Windows from becoming a harmless-looking filename on Linux
  // (or vice versa) and gives the API one portable traversal policy.
  const portablePath = requestedPath.replace(/[\\/]/g, path.sep);
  const resolved = path.isAbsolute(portablePath)
    ? path.resolve(portablePath)
    : path.resolve(resolvedRoot, portablePath);

  if (!isInside(resolvedRoot, resolved, { allowRoot })) {
    throw new SecurityError("พาธนี้อยู่นอกโฟลเดอร์ที่ ClipPang อนุญาต", {
      code: "PATH_OUTSIDE_ROOT",
      statusCode: 403,
    });
  }

  if (checkSymlinks) assertNoSymlinkEscape(resolvedRoot, resolved, allowRoot);
  return resolved;
}

export const safeResolve = resolveUnderRoot;
export const assertPathUnderRoot = resolveUnderRoot;

/**
 * Produce a portable filename, never a path. Thai and other Unicode letters
 * are retained; separators, control characters and Windows device names are
 * removed or neutralised.
 */
export function safeFilename(input, { fallback = "file", maxLength = 160 } = {}) {
  if (typeof input !== "string") {
    throw new SecurityError("ชื่อไฟล์ไม่ถูกต้อง", { code: "INVALID_FILENAME" });
  }

  const basename = path.posix.basename(input.replaceAll("\\", "/")).normalize("NFC");
  let clean = basename
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^-+/, "")
    .replace(/^[. ]+|[. ]+$/g, "")
    .trim();

  if (!clean || clean === "." || clean === "..") clean = fallback;
  if (WINDOWS_RESERVED_NAME.test(clean)) clean = `_${clean}`;

  const characters = Array.from(clean);
  if (characters.length > maxLength) {
    const extension = path.extname(clean);
    const extensionCharacters = Array.from(extension);
    const stemLength = Math.max(1, maxLength - extensionCharacters.length);
    clean = `${characters.slice(0, stemLength).join("")}${extensionCharacters.slice(0, maxLength - stemLength).join("")}`;
  }

  return clean;
}

export function assertSafeFilename(input, options) {
  const safe = safeFilename(input, options);
  if (safe !== input.normalize("NFC")) {
    throw new SecurityError("ชื่อไฟล์มีพาธหรืออักขระที่ไม่อนุญาต", {
      code: "UNSAFE_FILENAME",
      statusCode: 403,
    });
  }
  return safe;
}

export function safeProjectPath(projectId, ...parts) {
  const id = assertSafeFilename(projectId, { fallback: "project", maxLength: 120 });
  const projectRoot = resolveUnderRoot(PROJECTS_DIR, id, { allowRoot: false });
  if (parts.length === 0) return projectRoot;
  if (parts.some((part) => typeof part !== "string" || part.includes("\0"))) {
    throw new SecurityError("พาธโปรเจกต์ไม่ถูกต้อง", { code: "INVALID_PATH" });
  }
  return resolveUnderRoot(projectRoot, path.join(...parts));
}

export function safeInputPath(...parts) {
  if (parts.some((part) => typeof part !== "string" || part.includes("\0"))) {
    throw new SecurityError("พาธไฟล์นำเข้าไม่ถูกต้อง", { code: "INVALID_PATH" });
  }
  return resolveUnderRoot(INPUT_DIR, parts.length ? path.join(...parts) : ".");
}

export function safeRootPath(...parts) {
  if (parts.some((part) => typeof part !== "string" || part.includes("\0"))) {
    throw new SecurityError("พาธไม่ถูกต้อง", { code: "INVALID_PATH" });
  }
  return resolveUnderRoot(ROOT_DIR, parts.length ? path.join(...parts) : ".");
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("video header must be a Buffer or Uint8Array");
}

function asciiAt(buffer, start, length) {
  if (buffer.length < start + length) return "";
  return buffer.toString("ascii", start, start + length);
}

/** Detect a video container from bytes only; the filename is never consulted. */
export function detectVideoMagic(header) {
  const bytes = asBuffer(header);

  // ISO Base Media File Format: MP4, MOV, 3GP and related video containers.
  if (bytes.length >= 12 && asciiAt(bytes, 4, 4) === "ftyp") {
    const majorBrand = asciiAt(bytes, 8, 4);
    const audioOnlyBrands = new Set(["M4A ", "M4B ", "M4P ", "F4A "]);
    if (!audioOnlyBrands.has(majorBrand)) {
      const quickTime = majorBrand === "qt  ";
      return {
        container: quickTime ? "mov" : "mp4",
        mime: quickTime ? "video/quicktime" : "video/mp4",
      };
    }
  }

  // Some older QuickTime files begin with a movie/media atom rather than ftyp.
  if (bytes.length >= 8 && ["moov", "mdat", "wide"].includes(asciiAt(bytes, 4, 4))) {
    return { container: "mov", mime: "video/quicktime" };
  }

  // Matroska / WebM EBML signature.
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const marker = bytes.toString("latin1").toLowerCase();
    const webm = marker.includes("webm");
    return {
      container: webm ? "webm" : "matroska",
      mime: webm ? "video/webm" : "video/x-matroska",
    };
  }

  // RIFF can hold many formats, so require the AVI form type too.
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "AVI ") {
    return { container: "avi", mime: "video/x-msvideo" };
  }

  // Flash Video header; bit 0 of the flags byte denotes a video stream.
  if (bytes.length >= 5 && asciiAt(bytes, 0, 3) === "FLV" && (bytes[4] & 0x01) === 0x01) {
    return { container: "flv", mime: "video/x-flv" };
  }

  // MPEG program stream / elementary video stream.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 &&
    (bytes[3] === 0xba || bytes[3] === 0xb3)
  ) {
    return { container: "mpeg", mime: "video/mpeg" };
  }

  // MPEG transport stream: require sync bytes for three packets to avoid
  // treating an arbitrary file beginning with 0x47 as video.
  if (bytes.length >= 377 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) {
    return { container: "mpeg-ts", mime: "video/mp2t" };
  }

  // ASF header used by WMV.
  const asfGuid = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c]);
  if (bytes.length >= asfGuid.length && bytes.subarray(0, asfGuid.length).equals(asfGuid)) {
    return { container: "asf", mime: "video/x-ms-wmv" };
  }

  return null;
}

export function assertVideoUpload({ header, size, maxBytes = MAX_VIDEO_BYTES } = {}) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new SecurityError("ไม่ทราบขนาดไฟล์วิดีโอ", { code: "INVALID_FILE_SIZE" });
  }
  if (size > maxBytes) {
    throw new SecurityError("ไฟล์วิดีโอต้องมีขนาดไม่เกิน 500 MB", {
      code: "FILE_TOO_LARGE",
      statusCode: 413,
    });
  }
  if (size === 0) {
    throw new SecurityError("ไฟล์วิดีโอว่างเปล่า", { code: "EMPTY_FILE" });
  }

  const detected = detectVideoMagic(header);
  if (!detected) {
    throw new SecurityError("ไฟล์นี้ไม่ใช่วิดีโอที่รองรับ (ตรวจจากเนื้อไฟล์ ไม่ใช่นามสกุล)", {
      code: "UNSUPPORTED_VIDEO",
      statusCode: 415,
    });
  }

  return { ok: true, size, ...detected };
}

export function validateVideoUpload(options) {
  try {
    return assertVideoUpload(options);
  } catch (error) {
    if (!(error instanceof SecurityError)) throw error;
    return {
      ok: false,
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
    };
  }
}

export async function validateUploadedFile(fileOrOptions, options = {}) {
  if (
    fileOrOptions &&
    typeof fileOrOptions === "object" &&
    !Buffer.isBuffer(fileOrOptions) &&
    (fileOrOptions.header || fileOrOptions.buffer)
  ) {
    return assertVideoUpload({
      header: fileOrOptions.header ?? fileOrOptions.buffer,
      size: fileOrOptions.size ?? fileOrOptions.buffer?.byteLength,
      maxBytes: fileOrOptions.maxBytes ?? options.maxBytes,
    });
  }

  const filePath = typeof fileOrOptions === "string"
    ? fileOrOptions
    : fileOrOptions?.path ?? fileOrOptions?.filePath;

  if (typeof filePath !== "string" || filePath.includes("\0")) {
    throw new SecurityError("พาธไฟล์อัปโหลดไม่ถูกต้อง", { code: "INVALID_PATH" });
  }

  const handle = await fs.promises.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new SecurityError("รายการที่อัปโหลดไม่ใช่ไฟล์", { code: "NOT_A_FILE" });
    }
    if (stat.size > (options.maxBytes ?? MAX_VIDEO_BYTES)) {
      throw new SecurityError("ไฟล์วิดีโอต้องมีขนาดไม่เกิน 500 MB", {
        code: "FILE_TOO_LARGE",
        statusCode: 413,
      });
    }

    const header = Buffer.alloc(Math.min(VIDEO_HEADER_BYTES, Math.max(0, stat.size)));
    if (header.length > 0) await handle.read(header, 0, header.length, 0);
    return {
      ...assertVideoUpload({ header, size: stat.size, maxBytes: options.maxBytes ?? MAX_VIDEO_BYTES }),
      filename: path.basename(filePath),
    };
  } finally {
    await handle.close();
  }
}

export const validateVideoFile = validateUploadedFile;

function normaliseSecret(value) {
  if (typeof value !== "string") return "";
  let result = value.trim();
  if (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1);
  }
  return result.trim();
}

function publicKeyStatus(value) {
  const secret = normaliseSecret(value);
  const configured = secret.length > 0;
  const last4 = configured ? secret.slice(-4) : null;
  return Object.freeze({
    configured,
    last4,
    masked: configured ? `••••${last4}` : null,
  });
}

function readKeyStatusFromFile(envFile, keyName) {
  try {
    const stat = fs.statSync(envFile);
    if (!stat.isFile() || stat.size > 1024 * 1024) return publicKeyStatus("");
    const contents = fs.readFileSync(envFile, "utf8");
    const matcher = new RegExp(`^\\s*(?:export\\s+)?${keyName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*=\\s*(.*)$`, "m");
    const match = contents.match(matcher);
    if (!match) return publicKeyStatus("");
    return publicKeyStatus(match[1].replace(/\s+#.*$/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return publicKeyStatus("");
    throw error;
  }
}

/** Returns only configured/last4/masked; the complete secret is never returned. */
export function getGeminiKeyStatus(options = {}) {
  if (typeof options === "string") options = { envFile: options };
  const {
    envFile = ENV_FILE,
    environment = process.env,
    keyName = GEMINI_ENV_NAME,
  } = options;

  const environmentValue = normaliseSecret(environment?.[keyName]);
  return environmentValue
    ? publicKeyStatus(environmentValue)
    : readKeyStatusFromFile(envFile, keyName);
}

export const getApiKeyStatus = getGeminiKeyStatus;

function validateNewGeminiKey(value) {
  const key = normaliseSecret(value);
  if (key.length < 16 || key.length > 512 || !/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new SecurityError("รูปแบบ Gemini API key ไม่ถูกต้อง", { code: "INVALID_API_KEY" });
  }
  return key;
}

/**
 * Atomically insert or update GEMINI_API_KEY while preserving unrelated .env
 * entries. The full key is accepted only as input and is never returned.
 */
/**
 * ลบตัวแปรหนึ่งบรรทัดออกจาก .env แบบ atomic เหมือนตอนเขียน
 * ใช้ตอนผู้ใช้เอาคีย์สำรองออก — ต้องลบจริง ไม่ใช่ตั้งเป็นค่าว่าง
 * เพราะช่องที่เป็นค่าว่างจะทำให้ nextFreeSlot() งงว่าใช้ได้หรือไม่
 */
export function removeEnvValue(keyName, options = {}) {
  const { envFile = ENV_FILE } = options;
  if (!/^[A-Z0-9_]+$/.test(String(keyName))) {
    throw new SecurityError("ชื่อตัวแปรไม่ถูกต้อง", { code: "INVALID_ENV_NAME" });
  }
  let current = "";
  try {
    const stat = fs.lstatSync(envFile);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new SecurityError("ไม่แก้ไฟล์ .env ที่เป็นลิงก์", { code: "UNSAFE_ENV_FILE", statusCode: 403 });
    }
    current = fs.readFileSync(envFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${keyName}\\s*=`);
  const lines = current.split(/\r?\n/);
  const kept = lines.filter((line) => !matcher.test(line));
  if (kept.length === lines.length) return false;

  const output = `${kept.join(newline).replace(new RegExp(`${newline}+$`), "")}${newline}`;
  const directory = path.dirname(path.resolve(envFile));
  const temporary = path.join(directory, `.${path.basename(envFile)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, envFile);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }
  return true;
}

export function saveGeminiApiKey(apiKey, options = {}) {
  const {
    envFile = ENV_FILE,
    environment = process.env,
    keyName = GEMINI_ENV_NAME,
  } = options;
  const key = validateNewGeminiKey(apiKey);
  const directory = path.dirname(path.resolve(envFile));
  fs.mkdirSync(directory, { recursive: true });

  let current = "";
  try {
    const stat = fs.lstatSync(envFile);
    if (stat.isSymbolicLink()) {
      throw new SecurityError("ไม่บันทึก API key ลงไฟล์ลิงก์ กรุณาใช้ไฟล์ .env ปกติ", {
        code: "UNSAFE_ENV_FILE",
        statusCode: 403,
      });
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) {
      throw new SecurityError("ไฟล์ .env ไม่ถูกต้องหรือมีขนาดใหญ่เกินไป", { code: "INVALID_ENV_FILE" });
    }
    current = fs.readFileSync(envFile, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = current ? current.split(/\r?\n/) : [];
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${keyName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*=`);
  let replaced = false;
  const updated = [];

  for (const line of lines) {
    if (!matcher.test(line)) {
      updated.push(line);
      continue;
    }
    if (!replaced) {
      updated.push(`${keyName}=${key}`);
      replaced = true;
    }
    // Drop duplicate definitions so an older key cannot unexpectedly win.
  }
  if (!replaced) updated.push(`${keyName}=${key}`);

  while (updated.length > 1 && updated.at(-1) === "" && updated.at(-2) === "") updated.pop();
  const output = `${updated.join(newline).replace(new RegExp(`${newline}+$`), "")}${newline}`;
  const temporary = path.join(directory, `.${path.basename(envFile)}.${process.pid}.${Date.now()}.tmp`);

  try {
    fs.writeFileSync(temporary, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, envFile);
    try {
      fs.chmodSync(envFile, 0o600);
    } catch (error) {
      // Windows can ignore POSIX mode bits. Other chmod failures are surfaced.
      if (process.platform !== "win32") throw error;
    }
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Best effort cleanup; never include the secret or file content in errors.
    }
  }

  if (environment && typeof environment === "object") environment[keyName] = key;
  return publicKeyStatus(key);
}

export const writeGeminiApiKey = saveGeminiApiKey;
