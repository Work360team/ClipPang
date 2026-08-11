import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AlphaOverlayError,
  ProcessTimeoutError,
  compileAss,
  compileComposition,
  createRunName,
  durationMs,
  estimateMs,
  ffmpegAvailable,
  listStyles,
  listVoices,
  run,
  slugify,
  synthesize,
  validateOverlayAlpha,
} from "../index.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("slugify preserves Thai combining marks and grapheme boundaries", () => {
  assert.equal(slugify("  น้ำหนัก ดีมาก!  "), "น้ำหนัก-ดีมาก");
  assert.equal(slugify("ก้", 1), "ก้");
});

test("run names remain unique for the same millisecond", () => {
  const now = new Date("2026-08-11T09:02:03.004Z");
  const one = createRunName("น้ำหนัก", { now, suffix: "aaaa" });
  const two = createRunName("น้ำหนัก", { now, suffix: "bbbb" });
  assert.notEqual(one, two);
  assert.match(one, /^น้ำหนัก-20260811T090203004Z-aaaa$/u);
});

test("speech-rate environment is read at call time, not import time", () => {
  const before = process.env.SPEAK_GRAPHEMES_PER_SEC;
  try {
    process.env.SPEAK_GRAPHEMES_PER_SEC = "5";
    const slow = estimateMs("ทดสอบภาษาไทย");
    process.env.SPEAK_GRAPHEMES_PER_SEC = "10";
    const fast = estimateMs("ทดสอบภาษาไทย");
    assert.ok(slow >= fast * 1.9);
  } finally {
    if (before === undefined) delete process.env.SPEAK_GRAPHEMES_PER_SEC;
    else process.env.SPEAK_GRAPHEMES_PER_SEC = before;
  }
});

test("child process timeout terminates and rejects with a typed error", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 50, killGraceMs: 50 }),
    (error) => error instanceof ProcessTimeoutError && error.code === "PROCESS_TIMEOUT",
  );
});

test("child stderr capture is bounded", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "process.stderr.write('x'.repeat(20000) + 'END'); process.exit(2)"], {
      maxStderrBytes: 1024,
    }),
    (error) => {
      assert.ok(Buffer.byteLength(error.stderr) <= 1030);
      assert.match(error.stderr, /END$/);
      return true;
    },
  );
});

test("all shipped caption presets use the bundled Kanit family", async () => {
  const styles = await listStyles();
  assert.ok(styles.length >= 4);
  for (const style of styles) assert.equal(style.params.font.family, "Kanit");

  const ass = compileAss({ chunks: [] }, styles.find((style) => style.id === "karaoke-pop"));
  assert.match(ass, /Style: Main,Kanit,/);
});

test("Gemini exposes the complete 30-voice catalog", async () => {
  const voices = await listVoices();
  assert.equal(voices.length, 30);
  assert.ok(voices.every((voice) => voice.provider === "gemini"));
  assert.ok(voices.some((voice) => voice.id === "Kore" && voice.isDefault));
  assert.ok(voices.some((voice) => voice.id === "Sulafat"));
});

test("HyperFrames composition compiles with bundled font and GSAP assets", async () => {
  const style = (await listStyles()).find((item) => item.id === "kanit-hf");
  const html = compileComposition({
    durationMs: 1_000,
    chunks: [{
      text: "ทดสอบ",
      startMs: 0,
      endMs: 1_000,
      words: [{ text: "ทดสอบ", s: 0, e: 5, startMs: 0, endMs: 1_000, emphasis: false }],
    }],
  }, style, { width: 360, height: 640, fps: 15 });
  assert.match(html, /@font-face\{font-family:'Kanit'/);
  assert.match(html, /window\.__timelines\.captions = tl/);
  assert.match(html, /gsap\.timeline/);
});

test("opaque video is rejected instead of being used as an alpha overlay", async () => {
  await assert.rejects(
    validateOverlayAlpha(
      path.join(workspace, "public", "clippang-sample.mp4"),
      { chunks: [{ startMs: 250, endMs: 900 }] },
    ),
    (error) => error instanceof AlphaOverlayError && error.code === "ALPHA_OVERLAY_INVALID",
  );
});

test("mock TTS creates a probeable WAV and removes its raw scratch file", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("FFmpeg is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clippang-tts-test-"));
  try {
    const file = path.join(dir, "mock.wav");
    const result = await synthesize({
      text: "ทดสอบเสียงพากย์",
      provider: "mock",
      voice: "mock-th",
      outFile: file,
    });
    assert.ok(result.durationMs >= 600);
    assert.equal(await durationMs(file), result.durationMs);
    assert.equal(fs.existsSync(`${file}.raw.wav`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
