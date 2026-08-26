import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { alignChunks, matchIndexes } from "../pipeline/tts-align.mjs";
import { parseWhisperJson, transcribeTokens, whisperReady } from "../pipeline/whisper.mjs";
import { cacheKeyFor, synthesize } from "../pipeline/tts.mjs";
import {
  discoverWhisper,
  getWhisperBinarySpec,
  getWhisperModelSpec,
} from "../server/whisper-setup.mjs";

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-whisper-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** สร้าง token ปลอมจากข้อความ โดยแบ่งเวลาให้เท่า ๆ กันตามจำนวนตัวอักษร */
function fakeTokens(pieces) {
  let at = 0;
  return pieces.map(({ text, ms }) => {
    const token = { text, startMs: at, endMs: at + ms };
    at += ms;
    return token;
  });
}

test("LCS จับคู่ตัวอักษรที่ตรงกันได้แม้มีตัวแทรกและตัวหาย", () => {
  const pairs = matchIndexes("abcdef", "abXdef");
  // a b _ d e f ตรงกัน ส่วน c ที่หายไปต้องไม่ถูกจับคู่มั่ว
  assert.equal(pairs.get(0), 0);
  assert.equal(pairs.get(1), 1);
  assert.equal(pairs.get(3), 3);
  assert.equal(pairs.get(5), 5);
  assert.equal(pairs.has(2), false);
});

test("หาช่วงเวลาของแต่ละท่อนได้ แม้ตัวถอดเสียงจะได้ยินผิดบางคำ", () => {
  const texts = ["สวัสดีค่ะ", "วันนี้อากาศดี", "แล้วพบกันใหม่"];
  // จำลองว่าถอดผิดหนึ่งคำกลางประโยค — ของจริงเกิดตลอดกับภาษาไทย
  const tokens = fakeTokens([
    { text: "สวัสดีค่ะ", ms: 1000 },
    { text: "วันนี้อากาด", ms: 1200 },
    { text: "ดี", ms: 300 },
    { text: "แล้วพบกันใหม่", ms: 1500 },
  ]);
  const result = alignChunks(texts, tokens, { totalMs: 4000 });

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.spans.length, 3);
  assert.equal(result.spans[0].startSec, 0);
  assert.equal(result.spans.at(-1).endSec, 4);
  // ต้องเรียงต่อกันไม่มีช่องโหว่และไม่ทับกัน
  for (let index = 1; index < result.spans.length; index += 1) {
    assert.equal(result.spans[index].startSec, result.spans[index - 1].endSec);
  }
});

test("ปฏิเสธเมื่อสิ่งที่ถอดได้เป็นคนละเรื่องกับสคริปต์", () => {
  const tokens = fakeTokens([{ text: "ไก่จิกเด็กตายบนปากโอ่ง", ms: 3000 }]);
  const result = alignChunks(["สวัสดีค่ะ", "ยินดีต้อนรับ"], tokens, { totalMs: 3000 });

  assert.equal(result.ok, false);
  assert.match(result.reason, /ตรงกับสคริปต์/);
});

test("ปฏิเสธเมื่อได้ท่อนที่สั้นผิดปกติ แทนที่จะปล่อยให้ซับเลื่อน", () => {
  // ทั้งสองท่อนถูกถอดออกมาชิดกันหมด รอยต่อจึงไปกองอยู่ที่เดียว
  const tokens = fakeTokens([
    { text: "สวัสดีค่ะยินดีต้อนรับ", ms: 20 },
    { text: "จบแล้ว", ms: 3000 },
  ]);
  const result = alignChunks(["สวัสดีค่ะ", "ยินดีต้อนรับ", "จบแล้ว"], tokens, { totalMs: 3020 });

  assert.equal(result.ok, false);
  assert.match(result.reason, /สั้นผิดปกติ|ย้อนกลับ/);
});

