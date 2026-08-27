import assert from "node:assert/strict";
import test from "node:test";

import { readThaiNumber, toSpokenThai, unreadableWords } from "../pipeline/thai-speech.mjs";

test("อ่านเลขตามข้อยกเว้นของภาษาไทย ไม่ใช่ไล่หลักตรง ๆ", () => {
  // สามข้อที่ทำให้เขียนเป็นสูตรตรง ๆ ไม่ได้
  assert.equal(readThaiNumber(10), "สิบ", "หลักสิบที่เป็นหนึ่งไม่อ่านว่าหนึ่งสิบ");
  assert.equal(readThaiNumber(20), "ยี่สิบ", "หลักสิบที่เป็นสองอ่านว่ายี่");
  assert.equal(readThaiNumber(11), "สิบเอ็ด", "หลักหน่วยที่เป็นหนึ่งอ่านว่าเอ็ด");
  assert.equal(readThaiNumber(21), "ยี่สิบเอ็ด");
  assert.equal(readThaiNumber(101), "หนึ่งร้อยเอ็ด");
  assert.equal(readThaiNumber(1), "หนึ่ง", "เลขหลักเดียวยังเป็นหนึ่ง");
});

test("อ่านเลขหลักใหญ่และเลขที่มีศูนย์คั่น", () => {
  assert.equal(readThaiNumber(110), "หนึ่งร้อยสิบ");
  assert.equal(readThaiNumber(1000), "หนึ่งพัน");
  assert.equal(readThaiNumber(20_000), "สองหมื่น");
  assert.equal(readThaiNumber(1_000_000), "หนึ่งล้าน");
  assert.equal(readThaiNumber(2_500_000), "สองล้านห้าแสน");
  assert.equal(readThaiNumber(0), "ศูนย์");
});

test("ทศนิยมอ่านทีละหลัก และรับจุลภาคคั่นหลักได้", () => {
  assert.equal(readThaiNumber(2.5), "สองจุดห้า");
  assert.equal(readThaiNumber("22.5"), "ยี่สิบสองจุดห้า");
  // 2.55 ต้องเป็น "ห้าห้า" ไม่ใช่ "ห้าสิบห้า"
  assert.equal(readThaiNumber("2.55"), "สองจุดห้าห้า");
  assert.equal(readThaiNumber("1,250"), "หนึ่งพันสองร้อยห้าสิบ");
  assert.equal(readThaiNumber("-5"), "ลบห้า");
});

test("ค่าที่ไม่ใช่ตัวเลขต้องคืนค่าว่าง ไม่ใช่เดา", () => {
  for (const bad of ["", "abc", "1.2.3", null, undefined, "๑๒"]) {
    assert.equal(readThaiNumber(bad), "", `ต้องปฏิเสธ: ${bad}`);
  }
});

test("ตัวเลขติดหน่วยต้องอ่านคู่กัน ไม่ใช่เหลือหน่วยค้างเป็นอังกฤษ", () => {
  const result = toSpokenThai("แบตเตอรี่ 20000 mAh ใช้ได้นาน");
  assert.equal(result.text, "แบตเตอรี่ สองหมื่นมิลลิแอมป์ ใช้ได้นาน");
  assert.deepEqual(result.unread, [], "ต้องไม่เหลืออังกฤษให้อ่านไม่ออก");
  assert.equal(result.changed, true);
});

test("หน่วยที่ชื่อซ้อนกันต้องเลือกตัวที่ยาวกว่า", () => {
  // mAh ต้องชนะ A, kg ต้องชนะ g ไม่งั้นจะได้ มิลลิแอมป์ กลายเป็น เอ็มเอแอมป์
  assert.match(toSpokenThai("350g").text, /สามร้อยห้าสิบกรัม/);
  assert.match(toSpokenThai("2kg").text, /สองกิโลกรัม/);
  assert.match(toSpokenThai("128GB").text, /หนึ่งร้อยยี่สิบแปดกิกะไบต์/);
  assert.match(toSpokenThai("22.5W").text, /ยี่สิบสองจุดห้าวัตต์/);
});

test("สัญลักษณ์ที่เจอบ่อยในคลิปขายของต้องอ่านออก", () => {
  assert.match(toSpokenThai("ลด 50%").text, /ห้าสิบเปอร์เซ็นต์/);
  assert.match(toSpokenThai("ราคา ฿1290").text, /บาทหนึ่งพันสองร้อยเก้าสิบ/);
});

test("คำอังกฤษที่ถอดเป็นไทยแทนไม่ได้ ต้องรายงานกลับ ไม่ใช่เดาให้", () => {
  const result = toSpokenThai("Powerbank Eloop EW55 20000mAh");
  // ตัวเลขยังถูกแปลง ส่วนชื่อแบรนด์ปล่อยไว้แล้วบอกผู้ใช้
  assert.match(result.text, /สองหมื่นมิลลิแอมป์/);
  assert.ok(result.unread.includes("Powerbank"));
  assert.ok(result.unread.includes("Eloop"));
  assert.deepEqual(unreadableWords("ไม่มีอังกฤษเลย"), []);
});

test("ข้อความไทยล้วนต้องไม่ถูกแตะเลย", () => {
  const text = "ตัวนี้ต้องมี บอกเลยว่าคุ้ม จิ้มตะกร้าด้านล่างจ้า";
  const result = toSpokenThai(text);
  assert.equal(result.text, text);
  assert.equal(result.changed, false);
});

test("ข้อความว่างต้องไม่พัง", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = toSpokenThai(empty);
    assert.deepEqual(result.unread, []);
    assert.equal(result.changed, false);
  }
});
