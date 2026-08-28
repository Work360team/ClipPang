import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApiHandler } from "./api.mjs";
import {
  HOST, DEFAULT_PORT, PATHS, applyLegacyEnvAliases, ensureDirectories, migrateLegacyDatabase,
} from "./config.mjs";
import {
  clearLegacySessionCookie, createSession, loginPage, noteFailure, noteSuccess,
  markOwnerReady, ownerAccountReady, readSession, readSessionCookie, sessionCookie, sessionSecret,
  throttle, verifyPassword,
} from "./auth.mjs";
import { remoteHelpText as buildRemoteHelp } from "./remote-help.mjs";
import { tunnelStatus } from "./tunnel.mjs";
import { safeProjectPath } from "./security.mjs";
import { keySourceFor } from "./user-keys.mjs";
import { prepareSources } from "./sources.mjs";
import { createStore } from "./store/index.mjs";
import { RenderQueue } from "./queue.mjs";
import { recordSpeechSample } from "./speech-stats.mjs";
import { getSetupStatus } from "./setup.mjs";
import { discoverWhisper } from "./whisper-setup.mjs";
import { configureQuotaStore } from "../pipeline/tts-quota.mjs";
import { runPipeline } from "../pipeline/index.mjs";
import { timingForPace } from "../pipeline/core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** อ่าน .env แบบง่าย ๆ ไม่ทับค่าที่ตั้งมาจากภายนอกอยู่แล้ว */
function loadDotEnv(file) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] != null) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const CLIENT_ROOT = path.join(ROOT, "dist", "client");
const WORKER_ENTRY = path.join(ROOT, "dist", "server", "index.js");
const VERSION = "0.3.0";
// อ่าน .env ก่อนคำนวณค่าคงที่ด้านล่าง — ค่าพวกนี้ถูกอ่านตอน import ครั้งเดียว
// ถ้าปล่อยให้ pipeline ไปโหลด .env ทีหลัง โหมดระยะไกลจะไม่มีวันเปิดเลย
loadDotEnv(path.join(ROOT, ".env"));
// .env ที่ตั้งไว้ก่อนเปลี่ยนแบรนด์ยังใช้ชื่อ CLIPPANG_ อยู่ ต้องเทียบชื่อให้ก่อน
// อ่านค่าคงที่ด้านล่าง ไม่งั้นโหมดเข้าจากเครื่องอื่นจะปิดเงียบ ๆ หลังอัปเดต
applyLegacyEnvAliases();

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * เปิดให้เข้าจากเครื่องอื่น (เช่นมือถือ) แบบต้องตั้งใจเปิดเองเท่านั้น
 *
 * Clip360 Local ไม่มีระบบล็อกอิน และทำสิ่งที่ย้อนกลับไม่ได้บนเครื่องผู้ใช้ได้จริง
 * (ใช้โควตา Gemini ของเจ้าของเครื่อง อ่าน/ลบโปรเจกต์ เปิดโฟลเดอร์) ค่าเริ่มต้นจึงรับ
 * เฉพาะคำขอจากเครื่องตัวเอง ใครจะเปิดออกไปต้องระบุโฮสต์ที่อนุญาต "และ" ตั้งรหัสผ่าน
 * ไม่มีทางเปิดออกไปโดยไม่ตั้งรหัส เพราะนั่นคือการยกเครื่องให้คนทั้งอินเทอร์เน็ต
 */
