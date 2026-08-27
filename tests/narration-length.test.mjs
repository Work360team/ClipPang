import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TIMING,
  MAX_EXTRA_GAP_MS,
  MIN_SEGMENT_MS,
  TAIL_SILENCE_BUDGET_MS,
  planNarrationFit,
  timingForPace,
  trimSourcePlan,
} from "../pipeline/core.mjs";
import {
  SAMPLE_VERSION,
  characterBudget,
  lookupSpeechModel,
  mergeSamples,
  sampleChunks,
  speechKey,
} from "../pipeline/speech-rate.mjs";
import { buildScriptPrompt } from "../pipeline/script.mjs";

const plan = (durations) => ({
  segments: durations.map((durationMs, index) => ({
    id: `clip-${index + 1}`,
    src: `c${index + 1}.mp4`,
    inMs: 1000 * (index + 1),
    srcDurMs: durationMs,
    outMs: durationMs,
    startMs: durations.slice(0, index).reduce((a, b) => a + b, 0),
    speed: 1,
    order: index,
    trimEndMs: 1000 * (index + 1) + durationMs,
  })),
  totalMs: durations.reduce((a, b) => a + b, 0),
  mode: "ordered-trim",
  ratio: 1,
});

/* ---------- ตัดสินใจว่าจะทำอะไรกับส่วนต่าง ---------- */

test("ขาดนิดเดียวปล่อยเป็นหางท้าย ไม่ต้องไปยุ่งกับอะไรเลย", () => {
  const result = planNarrationFit({ narrationMs: 19_200, targetMs: 19_700, chunkCount: 8 });
  assert.equal(result.action, "keep");
  assert.equal(result.targetMs, 19_700, "ความยาวคลิปต้องไม่เปลี่ยน");
});

test("เสียงยาวกว่าคลิปไม่ใช่หน้าที่ของตัวนี้ ต้องปล่อยให้ทางเดิมจัดการ", () => {
  const result = planNarrationFit({ narrationMs: 25_000, targetMs: 19_700, chunkCount: 8 });
  assert.equal(result.action, "keep");
});

test("ขาดไม่มากเกลี่ยเข้าช่องว่างระหว่างท่อน ภาพที่ผู้ใช้เลือกไม่ถูกแตะเลย", () => {
  const timing = timingForPace("normal");
  const result = planNarrationFit({ narrationMs: 18_000, targetMs: 20_000, chunkCount: 9, timing });
  assert.equal(result.action, "stretch");
  assert.ok(result.extraGapMs > 0 && result.extraGapMs <= MAX_EXTRA_GAP_MS);
  assert.equal(result.padMs, timing.padMs + result.extraGapMs);
  // 8 ช่อง คูณที่เพิ่มต่อช่อง ต้องกลบส่วนเกินได้เกือบหมด (เหลือได้แค่เศษจากการปัด)
  assert.ok(result.extraGapMs * 8 >= (2000 - TAIL_SILENCE_BUDGET_MS) - 8);
});

test("มีท่อนเดียวก็ไม่มีช่องให้เกลี่ย ต้องตัดคลิปแทน", () => {
  const result = planNarrationFit({ narrationMs: 8000, targetMs: 10_000, chunkCount: 1 });
  assert.equal(result.action, "trim");
});

test("ขาดเยอะตัดคลิปให้พอดีเสียง เหลือหางท้ายไว้ให้ซับอ่านจบ", () => {
  const result = planNarrationFit({ narrationMs: 14_715, targetMs: 29_640, chunkCount: 11 });
  assert.equal(result.action, "trim");
  assert.equal(result.targetMs, 14_715 + TAIL_SILENCE_BUDGET_MS);
  assert.equal(result.slackMs, 29_640 - 14_715);
});

test("เกลี่ยได้แค่ในกรอบที่ยังฟังเป็นธรรมชาติ เกินกว่านั้นต้องตัด", () => {
  // 2 ท่อน = 1 ช่อง ถ้าเกลี่ยส่วนเกินลงช่องเดียวจะเว้นยาวจนผิดหู
  const result = planNarrationFit({ narrationMs: 5000, targetMs: 7000, chunkCount: 2 });
  assert.equal(result.action, "trim");
});

/* ---------- หดไทม์ไลน์ภาพ ---------- */

