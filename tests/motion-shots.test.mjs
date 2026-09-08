import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileMotionShots,
  getMotionTemplate,
  isCoveredByMotion,
  listMotionTemplates,
  resolveMotionShots,
} from "../pipeline/motion.mjs";
import { compileComposition } from "../pipeline/hyperframes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function style() {
  const loaded = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline/styles/kanit-hf.json"), "utf8"));
  loaded.params.position ||= {};
  loaded.params.font ||= {};
  return loaded;
}

function timeline() {
  return {
    durationMs: 9000,
    chunks: [
      { startMs: 0, endMs: 3000, text: "หนึ่ง", words: [{ text: "หนึ่ง", s: 0, e: 5, startMs: 0, endMs: 3000, emphasis: false }] },
      { startMs: 3000, endMs: 6000, text: "สอง", words: [{ text: "สอง", s: 0, e: 3, startMs: 3000, endMs: 6000, emphasis: false }] },
      { startMs: 6000, endMs: 9000, text: "สาม", words: [{ text: "สาม", s: 0, e: 3, startMs: 6000, endMs: 9000, emphasis: false }] },
    ],
  };
}

const shot = (over = {}) => ({
  template: "number-card",
  startMs: 3000,
  endMs: 6000,
  data: { value: "80", suffix: "%", label: "ของคนที่ลดพุงไม่สำเร็จ", note: "เพราะกินจุกจิกระหว่างวัน" },
  ...over,
});

test("มีเทมเพลตอย่างน้อยหนึ่งแบบ และหยิบตามชื่อได้", async () => {
  const templates = await listMotionTemplates();
  assert.ok(templates.length >= 1);
  assert.ok(templates.every((item) => item.slug && typeof item.render === "function"));
  assert.equal((await getMotionTemplate("number-card"))?.slug, "number-card");
  assert.equal(await getMotionTemplate("ไม่มีจริง"), null);
});

test("ช็อตที่เวลาไม่ถูกต้องถูกทิ้ง ไม่ทำให้ทั้งงานพัง", async () => {
  const result = await compileMotionShots(
    [shot({ startMs: 5000, endMs: 5000 }), shot({ startMs: -1, endMs: 100 }), shot()],
    { width: 720, height: 1280 },
  );
  assert.equal(result.shots.length, 1, "ควรเหลือเฉพาะช็อตที่เวลาใช้ได้");
});

test("เทมเพลตที่ไม่รู้จักถูกข้าม ไม่ throw", async () => {
  const result = await compileMotionShots([shot({ template: "ยังไม่มีแบบนี้" })], { width: 720, height: 1280 });
  assert.deepEqual(result.shots, []);
  assert.equal(result.html, "");
});

test("CSS ของเทมเพลตเดียวกันใส่ครั้งเดียว แม้ใช้หลายช็อต", async () => {
  const result = await compileMotionShots(
    [shot(), shot({ startMs: 6500, endMs: 8000 })],
    { width: 720, height: 1280 },
  );
  assert.equal(result.shots.length, 2);
  assert.equal(result.css.split(".mo-num-card {").length - 1, 1, "บล็อก CSS ต้องไม่ซ้ำ");
});

/** กฎ CSS ของคลาสหนึ่งจากผลลัพธ์ที่คอมไพล์ได้ */
function ruleFor(css, selector) {
  const found = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(found, `ไม่พบกฎของ ${selector}`);
  return found[1];
}

for (const tone of ["soft", "night"]) {
  test(`โทน ${tone}: การ์ดโปร่งแสง ไม่ใช่จอทึบที่บังภาพจริงทั้งเฟรม`, async () => {
    const result = await compileMotionShots(
      [shot({ data: { value: "80", suffix: "%", label: "ทดสอบ", tone } })],
      { width: 720, height: 1280 },
    );
    // ตัวการ์ดเท่านั้นที่ต้องโปร่ง ป้ายหน่วยเม็ดเล็กเป็นสีทึบได้ ไม่ได้บังอะไร
    const card = ruleFor(result.css, ".mo-num-card");
    const base = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)(?=;|\s*$)/m.exec(card);
    assert.ok(base, "พื้นการ์ดต้องเป็นสีแบบมี alpha");
    assert.ok(Number(base[1]) < 0.95, `พื้นการ์ดทึบเกินไป: ${base[1]}`);
    assert.equal(/background:\s*#[0-9a-f]/i.test(card), false, "ห้ามใช้สีทึบเป็นพื้นการ์ด");
    // เวทีที่ครอบการ์ดต้องไม่มีพื้นของตัวเอง ภาพจริงจะได้เล่นผ่านรอบ ๆ การ์ด
    assert.equal(/background/.test(ruleFor(result.css, ".mo-num-stage")), false);
  });
}

