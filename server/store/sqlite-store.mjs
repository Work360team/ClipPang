import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { decryptSecret, encryptSecret, isEncrypted } from "../secret-box.mjs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 4;

export const RENDER_KINDS = Object.freeze(["draft", "final"]);
export const RENDER_LANES = Object.freeze(["ass", "hyperframes"]);
export const PENDING_RENDER_STATES = Object.freeze([
  "queued",
  "retrying",
  "ingesting",
  "analyzing",
  "scripting",
  "voicing",
  "timing",
  "timeline",
  "captioning",
  "composing",
  "mixing",
  "packaging",
  "delivering",
  "processing",
  "rendering",
]);
export const TERMINAL_RENDER_STATES = Object.freeze([
  "ready",
  "failed",
  "canceled",
]);

const RENDER_STATES = new Set([
  ...PENDING_RENDER_STATES,
  ...TERMINAL_RENDER_STATES,
]);
const PENDING_STATE_PLACEHOLDERS = PENDING_RENDER_STATES.map(() => "?").join(", ");
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_PROJECT_ID = /[<>:"/\\|?*]/u;
const INVALID_PROJECT_ID_GLOBAL = /[<>:"/\\|?*]/gu;
const VOICE_CACHE_KEY = /^[a-f0-9]{64}$/iu;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'member',
    disabled       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    owner_id      TEXT,
    title         TEXT NOT NULL,
    product_json  TEXT NOT NULL,
    wizard_step   INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );


  CREATE TABLE IF NOT EXISTS renders (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,
    lane           TEXT NOT NULL,
    state          TEXT NOT NULL,
    progress       INTEGER NOT NULL DEFAULT 0,
    stage          TEXT,
    message        TEXT,
    queue_position INTEGER,
    style_id       TEXT,
    config_json    TEXT,
    timeline_json  TEXT,
    outputs_json   TEXT,
    error_json     TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    started_at     INTEGER,
    finished_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS projects_by_updated
    ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS renders_by_project
    ON renders(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS renders_by_created
    ON renders(created_at DESC);
  CREATE INDEX IF NOT EXISTS renders_pending
    ON renders(state, created_at);
  CREATE TABLE IF NOT EXISTS voice_cache (
    key          TEXT PRIMARY KEY,
    duration_ms  INTEGER NOT NULL,
    provider     TEXT,
    voice        TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS voice_cache_by_created
    ON voice_cache(created_at DESC);
  CREATE INDEX IF NOT EXISTS voice_cache_by_provider_voice
    ON voice_cache(provider, voice, created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
  );

  -- การตั้งค่าที่เป็นของแต่ละคน (โปรเจกต์ที่ปักหมุด เวลาที่อ่านแจ้งเตือนล่าสุด)
  -- แยกจาก settings เดิมที่เป็นค่าระดับเครื่อง เช่นผู้ให้บริการ AI ที่เลือกไว้
  -- คีย์ Gemini ของแต่ละคน โควตาของ Google ผูกกับคีย์ ไม่ใช่กับระบบเรา
  -- การแยกคีย์จึงเป็นวิธีเดียวที่ทำให้โควตาแยกกันจริง ไม่ใช่แค่จำกัดโดยพลการ
  CREATE TABLE IF NOT EXISTS user_keys (
    user_id     TEXT NOT NULL,
    slot        INTEGER NOT NULL,
    api_key     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, slot)
  );

  -- นับคำขอ TTS ที่แต่ละคนใช้ไปในแต่ละวัน เพื่อดูย้อนหลังและกันคนเดียวใช้จนหมด
  CREATE TABLE IF NOT EXISTS usage_daily (
    user_id   TEXT NOT NULL,
    day       TEXT NOT NULL,
    requests  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id  TEXT NOT NULL,
    key      TEXT NOT NULL,
    value    TEXT,
    PRIMARY KEY (user_id, key)
  );
`;

export class StoreError extends Error {
  constructor(message, { code = "STORE_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class StoreValidationError extends StoreError {
  constructor(message, options = {}) {
    super(message, { code: "STORE_VALIDATION", ...options });
  }
}

export class StoreNotFoundError extends StoreError {
  constructor(message, options = {}) {
    super(message, { code: "STORE_NOT_FOUND", ...options });
  }
}

export class StoreConflictError extends StoreError {
  constructor(message, options = {}) {
    super(message, { code: "STORE_CONFLICT", ...options });
  }
}

export class StoreCorruptionError extends StoreError {
  constructor(message, options = {}) {
    super(message, { code: "STORE_CORRUPT", ...options });
  }
}

/**
 * Create the Clip360 schema on an already-open node:sqlite DatabaseSync.
 * This is exported for diagnostics and focused migration tests; application
 * code should normally use SqliteStore#init instead.
 */
export function initializeSchema(database) {
  const version = Number(database.prepare("PRAGMA user_version").get().user_version);
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      `ฐานข้อมูล Clip360 รุ่น ${version} ใหม่กว่าโปรแกรมรุ่นนี้ (รองรับถึง ${SCHEMA_VERSION})`,
      { code: "STORE_SCHEMA_TOO_NEW" },
    );
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(SCHEMA_SQL);
    ensureRenderColumns(database);
    // ต้องมาก่อนสร้างดัชนีที่อ้าง owner_id — ฐานข้อมูลเดิมยังไม่มีคอลัมน์นี้ และ
    // CREATE TABLE IF NOT EXISTS ไม่เพิ่มคอลัมน์ให้ตารางที่มีอยู่แล้ว
    ensureProjectColumns(database);
    ensureUserColumns(database);
    database.exec(`
      CREATE INDEX IF NOT EXISTS projects_by_owner
        ON projects(owner_id, updated_at DESC)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS renders_pending_priority
        ON renders(state, kind, queue_position, created_at)
    `);
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original schema error.
    }
    throw error;
  }
}

/**
 * เพิ่มคอลัมน์ owner_id ให้ฐานข้อมูลที่สร้างไว้ก่อนรองรับหลายผู้ใช้
 * โปรเจกต์เก่าจะยังไม่มีเจ้าของ (NULL) จนกว่าจะมีบัญชีแรก แล้ว claimOrphanProjects
 * จะยกให้เจ้าของคนแรก — ทำตอนนั้นแทนที่จะเดาเจ้าของตั้งแต่ตอน migrate
 */
/** เพิ่มคอลัมน์เวลาที่เปลี่ยนรหัสล่าสุด ให้ฐานข้อมูลที่สร้างก่อนมีฟีเจอร์นี้ */
function ensureUserColumns(database) {
  const columns = new Set(
    database.prepare("PRAGMA table_info(users)").all().map((column) => column.name),
  );
  if (!columns.has("password_changed_at")) {
    database.exec("ALTER TABLE users ADD COLUMN password_changed_at INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureProjectColumns(database) {
  const columns = new Set(
    database.prepare("PRAGMA table_info(projects)").all().map((column) => column.name),
  );
  if (!columns.has("owner_id")) {
    database.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT");
  }
}

function ensureRenderColumns(database) {
  const columns = new Set(
    database.prepare("PRAGMA table_info(renders)").all().map((column) => column.name),
  );
  const additions = [
    ["stage", "TEXT"],
    ["message", "TEXT"],
    ["queue_position", "INTEGER"],
    ["style_id", "TEXT"],
    ["config_json", "TEXT"],
  ];
  for (const [name, type] of additions) {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE renders ADD COLUMN ${name} ${type}`);
    }
  }
}