test("หดทุกชิ้นตามสัดส่วน ได้ความยาวตรงเป๊ะและไม่มีชิ้นไหนหาย", () => {
  const source = plan([6000, 9000, 15_000]);
  const trimmed = trimSourcePlan(source, 15_000);
  assert.equal(trimmed.segments.length, 3, "ทุกมุมสินค้าต้องยังอยู่");
  assert.equal(trimmed.totalMs, 15_000, "ผลรวมต้องตรงเป๊ะ ไม่ใช่ใกล้เคียง");
  assert.equal(trimmed.mode, "narration-trim");
  assert.equal(trimmed.trimmedFromMs, 30_000);
  assert.deepEqual(trimmed.segments.map((s) => s.id), ["clip-1", "clip-2", "clip-3"]);
  assert.deepEqual(trimmed.segments.map((s) => s.inMs), source.segments.map((s) => s.inMs));
  for (const [index, segment] of trimmed.segments.entries()) {
    assert.ok(segment.srcDurMs <= source.segments[index].srcDurMs, "หดได้อย่างเดียว ห้ามยืด");
    assert.equal(segment.trimEndMs, segment.inMs + segment.srcDurMs);
    assert.equal(segment.outMs, segment.srcDurMs);
  }
  // startMs ต้องไล่ต่อกันสนิท ไม่งั้นภาพกับเสียงเหลื่อมกัน
  let acc = 0;
  for (const segment of trimmed.segments) {
    assert.equal(segment.startMs, acc);
    acc += segment.srcDurMs;
  }
});

test("ชิ้นที่สั้นอยู่แล้วไม่ถูกหั่นจนกลายเป็นภาพแวบเดียว", () => {
  const source = plan([500, 20_000]);
  const trimmed = trimSourcePlan(source, 6000);
  assert.equal(trimmed.totalMs, 6000);
  assert.ok(trimmed.segments[0].srcDurMs >= Math.min(500, MIN_SEGMENT_MS));
});

test("สั้นจนทุกชิ้นเหลือขั้นต่ำแล้วยังไม่พอ ค่อยตัดชิ้นท้ายทิ้ง", () => {
  const source = plan([2000, 2000, 2000, 2000, 2000, 2000]);
  const trimmed = trimSourcePlan(source, 1500);
  assert.ok(trimmed.segments.length < 6, "ต้องมีชิ้นถูกตัดออกจริง");
  assert.ok(trimmed.droppedSegments > 0);
  assert.ok(trimmed.totalMs <= 2000, `ยาวเกินไป: ${trimmed.totalMs}`);
});

test("เป้าหมายยาวกว่าหรือเท่าของเดิม ต้องคืนแผนเดิมไม่แตะอะไร", () => {
  const source = plan([4000, 4000]);
  assert.equal(trimSourcePlan(source, 8000), source);
  assert.equal(trimSourcePlan(source, 9000), source);
  assert.equal(trimSourcePlan(source, 0), source);
});

/* ---------- อัตราการพูดที่วัดเอง ---------- */

test("สรุปท่อนเป็นสถิติ และข้ามท่อนที่ผิดปกติ", () => {
  const sample = sampleChunks([
    { text: "ตัวนี้ต้องมี", durationMs: 1000 },
    { text: "บอกเลยว่าคุ้ม", durationMs: 1200 },
    { text: "ท่อนพัง", durationMs: 50 },
    { text: "", durationMs: 900 },
  ]);
  assert.equal(sample.n, 2, "ท่อนที่สั้นผิดปกติและท่อนว่างต้องไม่ถูกนับ");
  assert.equal(sample.ms, 2200);
});

test("รวมสถิติข้ามงานได้ และค่าที่วัดเองต้องชนะค่าตั้งต้น", () => {
  const merged = mergeSamples({ v: SAMPLE_VERSION, n: 6, graphemes: 60, ms: 6000 }, { v: SAMPLE_VERSION, n: 6, graphemes: 60, ms: 6000 });
  assert.deepEqual(merged, { v: SAMPLE_VERSION, n: 12, graphemes: 120, ms: 12_000 });
  const key = speechKey({ provider: "gemini", voice: "Laomedeia", speed: 1 });
  const model = lookupSpeechModel({ [key]: merged }, { provider: "gemini", voice: "Laomedeia", speed: 1 });
  assert.equal(model.source, "measured");
  assert.equal(Math.round(model.graphemesPerSec), 10, "120 ตัวอักษรใน 12 วินาที = 10 ตัว/วินาที");
});

test("สถิติที่วัดด้วยวิธีรุ่นเก่าต้องถูกทิ้ง ไม่ใช่เอามาใช้ต่อ", () => {
  const key = speechKey({ provider: "jaitts", voice: "clone-abc", speed: 1 });
  // ค่าเดิมนับตัวอักษรจากคำที่พูดจริง แต่จับเวลาจากเสียงที่ยังข้ามตัวเลขไป
  // อัตราที่ได้จึงเร็วเกินจริงเกือบเท่าตัว แล้วไปทำให้สคริปต์ยาวเกินคลิป
  const stale = { n: 20, graphemes: 320, ms: 20_000 };
  const model = lookupSpeechModel({ [key]: stale }, { provider: "jaitts", voice: "clone-abc", speed: 1 });
  assert.equal(model.source, "default", "ไม่มีรุ่นกำกับ = วัดด้วยวิธีเก่า ต้องไม่เชื่อ");

  // ชุดใหม่ที่ติดรุ่นไว้ต้องใช้ได้ตามปกติ
  const fresh = { v: SAMPLE_VERSION, n: 20, graphemes: 200, ms: 20_000 };
  const usable = lookupSpeechModel({ [key]: fresh }, { provider: "jaitts", voice: "clone-abc", speed: 1 });
  assert.equal(usable.source, "measured");
  assert.equal(Math.round(usable.graphemesPerSec), 10);
});

