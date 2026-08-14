import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  HOST,
  PATHS,
  ensureDirectories,
} from "./config.mjs";
import {
  MAX_VIDEO_BYTES,
  removeEnvValue,
  resolveUnderRoot,
  saveGeminiApiKey,
  safeFilename,
  safeProjectPath,
  validateUploadedFile,
} from "./security.mjs";
import {
  getSetupStatus,
  installFfmpeg,
  testGeminiApiKey,
} from "./setup.mjs";
import { generateCaptions } from "../pipeline/caption.mjs";
import { buildNotifications, countUnread } from "./notifications.mjs";
import { quotaStatus } from "../pipeline/tts-quota.mjs";
import {
  generateScripts,
  listStyles,
  listVoices,
  probe,
  regenerateChunk,
  synthesizePreview,
} from "../pipeline/index.mjs";
import { detectScriptProviders, SCRIPT_PROVIDERS } from "../pipeline/providers.mjs";
import { checkTtsHealth, resetTtsHealthCache } from "./tts-health.mjs";
import { MAX_KEYS, keySlots, listGeminiKeys, nextFreeSlot } from "../pipeline/gemini-keys.mjs";
import { isTerminalRenderState, renderLaneForStyle } from "./queue.mjs";
import {
  normalizeAssetCatalog,
  normalizeTimelineClips,
  resolveMediaPlan,
} from "./sources.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MIME = new Map([
  [".mp4", "video/mp4"], [".mov", "video/quicktime"], [".webm", "video/webm"],
  [".wav", "audio/wav"], [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"],
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
  [".srt", "text/plain; charset=utf-8"], [".ass", "text/plain; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { ...JSON_HEADERS, ...(init.headers || {}) } });
}

function apiError(status, code, message, details) {
  return json({ ok: false, error: { code, message, ...(details ? { details } : {}) } }, { status });
}

async function readJson(request, { optional = false } = {}) {
  const text = await request.text();
  if (!text && optional) return {};
  try {
    return JSON.parse(text || "{}");
  } catch {
    const error = new Error("รูปแบบข้อมูลไม่ถูกต้อง กรุณาลองใหม่");
    error.status = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

function slug(value) {
  const normalized = String(value || "project").normalize("NFKC").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, "-").replace(/^-+|-+$/g, "");
  return (normalized || "project").slice(0, 46);
}

function projectId(title) {
  return `${slug(title)}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

function parseMaybeJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeProject(project, store) {
  if (!project) return null;
  const product = parseMaybeJson(project.product ?? project.product_json ?? {}, {});
  let currentEditPlanHash = null;
  let currentEditPlanUsable = true;
  try {
    currentEditPlanHash = resolveMediaPlan({}, product, { requireTimeline: true })?.editPlanHash ?? null;
  } catch {
    currentEditPlanUsable = false;
  }
  const renders = (
    store.listProjectRenders?.(project.id)
      ?? store.listRenders?.({ projectId: project.id })
      ?? []
  ).map((render) => {
    const normalized = withOutputUrls(render, project);
    const renderEditPlanHash = normalized?.config?.editPlanHash ?? null;
    return {
      ...normalized,
      stale: !currentEditPlanUsable || renderEditPlanHash !== currentEditPlanHash,
    };
  });
  const wizardStep = project.wizardStep ?? project.wizard_step ?? 1;
  const createdAt = project.createdAt ?? project.created_at ?? null;
  const updatedAt = project.updatedAt ?? project.updated_at ?? null;
  return {
    ...project,
    product,
    wizardStep,
    wizard_step: wizardStep,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    renders,
  };
}

function normalizeRender(render) {
  if (!render) return null;
  const projectId = render.projectId ?? render.project_id ?? null;
  const queuePosition = render.queuePosition ?? render.queue_position ?? null;
  const styleId = render.styleId ?? render.style_id ?? null;
  const createdAt = render.createdAt ?? render.created_at ?? null;
  const startedAt = render.startedAt ?? render.started_at ?? null;
  const finishedAt = render.finishedAt ?? render.finished_at ?? null;
  return {
    ...render,
    projectId,
    project_id: projectId,
    queuePosition,
    queue_position: queuePosition,
    styleId,
    style_id: styleId,
    createdAt,
    created_at: createdAt,
    startedAt,
    started_at: startedAt,
    finishedAt,
    finished_at: finishedAt,
    config: parseMaybeJson(render.config ?? render.config_json, {}),
    timeline: parseMaybeJson(render.timeline ?? render.timeline_json, null),
    outputs: parseMaybeJson(render.outputs ?? render.outputs_json, null),
    error: parseMaybeJson(render.error ?? render.error_json, null),
  };
}

function scriptChunkText(chunk) {
  if (typeof chunk === "string") return chunk;
  if (chunk && typeof chunk.text === "string") return chunk.text;
  return String(chunk ?? "");
}

function normalizeScriptsForClient(input) {
  const scripts = Array.isArray(input) ? input : input?.variants ?? [];
  return scripts.map((script) => ({
    ...script,
    chunks: (script?.chunks ?? []).map(scriptChunkText),
  }));
}

function normalizeScriptsForPipeline(input) {
  const scripts = Array.isArray(input) ? input : input?.variants ?? [];
  return scripts.map((script) => ({
    ...script,
    chunks: (script?.chunks ?? []).map((chunk, index) => (
      typeof chunk === "string"
        ? {
            i: index,
            text: chunk,
            role: index === 0 ? "hook" : "body",
            emphasis: [],
          }
        : chunk
    )),
  }));
}

function normalizeProductMedia(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return product;
  const result = { ...product };
  if (result.assets != null) result.assets = normalizeAssetCatalog(result.assets);
  if (result.timelineClips != null) {
    if (!Array.isArray(result.assets)) {
      const error = new Error("ไทม์ไลน์ต้องมีรายการไฟล์ต้นฉบับของโปรเจกต์");
      error.status = 400;
      error.code = "ASSET_CATALOG_REQUIRED";
      throw error;
    }
    const timeline = normalizeTimelineClips(result.timelineClips, {
      assetNames: result.assets.map((asset) => asset.name),
      allowEmpty: true,
    });
    result.timelineClips = timeline.clips;
  }
  return result;
}

function settingValue(value) {
  if (value == null || typeof value === "string") return value;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function readStoreSettings(store) {
  return store.getSettings?.() ?? store.listSettings?.() ?? {};
}

async function streamUpload(request, destination) {
  if (!request.body) throw Object.assign(new Error("ไม่พบข้อมูลไฟล์วิดีโอ"), { status: 400, code: "EMPTY_UPLOAD" });
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_VIDEO_BYTES) {
    throw Object.assign(new Error("ไฟล์ใหญ่เกิน 500 MB กรุณาบีบอัดหรือตัดคลิปก่อน"), { status: 413, code: "FILE_TOO_LARGE" });
  }
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_VIDEO_BYTES) callback(Object.assign(new Error("ไฟล์ใหญ่เกิน 500 MB"), { status: 413, code: "FILE_TOO_LARGE" }));
      else callback(null, chunk);
    },
  });
  await streamPipeline(Readable.fromWeb(request.body), limiter, fs.createWriteStream(destination, { flags: "wx" }));
  return size;
}

function withOutputUrls(render, project) {
  const normalized = normalizeRender(render);
  if (!normalized?.outputs) return normalized;
  const entries = Object.entries(normalized.outputs).map(([name, value]) => {
    const filename = path.basename(typeof value === "string" ? value : value?.path || name);
    return [name, {
      ...(typeof value === "object" && value ? value : {}),
      filename,
      url: `/api/projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(filename)}`,
    }];
  });
  return { ...normalized, outputs: Object.fromEntries(entries) };
}

async function fileResponse(filePath, request, { downloadName } = {}) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) return apiError(404, "FILE_NOT_FOUND", "ไม่พบไฟล์ที่ต้องการ");
  const type = MIME.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  const range = request.headers.get("range");
  const headers = {
    "accept-ranges": "bytes",
    "content-type": type,
    "cache-control": "private, max-age=0, must-revalidate",
  };
  if (downloadName) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { "content-range": `bytes */${stat.size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${stat.size}` } });
    }
    headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    headers["content-length"] = String(end - start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), { status: 206, headers });
  }
  headers["content-length"] = String(stat.size);
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), { headers });
}

async function moveProjectToTrash(id) {
  const source = safeProjectPath(id);
  try {
    await fsp.access(source);
  } catch {
    return null;
  }
  const trashRoot = resolveUnderRoot(PATHS.data, "trash");
  await fsp.mkdir(trashRoot, { recursive: true });
  const destination = resolveUnderRoot(trashRoot, `${id}-${Date.now()}`);
  await fsp.rename(source, destination);
  return destination;
}

/** เปิดโฟลเดอร์ในตัวจัดการไฟล์ของเครื่อง */
function openLocalPath(target) {
  let child;
  if (process.platform === "win32") {
    // ห้ามใส่ windowsHide ตรงนี้: Node แปลเป็น CREATE_NO_WINDOW ซึ่งทำให้ explorer.exe
    // ไม่ได้ผูกกับ window station ตามปกติ หน้าต่างจึงเปิดอยู่หลังเบราว์เซอร์และ Explorer
    // ก็มองไม่เห็นหน้าต่างเดิมของตัวเอง กดปุ่มทีก็เปิดใหม่ทีจนกองเป็นสิบบานโดยผู้ใช้
    // ไม่เห็นอะไรเลย — explorer.exe ไม่มีหน้าต่างคอนโซลอยู่แล้ว จึงไม่ต้องซ่อนอะไร
    child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", shell: false });
  } else if (process.platform === "darwin") {
    child = spawn("open", [target], { detached: true, stdio: "ignore", shell: false });
  } else {
    child = spawn("xdg-open", [target], { detached: true, stdio: "ignore", shell: false });
  }
  child.on("error", () => undefined);
  child.unref();
}

export function createApiHandler({ store, queue, version = "0.3.0", services = {} }) {
  if (!store || !queue) throw new TypeError("API requires store and queue");
  ensureDirectories();
  let ffmpegInstall = null;
  const generateScriptsImpl = services.generateScripts ?? generateScripts;
  const generateCaptionsImpl = services.generateCaptions ?? generateCaptions;
  const regenerateChunkImpl = services.regenerateChunk ?? regenerateChunk;
  const getSetupStatusImpl = services.getSetupStatus ?? getSetupStatus;
  const probeVideoImpl = services.probeVideo ?? probe;
  const checkTtsHealthImpl = services.checkTtsHealth ?? checkTtsHealth;
  // โหมด mock ใช้เสียงปลอมอยู่แล้ว การไปเช็ค Gemini จึงไม่มีประโยชน์และทำให้เทสต์ต้องต่อเน็ต
  const mockTtsEnabled = services.mockTts ?? process.env.CLIPPANG_MOCK_TTS === "1";

  return async function handleApi(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let pathname;
    try {
      // Decode exactly once so Thai/space filenames retain their real Unicode
      // name. Malformed percent escapes are a client error, never a process
      // crash outside the API error boundary.
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return apiError(400, "INVALID_URL_ENCODING", "ชื่อไฟล์หรือ URL มีรูปแบบไม่ถูกต้อง");
    }

    try {
      if (method === "GET" && pathname === "/api/health") {
        return json({ ok: true, local: true, product: "ClipPang Local", version, host: HOST });
      }

      if (method === "GET" && pathname === "/api/setup/status") {
        const status = await getSetupStatusImpl();
        return json({ ok: true, ...status, installing: ffmpegInstall?.running || false, installProgress: ffmpegInstall?.progress ?? null, paths: { input: PATHS.input, projects: PATHS.projects } });
      }

      if (method === "POST" && pathname === "/api/setup/ffmpeg") {
        if (ffmpegInstall?.running) return json({ ok: true, status: "installing", progress: ffmpegInstall.progress }, { status: 202 });
        ffmpegInstall = { running: true, progress: 0, message: "กำลังเตรียมดาวน์โหลด FFmpeg" };
        installFfmpeg({
          onProgress(event) {
            ffmpegInstall = { ...ffmpegInstall, ...event, running: true, progress: Number(event?.progress ?? ffmpegInstall.progress) };
          },
        }).then((result) => {
          ffmpegInstall = { running: false, progress: 100, message: "ติดตั้ง FFmpeg แล้ว", result };
        }).catch((error) => {
          ffmpegInstall = { running: false, progress: ffmpegInstall?.progress ?? 0, error: error.message, message: "โหลด FFmpeg ไม่สำเร็จ (เน็ตหลุด?) กดลองใหม่ หรือดาวน์โหลดเองแล้ววางไว้ที่ data/bin/" };
        });
        return json({ ok: true, status: "installing", progress: 0 }, { status: 202 });
      }

      if (method === "POST" && pathname === "/api/setup/key") {
        const body = await readJson(request);
        if (!body.key || String(body.key).trim().length < 16) return apiError(400, "INVALID_API_KEY", "API key ดูไม่ครบ กรุณาคัดลอกจาก Google AI Studio ใหม่อีกครั้ง");
        await testGeminiApiKey(String(body.key).trim(), { signal: request.signal });
        const result = await saveGeminiApiKey(String(body.key).trim());
        resetTtsHealthCache();
        return json({ ok: true, key: { configured: true, last4: result?.last4 ?? String(body.key).trim().slice(-4), masked: `••••${String(body.key).trim().slice(-4)}` } });
      }

      if (method === "GET" && pathname === "/api/input") {
        const entries = await fsp.readdir(PATHS.input, { withFileTypes: true });
        const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
          const stat = await fsp.stat(resolveUnderRoot(PATHS.input, entry.name));
          return { name: entry.name, size: stat.size, updatedAt: stat.mtime.toISOString(), url: `/api/assets/${encodeURIComponent(entry.name)}` };
        }));
        files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return json({ ok: true, files });
      }

      const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(pathname);
      if (assetMatch && method === "GET") {
        const filename = safeFilename(assetMatch[1]);
        return fileResponse(resolveUnderRoot(PATHS.input, filename), request);
      }
      if (assetMatch && method === "PUT") {
        const original = safeFilename(assetMatch[1]);
        const ext = path.extname(original).toLowerCase();
        const base = path.basename(original, ext);
        const uniqueSuffix = `-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        const reservedLength = Array.from(`${uniqueSuffix}${ext}`).length;
        const shortBase = Array.from(base).slice(0, Math.max(1, 160 - reservedLength)).join("");
        const filename = safeFilename(`${shortBase}${uniqueSuffix}${ext}`);
        const destination = resolveUnderRoot(PATHS.input, filename);
        const temporary = resolveUnderRoot(PATHS.input, `.${filename}.${randomUUID()}.upload`);
        try {
          const size = await streamUpload(request, temporary);
          await validateUploadedFile({ path: temporary, size, filename: original });
          let media;
          try {
            media = await probeVideoImpl(temporary, { signal: request.signal, timeoutMs: 30_000 });
          } catch (error) {
            if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
            throw Object.assign(
              new Error("อ่านข้อมูลวิดีโอไม่สำเร็จ กรุณาแปลงไฟล์เป็น MP4, MOV หรือ WebM แล้วลองใหม่"),
              { status: 415, code: "VIDEO_PROBE_FAILED" },
            );
          }
          // link() is same-volume, atomic and refuses EEXIST. Unlike rename on
          // Windows it can never overwrite an existing upload on collision.
          try {
            await fsp.link(temporary, destination);
          } catch (error) {
            if (!new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP"]).has(error?.code)) throw error;
            await fsp.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
          }
          await fsp.unlink(temporary);
          return json({
            ok: true,
            asset: {
              name: filename,
              originalName: original,
              size,
              durationMs: media.durationMs,
              width: media.width,
              height: media.height,
              url: `/api/assets/${encodeURIComponent(filename)}`,
            },
          }, { status: 201 });
        } finally {
          await fsp.rm(temporary, { force: true }).catch(() => {});
        }
      }

      if (method === "GET" && pathname === "/api/projects") {
        const projects = (store.listProjects?.() ?? []).map((item) => normalizeProject(item, store));
        return json({ ok: true, projects });
      }
      if (method === "POST" && pathname === "/api/projects") {
        const body = await readJson(request, { optional: true });
        const id = projectId(body.title || body.product?.name || "โปรเจกต์ใหม่");
        const product = normalizeProductMedia(body.product ?? body.product_json ?? {});
        const project = store.createProject({
          id,
          title: String(body.title || body.product?.name || "โปรเจกต์ใหม่").slice(0, 140),
          product,
          product_json: product,
          wizard_step: Number(body.wizardStep ?? body.wizard_step ?? 1),
        });
        for (const folder of ["src", "voice", "out", "work"]) await fsp.mkdir(safeProjectPath(id, folder), { recursive: true });
        return json({ ok: true, project: normalizeProject(project ?? store.getProject(id), store) }, { status: 201 });
      }

      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
      if (projectMatch) {
        const id = projectMatch[1];
        const existing = store.getProject(id);
        if (!existing) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้ อาจถูกย้ายหรือลบไปแล้ว");
        if (method === "GET") return json({ ok: true, project: normalizeProject(existing, store) });
        if (method === "PATCH") {
          const body = await readJson(request);
          const patch = { ...body };
          delete patch.id;
          delete patch.renders;
          delete patch.createdAt;
          delete patch.created_at;
          delete patch.updatedAt;
          delete patch.updated_at;
          if (body.title != null) patch.title = String(body.title).slice(0, 140);
          if (body.product != null || body.product_json != null) {
            patch.product = normalizeProductMedia(body.product ?? body.product_json);
            delete patch.product_json;
          }
          if (body.wizardStep != null || body.wizard_step != null) {
            patch.wizardStep = Number(body.wizardStep ?? body.wizard_step);
            delete patch.wizard_step;
          }
          const project = store.updateProject(id, patch);
          return json({ ok: true, project: normalizeProject(project ?? store.getProject(id), store) });
        }
        if (method === "DELETE") {
          await moveProjectToTrash(id);
          store.deleteProject(id);
          return json({ ok: true, recoverable: true, message: "ย้ายโปรเจกต์ไป data/trash แล้ว" });
        }
      }

      const scriptMatch = /^\/api\/projects\/([^/]+)\/script$/.exec(pathname);
      if (scriptMatch && method === "POST") {
        const project = store.getProject(scriptMatch[1]);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้");
        const body = await readJson(request);
        const existingProduct = parseMaybeJson(project.product ?? project.product_json, {});
        const brief = body.brief ?? existingProduct.brief ?? existingProduct;
        const generated = await generateScriptsImpl({
          brief,
          targetSec: Number(body.targetSec ?? 28),
          variants: 5,
          // ผู้ใช้เลือกผู้ให้บริการไว้ในหน้าตั้งค่า — auto = ตัวแรกที่ใช้ได้จริง (CLI มาก่อน API)
          provider: String(readStoreSettings(store).scriptProvider ?? "auto"),
          signal: request.signal,
        });
        const scripts = normalizeScriptsForClient(generated);
        const product = { ...existingProduct, brief, scripts };
        store.updateProject(project.id, { product, wizardStep: 4 });
        return json({ ok: true, scripts });
      }

      // แคปชั่นใต้โพสต์ + แฮชแท็ก สำหรับเอาไปวางตอนอัปโหลดคลิป
      // เก็บผลไว้ใน product เพื่อให้กลับมาหน้าเดิมแล้วยังเห็นชุดเดิม ไม่ต้องสร้างซ้ำ
      const captionMatch = /^\/api\/projects\/([^/]+)\/captions$/.exec(pathname);
      if (captionMatch && (method === "POST" || method === "GET")) {
        const project = store.getProject(captionMatch[1]);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้");
        const existingProduct = parseMaybeJson(project.product ?? project.product_json, {});
        if (method === "GET") return json({ ok: true, captions: existingProduct.captions ?? null });

        const body = await readJson(request, { optional: true });
        const brief = body.brief ?? existingProduct.brief ?? existingProduct;
        const scripts = Array.isArray(existingProduct.scripts) ? existingProduct.scripts : [];
        const chosen = scripts.find((script) => script.id === body.scriptId) ?? scripts[0];
        const generated = await generateCaptionsImpl(brief, {
          spoken: Array.isArray(chosen?.chunks) ? chosen.chunks : [],
          provider: String(readStoreSettings(store).scriptProvider ?? "auto"),
          signal: request.signal,
        });
        store.updateProject(project.id, { product: { ...existingProduct, captions: generated } });
        return json({ ok: true, captions: generated });
      }

      const chunkMatch = /^\/api\/projects\/([^/]+)\/script\/([^/]+)\/chunk\/(\d+)$/.exec(pathname);
      if (chunkMatch && method === "POST") {
        const project = store.getProject(chunkMatch[1]);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้");
        const body = await readJson(request, { optional: true });
        const product = parseMaybeJson(project.product ?? project.product_json, {});
        const scripts = normalizeScriptsForPipeline(body.scripts ?? product.scripts ?? []);
        const result = await regenerateChunkImpl({
          brief: body.brief ?? product.brief ?? product,
          scripts,
          variantId: chunkMatch[2],
          chunkIndex: Number(chunkMatch[3]),
          instruction: body.instruction,
          signal: request.signal,
        });
        return json({
          ok: true,
          chunk: scriptChunkText(result?.chunk ?? result),
          ...(result?.scripts ? { scripts: normalizeScriptsForClient(result.scripts) } : {}),
        });
      }

      if (method === "GET" && pathname === "/api/voices") return json({ ok: true, voices: await listVoices() });
      if (method === "GET" && pathname === "/api/styles") return json({ ok: true, styles: await listStyles() });

      const previewMatch = /^\/api\/voices\/([^/]+)\/preview$/.exec(pathname);
      if (previewMatch && method === "POST") {
        const body = await readJson(request, { optional: true });
        const preview = await synthesizePreview({
          voiceId: previewMatch[1],
          text: String(body.text || "สวัสดีค่ะ ClipPang พร้อมช่วยให้คลิปสินค้าของคุณน่าฟังขึ้น"),
          speed: Number(body.speed ?? 1),
          tone: body.tone ?? "เป็นกันเอง",
          signal: request.signal,
        });
        const file = typeof preview === "string" ? preview : preview.file;
        return fileResponse(file, request);
      }

      const rendersMatch = /^\/api\/projects\/([^/]+)\/renders$/.exec(pathname);
      if (rendersMatch && method === "POST") {
        const project = store.getProject(rendersMatch[1]);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้");
        const body = await readJson(request);
        if (!new Set(["draft", "final"]).has(body.kind)) return apiError(400, "INVALID_RENDER_KIND", "ชนิดงานต้องเป็นร่างหรือตัวจริง");

        // เช็คว่า Gemini TTS พร้อมก่อนเข้าคิว — ล้มตรงนี้ดีกว่าปล่อยให้งานวิ่งไป
        // ครึ่งทางแล้วค่อยตายตอนพากย์เสียง ซึ่งเสียเวลา ingest ไปฟรี ๆ
        // การเช็คใช้ models.get จึงไม่กินโควตา TTS (ดู server/tts-health.mjs)
        if (!mockTtsEnabled) {
          const health = await checkTtsHealthImpl({ signal: request.signal });
          if (!health.ok) {
            return apiError(503, `TTS_${health.code}`, health.reason, { model: health.model, checkedAt: health.checkedAt });
          }
        }
        const styleId = String(body.styleId ?? body.config?.styleId ?? "pop-yellow");
        const lane = renderLaneForStyle(styleId);
        const config = { ...body.config, ...body, kind: body.kind, styleId };
        delete config.config;
        const product = parseMaybeJson(project.product ?? project.product_json, {});
        const mediaPlan = resolveMediaPlan(config, product, { requireTimeline: true });
        if (mediaPlan) {
          // Freeze the exact edit decision list into the render. Later project
          // edits cannot silently change an already queued draft/final.
          config.assets = mediaPlan.assets;
          config.timelineClips = mediaPlan.timelineClips;
          config.selectedTotalMs = mediaPlan.selectedTotalMs;
          config.targetSec = mediaPlan.selectedTotalMs / 1000;
          config.editPlanHash = mediaPlan.editPlanHash;
        }
        const render = store.createRender({
          id: randomUUID(),
          projectId: project.id,
          kind: body.kind,
          lane,
          state: "queued",
          progress: 0,
          styleId,
          config,
        });
        queue.enqueue(render ?? store.getRender?.(render?.id));
        return json({ ok: true, renderId: render.id, render: normalizeRender(render) }, { status: 202 });
      }

      const renderGetMatch = /^\/api\/renders\/([^/]+)$/.exec(pathname);
      if (renderGetMatch && method === "GET") {
        const render = normalizeRender(store.getRender(renderGetMatch[1]));
        if (!render) return apiError(404, "RENDER_NOT_FOUND", "ไม่พบงานเรนเดอร์นี้");
        const project = store.getProject(render.projectId);
        return json({ ok: true, render: withOutputUrls(render, project) });
      }

      const promoteMatch = /^\/api\/renders\/([^/]+)\/promote$/.exec(pathname);
      if (promoteMatch && method === "POST") {
        const draft = normalizeRender(store.getRender(promoteMatch[1]));
        if (!draft || draft.kind !== "draft") return apiError(404, "DRAFT_NOT_FOUND", "ไม่พบร่างที่เลือก");
        if (draft.state !== "ready") return apiError(409, "DRAFT_NOT_READY", "ร่างนี้ยังสร้างไม่เสร็จ กรุณารอให้พร้อมก่อน");
        const project = store.getProject(draft.projectId);
        const product = parseMaybeJson(project?.product ?? project?.product_json, {});
        let currentPlan = null;
        try {
          currentPlan = resolveMediaPlan({}, product, { requireTimeline: true });
        } catch (error) {
          if (draft.config?.editPlanHash) {
            return apiError(409, "STALE_DRAFT", "ไทม์ไลน์เปลี่ยนไปแล้ว กรุณาสร้างร่างใหม่ก่อนสร้างตัวจริง");
          }
          throw error;
        }
        const draftPlanHash = draft.config?.editPlanHash ?? null;
        const currentPlanHash = currentPlan?.editPlanHash ?? null;
        if (draftPlanHash !== currentPlanHash) {
          return apiError(409, "STALE_DRAFT", "ไทม์ไลน์เปลี่ยนไปแล้ว กรุณาสร้างร่างใหม่ก่อนสร้างตัวจริง");
        }
        const body = await readJson(request, { optional: true });
        const styleId = String(body.styleId ?? draft.config?.styleId ?? draft.styleId ?? "kanit-hf");
        const position = body.position ?? body.captionPosition ?? draft.config?.position;
        const render = store.createRender({
          id: randomUUID(), projectId: draft.projectId, kind: "final", lane: renderLaneForStyle(styleId), state: "queued", progress: 0,
          styleId,
          config: {
            ...draft.config,
            kind: "final",
            styleId,
            ...(position ? { position } : {}),
            reuseRenderId: draft.id,
            timeline: draft.timeline,
            draftOutputs: draft.outputs,
          },
        });
        queue.enqueue(render);
        return json({ ok: true, renderId: render.id, render: normalizeRender(render) }, { status: 202 });
      }

      const cancelMatch = /^\/api\/renders\/([^/]+)\/cancel$/.exec(pathname);
      if (cancelMatch && method === "POST") {
        const render = store.getRender(cancelMatch[1]);
        if (!render) return apiError(404, "RENDER_NOT_FOUND", "ไม่พบงานเรนเดอร์นี้");
        queue.cancel(render.id);
        return json({ ok: true, render: normalizeRender(store.getRender(render.id)) });
      }

      const eventsMatch = /^\/api\/renders\/([^/]+)\/events$/.exec(pathname);
      if (eventsMatch && method === "GET") {
        const render = store.getRender(eventsMatch[1]);
        if (!render) return apiError(404, "RENDER_NOT_FOUND", "ไม่พบงานเรนเดอร์นี้");
        let unsubscribe = () => {};
        let heartbeat;
        let stopped = false;
        const body = new ReadableStream({
          start(controller) {
            const send = (event) => {
              if (stopped) return;
              const payload = JSON.stringify(event);
              controller.enqueue(new TextEncoder().encode(`event: progress\ndata: ${payload}\n\n`));
              if (isTerminalRenderState(event.state)) {
                stopped = true;
                clearInterval(heartbeat);
                unsubscribe();
                try { controller.close(); } catch {
                  // The client may have closed the EventSource first.
                }
              }
            };
            heartbeat = setInterval(() => {
              try {
                controller.enqueue(new TextEncoder().encode(`: keep-alive ${Date.now()}\n\n`));
              } catch {
                stopped = true;
                clearInterval(heartbeat);
                unsubscribe();
              }
            }, 15_000);
            unsubscribe = queue.subscribe(render.id, send);
            if (stopped) unsubscribe();
          },
          cancel() { stopped = true; clearInterval(heartbeat); unsubscribe(); },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
      }

      const fileMatch = /^\/api\/projects\/([^/]+)\/files\/([^/]+)$/.exec(pathname);
      if (fileMatch && method === "GET") {
        const project = store.getProject(fileMatch[1]);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้");
        const filename = safeFilename(fileMatch[2]);
        const outDir = typeof store.projectDir === "function"
          ? path.join(store.projectDir(project.id), "out")
          : safeProjectPath(project.id, "out");
        const outputFile = resolveUnderRoot(outDir, filename);
        const download = url.searchParams.get("download") === "1";
        return fileResponse(outputFile, request, download ? { downloadName: filename } : {});
      }

      if (method === "POST" && pathname === "/api/open") {
        const body = await readJson(request);
        const project = store.getProject(String(body.projectId || ""));
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์นี้");
        const target = body.target === "project" ? safeProjectPath(project.id) : safeProjectPath(project.id, "out");
        openLocalPath(target);
        return json({ ok: true });
      }

      if (method === "GET" && pathname === "/api/settings") {
        const setup = await getSetupStatusImpl();
        return json({ ok: true, settings: { ...readStoreSettings(store), inputFolder: PATHS.input, projectFolder: PATHS.projects, key: setup.key ?? setup.gemini, version } });
      }
      if (method === "PATCH" && pathname === "/api/settings") {
        const body = await readJson(request);
        for (const [key, value] of Object.entries(body)) {
          if (["geminiKey", "apiKey", "key"].includes(key)) continue;
          store.setSetting?.(key, settingValue(value));
        }
        return json({ ok: true, settings: readStoreSettings(store) });
      }
      // สถานะความพร้อมของเสียงพากย์ — หน้าเว็บเรียกได้บ่อยเท่าที่ต้องการ
      // เพราะเป็น metadata call ที่ไม่กินโควตา และผลถูกแคช 60 วินาที
      if (method === "GET" && pathname === "/api/tts/health") {
        const health = await checkTtsHealthImpl({
          force: url.searchParams.get("refresh") === "1",
          signal: request.signal,
        });
        return json({ ok: true, health });
      }

      // ---- คีย์ Gemini หลายใบ (failover) ----

      if (method === "POST" && pathname === "/api/tts/keys") {
        const body = await readJson(request);
        const key = String(body.key ?? "").trim();
        if (key.length < 16) return apiError(400, "INVALID_API_KEY", "API key ดูไม่ครบ กรุณาคัดลอกมาใหม่ทั้งชุด");
        const existing = listGeminiKeys();
        if (existing.some((entry) => entry.key === key)) {
          return apiError(409, "DUPLICATE_KEY", "คีย์นี้ใส่ไว้แล้ว — คีย์ซ้ำไม่ได้เพิ่มโควตา");
        }
        const slot = nextFreeSlot();
        if (!slot) return apiError(409, "NO_FREE_SLOT", `ใส่คีย์ได้สูงสุด ${MAX_KEYS} ใบ`);
        // ยืนยันว่าคีย์ใช้ได้จริงก่อนบันทึก ไม่งั้นผู้ใช้จะเพิ่งรู้ตอนเรนเดอร์ล้ม
        await testGeminiApiKey(key, { signal: request.signal });
        await saveGeminiApiKey(key, { keyName: slot });
        process.env[slot] = key;
        resetTtsHealthCache();
        return json({ ok: true, slot, last4: key.slice(-4) });
      }

      const ttsKeyMatch = /^\/api\/tts\/keys\/([A-Z0-9_]+)$/.exec(pathname);
      if (ttsKeyMatch && method === "DELETE") {
        const slot = ttsKeyMatch[1];
        if (!keySlots().includes(slot)) return apiError(404, "UNKNOWN_SLOT", "ไม่รู้จักช่องคีย์นี้");
        removeEnvValue(slot);
        delete process.env[slot];
        resetTtsHealthCache();
        return json({ ok: true, slot });
      }

      // ---- ผู้ให้บริการ AI สำหรับเขียนสคริปต์ ----

      if (method === "GET" && pathname === "/api/ai/providers") {
        const refresh = url.searchParams.get("refresh") === "1";
        const providers = await detectScriptProviders({ refresh });
        const selected = String(readStoreSettings(store).scriptProvider ?? "auto");
        return json({ ok: true, selected, providers });
      }

      if (method === "POST" && pathname === "/api/ai/providers/select") {
        const body = await readJson(request);
        const id = String(body.provider ?? "auto");
        const known = ["auto", "template", ...SCRIPT_PROVIDERS.map((provider) => provider.id)];
        if (!known.includes(id)) return apiError(400, "UNKNOWN_PROVIDER", `ไม่รู้จักผู้ให้บริการ "${id}"`);
        store.setSetting?.("scriptProvider", settingValue(id));
        return json({ ok: true, selected: id });
      }

      if (method === "POST" && pathname === "/api/ai/providers/key") {
        const body = await readJson(request);
        const provider = SCRIPT_PROVIDERS.find((item) => item.id === String(body.provider ?? ""));
        if (!provider || provider.kind !== "api") return apiError(400, "UNKNOWN_PROVIDER", "ผู้ให้บริการนี้ไม่ได้ใช้ API key");
        const key = String(body.key ?? "").trim();
        if (key.length < 16) return apiError(400, "INVALID_API_KEY", "API key ดูไม่ครบ กรุณาคัดลอกมาใหม่ทั้งชุด");
        // ใช้ตัวเขียน .env ตัวเดียวกับ Gemini เพื่อให้ได้การตรวจ symlink และการเขียนแบบ atomic เหมือนกัน
        const result = await saveGeminiApiKey(key, { keyName: provider.keyName });
        process.env[provider.keyName] = key;
        if (provider.keyName === "GEMINI_API_KEY") resetTtsHealthCache();
        return json({ ok: true, provider: provider.id, key: { configured: true, last4: result?.last4 ?? key.slice(-4) } });
      }

      if (method === "POST" && pathname === "/api/ai/providers/model") {
        const body = await readJson(request);
        const provider = SCRIPT_PROVIDERS.find((item) => item.id === String(body.provider ?? ""));
        if (!provider?.modelEnv) return apiError(400, "UNKNOWN_PROVIDER", "ผู้ให้บริการนี้เปลี่ยนชื่อรุ่นไม่ได้");
        const model = String(body.model ?? "").trim();
        if (!model || model.length > 120 || !/^[A-Za-z0-9._\-/:]+$/.test(model)) {
          return apiError(400, "INVALID_MODEL", "ชื่อรุ่นไม่ถูกต้อง");
        }
        await saveGeminiApiKey(model, { keyName: provider.modelEnv });
        process.env[provider.modelEnv] = model;
        return json({ ok: true, provider: provider.id, model });
      }

      // การแจ้งเตือน — คำนวณจาก renders + สถานะโควตา ไม่มีตารางของตัวเอง
      if (pathname === "/api/notifications") {
        const settings = readStoreSettings(store);
        const seenAt = Number(settings.notificationsSeenAt ?? 0);
        if (method === "POST") {
          const now = Date.now();
          store.setSetting?.("notificationsSeenAt", String(now));
          return json({ ok: true, seenAt: now });
        }
        let quota = null;
        try { quota = quotaStatus(); } catch { quota = null; }
        const items = buildNotifications({ store, quota });
        return json({ ok: true, items, unread: countUnread(items, seenAt), seenAt });
      }

      if (method === "POST" && pathname === "/api/settings/cache/clear") {
        const result = store.clearVoiceCache?.({ removeFiles: true }) ?? 0;
        return json({ ok: true, removed: result });
      }

      return apiError(404, "API_NOT_FOUND", "ไม่พบ API ที่เรียกใช้");
    } catch (error) {
      const storeStatus = {
        STORE_VALIDATION: 400,
        STORE_NOT_FOUND: 404,
        STORE_CONFLICT: 409,
        STORE_CORRUPT: 500,
      }[error.code];
      const status = Number(error.status || storeStatus || (error.code === "ENOENT" ? 404 : 500));
      const code = error.code || (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
      const message = status >= 500
        ? `เกิดข้อผิดพลาดใน ClipPang: ${error.message || "ไม่ทราบสาเหตุ"}`
        : error.message;
      if (status >= 500) console.error(`[ClipPang API] ${method} ${pathname}`, error);
      return apiError(status, code, message);
    }
  };
}
