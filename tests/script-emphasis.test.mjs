// คำที่ควรเน้นต้องรอดจากการเดินทางไป-กลับหน้าเว็บ
//
// หน้าเว็บเก็บท่อนสคริปต์เป็นสตริงล้วนเพื่อให้ผู้ใช้แก้ข้อความได้ง่าย ตอนแปลงเป็นสตริง
// คำที่ AI มาร์กไว้ว่าควรเน้นเคยหายไปทั้งหมด ผลคือสีไฮไลต์คำเน้นในซับไม่เคยทำงานเลย
// (ตรวจจากไทม์ไลน์ของงานที่เรนเดอร์จริง: คำ 48 คำ มาร์กเน้น 0 คำ)

import assert from "node:assert/strict";
import test from "node:test";
import { pickScript } from "../server/index.mjs";

test("คำที่ควรเน้นรอดมาถึง pipeline เมื่อท่อนถูกส่งมาเป็นสตริง", () => {
  const chunks = pickScript(
    {
      script: ["พุงไม่ยุบสักที", "ลองตัวนี้ดู", "กดตะกร้าเลย"],
      scriptEmphasis: [["พุง"], [], ["ตะกร้า"]],
    },
    {},
  );
  assert.deepEqual(chunks.map((chunk) => chunk.emphasis), [["พุง"], [], ["ตะกร้า"]]);
  assert.deepEqual(chunks.map((chunk) => chunk.text), ["พุงไม่ยุบสักที", "ลองตัวนี้ดู", "กดตะกร้าเลย"]);
});

test("หยิบคำที่ควรเน้นจากสคริปต์ที่บันทึกไว้ เมื่อคำขอไม่ได้ส่งมาด้วย", () => {
  const chunks = pickScript(
    { scriptId: "v2" },
    {
      scripts: [
        { id: "v1", chunks: ["ก"], emphasis: [["ก"]] },
        { id: "v2", chunks: ["ข ค", "ง"], emphasis: [["ค"], ["ง"]] },
      ],
    },
  );
  assert.deepEqual(chunks.map((chunk) => chunk.emphasis), [["ค"], ["ง"]]);
});

test("ไม่มีคำเน้นก็ยังทำงานได้ ไม่พัง", () => {
  const chunks = pickScript({ script: ["ก", "ข"] }, {});
  assert.deepEqual(chunks.map((chunk) => chunk.emphasis), [[], []]);
});

test("รายการคำเน้นสั้นกว่าจำนวนท่อนก็ไม่พัง", () => {
  const chunks = pickScript({ script: ["ก", "ข", "ค"], scriptEmphasis: [["ก"]] }, {});
  assert.deepEqual(chunks.map((chunk) => chunk.emphasis), [["ก"], [], []]);
});

test("ท่อนที่ส่งมาเป็นอ็อบเจกต์อยู่แล้วยังเก็บคำเน้นของตัวเองไว้", () => {
  const chunks = pickScript(
    { script: [{ text: "ก", emphasis: ["ก"] }, { text: "ข", emphasis: [] }] },
    {},
  );
  assert.deepEqual(chunks.map((chunk) => chunk.emphasis), [["ก"], []]);
});
