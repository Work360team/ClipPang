import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SqliteStore,
  StoreConflictError,
  StoreValidationError,
  createStore,
} from "../server/store/index.mjs";

function fixture(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "clip360-store-"));
  let now = 1_800_000_000_000;
  const options = { rootDir, now: () => now++ };
  const store = createStore(options);
  t.after(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });
  return { rootDir, store, options };
}

test("project.json is canonical and the SQLite index can be rebuilt", (t) => {
  const { rootDir, store, options } = fixture(t);
  const project = store.createProject({
    id: "2026-08-11-หัวชาร์จ",
    title: "หัวชาร์จพกพา",
    product: { price: 590, sellingPoints: ["เล็ก", "ชาร์จไว"] },
    wizardStep: 2,
    voiceSelection: { id: "th-female-1", speed: 1.05 },
  });

  assert.equal(project.id, "2026-08-11-หัวชาร์จ");
  assert.equal(store.listProjects()[0].product.price, 590);
  assert.ok(existsSync(path.join(rootDir, "projects", project.id, "src")));
  assert.ok(existsSync(path.join(rootDir, "projects", project.id, "voice")));
  assert.ok(existsSync(path.join(rootDir, "projects", project.id, "out")));

  const updated = store.updateProject(project.id, {
    expectedUpdatedAt: project.updatedAt,
    wizard_step: 4,
    product_json: JSON.stringify({ price: 490 }),
    selectedScript: "script-3",
  });
  assert.equal(updated.wizardStep, 4);
  assert.deepEqual(updated.product, { price: 490 });
  assert.deepEqual(updated.voiceSelection, { id: "th-female-1", speed: 1.05 });
  assert.ok(updated.updatedAt > project.updatedAt);
  assert.throws(
    () => store.updateProject(project.id, { expectedUpdatedAt: project.updatedAt, title: "snapshot เก่า" }),
    StoreConflictError,
  );
  assert.equal(store.getProject(project.id).title, "หัวชาร์จพกพา");

  const projectFile = path.join(rootDir, "projects", project.id, "project.json");
  const handEdited = JSON.parse(readFileSync(projectFile, "utf8"));
  handEdited.title = "ชื่อที่แก้ในไฟล์";
  handEdited.product = { price: 450, note: "disk wins" };
  handEdited.updatedAt += 10_000;
  writeFileSync(projectFile, `${JSON.stringify(handEdited, null, 2)}\n`);
  store.reconcileProjects();
  assert.equal(store.listProjects()[0].title, "ชื่อที่แก้ในไฟล์");
  assert.equal(store.listProjects()[0].product.note, "disk wins");

  store.close();
  rmSync(path.join(rootDir, "data", "clip360.db"), { force: true });
  rmSync(path.join(rootDir, "data", "clip360.db-wal"), { force: true });
  rmSync(path.join(rootDir, "data", "clip360.db-shm"), { force: true });
  const rebuilt = new SqliteStore(options).init();
  assert.equal(rebuilt.listProjects()[0].title, "ชื่อที่แก้ในไฟล์");
  assert.equal(rebuilt.getProject(project.id).selectedScript, "script-3");

  assert.throws(() => rebuilt.getProject("../.env"), StoreValidationError);
  assert.throws(
    () => rebuilt.createProject({ id: project.id, title: "ซ้ำ" }),
    StoreConflictError,
  );
  rebuilt.close();
});

