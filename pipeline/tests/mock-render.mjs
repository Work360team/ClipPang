import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { probe, runPipeline } from "../index.mjs";
import { prepareSources } from "../../server/sources.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..", "..");
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "clippang-render-test-"));
const progress = [];

try {
  const serverPrepareRoot = path.join(projectDir, "server-prepare");
  const serverInput = path.join(serverPrepareRoot, "input");
  const serverSourceDir = path.join(serverPrepareRoot, "src");
  fs.mkdirSync(serverInput, { recursive: true });
  fs.copyFileSync(
    path.join(workspace, "public", "clippang-sample.mp4"),
    path.join(serverInput, "คลิป ทดสอบ.mp4"),
  );
  const serverPrepared = await prepareSources({ id: "mock-project" }, {}, {
    assets: [{ name: "คลิป ทดสอบ.mp4" }],
    timelineClips: [
      { id: "server-probe", assetName: "คลิป ทดสอบ.mp4", order: 0, trimStartMs: 1_000, trimEndMs: 3_000 },
    ],
  }, { inputDir: serverInput, projectSourceDir: serverSourceDir });
  assert.equal(serverPrepared.sourceSelections[0].selectedDurationMs, 2_000);
  assert.ok(serverPrepared.sourceSelections[0].actualDurationMs > 29_000);

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

  const orderedProject = path.join(projectDir, "ordered-edit");
  fs.mkdirSync(orderedProject);
  const source = path.join(workspace, "public", "clippang-sample.mp4");
  const editPlanHash = "a".repeat(64);
  const ordered = await runPipeline({
    projectDir: orderedProject,
    sourceFiles: [source],
    sourceSelections: [
      // Input is deliberately not sorted. The visual track must follow order.
      { id: "second", assetName: "clippang-sample.mp4", file: source, order: 1, trimStartMs: 4_000, trimEndMs: 5_500 },
      { id: "first", assetName: "clippang-sample.mp4", file: source, order: 0, trimStartMs: 500, trimEndMs: 3_000 },
    ],
    selectedTotalMs: 4_000,
    editPlanHash,
    brief: { name: "ทดสอบต่อคลิปตามไทม์ไลน์" },
    script: [{ text: "ดีมาก", role: "hook" }],
    styleId: "karaoke-pop",
    kind: "draft",
    mockTts: true,
    detectBurnedCaptions: false,
    width: 360,
    height: 640,
    fps: 15,
    processTimeoutMs: 120_000,
  });
  const orderedMedia = await probe(ordered.outputs.video.path);
  assert.ok(Math.abs(orderedMedia.durationMs - 4_000) <= (1000 / 15) + 2);
  assert.equal(ordered.timeline.durationMs, 4_000);
  assert.equal(ordered.timeline.editPlanHash, editPlanHash);
  assert.equal(ordered.timeline.narrationFit.mode, "pad-silence");
  assert.deepEqual(ordered.report.timelineClips.map((clip) => clip.id), ["first", "second"]);
  assert.deepEqual(ordered.report.timelineClips.map((clip) => clip.trimStartMs), [500, 4_000]);
  assert.deepEqual(ordered.report.timelineClips.map((clip) => clip.durationMs), [2_500, 1_500]);
  assert.equal(ordered.report.selectedTotalMs, 4_000);
  assert.ok(Math.abs(ordered.report.outputDurationMs - 4_000) <= (1000 / 15) + 2);
  assert.equal(fs.readdirSync(path.join(orderedProject, "work")).length, 0);

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
    orderedEditDurationMs: orderedMedia.durationMs,
    orderedEditPreserved: true,
    serverFfprobeValidated: true,
    abortCleanup: true,
  }, null, 2)}\n`);
} finally {
  const resolved = path.resolve(projectDir);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith("clippang-render-test-")) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