test("รวมสถิติข้ามรุ่นไม่ได้ ต้องเริ่มนับใหม่จากชุดใหม่", () => {
  const merged = mergeSamples({ n: 10, graphemes: 300, ms: 10_000 }, { v: SAMPLE_VERSION, n: 5, graphemes: 50, ms: 5000 });
  assert.equal(merged.n, 5, "ของเก่าต้องไม่ถูกรวมเข้ามา");
  assert.equal(merged.v, SAMPLE_VERSION);
});

test("ตัวอย่างน้อยเกินไปยังไม่เชื่อ ใช้ค่าตั้งต้นของ provider ไปก่อน", () => {
  const key = speechKey({ provider: "gemini", voice: "Kore", speed: 1 });
  const model = lookupSpeechModel(
    { [key]: { v: SAMPLE_VERSION, n: 2, graphemes: 20, ms: 9000 } },
    { provider: "gemini", voice: "Kore", speed: 1 },
  );
  assert.equal(model.source, "default");
  assert.ok(model.graphemesPerSec > 6.4, "ค่าตั้งต้นของ gemini ต้องไม่ใช่ค่าที่วัดจาก edge-tts");
});

test("ไม่มีข้อมูลของเสียงนั้น ใช้เสียงอื่นของ provider เดียวกันแทน", () => {
  const key = speechKey({ provider: "gemini", voice: "Laomedeia", speed: 1 });
  const rates = { [key]: { v: SAMPLE_VERSION, n: 20, graphemes: 200, ms: 20_000 } };
  const model = lookupSpeechModel(rates, { provider: "gemini", voice: "Zephyr", speed: 1 });
  assert.equal(model.source, "measured-nearby");
  assert.equal(Math.round(model.graphemesPerSec), 10);
});

test("เสียงเดียวกันคนละความเร็ว เทียบสัดส่วนตามความเร็ว", () => {
  const key = speechKey({ provider: "gemini", voice: "Laomedeia", speed: 1 });
  const rates = { [key]: { v: SAMPLE_VERSION, n: 20, graphemes: 200, ms: 20_000 } };
  const model = lookupSpeechModel(rates, { provider: "gemini", voice: "Laomedeia", speed: 1.2 });
  assert.equal(model.source, "measured-scaled");
  assert.ok(Math.abs(model.graphemesPerSec - 12) < 0.01, "เร่ง 1.2 เท่า ต้องพูดได้มากขึ้น 1.2 เท่า");
});

test("งบตัวอักษรต้องหักเวลาเว้นวรรคออก จังหวะยิ่งห่างยิ่งพูดได้น้อยคำ", () => {
  const model = { graphemesPerSec: 10.74, msPerGrapheme: 1000 / 10.74 };
  const target = 29_640;
  const tight = characterBudget(model, { targetMs: target, timing: timingForPace("tight") });
  const normal = characterBudget(model, { targetMs: target, timing: timingForPace("normal") });
  const relaxed = characterBudget(model, { targetMs: target, timing: timingForPace("relaxed") });
  assert.ok(tight > normal && normal > relaxed, `ต้องลดหลั่นกัน: ${tight}/${normal}/${relaxed}`);
  // สูตรเดิมคิดแค่ targetSec คูณ 6.4 ได้ 190 ตัวอักษรเท่ากันหมดทุกจังหวะ
  assert.ok(tight > 190, "เสียงที่เร็วกว่าต้องขอคำมากขึ้น ไม่ใช่เท่าเดิม");
});

test("เสียงเร็วขึ้นต้องขอสคริปต์ยาวขึ้นเพื่อกินเวลาเท่ากัน", () => {
  const slow = { graphemesPerSec: 6.4, msPerGrapheme: 1000 / 6.4 };
  const fast = { graphemesPerSec: 10.74, msPerGrapheme: 1000 / 10.74 };
  assert.ok(
    characterBudget(fast, { targetMs: 30_000, timing: DEFAULT_TIMING })
      > characterBudget(slow, { targetMs: 30_000, timing: DEFAULT_TIMING }),
  );
});

test("พรอมต์เขียนสคริปต์กำกับคำลงท้ายตามเพศผู้พากย์", () => {
  const brief = { name: "สินค้า", features: ["ใช้ง่าย"] };
  const male = buildScriptPrompt(brief, 30, 5, 180, "ชาย");
  const female = buildScriptPrompt(brief, 30, 5, 180, "หญิง");
  const unknown = buildScriptPrompt(brief, 30, 5, 180, null);

  assert.match(male, /ผู้พากย์: ผู้ชาย/);
  assert.match(male, /ผม\/ครับ/);
  assert.match(female, /ผู้พากย์: ผู้หญิง/);
  assert.match(female, /ค่ะ\/นะคะ/);
  assert.doesNotMatch(unknown, /ผู้พากย์:/, "ไม่รู้เพศต้องไม่เดาให้สคริปต์");
});