test("โทน soft เอียงเหมือนสติกเกอร์ ส่วนโทน night วางตรง", async () => {
  const tilt = async (tone) => {
    const result = await compileMotionShots(
      [shot({ data: { value: "80", tone } })],
      { width: 720, height: 1280 },
    );
    return result.beats.find((beat) => beat.to && beat.to.rotation !== undefined)?.to.rotation;
  };
  assert.notEqual(await tilt("soft"), 0, "โทน soft ต้องเอียง");
  assert.equal(await tilt("night"), 0, "โทน night ต้องวางตรง");
});

test("โทนที่ไม่รู้จักตกมาที่ soft ไม่ใช่พัง", async () => {
  const result = await compileMotionShots(
    [shot({ data: { value: "80", tone: "ไม่มีโทนนี้" } })],
    { width: 720, height: 1280 },
  );
  assert.match(ruleFor(result.css, ".mo-num-card"), /rgba\(255, 251, 243/);
});

test("การ์ดมีท่าออกก่อนช็อตจบ ไม่หายวับ", async () => {
  const result = await compileMotionShots([shot({ startMs: 0, endMs: 4000 })], { width: 720, height: 1280 });
  const exits = result.beats.filter((beat) => beat.to && beat.to.opacity === 0);
  assert.equal(exits.length, 1, "ควรมีท่าออกหนึ่งท่า");
  assert.ok(exits[0].t > 3 && exits[0].t < 4, `ท่าออกควรอยู่ท้ายช็อต แต่อยู่ที่ ${exits[0].t}`);
});

test("beats ทุกตัวเป็นคุณสมบัติที่วาดได้ ไม่มี callback", async () => {
  // HyperFrames เรนเดอร์ทีละเฟรมด้วย timeline.seek() ซึ่ง GSAP ระงับ callback ทั้งหมด
  // ท่าที่พึ่ง onUpdate/onComplete จะค้างอยู่ที่เฟรมแรกตลอดคลิปโดยไม่มีข้อผิดพลาดใด ๆ
  const result = await compileMotionShots([shot()], { width: 720, height: 1280 });
  assert.ok(result.beats.length > 0);
  for (const beat of result.beats) {
    assert.ok(["set", "fromTo"].includes(beat.kind), `beat ชนิด ${beat.kind} ไม่รองรับ`);
    const vars = { ...(beat.vars || {}), ...(beat.to || {}), ...(beat.from || {}) };
    for (const key of Object.keys(vars)) {
      assert.ok(!/^on[A-Z]/.test(key), `beat มี callback ${key} ซึ่ง seek จะไม่เรียก`);
    }
  }
});

test("เวลาของ beats ถูกเลื่อนไปตามเวลาเริ่มของช็อต", async () => {
  const result = await compileMotionShots([shot({ startMs: 4000, endMs: 7000 })], { width: 720, height: 1280 });
  assert.ok(result.beats.every((beat) => beat.t >= 4), "beat ต้องไม่มาก่อนเวลาเริ่มช็อต");
  assert.ok(result.beats.some((beat) => beat.t >= 4 && beat.t < 4.2), "ควรมี beat ตอนช็อตเริ่ม");
});

test("การนับเลขทำเป็นหลายขั้น และขั้นสุดท้ายคือค่าจริง", async () => {
  const result = await compileMotionShots([shot({ data: { value: "1200" } })], { width: 720, height: 1280 });
  const html = result.html;
  const steps = [...html.matchAll(/class="mo-num-step"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.ok(steps.length > 5, `ควรมีหลายขั้น แต่ได้ ${steps.length}`);
  assert.equal(steps[steps.length - 1], "1200");
  assert.equal(steps[0] === "1200", false, "ขั้นแรกต้องยังไม่ถึงค่าจริง");
});

test("ค่าที่ไม่ใช่ตัวเลขแสดงนิ่ง ๆ แทนที่จะกลายเป็น NaN", async () => {
  const result = await compileMotionShots([shot({ data: { value: "ครึ่งหนึ่ง" } })], { width: 720, height: 1280 });
  assert.ok(result.html.includes("ครึ่งหนึ่ง"));
  assert.equal(result.html.includes("NaN"), false);
});

test("เนื้อหาของช็อตหลบเขตที่ซับจองไว้", async () => {
  const height = 1280;
  const low = await compileMotionShots([shot()], { width: 720, height, captionAnchor: "bottom" });
  const high = await compileMotionShots([shot()], { width: 720, height, captionAnchor: "top" });
  assert.match(low.css, /bottom: 384px/, "ซับล่างต้องกันที่ด้านล่าง");
  assert.match(high.css, /top: 384px/, "ซับบนต้องกันที่ด้านบน");
});

test("รู้ว่าเวลาไหนถูกช็อตโมชันบังอยู่", () => {
  const shots = [shot()];
  assert.equal(isCoveredByMotion(4000, shots), true);
  assert.equal(isCoveredByMotion(2999, shots), false);
  assert.equal(isCoveredByMotion(6000, shots), false, "ปลายช่วงถือว่าพ้นแล้ว");
});

test("composition ฝังช็อตโมชันไว้ใต้ซับ", async () => {
  const motion = await compileMotionShots([shot()], { width: 720, height: 1280, captionAnchor: "bottom" });
  const html = compileComposition(timeline(), style(), { width: 720, height: 1280, fps: 30, motion });
  assert.match(html, /class="clip mo"/);
  assert.match(html, /\.clip\.mo \{ z-index: 1; \}/);
  assert.match(html, /\.cap \{ z-index: 2; \}/);
  assert.ok(html.indexOf('class="clip mo"') < html.indexOf('class="clip cap"'), "ช็อตโมชันต้องมาก่อนซับใน DOM");
});

test("ไม่มีช็อตโมชันก็คอมไพล์ได้เหมือนเดิม", async () => {
  const empty = await compileMotionShots([], { width: 720, height: 1280 });
  assert.deepEqual(empty, { html: "", css: "", beats: [], shots: [] });
  const html = compileComposition(timeline(), style(), { width: 720, height: 1280, fps: 30 });
  assert.equal(html.includes('class="clip mo"'), false);
});

/* ---------- ผูกการ์ดกับท่อนสคริปต์ ---------- */

const timelineWith = (chunks, durationMs) => ({ durationMs, chunks });

test("การ์ดที่ผูกกับท่อน ได้เวลาจริงจากไทม์ไลน์", () => {
  const resolved = resolveMotionShots(
    [{ template: "number-card", atChunk: 1, durationMs: 3000, data: {} }],
    timelineWith([
      { i: 0, from: 0, startMs: 0, endMs: 2000 },
      { i: 1, from: 1, startMs: 2000, endMs: 5000 },
    ], 9000),
  );
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].startMs, 2000);
  assert.equal(resolved[0].endMs, 5000);
});

test("ท่อนของผู้ใช้ที่ถูกหั่นย่อย การ์ดยังลงตรงท่อนแรกของมัน", () => {
  // ท่อนที่ผู้ใช้เขียนยาวเกิน 22 ตัวอักษรจะถูกหั่น ดัชนีในไทม์ไลน์จึงเลื่อนไปจากที่ผู้ใช้เห็น
  // ถ้าไปนับตำแหน่งในอาเรย์ตรง ๆ การ์ดของท่อนที่ 2 จะไปโผล่กลางท่อนที่ 1 แทน
  const resolved = resolveMotionShots(
    [{ template: "number-card", atChunk: 2, durationMs: 2000, data: {} }],
    timelineWith([
      { i: 0, from: 0, startMs: 0, endMs: 1000 },
      { i: 1, from: 1, startMs: 1000, endMs: 2000 },
      { i: 2, from: 1, startMs: 2000, endMs: 3000 },
      { i: 3, from: 2, startMs: 3000, endMs: 4200 },
    ], 8000),
  );
  assert.equal(resolved[0].startMs, 3000, "ต้องเป็นท่อนแรกที่มาจากท่อนที่ 2 ของผู้ใช้");
});

test("การ์ดไม่ยาวเกินคลิป", () => {
  const resolved = resolveMotionShots(
    [{ template: "number-card", atChunk: 0, durationMs: 9000, data: {} }],
    timelineWith([{ i: 0, from: 0, startMs: 4000, endMs: 5000 }], 5000),
  );
  assert.equal(resolved[0].endMs, 5000);
});

test("การ์ดที่ชี้ไปท่อนที่ไม่มีอยู่ถูกทิ้ง ไม่พัง", () => {
  const resolved = resolveMotionShots(
    [{ template: "number-card", atChunk: 9, data: {} }],
    timelineWith([{ i: 0, from: 0, startMs: 0, endMs: 1000 }], 4000),
  );
  assert.deepEqual(resolved, []);
});

test("การ์ดที่ระบุเวลามาเองยังใช้เวลานั้น (ทางของบรรทัดคำสั่ง)", () => {
  const shot = { template: "number-card", startMs: 1200, endMs: 4000, data: {} };
  assert.deepEqual(resolveMotionShots([shot], timelineWith([], 9000)), [shot]);
});

test("การ์ดที่ไม่มีทั้งเวลาและหมายเลขท่อนถูกทิ้ง", () => {
  assert.deepEqual(
    resolveMotionShots([{ template: "number-card", data: {} }], timelineWith([{ i: 0, from: 0, startMs: 0, endMs: 1000 }], 4000)),
    [],
  );
});