test("render lifecycle persists parsed data and recovers interrupted work", (t) => {
  const { store, options } = fixture(t);
  const project = store.createProject({ id: "queue-test", title: "ทดสอบคิว" });
  const finalRender = store.createRender({
    id: "final-1",
    projectId: project.id,
    kind: "final",
    lane: "hyperframes",
    queuePosition: 1,
    styleId: "karaoke-pop",
    config: { subtitlePosition: "bottom" },
  });
  assert.deepEqual(finalRender.config, { subtitlePosition: "bottom" });
  assert.equal(finalRender.styleId, "karaoke-pop");

  const running = store.startRender(finalRender.id, {
    state: "ingesting",
    stage: "ingest",
    message: "กำลังนำเข้าคลิป",
  });
  assert.equal(running.attempts, 1);
  assert.ok(running.startedAt);
  const progressed = store.updateRenderProgress(finalRender.id, 42, {
    state: "voicing",
    stage: "voice",
    message: "กำลังพากย์ท่อนที่ 5 จาก 12",
    timeline_json: { chunks: [{ start: 0, end: 1200 }] },
    config_json: { subtitlePosition: "middle" },
  });
  assert.equal(progressed.progress, 42);
  assert.equal(progressed.timeline.chunks[0].end, 1200);
  assert.equal(progressed.config.subtitlePosition, "middle");

  const draftRender = store.createRender({
    id: "draft-1",
    projectId: project.id,
    kind: "draft",
    lane: "ass",
    queue_position: 20,
  });
  assert.deepEqual(
    store.listPendingRenders().map((render) => render.id),
    [draftRender.id, finalRender.id],
    "draft work is prioritized over final work",
  );

  store.close();
  const reopened = new SqliteStore(options).init();
  const recovered = reopened.recoverPendingRenders();
  assert.deepEqual(recovered.map((render) => render.id), [draftRender.id, finalRender.id]);
  assert.equal(reopened.getRender(finalRender.id).state, "queued");
  assert.equal(reopened.getRender(finalRender.id).progress, 0);
  assert.equal(reopened.getRender(finalRender.id).startedAt, null);
  assert.equal(reopened.getRender(finalRender.id).attempts, 1);

  const claimed = reopened.claimNextRender({ state: "rendering" });
  assert.equal(claimed.id, draftRender.id);
  assert.equal(claimed.attempts, 1);
  const ready = reopened.completeRender(claimed.id, {
    outputs: { video: "out/final.mp4" },
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.progress, 100);
  assert.deepEqual(ready.outputs, { video: "out/final.mp4" });

  reopened.startRender(finalRender.id, { state: "rendering" });
  const failed = reopened.failRender(finalRender.id, Object.assign(new Error("ffmpeg พัง"), {
    code: "FFMPEG_EXIT",
  }));
  assert.equal(failed.state, "failed");
  assert.equal(failed.error.code, "FFMPEG_EXIT");
  assert.equal(reopened.retryRender(finalRender.id).state, "queued");
  assert.equal(reopened.cancelRender(finalRender.id).state, "canceled");
  assert.equal(reopened.listProjectRenders(project.id).length, 2);
  assert.equal(reopened.getProjectRenders(project.id).length, 2);
  reopened.close();
});

test("settings and voice cache use parameterized persistent records", (t) => {
  const { store } = fixture(t);
  store.setSetting("ffmpeg.path", "C:\\Tools\\ffmpeg.exe");
  store.setSettings({ "setup.complete": "true", "app.version": "0.1.0" });
  assert.equal(store.getSetting("ffmpeg.path"), "C:\\Tools\\ffmpeg.exe");
  assert.equal(store.getSetting("missing", "fallback"), "fallback");
  assert.deepEqual(store.getSettings(), {
    "app.version": "0.1.0",
    "ffmpeg.path": "C:\\Tools\\ffmpeg.exe",
    "setup.complete": "true",
  });
  assert.equal(store.deleteSetting("app.version"), true);

  const key = "a".repeat(64);
  writeFileSync(store.voiceCachePath(key), "RIFF-test-wave");
  const cached = store.upsertVoiceCache({
    key,
    duration_ms: 1234,
    provider: "gemini",
    voice: "Kore",
  });
  assert.equal(cached.durationMs, 1234);
  assert.equal(cached.exists, true);
  assert.equal(store.getUsableVoiceCache(key).voice, "Kore");
  assert.equal(store.listVoiceCache({ provider: "gemini" }).length, 1);

  unlinkSync(store.voiceCachePath(key));
  assert.equal(store.getUsableVoiceCache(key), null, "a missing WAV is a cache miss");
  assert.equal(store.getVoiceCache(key), null, "the stale index row is pruned");

  const secondKey = "b".repeat(64);
  store.saveVoiceCache({ key: secondKey, durationMs: 99 });
  assert.equal(store.pruneVoiceCache(), 1);
  assert.equal(store.clearVoiceCache(), 0);

  const indexes = store.database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all()
    .map((row) => row.name);
  assert.ok(indexes.includes("renders_by_project"));
  assert.ok(indexes.includes("renders_pending"));
  store.optimize();
});

test("init imports project folders that predate the database", (t) => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "clip360-store-import-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const directory = path.join(rootDir, "projects", "manual-project");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "project.json"), JSON.stringify({
    title: "โปรเจกต์จากโฟลเดอร์",
    product: { name: "สินค้า" },
    wizardStep: 3,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T01:00:00.000Z",
  }));

  const store = createStore({ rootDir });
  const [project] = store.listProjects();
  assert.equal(project.id, "manual-project");
  assert.equal(project.title, "โปรเจกต์จากโฟลเดอร์");
  assert.deepEqual(project.product, { name: "สินค้า" });
  store.close();
});

test("user API keys are encrypted at rest and legacy plaintext rows upgrade themselves", (t) => {
  // ฐานข้อมูลอาจถูกก๊อปออกไปทั้งไฟล์ คีย์ของลูกค้าคนอื่นจึงต้องอ่านไม่ได้จากไฟล์นั้นอย่างเดียว
  const { rootDir, store, options } = fixture(t);
  const user = store.createUser({ username: "keyowner", passwordHash: "scrypt$a$b", role: "member" });
  const secret = "AIzaSyTESTKEY0123456789abcdef";
  store.addUserKey(user.id, secret);

  assert.equal(store.listUserKeys(user.id)[0].key, secret, "อ่านกลับมาต้องได้คีย์เดิม");

  const dbFile = readFileSync(path.join(rootDir, "data", "clip360.db")).toString("latin1");
  assert.ok(!dbFile.includes(secret), "คีย์ต้องไม่โผล่เป็น plaintext ในไฟล์ฐานข้อมูล");
  assert.ok(existsSync(path.join(rootDir, "data", "secret.key")), "กุญแจต้องอยู่คนละไฟล์กับฐานข้อมูล");

  // แถวเก่าที่บันทึกไว้ก่อนมีการเข้ารหัส ต้องยังใช้ได้และถูกอัปเกรดให้เอง
  const legacy = "AIzaSyLEGACY9876543210zyxwvu";
  void (store.raw?.() ?? null);
  const database = store.database ?? null;
  assert.ok(database, "ต้องเข้าถึง database ได้เพื่อจำลองแถวเก่า");
  database.prepare("INSERT INTO user_keys (user_id, slot, api_key, created_at) VALUES (?,?,?,?)")
    .run(user.id, 7, legacy, Date.now());
  const listed = store.listUserKeys(user.id).find((entry) => entry.slot === 7);
  assert.equal(listed.key, legacy, "คีย์เก่าต้องยังอ่านได้หลังอัปเดต");
  const stored = database.prepare("SELECT api_key FROM user_keys WHERE slot = 7").get().api_key;
  assert.ok(stored.startsWith("v1:"), "อ่านครั้งแรกแล้วต้องเขียนทับเป็นแบบเข้ารหัส");
  assert.ok(!stored.includes("LEGACY"), "ต้องไม่เหลือ plaintext ค้างไว้");
  assert.ok(options);
});
