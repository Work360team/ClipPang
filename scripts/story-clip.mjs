// story-clip — สร้างคลิปเล่าเรื่องจากไฟล์คอนเทนต์ ตั้งแต่ต้นจนจบ (เฟส 1)
//
// พิสูจน์ว่าโหมดเล่าเรื่องต่อเข้ากับสายพานเดิมได้จริงโดยไม่ต้องแก้ pipeline เลยสักบรรทัด
// ทุกอย่างตั้งแต่ขั้น "จัด timeline" เป็นต้นไปเป็นของเดิมทั้งหมด — เสียงพากย์ การจับคำ
// ด้วย whisper การทำซับ การประกอบ MP4
//
//   node scripts/story-clip.mjs <ไฟล์คอนเทนต์> [--style paper-collage] [--voice clone-xxx] [--caption karaoke-pop]
//
// ตัวอย่าง:
//   node scripts/story-clip.mjs "asset/สร้างคลิปเล่าเรื่อง คอนเท้นต์/ตัวอย่างประกัน.txt" --style paper-collage

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStoryboard } from "../pipeline/storyboard.mjs";
import { getVisualStyle } from "../pipeline/visual-styles.mjs";
import { generateImage, animateImage, nearestShotSeconds } from "../pipeline/grok-visual.mjs";
import { runPipeline } from "../pipeline/index.mjs";
import { ensureDir, writeJson, createRunName, slugify, durationMs } from "../pipeline/lib.mjs";
import { chunkMs, lookupSpeechModel } from "../pipeline/speech-rate.mjs";
import { findClone } from "../pipeline/voice-clones.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ทำทีละช็อต
 *
 * เคยตั้งเป็น 2 เพราะคิดว่าจะเร็วขึ้นเท่าตัว แต่คอขวดอยู่ที่ฝั่งบริการซึ่งจำกัดอัตราอยู่แล้ว
 * ทำพร้อมกันจึงไม่ได้เร็วขึ้น มีแต่ทำให้แต่ละงานช้าลงจนชนเพดานเวลาแล้วต้องทิ้งทั้งที่
 * อีกนิดเดียวก็เสร็จ — งานที่ทิ้งคือเวลาที่จ่ายไปแล้วเปล่า ๆ
 */
const CONCURRENCY = 1;

function parseArgs(argv) {
  const args = { style: "paper-collage", caption: "karaoke-pop", voice: null, project: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--style") args.style = argv[++i];
    else if (item === "--caption") args.caption = argv[++i];
    else if (item === "--voice") args.voice = argv[++i];
    else if (item === "--project") args.project = argv[++i];
    else rest.push(item);
  }
  args.content = rest[0];
  return args;
}

/** ทำงานเป็นชุด ๆ ละ CONCURRENCY โดยที่ลำดับผลลัพธ์ยังตรงกับลำดับช็อต */
async function inBatches(items, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    out.push(...await Promise.all(batch.map((item, offset) => worker(item, i + offset))));
  }
  return out;
}

/**
 * ลองใหม่หนึ่งครั้งเมื่อช็อตเดียวพัง
 *
 * ตัวสร้างภาพเป็น agent ไม่ใช่ API บางรอบมันตอบกลับมาโดยไม่ได้เซฟไฟล์ หรือช้าจนหมดเวลา
 * ถ้าปล่อยให้ล้มทั้งงานเพราะช็อตเดียว แปลว่าทิ้งงานอีกสิบเอ็ดช็อตที่ทำสำเร็จไปแล้วด้วย
 */
