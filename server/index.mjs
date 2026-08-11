import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApiHandler } from "./api.mjs";
import { HOST, DEFAULT_PORT, PATHS, ensureDirectories } from "./config.mjs";
import { resolveUnderRoot, safeFilename, safeProjectPath } from "./security.mjs";
import { createStore } from "./store/index.mjs";
import { RenderQueue } from "./queue.mjs";
import { getSetupStatus } from "./setup.mjs";
import { runPipeline } from "../pipeline/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_ROOT = path.join(ROOT, "dist", "client");
const WORKER_ENTRY = path.join(ROOT, "dist", "server", "index.js");
const VERSION = "0.2.0";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const STATIC_MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".ico", "image/x-icon"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".ttf", "font/ttf"],
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".map", "application/json"],
]);

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function localRequestAllowed(request) {
  const url = new URL(request.url);
  if (!LOCAL_HOSTS.has(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return LOCAL_HOSTS.has(new URL(origin).hostname); } catch { return false; }
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

async function prepareSource(project, config, product) {
  const asset = config.assetName ?? config.asset?.name ?? product.assetName ?? product.asset?.name ?? product.source?.name;
  if (!asset) {
    const error = new Error("ยังไม่ได้เลือกคลิปต้นฉบับ กรุณากลับไปขั้น ‘คลิป’ แล้วอัปโหลดไฟล์ก่อน");
    error.code = "SOURCE_REQUIRED";
    throw error;
  }
  const filename = safeFilename(asset);
  const inputFile = resolveUnderRoot(PATHS.input, filename);
  await fsp.access(inputFile, fs.constants.R_OK);
  const sourceDir = safeProjectPath(project.id, "src");
  await fsp.mkdir(sourceDir, { recursive: true });
  const projectSource = resolveUnderRoot(sourceDir, filename);
  try {
    await fsp.access(projectSource);
  } catch {
    await fsp.copyFile(inputFile, projectSource);
  }
  return projectSource;
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
    const sourceFile = await prepareSource(project, config, product);
    return runPipeline({
      projectDir: safeProjectPath(project.id),
      sourceFile,
      sourceFiles: [sourceFile],
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

async function loadWebWorker() {
  await fsp.access(WORKER_ENTRY).catch(() => {
    const error = new Error("ยังไม่พบหน้าเว็บที่ build แล้ว กรุณารัน `npm run build` ก่อนเปิด ClipPang Local");
    error.code = "WEB_BUILD_MISSING";
    throw error;
  });
  const moduleUrl = pathToFileURL(WORKER_ENTRY);
  moduleUrl.searchParams.set("local", String(Date.now()));
  const workerModule = await import(moduleUrl.href);
  return workerModule.default;
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
  const [runtime, webWorker] = await Promise.all([createLocalRuntime(), loadWebWorker()]);
  const port = requestedPort ?? await availablePort(DEFAULT_PORT);
  const server = http.createServer({ requestTimeout: 0, headersTimeout: 30_000 }, async (req, res) => {
    try {
      const request = toWebRequest(req, port);
      if (!localRequestAllowed(request)) {
        return sendWebResponse(res, new Response("ClipPang Local รับคำขอจากเครื่องนี้เท่านั้น", { status: 403 }), request.method);
      }
      const url = new URL(request.url);
      let response;
      if (url.pathname.startsWith("/api/")) response = await runtime.api(request);
      else {
        const directAsset = await assetFetch(request);
        response = directAsset.status !== 404
          ? directAsset
          : await webWorker.fetch(request, {
            ASSETS: { fetch: assetFetch },
            IMAGES: {
              input() {
                return { transform() { return { output() { return { response: async () => new Response("Local image optimizer unavailable", { status: 501 }) }; } }; } };
              },
            },
          }, { waitUntil(promise) { promise.catch(console.error); }, passThroughOnException() {} });
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
    server.listen(port, HOST, resolve);
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
