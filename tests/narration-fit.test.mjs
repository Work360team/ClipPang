import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MAX_SPEEDUP, fitNarrationToTimeline } from "../pipeline/narration-fit.mjs";
import { DEFAULT_TIMING, padNarrationTimeline } from "../pipeline/core.mjs";
import { durationMs, ffmpeg } from "../pipeline/lib.mjs";

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-fit-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** เสียงพูดจำลอง: โทนต่อเนื่อง ตามด้วยความเงียบท้ายแบบที่ TTS มักทิ้งไว้ */
async function makeTake(directory, index, speechSec, tailSilenceSec) {
  const file = path.join(directory, `chunk_${index}.wav`);
  await ffmpeg([
    "-f", "lavfi", "-i", `sine=frequency=300:sample_rate=24000:duration=${speechSec}`,
    "-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono:d=${tailSilenceSec}`,
    "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", "-y", file,
  ]);
  return { file, durationMs: await durationMs(file) };
}

const overhead = (count) =>
  DEFAULT_TIMING.leadInMs + Math.max(0, count - 1) * DEFAULT_TIMING.padMs + DEFAULT_TIMING.tailMs;

test("เสียงที่ลงไทม์ไลน์อยู่แล้ว ต้องไม่ถูกแตะต้อง", async (t) => {
  const root = temporaryDirectory(t);
  const takes = [await makeTake(root, 0, 1.0, 0.2)];
  const before = takes[0].durationMs;

  const result = await fitNarrationToTimeline(takes, { targetMs: 10_000 });

  assert.equal(result.fits, true);
  assert.deepEqual(result.applied, [], "ยังพอดีอยู่ ห้ามเร่งหรือตัดอะไรทั้งนั้น");
  assert.equal(takes[0].durationMs, before);
});

test("ตัดความเงียบท้ายก่อนเสมอ เพราะไม่กระทบคำพูดเลย", async (t) => {
  const root = temporaryDirectory(t);
  // พูด 1 วินาที แต่มีหางเงียบยาว 1.5 วินาที — ตัดหางอย่างเดียวก็ลงแล้ว
  const takes = [await makeTake(root, 0, 1.0, 1.5)];
  const target = overhead(1) + 1300;

  const result = await fitNarrationToTimeline(takes, { targetMs: target });

  assert.equal(result.fits, true);
  assert.deepEqual(result.applied, ["ตัดความเงียบท้ายท่อน"], "ไม่ควรต้องเร่งเสียงเลย");
  assert.ok(takes[0].durationMs < 1300, `ควรเหลือราว 1 วินาที แต่ได้ ${takes[0].durationMs}`);
});

test("ถ้าตัดหางแล้วยังเกิน ค่อยเร่งเสียงเท่าที่จำเป็น", async (t) => {
  const root = temporaryDirectory(t);
  const takes = [
    await makeTake(root, 0, 2.0, 0.05),
    await makeTake(root, 1, 2.0, 0.05),
  ];
  const speech = takes.reduce((sum, take) => sum + take.durationMs, 0);
  // ขอให้สั้นลงราว 8% ซึ่งอยู่ในเพดาน
  const target = overhead(2) + Math.round(speech * 0.92);

  const result = await fitNarrationToTimeline(takes, { targetMs: target });

  assert.equal(result.fits, true, `ควรลงได้ แต่ ${JSON.stringify(result)}`);
  assert.ok(result.applied.some((step) => step.includes("เร่งเสียง")), `applied = ${result.applied}`);
  assert.ok(result.rate > 1 && result.rate <= MAX_SPEEDUP, `rate = ${result.rate}`);
  assert.ok(result.narrationMs <= target, `${result.narrationMs} ต้องไม่เกิน ${target}`);
});

test("เกินเพดานที่ฟังรู้เรื่อง ต้องยอมแพ้ ไม่ใช่เร่งจนฟังไม่ออก", async (t) => {
  const root = temporaryDirectory(t);
  const takes = [await makeTake(root, 0, 4.0, 0.05)];
  // ขอให้เหลือครึ่งเดียว — เร่ง 2 เท่าภาษาไทยฟังไม่รู้เรื่องแล้ว
  const target = overhead(1) + Math.round(takes[0].durationMs * 0.5);

  const result = await fitNarrationToTimeline(takes, { targetMs: target });

  assert.equal(result.fits, false);
  assert.ok(result.rate > MAX_SPEEDUP, `rate = ${result.rate}`);
  assert.equal(result.applied.some((step) => step.includes("เร่งเสียง")), false, "ห้ามเร่งเกินเพดาน");
});

test("ข้อความตอนยอมแพ้ ต้องบอกว่าระบบพยายามอะไรไปแล้ว", () => {
  assert.throws(
    () => padNarrationTimeline({ durationMs: 21_000, chunks: [] }, 19_700, ["ตัดความเงียบท้ายท่อน"]),
    (error) => {
      assert.equal(error.code, "NARRATION_TOO_LONG");
      assert.match(error.message, /เกิน 1\.3 วินาที/);
      assert.match(error.message, /ตัดความเงียบท้ายท่อน/);
      // ไม่ควรแนะให้ "เพิ่มความเร็วเสียง" อีก เพราะระบบทำให้แล้ว
      assert.equal(/เพิ่มความเร็วเสียง/.test(error.message), false);
      return true;
    },
  );
});
