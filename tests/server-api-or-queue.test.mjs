import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApiHandler } from "../server/api.mjs";
import { PATHS } from "../server/config.mjs";
import { createLocalRuntime, createWebWorkerLoader, pickScript } from "../server/index.mjs";
import { RenderQueue } from "../server/queue.mjs";
import {
  MAX_SOURCE_ASSETS,
  MAX_TIMELINE_CLIPS,
  normalizeAssetCatalog,
  normalizeTimelineClips,
  prepareSources,
} from "../server/sources.mjs";
import { createStore } from "../server/store/index.mjs";

function fixture(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "clippang-server-"));
  const store = createStore({ rootDir });
  const closeables = [];
  t.after(async () => {
    for (const close of closeables.reverse()) {
      try {
        await close();
      } catch {
        // Continue closing the remaining test resources.
      }
    }
    store.close();
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  return {
    rootDir,
    store,
    closeWith(callback) {
      closeables.push(callback);
    },
  };
}

test("web worker loader switches to a rebuilt server bundle without restarting", async (t) => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "clippang-worker-reload-"));
  const sourceDir = path.join(rootDir, "source");
  fs.mkdirSync(sourceDir);
  const entry = path.join(sourceDir, "worker.mjs");
  const dependency = path.join(sourceDir, "build-value.mjs");
  const buildId = path.join(sourceDir, "BUILD_ID");
  let getWebWorker;
  t.after(async () => {
    await getWebWorker?.close();
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  writeFileSync(entry, "import { build } from './build-value.mjs'; export default { build, fetch() {} };\n");
  writeFileSync(dependency, "export const build = 'one';\n");
  writeFileSync(buildId, "build-one\n");
  getWebWorker = await createWebWorkerLoader({ entry, snapshotBase: path.join(rootDir, "snapshots") });
  assert.equal((await getWebWorker()).build, "one");

  writeFileSync(dependency, "export const build = 'two-after-rebuild';\n");
  writeFileSync(buildId, "build-two\n");
  assert.equal((await getWebWorker()).build, "two-after-rebuild");
});