const REMOTE_HOSTS = new Set(
  String(process.env.CLIP360_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);
const AUTH_USER = String(process.env.CLIP360_USER || "").trim();
const AUTH_HASH = String(process.env.CLIP360_PASSWORD_HASH || "").trim();

/**
 * มีบัญชีเจ้าของให้ล็อกอินหรือยัง
 *
 * เดิมดูจาก .env อย่างเดียว ซึ่งอ่านตอนโหลดโมดูลครั้งเดียว แปลว่าตั้งรหัสผ่านจากหน้า
 * ตั้งค่าแล้วต้องปิดเปิดโปรแกรมใหม่ถึงจะใช้ได้ ตัวจริงที่ล็อกอินเทียบด้วยคือแถวในตาราง
 * users อยู่แล้ว จึงถามจากตารางตรง ๆ ได้เลย
 */
if (AUTH_USER && AUTH_HASH.startsWith("scrypt$")) markOwnerReady();
const authReady = ownerAccountReady;

/**
 * โฮสต์นี้ได้รับอนุญาตให้เข้าจากข้างนอกไหม
 *
 * นอกจากรายชื่อใน .env แล้ว ยังรับโฮสต์ของอุโมงค์ที่กำลังเปิดอยู่ด้วย เพราะ URL ของ
 * quick tunnel สุ่มใหม่ทุกครั้งที่เปิด จะให้ผู้ใช้ไปแก้ .env แล้วรีสตาร์ททุกรอบไม่ได้
 * ตัวอุโมงค์เองเปิดไม่ได้ถ้ายังไม่มีรหัสผ่าน เกตนี้จึงไม่ได้หลวมลง
 */
function knownRemoteHost(hostname) {
  if (REMOTE_HOSTS.has(hostname)) return true;
  const active = tunnelStatus();
  return Boolean(active.running && active.host && active.host.toLowerCase() === hostname);
}

// ผูกกับ .env เท่านั้น เพราะเป็นการตัดสินใจตอนเปิดพอร์ต ซึ่งทำได้ครั้งเดียวตอนบูต
// อุโมงค์ไม่ต้องพึ่งค่านี้ เพราะมันต่อกลับเข้ามาที่ 127.0.0.1 เองอยู่แล้ว
const BIND_PUBLIC = REMOTE_HOSTS.size > 0 && Boolean(AUTH_USER) && AUTH_HASH.startsWith("scrypt$");
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

/**
 * ตรวจชื่อผู้ใช้และรหัสผ่านจากตาราง users แล้วออกคุกกี้เซสชันให้
 *
 * บัญชีใน .env (CLIP360_USER) ยังใช้ได้ในฐานะบัญชีตั้งต้น — ตอนเริ่มระบบจะถูก
 * ย้ายเข้าตาราง users ให้อัตโนมัติ (ดู ensureBootstrapUser) จากนั้นทุกอย่างอ่านจากตาราง
 */
async function handleLogin(request, ip, store) {
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

  const user = store.getUserByUsername?.(username) ?? null;
  const ok = Boolean(user) && !user.disabled && verifyPassword(password, user.passwordHash);
  if (!authReady() || !ok) {
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
      "set-cookie": sessionCookie(createSession(user, SECRET)),
    },
  });
}

/**
 * ทำให้มีบัญชีอย่างน้อยหนึ่งใบเสมอ และเป็นเจ้าของงานเก่าทั้งหมด
 *
 * เครื่องที่ใช้มาก่อนหน้านี้มีโปรเจกต์ที่ยังไม่มีเจ้าของ ถ้าไม่ยกให้ใครสักคน
 * พอเปิดโหมดหลายผู้ใช้ งานเดิมจะหายไปจากสายตาทุกคน
 */
function ensureBootstrapUser(store) {
  const users = store.listUsers?.() ?? [];
  let owner = users[0] ?? null;
  if (!owner && AUTH_USER && AUTH_HASH.startsWith("scrypt$")) {
    owner = store.createUser({ username: AUTH_USER, passwordHash: AUTH_HASH, role: "owner" });
  }
  if (owner) {
    // มีบัญชีจริงในตารางแล้ว = ล็อกอินได้ ไม่ต้องรอ .env
    markOwnerReady();
    const claimed = store.claimOrphanProjects?.(owner.id) ?? 0;
    if (claimed) process.stdout.write(`ยกโปรเจกต์เดิม ${claimed} รายการให้ ${owner.username}
`);
  }
  return owner;
}

function remoteHelpText(request) {
  let host = "";
  try { host = new URL(request.url).hostname; } catch { host = ""; }
  return buildRemoteHelp({ host, allowedHosts: REMOTE_HOSTS, hasUser: authReady(), hasHash: authReady() });
}