export class SqliteStore {
  constructor({
    rootDir = process.cwd(),
    dataDir = path.join(rootDir, "data"),
    projectsDir = path.join(rootDir, "projects"),
    cacheDir = path.join(dataDir, "cache", "tts"),
    dbPath = path.join(dataDir, "clip360.db"),
    now = Date.now,
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.dataDir = path.resolve(dataDir);
    this.projectsDir = path.resolve(projectsDir);
    this.cacheDir = path.resolve(cacheDir);
    this.dbPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
    this.now = now;
    this.database = null;
    this.lastReconciliation = null;
  }

  init({ reconcile = true } = {}) {
    if (this.database) return this;

    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.projectsDir, { recursive: true });
    mkdirSync(this.cacheDir, { recursive: true });
    if (this.dbPath !== ":memory:") {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    const database = new DatabaseSync(this.dbPath);
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA busy_timeout = 5000");
      database.exec("PRAGMA synchronous = NORMAL");
      database.exec("PRAGMA temp_store = MEMORY");
      database.exec("PRAGMA trusted_schema = OFF");
      if (this.dbPath !== ":memory:") database.exec("PRAGMA journal_mode = WAL");
      initializeSchema(database);
      database.exec("PRAGMA optimize = 0x10002");
      this.database = database;
      if (reconcile) this.lastReconciliation = this.reconcileProjects();
      return this;
    } catch (error) {
      try {
        database.close();
      } catch {
        // Preserve the initialization error.
      }
      this.database = null;
      throw error;
    }
  }

  optimize() {
    this.#db().exec("PRAGMA optimize");
    return this;
  }

  close() {
    if (!this.database) return;
    try {
      this.database.exec("PRAGMA optimize");
    } finally {
      this.database.close();
      this.database = null;
    }
  }

  reconcileProjects() {
    const database = this.#db();
    mkdirSync(this.projectsDir, { recursive: true });
    const documents = [];
    const presentIds = new Set();
    const skipped = [];

    for (const entry of readdirSync(this.projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const id = entry.name;
      try {
        assertProjectId(id);
        const filename = this.projectFile(id);
        if (!existsSync(filename)) continue;
        presentIds.add(id);
        documents.push(this.#readProjectFile(id));
      } catch (error) {
        presentIds.add(id);
        skipped.push({ id, error: toErrorInfo(error) });
      }
    }

    let removed = 0;
    this.#transaction(() => {
      const upsert = database.prepare(`
        INSERT INTO projects (id, owner_id, title, product_json, wizard_step, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_id = excluded.owner_id,
          title = excluded.title,
          product_json = excluded.product_json,
          wizard_step = excluded.wizard_step,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `);
      for (const document of documents) {
        const row = projectDocumentToRow(document);
        upsert.run(...row);
      }

      const remove = database.prepare("DELETE FROM projects WHERE id = ?");
      for (const row of database.prepare("SELECT id FROM projects").all()) {
        if (!presentIds.has(row.id)) removed += Number(remove.run(row.id).changes);
      }
    });

    const result = {
      indexed: documents.length,
      removed,
      skipped,
      reconciledAt: this.#timestamp(),
    };
    this.lastReconciliation = result;
    return result;
  }

  /**
   * @param {{limit?: number, offset?: number, refresh?: boolean, ownerId?: string|null}} options
   *   ownerId ที่เป็น undefined = ไม่กรอง (เครื่องมือดูแลระบบ) ส่วนสตริง = เห็นเฉพาะของคนนั้น
   *   ระวัง: อย่าปล่อยให้ค่า undefined หลุดมาจาก request ของผู้ใช้ ไม่งั้นจะเห็นงานคนอื่น
   */
  listProjects({ limit = 100, offset = 0, refresh = false, ownerId } = {}) {
    assertPage(limit, offset);
    if (refresh) this.reconcileProjects();
    const scoped = ownerId !== undefined;
    return this.#db()
      .prepare(`
        SELECT id, owner_id, title, product_json, wizard_step, created_at, updated_at
        FROM projects
        ${scoped ? "WHERE owner_id IS ?" : ""}
        ORDER BY updated_at DESC, id ASC
        LIMIT ? OFFSET ?
      `)
      .all(...(scoped ? [ownerId ?? null, limit, offset] : [limit, offset]))
      .map(mapProjectRow);
  }

  getProject(id) {
    assertProjectId(id);
    const directory = this.projectDir(id);
    if (!existsSync(directory) || !existsSync(this.projectFile(id))) {
      this.#db().prepare("DELETE FROM projects WHERE id = ?").run(id);
      return null;
    }
    if (lstatSync(directory).isSymbolicLink() || lstatSync(this.projectFile(id)).isSymbolicLink()) {
      throw new StoreValidationError(`โปรเจกต์ “${id}” ใช้ symbolic link ซึ่งไม่อนุญาต`);
    }
    const document = this.#readProjectFile(id);
    this.#upsertProjectIndex(document);
    return document;
  }

