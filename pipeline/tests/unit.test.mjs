import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AlphaOverlayError,
  ProcessTimeoutError,
  buildOrderedSourcePlan,
  compileAss,
  compileComposition,
  createRunName,
  durationMs,
  estimateMs,
  ffmpegAvailable,
  listStyles,
  listVoices,
  padNarrationTimeline,
  run,
  speakerGenderForVoice,
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

test("script gender lookup understands explicit and auto voice providers", () => {
  assert.equal(speakerGenderForVoice({ provider: "gemini", id: "Charon" }), "ชาย");
  assert.equal(speakerGenderForVoice({ provider: "auto", id: "Kore" }), "หญิง");
  assert.equal(speakerGenderForVoice({ id: "Puck" }), "ชาย");
  assert.equal(speakerGenderForVoice({ provider: "gemini", id: "missing" }), null);
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
  // หน้าเลือกเสียงกรองด้วยเพศ เสียงที่ไม่มี gender จะหายไปจากทั้งสองตัวกรอง
  assert.ok(voices.every((voice) => voice.gender === "ชาย" || voice.gender === "หญิง"));
  assert.equal(voices.filter((voice) => voice.gender === "หญิง").length, 14);
});

/** PCM 16-bit mono 24kHz หนึ่งวินาที ใช้แทนเสียงที่ Gemini ส่งกลับมาในเทสต์ */
function pcmTone(samples) {
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((i / 24000) * 2 * Math.PI * 220) * 9000), i * 2);
  }
  return buffer;
}

test("Gemini repeats the request verbatim when it answers with text instead of audio", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-tts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prompts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
    const payload = prompts.length === 1
      ? { candidates: [{ content: { parts: [{ text: "คุณอยากให้ช่วยเรื่องอะไรคะ" }] }, finishReason: "STOP" }] }
      : {
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: "audio/L16;codec=pcm;rate=24000",
                // ต้องเป็นเสียงจริง ไม่ใช่ศูนย์ล้วน เพราะ pipeline มีฟิลเตอร์ตัดความเงียบหัวไฟล์
                data: pcmTone(24000).toString("base64"),
              },
            }],
          },
        }],
      };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const result = await synthesize({
    text: "หิวจุกจิกทั้งวัน ตัวนี้ช่วยได้",
    provider: "gemini",
    voice: "Kore",
    styleHint: "พูดโทนเป็นกันเอง",
    outFile: path.join(dir, "out.wav"),
  });

  assert.equal(prompts.length, 2, "ต้องลองใหม่หนึ่งรอบเมื่อได้ข้อความแทนเสียง");
  assert.match(prompts[1], /verbatim/i);
  assert.ok(prompts[1].includes("หิวจุกจิกทั้งวัน"));
  assert.ok(fs.existsSync(result.file));
});

test("finishReason=OTHER is retried rather than failing the render", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-tts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    // สองครั้งแรกโมเดลสะดุด ครั้งที่สามได้เสียงตามปกติ เหมือนที่เจอกับ Gemini จริง
    const payload = calls < 3
      ? { candidates: [{ finishReason: "OTHER", content: { parts: [] } }] }
      : {
        candidates: [{
          content: {
            parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcmTone(24000).toString("base64") } }],
          },
        }],
      };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const result = await synthesize({
    text: "กดตะกร้าด้านล่าง",
    provider: "gemini",
    voice: "Kore",
    outFile: path.join(dir, "out.wav"),
  });

  assert.equal(calls, 3);
  assert.ok(fs.existsSync(result.file));
});

test("a no-audio reply reports the reason Gemini actually gave", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-tts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  t.after(() => { globalThis.fetch = realFetch; });

  await assert.rejects(
    synthesize({ text: "ประโยคยาวมาก", provider: "gemini", voice: "Kore", outFile: path.join(dir, "out.wav") }),
    // เดิมบอกว่า "อาจโดน safety filter" ทุกกรณี ซึ่งพาไปแก้ผิดจุด
    (error) => /ยาวเกิน/.test(error.message) && !/safety/i.test(error.message),
  );
});