function hostAllowed(hostname) {
  return LOCAL_HOSTS.has(hostname) || (authReady() && knownRemoteHost(hostname.toLowerCase()));
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
  return Boolean(readSession(readSessionCookie(request.headers.get("cookie")), SECRET));
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
  // ฐานข้อมูลเดิมชื่อ clippang.db — ย้ายให้ก่อนเปิด ไม่งั้นจะสร้างไฟล์ว่างใหม่
  // แล้วโปรเจกต์กับผู้ใช้ทั้งหมดจะหายไปทั้งที่ข้อมูลยังอยู่ในไฟล์ชื่อเดิม
  // ทำเฉพาะตอนที่จะเปิด DB ตัวหลักเอง ถ้าผู้เรียกส่ง store มาให้ก็ไม่ต้องไปยุ่งกับไฟล์นั้น
  if (!providedStore) migrateLegacyDatabase(PATHS.database);
  // จำไว้ว่าคีย์ไหนโควตาหมด เพื่อไม่ให้เปิดโปรแกรมใหม่แล้วไปยิงคีย์ที่เต็มซ้ำ
  configureQuotaStore(path.join(PATHS.data, "tts-quota.json"));
  // บอก pipeline ว่า whisper.cpp อยู่ที่ไหน (ตั้ง WHISPER_CLI_PATH ให้)
  // ทำตรงนี้ให้ชัดเจน ไม่ฝากไว้กับ getSetupStatus ซึ่งเรียกเพื่อดูสถานะหน้าเว็บ —
  // ถ้าวันหนึ่งมันเลิกถูกเรียก การรวมคำขอจะเงียบไปเฉย ๆ โดยไม่มีใครรู้
  await discoverWhisper().catch(() => {});
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
    // งานนี้ใช้โควตาของเจ้าของโปรเจกต์ ไม่ใช่ของเครื่อง — คนที่ใส่คีย์ตัวเองไว้
    // จะยิงเข้าโควตาตัวเอง ส่วนคนที่ยังไม่ใส่ก็ใช้คีย์ของเครื่องเหมือนเดิม
    const ownerId = project.ownerId ?? project.owner_id ?? null;
    const keySource = keySourceFor(store, ownerId);
    const result = await runPipeline({
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
      // จังหวะเว้นวรรคระหว่างท่อนที่ผู้ใช้เลือกไว้ในขั้นเลือกเสียง
      timing: timingForPace(config.pace ?? config.voice?.pace),
      styleId: config.styleId ?? render.styleId ?? render.style_id ?? "pop-yellow",
      position: config.position ?? config.captionPosition ?? "bottom",
      captionColor: config.captionColor ?? null,
      kind: render.kind,
      ...(prepared.selectedTotalMs != null ? {
        targetSec: prepared.selectedTotalMs / 1000,
        selectedTotalMs: prepared.selectedTotalMs,
      } : {}),
      reuseFrom: config.reuseRenderId ? { renderId: config.reuseRenderId, timeline: config.timeline, outputs: config.draftOutputs } : null,
      mockTts: config.mockTts === true || process.env.CLIP360_MOCK_TTS === "1",
      geminiEnv: keySource.environment,
      onTtsRequest: ownerId ? () => store.recordUsage?.(ownerId, 1) : undefined,
      signal: render.signal,
      onProgress: render.onProgress,
    });
    // ความเร็วพูดจริงของงานนี้ ใช้ประเมินความยาวสคริปต์ครั้งต่อไป — ค่าที่วัดเอง
    // แม่นกว่าค่าคงที่ที่ฝังไว้ เพราะขึ้นกับเสียง ความเร็ว และรุ่นของ pipeline เสียง
    recordSpeechSample(store, result?.report?.speechSample);
    return result;
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
    const error = new Error("ยังไม่พบหน้าเว็บที่ build แล้ว กรุณารัน `npm run build` ก่อนเปิด Clip360 Local");
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

export function connectionAbortSignal(req, res) {
  const controller = new AbortController();
  const cleanup = () => {
    req.removeListener("aborted", onAborted);
    res.removeListener("close", onClose);
    res.removeListener("finish", onFinish);
  };
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
    cleanup();
  };
  function onAborted() { abort(); }
  function onClose() {
    // close หลัง writableEnded คือการปิดตามปกติ แต่ถ้ายังตอบไม่จบแปลว่าฝั่งเว็บ
    // กดยกเลิก/ปิดแท็บ ต้องส่งสัญญาณลงไปหยุด Codex, TTS หรือ ffmpeg ที่กำลังรออยู่
    if (!res.writableEnded) abort();
    else cleanup();
  }
  function onFinish() { cleanup(); }

  req.once("aborted", onAborted);
  res.once("close", onClose);
  res.once("finish", onFinish);
  return controller.signal;
}

