import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HOST, createPaths } from "../server/config.mjs";
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

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clippang-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("local-only host and runtime paths are fixed beneath the app root", () => {
  const root = path.resolve("fixture-root");
  const appPaths = createPaths(root);
  assert.equal(HOST, "127.0.0.1");
  assert.equal(appPaths.data, path.join(root, "data"));
  assert.equal(appPaths.database, path.join(root, "data", "clippang.db"));
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