  createProject(input = {}) {
    const source = cloneJsonObject(input, "project");
    const title = normalizeTitle(source.title);
    const createdAt = normalizeTimestamp(source.createdAt ?? source.created_at, this.#timestamp());
    const requestedId = source.id;
    const id = requestedId == null
      ? this.#availableProjectId(title, createdAt)
      : assertProjectId(String(requestedId));
    if (this.#projectExists(id)) {
      throw new StoreConflictError(`มีโปรเจกต์รหัส “${id}” อยู่แล้ว`);
    }

    const updatedAt = normalizeTimestamp(source.updatedAt ?? source.updated_at, createdAt);
    const product = normalizeProduct(source.product ?? source.product_json ?? {});
    const wizardStep = normalizeWizardStep(source.wizardStep ?? source.wizard_step ?? 1);
    delete source.created_at;
    delete source.updated_at;
    delete source.product_json;
    delete source.wizard_step;
    const document = {
      ...source,
      id,
      // เก็บเจ้าของไว้ในไฟล์ด้วย ไม่ใช่แค่ใน index — reconcileProjects สร้าง index
      // ใหม่จากไฟล์ ถ้าเจ้าของอยู่แค่ในฐานข้อมูล ข้อมูลนี้จะหายทุกครั้งที่ซ่อมดัชนี
      ownerId: source.ownerId ?? source.owner_id ?? null,
      title,
      product,
      wizardStep,
      createdAt,
      updatedAt,
    };

    const directory = this.projectDir(id);
    mkdirSync(directory);
    try {
      mkdirSync(path.join(directory, "src"));
      mkdirSync(path.join(directory, "voice"));
      mkdirSync(path.join(directory, "out"));
      writeJsonAtomic(this.projectFile(id), document);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }

    // The file is deliberately written first. If SQLite fails, the next
    // reconciliation can rebuild this index row from project.json.
    this.#upsertProjectIndex(document);
    return document;
  }

  updateProject(id, patch = {}) {
    assertProjectId(id);
    const changes = cloneJsonObject(patch, "project patch");
    if (Object.hasOwn(changes, "id") && changes.id !== id) {
      throw new StoreValidationError("ไม่สามารถเปลี่ยนรหัสโปรเจกต์ได้");
    }
    const current = this.getProject(id);
    if (!current) throw new StoreNotFoundError(`ไม่พบโปรเจกต์ “${id}”`);

    delete changes.id;
    delete changes.createdAt;
    delete changes.created_at;
    if (Object.hasOwn(changes, "title")) changes.title = normalizeTitle(changes.title);
    if (Object.hasOwn(changes, "product_json") && !Object.hasOwn(changes, "product")) {
      changes.product = normalizeProduct(changes.product_json);
    }
    if (Object.hasOwn(changes, "wizard_step") && !Object.hasOwn(changes, "wizardStep")) {
      changes.wizardStep = normalizeWizardStep(changes.wizard_step);
    }
    delete changes.product_json;
    delete changes.wizard_step;
    if (Object.hasOwn(changes, "product")) changes.product = normalizeProduct(changes.product);
    if (Object.hasOwn(changes, "wizardStep")) {
      changes.wizardStep = normalizeWizardStep(changes.wizardStep);
    }

    const document = {
      ...current,
      ...changes,
      id,
      title: changes.title ?? current.title,
      product: Object.hasOwn(changes, "product") ? changes.product : current.product,
      wizardStep: Object.hasOwn(changes, "wizardStep")
        ? changes.wizardStep
        : current.wizardStep,
      createdAt: current.createdAt,
      updatedAt: this.#timestamp(),
    };
    writeJsonAtomic(this.projectFile(id), document);
    this.#upsertProjectIndex(document);
    return document;
  }

  deleteProject(id) {
    assertProjectId(id);
    const directory = this.projectDir(id);
    const existed = existsSync(directory);
    if (existed) rmSync(directory, { recursive: true, force: false });
    const result = this.#db().prepare("DELETE FROM projects WHERE id = ?").run(id);
    return existed || Number(result.changes) > 0;
  }

  projectDir(id) {
    assertProjectId(id);
    return resolveChild(this.projectsDir, id);
  }

  projectFile(id) {
    return path.join(this.projectDir(id), "project.json");
  }

  createRender(input = {}) {
    const source = cloneJsonObject(input, "render");
    const projectId = String(source.projectId ?? source.project_id ?? "");
    assertProjectId(projectId);
    if (!this.getProject(projectId)) {
      throw new StoreNotFoundError(`ไม่พบโปรเจกต์ “${projectId}”`);
    }
    const kind = normalizeChoice(source.kind ?? "draft", RENDER_KINDS, "render kind");
    const lane = normalizeChoice(
      source.lane ?? (kind === "draft" ? "ass" : "hyperframes"),
      RENDER_LANES,
      "render lane",
    );
    const state = normalizeRenderState(source.state ?? "queued");
    const id = normalizeRenderId(source.id ?? `render-${this.#timestamp()}-${randomUUID().slice(0, 8)}`);
    if (this.getRender(id)) throw new StoreConflictError(`มีงานเรนเดอร์รหัส “${id}” อยู่แล้ว`);
    const progress = normalizeProgress(source.progress ?? 0);
    const attempts = normalizeNonNegativeInteger(source.attempts ?? 0, "attempts");
    const createdAt = normalizeTimestamp(source.createdAt ?? source.created_at, this.#timestamp());
    const startedAt = nullableTimestamp(source.startedAt ?? source.started_at);
    const finishedAt = nullableTimestamp(source.finishedAt ?? source.finished_at);

    this.#db().prepare(`
      INSERT INTO renders (
        id, project_id, kind, lane, state, progress, stage, message,
        queue_position, style_id, config_json, timeline_json, outputs_json,
        error_json, attempts, created_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      kind,
      lane,
      state,
      progress,
      nullableString(source.stage),
      nullableString(source.message),
      nullableInteger(source.queuePosition ?? source.queue_position, "queuePosition"),
      nullableString(source.styleId ?? source.style_id),
      encodeNullableJson(source.config ?? source.config_json),
      encodeNullableJson(source.timeline ?? source.timeline_json),
      encodeNullableJson(source.outputs ?? source.outputs_json),
      encodeNullableJson(source.error ?? source.error_json),
      attempts,
      createdAt,
      startedAt,
      finishedAt,
    );
    return this.getRender(id);
  }

  getRender(id) {
    id = normalizeRenderId(id);
    const row = this.#db().prepare("SELECT * FROM renders WHERE id = ?").get(id);
    return row ? mapRenderRow(row) : null;
  }

  listRenders({
    projectId,
    state,
    states,
    kind,
    limit = 100,
    offset = 0,
    ascending = false,
  } = {}) {
    assertPage(limit, offset);
    const where = [];
    const params = [];
    if (projectId != null) {
      assertProjectId(projectId);
      where.push("project_id = ?");
      params.push(projectId);
    }
    if (kind != null) {
      where.push("kind = ?");
      params.push(normalizeChoice(kind, RENDER_KINDS, "render kind"));
    }
    const requestedStates = states ?? (state == null ? null : [state]);
    if (requestedStates != null) {
      if (!Array.isArray(requestedStates) || requestedStates.length === 0) {
        throw new StoreValidationError("states ต้องเป็นรายการที่ไม่ว่าง");
      }
      const normalizedStates = requestedStates.map(normalizeRenderState);
      where.push(`state IN (${normalizedStates.map(() => "?").join(", ")})`);
      params.push(...normalizedStates);
    }
    params.push(limit, offset);
    const sql = `
      SELECT * FROM renders
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at ${ascending ? "ASC" : "DESC"}, id ASC
      LIMIT ? OFFSET ?
    `;
    return this.#db().prepare(sql).all(...params).map(mapRenderRow);
  }

  listProjectRenders(projectId, options = {}) {
    return this.listRenders({ ...options, projectId });
  }

  getProjectRenders(projectId, options = {}) {
    return this.listProjectRenders(projectId, options);
  }

  updateRender(id, patch = {}) {
    id = normalizeRenderId(id);
    const changes = cloneJsonObject(patch, "render patch");
    if (!this.getRender(id)) throw new StoreNotFoundError(`ไม่พบงานเรนเดอร์ “${id}”`);
    const assignments = [];
    const params = [];
    const add = (column, value) => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (hasEither(changes, "projectId", "project_id")) {
      const projectId = changes.projectId ?? changes.project_id;
      assertProjectId(projectId);
      if (!this.getProject(projectId)) {
        throw new StoreNotFoundError(`ไม่พบโปรเจกต์ “${projectId}”`);
      }
      add("project_id", projectId);
    }
    if (Object.hasOwn(changes, "kind")) {
      add("kind", normalizeChoice(changes.kind, RENDER_KINDS, "render kind"));
    }
    if (Object.hasOwn(changes, "lane")) {
      add("lane", normalizeChoice(changes.lane, RENDER_LANES, "render lane"));
    }
    let nextState;
    if (Object.hasOwn(changes, "state")) {
      nextState = normalizeRenderState(changes.state);
      add("state", nextState);
    }
    if (Object.hasOwn(changes, "progress")) add("progress", normalizeProgress(changes.progress));
    if (Object.hasOwn(changes, "stage")) add("stage", nullableString(changes.stage));
    if (Object.hasOwn(changes, "message")) add("message", nullableString(changes.message));
    if (hasEither(changes, "queuePosition", "queue_position")) {
      add(
        "queue_position",
        nullableInteger(changes.queuePosition ?? changes.queue_position, "queuePosition"),
      );
    }
    if (hasEither(changes, "styleId", "style_id")) {
      add("style_id", nullableString(changes.styleId ?? changes.style_id));
    }
    addJsonChange(changes, "config", "config_json", add);
    addJsonChange(changes, "timeline", "timeline_json", add);
    addJsonChange(changes, "outputs", "outputs_json", add);
    addJsonChange(changes, "error", "error_json", add);
    if (Object.hasOwn(changes, "attempts")) {
      add("attempts", normalizeNonNegativeInteger(changes.attempts, "attempts"));
    }
    if (hasEither(changes, "startedAt", "started_at")) {
      add("started_at", nullableTimestamp(changes.startedAt ?? changes.started_at));
    }
    if (hasEither(changes, "finishedAt", "finished_at")) {
      add("finished_at", nullableTimestamp(changes.finishedAt ?? changes.finished_at));
    } else if (nextState && TERMINAL_RENDER_STATES.includes(nextState)) {
      add("finished_at", this.#timestamp());
    }
    if (assignments.length === 0) return this.getRender(id);
    params.push(id);
    this.#db().prepare(`UPDATE renders SET ${assignments.join(", ")} WHERE id = ?`).run(...params);
    return this.getRender(id);
  }

  saveRender(render) {
    const id = render?.id;
    return id && this.getRender(id) ? this.updateRender(id, render) : this.createRender(render);
  }

  startRender(id, { state = "ingesting", stage = null, message = null } = {}) {
    id = normalizeRenderId(id);
    state = normalizeRenderState(state);
    if (TERMINAL_RENDER_STATES.includes(state) || state === "queued") {
      throw new StoreValidationError("สถานะเริ่มงานต้องเป็นสถานะที่กำลังประมวลผล");
    }
    const result = this.#db().prepare(`
      UPDATE renders
      SET state = ?, stage = ?, message = ?, attempts = attempts + 1,
          started_at = ?, finished_at = NULL
      WHERE id = ? AND state IN ('queued', 'retrying')
    `).run(state, nullableString(stage), nullableString(message), this.#timestamp(), id);
    if (Number(result.changes) === 0) this.#throwRenderTransition(id, "เริ่มงาน");
    return this.getRender(id);
  }

  markRenderStarted(id, options) {
    return this.startRender(id, options);
  }

  updateRenderProgress(id, progress, details = {}) {
    return this.updateRender(id, { ...details, progress });
  }

  completeRender(id, { outputs = null, timeline, message = null } = {}) {
    const patch = {
      state: "ready",
      progress: 100,
      stage: "ready",
      message,
      outputs,
      error: null,
      finishedAt: this.#timestamp(),
    };
    if (timeline !== undefined) patch.timeline = timeline;
    return this.updateRender(id, patch);
  }

  markRenderReady(id, options) {
    return this.completeRender(id, options);
  }

  failRender(id, error, { message, stage = "failed" } = {}) {
    const errorInfo = toErrorInfo(error);
    return this.updateRender(id, {
      state: "failed",
      stage,
      message: message ?? errorInfo.message,
      error: errorInfo,
      finishedAt: this.#timestamp(),
    });
  }

  markRenderFailed(id, error, options) {
    return this.failRender(id, error, options);
  }

  cancelRender(id, { message = "ยกเลิกงานแล้ว" } = {}) {
    id = normalizeRenderId(id);
    const result = this.#db().prepare(`
      UPDATE renders
      SET state = 'canceled', stage = 'canceled', message = ?, finished_at = ?
      WHERE id = ? AND state IN (${PENDING_STATE_PLACEHOLDERS})
    `).run(message, this.#timestamp(), id, ...PENDING_RENDER_STATES);
    if (Number(result.changes) === 0) this.#throwRenderTransition(id, "ยกเลิกงาน");
    return this.getRender(id);
  }

  retryRender(id, { message = null, queuePosition = null } = {}) {
    id = normalizeRenderId(id);
    const result = this.#db().prepare(`
      UPDATE renders
      SET state = 'queued', progress = 0, stage = NULL, message = ?,
          queue_position = ?, error_json = NULL, started_at = NULL, finished_at = NULL
      WHERE id = ? AND state IN ('failed', 'canceled')
    `).run(nullableString(message), nullableInteger(queuePosition, "queuePosition"), id);
    if (Number(result.changes) === 0) this.#throwRenderTransition(id, "นำงานกลับเข้าคิว");
    return this.getRender(id);
  }

  listPendingRenders({ projectId, limit = 1000 } = {}) {
    assertPage(limit, 0);
    const where = [`state IN (${PENDING_STATE_PLACEHOLDERS})`];
    const params = [...PENDING_RENDER_STATES];
    if (projectId != null) {
      assertProjectId(projectId);
      where.push("project_id = ?");
      params.push(projectId);
    }
    params.push(limit);
    return this.#db().prepare(`
      SELECT * FROM renders
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE kind WHEN 'draft' THEN 0 ELSE 1 END,
        CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END,
        queue_position ASC,
        created_at ASC,
        id ASC
      LIMIT ?
    `).all(...params).map(mapRenderRow);
  }

  recoverPendingRenders({ message = "กู้งานกลับเข้าคิวหลังเปิดโปรแกรมใหม่" } = {}) {
    const database = this.#db();
    this.#transaction(() => {
      database.prepare(`
        UPDATE renders
        SET state = 'queued', progress = 0, stage = NULL, message = ?, started_at = NULL,
            finished_at = NULL
        WHERE state IN (${PENDING_STATE_PLACEHOLDERS}) AND state <> 'queued'
      `).run(nullableString(message), ...PENDING_RENDER_STATES);
    });
    return this.listPendingRenders();
  }

  claimNextRender({ state = "ingesting", lane } = {}) {
    state = normalizeRenderState(state);
    if (TERMINAL_RENDER_STATES.includes(state) || state === "queued") {
      throw new StoreValidationError("สถานะ claim ต้องเป็นสถานะที่กำลังประมวลผล");
    }
    if (lane != null) lane = normalizeChoice(lane, RENDER_LANES, "render lane");
    let claimedId = null;
    this.#transaction(() => {
      const row = this.#db().prepare(`
        SELECT id FROM renders
        WHERE state = 'queued' ${lane == null ? "" : "AND lane = ?"}
        ORDER BY
          CASE kind WHEN 'draft' THEN 0 ELSE 1 END,
          CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END,
          queue_position ASC,
          created_at ASC,
          id ASC
        LIMIT 1
      `).get(...(lane == null ? [] : [lane]));
      if (!row) return;
      const result = this.#db().prepare(`
        UPDATE renders
        SET state = ?, attempts = attempts + 1, started_at = ?, finished_at = NULL
        WHERE id = ? AND state = 'queued'
      `).run(state, this.#timestamp(), row.id);
      if (Number(result.changes) === 1) claimedId = row.id;
    });
    return claimedId ? this.getRender(claimedId) : null;
  }

  getSetting(key, fallback = null) {
    key = normalizeSettingKey(key);
    const row = this.#db().prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : fallback;
  }


  /* ---------- ผู้ใช้ ---------- */

  /**
   * ผู้ใช้ทั้งหมด เรียงตามเวลาที่สร้าง — คนแรกคือเจ้าของเครื่องเสมอ
   * คืน password_hash มาด้วยเพราะชั้นตรวจรหัสต้องใช้ ห้ามส่งต่อออก API
   */
  /* ---------- คีย์ Gemini รายคน ---------- */

  listUserKeys(userId) {
    const owner = String(userId ?? "");
    const rows = this.#db()
      .prepare("SELECT slot, api_key, created_at FROM user_keys WHERE user_id = ? ORDER BY slot ASC")
      .all(owner);
    return rows.map((row) => {
      // แถวที่บันทึกไว้ก่อนมีการเข้ารหัส ให้เขียนทับเป็นแบบเข้ารหัสตอนอ่านครั้งแรก
      // ผู้ใช้เดิมจึงไม่ต้องมาใส่คีย์ใหม่ และไม่มี plaintext ค้างอยู่ในฐานข้อมูล
      if (!isEncrypted(row.api_key)) {
        try {
          this.#db().prepare("UPDATE user_keys SET api_key = ? WHERE user_id = ? AND slot = ?")
            .run(encryptSecret(row.api_key, this.dataDir), owner, row.slot);
        } catch { /* อัปเกรดไม่ได้ก็ยังใช้คีย์เดิมได้ */ }
        return { slot: Number(row.slot), key: row.api_key, createdAt: Number(row.created_at) };
      }
      return { slot: Number(row.slot), key: decryptSecret(row.api_key, this.dataDir), createdAt: Number(row.created_at) };
    });
  }

  addUserKey(userId, apiKey, { maxKeys = 9 } = {}) {
    const owner = String(userId ?? "");
    if (!owner) throw new StoreValidationError("ต้องระบุผู้ใช้");
    const key = String(apiKey ?? "").trim();
    if (key.length < 16) throw new StoreValidationError("API key ดูไม่ครบ");
    const existing = this.listUserKeys(owner);
    if (existing.some((entry) => entry.key === key)) {
      throw new StoreConflictError("คีย์นี้ใส่ไว้แล้ว — คีย์ซ้ำไม่ได้เพิ่มโควตา");
    }
    if (existing.length >= maxKeys) throw new StoreConflictError(`ใส่คีย์ได้สูงสุด ${maxKeys} ใบ`);
    const used = new Set(existing.map((entry) => entry.slot));
    let slot = 1;
    while (used.has(slot)) slot += 1;
    this.#db().prepare("INSERT INTO user_keys (user_id, slot, api_key, created_at) VALUES (?, ?, ?, ?)")
      .run(owner, slot, encryptSecret(key, this.dataDir), this.#timestamp());
    return { slot, key, createdAt: this.#timestamp() };
  }

  removeUserKey(userId, slot) {
    return Number(this.#db().prepare("DELETE FROM user_keys WHERE user_id = ? AND slot = ?")
      .run(String(userId ?? ""), Number(slot)).changes) > 0;
  }

  /* ---------- การใช้งานรายวัน ---------- */

  /** วันตามเขตเวลาแปซิฟิก ให้ตรงกับรอบรีเซ็ตโควตาของ Google ไม่ใช่เที่ยงคืนบ้านเรา */
  static usageDay(now = Date.now()) {
    return new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  }

  recordUsage(userId, amount = 1, now = Date.now()) {
    const owner = String(userId ?? "");
    if (!owner) return 0;
    const day = SqliteStore.usageDay(now);
    this.#db().prepare(`
      INSERT INTO usage_daily (user_id, day, requests) VALUES (?, ?, ?)
      ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + excluded.requests
    `).run(owner, day, Number(amount) || 0);
    return this.usageToday(owner, now);
  }

  usageToday(userId, now = Date.now()) {
    const row = this.#db().prepare("SELECT requests FROM usage_daily WHERE user_id = ? AND day = ?")
      .get(String(userId ?? ""), SqliteStore.usageDay(now));
    return row ? Number(row.requests) : 0;
  }

  usageHistory(userId, days = 7) {
    return this.#db()
      .prepare("SELECT day, requests FROM usage_daily WHERE user_id = ? ORDER BY day DESC LIMIT ?")
      .all(String(userId ?? ""), Number(days))
      .map((row) => ({ day: row.day, requests: Number(row.requests) }));
  }

  listUsers() {
    return this.#db()
      .prepare("SELECT * FROM users ORDER BY created_at ASC, id ASC")
      .all()
      .map(mapUserRow);
  }

  getUserByUsername(username) {
    const row = this.#db().prepare("SELECT * FROM users WHERE username = ?").get(String(username ?? "").trim());
    return row ? mapUserRow(row) : null;
  }

  getUser(id) {
    const row = this.#db().prepare("SELECT * FROM users WHERE id = ?").get(String(id ?? ""));
    return row ? mapUserRow(row) : null;
  }

  createUser({ username, passwordHash, role = "member" } = {}) {
    const name = String(username ?? "").trim();
    if (name.length < 2) throw new StoreValidationError("ชื่อผู้ใช้ต้องยาวอย่างน้อย 2 ตัวอักษร");
    if (!/^[\w.@-]+$/u.test(name)) throw new StoreValidationError("ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษร ตัวเลข . _ - @");
    if (!String(passwordHash ?? "").startsWith("scrypt$")) {
      throw new StoreValidationError("ต้องส่งรหัสผ่านที่ผ่านการ hash แล้วเท่านั้น");
    }
    if (this.getUserByUsername(name)) throw new StoreConflictError(`มีผู้ใช้ชื่อ “${name}” อยู่แล้ว`);
    const id = `u-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    this.#db().prepare(`
      INSERT INTO users (id, username, password_hash, role, disabled, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, name, passwordHash, role === "owner" ? "owner" : "member", this.#timestamp());
    return this.getUser(id);
  }

  updateUser(id, patch = {}) {
    const user = this.getUser(id);
    if (!user) throw new StoreNotFoundError(`ไม่พบผู้ใช้ “${id}”`);
    const passwordHash = patch.passwordHash ?? user.passwordHash;
    const disabled = patch.disabled == null ? user.disabled : Boolean(patch.disabled);
    const role = patch.role ?? user.role;
    // เปลี่ยนรหัส = เซสชันที่ออกก่อนหน้านี้ต้องใช้ไม่ได้ ไม่งั้นคนที่ขโมยเครื่องไป
    // ยังใช้ต่อได้ทั้งที่เจ้าของเพิ่งเปลี่ยนรหัสหนีอยู่
    const changedAt = passwordHash !== user.passwordHash ? this.#timestamp() : user.passwordChangedAt;
    this.#db().prepare("UPDATE users SET password_hash = ?, disabled = ?, role = ?, password_changed_at = ? WHERE id = ?")
      .run(passwordHash, disabled ? 1 : 0, role, changedAt, id);
    return this.getUser(id);
  }

  deleteUser(id) {
    // โปรเจกต์ไม่ถูกลบตาม — ยกให้ไม่มีเจ้าของไว้ก่อน ปลอดภัยกว่าลบงานของคนอื่นทิ้ง
    this.#db().prepare("UPDATE projects SET owner_id = NULL WHERE owner_id = ?").run(id);
    this.#db().prepare("DELETE FROM user_settings WHERE user_id = ?").run(id);
    return Number(this.#db().prepare("DELETE FROM users WHERE id = ?").run(id).changes) > 0;
  }

  /**
   * ยกโปรเจกต์ที่ยังไม่มีเจ้าของให้ผู้ใช้คนหนึ่ง — ใช้ตอนอัปเกรดจากรุ่นผู้ใช้เดียว
   * ต้องเขียนลง project.json ด้วย เพราะ reconcileProjects สร้าง index ใหม่จากไฟล์
   * ถ้าแก้แค่ในฐานข้อมูล เจ้าของจะหลุดกลับเป็นว่างทันทีที่มีการซ่อมดัชนีครั้งถัดไป
   */
  claimOrphanProjects(ownerId) {
    if (!this.getUser(ownerId)) throw new StoreNotFoundError(`ไม่พบผู้ใช้ “${ownerId}”`);
    const orphans = this.#db().prepare("SELECT id FROM projects WHERE owner_id IS NULL").all();
    let claimed = 0;
    for (const row of orphans) {
      if (this.setProjectOwner(row.id, ownerId)) claimed += 1;
    }
    return claimed;
  }

  /** เจ้าของโปรเจกต์ตาม index — ใช้ตรวจสิทธิ์ก่อนอ่านไฟล์จริง */
  projectOwner(projectId) {
    const row = this.#db().prepare("SELECT owner_id FROM projects WHERE id = ?").get(String(projectId ?? ""));
    return row ? row.owner_id ?? null : null;
  }

  /** เปลี่ยนเจ้าของทั้งในไฟล์และในดัชนี ให้ทั้งสองที่ตรงกันเสมอ */
  setProjectOwner(projectId, ownerId) {
    const document = this.getProject(projectId);
    if (!document) return false;
    const next = { ...document, ownerId: ownerId ?? null };
    writeJsonAtomic(this.projectFile(document.id), next);
    this.#upsertProjectIndex(next);
    return true;
  }

  /* ---------- การตั้งค่าเฉพาะคน ---------- */

  getUserSettings(userId) {
    return Object.fromEntries(
      this.#db().prepare("SELECT key, value FROM user_settings WHERE user_id = ? ORDER BY key ASC")
        .all(String(userId ?? "")).map((row) => [row.key, row.value]),
    );
  }

  setUserSetting(userId, key, value) {
    const owner = String(userId ?? "");
    if (!owner) throw new StoreValidationError("ต้องระบุผู้ใช้");
    key = normalizeSettingKey(key);
    if (value != null && typeof value !== "string") {
      throw new StoreValidationError("ค่าการตั้งค่าต้องเป็นข้อความหรือ null");
    }
    this.#db().prepare(`
      INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `).run(owner, key, value);
    return value;
  }

  getSettings() {
    return Object.fromEntries(
      this.#db().prepare("SELECT key, value FROM settings ORDER BY key ASC").all()
        .map((row) => [row.key, row.value]),
    );
  }

  setSetting(key, value) {
    key = normalizeSettingKey(key);
    if (value != null && typeof value !== "string") {
      throw new StoreValidationError("ค่าการตั้งค่าต้องเป็นข้อความหรือ null");
    }
    this.#db().prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    return value;
  }

  saveSetting(key, value) {
    return this.setSetting(key, value);
  }

  setSettings(values) {
    const entries = Object.entries(cloneJsonObject(values, "settings"));
    this.#transaction(() => {
      for (const [key, value] of entries) this.setSetting(key, value);
    });
    return this.getSettings();
  }

  deleteSetting(key) {
    key = normalizeSettingKey(key);
    return Number(this.#db().prepare("DELETE FROM settings WHERE key = ?").run(key).changes) > 0;
  }

  getVoiceCache(key, { verifyFile = false } = {}) {
    key = normalizeVoiceCacheKey(key);
    const row = this.#db().prepare("SELECT * FROM voice_cache WHERE key = ?").get(key);
    if (!row) return null;
    const result = mapVoiceCacheRow(row, this.cacheDir);
    if (verifyFile && !result.exists) {
      this.#db().prepare("DELETE FROM voice_cache WHERE key = ?").run(key);
      return null;
    }
    return result;
  }

  getUsableVoiceCache(key) {
    return this.getVoiceCache(key, { verifyFile: true });
  }

  upsertVoiceCache(input) {
    const source = cloneJsonObject(input, "voice cache");
    const key = normalizeVoiceCacheKey(source.key);
    const durationMs = normalizeNonNegativeInteger(
      source.durationMs ?? source.duration_ms,
      "durationMs",
    );
    const createdAt = normalizeTimestamp(source.createdAt ?? source.created_at, this.#timestamp());
    this.#db().prepare(`
      INSERT INTO voice_cache (key, duration_ms, provider, voice, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        duration_ms = excluded.duration_ms,
        provider = excluded.provider,
        voice = excluded.voice,
        created_at = excluded.created_at
    `).run(
      key,
      durationMs,
      nullableString(source.provider),
      nullableString(source.voice),
      createdAt,
    );
    return this.getVoiceCache(key);
  }

  saveVoiceCache(input) {
    return this.upsertVoiceCache(input);
  }

  listVoiceCache({ provider, voice, limit = 1000, offset = 0 } = {}) {
    assertPage(limit, offset);
    const where = [];
    const params = [];
    if (provider != null) {
      where.push("provider = ?");
      params.push(String(provider));
    }
    if (voice != null) {
      where.push("voice = ?");
      params.push(String(voice));
    }
    params.push(limit, offset);
    return this.#db().prepare(`
      SELECT * FROM voice_cache
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, key ASC
      LIMIT ? OFFSET ?
    `).all(...params).map((row) => mapVoiceCacheRow(row, this.cacheDir));
  }

  deleteVoiceCache(key, { removeFile = false } = {}) {
    key = normalizeVoiceCacheKey(key);
    if (removeFile) {
      const filename = this.voiceCachePath(key);
      if (existsSync(filename)) unlinkSync(filename);
    }
    return Number(
      this.#db().prepare("DELETE FROM voice_cache WHERE key = ?").run(key).changes,
    ) > 0;
  }

  clearVoiceCache({ removeFiles = false } = {}) {
    if (removeFiles) {
      for (const entry of readdirSync(this.cacheDir, { withFileTypes: true })) {
        if (entry.isFile() && /^[a-f0-9]{64}\.wav$/iu.test(entry.name)) {
          unlinkSync(path.join(this.cacheDir, entry.name));
        }
      }
    }
    return Number(this.#db().prepare("DELETE FROM voice_cache").run().changes);
  }

  pruneVoiceCache() {
    let removed = 0;
    this.#transaction(() => {
      const remove = this.#db().prepare("DELETE FROM voice_cache WHERE key = ?");
      for (const row of this.#db().prepare("SELECT key FROM voice_cache").all()) {
        if (!existsSync(this.voiceCachePath(row.key))) {
          removed += Number(remove.run(row.key).changes);
        }
      }
    });
    return removed;
  }

  voiceCachePath(key) {
    key = normalizeVoiceCacheKey(key);
    return resolveChild(this.cacheDir, `${key}.wav`);
  }

  #db() {
    if (!this.database) {
      throw new StoreError("ยังไม่ได้เปิดฐานข้อมูล กรุณาเรียก store.init() ก่อน", {
        code: "STORE_CLOSED",
      });
    }
    return this.database;
  }

  #timestamp() {
    const value = Number(this.now());
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StoreError("clock ของ store คืนค่า timestamp ที่ใช้ไม่ได้", {
        code: "STORE_CLOCK_INVALID",
      });
    }
    return value;
  }

  #transaction(callback) {
    const database = this.#db();
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }
  }

  #readProjectFile(id) {
    const filename = this.projectFile(id);
    let source;
    try {
      source = JSON.parse(readFileSync(filename, "utf8"));
    } catch (error) {
      throw new StoreCorruptionError(`อ่านไฟล์ project.json ของ “${id}” ไม่ได้`, {
        cause: error,
      });
    }
    let stats;
    try {
      stats = statSync(filename);
    } catch {
      stats = null;
    }
    return normalizeProjectDocument(source, id, stats, this.#timestamp());
  }

  #upsertProjectIndex(document) {
    this.#db().prepare(`
      INSERT INTO projects (id, owner_id, title, product_json, wizard_step, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        title = excluded.title,
        product_json = excluded.product_json,
        wizard_step = excluded.wizard_step,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(...projectDocumentToRow(document));
  }

  #projectExists(id) {
    if (existsSync(this.projectDir(id))) return true;
    // A missing folder means a stale index row. The folder is canonical, so
    // clean the row now instead of making a valid project id unusable.
    this.#db().prepare("DELETE FROM projects WHERE id = ?").run(id);
    return false;
  }

  #availableProjectId(title, timestamp) {
    const date = new Date(timestamp);
    const prefix = Number.isNaN(date.valueOf())
      ? "project"
      : [
          String(date.getFullYear()).padStart(4, "0"),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
    const slug = slugify(title) || "project";
    const base = `${prefix}-${slug}`.slice(0, 120).replace(/[. ]+$/u, "");
    let candidate = base;
    let suffix = 2;
    while (this.#projectExists(candidate)) candidate = `${base.slice(0, 112)}-${suffix++}`;
    return candidate;
  }

  #throwRenderTransition(id, action) {
    const current = this.getRender(id);
    if (!current) throw new StoreNotFoundError(`ไม่พบงานเรนเดอร์ “${id}”`);
    throw new StoreConflictError(`${action}ไม่ได้จากสถานะ “${current.state}”`);
  }
}

export function createStore(options) {
  return new SqliteStore(options).init();
}

function normalizeProjectDocument(source, id, stats, now) {
  const document = cloneJsonObject(source, "project.json");
  const title = normalizeTitle(document.title ?? id);
  const product = normalizeProduct(document.product ?? document.product_json ?? {});
  const wizardStep = normalizeWizardStep(document.wizardStep ?? document.wizard_step ?? 1);
  const fileCreated = stats ? Math.trunc(stats.birthtimeMs || stats.ctimeMs || now) : now;
  const fileUpdated = stats ? Math.trunc(stats.mtimeMs || now) : now;
  const createdAt = normalizeTimestamp(document.createdAt ?? document.created_at, fileCreated);
  const updatedAt = normalizeTimestamp(document.updatedAt ?? document.updated_at, fileUpdated);
  delete document.product_json;
  delete document.wizard_step;
  delete document.created_at;
  delete document.updated_at;
  return { ...document, id, title, product, wizardStep, createdAt, updatedAt };
}

function projectDocumentToRow(document) {
  return [
    document.id,
    document.ownerId ?? null,
    document.title,
    JSON.stringify(document.product ?? {}),
    document.wizardStep,
    document.createdAt,
    document.updatedAt,
  ];
}

function mapUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    disabled: Boolean(row.disabled),
    createdAt: Number(row.created_at),
    passwordChangedAt: Number(row.password_changed_at ?? 0),
  };
}

function mapProjectRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id ?? null,
    title: row.title,
    product: decodeJson(row.product_json, {}),
    wizardStep: Number(row.wizard_step),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapRenderRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    lane: row.lane,
    state: row.state,
    progress: Number(row.progress),
    stage: row.stage,
    message: row.message,
    queuePosition: row.queue_position == null ? null : Number(row.queue_position),
    styleId: row.style_id,
    config: decodeJson(row.config_json, null),
    timeline: decodeJson(row.timeline_json, null),
    outputs: decodeJson(row.outputs_json, null),
    error: decodeJson(row.error_json, null),
    attempts: Number(row.attempts),
    createdAt: Number(row.created_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  };
}

function mapVoiceCacheRow(row, cacheDir) {
  const filename = path.join(cacheDir, `${row.key}.wav`);
  return {
    key: row.key,
    durationMs: Number(row.duration_ms),
    provider: row.provider,
    voice: row.voice,
    createdAt: Number(row.created_at),
    path: filename,
    exists: existsSync(filename),
  };
}

function addJsonChange(changes, camelName, columnName, add) {
  if (Object.hasOwn(changes, camelName)) {
    add(columnName, encodeNullableJson(changes[camelName]));
  } else if (Object.hasOwn(changes, columnName)) {
    add(columnName, encodeNullableJson(changes[columnName]));
  }
}

function hasEither(object, first, second) {
  return Object.hasOwn(object, first) || Object.hasOwn(object, second);
}

function encodeNullableJson(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      // A plain string is valid JSON data too; quote it before storage.
    }
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new StoreValidationError("ข้อมูล JSON บันทึกไม่ได้", { cause: error });
  }
}

function decodeJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cloneJsonObject(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new StoreValidationError(`${label} ต้องเป็น object`);
  }
  try {
    const clone = JSON.parse(JSON.stringify(value));
    if (clone == null || typeof clone !== "object" || Array.isArray(clone)) throw new Error();
    return clone;
  } catch (error) {
    throw new StoreValidationError(`${label} ต้องเป็นข้อมูล JSON ที่บันทึกได้`, { cause: error });
  }
}

