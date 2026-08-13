import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApiHandler } from "./api.mjs";
import { HOST, DEFAULT_PORT, PATHS, ensureDirectories } from "./config.mjs";
import {
  SESSION_COOKIE, createSession, loginPage, noteFailure, noteSuccess,
  readCookie, readSession, sessionCookie, sessionSecret, throttle, verifyPassword,
} from "./auth.mjs";
import { remoteHelpText as buildRemoteHelp } from "./remote-help.mjs";
import { safeProjectPath } from "./security.mjs";
import { prepareSources } from "./sources.mjs";
import { createStore } from "./store/index.mjs";
import { RenderQueue } from "./queue.mjs";
import { getSetupStatus } from "./setup.mjs";
import { runPipeline } from "../pipeline/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_ROOT = path.join(ROOT, "dist", "client");
const WORKER_ENTRY = path.join(ROOT, "dist", "server", "index.js");
const VERSION = "0.3.0";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * เปิดให้เข้าจากเครื่องอื่น (เช่นมือถือ) แบบต้องตั้งใจเปิดเองเท่านั้น
 *
 * ClipPang Local ไม่มีระบบล็อกอิน และทำสิ่งที่ย้อนกลับไม่ได้บนเครื่องผู้ใช้ได้จริง
 * (ใช้โควตา Gemini ของเจ้าของเครื่อง อ่าน/ลบโปรเจกต์ เปิดโฟลเดอร์) ค่าเริ่มต้นจึงรับ
 * เฉพาะคำขอจากเครื่องตัวเอง ใครจะเปิดออกไปต้องระบุโฮสต์ที่อนุญาต "และ" ตั้งรหัสผ่าน
 * ไม่มีทางเปิดออกไปโดยไม่ตั้งรหัส เพราะนั่นคือการยกเครื่องให้คนทั้งอินเทอร์เน็ต
 */
