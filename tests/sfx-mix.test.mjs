// ตรวจว่าสายผสมเสียงวาง SFX ลงตรงวินาทีที่สั่ง — วัดจากไฟล์ที่ ffmpeg ประกอบออกมาจริง
//
// เทสต์ชุด sfx-cues ตรวจแค่ว่า "คิดเวลาถูกไหม" ส่วนชุดนี้ตรวจว่า "เสียงไปโผล่ตรงนั้นจริงไหม"
// ซึ่งเป็นคนละเรื่องกัน เพราะ adelay กับ amix มีโอกาสพลาดได้เอง

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { burnAndMux } from "../pipeline/render.mjs";
import { sfxAudioDir } from "../pipeline/sfx.mjs";
import { ffmpegAvailable } from "../pipeline/media.mjs";

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (data) => { err += data; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(err.split("\n").slice(-8).join("\n")))));
  });
}

/** ระดับเสียงเฉลี่ยของช่วงเวลาหนึ่งในไฟล์ หน่วย dBFS */
async function levelAt(file, startSec, lengthSec) {
  const log = await ffmpeg([
    "-hide_banner", "-ss", String(startSec), "-i", file, "-t", String(lengthSec),
    "-af", "volumedetect", "-f", "null", "-",
  ]);
  const found = /mean_volume:\s*(-?[\d.]+) dB/.exec(log);
  assert.ok(found, `อ่านระดับเสียงช่วง ${startSec}s ไม่ได้`);
  return Number(found[1]);
}

test("SFX ไปโผล่ตรงวินาทีที่สั่ง และไม่ไปโผล่ที่อื่น", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("ยังไม่ได้ติดตั้ง FFmpeg");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-sfx-mix-"));
  try {
    // วิดีโอดำ 8 วินาที กับเสียงพากย์ที่เป็นความเงียบสนิท — พื้นเงียบทำให้วัดได้ชัดว่า
    // ระดับเสียงที่โผล่ขึ้นมาคือ SFX ล้วน ไม่ใช่เสียงอื่นปน
    await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=180x320:r=15:d=8",
      "-pix_fmt", "yuv420p", "-y", path.join(dir, "video.mp4")]);
    await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=8",
      "-y", path.join(dir, "voice.wav")]);
    // เลน ass ต้องมีไฟล์ซับเสมอ ใส่ไฟล์เปล่าที่ถูกรูปแบบไว้ให้ เทสต์นี้สนใจแต่เสียง
    fs.writeFileSync(path.join(dir, "captions.ass"), [
      "[Script Info]", "ScriptType: v4.00+", "PlayResX: 180", "PlayResY: 320", "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,Arial,20,&H00FFFFFF,2,10,10,10,1", "",
      "[Events]",
      "Format: Layer, Start, End, Style, Text", "",
    ].join("\n"), "utf8");

    const cue = (name, atMs, gainDb) => ({
      cue: name,
      file: `${name}.wav`,
      path: path.join(sfxAudioDir(), `${name}.wav`),
      atMs,
      gainDb,
    });

    await burnAndMux(
      // ไทม์ไลน์ต้องมี chunks เพราะเลน ass ใช้ แต่เทสต์นี้ให้ overlay ไปเลยจะได้ไม่แตะ libass
      { durationMs: 8000, chunks: [{ startMs: 0, endMs: 8000, text: "x", words: [] }] },
      dir,
      "out.mp4",
      { sfx: [cue("ding", 2000, -6), cue("ding", 5000, -6)] },
    );

    const out = path.join(dir, "out.mp4");
    assert.ok(fs.existsSync(out), "ไม่ได้ไฟล์ผลลัพธ์");

    const atCueOne = await levelAt(out, 2.0, 0.5);
    const atCueTwo = await levelAt(out, 5.0, 0.5);
    const quiet = await levelAt(out, 3.4, 0.5);

    assert.ok(atCueOne > quiet + 25, `คิวแรกไม่ดังพอ: ${atCueOne} เทียบกับพื้นเงียบ ${quiet}`);
    assert.ok(atCueTwo > quiet + 25, `คิวที่สองไม่ดังพอ: ${atCueTwo} เทียบกับพื้นเงียบ ${quiet}`);
    // ช่วงที่ไม่ได้สั่งต้องเงียบจริง ไม่ใช่มีเสียงลากยาวมาจากคิวก่อนหน้า
    assert.ok(quiet < -55, `ช่วงที่ไม่มีคิวควรเงียบ แต่วัดได้ ${quiet} dB`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
