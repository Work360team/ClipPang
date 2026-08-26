import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PACE,
  DEFAULT_TIMING,
  NARRATION_PACES,
  buildChunkTimeline,
  timingForPace,
} from "../pipeline/core.mjs";

const takes = (count, durationMs = 1000) =>
  Array.from({ length: count }, (_, i) => ({ i, text: `ท่อนที่ ${i + 1}`, durationMs }));

test("จังหวะปกติต้องให้ค่าเท่าเดิมทุกอย่าง — ของเก่าห้ามเปลี่ยนพฤติกรรม", () => {
  assert.deepEqual(timingForPace(DEFAULT_PACE), DEFAULT_TIMING);
  // โปรเจกต์เก่าไม่มีค่านี้เก็บไว้ ต้องได้ค่าปกติ ไม่ใช่พังหรือได้ค่าแปลก ๆ
  assert.deepEqual(timingForPace(undefined), DEFAULT_TIMING);
  assert.deepEqual(timingForPace("ค่าที่ไม่รู้จัก"), DEFAULT_TIMING);
});

test("แต่ละจังหวะเปลี่ยนเฉพาะช่องว่างระหว่างท่อน ไม่แตะหัวและหาง", () => {
  for (const pace of NARRATION_PACES) {
    const timing = timingForPace(pace.id);
    assert.equal(timing.padMs, pace.padMs, `${pace.id} ต้องได้ padMs ตามที่กำหนด`);
    assert.equal(timing.leadInMs, DEFAULT_TIMING.leadInMs, "เงียบนำหน้าต้องไม่เปลี่ยน");
    assert.equal(timing.tailMs, DEFAULT_TIMING.tailMs, "หางท้ายต้องไม่เปลี่ยน");
  }
});

test("จังหวะกระชับต้องไม่มีช่องว่างเลย และสั้นกว่าแบบเว้นจังหวะจริง", () => {
  const items = takes(9);
  const tight = buildChunkTimeline(items, timingForPace("tight"));
  const relaxed = buildChunkTimeline(items, timingForPace("relaxed"));

  // 9 ท่อน = 8 ช่องว่าง
  for (let index = 1; index < tight.chunks.length; index += 1) {
    assert.equal(tight.chunks[index].startMs, tight.chunks[index - 1].endMs, "ท่อนต้องต่อกันสนิท");
  }
  // อ่านจากค่าจริงแทนการฮาร์ดโค้ด เทสต์จะได้ไม่พังทุกครั้งที่จูนตัวเลข
  const relaxedPad = NARRATION_PACES.find((item) => item.id === "relaxed").padMs;
  const gap = relaxed.chunks[1].startMs - relaxed.chunks[0].endMs;
  assert.equal(gap, relaxedPad);
  assert.equal(relaxed.durationMs - tight.durationMs, 8 * relaxedPad);
  assert.ok(relaxedPad >= 500, "ต้องเว้นมากพอให้ได้ยินต่างจากปกติจริง");
});

test("ตัวเลือกจังหวะต้องเรียงจากกระชับไปเว้นมาก และไม่มี id ซ้ำ", () => {
  const pads = NARRATION_PACES.map((item) => item.padMs);
  assert.deepEqual(pads, [...pads].sort((a, b) => a - b), "ต้องเรียงจากน้อยไปมาก");
  assert.equal(new Set(NARRATION_PACES.map((item) => item.id)).size, NARRATION_PACES.length);
  for (const item of NARRATION_PACES) {
    assert.ok(item.label && item.note, `${item.id} ต้องมีทั้งชื่อและคำอธิบาย`);
  }
  assert.ok(NARRATION_PACES.some((item) => item.id === DEFAULT_PACE), "ค่าปริยายต้องอยู่ในรายการ");
});
