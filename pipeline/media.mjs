// media — probe / scene detect / normalize  →  อนาคตคือ packages/media
import path from "node:path";
import { ffmpeg, ffprobe, run } from "./lib.mjs";

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
export const isVideo = (f) => VIDEO_EXT.has(path.extname(f).toLowerCase());

/** อ่านสเปกไฟล์จริง — ไม่เชื่อนามสกุล */
export async function probe(file, opts = {}) {
  const { out } = await ffprobe([
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ], opts);
  const data = JSON.parse(out);
  const v = data.streams.find((s) => s.codec_type === "video");
  const a = data.streams.find((s) => s.codec_type === "audio");
  if (!v) throw new Error(`ไม่พบ video stream ใน ${path.basename(file)}`);
  const [num, den] = String(v.r_frame_rate || "30/1").split("/").map(Number);
  const mediaDurationMs = Math.round(Number(data.format.duration) * 1000);
  if (!Number.isFinite(mediaDurationMs) || mediaDurationMs <= 0) {
    throw new Error(`อ่านความยาว video ไม่ได้จาก ${path.basename(file)}`);
  }
  return {
    file,
    name: path.basename(file),
    width: v.width,
    height: v.height,
    fps: den ? num / den : 30,
    codec: v.codec_name,
    hasAudio: Boolean(a),
    durationMs: mediaDurationMs,
    sizeBytes: Number(data.format.size || 0),
    bitrate: Number(data.format.bit_rate || 0),
  };
}

/**
 * หาจุดตัดช็อตด้วย scene score ของ ffmpeg
 * คืนค่าเป็น ms ของทุกจุดที่ภาพเปลี่ยนฉาก (ไม่รวม 0 และท้ายคลิป)
 */
export async function detectScenes(file, threshold = 0.32, opts = {}) {
  let err = "";
  try {
    ({ err } = await ffmpeg([
    "-i", file,
    "-filter:v", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null", "-",
    ], opts));
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
    err = String(error?.stderr || error?.message || "");
  }

  const cuts = [];
  for (const m of err.matchAll(/pts_time:([0-9.]+)/g)) {
    const ms = Math.round(Number.parseFloat(m[1]) * 1000);
    if (ms > 400 && (cuts.length === 0 || ms - cuts.at(-1) > 700)) cuts.push(ms);
  }
  return cuts;
}

/**
 * คะแนนความน่าใช้เป็นช็อตเปิด (hook)
 * ยิ่งภาพเคลื่อนไหวเยอะ + บิตเรตสูง = ยิ่งน่าดึงสายตา
 */
export function shotScore(meta, cuts) {
  const sec = Math.max(1, meta.durationMs / 1000);
  const motion = Math.min(1, (cuts.length + 1) / (sec / 3));
  const quality = Math.min(1, meta.bitrate / 3_000_000);
  const portrait = meta.height >= meta.width ? 0.15 : 0;
  return Number((motion * 0.55 + quality * 0.3 + portrait).toFixed(3));
}

/** ความหนาแน่นของ "ขอบ" ในแถบแนวนอนหนึ่งแถบ ณ เวลาหนึ่ง */
async function edgeDensity(file, atSec, yFrac, hFrac = 0.2, opts = {}) {
  let err = "";
  try {
    ({ err } = await ffmpeg([
    "-ss", atSec.toFixed(2),
    "-i", file,
    "-frames:v", "1",
    "-filter:v", `crop=iw:ih*${hFrac}:0:ih*${yFrac},edgedetect=low=0.1:high=0.3,signalstats,metadata=print`,
    "-f", "null", "-",
    ], opts));
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
    err = String(error?.stderr || error?.message || "");
  }
  const m = err.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
  return m ? Number.parseFloat(m[1]) : 0;
}

/**
 * ตรวจว่าคลิปมีซับเบิร์นติดมาที่ lower third แล้วหรือยัง
 *
 * วัดความหนาแน่นของขอบในแถบซับ เทียบกับแถบกลางภาพที่ใช้เป็นตัวควบคุม
 * ตัวหนังสือมีขอบคมและถี่กว่าภาพทั่วไปมาก แต่บางเฟรมพื้นหลังก็รก
 * จึงเก็บสามจุดเวลาแล้วใช้ค่าสูงสุด — ซับมักโผล่แค่บางช่วงของคลิป
 */
export async function detectBurnedCaptions(file, meta, opts = {}) {
  const samples = [0.25, 0.5, 0.75];
  let best = { ratio: 0, band: 0, atSec: 0 };

  for (const p of samples) {
    const at = Math.max(0.2, Math.min(meta.durationMs * p, meta.durationMs - 500) / 1000);
    const band = await edgeDensity(file, at, 0.68, 0.2, opts);
    const control = await edgeDensity(file, at, 0.3, 0.2, opts);
    const ratio = band / Math.max(0.4, control);
    if (ratio > best.ratio) best = { ratio: Number(ratio.toFixed(2)), band: Number(band.toFixed(2)), atSec: Number(at.toFixed(1)) };
  }

  return { ...best, likely: best.ratio >= 2.2 && best.band >= 3 };
}

/**
 * ตัดหนึ่งช่วงของคลิปต้นทางให้เป็น segment มาตรฐาน (1080×1920/30fps ไม่มีเสียง)
 * speed < 1 = ช้าลง (ยืดให้ยาวขึ้น)
 */
export async function renderSegment(seg, dst, { width, height, fps }, cwd, opts = {}) {
  const filters = [
    `fps=${fps}`,
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "setsar=1",
  ];
  if (seg.speed && Math.abs(seg.speed - 1) > 0.001) filters.push(`setpts=PTS/${seg.speed}`);

  await ffmpeg([
    "-ss", (seg.inMs / 1000).toFixed(3),
    "-i", seg.src,
    "-t", (seg.srcDurMs / 1000).toFixed(3),
    "-an",
    "-vf", filters.join(","),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-g", String(fps * 2),
    "-y", dst,
  ], { ...opts, cwd });
  return dst;
}

/** ต่อไฟล์ด้วย concat demuxer (ไฟล์ทุกตัวต้องพารามิเตอร์เดียวกัน) */
export async function concatFiles(listFile, dst, cwd, opts = {}) {
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-y", dst], { ...opts, cwd });
  return dst;
}

/** สร้างไฟล์เงียบความยาวที่ต้องการ (24kHz mono 16-bit เท่ากับเสียงพากย์) */
export async function silenceWav(ms, dst, cwd, opts = {}) {
  await ffmpeg([
    "-f", "lavfi",
    "-i", "anullsrc=r=24000:cl=mono",
    "-t", (ms / 1000).toFixed(3),
    "-c:a", "pcm_s16le",
    "-y", dst,
  ], { ...opts, cwd });
  return dst;
}

/** แปลงเสียงจาก provider ให้เป็นรูปแบบเดียวกันก่อนต่อ */
export async function toVoiceWav(src, dst, cwd, opts = {}) {
  await ffmpeg(["-i", src, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", "-y", dst], { ...opts, cwd });
  return dst;
}

export async function ffmpegAvailable(opts = {}) {
  try {
    await run(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { timeoutMs: 10_000, ...opts });
    return true;
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
    return false;
  }
}