function toWebRequest(req, port, signal) {
  const host = req.headers.host || `${HOST}:${port}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value != null) headers.set(name, value);
  }
  const init = { method: req.method, headers, signal };
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
  if (method === "HEAD" || !response.body) {
    // HEAD ไม่ส่งเนื้อไฟล์ แต่ body ถูกสร้างไว้แล้ว ถ้าไม่ยกเลิกทิ้ง fd ของไฟล์จะค้างเปิด
    response.body?.cancel?.().catch(() => undefined);
    return res.end();
  }
  try {
    await streamToNode(response.body, res);
  } catch (error) {
    // เบราว์เซอร์ยกเลิกคำขอกลางคันเป็นเรื่องปกติมากกับ <video> (เลื่อน/หยุด/เปลี่ยนคลิป)
    // ไม่ใช่ข้อผิดพลาดที่ต้องรายงาน
    if (!isAbortError(error) && !res.destroyed) res.destroy(error);
  }
}

function isAbortError(error) {
  return error?.code === "ERR_STREAM_PREMATURE_CLOSE" || error?.code === "ECONNRESET"
    || error?.code === "ERR_STREAM_DESTROYED" || error?.name === "AbortError";
}

/**
 * ต่อ body ของ web Response เข้ากับ response ของ Node
 *
 * ต้องใช้ pipeline ไม่ใช่ .pipe() — .pipe() ไม่ทำลายต้นทางเมื่อปลายทางถูกตัดกลางคัน
 * ซึ่งเกิดตลอดเวลากับ <video> (เบราว์เซอร์ยิง range request แล้วยกเลิกตอนเลื่อน/หยุด)
 * ผลคือ fs.createReadStream ของไฟล์วิดีโอค้างเปิดไว้จนกว่าจะปิดเซิร์ฟเวอร์ และบน Windows
 * ไฟล์ที่ยังมีคนถือ handle อยู่จะย้ายหรือลบโฟลเดอร์ไม่ได้ (EPERM) — คือสาเหตุที่ลบโปรเจกต์ไม่ได้
 */
function streamToNode(body, destination) {
  return streamPipeline(Readable.fromWeb(body), destination);
}

/**
 * พอร์ตนี้จองได้ไหม
 *
 * ต้องลองที่อยู่เดียวกับที่จะเปิดจริง ของเดิมลองที่ 127.0.0.1 เสมอ แต่ตอนเปิดโหมด
 * เข้าจากเครื่องอื่นจะไปเปิดที่ 0.0.0.0 — บน Windows การจอง 127.0.0.1 สำเร็จได้ทั้งที่
 * มีอีก process ถือ 0.0.0.0 อยู่ ผลคือตรวจว่าว่างแล้วไปตายตอนเปิดจริงด้วย EADDRINUSE
 */
function canListen(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host, port }, () => probe.close(() => resolve(true)));
  });
}

async function availablePort(start = DEFAULT_PORT, host = HOST) {
  for (let port = start; port < start + 40; port += 1) if (await canListen(port, host)) return port;
  throw new Error(`ไม่พบพอร์ตว่างตั้งแต่ ${start} ถึง ${start + 39}`);
}

function openBrowser(url) {
  if (process.env.CLIP360_NO_OPEN === "1" || process.env.NODE_ENV === "test") return;
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.unref();
}

export async function startLocalServer({ port: requestedPort } = {}) {
  const [runtime, getWebWorker] = await Promise.all([createLocalRuntime(), createWebWorkerLoader()]);
  // ต้องมีเจ้าของอย่างน้อยหนึ่งคนก่อนรับคำขอ ไม่งั้นงานเก่าจะไม่มีใครเห็น
  const bootstrapOwner = ensureBootstrapUser(runtime.store);
  const bindHost = BIND_PUBLIC ? "0.0.0.0" : HOST;
  const port = requestedPort ?? await availablePort(DEFAULT_PORT, bindHost);
  const server = http.createServer({ requestTimeout: 0, headersTimeout: 30_000 }, async (req, res) => {
    try {
      const request = toWebRequest(req, port, connectionAbortSignal(req, res));
      const requestUrl = new URL(request.url);
      const ip = req.socket.remoteAddress || "?";

      // เส้นทางล็อกอิน/ออกจากระบบต้องเข้าถึงได้ก่อนผ่านด่าน ไม่งั้นจะล็อกอินไม่ได้เลย
      if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
        return sendWebResponse(res, await handleLogin(request, ip, runtime.store), request.method);
      }
      // รับเฉพาะ POST — ถ้าเป็นลิงก์ GET ตัว prefetch ของเบราว์เซอร์หรือรูปที่ฝัง
      // ในหน้าอื่นกดแทนผู้ใช้ได้ กลายเป็นเตะคนออกจากระบบโดยที่เขาไม่ได้สั่ง
      if (requestUrl.pathname === "/api/auth/logout" && request.method === "POST") {
        // ล้างทั้งชื่อใหม่และชื่อเดิม ไม่งั้นคุกกี้เก่าที่ค้างอยู่จะพาเข้าระบบต่อได้
        const goodbye = new Headers({ location: "/" });
        goodbye.append("set-cookie", sessionCookie("", { clear: true }));
        goodbye.append("set-cookie", clearLegacySessionCookie());
        return sendWebResponse(res, new Response(null, { status: 303, headers: goodbye }), request.method);
      }

      // โลโก้กับ favicon ต้องโหลดได้ก่อนล็อกอิน ไม่งั้นหน้าล็อกอินจะไม่มีรูปให้ดู
      // เป็นไฟล์ภาพสาธารณะ ไม่มีข้อมูลของผู้ใช้อยู่ในนั้น
      const publicAsset = /^\/(favicon\.ico|clip360-logo(-\d+)?\.png)$/.test(requestUrl.pathname);

      // ใครเป็นคนขอ: เครื่องตัวเองถือเป็นเจ้าของเครื่อง ส่วนเครื่องอื่นมาจากคุกกี้เซสชัน
      const session = LOCAL_HOSTS.has(requestUrl.hostname)
        ? null
        : readSession(readSessionCookie(request.headers.get("cookie")), SECRET);
      let viewer = session?.id ? runtime.store.getUser?.(session.id) ?? null : bootstrapOwner;
      // เซสชันที่ออกก่อนการเปลี่ยนรหัสครั้งล่าสุดถือว่าใช้ไม่ได้แล้ว
      // และบัญชีที่ถูกปิดใช้งานต้องหลุดทันที ไม่ใช่รอคุกกี้หมดอายุ
      if (session && viewer && (viewer.disabled || (viewer.passwordChangedAt ?? 0) > (session.iat ?? 0))) {
        viewer = null;
      }
      // มีคุกกี้แต่ใช้ไม่ได้แล้ว = ต้องกลับไปหน้าล็อกอิน ไม่ใช่ปล่อยผ่านเป็นผู้ใช้ที่ไม่มีตัวตน
      const staleSession = Boolean(session) && !viewer;
      if (!publicAsset && (staleSession || !localRequestAllowed(request))) {
        // โฮสต์ที่อนุญาตไว้แล้วแต่ยังไม่ล็อกอิน → ให้หน้าล็อกอิน ไม่ใช่กำแพงเปล่า
        if (authReady() && knownRemoteHost(requestUrl.hostname.toLowerCase())) {
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
      if (url.pathname.startsWith("/api/")) {
        // local = คำขอมาจากเครื่องที่รัน Clip360 เอง ไม่ใช่ผู้ใช้ที่ล็อกอินจากที่อื่น
        // ใช้แยกสิทธิ์ระดับเครื่อง (เช่นคีย์ใน .env) ออกจากสิทธิ์ระดับบัญชี
        const apiContext = { viewer, local: LOCAL_HOSTS.has(url.hostname) };
        response = await runtime.api(request, apiContext);
        // เปลี่ยนรหัสผ่านแล้วเซสชันเดิมของตัวเองจะใช้ไม่ได้ทันทีเหมือนเครื่องอื่น
        // ออกคุกกี้ใหม่ให้เครื่องที่กดเปลี่ยน เพื่อไม่ให้เด้งกลับหน้าล็อกอินเอง
        if (apiContext.reissueSession && viewer) {
          response = new Response(response.body, response);
          response.headers.append("set-cookie", sessionCookie(createSession(viewer, SECRET)));
        }
      }
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
      console.error("[Clip360 Local]", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: { code: error.code || "INTERNAL_ERROR", message: error.message || "เกิดข้อผิดพลาด" } }));
      } else res.destroy(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // ผูกกับ 127.0.0.1 เสมอ ยกเว้นเปิดโหมดระยะไกลไว้ครบทั้งโฮสต์และรหัสผ่าน
    server.listen(port, bindHost, resolve);
  });
  const url = `http://${HOST}:${port}`;
  let setupReady = false;
  try {
    setupReady = Boolean((await getSetupStatus()).ready);
  } catch (error) {
    console.warn(`[Clip360 Local] ตรวจสถานะก่อนเปิดหน้าเว็บไม่สำเร็จ: ${error.message}`);
  }
  const launchUrl = setupReady ? url : `${url}/setup`;
  console.log(`\nClip360 Local พร้อมใช้งาน: ${url}`);
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
    console.log("กำลังปิด Clip360 Local…");
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // ---- กันโปรเซสตายเงียบ ----
  // เครื่องนี้ให้บริการอยู่จริง ถ้าโปรเซสหลุดไปโดยไม่มีใครรู้ เว็บก็ดับไปด้วย
  // และคนใช้งานอยู่จะเจอหน้าเปล่าโดยไม่มีคำอธิบาย

  // Promise ที่ไม่มีใครรับ error มักมาจากคำขอที่ถูกยกเลิกกลางคัน (เบราว์เซอร์ปิดวิดีโอ
  // ระหว่างสตรีม) ซึ่งไม่ได้ทำให้เซิร์ฟเวอร์เสียหาย — บันทึกไว้แล้วให้บริการต่อ
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error(`[Clip360 Local] มี Promise ที่ไม่ได้จัดการ: ${error.message}`);
    if (process.env.CLIP360_VERBOSE) console.error(error.stack);
  });

  // ข้อผิดพลาดระดับนี้แปลว่าสถานะในหน่วยความจำอาจเพี้ยนไปแล้ว ยกเว้นกลุ่มที่รู้แน่ว่า
  // เป็นเรื่องของ socket ฝั่งตรงข้ามล้วน ๆ — นอกนั้นปิดให้เรียบร้อยแล้วออกด้วยรหัส 1
  // เพื่อให้ตัวเปิดโปรแกรมสตาร์ตใหม่ ดีกว่ารันต่อทั้งที่สถานะพัง
  const SOCKET_NOISE = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED", "ERR_STREAM_PREMATURE_CLOSE"]);
  process.on("uncaughtException", (error) => {
    if (SOCKET_NOISE.has(error?.code)) {
      console.error(`[Clip360 Local] การเชื่อมต่อถูกตัดกลางคัน (${error.code}) — ทำงานต่อ`);
      return;
    }
    console.error(`[Clip360 Local] เกิดข้อผิดพลาดที่ไม่ได้จัดการ: ${error?.message}`);
    console.error(error?.stack || error);
    console.error("[Clip360 Local] กำลังปิดเพื่อให้ตัวเปิดโปรแกรมสตาร์ตใหม่");
    running.close().catch(() => undefined).finally(() => process.exit(1));
  });
}
