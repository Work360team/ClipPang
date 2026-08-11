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
import {
  generateScripts,
  listStyles,
  listVoices,
  regenerateChunk,
  synthesizePreview,
} from "../pipeline/index.mjs";
import { isTerminalRenderState, renderLaneForStyle } from "./queue.mjs";

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
  const product = project.product ?? project.product_json ?? {};
  const renders = (
    store.listProjectRenders?.(project.id)
      ?? store.listRenders?.({ projectId: project.id })
      ?? []
  ).map((render) => withOutputUrls(render, project));
  const wizardStep = project.wizardStep ?? project.wizard_step ?? 1;
  const createdAt = project.createdAt ?? project.created_at ?? null;
  const updatedAt = project.updatedAt ?? project.updated_at ?? null;
  return {
    ...project,
    product: parseMaybeJson(product, product),
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

function openLocalPath(target) {
  let child;
  if (process.platform === "win32") child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  else if (process.platform === "darwin") child = spawn("open", [target], { detached: true, stdio: "ignore", shell: false });
  else child = spawn("xdg-open", [target], { detached: true, stdio: "ignore", shell: false });
  child.unref();
}

export function createApiHandler({ store, queue, version = "0.2.0", services = {} }) {
  if (!store || !queue) throw new TypeError("API requires store and queue");
  ensureDirectories();
  let ffmpegInstall = null;
  const generateScriptsImpl = services.generateScripts ?? generateScripts;
  const regenerateChunkImpl = services.regenerateChunk ?? regenerateChunk;
  const getSetupStatusImpl = services.getSetupStatus ?? getSetupStatus;

  return async function handleApi(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const method = request.method.toUpperCase();

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
        const filename = safeFilename(`${base}-${Date.now().toString(36)}${ext}`);
        const destination = resolveUnderRoot(PATHS.input, filename);
        const temporary = resolveUnderRoot(PATHS.input, `.${filename}.${randomUUID()}.upload`);
        try {
          const size = await streamUpload(request, temporary);
          await validateUploadedFile({ path: temporary, size, filename: original });
          await fsp.rename(temporary, destination);
          return json({ ok: true, asset: { name: filename, originalName: original, size, url: `/api/assets/${encodeURIComponent(filename)}` } }, { status: 201 });
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
        const project = store.createProject({
          id,
          title: String(body.title || body.product?.name || "โปรเจกต์ใหม่").slice(0, 140),
          product: body.product ?? body.product_json ?? {},
          product_json: body.product ?? body.product_json ?? {},
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
            patch.product = body.product ?? body.product_json;
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
          signal: request.signal,
        });
        const scripts = normalizeScriptsForClient(generated);
        const product = { ...existingProduct, brief, scripts };
        store.updateProject(project.id, { product, wizardStep: 4 });
        return json({ ok: true, scripts });
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
        const styleId = String(body.styleId ?? body.config?.styleId ?? "pop-yellow");
        const lane = renderLaneForStyle(styleId);
        const config = { ...body.config, ...body, kind: body.kind, styleId };
        delete config.config;
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
