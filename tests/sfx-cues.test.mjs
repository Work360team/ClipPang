import assert from "node:assert/strict";
import test from "node:test";
import { getSfxKit, listSfxKits, planSfxCues, resolveSfxCues } from "../pipeline/sfx.mjs";

/** ไทม์ไลน์ย่อ ๆ ที่มีเฉพาะฟิลด์ที่ตัววางเสียงใช้จริง */
function timeline(chunks, durationMs) {
  return { durationMs, chunks };
}

function chunk(startMs, endMs, words) {
  return { startMs, endMs, words };
}

function word(startMs, emphasis = false) {
  return { text: "คำ", startMs, endMs: startMs + 300, emphasis };
}

test("ทุกชุดเสียงชี้ไปที่ไฟล์ที่มีอยู่จริง", () => {
  const kits = listSfxKits();
  assert.ok(kits.length >= 3, "ควรมีชุดเสียงอย่างน้อยสามชุด");
  for (const kit of kits) {
    const cues = Object.entries(kit.cues || {});
    assert.ok(cues.length > 0, `ชุด ${kit.slug} ไม่มีเสียงเลย`);
    const resolved = resolveSfxCues(cues.map(([name, sound]) => ({
      cue: name,
      file: sound.file,
      atMs: 0,
      gainDb: sound.gainDb,
    })));
    assert.equal(resolved.length, cues.length, `ชุด ${kit.slug} มีเสียงที่หาไฟล์ไม่เจอ`);
  }
});

test("ไม่เลือกชุดเสียงก็ไม่ได้คิวเลย", () => {
  assert.equal(getSfxKit(null), null);
  assert.equal(getSfxKit("none"), null);
  assert.deepEqual(planSfxCues(timeline([chunk(0, 1000, [])], 1000), null), []);
});

test("วางเสียงเน้นตรงคำที่สคริปต์มาร์กไว้", () => {
  const kit = getSfxKit("soft-pop");
  const cues = planSfxCues(
    timeline([chunk(0, 6000, [word(0), word(2000, true), word(4000)])], 20000),
    kit,
    { minGapMs: 100 },
  );
  const accents = cues.filter((cue) => cue.cue === "accent");
  assert.equal(accents.length, 1);
  assert.equal(accents[0].atMs, 2000, "เสียงเน้นต้องลงตรงคำที่มาร์กไว้เป๊ะ");
});

test("วางเสียงกวาดตรงรอยต่อของท่อน แต่ไม่ซ้ำกับเสียงเปิดเรื่อง", () => {
  const kit = getSfxKit("soft-pop");
  const cues = planSfxCues(
    timeline([chunk(0, 3000, []), chunk(3000, 6000, []), chunk(6000, 9000, [])], 20000),
    kit,
    { minGapMs: 100 },
  );
  assert.deepEqual(cues.map((cue) => cue.cue), ["open", "transition", "transition"]);
  assert.deepEqual(cues.map((cue) => cue.atMs), [0, 3000, 6000]);
});

test("คิวที่ชิดกันเกินเกณฑ์ถูกตัดออก เหลือตัวที่สำคัญกว่า", () => {
  const kit = getSfxKit("soft-pop");
  // คำที่มาร์กเน้นอยู่ห่างจากรอยต่อท่อนแค่ 80 ms — ดังพร้อมกันจะฟังเป็นเสียงเดียวที่เพี้ยน
  const cues = planSfxCues(
    timeline([chunk(0, 3000, []), chunk(3000, 6000, [word(3080, true)])], 20000),
    kit,
    { minGapMs: 600 },
  );
  const at3s = cues.filter((cue) => Math.abs(cue.atMs - 3000) < 600);
  assert.equal(at3s.length, 1, "ช่วงเดียวกันต้องเหลือเสียงเดียว");
  assert.equal(at3s[0].cue, "accent", "คำที่สั่งให้เน้นสำคัญกว่ารอยต่อท่อน");
});

test("ไม่วางเสียงชิดท้ายคลิปจนหางเสียงโดนตัด", () => {
  const kit = getSfxKit("soft-pop");
  const cues = planSfxCues(
    timeline([chunk(0, 5000, []), chunk(4900, 5000, [word(4950, true)])], 5000),
    kit,
    { minGapMs: 100, tailMs: 400 },
  );
  assert.ok(cues.every((cue) => cue.atMs <= 4600), `มีคิวเลย 4600 ms: ${JSON.stringify(cues)}`);
});

test("จำนวนคิวไม่เกินเพดานที่ตั้งไว้", () => {
  const kit = getSfxKit("soft-pop");
  const many = Array.from({ length: 40 }, (_, i) => chunk(i * 1000, i * 1000 + 1000, [word(i * 1000 + 400, true)]));
  const cues = planSfxCues(timeline(many, 60000), kit, { maxCues: 6 });
  assert.equal(cues.length, 6);
});

test("คิวเรียงตามเวลาเสมอ", () => {
  const kit = getSfxKit("cinematic");
  const cues = planSfxCues(
    timeline([
      chunk(0, 2000, [word(1200, true)]),
      chunk(2000, 4000, [word(3400, true)]),
      chunk(4000, 6000, []),
    ], 20000),
    kit,
    { minGapMs: 300 },
  );
  const times = cues.map((cue) => cue.atMs);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});