test("ordered edit plan preserves split/repeated source order and exact trims", () => {
  const sourceA = { file: "a.mp4", meta: { name: "a.mp4", durationMs: 12_000 } };
  const sourceB = { file: "b.mp4", meta: { name: "b.mp4", durationMs: 8_000 } };
  const plan = buildOrderedSourcePlan([sourceA, sourceB], [
    { id: "third", file: "a.mp4", assetName: "a.mp4", order: 2, trimStartMs: 5_000, trimEndMs: 7_000 },
    { id: "first", file: "a.mp4", assetName: "a.mp4", order: 0, trimStartMs: 1_000, trimEndMs: 2_500 },
    { id: "second", file: "b.mp4", assetName: "b.mp4", order: 1, trimStartMs: 250, trimEndMs: 1_250 },
  ]);
  assert.deepEqual(plan.segments.map((segment) => segment.id), ["first", "second", "third"]);
  assert.deepEqual(plan.segments.map((segment) => segment.inMs), [1_000, 250, 5_000]);
  assert.deepEqual(plan.segments.map((segment) => segment.srcDurMs), [1_500, 1_000, 2_000]);
  assert.deepEqual(plan.segments.map((segment) => segment.startMs), [0, 1_500, 2_500]);
  assert.equal(plan.totalMs, 4_500);
  assert.equal(plan.mode, "ordered-trim");
});

test("ordered edit plan rejects duplicate order, out-of-range trim, and over 60 seconds", () => {
  const source = { file: "a.mp4", meta: { name: "a.mp4", durationMs: 120_000 } };
  assert.throws(
    () => buildOrderedSourcePlan([source], [
      { id: "a", file: "a.mp4", order: 0, trimStartMs: 0, trimEndMs: 1_000 },
      { id: "b", file: "a.mp4", order: 0, trimStartMs: 1_000, trimEndMs: 2_000 },
    ]),
    (error) => error.code === "INVALID_TIMELINE_ORDER",
  );
  assert.throws(
    () => buildOrderedSourcePlan([source], [
      { id: "past-end", file: "a.mp4", order: 0, trimStartMs: 119_000, trimEndMs: 121_000 },
    ]),
    (error) => error.code === "CLIP_TRIM_OUT_OF_RANGE",
  );
  assert.throws(
    () => buildOrderedSourcePlan([source], [
      { id: "too-long", file: "a.mp4", order: 0, trimStartMs: 0, trimEndMs: 60_001 },
    ]),
    (error) => error.code === "TIMELINE_DURATION_LIMIT",
  );
});

