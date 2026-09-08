// ตัววางการ์ดอัตโนมัติ — เคสทั้งหมดมาจากสคริปต์จริงในเครื่องผู้ใช้
//
// ถ้าตัวนี้เลือกผิด ผู้ใช้จะได้การ์ดที่เขียนว่า "55" ทับหน้าสินค้าโดยไม่รู้ว่ามาจากไหน
// และเขาปิดได้อย่างเดียว แก้ทีละใบไม่ได้ ความแม่นของตัวนี้จึงสำคัญกว่าปกติ

import assert from "node:assert/strict";
import test from "node:test";
import { extractNumericClaim, planMotionCards } from "../pipeline/motion-plan.mjs";

test("ดึงตัวเลขพร้อมหน่วยและคำอธิบายจากท่อนจริง", () => {
  assert.deepEqual(
    { ...extractNumericClaim("ความจุ 20,000mAh"), score: undefined },
    { value: "20,000", suffix: "mAh", label: "ความจุ", score: undefined },
  );
  assert.deepEqual(
    { ...extractNumericClaim("สมุนไพร 18 ชนิด"), score: undefined },
    { value: "18", suffix: "ชนิด", label: "สมุนไพร", score: undefined },
  );
  // "สูงสุด" ถูกตัดออกจากคำอธิบาย เพราะเป็นคำเชื่อมที่เคยอยู่หน้าตัวเลข
  assert.deepEqual(
    { ...extractNumericClaim("ไร้สายสูงสุด 15W"), score: undefined },
    { value: "15", suffix: "W", label: "ไร้สาย", score: undefined },
  );
});

test("ช่วงตัวเลขเก็บไว้ทั้งช่วง ไม่หั่นครึ่ง", () => {
  const claim = extractNumericClaim("ชาร์จมือถือได้ 3-4 รอบ");
  assert.equal(claim.value, "3-4");
  assert.equal(claim.suffix, "รอบ");
});

test("เลขรุ่นสินค้าต้องไม่กลายเป็นการ์ด", () => {
  // เคสจริงจากสคริปต์ผู้ใช้ ถ้าจับ EW55 จะได้การ์ดที่เขียนว่า 55 ซึ่งไม่มีความหมาย
  assert.equal(extractNumericClaim("ผมพก Eloop EW55"), null);
  assert.equal(extractNumericClaim("รุ่น iPhone15 ใช้ได้"), null);
});

test("เลขที่ไม่มีหน่วยกำกับไม่ขึ้นการ์ด", () => {
  assert.equal(extractNumericClaim("เหลือแค่ 3"), null);
  assert.equal(extractNumericClaim("ลองดูสิ"), null);
});

test("mAh ไม่ถูกจับเป็นหน่วย A แล้วเหลือ h ค้าง", () => {
  const claim = extractNumericClaim("แบต 5000mAh");
  assert.equal(claim.suffix, "mAh");
  assert.equal(claim.label, "แบต");
});

test("สคริปต์ที่ไม่มีตัวเลขเลย ก็ไม่ต้องมีการ์ด", () => {
  const cards = planMotionCards(["พุงไม่ยุบสักที", "หยิบขนมกี่รอบ", "กดตะกร้าเลย"]);
  assert.deepEqual(cards, [], "อย่ายัดการ์ดใส่คลิปที่ไม่มีอะไรให้อวด");
});

test("เลือกการ์ดจากสคริปต์จริง แล้วเรียงตามลำดับท่อน", () => {
  const cards = planMotionCards([
    "แบตหมดกลางทางอีกแล้ว",
    "ผมพก Eloop EW55",
    "ตัวนี้ช่วยได้",
    "ความจุ 20,000mAh",
    "ชาร์จมือถือได้ 3-4 รอบ",
    "พกง่ายมาก",
    "ไร้สายสูงสุด 15W",
  ], { minGapMs: 0 });
  assert.ok(cards.length > 0);
  assert.equal(cards.some((card) => card.data.value === "55"), false, "เลขรุ่นต้องไม่หลุดมา");
  const order = cards.map((card) => card.atChunk);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "การ์ดต้องเรียงตามลำดับท่อน");
});

test("ไม่เกินเพดานจำนวนการ์ด", () => {
  const many = Array.from({ length: 12 }, (_, i) => `ข้อ ${i + 1} ชนิด`);
  assert.equal(planMotionCards(many, { maxCards: 3 }).length, 3);
});

test("การ์ดที่อยู่ชิดกันเกินเกณฑ์เวลาถูกตัดออก", () => {
  const chunks = [
    { i: 0, from: 0, text: "ลด 50 บาท", startMs: 1000 },
    { i: 1, from: 1, text: "เหลือ 20 ชิ้น", startMs: 2000 },
    { i: 2, from: 2, text: "ส่งใน 3 วัน", startMs: 20000 },
  ];
  const cards = planMotionCards(chunks, { minGapMs: 5000, maxCards: 5 });
  assert.equal(cards.length, 2, "สองใบแรกห่างกันแค่ 1 วินาที ต้องเหลือใบเดียว");
  assert.equal(cards[1].atChunk, 2);
});

test("เปอร์เซ็นต์ได้คิวก่อนเมื่อต้องเลือก", () => {
  const cards = planMotionCards([
    "ลดได้ 80%",
    "ใช้ 2 เม็ด",
  ], { maxCards: 1 });
  assert.equal(cards[0].data.suffix, "%");
});

test("การ์ดที่วางให้ติดธง auto ไว้ เพื่อแยกจากที่คนใส่เอง", () => {
  const cards = planMotionCards(["สมุนไพร 18 ชนิด"]);
  assert.equal(cards[0].auto, true);
  assert.equal(cards[0].template, "number-card");
  assert.equal(cards[0].data.tone, "soft");
});

test("ท่อนที่ถูกหั่นย่อย ใช้หมายเลขท่อนต้นทาง", () => {
  const cards = planMotionCards([
    { i: 0, from: 0, text: "ทักมาได้เลย", startMs: 0 },
    { i: 1, from: 1, text: "ความจุ 20,000mAh", startMs: 4000 },
    { i: 2, from: 1, text: "ใช้ได้นาน", startMs: 6000 },
  ]);
  assert.equal(cards[0].atChunk, 1);
});

test("ศูนย์ไม่ใช่จุดขาย จึงไม่ขึ้นการ์ด", () => {
  // เคสจริง: "ทาได้ตั้งแต่ 0 เดือน" แปลว่าใช้ได้ตั้งแต่แรกเกิด แต่การ์ดเลข 0 ตัวใหญ่
  // กลางจอสื่อตรงข้ามกับที่ตั้งใจ
  assert.equal(extractNumericClaim("ทาได้ตั้งแต่ 0 เดือน"), null);
  assert.equal(planMotionCards(["ทาได้ตั้งแต่ 0 เดือน"]).length, 0);
});

test("คำเชื่อมที่ห้อยค้างท้ายคำอธิบายถูกตัดทิ้ง", () => {
  assert.equal(extractNumericClaim("ทั่วไปประมาณ 3-4 รอบ").label, "ทั่วไป");
  assert.equal(extractNumericClaim("ไร้สายสูงสุด 15W").label, "ไร้สาย");
  assert.equal(extractNumericClaim("ส่งถึง 3 วัน").label, "ส่ง");
});

test("คำอธิบายที่เป็นคำเชื่อมล้วนไม่ถูกตัดจนว่าง", () => {
  assert.equal(extractNumericClaim("ประมาณ 5 นาที").label, "ประมาณ");
});
