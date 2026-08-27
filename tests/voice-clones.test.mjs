import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_TONE, toneSample, VOICE_GENDERS, VOICE_TONES } from "../pipeline/core.mjs";
import {
  cloneIdFor,
  deleteClone,
  findClone,
  listClones,
  listSpeakers,
  readClone,
  saveClone,
  updateCloneGender,
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
  const saved = saveClone(
    { wavBuffer: wav("x"), text: "สวัสดีครับ วันนี้อากาศดี", speaker: "พี่หนึ่ง", tone: "ตื่นเต้น", gender: "ชาย" },
    { dir },
  );
  assert.equal(saved.provider, "jaitts");
  assert.equal(saved.label, "พี่หนึ่ง · ตื่นเต้น", "ชื่อที่โชว์ต้องบอกทั้งคนและโทน");
  assert.ok(fs.existsSync(saved.wav), "ต้องเขียนไฟล์เสียงลงดิสก์จริง");

  const read = readClone(saved.id, { dir });
  assert.equal(read.speaker, "พี่หนึ่ง");
  assert.equal(read.tone, "ตื่นเต้น");
  assert.equal(read.gender, "ชาย");
  assert.equal(read.text, "สวัสดีครับ วันนี้อากาศดี");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("โทนที่ไม่รู้จักต้องกลายเป็นโทนปกติ ไม่ใช่เก็บค่ามั่ว ๆ ไว้", () => {
  const dir = tempDir();
  const saved = saveClone({ wavBuffer: wav("t"), text: "ทดสอบ", tone: "โทนที่ไม่มีอยู่จริง", gender: "ชาย" }, { dir });
  assert.equal(saved.tone, DEFAULT_TONE);
  assert.ok(VOICE_TONES.some((tone) => tone.id === saved.tone));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("คนเดียวกันอัดได้หลายโทน และจัดกลุ่มตามคนได้", () => {
  const dir = tempDir();
  saveClone({ wavBuffer: wav("a1"), text: "หนึ่ง", speaker: "พี่หนึ่ง", tone: "ตื่นเต้น", gender: "ชาย" }, { dir });
  saveClone({ wavBuffer: wav("a2"), text: "สอง", speaker: "พี่หนึ่ง", tone: "สุขุม", gender: "ชาย" }, { dir });
  saveClone({ wavBuffer: wav("b1"), text: "สาม", speaker: "พี่สอง", tone: "ตื่นเต้น", gender: "หญิง" }, { dir });

  const speakers = listSpeakers({ dir });
  assert.equal(speakers.length, 2);
  const first = speakers.find((item) => item.speaker === "พี่หนึ่ง");
  assert.equal(first.tones.length, 2);
  assert.deepEqual(new Set(first.tones.map((clone) => clone.tone)), new Set(["ตื่นเต้น", "สุขุม"]));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("เลือกตัวอย่างตามคนและโทน ถ้าไม่มีโทนนั้นใช้โทนอื่นของคนเดิมแทน", () => {
  const dir = tempDir();
  saveClone({ wavBuffer: wav("c1"), text: "หนึ่ง", speaker: "พี่หนึ่ง", tone: "ตื่นเต้น", gender: "ชาย" }, { dir });
  saveClone({ wavBuffer: wav("c2"), text: "สอง", speaker: "พี่สอง", tone: "สุขุม", gender: "หญิง" }, { dir });

  const exact = findClone({ speaker: "พี่หนึ่ง", tone: "ตื่นเต้น" }, { dir });
  assert.equal(exact.speaker, "พี่หนึ่ง");
  assert.equal(exact.matchedTone, true);

  // โทนไม่ตรงต้องยังได้เสียงของคนเดิม ไม่ใช่ข้ามไปคนอื่นหรือปฏิเสธไม่ให้เรนเดอร์
  const fallback = findClone({ speaker: "พี่หนึ่ง", tone: "น่าเชื่อถือ" }, { dir });
  assert.equal(fallback.speaker, "พี่หนึ่ง");
  assert.equal(fallback.matchedTone, false);

  assert.equal(findClone({ speaker: "ไม่มีคนนี้", tone: "สุขุม" }, { dir }).matchedTone, true, "ไม่มีคนที่เลือกก็ยังต้องได้เสียงสักตัว");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ไม่มีตัวอย่างสักอันต้องคืน null ไม่ใช่พัง", () => {
  const dir = tempDir();
  assert.equal(findClone({ speaker: "ใครก็ได้", tone: "สุขุม" }, { dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("อัดทับด้วยไฟล์ใหม่ได้ id ใหม่ ของเดิมไม่ถูกเขียนทับ", () => {
  const dir = tempDir();
  const first = saveClone({ wavBuffer: wav("one"), text: "ข้อความหนึ่ง", gender: "ชาย" }, { dir });
  const second = saveClone({ wavBuffer: wav("two"), text: "ข้อความสอง", gender: "ชาย" }, { dir });
  assert.notEqual(first.id, second.id);
  // id ที่เปลี่ยนคือสิ่งที่ทำให้คีย์แคช TTS เปลี่ยนตาม ท่อนเก่าจึงไม่ถูกหยิบมาใช้ผิดเสียง
  assert.equal(readClone(first.id, { dir }).text, "ข้อความหนึ่ง");
  assert.equal(listClones({ dir }).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ไม่มีข้อความของเสียงต้นแบบก็บันทึกไม่ได้", () => {
  const dir = tempDir();
  // F5-TTS ต้องการข้อความที่ตรงกับเสียงเป๊ะ ๆ ปล่อยว่างไว้แล้วค่อยพังตอนพากย์คือสายเกินไป
  assert.throws(() => saveClone({ wavBuffer: wav("z"), text: "  ", gender: "ชาย" }, { dir }), /ข้อความ/);
  assert.throws(() => saveClone({ wavBuffer: Buffer.alloc(0), text: "มีข้อความ", gender: "ชาย" }, { dir }), /ไฟล์เสียง/);
  assert.throws(() => saveClone({ wavBuffer: wav("g"), text: "มีข้อความ" }, { dir }), /เลือกเพศ/);
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
  const good = saveClone({ wavBuffer: wav("ok"), text: "ใช้ได้", gender: "ชาย" }, { dir });
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
  const saved = saveClone({ wavBuffer: wav("d"), text: "จะลบ", gender: "ชาย" }, { dir });
  assert.equal(deleteClone(saved.id, { dir }), true);
  assert.equal(readClone(saved.id, { dir }), null);
  assert.equal(deleteClone(saved.id, { dir }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ทุกโทนต้องมีประโยคตัวอย่างให้อ่านตอนอัด", () => {
  assert.ok(VOICE_TONES.length >= 4);
  for (const tone of VOICE_TONES) {
    assert.ok(tone.id?.trim(), "โทนต้องมีชื่อ");
    for (const gender of VOICE_GENDERS) {
      assert.ok(tone.samples?.[gender]?.trim().length > 20, `${tone.id}/${gender} ต้องมีประโยคตัวอย่างที่ยาวพอจะจับโทนได้`);
      assert.equal(toneSample(tone.id, gender), tone.samples[gender]);
    }
  }
  assert.equal(new Set(VOICE_TONES.map((tone) => tone.id)).size, VOICE_TONES.length, "ห้ามมีโทนซ้ำ");
  assert.equal(toneSample(DEFAULT_TONE, ""), "", "ยังไม่เลือกเพศต้องไม่เดาให้เอง");
});

test("เสียงเก่าที่ไม่มีเพศต้องไม่ถูกเดา และเลือกเพิ่มทีหลังได้โดยไม่ต้องอัดใหม่", () => {
  const dir = tempDir();
  const saved = saveClone({ wavBuffer: wav("legacy"), text: "เสียงเก่า", gender: "ชาย" }, { dir });
  const metaFile = path.join(dir, saved.id, "voice.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  delete meta.gender;
  fs.writeFileSync(metaFile, JSON.stringify(meta), "utf8");

  assert.equal(readClone(saved.id, { dir }).gender, null, "ห้ามตีความข้อมูลเก่าเป็นหญิงหรือชายเอง");
  assert.equal(updateCloneGender(saved.id, "หญิง", { dir }).gender, "หญิง");
  assert.equal(JSON.parse(fs.readFileSync(metaFile, "utf8")).gender, "หญิง");
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
