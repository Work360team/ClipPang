import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HOST, applyLegacyEnvAliases, createPaths, migrateLegacyDatabase } from "../server/config.mjs";
import {
  MAX_VIDEO_BYTES,
  assertVideoUpload,
  getGeminiKeyStatus,
  resolveUnderRoot,
  safeFilename,
  saveGeminiApiKey,
  validateVideoUpload,
} from "../server/security.mjs";
import {
  getFfmpegDownloadSpec,
  getNodeStatus,
  testGeminiApiKey,
} from "../server/setup.mjs";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE, readSessionCookie } from "../server/auth.mjs";

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clip360-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("local-only host and runtime paths are fixed beneath the app root", () => {
  const root = path.resolve("fixture-root");
  const appPaths = createPaths(root);
  assert.equal(HOST, "127.0.0.1");
  assert.equal(appPaths.data, path.join(root, "data"));
  assert.equal(appPaths.database, path.join(root, "data", "clip360.db"));
  assert.equal(appPaths.input, path.join(root, "input"));
  assert.equal(appPaths.projects, path.join(root, "projects"));
});

test("path resolution rejects traversal with either separator style", (t) => {
  const root = temporaryDirectory(t);
  assert.equal(resolveUnderRoot(root, "project/video.mp4"), path.join(root, "project", "video.mp4"));
  assert.throws(() => resolveUnderRoot(root, "../outside"), { code: "PATH_OUTSIDE_ROOT" });
  assert.throws(() => resolveUnderRoot(root, "..\\outside"), { code: "PATH_OUTSIDE_ROOT" });
  assert.equal(safeFilename("../../CON.mp4"), "_CON.mp4");
});

test("video validation uses magic bytes and enforces the 500 MB boundary", () => {
  const mp4Header = Buffer.from("000000186674797069736f6d0000020069736f6d", "hex");
  assert.equal(assertVideoUpload({ header: mp4Header, size: mp4Header.length }).container, "mp4");
  assert.equal(validateVideoUpload({ header: Buffer.from("not a video"), size: 11 }).code, "UNSUPPORTED_VIDEO");
  assert.equal(validateVideoUpload({ header: mp4Header, size: MAX_VIDEO_BYTES + 1 }).code, "FILE_TOO_LARGE");
});

test("API key status and save results expose only boolean and last four", (t) => {
  const root = temporaryDirectory(t);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "OTHER=value\nGEMINI_API_KEY=old_secret_key_1234\n", "utf8");

  const before = getGeminiKeyStatus({ envFile, environment: {} });
  assert.equal(before.configured, true);
  assert.equal(before.last4, "1234");
  assert.equal(Object.hasOwn(before, "value"), false);

  const after = saveGeminiApiKey("new_secret_key_5678", { envFile, environment: {} });
  assert.equal(after.last4, "5678");
  assert.equal(Object.hasOwn(after, "value"), false);
  assert.equal(
    fs.readFileSync(envFile, "utf8"),
    "OTHER=value\nGEMINI_API_KEY=new_secret_key_5678\n",
  );
});

test("Node check compares semantic version components", () => {
  assert.equal(getNodeStatus({ version: "22.13.0" }).ready, true);
  assert.equal(getNodeStatus({ version: "22.12.9" }).ready, false);
  assert.equal(getNodeStatus({ version: "23.0.0" }).ready, true);
});