function normalizeTitle(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new StoreValidationError("ชื่อโปรเจกต์ต้องเป็นข้อความที่ไม่ว่าง");
  }
  const title = value.trim();
  if (title.length > 200) throw new StoreValidationError("ชื่อโปรเจกต์ยาวเกิน 200 ตัวอักษร");
  return title;
}

function normalizeProduct(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new StoreValidationError("product_json ไม่ใช่ JSON ที่ถูกต้อง", { cause: error });
    }
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new StoreValidationError("ข้อมูลสินค้าต้องเป็น object");
  }
  return cloneJsonObject(value, "product");
}

/** จำนวนขั้นของ wizard — คลิป, สินค้า, เสียง, สคริปต์, ซับ, ผลลัพธ์ */
export const MAX_WIZARD_STEP = 6;

function normalizeWizardStep(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_WIZARD_STEP) {
    throw new StoreValidationError(`wizardStep ต้องเป็นเลข 1 ถึง ${MAX_WIZARD_STEP}`);
  }
  return number;
}

function assertProjectId(value) {
  if (typeof value !== "string") throw new StoreValidationError("รหัสโปรเจกต์ต้องเป็นข้อความ");
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.length > 128 ||
    INVALID_PROJECT_ID.test(value) ||
    hasControlCharacter(value) ||
    /[. ]$/u.test(value) ||
    WINDOWS_RESERVED_NAME.test(value)
  ) {
    throw new StoreValidationError("รหัสโปรเจกต์มีอักขระหรือรูปแบบที่ใช้เป็นชื่อโฟลเดอร์ไม่ได้");
  }
  return value;
}