test("narration is padded to the edit duration and never silently truncated", () => {
  const timeline = { durationMs: 2_500, chunks: [], timing: { leadInMs: 250, padMs: 90, tailMs: 500 } };
  const padded = padNarrationTimeline(timeline, 4_000);
  assert.equal(padded.durationMs, 4_000);
  assert.equal(padded.narrationFit.mode, "pad-silence");
  assert.equal(padded.narrationFit.paddedMs, 1_500);
  assert.throws(
    () => padNarrationTimeline({ ...timeline, durationMs: 4_001 }, 4_000),
    (error) => error.code === "NARRATION_TOO_LONG" && /ลดข้อความ/.test(error.message),
  );
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

test("batched audio is split back into one file per chunk, and a bad split is refused", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("FFmpeg is not installed");
  // เสียงที่รวมมาในคำขอเดียวต้องตัดกลับให้ตรงจำนวนท่อน ถ้าตัดไม่ลงตัวต้องปฏิเสธ
  // ไม่ใช่เดา เพราะตัดผิดตำแหน่งแปลว่าซับเลื่อนไม่ตรงเสียงทั้งคลิป
  const { splitOnSilence, cutSpans, buildBatchPrompt } = await import("../tts-batch.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-batch-test-"));
  try {
    const joined = path.join(dir, "joined.wav");
    await run("ffmpeg", [
      "-v", "error",
      "-f", "lavfi", "-i", "sine=f=300:d=1.2",
      "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=1",
      "-f", "lavfi", "-i", "sine=f=400:d=0.9",
      "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=1",
      "-f", "lavfi", "-i", "sine=f=500:d=1.4",
      "-filter_complex", "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[a]",
      "-map", "[a]", "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", "-y", joined,
    ]);

    const spans = await splitOnSilence(joined, 3);
    assert.equal(spans?.length, 3, "เสียงสามท่อนคั่นด้วยความเงียบต้องตัดได้สามช่วง");
    assert.ok(spans[0].startSec < spans[1].startSec && spans[1].startSec < spans[2].startSec, "ช่วงต้องเรียงตามเวลา");

    assert.equal(await splitOnSilence(joined, 5), null, "จำนวนช่วงไม่ตรงต้องคืน null ไม่ใช่เดา");
    assert.equal(await splitOnSilence(joined, 1), null, "ท่อนเดียวไม่ต้องรวมอยู่แล้ว");

    const outs = [0, 1, 2].map((i) => path.join(dir, `part${i}.wav`));
    await cutSpans(joined, spans, outs);
    for (const file of outs) assert.ok(fs.statSync(file).size > 1000, `${path.basename(file)} ต้องมีเสียงจริง`);

    const prompt = buildBatchPrompt(["บรรทัดหนึ่ง", "บรรทัดสอง"], "เป็นกันเอง");
    assert.match(prompt, /บรรทัดหนึ่ง/);
    assert.match(prompt, /บรรทัดสอง/);
    assert.match(prompt, /pause/i, "prompt ต้องสั่งให้เว้นจังหวะ ไม่งั้นตัดกลับไม่ได้");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("quota state survives a restart, but an expired per-minute block does not", async () => {
  // ก่อนหน้านี้สถานะอยู่ในหน่วยความจำล้วน เปิดโปรแกรมใหม่แล้วระบบลืมว่าคีย์ไหนเต็ม
  // แล้วไปยิงซ้ำจนผู้ใช้ต้องรอ timeout ทีละใบ
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-quota-test-"));
  const file = path.join(dir, "tts-quota.json");
  try {
    const first = await import(`../tts-quota.mjs?restart=1`);
    first.configureQuotaStore(file);
    first.noteRateLimited({ keyId: "daily-key", retryAfterMs: 30_000, detail: '{"quotaId":"GenerateRequestsPerDayPerProject"}' });
    first.noteRateLimited({ keyId: "minute-key", retryAfterMs: 1, detail: '{"quotaId":"GenerateRequestsPerMinute"}' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.ok(fs.existsSync(file), "ต้องเขียนไฟล์สถานะไว้");

    // โหลดโมดูลใหม่ = จำลองการเปิดโปรแกรมใหม่ทั้งโปรเซส
    const second = await import(`../tts-quota.mjs?restart=2`);
    second.configureQuotaStore(file);
    assert.equal(second.keyQuotaStatus("daily-key").limited, true, "โควตารายวันต้องยังบล็อกอยู่หลังรีสตาร์ต");
    assert.equal(second.keyQuotaStatus("minute-key").limited, false, "โควตาต่อนาทีที่หมดอายุแล้วต้องไม่ถูกกู้กลับมาบล็อก");
    assert.equal(second.keyQuotaStatus("never-used").limited, false);

    second.noteQuotaOk("daily-key");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(second.keyQuotaStatus("daily-key").limited, false, "ยิงสำเร็จแล้วต้องปลดบล็อก");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("12-bit ProRes overlay passes alpha validation, opaque and empty ones do not", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("FFmpeg is not installed");
  // เลเยอร์ซับจริงเป็น ProRes 4444 ซึ่งถอดรหัสมาเป็น 12 บิตและบีบช่วงค่า
  // (โปร่งสุด=256 ทึบสุด=3750 บนสเกล 4095) เคยทำให้ตัวตรวจเทียบกับ 0–255 แล้ว
  // ตัดสินว่าซับปกติ "ไม่มีความโปร่งใส" จนถอยไปใช้ ASS แทบทุกครั้ง
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-alpha-test-"));
  const make = async (alphaExpr, name) => {
    const file = path.join(dir, name);
    await run("ffmpeg", [
      "-v", "error",
      "-f", "lavfi",
      "-i", `color=c=white:s=160x120:d=1:r=25,format=rgba,geq=r='255':g='255':b='255':a='${alphaExpr}'`,
      "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p12le",
      "-t", "1", "-y", file,
    ]);
    return file;
  };
  const timeline = { chunks: [{ startMs: 0, endMs: 900 }] };
  try {
    const half = await make("if(lt(Y,60),255,0)", "half.mov");
    const result = await validateOverlayAlpha(half, timeline);
    assert.match(result.pixelFormat, /^yuva444p12le$/);
    assert.ok(result.alphaAverage > 100 && result.alphaAverage < 155,
      `alpha ครึ่งเฟรมควรอ่านได้ราว 127 จาก 255 แต่ได้ ${result.alphaAverage}`);

    for (const [expr, name] of [["255", "opaque.mov"], ["0", "clear.mov"]]) {
      await assert.rejects(
        validateOverlayAlpha(await make(expr, name), timeline),
        (error) => error instanceof AlphaOverlayError && error.code === "ALPHA_OVERLAY_INVALID",
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("opaque video is rejected instead of being used as an alpha overlay", async () => {
  await assert.rejects(
    validateOverlayAlpha(
      path.join(workspace, "public", "clip360-sample.mp4"),
      { chunks: [{ startMs: 250, endMs: 900 }] },
    ),
    (error) => error instanceof AlphaOverlayError && error.code === "ALPHA_OVERLAY_INVALID",
  );
});

test("mock TTS creates a probeable WAV and removes its raw scratch file", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("FFmpeg is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-tts-test-"));
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
