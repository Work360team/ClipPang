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
  assert.equal(result.css.split(".mo-num-ground").length - 1, 1, "บล็อก CSS ต้องไม่ซ้ำ");
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