function apiRequest(handler, pathname, { method = "GET", body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return handler(new Request(`http://127.0.0.1${pathname}`, init));
}

async function responseJson(response) {
  const payload = await response.json();
  assert.equal(
    response.ok,
    true,
    `unexpected API response ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function waitForRender(store, renderId, predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const render = store.getRender(renderId);
    if (render && predicate(render)) return render;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for render ${renderId}: ${JSON.stringify(store.getRender(renderId))}`);
}

function sseEvents(source) {
  return source.split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
}

test("queue uses the synchronous store lifecycle signatures and persists JSON", async (t) => {
  const { store, closeWith } = fixture(t);
  const project = store.createProject({ id: "queue-project", title: "ทดสอบ Queue" });
  const render = store.createRender({
    id: "queue-render",
    projectId: project.id,
    kind: "draft",
    lane: "ass",
    config: { styleId: "karaoke-pop", chunks: ["หนึ่ง", "สอง"] },
  });
  const observed = [];
  const queue = new RenderQueue({
    store,
    processor: async ({ config, onProgress }) => {
      assert.deepEqual(config, { styleId: "karaoke-pop", chunks: ["หนึ่ง", "สอง"] });
      onProgress({ progress: 37, stage: "voice", message: "กำลังพากย์" });
      return {
        timeline: { chunks: [{ startMs: 0, endMs: 900 }] },
        outputs: { video: "out/draft.mp4", captions: "out/captions.srt" },
      };
    },
  });
  closeWith(() => queue.close());
  const unsubscribe = queue.subscribe(render.id, (event) => observed.push(event));
  queue.enqueue(render);

  const ready = await waitForRender(store, render.id, (item) => item.state === "ready");
  unsubscribe();
  assert.equal(ready.attempts, 1);
  assert.equal(ready.progress, 100);
  assert.equal(ready.queuePosition, null);
  assert.deepEqual(ready.timeline, { chunks: [{ startMs: 0, endMs: 900 }] });
  assert.deepEqual(ready.outputs, {
    video: "out/draft.mp4",
    captions: "out/captions.srt",
  });
  assert.ok(observed.some((event) => event.state === "processing" && event.progress === 37));
  assert.equal(observed.at(-1).state, "ready");
  assert.equal(observed.at(-1).project_id, project.id);
});

test("runtime recovers interrupted renders and graceful shutdown leaves work queued", async (t) => {
  const { store, closeWith } = fixture(t);
  const project = store.createProject({ id: "recovery-project", title: "ทดสอบ Recovery" });
  const interrupted = store.createRender({
    id: "interrupted-render",
    projectId: project.id,
    kind: "final",
    lane: "hyperframes",
    config: { styleId: "kanit-hf" },
  });
  store.startRender(interrupted.id, { state: "rendering", stage: "compose" });
  store.updateRenderProgress(interrupted.id, 61, { message: "ก่อนโปรแกรมปิด" });

  let receivedRender;
  const runtime = await createLocalRuntime({
    store,
    processor: async (render) => {
      receivedRender = render;
      return { outputs: { video: "out/final.mp4" }, timeline: { durationMs: 1_200 } };
    },
  });
  closeWith(() => runtime.close());
  const ready = await waitForRender(store, interrupted.id, (item) => item.state === "ready");
  assert.equal(ready.attempts, 2);
  assert.equal(receivedRender.projectId, project.id);
  assert.equal(receivedRender.lane, "hyperframes");
  assert.deepEqual(receivedRender.config, { styleId: "kanit-hf" });

  await runtime.close();

  const secondStoreRoot = mkdtempSync(path.join(os.tmpdir(), "clippang-shutdown-"));
  const secondStore = createStore({ rootDir: secondStoreRoot });
  t.after(() => {
    secondStore.close();
    rmSync(secondStoreRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  const secondProject = secondStore.createProject({ id: "shutdown-project", title: "ปิดโปรแกรม" });
  const activeRender = secondStore.createRender({
    id: "shutdown-render",
    projectId: secondProject.id,
    kind: "draft",
    lane: "ass",
  });
  const blockingQueue = new RenderQueue({
    store: secondStore,
    processor: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  blockingQueue.enqueue(activeRender);
  await waitForRender(secondStore, activeRender.id, (item) => item.state === "processing");
  await blockingQueue.close();
  assert.equal(secondStore.getRender(activeRender.id).state, "queued");
});

test("API render, SSE, promote, cancel, settings, and cache use canonical store fields", async (t) => {
  const { store, closeWith } = fixture(t);
  const project = store.createProject({ id: "api-project", title: "ทดสอบ API" });
  const queue = new RenderQueue({
    store,
    processor: async (render) => {
      if (render.config?.hold) {
        return new Promise((resolve, reject) => {
          render.signal.addEventListener("abort", () => reject(render.signal.reason), { once: true });
        });
      }
      render.onProgress({ progress: 55, stage: "caption", message: "กำลังทำซับ" });
      return {
        timeline: { durationMs: 2_500 },
        outputs: { video: `out/${render.kind}.mp4` },
      };
    },
  });
  closeWith(() => queue.close());
  const api = createApiHandler({
    store,
    queue,
    services: {
      getSetupStatus: async () => ({ key: { configured: true, masked: "••••1234" } }),
    },
  });

  const voicesPayload = await responseJson(await apiRequest(api, "/api/voices"));
  assert.equal(voicesPayload.voices.length, 30);
  assert.ok(voicesPayload.voices.every((voice) => voice.provider === "gemini"));

  const draftResponse = await apiRequest(api, `/api/projects/${project.id}/renders`, {
    method: "POST",
    body: { kind: "draft", styleId: "karaoke-pop", config: { position: "bottom" } },
  });
  assert.equal(draftResponse.status, 202);
  const draftPayload = await responseJson(draftResponse);
  assert.equal(draftPayload.render.lane, "ass");
  assert.equal(draftPayload.render.project_id, project.id);
  assert.equal(draftPayload.render.style_id, "karaoke-pop");
  assert.equal(draftPayload.render.config.position, "bottom");
  const draft = await waitForRender(store, draftPayload.renderId, (item) => item.state === "ready");

  const readyEventsResponse = await apiRequest(api, `/api/renders/${draft.id}/events`);
  assert.match(readyEventsResponse.headers.get("content-type"), /^text\/event-stream/);
  const readyEvents = sseEvents(await readyEventsResponse.text());
  assert.equal(readyEvents.at(-1).state, "ready");
  assert.equal(readyEvents.at(-1).project_id, project.id);

  const getPayload = await responseJson(await apiRequest(api, `/api/renders/${draft.id}`));
  assert.equal(getPayload.render.outputs.video.filename, "draft.mp4");
  assert.equal(
    getPayload.render.outputs.video.url,
    `/api/projects/${project.id}/files/draft.mp4`,
  );
  const projectPayload = await responseJson(await apiRequest(api, `/api/projects/${project.id}`));
  const listedDraft = projectPayload.project.renders.find((item) => item.id === draft.id);
  assert.equal(listedDraft.outputs.video.url, `/api/projects/${project.id}/files/draft.mp4`);
  assert.equal(listedDraft.created_at, draft.createdAt);
  writeFileSync(path.join(store.projectDir(project.id), "out", "draft.mp4"), "test-video");
  const inlineFile = await apiRequest(api, `/api/projects/${project.id}/files/draft.mp4`);
  assert.equal(inlineFile.status, 200);
  assert.equal(inlineFile.headers.get("content-disposition"), null);
  await inlineFile.arrayBuffer();
  const downloadedFile = await apiRequest(
    api,
    `/api/projects/${project.id}/files/draft.mp4?download=1`,
  );
  assert.match(downloadedFile.headers.get("content-disposition"), /^attachment;/);
  await downloadedFile.arrayBuffer();

  const promotePayload = await responseJson(await apiRequest(api, `/api/renders/${draft.id}/promote`, {
    method: "POST",
    body: { styleId: "reveal-clean", position: "top" },
  }));
  assert.equal(promotePayload.render.lane, "ass");
  assert.equal(promotePayload.render.project_id, project.id);
  assert.equal(promotePayload.render.config.reuseRenderId, draft.id);
  assert.equal(promotePayload.render.style_id, "reveal-clean");
  assert.equal(promotePayload.render.config.styleId, "reveal-clean");
  assert.equal(promotePayload.render.config.position, "top");
  await waitForRender(store, promotePayload.renderId, (item) => item.state === "ready");

  const heldPayload = await responseJson(await apiRequest(api, `/api/projects/${project.id}/renders`, {
    method: "POST",
    body: { kind: "final", styleId: "kanit-hf", config: { hold: true } },
  }));
  assert.equal(heldPayload.render.lane, "hyperframes");
  await waitForRender(store, heldPayload.renderId, (item) => item.state === "processing");
  const liveEventsResponse = await apiRequest(api, `/api/renders/${heldPayload.renderId}/events`);
  const liveText = liveEventsResponse.text();
  const canceledPayload = await responseJson(await apiRequest(api, `/api/renders/${heldPayload.renderId}/cancel`, {
    method: "POST",
    body: {},
  }));
  assert.equal(canceledPayload.render.state, "canceled");
  const liveEvents = sseEvents(await liveText);
  assert.equal(liveEvents.at(-1).state, "canceled");
  assert.equal(store.getRender(heldPayload.renderId).queuePosition, null);

  const settingsPatch = await responseJson(await apiRequest(api, "/api/settings", {
    method: "PATCH",
    body: { renderConcurrency: 2, ui: { compact: true }, key: "must-not-be-stored" },
  }));
  assert.equal(settingsPatch.settings.renderConcurrency, "2");
  assert.equal(settingsPatch.settings.ui, JSON.stringify({ compact: true }));
  assert.equal(store.getSetting("key"), null);
  const settingsGet = await responseJson(await apiRequest(api, "/api/settings"));
  assert.equal(settingsGet.settings.key.masked, "••••1234");

  const cacheKey = "c".repeat(64);
  writeFileSync(store.voiceCachePath(cacheKey), "RIFF-test-wave");
  store.upsertVoiceCache({ key: cacheKey, durationMs: 500 });
  const cleared = await responseJson(await apiRequest(api, "/api/settings/cache/clear", {
    method: "POST",
    body: {},
  }));
  assert.equal(cleared.removed, 1);
  assert.equal(store.getVoiceCache(cacheKey), null);
});

test("API exposes string script chunks and converts them back for regeneration", async (t) => {
  const { store, closeWith } = fixture(t);
  const project = store.createProject({
    id: "script-project",
    title: "ทดสอบสคริปต์",
    product: { brief: { name: "สินค้า" } },
  });
  const queue = new RenderQueue({ store, processor: async () => ({}) });
  closeWith(() => queue.close());
  let regenerationInput;
  const api = createApiHandler({
    store,
    queue,
    services: {
      generateScripts: async () => [{
        id: "v1",
        hookType: "problem",
        chunks: [
          { i: 0, text: "ประโยคเปิด", role: "hook", emphasis: [] },
          { i: 1, text: "ประโยคขาย", role: "body", emphasis: [] },
        ],
      }],
      regenerateChunk: async (input) => {
        regenerationInput = input;
        const scripts = structuredClone(input.scripts);
        scripts[0].chunks[1] = { ...scripts[0].chunks[1], text: "ประโยคใหม่" };
        return { chunk: scripts[0].chunks[1], scripts };
      },
    },
  });

  const generated = await responseJson(await apiRequest(api, `/api/projects/${project.id}/script`, {
    method: "POST",
    body: { brief: { name: "สินค้า", features: ["เบา"] } },
  }));
  assert.deepEqual(generated.scripts[0].chunks, ["ประโยคเปิด", "ประโยคขาย"]);
  const saved = store.getProject(project.id);
  assert.deepEqual(saved.product.scripts[0].chunks, ["ประโยคเปิด", "ประโยคขาย"]);
  assert.equal(saved.wizardStep, 4);

  const regenerated = await responseJson(await apiRequest(
    api,
    `/api/projects/${project.id}/script/v1/chunk/1`,
    {
      method: "POST",
      body: { scripts: generated.scripts, brief: { name: "สินค้า" } },
    },
  ));
  assert.equal(regenerationInput.scripts[0].chunks[0].text, "ประโยคเปิด");
  assert.equal(regenerationInput.scripts[0].chunks[1].text, "ประโยคขาย");
  assert.equal(regenerated.chunk, "ประโยคใหม่");
  assert.deepEqual(regenerated.scripts[0].chunks, ["ประโยคเปิด", "ประโยคใหม่"]);

  const patched = await responseJson(await apiRequest(api, `/api/projects/${project.id}`, {
    method: "PATCH",
    body: {
      wizard_step: 3,
      product_json: { name: "สินค้าแก้แล้ว" },
      selectedVoice: "Kore",
    },
  }));
  assert.equal(patched.project.wizardStep, 3);
  assert.equal(patched.project.wizard_step, 3);
  assert.deepEqual(patched.project.product, { name: "สินค้าแก้แล้ว" });
  assert.equal(store.getProject(project.id).selectedVoice, "Kore");

  assert.deepEqual(
    pickScript(
      { scriptId: "v1" },
      { scripts: [{ id: "v1", chunks: ["หนึ่ง", "สอง"] }] },
    ).map((chunk) => chunk.text),
    ["หนึ่ง", "สอง"],
  );
});

test("media validators cap uploads/clips and require canonical contiguous order", () => {
  assert.throws(
    () => normalizeAssetCatalog(Array.from({ length: MAX_SOURCE_ASSETS + 1 }, (_, index) => ({ name: `v${index}.mp4` }))),
    (error) => error.code === "TOO_MANY_SOURCE_ASSETS",
  );
  const assetNames = ["a.mp4"];
  assert.throws(
    () => normalizeTimelineClips([
      { id: "one", assetName: "a.mp4", order: 0, trimStartMs: 0, trimEndMs: 1_000 },
      { id: "two", assetName: "a.mp4", order: 0, trimStartMs: 1_000, trimEndMs: 2_000 },
    ], { assetNames }),
    (error) => error.code === "INVALID_TIMELINE_ORDER",
  );
  assert.throws(
    () => normalizeTimelineClips(Array.from({ length: MAX_TIMELINE_CLIPS + 1 }, (_, index) => ({
      id: `clip-${index}`,
      assetName: "a.mp4",
      order: index,
      trimStartMs: index * 10,
      trimEndMs: index * 10 + 10,
    })), { assetNames }),
    (error) => error.code === "TOO_MANY_TIMELINE_CLIPS",
  );
  assert.throws(
    () => normalizeTimelineClips([
      { id: "long", assetName: "a.mp4", order: 0, trimStartMs: 0, trimEndMs: 60_001 },
    ], { assetNames }),
    (error) => error.code === "TIMELINE_DURATION_LIMIT",
  );
});

test("upload probes duration, preserves Unicode names, and generates collision-safe names", async (t) => {
  const { store, closeWith } = fixture(t);
  const queue = new RenderQueue({ store, processor: async () => ({}) });
  closeWith(() => queue.close());
  const api = createApiHandler({
    store,
    queue,
    services: {
      probeVideo: async (file) => ({ file, durationMs: 12_345, width: 1080, height: 1920 }),
    },
  });
  const created = [];
  t.after(() => {
    for (const name of created) fs.rmSync(path.join(PATHS.input, name), { force: true });
  });
  const body = Buffer.alloc(64);
  body.write("ftyp", 4, "ascii");
  body.write("isom", 8, "ascii");
  const upload = async (name = "คลิป สินค้า.mp4") => api(new Request(
    `http://127.0.0.1/api/assets/${encodeURIComponent(name)}`,
    { method: "PUT", body, duplex: "half" },
  ));

  const first = await responseJson(await upload());
  const second = await responseJson(await upload());
  created.push(first.asset.name, second.asset.name);
  assert.equal(first.asset.originalName, "คลิป สินค้า.mp4");
  assert.equal(first.asset.durationMs, 12_345);
  assert.match(first.asset.name, /^คลิป สินค้า-[a-z0-9]+-[a-f0-9]{8}\.mp4$/u);
  assert.notEqual(first.asset.name, second.asset.name);
  assert.ok(fs.existsSync(path.join(PATHS.input, first.asset.name)));
  assert.ok(fs.existsSync(path.join(PATHS.input, second.asset.name)));

  const longOriginal = `${"ก".repeat(156)}.mp4`;
  const longFirst = await responseJson(await upload(longOriginal));
  const longSecond = await responseJson(await upload(longOriginal));
  created.push(longFirst.asset.name, longSecond.asset.name);
  assert.equal(longFirst.asset.originalName, longOriginal);
  assert.ok(Array.from(longFirst.asset.name).length <= 160);
  assert.notEqual(longFirst.asset.name, longSecond.asset.name);
  assert.match(longFirst.asset.name, /-[a-z0-9]+-[a-f0-9]{8}\.mp4$/u);

  const malformed = await api(new Request("http://127.0.0.1/api/assets/%E0%A4%A"));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_URL_ENCODING");
});

test("prepareSources probes unique assets once and preserves repeated split clips", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "clippang-sources-"));
  const inputDir = path.join(root, "input");
  const projectSourceDir = path.join(root, "project", "src");
  fs.mkdirSync(inputDir, { recursive: true });
  writeFileSync(path.join(inputDir, "a.mp4"), "fixture-a");
  writeFileSync(path.join(inputDir, "b.mp4"), "fixture-b");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const probed = [];
  const product = {
    assets: [{ name: "a.mp4" }, { name: "b.mp4" }],
    timelineClips: [
      { id: "a-tail", assetName: "a.mp4", order: 2, trimStartMs: 5_000, trimEndMs: 7_000 },
      { id: "a-head", assetName: "a.mp4", order: 0, trimStartMs: 500, trimEndMs: 2_000 },
      { id: "b-mid", assetName: "b.mp4", order: 1, trimStartMs: 1_000, trimEndMs: 2_500 },
    ],
  };
  const result = await prepareSources({ id: "test-project" }, {}, product, {
    inputDir,
    projectSourceDir,
    probeVideo: async (file) => {
      probed.push(path.basename(file));
      return { file, name: path.basename(file), durationMs: path.basename(file) === "a.mp4" ? 10_000 : 8_000 };
    },
  });
  assert.deepEqual(probed, ["a.mp4", "b.mp4"]);
  assert.equal(result.sourceFiles.length, 2);
  assert.deepEqual(result.sourceSelections.map((clip) => clip.id), ["a-head", "b-mid", "a-tail"]);
  assert.deepEqual(result.sourceSelections.map((clip) => clip.selectedDurationMs), [1_500, 1_500, 2_000]);
  assert.equal(result.selectedTotalMs, 5_000);
  assert.match(result.editPlanHash, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(projectSourceDir, "a.mp4")));
  assert.ok(fs.existsSync(path.join(projectSourceDir, "b.mp4")));

  await assert.rejects(
    prepareSources({ id: "test-project" }, {}, {
      assets: [{ name: "a.mp4" }],
      timelineClips: [{ id: "bad", assetName: "a.mp4", order: 0, trimStartMs: 9_000, trimEndMs: 10_001 }],
    }, {
      inputDir,
      projectSourceDir,
      probeVideo: async (file) => ({ file, name: path.basename(file), durationMs: 10_000 }),
    }),
    (error) => error.code === "CLIP_TRIM_OUT_OF_RANGE",
  );
});

test("render rejects overlong plans before enqueue and promotion rejects stale draft hash", async (t) => {
  const { store, closeWith } = fixture(t);
  const initialProduct = {
    assets: [{ name: "a.mp4", durationMs: 90_000 }],
    timelineClips: [{ id: "clip-a", assetName: "a.mp4", order: 0, trimStartMs: 0, trimEndMs: 4_000 }],
  };
  const project = store.createProject({ id: "edit-plan-project", title: "Edit plan", product: initialProduct });
  const queue = new RenderQueue({
    store,
    processor: async () => ({ timeline: { durationMs: 4_000 }, outputs: { video: "out/draft.mp4" } }),
  });
  closeWith(() => queue.close());
  const api = createApiHandler({ store, queue });

  const overlong = await apiRequest(api, `/api/projects/${project.id}/renders`, {
    method: "POST",
    body: {
      kind: "draft",
      assets: initialProduct.assets,
      timelineClips: [{ id: "too-long", assetName: "a.mp4", order: 0, trimStartMs: 0, trimEndMs: 60_001 }],
    },
  });
  assert.equal(overlong.status, 400);
  assert.equal((await overlong.json()).error.code, "TIMELINE_DURATION_LIMIT");
  assert.equal(store.listProjectRenders(project.id).length, 0);

  const draftPayload = await responseJson(await apiRequest(api, `/api/projects/${project.id}/renders`, {
    method: "POST",
    body: { kind: "draft" },
  }));
  const draft = await waitForRender(store, draftPayload.renderId, (item) => item.state === "ready");
  assert.match(draft.config.editPlanHash, /^[a-f0-9]{64}$/);
  store.updateProject(project.id, {
    product: {
      ...initialProduct,
      // Same total duration, different trim: duration equality alone must not
      // allow reuse of the old visual timeline.
      timelineClips: [{ id: "clip-a", assetName: "a.mp4", order: 0, trimStartMs: 1_000, trimEndMs: 5_000 }],
    },
  });
  const stale = await apiRequest(api, `/api/renders/${draft.id}/promote`, { method: "POST", body: {} });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "STALE_DRAFT");
});
