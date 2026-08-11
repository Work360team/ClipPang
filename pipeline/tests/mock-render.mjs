import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { probe, runPipeline } from "../index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..", "..");
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "clippang-render-test-"));
const progress = [];

try {
  const result = await runPipeline({
    projectDir,
    sourceFile: path.join(workspace, "public", "clippang-sample.mp4"),
    brief: {
      name: "หัวชาร์จพกพา",
      features: ["พับได้", "ชาร์จเร็ว"],
      cta: "กดตะกร้าเลย",
    },
    script: [
      { text: "หยุดดูก่อน", role: "hook" },
      { text: "พับได้ พกง่าย", role: "body" },
      { text: "กดตะกร้าเลย", role: "cta" },
    ],
    styleId: "karaoke-pop",
    kind: "draft",
    mockTts: true,
    detectBurnedCaptions: false,
    width: 360,
    height: 640,
    fps: 15,
    processTimeoutMs: 120_000,
    onProgress(event) {
      progress.push(event.progress);
    },
  });

  const rendered = await probe(result.outputs.video.path);
  assert.equal(rendered.width, 360);
  assert.equal(rendered.height, 640);
  assert.equal(rendered.hasAudio, true);
  assert.ok(rendered.durationMs > 1_000);
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
  assert.equal(fs.readdirSync(path.join(projectDir, "work")).length, 0);

  const reusedProgress = [];
  const reused = await runPipeline({
    projectDir,
    sourceFile: path.join(workspace, "public", "clippang-sample.mp4"),
    brief: { name: "หัวชาร์จพกพา" },
    voice: { provider: "provider-that-must-not-run", id: "must-not-run" },
    styleId: "reveal-clean",
    position: "top",
    kind: "final",
    reuseFrom: { renderId: "draft-test", timeline: result.timeline, outputs: result.outputs },
    detectBurnedCaptions: false,
    width: 360,
    height: 640,
    fps: 15,
    processTimeoutMs: 120_000,
    onProgress(event) {
      reusedProgress.push(event);
    },
  });
  const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(digest(reused.outputs.voice.path), digest(result.outputs.voice.path));
  assert.equal(reused.report.tts.reused, true);
  assert.equal(reused.report.tts.sourceRenderId, "draft-test");
  assert.equal(reused.report.estimatedCostUsd.tts, 0);
  assert.equal(reused.report.style, "reveal-clean");
  assert.equal(reused.report.caption.anchor, "top");
  assert.equal(reused.report.stageMs.voice, 0);
  assert.ok(reusedProgress.some((event) => event.stage === "voice" && /ไม่เรียก TTS ซ้ำ/.test(event.message)));
  assert.equal(fs.readdirSync(path.join(projectDir, "work")).length, 0);

  const abortProject = path.join(projectDir, "abort-case");
  fs.mkdirSync(abortProject);
  const controller = new AbortController();
  await assert.rejects(
    runPipeline({
      projectDir: abortProject,
      sourceFile: path.join(workspace, "public", "clippang-sample.mp4"),
      brief: { name: "ทดสอบยกเลิก" },
      script: [{ text: "กำลังทดสอบ", role: "hook" }],
      styleId: "karaoke-pop",
      kind: "draft",
      mockTts: true,
      detectBurnedCaptions: false,
      width: 360,
      height: 640,
      fps: 15,
      signal: controller.signal,
      onProgress(event) {
        if (event.stage === "compose") controller.abort(new Error("integration-test abort"));
      },
    }),
    (error) => error?.name === "AbortError",
  );
  assert.equal(fs.readdirSync(path.join(abortProject, "work")).length, 0);
  assert.equal(fs.readdirSync(path.join(abortProject, "out")).length, 0);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    durationMs: rendered.durationMs,
    dimensions: `${rendered.width}x${rendered.height}`,
    outputs: Object.keys(result.outputs),
    progressEvents: progress.length,
    reusedVoiceWithoutTts: true,
    abortCleanup: true,
  }, null, 2)}\n`);
} finally {
  const resolved = path.resolve(projectDir);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith("clippang-render-test-")) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
