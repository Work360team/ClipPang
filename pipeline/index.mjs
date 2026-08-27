import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRunName,
  ensureDir,
  loadEnv,
  readJson,
  sha256,
  throwIfAborted,
  writeJson,
} from "./lib.mjs";
import {
  ANCHORS,
  buildChunkTimeline,
  buildOrderedSourcePlan,
  buildPieces,
  chunkText,
  fitToDuration,
  normalizeAnchor,
  padNarrationTimeline,
  planNarrationFit,
  trimSourcePlan,
} from "./core.mjs";
import {
  detectBurnedCaptions as detectBurnedCaptionsInFile,
  detectScenes,
  ffmpegAvailable,
  isVideo,
  probe,
  shotScore,
} from "./media.mjs";
import { estimateMs, generateScript } from "./script.mjs";
import { sampleChunks, speechKey } from "./speech-rate.mjs";
import { toSpokenThai } from "./thai-speech.mjs";
import { CAPTION_COLOR_SETS, applyColorSet, captionColorSet } from "./caption-colors.mjs";
import {
  DEFAULT_VOICE,
  VOICES,
  concurrencyFor,
  resolveProvider,
  synthesize,
  synthesizeAll,
} from "./tts.mjs";
import { readClone } from "./voice-clones.mjs";
import { fitNarrationToTimeline } from "./narration-fit.mjs";
import { compileAss, compileSrt } from "./ass.mjs";
import { AlphaOverlayError, renderOverlay } from "./hyperframes.mjs";
import { buildVideoTrack, buildVoiceTrack, burnAndMux, poster } from "./render.mjs";

const PIPELINE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(PIPELINE_ROOT, "..");
const FONTS_DIR = path.join(PIPELINE_ROOT, "fonts");
const STYLES_DIR = path.join(PIPELINE_ROOT, "styles");

/** หาเพศจากเสียงที่เลือกสำหรับทางเข้า pipeline ที่ไม่ได้ผ่าน Local API */
export function speakerGenderForVoice(voice = {}) {
  const config = typeof voice === "string" ? { id: voice } : (voice ?? {});
  const id = config.id ?? config.voiceId;
  if (!id) return null;
  if (config.provider === "jaitts") return readClone(id)?.gender ?? null;
  const providers = config.provider && config.provider !== "auto" ? [config.provider] : Object.keys(VOICES);
  for (const provider of providers) {
    const found = VOICES[provider]?.find((item) => item.id === id);
    if (found?.gender) return found.gender;
  }
  return null;
}

const STYLE_ALIASES = new Map([
  ["pop-yellow", "karaoke-pop"],
  ["pop", "karaoke-pop"],
  ["karaoke-pop", "karaoke-pop"],
  ["clean", "reveal-clean"],
  ["clean-white", "reveal-clean"],
  ["reveal-clean", "reveal-clean"],
  ["boxed", "box-bold"],
  ["box-black", "box-bold"],
  ["box-bold", "box-bold"],
  ["karaoke", "kanit-hf"],
  ["premium", "kanit-hf"],
  ["kanit-hf", "kanit-hf"],
]);

function hydrateEnvironment(projectDir) {
  loadEnv(WORKSPACE_ROOT);
  if (projectDir) loadEnv(path.resolve(projectDir));
}

function canonicalStyleId(value) {
  return STYLE_ALIASES.get(String(value || "karaoke-pop").toLowerCase()) || String(value || "karaoke-pop");
}

function resolveStyle(styleId, position, colorSetId) {
  const id = canonicalStyleId(styleId);
  const file = path.join(STYLES_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    const error = new Error(`ไม่รู้จักสไตล์ซับ "${styleId}"`);
    error.code = "STYLE_NOT_FOUND";
    throw error;
  }

  const style = readJson(file);
  style.params = structuredClone(style.params || {});
  style.params.position ||= {};
  style.params.font ||= {};

  if (typeof position === "string") {
    // UI เก็บตำแหน่งเป็นภาษาไทยตามที่ผู้ใช้กด (project.json มี "position":"ล่าง")
    // แล้วแปลงเป็นอังกฤษก่อนส่งเรนเดอร์ ถ้าผู้เรียกไหนส่งค่าที่เก็บไว้มาตรง ๆ จะพัง
    // ทั้งที่ค่านั้นถูกต้องในมุมผู้ใช้ จึงรับทั้งสองภาษาแล้วแปลงที่จุดเดียวตรงนี้
    const canonical = { "บน": "top", "กลาง": "middle", "ล่าง": "bottom" }[position.trim()] ?? position;
    if (!/^(top|middle|bottom|center)/i.test(canonical)) {
      throw new Error(`ตำแหน่งซับรับได้แค่ ${ANCHORS.join(" | ")} หรือ บน | กลาง | ล่าง`);
    }
    style.params.position.anchor = normalizeAnchor(canonical);
  } else if (position && typeof position === "object") {
    if (position.anchor) style.params.position.anchor = normalizeAnchor(position.anchor);
    if (position.marginV != null) style.params.position.marginV = Number(position.marginV);
    if (position.marginH != null) style.params.position.marginH = Number(position.marginH);
  }

  // ชุดสีทาทับหลังโหลดสไตล์ ใช้ทางเดียวกับตำแหน่งซับ คือ override ที่จุดเดียวตรงนี้
  // งานเรนเดอร์ทุกเลนจึงได้ params ชุดเดียวกันโดยไม่ต้องรู้เรื่องชุดสีเลย
  const colorSet = captionColorSet(colorSetId);
  if (colorSet) {
    applyColorSet(style.params, colorSet);
    style.colorSetId = colorSet.id;
  }

  style.params.position.anchor = normalizeAnchor(style.params.position.anchor);
  style.params.font.family ||= "Kanit";
  style.params.font.file ||= style.params.font.weight >= 800 ? "Kanit-ExtraBold.ttf" : "Kanit-Bold.ttf";
  const fontFile = path.join(FONTS_DIR, style.params.font.file);
  if (!fs.existsSync(fontFile)) throw new Error(`ไม่พบฟอนต์ ${style.params.font.file}`);
  return style;
}

