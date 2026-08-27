import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cloneIdFor,
  deleteClone,
  listClones,
  readClone,
  saveClone,
} from "../pipeline/voice-clones.mjs";
import { discoverJaitts } from "../pipeline/jaitts.mjs";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "clip360-clones-"));
const wav = (marker) => Buffer.from(`RIFF....WAVEfmt ${marker}`);

test("id ผูกกับเนื้อไฟล์เสียง ไม่ใช่ชื่อที่ผู้ใช้ตั้ง", () => {
  const audio = wav("aaa");
  assert.equal(cloneIdFor(audio), cloneIdFor(Buffer.from(audio)), "ไฟล์เดียวกันต้องได้ id เดิม");
  assert.notEqual(cloneIdFor(audio), cloneIdFor(wav("bbb")), "อัดใหม่ต้องได้ id ใหม่");
  assert.match(cloneIdFor(audio), /^clone-[0-9a-f]{12}$/);
});

test("บันทึกแล้วอ่านกลับมาได้ครบ พร้อม path ของไฟล์เสียง", () => {
  const dir = tempDir();
  const saved = saveClone({ wavBuffer: wav("x"), text: "สวัสดีครับ วันนี้อากาศดี", name: "เสียงพี่หนึ่ง" }, { dir });
  assert.equal(saved.provider, "jaitts");
  assert.ok(fs.existsSync(saved.wav), "ต้องเขียนไฟล์เสียงลงดิสก์จริง");

  const read = readClone(saved.id, { dir });
  assert.equal(read.name, "เสียงพี่หนึ่ง");
  assert.equal(read.text, "สวัสดีครับ วันนี้อากาศดี");
  assert.equal(read.wav, saved.wav);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("อัดทับด้วยไฟล์ใหม่ได้ id ใหม่ ของเดิมไม่ถูกเขียนทับ", () => {
  const dir = tempDir();
  const first = saveClone({ wavBuffer: wav("one"), text: "ข้อความหนึ่ง" }, { dir });
  const second = saveClone({ wavBuffer: wav("two"), text: "ข้อความสอง" }, { dir });
  assert.notEqual(first.id, second.id);
  // id ที่เปลี่ยนคือสิ่งที่ทำให้คีย์แคช TTS เปลี่ยนตาม ท่อนเก่าจึงไม่ถูกหยิบมาใช้ผิดเสียง
  assert.equal(readClone(first.id, { dir }).text, "ข้อความหนึ่ง");
  assert.equal(listClones({ dir }).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ไม่มีข้อความของเสียงต้นแบบก็บันทึกไม่ได้", () => {
  const dir = tempDir();
  // F5-TTS ต้องการข้อความที่ตรงกับเสียงเป๊ะ ๆ ปล่อยว่างไว้แล้วค่อยพังตอนพากย์คือสายเกินไป
  assert.throws(() => saveClone({ wavBuffer: wav("z"), text: "  " }, { dir }), /ข้อความ/);
  assert.throws(() => saveClone({ wavBuffer: Buffer.alloc(0), text: "มีข้อความ" }, { dir }), /ไฟล์เสียง/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("id ที่พยายามหลุดออกนอกโฟลเดอร์ต้องอ่านไม่ได้", () => {
  const dir = tempDir();
  for (const bad of ["../secret", "a/b", "a\\b", "..", ""]) {
    assert.equal(readClone(bad, { dir }), null, `ต้องปฏิเสธ: ${bad}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("โฟลเดอร์ที่ meta พังต้องถูกข้าม ไม่ใช่ทำให้เสียงอื่นหายไปด้วย", () => {
  const dir = tempDir();
  const good = saveClone({ wavBuffer: wav("ok"), text: "ใช้ได้" }, { dir });
  const broken = path.join(dir, "clone-broken0000");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "voice.json"), "{ ไม่ใช่ json");
  fs.writeFileSync(path.join(broken, "ref.wav"), wav("broken"));

  const all = listClones({ dir });
  assert.equal(all.length, 1);
  assert.equal(all[0].id, good.id);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ลบแล้วหายจริง และลบซ้ำไม่พัง", () => {
  const dir = tempDir();
  const saved = saveClone({ wavBuffer: wav("d"), text: "จะลบ" }, { dir });
  assert.equal(deleteClone(saved.id, { dir }), true);
  assert.equal(readClone(saved.id, { dir }), null);
  assert.equal(deleteClone(saved.id, { dir }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ยังไม่ได้ติดตั้งต้องบอกเหตุผลที่แก้ตามได้ ไม่ใช่แค่ false", () => {
  const original = process.env.JAITTS_HOME;
  try {
    process.env.JAITTS_HOME = path.join(os.tmpdir(), "clip360-no-such-jaitts");
    const missing = discoverJaitts();
    assert.equal(missing.ready, false);
    assert.match(missing.reason, /ยังไม่ได้ติดตั้ง/);

    // มีโฟลเดอร์แต่ข้างในไม่ครบ ต้องแยกออกจาก "ยังไม่ได้ติดตั้ง" เพราะแก้คนละทาง
    const half = tempDir();
    process.env.JAITTS_HOME = half;
    const incomplete = discoverJaitts();
    assert.equal(incomplete.ready, false);
    assert.match(incomplete.reason, /jaitts_synth\.py/);
    fs.rmSync(half, { recursive: true, force: true });
  } finally {
    if (original === undefined) delete process.env.JAITTS_HOME;
    else process.env.JAITTS_HOME = original;
  }
});
