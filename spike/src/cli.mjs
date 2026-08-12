#!/usr/bin/env node
// clippang-spike — สัปดาห์ที่ 1: mp4 หลายไฟล์ + ข้อมูลสินค้า → คลิปพร้อมโพสต์
//
// เดินครบ 10 stage เดียวกับที่ blueprint §04 วางไว้ ไม่มีเว็บ ไม่มี DB
// โครงไฟล์ใน src/ แมปตรงกับ packages/* ในอนาคต
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { C, die, ensureDir, loadEnv, readJson, stage, timings, writeJson } from "./lib.mjs";
import { detectBurnedCaptions, detectScenes, ffmpegAvailable, isVideo, probe, shotScore } from "./media.mjs";
import { ANCHORS, buildChunkTimeline, buildPieces, fitToDuration, normalizeAnchor } from "./core.mjs";
import { generateScript } from "./script.mjs";
import { DEFAULT_VOICE, VOICES, concurrencyFor, resolveProvider, synthesizeAll } from "./tts.mjs";
import { compileAss, compileSrt } from "./ass.mjs";
import { renderOverlay } from "./hyperframes.mjs";
import { buildVideoTrack, buildVoiceTrack, burnAndMux, poster } from "./render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;

/* ---------- args ---------- */

const { values: a } = parseArgs({
  options: {
    in: { type: "string", multiple: true },
    brief: { type: "string" },
    product: { type: "string" },
    features: { type: "string" },
    price: { type: "string" },
    audience: { type: "string" },
    tone: { type: "string" },
    cta: { type: "string" },
    script: { type: "string" },
    variant: { type: "string", default: "v1" },
    style: { type: "string", default: "kanit-hf" },
    position: { type: "string" },
    "margin-v": { type: "string" },
    tts: { type: "string", default: "auto" },
    voice: { type: "string" },
    speed: { type: "string", default: "1" },
    "script-provider": { type: "string", default: "auto" },
    duration: { type: "string", default: "25" },
    out: { type: "string", default: "out" },
    font: { type: "string" },
    bgm: { type: "string" },
    "on-burned": { type: "string", default: "raise" },
    "overlay-format": { type: "string", default: "mov" },
    "keep-work": { type: "boolean", default: false },
    "list-styles": { type: "boolean", default: false },
    "list-voices": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const HELP = `
${C.bold("clippang-spike")} — ใส่ซับ + พากย์เสียง AI ให้คลิปสินค้า

${C.bold("ใช้งาน")}
  node src/cli.mjs --in <โฟลเดอร์คลิป> --brief brief.json [ตัวเลือก]

${C.bold("อินพุต")}
  --in <path>            โฟลเดอร์หรือไฟล์คลิป (ใส่ซ้ำได้หลายครั้ง)
  --brief <file.json>    ข้อมูลสินค้า  (ดู brief.example.json)
  --product / --features / --price / --audience / --tone / --cta
                         กรอกข้อมูลสินค้าตรงบรรทัดคำสั่งแทน --brief
  --script <file.json>   ใช้สคริปต์ที่มีอยู่แล้ว ข้ามขั้นเขียนสคริปต์

${C.bold("ตัวเลือก")}
  --variant v1           เลือกเวอร์ชันสคริปต์
  --style kanit-hf       สไตล์ซับ ค่าเริ่มต้นคือเลน B (--list-styles ดูทั้งหมด)
                         ใช้ karaoke-pop เมื่ออยากได้ไวสำหรับร่าง/batch
  --position bottom      ตำแหน่งซับ: top | middle | bottom (ทับค่าของสไตล์)
  --margin-v 400         ระยะห่างจากขอบที่ยึด เป็นพิกเซลบนเฟรม 1080×1920
  --tts auto             auto | gemini | edge | silence   (--list-voices ดูเสียง)
  --voice <id>           เสียงของ provider นั้น
  --speed 1.0            ความเร็วพูด 0.8–1.3
  --duration 25          ความยาวคลิปเป้าหมาย (วินาที)
  --bgm <file.mp3>       เพลงประกอบ (ลดเสียงอัตโนมัติตอนพากย์)
  --on-burned raise      เจอซับเดิมเบิร์นในคลิปให้ทำอะไร: raise (ยกซับใหม่ขึ้น) | ignore
  --font "Noto Sans Thai"  บังคับฟอนต์
  --out out              โฟลเดอร์ผลลัพธ์
  --keep-work            เก็บไฟล์ระหว่างทางไว้ดู

${C.bold("ตัวอย่าง")}
  node src/cli.mjs --in ../asset --brief brief.example.json --duration 22
  node src/cli.mjs --in clips --product "หัวชาร์จพกพา" --features "พับได้,ชาร์จเร็ว 20W" --price 290
`;

/* ---------- helpers ---------- */

function loadStyle(slug, { font, position, marginV } = {}) {
  const file = path.join(ROOT, "styles", `${slug}.json`);
  if (!fs.existsSync(file)) {
    const all = fs.readdirSync(path.join(ROOT, "styles")).map((f) => f.replace(".json", ""));
    die(`ไม่รู้จักสไตล์ "${slug}" — มีให้เลือก: ${all.join(", ")}`);
  }
  const style = readJson(file);
  if (font) style.params.font.family = font;
  if (position) {
    if (!ANCHORS.includes(normalizeAnchor(position)) || !/^(top|middle|bottom|center)/i.test(position)) {
      die(`--position รับได้แค่ ${ANCHORS.join(" | ")}`);
    }
    style.params.position.anchor = normalizeAnchor(position);
  }
  if (marginV) style.params.position.marginV = Number(marginV);
  return style;
}

function listStyles() {
  const dir = path.join(ROOT, "styles");
  process.stdout.write(`\n${C.bold("สไตล์ซับที่มี")}\n`);
  for (const f of fs.readdirSync(dir)) {
    const s = readJson(path.join(dir, f));
    process.stdout.write(
      `  ${C.y(s.slug.padEnd(16))} ${s.name.padEnd(20)} ${C.dim(`เลน ${s.lane} · ${s.description || ""}`)}\n`,
    );
  }
  process.stdout.write("\n");
}

function listVoices() {
  process.stdout.write(`\n${C.bold("เสียงที่มี")}\n`);
  for (const [provider, voices] of Object.entries(VOICES)) {
    process.stdout.write(`  ${C.c(provider)}\n`);
    for (const v of voices) process.stdout.write(`    ${v.id.padEnd(26)} ${C.dim(v.label)}\n`);
  }
  process.stdout.write("\n");
}

function collectInputs(inputs) {
  const files = [];
  for (const entry of inputs || []) {
    const p = path.resolve(entry);
    if (!fs.existsSync(p)) die(`ไม่พบ ${p}`);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) {
        if (isVideo(f)) files.push(path.join(p, f));
      }
    } else if (isVideo(p)) {
      files.push(p);
    }
  }
  return files;
}

function briefFrom(args) {
  if (args.brief) return readJson(path.resolve(args.brief));
  if (!args.product) return null;
  return {
    name: args.product,
    price: args.price ? Number(args.price) : null,
    features: (args.features || "").split(",").map((s) => s.trim()).filter(Boolean),
    audience: args.audience || "คนทั่วไป",
    tone: args.tone || "สนุก เป็นกันเอง",
    cta: args.cta || "กดตะกร้าส้มด้านล่างเลย",
  };
}

const slugify = (s) =>
  String(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40).toLowerCase() || "clip";

/* ---------- main ---------- */

async function main() {
  loadEnv(ROOT);

  if (a.help) return process.stdout.write(HELP);
  if (a["list-styles"]) return listStyles();
  if (a["list-voices"]) return listVoices();
  if (!(await ffmpegAvailable())) die("ไม่พบ ffmpeg ใน PATH — ติดตั้งก่อนแล้วลองใหม่");

  const sources = collectInputs(a.in);
  if (!sources.length) die("ต้องระบุคลิปอย่างน้อยหนึ่งไฟล์ด้วย --in (ดู --help)");

  const brief = briefFrom(a);
  if (!brief && !a.script) die("ต้องมี --brief, --product หรือ --script อย่างใดอย่างหนึ่ง");

  const targetSec = Number(a.duration);
  const speed = Number(a.speed);
  const style = loadStyle(a.style, { font: a.font, position: a.position, marginV: a["margin-v"] });
  const anchor = normalizeAnchor(style.params.position.anchor);
  const runDir = ensureDir(
    path.resolve(a.out, `${slugify(brief?.name || "clip")}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`),
  );
  const cacheDir = ensureDir(path.join(ROOT, ".cache", "tts"));

  process.stdout.write(
    `\n${C.bold("ClipPang")} ${C.dim("spike")}  ` +
    `${C.dim("→")} ${brief?.name || "(จากสคริปต์)"}  ` +
    `${C.dim(`${targetSec}s · ${style.name} · ซับ${anchor} · ${sources.length} คลิป`)}\n\n`,
  );

  /* 1 — INGEST */
  let s = stage("Ingest — อ่านสเปกไฟล์");
  const metas = [];
  for (const f of sources) {
    const m = await probe(f);
    metas.push(m);
    s.note(`${m.name} · ${m.width}×${m.height} · ${(m.durationMs / 1000).toFixed(1)}s · ${m.codec}`);
  }
  s.done(`${metas.length} ไฟล์`);

  /* 2 — ANALYZE */
  s = stage("Analyze — หาจุดตัดฉาก + ตรวจซับเดิม");
  const assets = [];
  for (const m of metas) {
    const cuts = await detectScenes(m.file);
    const burned = await detectBurnedCaptions(m.file, m);
    const score = shotScore(m, cuts);
    if (burned.likely) {
      s.warn(`${m.name}: มีซับเบิร์นติดมาแล้ว (edge ratio ${burned.ratio} ที่วินาที ${burned.atSec})`);
    }
    s.note(`${m.name} · ${cuts.length} จุดตัด · score ${score}`);
    assets.push({ file: m.file, meta: m, cuts, score, burned });
  }

  // ซับใหม่ต้องไม่ไปทับซับเดิม — ยกขึ้นเหนือแถบเดิมแทนการปล่อยให้ซ้อน
  // ยกเฉพาะตอนซับวางอยู่ล่าง — ถ้าผู้ใช้เลือกบนหรือกลาง มันพ้นซับเดิมอยู่แล้ว
  const hasBurned = assets.some((x) => x.burned.likely);
  let captionLift = 0;
  if (hasBurned && a["on-burned"] === "raise" && anchor === "bottom") {
    captionLift = 300;
    s.warn(`ยกซับใหม่ขึ้น ${captionLift}px ให้พ้นซับเดิม (ปิดด้วย --on-burned ignore หรือ --position top)`);
  } else if (hasBurned && anchor !== "bottom") {
    s.note(`ซับวางตำแหน่ง ${anchor} อยู่แล้ว จึงไม่ต้องยกหนีซับเดิม`);
  }
  s.done();

  /* 3 — SCRIPT */
  s = stage("Script — เขียนสคริปต์ขาย");
  let scriptDoc;
  if (a.script) {
    scriptDoc = readJson(path.resolve(a.script));
    s.note(`ใช้สคริปต์จาก ${path.basename(a.script)}`);
  } else {
    scriptDoc = await generateScript(brief, {
      targetSec,
      variants: 5,
      provider: a["script-provider"],
    });
    if (scriptDoc.fallbackFrom) s.warn(`LLM ใช้ไม่ได้ → ใช้ตัวสร้างออฟไลน์แทน (${scriptDoc.fallbackFrom})`);
  }
  const variant =
    scriptDoc.variants.find((v) => v.id === a.variant) || scriptDoc.variants[0];
  writeJson(path.join(runDir, "script.json"), scriptDoc);
  for (const v of scriptDoc.variants) {
    const mark = v.id === variant.id ? C.y("●") : C.dim("○");
    s.note(`${mark} ${v.id} ${C.dim(`[${v.hookType}]`)} ${v.chunks.slice(0, 3).map((c) => c.text).join(" / ")}…`);
  }
  s.done(`${scriptDoc.provider} · เลือก ${variant.id} · ${variant.chunks.length} ท่อน`);

  /* 4 — VOICE (chunked TTS) */
  s = stage("Voice — พากย์ทีละท่อน");
  const provider = resolveProvider(a.tts);
  const voice = a.voice || DEFAULT_VOICE[provider];
  if (provider === "silence") s.warn("โหมด silence: จะได้คลิปที่ไม่มีเสียงพูด (ใช้ทดสอบ pipeline)");
  const ttsConcurrency = concurrencyFor(provider);
  s.note(`provider ${C.y(provider)} · เสียง ${voice} · speed ${speed} · ยิงพร้อมกัน ${ttsConcurrency}`);

  const voiceDir = ensureDir(path.join(runDir, "voice"));
  const takes = await synthesizeAll(
    variant.chunks.map((c, i) => ({
      text: c.text,
      outFile: path.join(voiceDir, `chunk_${String(i).padStart(2, "0")}.wav`),
    })),
    {
      provider,
      voice,
      speed,
      styleHint: brief?.tone ? `พูดโทน${brief.tone} แบบพรีเซนต์ขายของ` : "",
      cacheDir,
    },
    ttsConcurrency,
    (done, total) => s.note(`พากย์แล้ว ${done}/${total} ท่อน`),
  ).catch((e) => die(`TTS ล้มเหลว: ${e.message}`));

  s.done(`${takes.length} ท่อน · ใช้แคช ${takes.filter((t) => t.cached).length} ท่อน`);

  /* 5 — TIMELINE */
  s = stage("Timeline — ปักเวลาจากความยาวเสียงจริง");
  const timeline = buildChunkTimeline(
    variant.chunks.map((c, i) => ({
      i,
      text: c.text,
      role: c.role,
      emphasis: c.emphasis,
      audioFile: takes[i].file,
      durationMs: takes[i].durationMs,
    })),
  );
  const pieces = buildPieces(assets);
  const fit = fitToDuration(pieces, timeline.durationMs);
  timeline.segments = fit.segments;
  timeline.fit = { mode: fit.mode, ratio: fit.ratio };
  timeline.width = OUT_W;
  timeline.height = OUT_H;
  timeline.fps = FPS;
  writeJson(path.join(runDir, "timeline.json"), timeline);
  const actualSec = timeline.durationMs / 1000;
  s.note(`เสียงรวม ${actualSec.toFixed(2)}s · ภาพ ${pieces.length} ชิ้น → ${fit.segments.length} segment`);
  s.note(`duration fitting: ${C.y(fit.mode)} (ต้องการ/มี = ${fit.ratio})`);
  if (Math.abs(actualSec - targetSec) / targetSec > 0.25) {
    s.warn(
      `ยาวจริง ${actualSec.toFixed(1)}s ห่างจากเป้า ${targetSec}s เกิน 25% — ` +
      `ปรับ SPEAK_GRAPHEMES_PER_SEC ใน .env ให้ตรงกับเสียงที่ใช้ หรือแก้สคริปต์ให้สั้นลง`,
    );
  }
  s.done();

  /* 6 — CAPTION */
  s = stage(`Caption — คอมไพล์ซับ (เลน ${style.lane === "hyperframes" ? "B · HyperFrames" : "A · libass"})`);
  if (captionLift) style.params.position.marginV += captionLift;
  fs.writeFileSync(path.join(runDir, "captions.srt"), compileSrt(timeline), "utf8");
  const wordCount = timeline.chunks.reduce((n, c) => n + c.words.length, 0);

  let overlayFile = null;
  if (style.lane === "hyperframes") {
    s.note(`เรนเดอร์เลเยอร์ซับผ่าน Chrome ${Math.ceil((timeline.durationMs / 1000) * FPS)} เฟรม — ขั้นนี้ช้าที่สุด`);
    overlayFile = await renderOverlay(
      timeline, style, runDir,
      { width: OUT_W, height: OUT_H, fps: FPS, overlayFormat: a["overlay-format"] },
      (m) => s.warn(m),
    );
    s.note(`ได้ ${path.basename(overlayFile)}`);
  } else {
    fs.writeFileSync(
      path.join(runDir, "captions.ass"),
      compileAss(timeline, style, { width: OUT_W, height: OUT_H }),
      "utf8",
    );
  }
  s.done(`${timeline.chunks.length} ท่อน · ${wordCount} คำ · ฟอนต์ ${style.params.font.family}`);

  /* 7 — COMPOSE */
  s = stage("Compose — ต่อภาพตาม timeline");
  await buildVideoTrack(fit.segments, runDir, { width: OUT_W, height: OUT_H, fps: FPS }, (done, total) => {
    if (done === total || done % 3 === 0) s.note(`เรนเดอร์ segment ${done}/${total}`);
  });
  s.done(`${fit.segments.length} segment → video.mp4`);

  /* 8 — MIX */
  s = stage("Mix — ต่อเสียงพากย์ + ปรับระดับ");
  await buildVoiceTrack(timeline, runDir);
  s.done("voice.wav (−14 LUFS)");

  /* 9 — PACKAGE */
  s = stage("Package — ประกอบซับ + mux");
  await burnAndMux(timeline, runDir, "final.mp4", {
    bgm: a.bgm ? path.resolve(a.bgm) : null,
    overlay: overlayFile,
  });
  await poster("final.mp4", "poster.jpg", runDir);
  s.done("final.mp4 + poster.jpg");

  /* 10 — DELIVER */
  s = stage("Deliver — เก็บกวาด + สรุป");
  if (!a["keep-work"]) {
    for (const junk of ["seg", "segments.txt", "voice.txt", "voice_raw.wav", "video.mp4", "hf"]) {
      fs.rmSync(path.join(runDir, junk), { recursive: true, force: true });
    }
  }
  const audioSec = timeline.durationMs / 1000;
  const report = {
    createdAt: new Date().toISOString(),
    product: brief?.name || null,
    variantId: variant.id,
    style: style.slug,
    lane: style.lane,
    caption: { anchor, marginV: style.params.position.marginV, lifted: captionLift },
    tts: { provider, voice, speed, chunks: takes.length, cached: takes.filter((t) => t.cached).length },
    durationMs: timeline.durationMs,
    fit: timeline.fit,
    sources: assets.map((x) => ({ name: x.meta.name, cuts: x.cuts.length, score: x.score, burnedCaptions: x.burned })),
    stageMs: timings(),
    estimatedCostUsd: {
      tts: provider === "gemini" ? Number(((audioSec * 25 * 10) / 1e6).toFixed(5)) : 0,
      script: scriptDoc.provider.startsWith("claude") ? 0.004 : 0,
    },
    outputs: ["final.mp4", "poster.jpg", "captions.ass", "captions.srt", "voice.wav", "script.json", "timeline.json"],
  };
  writeJson(path.join(runDir, "report.json"), report);
  s.done();

  const totalMs = Object.values(timings()).reduce((x, y) => x + y, 0);
  process.stdout.write(
    `\n${C.g("เสร็จแล้ว")} ${C.bold(path.join(runDir, "final.mp4"))}\n` +
    `${C.dim(`ความยาว ${audioSec.toFixed(1)}s · ใช้เวลาทำ ${(totalMs / 1000).toFixed(1)}s · ` +
      `ต้นทุนประมาณ $${(report.estimatedCostUsd.tts + report.estimatedCostUsd.script).toFixed(4)}`)}\n\n`,
  );
}

main().catch((e) => die(e.stack || e.message));