async function withRetry(label, task) {
  try {
    return await task();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.log(`   ${label} ไม่ผ่านรอบแรก (${error.message}) — ลองใหม่อีกครั้ง`);
    return task();
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.content) {
  console.error("ต้องระบุไฟล์คอนเทนต์\n  node scripts/story-clip.mjs <ไฟล์> [--style <slug>] [--voice <clone-id>]");
  process.exit(1);
}

const contentFile = path.resolve(ROOT, args.content);
if (!fs.existsSync(contentFile)) {
  console.error(`ไม่พบไฟล์คอนเทนต์: ${contentFile}`);
  process.exit(1);
}

const content = fs.readFileSync(contentFile, "utf8");
const style = getVisualStyle(args.style);

// --project ชี้กลับไปที่โฟลเดอร์เดิมได้ เพื่อทำต่อจากของที่สร้างค้างไว้แล้ว
// ภาพหนึ่งใบมีต้นทุนเป็นนาที การเริ่มใหม่ทั้งหมดเพราะช็อตท้าย ๆ พังจึงแพงเกินไป
const projectDir = args.project
  ? ensureDir(path.resolve(ROOT, args.project))
  : ensureDir(path.join(ROOT, "projects", createRunName(`story-${slugify(path.basename(contentFile, path.extname(contentFile)), 24) || "clip"}`)));
const shotsDir = ensureDir(path.join(projectDir, "input"));

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(0)} วินาที`;

console.log(`โปรเจกต์: ${projectDir}`);
console.log(`สไตล์ภาพ: ${style.name} (${style.slug})\n`);

/* ---------- 1. สตอรี่บอร์ด ---------- */

console.log("① กำลังแบ่งช็อตและเขียนพรอมป์ภาพ …");
const storyboardFile = path.join(projectDir, "storyboard.json");
const storyboard = fs.existsSync(storyboardFile)
  ? JSON.parse(fs.readFileSync(storyboardFile, "utf8"))
  : await buildStoryboard({ content, styleId: style.slug });

// ความยาวช็อตต้องมาจากคำพูดของช็อตนั้น ไม่ใช่ตั้ง 6 วินาทีเท่ากันหมด
// ผู้ช่วยแบ่งช็อตออกมายาวไม่เท่ากันเสมอ ถ้าปล่อยให้ทุกช็อตยาว 6 วินาที ช็อตที่มีคำพูด
// ยาวจะพูดไม่จบก่อนภาพเปลี่ยน — image_to_video เลือกได้แค่ 6 หรือ 10 จึงต้องเลือกให้ถูก
// ตั้งแต่ก่อนสร้าง ไม่ใช่ไปแก้ทีหลังตอนที่คลิปเจนมาแล้ว
const voiceId = args.voice || "clone-15d7359bec9d";
const clone = findClone(voiceId);
const speechModel = lookupSpeechModel({}, { provider: clone ? "jaitts" : "gemini", voice: voiceId, speed: 1 });
for (const shot of storyboard.shots) {
  shot.spokenMs = chunkMs(speechModel, shot.narration);
  shot.seconds = nearestShotSeconds(shot.spokenMs / 1000);
}

writeJson(storyboardFile, storyboard);
const long = storyboard.shots.filter((shot) => shot.seconds === 10).length;
console.log(`   ได้ ${storyboard.shots.length} ช็อต · “${storyboard.title}” · ${long} ช็อตยาว 10 วินาที · ${since()}\n`);

/* ---------- 2. ภาพนิ่ง ---------- */

console.log("② กำลังสร้างภาพทีละช็อต …");
const images = await inBatches(storyboard.shots, async (shot) => {
  const outFile = path.join(shotsDir, `${shot.id}.png`);
  if (fs.existsSync(outFile)) {
    console.log(`   ${shot.id} มีภาพอยู่แล้ว ข้าม`);
    return { file: outFile, width: null, height: null };
  }
  const result = await withRetry(shot.id, () => generateImage({ prompt: shot.image, style, outFile, aspect: "9:16" }));
  console.log(`   ${shot.id} ภาพเสร็จ ${result.width}x${result.height}`);
  return result;
});
console.log(`   ครบ ${images.length} ภาพ · ${since()}\n`);

/* ---------- 3. ขยับเป็นวิดีโอ ---------- */

console.log("③ กำลังขยับภาพเป็นวิดีโอ 720p …");
const clips = await inBatches(storyboard.shots, async (shot, index) => {
  const outFile = path.join(shotsDir, `${shot.id}.mp4`);
  if (fs.existsSync(outFile)) {
    const ms = await durationMs(outFile);
    console.log(`   ${shot.id} มีวิดีโออยู่แล้ว ข้าม`);
    return { file: outFile, durationMs: ms, width: null, height: null };
  }
  const result = await withRetry(shot.id, () => animateImage({
    imageFile: images[index].file,
    motion: shot.motion,
    style,
    outFile,
    seconds: nearestShotSeconds(shot.seconds),
  }));
  console.log(`   ${shot.id} วิดีโอเสร็จ ${result.width}x${result.height} · ${(result.durationMs / 1000).toFixed(1)} วินาที`);
  return result;
});
console.log(`   ครบ ${clips.length} คลิป · ${since()}\n`);

/* ---------- 4. ประกอบด้วยสายพานเดิม ---------- */

// เสียงยังไม่ถูกสร้าง จึงยังไม่รู้ความยาวจริงของแต่ละท่อน ใช้ค่าที่กะไว้ตอนเลือกความยาวช็อต
// ส่วนที่คลาดเคลื่อน ขั้นเกลี่ยเสียงของ pipeline จัดการต่อเองอยู่แล้ว (ตัดหรือยืดให้พอดีอัตโนมัติ)
const sourceSelections = storyboard.shots.map((shot, index) => {
  const clip = clips[index];
  // อย่างน้อย 1.2 วินาทีเพื่อไม่ให้ภาพแวบเดียวแล้วหาย และไม่เกินความยาวคลิปที่เจนมาได้
  const showMs = Math.min(clip.durationMs, Math.max(1200, shot.spokenMs));
  return {
    file: path.relative(projectDir, clip.file),
    order: index,
    trimStartMs: 0,
    trimEndMs: Math.round(showMs),
  };
});

const script = {
  id: "story",
  chunks: storyboard.shots.map((shot, index) => ({
    i: index,
    text: shot.narration,
    role: index === 0 ? "hook" : "body",
    emphasis: [],
  })),
};

const targetSec = sourceSelections.reduce((sum, item) => sum + item.trimEndMs, 0) / 1000;

console.log(`④ กำลังส่งเข้าสายพานเดิม · เป้าหมาย ${targetSec.toFixed(1)} วินาที · เสียง ${clone ? `${clone.speaker} (โคลน)` : voiceId} …`);

const result = await runPipeline({
  projectDir,
  sourceFiles: sourceSelections.map((item) => item.file),
  sourceSelections,
  script,
  variant: script,
  styleId: args.caption,
  targetSec,
  brief: { name: storyboard.title, category: "คลิปเล่าเรื่อง" },
  voice: clone
    ? { provider: "jaitts", id: clone.id, speed: 1 }
    : { provider: "gemini", id: voiceId, speed: 1 },
  onProgress: (event) => {
    process.stdout.write(`\r   ${String(event.progress).padStart(3)}% ${event.message ?? ""}`.padEnd(78));
  },
});

process.stdout.write("\n");

const video = result.outputs?.video ?? result.outputs?.final;
console.log(`\n เสร็จแล้วใน ${since()}`);
console.log(`   คลิป: ${video?.path ?? "(ไม่พบไฟล์วิดีโอ)"}`);
if (result.warnings?.length) {
  console.log("\n   คำเตือน:");
  for (const warning of result.warnings) console.log(`   · ${warning}`);
}
if (storyboard.hashtags.length) console.log(`\n   แฮชแท็กจากต้นฉบับ: ${storyboard.hashtags.join(" ")}`);