function normalizeRenderId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || hasControlCharacter(value)) {
    throw new StoreValidationError("รหัสงานเรนเดอร์ไม่ถูกต้อง");
  }
  return value;
}

function normalizeRenderState(value) {
  if (typeof value !== "string" || !RENDER_STATES.has(value)) {
    throw new StoreValidationError(`สถานะงานเรนเดอร์ “${String(value)}” ไม่ถูกต้อง`);
  }
  return value;
}

function normalizeChoice(value, choices, label) {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new StoreValidationError(`${label} ต้องเป็น ${choices.join(" หรือ ")}`);
  }
  return value;
}

function normalizeProgress(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new StoreValidationError("progress ต้องเป็นเลขจำนวนเต็ม 0 ถึง 100");
  }
  return number;
}

function normalizeNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new StoreValidationError(`${label} ต้องเป็นเลขจำนวนเต็มที่ไม่ติดลบ`);
  }
  return number;
}

function nullableInteger(value, label) {
  return value == null ? null : normalizeNonNegativeInteger(value, label);
}

function nullableString(value) {
  if (value == null) return null;
  if (typeof value !== "string") throw new StoreValidationError("ค่าต้องเป็นข้อความหรือ null");
  return value;
}

function normalizeTimestamp(value, fallback) {
  if (value == null) return fallback;
  const number = typeof value === "string" && !/^\d+$/u.test(value)
    ? Date.parse(value)
    : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new StoreValidationError("timestamp ไม่ถูกต้อง");
  }
  return number;
}