test("มีท่อนเดียวไม่ต้องตัด และไม่มีความยาวไฟล์ก็เชื่อไม่ได้", () => {
  const tokens = fakeTokens([{ text: "สวัสดี", ms: 500 }]);
  assert.equal(alignChunks(["สวัสดี"], tokens, { totalMs: 500 }).ok, false);
  assert.equal(alignChunks(["ก", "ข"], tokens, { totalMs: 0 }).ok, false);
});

test("อ่าน JSON ของ whisper.cpp แล้วข้าม token พิเศษ", () => {
  const tokens = parseWhisperJson({
    transcription: [{
      tokens: [
        { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
        { text: "สวัสดี", offsets: { from: 0, to: 900 } },
        { text: "ค่ะ", offsets: { from: 900, to: 1200 } },
        { text: "[_TT_50]", offsets: { from: 1200, to: 1200 } },
      ],
    }],
  });

  assert.deepEqual(tokens, [
    { text: "สวัสดี", startMs: 0, endMs: 900 },
    { text: "ค่ะ", startMs: 900, endMs: 1200 },
  ]);
});

test("whisperReady ต้องเห็นทั้งโปรแกรมและโมเดล ขาดอย่างใดอย่างหนึ่งไม่พอ", (t) => {
  const root = temporaryDirectory(t);
  const cli = path.join(root, "whisper-cli.exe");
  const model = path.join(root, "ggml.bin");
  fs.writeFileSync(cli, "x");

  assert.equal(whisperReady({ WHISPER_CLI_PATH: cli, WHISPER_MODEL_PATH: model }), false);
  fs.writeFileSync(model, "x");
  assert.equal(whisperReady({ WHISPER_CLI_PATH: cli, WHISPER_MODEL_PATH: model }), true);
  assert.equal(whisperReady({}), false);
});

test("เลือกไฟล์ติดตั้งตามเครื่องและการ์ดจอ", () => {
  const withGpu = getWhisperBinarySpec({ platform: "win32", arch: "x64", gpu: true });
  assert.match(withGpu.filename, /cublas/);
  assert.equal(withGpu.archive, "zip");

  // ไม่มีการ์ดจอต้องได้ไฟล์ที่เล็กกว่ามาก ไม่ใช่บังคับโหลดตัว CUDA ที่ใช้ไม่ได้
  const noGpu = getWhisperBinarySpec({ platform: "win32", arch: "x64", gpu: false });
  assert.match(noGpu.filename, /blas/);
  assert.ok(noGpu.approxBytes < withGpu.approxBytes / 10);

  const linux = getWhisperBinarySpec({ platform: "linux", arch: "x64", gpu: false });
  assert.equal(linux.archive, "tar.gz");

  for (const spec of [withGpu, noGpu, linux]) {
    assert.equal(new URL(spec.url).protocol, "https:");
  }
  assert.equal(new URL(getWhisperModelSpec().url).protocol, "https:");
});

test("แพลตฟอร์มที่ยังไม่รองรับต้องบอกทางออก ไม่ใช่ล้มเงียบ", () => {
  assert.throws(
    () => getWhisperBinarySpec({ platform: "darwin", arch: "arm64", gpu: false }),
    (error) => {
      assert.equal(error.code, "UNSUPPORTED_WHISPER_PLATFORM");
      assert.match(error.message, /brew/);
      return true;
    },
  );
});

test("ค้นหาแล้วไม่เจอ ต้องบอกว่ายังไม่ได้ติดตั้ง และไม่ตั้งค่า env ให้", async (t) => {
  const root = temporaryDirectory(t);
  const environment = {};
  const found = await discoverWhisper({
    appPaths: { bin: path.join(root, "bin") },
    environment,
    platform: "win32",
  });

  assert.equal(found.ready, false);
  assert.equal(found.found, false);
  assert.equal(environment.WHISPER_CLI_PATH, undefined);
});

test("มีโปรแกรมแต่ยังไม่มีโมเดล ต้องบอกให้ตรงจุด", async (t) => {
  const root = temporaryDirectory(t);
  const bin = path.join(root, "bin");
  fs.mkdirSync(path.join(bin, "whisper"), { recursive: true });
  fs.writeFileSync(path.join(bin, "whisper", "whisper-cli.exe"), "x");

  const found = await discoverWhisper({ appPaths: { bin }, environment: {}, platform: "win32" });
  assert.equal(found.ready, false);
  assert.equal(found.found, true);
  assert.match(found.reason, /โมเดล/);
});

// เคยมีบั๊กที่ synthesize กับ cachePathFor คำนวณกุญแจคนละสูตร (NUL กับช่องว่าง)
// ผลคือเสียงที่ได้จากการรวมคำขอถูกทิ้งแล้วยิงใหม่ทีละท่อน เปลืองโควตาสองเด้ง
// โดยไม่มีสัญญาณอะไรเลย เทสต์นี้ยึดไว้ว่าทุกที่ต้องใช้สูตรเดียวกัน
test("กุญแจแคชที่ synthesize เขียน ต้องตรงกับที่ cacheKeyFor คำนวณ", async (t) => {
  const root = temporaryDirectory(t);
  const cacheDir = path.join(root, "cache");
  const options = { provider: "silence", voice: "Kore", speed: 1, styleHint: "โทนสบาย", cacheDir };
  const text = "ทดสอบแคช";

  const first = await synthesize({ ...options, text, outFile: path.join(root, "a.wav") });
  assert.equal(first.cached, false);

  const written = fs.readdirSync(cacheDir);
  assert.deepEqual(written, [`${cacheKeyFor({ ...options, text })}.wav`]);

  const second = await synthesize({ ...options, text, outFile: path.join(root, "b.wav") });
  assert.equal(second.cached, true, "เรียกซ้ำต้องได้จากแคช ไม่ใช่สร้างใหม่");
});

test("กุญแจแคชแยกกันจริงเมื่อค่าต่างกัน และไม่ชนกันเพราะข้อความมีช่องว่าง", () => {
  const base = { provider: "gemini", voice: "Kore", speed: 1, styleHint: "", text: "สวัสดี" };
  const keys = new Set([
    cacheKeyFor(base),
    cacheKeyFor({ ...base, voice: "Enceladus" }),
    cacheKeyFor({ ...base, speed: 1.1 }),
    cacheKeyFor({ ...base, styleHint: "โทนสบาย" }),
    cacheKeyFor({ ...base, text: "สวัสดีค่ะ" }),
  ]);
  assert.equal(keys.size, 5);

  // ถ้าคั่นด้วยช่องว่าง สองชุดนี้จะได้กุญแจเดียวกันทั้งที่คนละเสียง
  assert.notEqual(
    cacheKeyFor({ ...base, voice: "a b", text: "c" }),
    cacheKeyFor({ ...base, voice: "a", text: "b c" }),
  );
});

// whisper.cpp บนวินโดวส์อ่าน argv เป็น ANSI ไฟล์ใต้โฟลเดอร์ชื่อไทยจึงเปิดไม่ได้
// (มันแปลงเป็น "???" แล้วบอกว่าหาไฟล์ไม่เจอ) ซึ่งเป็นเคสปกติของระบบนี้ทุกโปรเจกต์
// จึงต้องคัดลอกไฟล์ไปยังเส้นทางที่ปลอดภัยก่อนเสมอ และถ้าเส้นทางอื่นยังมีอักขระที่
// อ่านไม่ได้ ต้องบอกให้ชัด ไม่ใช่ปล่อยให้ล้มด้วย exit code เปล่า ๆ
test("เส้นทางโมเดลที่ไม่ใช่อักษรอังกฤษ ต้องแจ้งเหตุผลที่แก้ได้", async (t) => {
  const root = temporaryDirectory(t);
  const audio = path.join(root, "เสียง.wav");
  const model = path.join(root, "โมเดลไทย.bin");
  const cli = path.join(root, "whisper-cli.exe");
  for (const file of [audio, model, cli]) fs.writeFileSync(file, "x");

  await assert.rejects(
    transcribeTokens(audio, { cli, model, environment: {} }),
    (error) => {
      assert.match(error.message, /อักษรอังกฤษ/);
      return true;
    },
  );
});
