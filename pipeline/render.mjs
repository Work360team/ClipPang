// render — ประกอบภาพ + เสียง + เบิร์นซับ  →  อนาคตคือ packages/media/render
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ffmpeg } from "./lib.mjs";
import { concatFiles, renderSegment, silenceWav } from "./media.mjs";

/** เรนเดอร์ทุก segment เป็นไฟล์มาตรฐาน แล้วต่อเป็นแทร็กภาพเส้นเดียว */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const processOpts = (opts = {}) => ({ signal: opts.signal, timeoutMs: opts.timeoutMs });

export async function buildVideoTrack(segments, workDir, opts, onProgress = () => {}) {
  const dir = path.join(workDir, "seg");
  fs.mkdirSync(dir, { recursive: true });

  const files = [];
  for (const [i, seg] of segments.entries()) {
    const name = `seg_${String(i).padStart(3, "0")}.mp4`;
    await renderSegment(seg, path.join(dir, name), opts, workDir, processOpts(opts));
    files.push(path.join("seg", name).replace(/\\/g, "/"));
    await onProgress(i + 1, segments.length);
  }

  const listFile = path.join(workDir, "segments.txt");
  fs.writeFileSync(listFile, files.map((f) => `file '${f}'`).join("\n"), "utf8");
  return concatFiles("segments.txt", "video.mp4", workDir, processOpts(opts));
}

/**
 * ต่อเสียงพากย์รายท่อนตาม timeline เดียวกับที่ซับใช้
 * ลำดับ: เงียบนำ → ท่อน1 → เงียบคั่น → ท่อน2 → … → เงียบท้าย
 * เพราะสร้างจาก offset ชุดเดียวกัน ซับกับเสียงจึงตรงกันโดยโครงสร้าง ไม่ใช่โดยบังเอิญ
 */
export async function buildVoiceTrack(timeline, workDir, opts = {}) {
  const { leadInMs, padMs, tailMs } = timeline.timing;
  const dir = path.join(workDir, "voice");
  fs.mkdirSync(dir, { recursive: true });

  const lead = path.join("voice", "_lead.wav");
  const pad = path.join("voice", "_pad.wav");
  const tail = path.join("voice", "_tail.wav");
  await silenceWav(leadInMs, lead, workDir, processOpts(opts));
  await silenceWav(padMs, pad, workDir, processOpts(opts));
  await silenceWav(tailMs, tail, workDir, processOpts(opts));

  const parts = [lead];
  timeline.chunks.forEach((c, i) => {
    parts.push(path.relative(workDir, c.audioFile).replace(/\\/g, "/"));
    if (i < timeline.chunks.length - 1) parts.push(pad);
  });
  parts.push(tail);

  fs.writeFileSync(
    path.join(workDir, "voice.txt"),
    parts.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"),
    "utf8",
  );
  await concatFiles("voice.txt", "voice_raw.wav", workDir, processOpts(opts));

  // ระดับเสียงมาตรฐานแพลตฟอร์มโซเชียล แล้วบังคับความยาวให้เท่า timeline เป๊ะ
  await ffmpeg([
    "-i", "voice_raw.wav",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,apad",
    "-t", (timeline.durationMs / 1000).toFixed(3),
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
    "-y", "voice.wav",
  ], { ...processOpts(opts), cwd: workDir });

  return path.join(workDir, "voice.wav");
}

/**
 * รวมทุกอย่างเป็นไฟล์ส่งมอบ
 * caption มีสองทาง: เบิร์นด้วย libass (เลน A) หรือวางทับด้วยเลเยอร์ที่มี alpha (เลน B)
 */
export async function burnAndMux(
  timeline,
  workDir,
  outFile,
  {
    bgm = null,
    bgmGainDb = -14,
    overlay = null,
    fontsDir = path.join(ROOT, "fonts"),
    signal,
    timeoutMs,
  } = {},
) {
  const total = (timeline.durationMs / 1000).toFixed(3);
  const args = ["-i", "video.mp4", "-i", "voice.wav"];
  const filters = [];
  let next = 2;

  if (overlay) {
    const idx = next;
    next += 1;
    args.push("-i", overlay);
    filters.push(
      `[0:v][${idx}:v]overlay=0:0:eof_action=pass:format=auto,tpad=stop_mode=clone:stop_duration=${total}[v]`,
    );
  } else {
    if (!fs.existsSync(fontsDir)) throw new Error(`ไม่พบโฟลเดอร์ฟอนต์สำหรับ libass: ${fontsDir}`);
    let relativeFonts = path.relative(workDir, fontsDir) || ".";
    // ffmpeg filter arguments have their own escaping rules after spawn has
    // already bypassed the shell. Forward slashes also keep Thai Windows paths
    // intact; drive colons and apostrophes must still be escaped.
    relativeFonts = relativeFonts
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'")
      .replace(/,/g, "\\,");
    filters.push(
      `[0:v]ass=filename='captions.ass':fontsdir='${relativeFonts}',` +
      `tpad=stop_mode=clone:stop_duration=${total}[v]`,
    );
  }

  if (bgm) {
    const idx = next;
    next += 1;
    args.push("-stream_loop", "-1", "-i", bgm);
    // normalize=0 สำคัญ ถ้าปล่อยค่าเริ่มต้น amix จะหารระดับเสียงทุกทางเข้าด้วยจำนวนทาง
    // ทั้งเสียงพากย์และเพลงจะเบาลง 6 dB และค่าที่ผู้ใช้เลือกจะไม่ตรงกับที่ได้ยิน
    // ยอดคลื่นที่เกินให้ alimiter คุมท้ายสายแทน
    filters.push(
      `[${idx}:a]volume=${bgmGainDb}dB,aformat=sample_rates=24000:channel_layouts=mono[bg]`,
      "[bg][1:a]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400[duck]",
      "[duck][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]",
    );
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[v]",
    "-map", bgm ? "[a]" : "1:a:0",
    "-t", total,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-movflags", "+faststart",
    "-y", outFile,
  );

  await ffmpeg(args, { cwd: workDir, signal, timeoutMs });
  return path.join(workDir, outFile);
}

export async function poster(videoFile, outFile, workDir, atSec = 1.2, opts = {}) {
  await ffmpeg([
    "-ss", String(atSec),
    "-i", videoFile,
    "-frames:v", "1",
    "-q:v", "3",
    "-y", outFile,
  ], { ...processOpts(opts), cwd: workDir });
  return path.join(workDir, outFile);
}