function nullableTimestamp(value) {
  return value == null ? null : normalizeTimestamp(value, null);
}

function normalizeSettingKey(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || hasControlCharacter(value)) {
    throw new StoreValidationError("ชื่อการตั้งค่าไม่ถูกต้อง");
  }
  return value;
}

function normalizeVoiceCacheKey(value) {
  if (typeof value !== "string" || !VOICE_CACHE_KEY.test(value)) {
    throw new StoreValidationError("voice cache key ต้องเป็น SHA-256 แบบ hexadecimal 64 ตัว");
  }
  return value.toLowerCase();
}

function assertPage(limit, offset) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new StoreValidationError("limit ต้องเป็นเลข 1 ถึง 10000");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new StoreValidationError("offset ต้องเป็นเลขจำนวนเต็มที่ไม่ติดลบ");
  }
}

function slugify(value) {
  return replaceControlCharacters(value)
    .normalize("NFKC")
    .trim()
    .replace(INVALID_PROJECT_ID_GLOBAL, "-")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[. -]+|[. -]+$/gu, "");
}

function hasControlCharacter(value) {
  for (const character of value) {
    if (character.codePointAt(0) <= 0x1f) return true;
  }
  return false;
}

function replaceControlCharacters(value) {
  return Array.from(value, (character) => (
    character.codePointAt(0) <= 0x1f ? "-" : character
  )).join("");
}

function resolveChild(root, child) {
  const target = path.resolve(root, child);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StoreValidationError("path อยู่นอกโฟลเดอร์ที่อนุญาต");
  }
  return target;
}

function writeJsonAtomic(filename, value) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, filename);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve original write error.
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Preserve original write error.
    }
    throw error;
  }
}

function toErrorInfo(error) {
  if (error == null) return { message: "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ" };
  if (typeof error === "string") return { message: error };
  if (typeof error === "object") {
    const info = {
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : String(error),
    };
    if (typeof error.code === "string" || typeof error.code === "number") info.code = error.code;
    return info;
  }
  return { message: String(error) };
}