function inferVoiceProvider(voiceId) {
  for (const [provider, voices] of Object.entries(VOICES)) {
    if (voices.some((voice) => voice.id === voiceId)) return provider;
  }
  return null;
}

function providerAvailable(provider) {
  try {
    resolveProvider(provider);
    return true;
  } catch {
    return false;
  }
}

export { CAPTION_COLOR_SETS, captionColorSet };

export async function listStyles() {
  return fs.readdirSync(STYLES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(STYLES_DIR, file)))
    .sort((a, b) => a.name.localeCompare(b.name, "th"))
    .map((style) => ({
      id: style.slug,
      slug: style.slug,
      name: style.name,
      lane: style.lane,
      tier: style.tier,
      description: style.description,
      params: style.params,
    }));
}

export async function listVoices() {
  hydrateEnvironment();
  // This is the public product catalog. Internal fallback providers (Edge,
  // mock and silence) remain available to the renderer, but exposing them here
  // made the 30-voice selector unexpectedly show 34 entries.
  return VOICES.gemini.map((voice) => ({
    ...voice,
    provider: "gemini",
    available: providerAvailable("gemini"),
    isDefault: DEFAULT_VOICE.gemini === voice.id,
  }));
}

/** App-facing wrapper around the script module. */
export async function generateScripts(input, options = {}) {
  const args = input?.brief ? input : { ...options, brief: input };
  hydrateEnvironment(args.projectDir);
  const result = await generateScript(args.brief, {
    targetSec: Number(args.targetSec ?? 28),
    variants: Number(args.variants ?? 5),
    provider: process.env.CLIP360_MOCK_TTS === "1" ? "template" : args.provider ?? "auto",
    charsPerSec: args.charsPerSec,
    // ความเร็วพูดที่วัดได้จริงของเสียงที่จะใช้ และจังหวะเว้นวรรคที่ผู้ใช้เลือก
    // สองอย่างนี้กำหนดว่าสคริปต์ควรยาวแค่ไหนถึงจะพูดเต็มคลิปพอดี
    speech: args.speech,
    timing: args.timing,
    // ภาษาไทยลงท้ายต่างกันตามเพศผู้พูด สคริปต์ต้องรู้ก่อนเขียน
    speakerGender: args.speakerGender ?? speakerGenderForVoice(args.voice),
    timeoutMs: args.timeoutMs,
    signal: args.signal,
  });
  // The local API stores this value directly in product.scripts and expects an
  // array it can .find() by variant id. Provider metadata remains available via
  // the low-level generateScript() export.
  return result.variants;
}

function cloneScripts(scripts) {
  if (Array.isArray(scripts)) return { doc: { provider: "user", variants: structuredClone(scripts) }, arrayInput: true };
  if (scripts?.variants) return { doc: structuredClone(scripts), arrayInput: false };
  return { doc: { provider: "user", variants: [] }, arrayInput: false };
}

/**
 * Regenerate just one editable chunk. The LLM is asked for one fresh short
 * script and we select a chunk with the same role; offline template generation
 * remains available when no key is configured.
 */
export async function regenerateChunk({
  brief,
  scripts,
  variantId,
  chunkIndex,
  instruction = "",
  provider = "auto",
  speakerGender,
  voice,
  signal,
} = {}) {
  hydrateEnvironment();
  throwIfAborted(signal);
  const { doc, arrayInput } = cloneScripts(scripts);
  const variant = doc.variants.find((item) => item.id === variantId) || doc.variants[0];
  if (!variant) throw new Error("ไม่พบเวอร์ชันสคริปต์ที่ต้องการแก้");
  const index = Number(chunkIndex);
  const current = variant.chunks?.[index];
  if (!current) throw new Error("ไม่พบท่อนสคริปต์ที่ต้องการแก้");

  const adjustedBrief = {
    ...brief,
    tone: [brief?.tone, instruction].filter(Boolean).join(" · "),
  };
  const generated = await generateScript(adjustedBrief, {
    targetSec: Math.max(8, Math.round((estimateMs(current.text) / 1000) * 4)),
    variants: 1,
    provider: process.env.CLIP360_MOCK_TTS === "1" ? "template" : provider,
    speakerGender: speakerGender ?? speakerGenderForVoice(voice),
    signal,
  });
  const candidates = generated.variants[0]?.chunks || [];
  const firstFeature = Array.isArray(brief?.features)
    ? brief.features[0]
    : String(brief?.features || "").split(/[,/\n;]+/)[0];
  const replacement =
    candidates.find((item) => item.role === current.role && item.text !== current.text) ||
    candidates.find((item) => item.text !== current.text) ||
    { text: chunkText(firstFeature || brief?.name || "น่าใช้มาก")[0], role: current.role, emphasis: [] };
  const chunk = { ...current, ...replacement, i: current.i ?? index, role: current.role };
  variant.chunks[index] = chunk;
  const updatedScripts = arrayInput ? doc.variants : doc;
  return { chunk, scripts: updatedScripts, provider: generated.provider };
}