const REMOTE_HOSTS = new Set(
  String(process.env.CLIPPANG_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);
const AUTH_USER = String(process.env.CLIPPANG_USER || "").trim();
const AUTH_HASH = String(process.env.CLIPPANG_PASSWORD_HASH || "").trim();
const REMOTE_READY = REMOTE_HOSTS.size > 0 && Boolean(AUTH_USER) && AUTH_HASH.startsWith("scrypt$");
const SECRET = sessionSecret(PATHS.data);

const STATIC_MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".ico", "image/x-icon"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".ttf", "font/ttf"],
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".map", "application/json"],
  [".mp3", "audio/mpeg"], [".wav", "audio/wav"], [".m4a", "audio/mp4"],
]);

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** ตรวจชื่อผู้ใช้และรหัสผ่าน แล้วออกคุกกี้เซสชันให้ */
async function handleLogin(request, ip) {
  const wait = throttle(ip);
  if (wait > 0) {
    return new Response(loginPage({ error: `ลองผิดหลายครั้งเกินไป รออีก ${Math.ceil(wait / 1000)} วินาที` }), {
      status: 429, headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const form = new URLSearchParams(await request.text());
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const nextPath = String(form.get("next") || "/");
  const userOk = username.length === AUTH_USER.length
    && crypto.timingSafeEqual(Buffer.from(username), Buffer.from(AUTH_USER));
  if (!REMOTE_READY || !userOk || !verifyPassword(password, AUTH_HASH)) {
    noteFailure(ip);
    // ไม่บอกว่าผิดที่ชื่อหรือรหัส เพื่อไม่ให้ไล่เดาชื่อผู้ใช้ได้
    return new Response(loginPage({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", nextPath }), {
      status: 401, headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  noteSuccess(ip);
  return new Response(null, {
    status: 303,
    headers: {
      location: /^\/[^\s"']*$/.test(nextPath) ? nextPath : "/",
      "set-cookie": sessionCookie(createSession(AUTH_USER, SECRET)),
    },
  });
}

function remoteHelpText(request) {
  let host = "";
  try { host = new URL(request.url).hostname; } catch { host = ""; }
  return buildRemoteHelp({ host, allowedHosts: REMOTE_HOSTS, hasUser: Boolean(AUTH_USER), hasHash: AUTH_HASH.startsWith("scrypt$") });
}

function hostAllowed(hostname) {
  return LOCAL_HOSTS.has(hostname) || (REMOTE_READY && REMOTE_HOSTS.has(hostname.toLowerCase()));
}

function localRequestAllowed(request) {
  const url = new URL(request.url);
  if (!hostAllowed(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (!hostAllowed(new URL(origin).hostname)) return false; } catch { return false; }
  }
  // โฮสต์ระยะไกลต้องมีรหัสเสมอ ส่วนเครื่องตัวเองไม่ต้อง จะได้ไม่เพิ่มขั้นตอนให้คนใช้ปกติ
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  return Boolean(readSession(readCookie(request.headers.get("cookie"), SESSION_COOKIE), SECRET));
}

function normalizeScriptChunks(chunks) {
  const list = Array.isArray(chunks) ? chunks : (typeof chunks === "string" ? [chunks] : []);
  return list.map((chunk, index) => {
    if (typeof chunk === "string") {
      return { i: index, text: chunk, role: index === 0 ? "hook" : "body", emphasis: [] };
    }
    return {
      ...chunk,
      i: chunk?.i ?? index,
      text: String(chunk?.text ?? ""),
      role: chunk?.role ?? (index === 0 ? "hook" : "body"),
      emphasis: Array.isArray(chunk?.emphasis) ? chunk.emphasis : [],
    };
  }).filter((chunk) => chunk.text.trim());
}

export function pickScript(config, product) {
  if (Array.isArray(config.script) && !config.script.some((item) => Array.isArray(item?.chunks))) {
    return normalizeScriptChunks(config.script);
  }
  const scripts = config.scripts ?? product.scripts ?? [];
  const variants = Array.isArray(config.script) && config.script.some((item) => Array.isArray(item?.chunks))
    ? config.script
    : scripts;
  const selected = variants.find?.(
    (item) => item.id === config.scriptId || item.id === config.variantId,
  ) ?? variants[0];
  return normalizeScriptChunks(
    selected?.chunks ?? selected?.lines ?? selected?.script ?? config.chunks ?? [],
  );
}

export async function createLocalRuntime({ store: providedStore, processor } = {}) {
  ensureDirectories();
  const store = providedStore ?? createStore({
    rootDir: PATHS.root,
    dataDir: PATHS.data,
    projectsDir: PATHS.projects,
    cacheDir: PATHS.ttsCache,
    dbPath: PATHS.database,
  });
  if (providedStore) store.init?.();
  store.reconcileProjects?.();

  const renderProcessor = processor ?? (async (render) => {
    const project = store.getProject(render.projectId ?? render.project_id);
    if (!project) throw Object.assign(new Error("ไม่พบโปรเจกต์ของงานเรนเดอร์นี้"), { code: "PROJECT_NOT_FOUND" });
    const config = parseJson(render.config ?? render.config_json, {});
    const product = parseJson(project.product ?? project.product_json, {});
    const prepared = await prepareSources(project, config, product, {
      signal: render.signal,
      onProgress: render.onProgress,
    });
    return runPipeline({
      projectDir: safeProjectPath(project.id),
      sourceFile: prepared.sourceFiles[0],
      sourceFiles: prepared.sourceFiles,
      sourceSelections: prepared.sourceSelections,
      clipPlan: prepared.clipPlan,
      editPlanHash: prepared.editPlanHash,
      brief: config.brief ?? product.brief ?? product,
      script: pickScript(config, product),
      variant: config.variant ?? config.scriptId ?? config.variantId,
      voice: {
        provider: config.provider ?? config.voice?.provider ?? "auto",
        id: config.voiceId ?? config.voice?.id ?? "Kore",
        speed: Number(config.speed ?? config.voice?.speed ?? 1),
        tone: config.tone ?? config.voice?.tone ?? "เป็นกันเอง",
      },
      styleId: config.styleId ?? render.styleId ?? render.style_id ?? "pop-yellow",
      position: config.position ?? config.captionPosition ?? "bottom",
      kind: render.kind,
      ...(prepared.selectedTotalMs != null ? {
        targetSec: prepared.selectedTotalMs / 1000,
        selectedTotalMs: prepared.selectedTotalMs,
      } : {}),
      reuseFrom: config.reuseRenderId ? { renderId: config.reuseRenderId, timeline: config.timeline, outputs: config.draftOutputs } : null,
      mockTts: config.mockTts === true || process.env.CLIPPANG_MOCK_TTS === "1",
      signal: render.signal,
      onProgress: render.onProgress,
    });
  });

  const queue = new RenderQueue({ store, processor: renderProcessor });
  await queue.recover();
  const api = createApiHandler({ store, queue, version: VERSION });
  let closed = false;
  return {
    store,
    queue,
    api,
    async close() {
      if (closed) return;
      closed = true;
      await queue.close();
      store.optimize?.();
      store.close?.();
    },
  };
}

async function webWorkerBuildSignature(entry) {
  const stat = await fsp.stat(entry).catch(() => {
    const error = new Error("ยังไม่พบหน้าเว็บที่ build แล้ว กรุณารัน `npm run build` ก่อนเปิด ClipPang Local");
    error.code = "WEB_BUILD_MISSING";
    throw error;
  });
  const buildId = await fsp.readFile(path.join(path.dirname(entry), "BUILD_ID"), "utf8")
    .then((value) => value.trim())
    .catch(() => "");
  return `${buildId}:${stat.mtimeMs}:${stat.size}`;
}

async function loadWebWorkerSnapshot(entry, cacheKey, loaderRoot) {
  const snapshotRoot = await fsp.mkdtemp(path.join(loaderRoot, "build-"));
  const snapshotServerRoot = path.join(snapshotRoot, "server");
  try {
    await fsp.cp(path.dirname(entry), snapshotServerRoot, { recursive: true });
  } catch (error) {
    await fsp.rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
  const snapshotEntry = path.join(snapshotServerRoot, path.basename(entry));
  const moduleUrl = pathToFileURL(snapshotEntry);
  moduleUrl.searchParams.set("local", `${cacheKey}:${Date.now()}:${Math.random()}`);
  try {
    const workerModule = await import(moduleUrl.href);
    return { worker: workerModule.default, snapshotRoot };
  } catch (error) {
    await fsp.rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function createWebWorkerLoader({
  entry = WORKER_ENTRY,
  snapshotBase = path.join(PATHS.cache, "web-workers"),
} = {}) {
  await fsp.mkdir(snapshotBase, { recursive: true });
  const loaderRoot = await fsp.mkdtemp(path.join(snapshotBase, "session-"));
  const snapshots = new Set();
  let currentSignature = null;
  let currentWorker = null;
  let refreshPromise = null;

  const loadCurrentBuild = async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const expectedSignature = await webWorkerBuildSignature(entry);
      try {
        const loaded = await loadWebWorkerSnapshot(entry, expectedSignature, loaderRoot);
        const settledSignature = await webWorkerBuildSignature(entry);
        if (settledSignature !== expectedSignature) {
          await fsp.rm(loaded.snapshotRoot, { recursive: true, force: true });
          continue;
        }
        snapshots.add(loaded.snapshotRoot);
        return { signature: settledSignature, worker: loaded.worker };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
    const error = new Error("หน้าเว็บกำลังอัปเดต กรุณาลองใหม่อีกครั้ง", { cause: lastError });
    error.code = "WEB_BUILD_CHANGING";
    throw error;
  };

  const initial = await loadCurrentBuild().catch(async (error) => {
    await fsp.rm(loaderRoot, { recursive: true, force: true });
    throw error;
  });
  currentSignature = initial.signature;
  currentWorker = initial.worker;

  async function getWebWorker() {
    const nextSignature = await webWorkerBuildSignature(entry);
    if (nextSignature === currentSignature) return currentWorker;

    if (!refreshPromise) {
      refreshPromise = (async () => {
        const loaded = await loadCurrentBuild();
        currentWorker = loaded.worker;
        currentSignature = loaded.signature;
        return currentWorker;
      })().finally(() => {
        refreshPromise = null;
      });
    }

    return refreshPromise;
  }

  getWebWorker.close = async () => {
    if (refreshPromise) await refreshPromise.catch(() => undefined);
    await fsp.rm(loaderRoot, { recursive: true, force: true });
    snapshots.clear();
  };
  return getWebWorker;
}

async function assetFetch(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const relative = pathname.replace(/^\/+/, "");
  const candidate = path.resolve(CLIENT_ROOT, relative);
  const rootWithSep = `${path.resolve(CLIENT_ROOT)}${path.sep}`;
  if (candidate !== path.resolve(CLIENT_ROOT) && !candidate.startsWith(rootWithSep)) return new Response("Not found", { status: 404 });
  try {
    const stat = await fsp.stat(candidate);
    if (!stat.isFile()) return new Response("Not found", { status: 404 });
    const headers = {
      "content-type": STATIC_MIME.get(path.extname(candidate).toLowerCase()) || "application/octet-stream",
      "content-length": String(stat.size),
      "cache-control": pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "private, max-age=0, must-revalidate",
    };
    return new Response(Readable.toWeb(fs.createReadStream(candidate)), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function toWebRequest(req, port) {
  const host = req.headers.host || `${HOST}:${port}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value != null) headers.set(name, value);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(`http://${host}${req.url || "/"}`, init);
}

async function sendWebResponse(res, response, method = "GET") {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  if (method === "HEAD" || !response.body) return res.end();
  try {
    await streamToNode(response.body, res);
  } catch (error) {
    if (!res.destroyed) res.destroy(error);
  }
}

function streamToNode(body, destination) {
  return new Promise((resolve, reject) => {
    const source = Readable.fromWeb(body);
    source.on("error", reject);
    destination.on("error", reject);
    destination.on("finish", resolve);
    source.pipe(destination);
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host: HOST, port }, () => probe.close(() => resolve(true)));
  });
}

async function availablePort(start = DEFAULT_PORT) {
  for (let port = start; port < start + 40; port += 1) if (await canListen(port)) return port;
  throw new Error(`ไม่พบพอร์ตว่างตั้งแต่ ${start} ถึง ${start + 39}`);
}

function openBrowser(url) {
  if (process.env.CLIPPANG_NO_OPEN === "1" || process.env.NODE_ENV === "test") return;
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.unref();
}

export async function startLocalServer({ port: requestedPort } = {}) {
  const [runtime, getWebWorker] = await Promise.all([createLocalRuntime(), createWebWorkerLoader()]);
  const port = requestedPort ?? await availablePort(DEFAULT_PORT);
  const server = http.createServer({ requestTimeout: 0, headersTimeout: 30_000 }, async (req, res) => {
    try {
      const request = toWebRequest(req, port);
      const requestUrl = new URL(request.url);
      const ip = req.socket.remoteAddress || "?";

      // เส้นทางล็อกอิน/ออกจากระบบต้องเข้าถึงได้ก่อนผ่านด่าน ไม่งั้นจะล็อกอินไม่ได้เลย
      if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
        return sendWebResponse(res, await handleLogin(request, ip), request.method);
      }
      if (requestUrl.pathname === "/api/auth/logout") {
        return sendWebResponse(res, new Response(null, {
          status: 303,
          headers: { location: "/", "set-cookie": sessionCookie("", { clear: true }) },
        }), request.method);
      }

      if (!localRequestAllowed(request)) {
        // โฮสต์ที่อนุญาตไว้แล้วแต่ยังไม่ล็อกอิน → ให้หน้าล็อกอิน ไม่ใช่กำแพงเปล่า
        if (REMOTE_READY && REMOTE_HOSTS.has(requestUrl.hostname.toLowerCase())) {
          if (requestUrl.pathname.startsWith("/api/")) {
            return sendWebResponse(res, new Response(JSON.stringify({ ok: false, error: { code: "AUTH_REQUIRED", message: "ต้องเข้าสู่ระบบก่อน" } }), {
              status: 401, headers: { "content-type": "application/json; charset=utf-8" },
            }), request.method);
          }
          return sendWebResponse(res, new Response(loginPage({ nextPath: requestUrl.pathname }), {
            status: 401, headers: { "content-type": "text/html; charset=utf-8" },
          }), request.method);
        }
        return sendWebResponse(res, new Response(remoteHelpText(request), {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }), request.method);
      }
      const url = requestUrl;
      let response;
      if (url.pathname.startsWith("/api/")) response = await runtime.api(request);
      else {
        const directAsset = await assetFetch(request);
        if (directAsset.status !== 404) response = directAsset;
        else {
          const webWorker = await getWebWorker();
          response = await webWorker.fetch(request, {
            ASSETS: { fetch: assetFetch },
            IMAGES: {
              input() {
                return { transform() { return { output() { return { response: async () => new Response("Local image optimizer unavailable", { status: 501 }) }; } }; } };
              },
            },
          }, { waitUntil(promise) { promise.catch(console.error); }, passThroughOnException() {} });
        }
      }
      await sendWebResponse(res, response, request.method);
    } catch (error) {
      console.error("[ClipPang Local]", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: { code: error.code || "INTERNAL_ERROR", message: error.message || "เกิดข้อผิดพลาด" } }));
      } else res.destroy(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // ผูกกับ 127.0.0.1 เสมอ ยกเว้นเปิดโหมดระยะไกลไว้ครบทั้งโฮสต์และรหัสผ่าน
    server.listen(port, REMOTE_READY ? "0.0.0.0" : HOST, resolve);
  });
  const url = `http://${HOST}:${port}`;
  let setupReady = false;
  try {
    setupReady = Boolean((await getSetupStatus()).ready);
  } catch (error) {
    console.warn(`[ClipPang Local] ตรวจสถานะก่อนเปิดหน้าเว็บไม่สำเร็จ: ${error.message}`);
  }
  const launchUrl = setupReady ? url : `${url}/setup`;
  console.log(`\nClipPang Local พร้อมใช้งาน: ${url}`);
  console.log(`ข้อมูลทั้งหมดอยู่ที่: ${PATHS.projects}\n`);
  openBrowser(launchUrl);

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await runtime.close();
    await getWebWorker.close?.();
  };
  return { server, runtime, port, url, launchUrl, close };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const running = await startLocalServer();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log("กำลังปิด ClipPang Local…");
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