test("Windows auto-download points to the libass-enabled Gyan essentials build", () => {
  const spec = getFfmpegDownloadSpec({ platform: "win32", arch: "x64" });
  assert.equal(spec.provider, "gyan.dev");
  assert.equal(spec.archive, "zip");
  assert.match(spec.url, /^https:\/\/www\.gyan\.dev\//);
});

test("Gemini key test sends the secret in a header and never returns it", async () => {
  const submittedKey = "test_gemini_key_1234567890";
  let observedUrl;
  let observedHeader;
  const result = await testGeminiApiKey(submittedKey, {
    fetchImpl: async (url, init) => {
      observedUrl = String(url);
      observedHeader = init.headers["x-goog-api-key"];
      return {
        ok: true,
        status: 200,
        url: String(url),
        body: { cancel: async () => {} },
      };
    },
  });

  assert.equal(observedHeader, submittedKey);
  assert.equal(observedUrl.includes(submittedKey), false);
  assert.equal(result.ok, true);
  assert.equal(result.last4, "7890");
  assert.equal(JSON.stringify(result).includes(submittedKey), false);
});

test("Gemini key test throws an actionable safe error when Google rejects it", async () => {
  const submittedKey = "rejected_gemini_key_123456";
  await assert.rejects(
    testGeminiApiKey(submittedKey, {
      fetchImpl: async (url) => ({
        ok: false,
        status: 403,
        url: String(url),
        body: { cancel: async () => {} },
      }),
    }),
    (error) => {
      assert.equal(error.code, "API_KEY_REJECTED");
      assert.equal(error.status, 400);
      assert.equal(error.message.includes(submittedKey), false);
      return true;
    },
  );
});

// เปลี่ยนแบรนด์จาก ClipPang เป็น Clip360 แล้วชื่อ env, ไฟล์ฐานข้อมูล และคุกกี้เปลี่ยนตาม
// เครื่องที่ติดตั้งไว้ก่อนหน้ายังใช้ชื่อเดิม ถ้าไม่รับของเดิมด้วยจะกลายเป็นอัปเดตแล้ว
// ล็อกอินไม่ได้และเห็นโปรเจกต์ว่างเปล่า — เทสต์ชุดนี้กันไม่ให้ compat หลุดไปเงียบ ๆ
test("legacy CLIPPANG_ env names still work but never override the new ones", () => {
  const env = {
    CLIPPANG_USER: "เจ้าของเดิม",
    CLIPPANG_ALLOWED_HOSTS: "old.example.com",
    CLIP360_ALLOWED_HOSTS: "new.example.com",
    CLIP360_USER: "",
    UNRELATED: "ไม่ยุ่ง",
  };
  applyLegacyEnvAliases(env);

  assert.equal(env.CLIP360_USER, "เจ้าของเดิม", "ช่องที่ยังว่างต้องรับค่าจากชื่อเดิม");
  assert.equal(env.CLIP360_ALLOWED_HOSTS, "new.example.com", "ชื่อใหม่ที่ตั้งไว้แล้วต้องชนะ");
  assert.equal(env.CLIPPANG_USER, "เจ้าของเดิม", "ไม่ลบชื่อเดิมทิ้ง");
  assert.equal(Object.hasOwn(env, "CLIP360_UNRELATED"), false);
});

test("an existing clippang.db is moved to clip360.db together with its WAL files", (t) => {
  const dataDir = temporaryDirectory(t);
  const target = path.join(dataDir, "clip360.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.writeFileSync(path.join(dataDir, `clippang.db${suffix}`), `ข้อมูลเดิม${suffix}`);
  }

  assert.equal(migrateLegacyDatabase(target), true);
  for (const suffix of ["", "-wal", "-shm"]) {
    assert.equal(fs.readFileSync(target + suffix, "utf8"), `ข้อมูลเดิม${suffix}`);
    assert.equal(fs.existsSync(path.join(dataDir, `clippang.db${suffix}`)), false);
  }

  // เรียกซ้ำต้องไม่ทำอะไร ไม่งั้นรีสตาร์ตทีข้อมูลโดนทับที
  assert.equal(migrateLegacyDatabase(target), false);
});

test("database migration leaves a newer clip360.db untouched", (t) => {
  const dataDir = temporaryDirectory(t);
  const target = path.join(dataDir, "clip360.db");
  fs.writeFileSync(path.join(dataDir, "clippang.db"), "ของเก่า");
  fs.writeFileSync(target, "ของที่ใช้อยู่");

  assert.equal(migrateLegacyDatabase(target), false);
  assert.equal(fs.readFileSync(target, "utf8"), "ของที่ใช้อยู่");
});

test("session cookies issued under the old brand name are still accepted", () => {
  assert.equal(SESSION_COOKIE, "clip360_session");
  assert.equal(LEGACY_SESSION_COOKIE, "clippang_session");

  assert.equal(readSessionCookie("clippang_session=เซสชันเก่า"), "เซสชันเก่า");
  assert.equal(readSessionCookie("clip360_session=เซสชันใหม่"), "เซสชันใหม่");
  assert.equal(
    readSessionCookie("clippang_session=เซสชันเก่า; clip360_session=เซสชันใหม่"),
    "เซสชันใหม่",
    "ถ้ามีทั้งคู่ต้องใช้ของใหม่",
  );
  assert.equal(readSessionCookie(""), "");
});