/** Generate a cached WAV preview suitable for an HTTP response. */
export async function synthesizePreview({
  voiceId,
  provider,
  geminiEnv,
  onRequest,
  text = "สวัสดีค่ะ Clip360 พร้อมช่วยให้คลิปสินค้าของคุณน่าฟังขึ้น",
  speed = 1,
  tone = "เป็นกันเอง",
  signal,
  outDir,
  mock = false,
} = {}) {
  hydrateEnvironment();
  const forceMock = mock || process.env.CLIP360_MOCK_TTS === "1";
  const selectedProvider = forceMock ? "mock" : provider || inferVoiceProvider(voiceId) || resolveProvider("auto");
  const selectedVoice = selectedProvider === "mock" ? DEFAULT_VOICE.mock : voiceId || DEFAULT_VOICE[selectedProvider];
  resolveProvider(selectedProvider);
  const root = ensureDir(path.resolve(outDir || path.join(os.tmpdir(), "clip360", "voice-previews")));
  const key = sha256([selectedProvider, selectedVoice, speed, tone, text].join("\0")).slice(0, 24);
  const file = path.join(root, `preview-${key}.wav`);
  return synthesize({
    text,
    provider: selectedProvider,
    voice: selectedVoice,
    speed,
    styleHint: tone ? `พูดโทน${tone}` : "",
    outFile: file,
    cacheDir: ensureDir(path.join(root, "cache")),
    signal,
    geminiEnv,
    onRequest,
  });
}

function normalizeVariant(variant, fallbackId = "v1") {
  if (!variant?.chunks?.length) throw new Error("สคริปต์ที่เลือกไม่มีข้อความสำหรับพากย์");
  const chunks = [];
  for (const source of variant.chunks) {
    for (const text of chunkText(String(source.text || ""))) {
      if (!text) continue;
      chunks.push({
        i: chunks.length,
        text,
        role: source.role || (chunks.length === 0 ? "hook" : "body"),
        emphasis: Array.isArray(source.emphasis) ? source.emphasis : [],
      });
    }
  }
  if (!chunks.length) throw new Error("สคริปต์ที่เลือกไม่มีข้อความสำหรับพากย์");
  return { ...variant, id: variant.id || fallbackId, chunks };
}

function scriptInputToDocument(script, variant) {
  if (variant && typeof variant === "object" && variant.chunks) {
    return { provider: "user", variants: [normalizeVariant(variant)] };
  }
  if (Array.isArray(script)) {
    if (script.length === 0) return null;
    const looksLikeVariants = script.some((item) => Array.isArray(item?.chunks));
    return {
      provider: "user",
      variants: looksLikeVariants
        ? script.map((item, index) => normalizeVariant(item, `v${index + 1}`))
        : [normalizeVariant({ id: "v1", chunks: script })],
    };
  }
  if (script?.variants) {
    return { ...script, variants: script.variants.map((item, index) => normalizeVariant(item, `v${index + 1}`)) };
  }
  if (script?.chunks) return { provider: "user", variants: [normalizeVariant(script)] };
  return null;
}

function sanitizeTimeline(timeline) {
  return {
    ...timeline,
    chunks: timeline.chunks.map((chunk) => {
      const sanitized = { ...chunk };
      delete sanitized.audioFile;
      return sanitized;
    }),
  };
}

function outputInfo(file) {
  const stat = fs.statSync(file);
  return { path: file, filename: path.basename(file), sizeBytes: stat.size };
}

function reuseError(message, code = "REUSE_ARTIFACT_INVALID") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseReuseJson(value, label) {
  if (value && typeof value === "object") return structuredClone(value);
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      throw reuseError(`ข้อมูล ${label} ของร่างเสียหาย กรุณาสร้างร่างใหม่`);
    }
  }
  return null;
}

function isWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function reusableOutput(outputs, key, projectDir, { optional = false } = {}) {
  const value = outputs?.[key];
  const storedPath = typeof value === "string" ? value : value?.path;
  if (!storedPath) {
    if (optional) return null;
    throw reuseError(`ร่างเดิมไม่มีไฟล์ ${key} กรุณาสร้างร่างใหม่`, "REUSE_ARTIFACT_MISSING");
  }
  const candidate = path.resolve(projectDir, storedPath);
  if (!isWithin(projectDir, candidate)) {
    throw reuseError(`ไฟล์ ${key} ของร่างอยู่นอกโฟลเดอร์โปรเจกต์`);
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw reuseError(`หาไฟล์ ${key} ของร่างไม่พบ กรุณาสร้างร่างใหม่`, "REUSE_ARTIFACT_MISSING");
  }
  return candidate;
}

function loadReuseContext(reuseFrom, projectDir, sourceFiles) {
  if (!reuseFrom) return null;
  const timeline = parseReuseJson(reuseFrom.timeline, "timeline");
  const outputs = parseReuseJson(reuseFrom.outputs, "outputs") || {};
  if (!timeline || !Array.isArray(timeline.chunks) || timeline.chunks.length === 0) {
    throw reuseError("ร่างเดิมไม่มี timeline ที่ใช้ซ้ำได้ กรุณาสร้างร่างใหม่", "REUSE_ARTIFACT_MISSING");
  }
  if (!Number.isFinite(Number(timeline.durationMs)) || Number(timeline.durationMs) <= 0) {
    throw reuseError("ความยาว timeline ของร่างไม่ถูกต้อง");
  }
  if (!Array.isArray(timeline.segments) || timeline.segments.length === 0) {
    throw reuseError("ร่างเดิมไม่มีลำดับภาพที่ใช้ซ้ำได้ กรุณาสร้างร่างใหม่", "REUSE_ARTIFACT_MISSING");
  }

  const allowedSources = new Set(sourceFiles.map((file) => path.resolve(file)));
  timeline.segments = timeline.segments.map((segment) => {
    const source = path.resolve(String(segment?.src || ""));
    if ((!isWithin(projectDir, source) && !allowedSources.has(source)) || !fs.existsSync(source)) {
      throw reuseError("คลิปต้นทางของร่างถูกย้ายหรือลบ กรุณาสร้างร่างใหม่", "REUSE_ARTIFACT_MISSING");
    }
    return { ...segment, src: source };
  });

  const voiceFile = reusableOutput(outputs, "voice", projectDir);
  const scriptFile = reusableOutput(outputs, "script", projectDir, { optional: true });
  const reportFile = reusableOutput(outputs, "report", projectDir, { optional: true });
  return {
    renderId: reuseFrom.renderId || null,
    timeline,
    outputs,
    voiceFile,
    scriptDoc: scriptFile ? readJson(scriptFile) : null,
    report: reportFile ? readJson(reportFile) : null,
  };
}

function createEmitter(callback, signal) {
  let latest = 0;
  let chain = Promise.resolve();
  return async (stage, progress, message, current = null, total = null) => {
    throwIfAborted(signal);
    latest = Math.max(latest, Math.min(100, Math.round(Number(progress) || 0)));
    const event = { stage, progress: latest, message, current, total };
    if (typeof callback !== "function") return event;
    chain = chain.then(() => callback(event));
    await chain;
    return event;
  };
}

/**
 * Complete local render pipeline used by the persistent queue.
 *
 * options: { projectDir, sourceFiles/sourceFile, sourceSelections, clipPlan,
 * brief, variant/script,
 * voice:{provider,id,speed,tone}, styleId, position, kind, mockTts, signal,
 * onProgress }
 */
export async function runPipeline(options = {}) {
  const projectDir = path.resolve(options.projectDir || "");
  if (!options.projectDir) throw new Error("runPipeline ต้องระบุ projectDir");
  hydrateEnvironment(projectDir);
  const { signal } = options;
  throwIfAborted(signal);

  const orderedEdit = Array.isArray(options.sourceSelections) && options.sourceSelections.length > 0;
  const sourceSelections = orderedEdit
    ? options.sourceSelections
      .map((selection, index) => ({ ...selection, _inputIndex: index }))
      .sort((a, b) => {
        const left = Number.isFinite(Number(a.order)) ? Number(a.order) : a._inputIndex;
        const right = Number.isFinite(Number(b.order)) ? Number(b.order) : b._inputIndex;
        return left - right || a._inputIndex - b._inputIndex;
      })
      .map((entry) => {
        const selection = { ...entry };
        delete selection._inputIndex;
        selection.file = path.resolve(projectDir, selection.file);
        return selection;
      })
    : null;
  const rawSources = options.sourceFiles
    || (options.sourceFile ? [options.sourceFile] : orderedEdit
      ? [...new Set(sourceSelections.map((selection) => selection.file))]
      : []);
  const sourceFiles = rawSources.map((file) => path.resolve(projectDir, file));
  if (!sourceFiles.length) throw new Error("ต้องมี sourceFiles/sourceFile อย่างน้อยหนึ่งไฟล์");
  for (const file of sourceFiles) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`ไม่พบไฟล์วิดีโอ: ${file}`);
    if (!isVideo(file)) throw new Error(`ไฟล์นี้ไม่ใช่นามสกุลวิดีโอที่รองรับ: ${path.basename(file)}`);
  }

  const brief = options.brief || { name: "Clip360" };
  const kind = options.kind === "draft" ? "draft" : "final";
  const style = resolveStyle(options.styleId || "karaoke-pop", options.position, options.captionColor);
  const width = Number(options.width || 1080);
  const height = Number(options.height || 1920);
  const fps = Number(options.fps || 30);
  const configuredTargetSec = Number(options.targetSec || options.durationSec || 28);
  const runName = createRunName(`${brief.name || "clip"}-${kind}`);
  const workRoot = ensureDir(path.join(projectDir, "work"));
  const outDir = ensureDir(path.join(projectDir, "out"));
  const runDir = path.join(workRoot, runName);
  fs.mkdirSync(runDir, { recursive: false });
  const cacheDir = ensureDir(path.join(projectDir, ".cache", "tts"));
  const emit = createEmitter(options.onProgress, signal);
  const stageMs = {};
  const warnings = [];
  const delivered = [];
  let succeeded = false;

  const timeStage = async (name, fn) => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      stageMs[name] = Date.now() - started;
    }
  };

  const processOptions = { signal, timeoutMs: options.processTimeoutMs };
  let reuse = null;

  try {
    await emit("preflight", 1, "กำลังตรวจ FFmpeg");
    if (!(await ffmpegAvailable({ signal }))) {
      const error = new Error("ไม่พบ FFmpeg กรุณาติดตั้งจากหน้าตั้งค่าก่อนสร้างคลิป");
      error.code = "FFMPEG_NOT_FOUND";
      throw error;
    }
    reuse = loadReuseContext(options.reuseFrom, projectDir, sourceFiles);

    const metas = await timeStage("ingest", async () => {
      const values = [];
      for (const [index, file] of sourceFiles.entries()) {
        throwIfAborted(signal);
        values.push(await probe(file, processOptions));
        await emit(
          "ingest",
          2 + ((index + 1) / sourceFiles.length) * 6,
          `อ่านข้อมูลคลิป ${index + 1}/${sourceFiles.length}`,
          index + 1,
          sourceFiles.length,
        );
      }
      return values;
    });

    const assets = await timeStage("analyze", async () => {
      const values = [];
      for (const [index, meta] of metas.entries()) {
        throwIfAborted(signal);
        // An explicit edit timeline is authoritative: scene detection must not
        // promote/reorder any shot. Legacy one-file projects keep auto-cut.
        const cuts = orderedEdit
          ? []
          : await detectScenes(meta.file, Number(options.sceneThreshold ?? 0.32), processOptions);
        const burned = options.detectBurnedCaptions === false
          ? { likely: false, ratio: 0, band: 0, atSec: 0 }
          : await detectBurnedCaptionsInFile(meta.file, meta, processOptions);
        const score = shotScore(meta, cuts);
        values.push({ file: meta.file, meta, cuts, burned, score });
        await emit(
          "analyze",
          8 + ((index + 1) / metas.length) * 10,
          `${orderedEdit ? "ตรวจคลิปตามไทม์ไลน์" : "วิเคราะห์ฉาก"} ${index + 1}/${metas.length}`,
          index + 1,
          metas.length,
        );
      }
      return values;
    });

    const sourcePlan = orderedEdit
      ? buildOrderedSourcePlan(assets, sourceSelections)
      : null;
    if (
      sourcePlan
      && options.selectedTotalMs != null
      && Math.round(Number(options.selectedTotalMs)) !== sourcePlan.totalMs
    ) {
      const error = new Error("ความยาวไทม์ไลน์ที่ส่งมาไม่ตรงกับช่วงตัดจริง กรุณาบันทึกไทม์ไลน์แล้วลองใหม่");
      error.code = "EDIT_PLAN_DURATION_MISMATCH";
      error.status = 400;
      throw error;
    }
    const targetSec = sourcePlan ? sourcePlan.totalMs / 1000 : configuredTargetSec;

    const anchor = normalizeAnchor(style.params.position.anchor);
    const hasBurnedCaptions = assets.some((asset) => asset.burned.likely);
    let captionLift = 0;
    if (hasBurnedCaptions && options.onBurned !== "ignore" && anchor === "bottom") {
      captionLift = Number(options.captionLift ?? 300);
      style.params.position.marginV = Number(style.params.position.marginV || 0) + captionLift;
      warnings.push(`ตรวจพบซับเดิม จึงยกซับใหม่ขึ้น ${captionLift}px`);
    }

    await emit("script", 19, reuse ? "กำลังใช้สคริปต์จากร่างเดิม" : "กำลังเตรียมสคริปต์ขายสินค้า");
    let scriptDoc;
    let variant;
    if (reuse) {
      const reusedVariantId = reuse.report?.variantId || reuse.renderId || "reused-draft";
      variant = {
        id: reusedVariantId,
        chunks: reuse.timeline.chunks.map((chunk, index) => ({
          i: chunk.i ?? index,
          text: String(chunk.text || ""),
          role: chunk.role || (index === 0 ? "hook" : "body"),
          emphasis: Array.isArray(chunk.emphasis) ? chunk.emphasis : [],
        })),
      };
      scriptDoc = reuse.scriptDoc || { provider: "reused", variants: [variant] };
      stageMs.script = 0;
    } else {
      scriptDoc = scriptInputToDocument(options.script, options.variant);
      if (!scriptDoc) {
        scriptDoc = await timeStage("script", () => generateScript(brief, {
          targetSec,
          variants: Number(options.variants || 5),
          provider: options.mockTts ? "template" : options.scriptProvider || "auto",
          speech: options.speech,
          timing: options.timing,
          speakerGender: options.speakerGender ?? speakerGenderForVoice(options.voice),
          signal,
        }));
      } else {
        stageMs.script = 0;
      }
      const requestedVariantId = typeof options.variant === "string" ? options.variant : options.variantId;
      variant = normalizeVariant(
        scriptDoc.variants.find((item) => item.id === requestedVariantId) || scriptDoc.variants[0],
      );
    }
    writeJson(path.join(runDir, "script.json"), scriptDoc);
    await emit("script", 27, `${reuse ? "ใช้" : "เลือก"}สคริปต์ ${variant.id} · ${variant.chunks.length} ท่อน`);

    const requestedVoice = options.voice || {};
    let provider;
    let voice;
    let speed;
    let takes = [];
    let narrationFitResult = null;
    let narrationPlan = null;
    if (reuse) {
      provider = reuse.report?.tts?.provider || requestedVoice.provider || "reused";
      voice = reuse.report?.tts?.voice || requestedVoice.id || null;
      speed = Number(reuse.report?.tts?.speed ?? requestedVoice.speed ?? 1);
      stageMs.voice = 0;
      await emit("voice", 45, "ใช้เสียงพากย์จากร่างเดิมโดยไม่เรียก TTS ซ้ำ", variant.chunks.length, variant.chunks.length);
    } else {
      const requestedProvider = options.mockTts ? "mock" : requestedVoice.provider || "auto";
      provider = resolveProvider(requestedProvider);
      voice = provider === "mock" ? DEFAULT_VOICE.mock : requestedVoice.id || DEFAULT_VOICE[provider];
      speed = Number(requestedVoice.speed ?? 1);
      const voiceDir = ensureDir(path.join(runDir, "voice"));
      await emit("voice", 28, `กำลังสร้างเสียงพากย์ด้วย ${provider}`, 0, variant.chunks.length);
      takes = await timeStage("voice", () => synthesizeAll(
        variant.chunks.map((chunk, index) => ({
          text: chunk.text,
          outFile: path.join(voiceDir, `chunk_${String(index).padStart(3, "0")}.wav`),
        })),
        {
          provider,
          voice,
          speed,
          styleHint: requestedVoice.tone || brief.tone
            ? `พูดโทน${requestedVoice.tone || brief.tone} แบบพรีเซนต์ขายของ`
            : "",
          cacheDir,
          signal,
          timeoutMs: options.ttsTimeoutMs,
          // คีย์ของเจ้าของงานนี้ และตัวนับที่ฝั่งเซิร์ฟเวอร์ใช้บันทึกการใช้งานรายคน
          geminiEnv: options.geminiEnv,
          onRequest: options.onTtsRequest,
        },
        concurrencyFor(provider),
        (current, total) => emit(
          "voice",
          28 + (current / total) * 17,
          `สร้างเสียงแล้ว ${current}/${total} ท่อน`,
          current,
          total,
        ),
      ));
    }

    let timeline;
    if (reuse) {
      timeline = structuredClone(reuse.timeline);
      timeline.width = width;
      timeline.height = height;
      timeline.fps = fps;
      if (sourcePlan && (!timeline.editPlanHash || timeline.editPlanHash !== options.editPlanHash)) {
        const error = new Error("ร่างเดิมใช้ลำดับหรือช่วงตัดคนละเวอร์ชัน กรุณาสร้างร่างใหม่ก่อนสร้างตัวจริง");
        error.code = "STALE_DRAFT";
        error.status = 409;
        throw error;
      }
      // ร่างที่ถูกตัดให้พอดีเสียงจะสั้นกว่าช่วงที่ผู้ใช้เลือก จึงต้องเทียบกับ
      // ความยาวที่เลือกไว้ตอนนั้น ไม่ใช่ความยาวของไทม์ไลน์หลังตัด
      const reusedSelectedMs = Math.round(Number(timeline.fit?.selectedTotalMs ?? timeline.durationMs));
      if (sourcePlan && reusedSelectedMs !== sourcePlan.totalMs) {
        const error = new Error("ร่างเดิมใช้ไทม์ไลน์คนละเวอร์ชัน กรุณาสร้างร่างใหม่ก่อนสร้างตัวจริง");
        error.code = "STALE_DRAFT";
        error.status = 409;
        throw error;
      }
      stageMs.timeline = 0;
    } else {
      timeline = await timeStage("timeline", async () => {
        // เสียงยาวเกินไทม์ไลน์เป็นเรื่องที่ระบบพอแก้เองได้ก่อนจะไปรบกวนผู้ใช้ —
        // ตัดหางเงียบและเร่งจังหวะเล็กน้อยไม่ทำให้เสียคำพูดสักคำ ทำตรงนี้ก่อนจัด
        // timeline เพราะความยาวของแต่ละท่อนเปลี่ยน ซับจึงต้องคำนวณจากค่าใหม่
        if (sourcePlan) {
          narrationFitResult = await fitNarrationToTimeline(takes, {
            targetMs: sourcePlan.totalMs,
            timing: options.timing,
            signal,
            timeoutMs: options.ttsTimeoutMs,
          });
        }
        const takeItems = variant.chunks.map((chunk, index) => ({
          ...chunk,
          audioFile: takes[index].file,
          durationMs: takes[index].durationMs,
        }));
        let value = buildChunkTimeline(takeItems, options.timing);
        if (sourcePlan) {
          // เสียงสั้นกว่าคลิปคือเรื่องปกติ ไม่ใช่ข้อยกเว้น — จัดการก่อนที่ส่วนต่าง
          // จะกลายเป็นความเงียบท้ายคลิปเหมือนที่เป็นมาทุกงาน
          narrationPlan = planNarrationFit({
            narrationMs: value.durationMs,
            targetMs: sourcePlan.totalMs,
            chunkCount: takeItems.length,
            timing: options.timing,
          });
          if (narrationPlan.action === "stretch") {
            value = buildChunkTimeline(takeItems, { ...options.timing, padMs: narrationPlan.padMs });
          }
          const videoPlan = narrationPlan.action === "trim"
            ? trimSourcePlan(sourcePlan, narrationPlan.targetMs)
            : sourcePlan;
          // บันทึกไว้ในรายงานว่าไฟล์ที่ได้ไม่ตรงกับที่ผู้ใช้เลือกไว้ตอนแรกเพราะอะไร
          if (narrationPlan.action === "trim") {
            warnings.push(
              `เสียงพากย์สั้นกว่าคลิปที่เลือก ${(narrationPlan.slackMs / 1000).toFixed(1)} วินาที `
              + `จึงตัดคลิปจาก ${(sourcePlan.totalMs / 1000).toFixed(1)} เหลือ ${(videoPlan.totalMs / 1000).toFixed(1)} วินาที`,
            );
          } else if (narrationPlan.action === "stretch") {
            warnings.push(
              `เสียงพากย์สั้นกว่าคลิปเล็กน้อย จึงเว้นจังหวะระหว่างท่อนเพิ่มท่อนละ ${narrationPlan.extraGapMs}ms`,
            );
          }
          value = padNarrationTimeline(value, videoPlan.totalMs, narrationFitResult?.applied ?? []);
          value.editPlanHash = options.editPlanHash || null;
          value.segments = videoPlan.segments;
          value.fit = {
            mode: videoPlan.mode,
            ratio: videoPlan.ratio,
            // ความยาวที่ผู้ใช้เลือกไว้ ไม่ใช่ความยาวหลังตัด — ใช้เทียบว่าร่างเก่า
            // ยังตรงกับช่วงคลิปที่เลือกอยู่หรือเปล่า
            selectedTotalMs: sourcePlan.totalMs,
            ...(videoPlan !== sourcePlan ? { trimmedToMs: videoPlan.totalMs } : {}),
          };
        } else {
          const pieces = buildPieces(assets, options.pieces);
          const fitted = fitToDuration(pieces, value.durationMs);
          value.segments = fitted.segments;
          value.fit = { mode: fitted.mode, ratio: fitted.ratio };
        }
        value.width = width;
        value.height = height;
        value.fps = fps;
        return value;
      });
    }
    const publicTimeline = sanitizeTimeline(timeline);
    writeJson(path.join(runDir, "timeline.json"), publicTimeline);
    await emit("timeline", 50, `${reuse ? "ใช้" : "จัด"} timeline ${Math.round(timeline.durationMs / 100) / 10} วินาทีแล้ว`);

    let overlayFile = null;
    let laneUsed = "ass";
    let overlayFallback = null;
    await timeStage("caption", async () => {
      fs.writeFileSync(path.join(runDir, "captions.srt"), compileSrt(timeline), "utf8");
      fs.writeFileSync(
        path.join(runDir, "captions.ass"),
        compileAss(timeline, style, { width, height }),
        "utf8",
      );

      if (style.lane === "hyperframes" && (kind === "final" || options.renderPremiumDraft)) {
        await emit("caption", 52, "กำลังเรนเดอร์ซับพรีเมียม");
        try {
          overlayFile = await renderOverlay(
            timeline,
            style,
            runDir,
            {
              width,
              height,
              fps,
              overlayFormat: options.overlayFormat || "mov",
              signal,
              timeoutMs: options.hyperframesTimeoutMs,
            },
            (message) => emit("caption", 58, message),
          );
          laneUsed = "hyperframes";
        } catch (error) {
          if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
          overlayFallback = {
            code: error instanceof AlphaOverlayError ? error.code : error.code || "HYPERFRAMES_FAILED",
            message: error.message,
          };
          warnings.push(`ซับพรีเมียมใช้ไม่ได้ จึงถอยไปใช้ซับ Kanit แบบเร็ว: ${error.message}`);
          overlayFile = null;
          laneUsed = "ass";
          await emit("caption", 59, "เปลี่ยนเป็นซับ Kanit แบบเร็วเพื่อไม่ให้ภาพเป็นพื้นทึบ");
        }
      } else if (style.lane === "hyperframes") {
        overlayFallback = { code: "DRAFT_FAST_LANE", message: "ร่างใช้เลน ASS เพื่อให้พร้อมเร็วขึ้น" };
      }
    });
    await emit("caption", 60, `เตรียมซับ ${style.name} แล้ว`);

    await timeStage("compose", () => buildVideoTrack(
      timeline.segments,
      runDir,
      { width, height, fps, ...processOptions },
      (current, total) => emit(
        "compose",
        60 + (current / total) * 20,
        `ประกอบภาพ ${current}/${total} ช่วง`,
        current,
        total,
      ),
    ));

    await emit("mix", 81, reuse ? "กำลังนำเสียงพากย์จากร่างเดิมมาใช้" : "กำลังต่อและปรับระดับเสียงพากย์");
    await timeStage("mix", async () => {
      if (reuse) {
        await fs.promises.copyFile(reuse.voiceFile, path.join(runDir, "voice.wav"));
        return path.join(runDir, "voice.wav");
      }
      return buildVoiceTrack(timeline, runDir, processOptions);
    });
    await emit("mix", 87, reuse ? "ใช้เสียงพากย์เดิมเรียบร้อย" : "ปรับเสียงพากย์เรียบร้อย");

    let outputMeta = null;
    await emit("package", 88, "กำลังประกอบภาพ เสียง และซับ");
    await timeStage("package", async () => {
      await burnAndMux(timeline, runDir, "final.mp4", {
        bgm: options.bgm ? path.resolve(projectDir, options.bgm) : null,
        bgmGainDb: Number(options.bgmGainDb ?? -18),
        overlay: overlayFile,
        fontsDir: FONTS_DIR,
        signal,
        timeoutMs: options.processTimeoutMs,
      });
      outputMeta = await probe(path.join(runDir, "final.mp4"), processOptions);
      if (sourcePlan) {
        const frameMs = 1000 / fps;
        // เทียบกับไทม์ไลน์ที่ประกอบจริง ไม่ใช่ความยาวที่ผู้ใช้เลือกไว้ตอนแรก
        // เพราะไทม์ไลน์อาจถูกตัดให้พอดีเสียงไปแล้ว
        const deltaMs = Math.abs(outputMeta.durationMs - timeline.durationMs);
        if (deltaMs > frameMs + 2) {
          const error = new Error(
            `วิดีโอที่ประกอบแล้วคลาดจากไทม์ไลน์ ${Math.round(deltaMs)}ms กรุณาลองเรนเดอร์ใหม่`,
          );
          error.code = "OUTPUT_DURATION_MISMATCH";
          error.status = 500;
          throw error;
        }
      }
      await poster(
        "final.mp4",
        "poster.jpg",
        runDir,
        Math.min(1.2, Math.max(0.1, timeline.durationMs / 2000)),
        processOptions,
      );
    });
    await emit("package", 96, "สร้างวิดีโอและภาพหน้าปกแล้ว");

    const base = runName;
    const deliveryPlan = {
      video: ["final.mp4", `${base}.mp4`],
      poster: ["poster.jpg", `${base}-poster.jpg`],
      subtitlesSrt: ["captions.srt", `${base}.srt`],
      subtitlesAss: ["captions.ass", `${base}.ass`],
      voice: ["voice.wav", `${base}-voice.wav`],
      script: ["script.json", `${base}-script.json`],
      timeline: ["timeline.json", `${base}-timeline.json`],
    };
    const outputs = {};
    for (const [key, [sourceName, destinationName]] of Object.entries(deliveryPlan)) {
      throwIfAborted(signal);
      const destination = path.join(outDir, destinationName);
      fs.copyFileSync(path.join(runDir, sourceName), destination, fs.constants.COPYFILE_EXCL);
      delivered.push(destination);
      outputs[key] = outputInfo(destination);
    }

    const audioSec = timeline.durationMs / 1000;
    const report = {
      createdAt: new Date().toISOString(),
      kind,
      product: brief.name || null,
      variantId: variant.id,
      style: style.slug,
      laneRequested: style.lane,
      laneUsed,
      overlayFallback,
      caption: {
        anchor,
        marginV: style.params.position.marginV,
        lifted: captionLift,
      },
      tts: {
        provider,
        voice,
        speed,
        chunks: reuse ? timeline.chunks.length : takes.length,
        cached: reuse ? timeline.chunks.length : takes.filter((take) => take.cached).length,
        // กี่ท่อนที่ได้เสียงมาจากคำขอเดียว — ใช้ดูว่าการรวมคำขอทำงานจริงไหม
        batched: reuse ? 0 : (takes.batchedCount ?? 0),
        // วิธีที่ใช้หารอยตัด ("align" = จับคู่ข้อความ, "silence" = ช่วงเงียบ) และเหตุผล
        // ตอนล้ม — batched: 0 เฉย ๆ บอกไม่ได้ว่าล้มเพราะโควตา เพราะตัดไม่ลง หรือเพราะ
        // ยังไม่ได้ติดตั้ง whisper.cpp ซึ่งสามอย่างนี้ต้องแก้คนละทาง
        batchMethod: reuse ? null : (takes.batchMethod ?? null),
        batchReason: reuse ? null : (takes.batchReason ?? null),
        // ระบบต้องย่อเสียงให้ลงไทม์ไลน์ไหม และย่อด้วยวิธีอะไร
        narrationFit: narrationFitResult?.applied?.length ? narrationFitResult.applied : null,
        // ทำอะไรกับส่วนที่เสียงสั้นกว่าคลิป — keep/stretch/trim พร้อมส่วนต่างตั้งต้น
        lengthFit: narrationPlan,
        reused: Boolean(reuse),
        sourceRenderId: reuse?.renderId || null,
      },
      durationMs: timeline.durationMs,
      // สถิติความเร็วพูดของงานนี้ ใช้ประเมินความยาวสคริปต์ครั้งต่อไปให้แม่นขึ้น
      speechSample: reuse ? null : (() => {
        // นับตัวอักษรจากข้อความที่ "พูดจริง" ไม่ใช่ที่แสดงบนซับ — เสียงในเครื่องอ่าน
        // 20000mAh ว่า สองหมื่นมิลลิแอมป์ ถ้านับจากแปดตัวอักษรแต่จับเวลาของสิบแปด
        // ตัวอักษร อัตราที่วัดได้จะเพี้ยนไปทั้งชุด
        const spoken = timeline.chunks.map((chunk) => (
          provider === "jaitts" ? { ...chunk, text: toSpokenThai(chunk.text).text } : chunk
        ));
        const sample = sampleChunks(spoken);
        return sample ? { key: speechKey({ provider, voice, speed }), ...sample } : null;
      })(),
      selectedTotalMs: sourcePlan?.totalMs ?? null,
      outputDurationMs: outputMeta?.durationMs ?? null,
      fit: timeline.fit,
      dimensions: { width, height, fps },
      sources: assets.map((asset) => ({
        name: asset.meta.name,
        durationMs: asset.meta.durationMs,
        cuts: asset.cuts.length,
        score: asset.score,
        burnedCaptions: asset.burned,
      })),
      // ช่วงคลิปที่ใช้จริงหลังปรับให้พอดีเสียงแล้ว ไม่ใช่ช่วงที่เลือกไว้ตอนแรก
      timelineClips: (timeline.segments ?? sourcePlan?.segments)?.map((segment) => ({
        id: segment.id,
        assetName: segment.assetName,
        order: segment.order,
        trimStartMs: segment.inMs,
        trimEndMs: segment.trimEndMs,
        durationMs: segment.srcDurMs,
        startMs: segment.startMs,
      })) ?? null,
      stageMs,
      warnings,
      estimatedCostUsd: {
        tts: !reuse && provider === "gemini" ? Number(((audioSec * 32 * 10) / 1e6).toFixed(5)) : 0,
        script: scriptDoc.provider?.startsWith("claude") ? 0.004 : 0,
      },
      outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.filename])),
    };
    writeJson(path.join(runDir, "report.json"), report);
    const reportFile = path.join(outDir, `${base}-report.json`);
    fs.copyFileSync(path.join(runDir, "report.json"), reportFile, fs.constants.COPYFILE_EXCL);
    delivered.push(reportFile);
    outputs.report = outputInfo(reportFile);

    await emit("deliver", 100, "คลิปพร้อมดาวน์โหลดแล้ว", 1, 1);
    succeeded = true;
    return { outputs, timeline: publicTimeline, report };
  } finally {
    // A canceled/failed job must not leave half-delivered files. Scratch is
    // always removed unless explicitly retained for diagnostics.
    if (!succeeded) {
      for (const file of delivered) fs.rmSync(file, { force: true });
    }
    if (!options.keepWork) {
      fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

// Low-level exports preserve the spike's module boundaries for workers/tests.
export * from "./core.mjs";
export * from "./media.mjs";
export * from "./script.mjs";
export * from "./tts.mjs";
export * from "./ass.mjs";
export * from "./hyperframes.mjs";
export * from "./render.mjs";
export * from "./lib.mjs";
