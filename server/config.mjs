import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This value is intentionally not configurable. Clip360 stores a user's API
// key locally, so listening on every network interface would expose the local
// API to other devices on the same network.
export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4321;
export const MIN_NODE_VERSION = "22.13.0";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(SERVER_DIR, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const DATABASE_FILE = path.join(DATA_DIR, "clip360.db");
export const BIN_DIR = path.join(DATA_DIR, "bin");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const TTS_CACHE_DIR = path.join(CACHE_DIR, "tts");
export const INPUT_DIR = path.join(ROOT_DIR, "input");
export const PROJECTS_DIR = path.join(ROOT_DIR, "projects");
export const FONTS_DIR = path.join(ROOT_DIR, "fonts");
export const ENV_FILE = path.join(ROOT_DIR, ".env");

export function createPaths(rootDir = ROOT_DIR) {
  const root = path.resolve(rootDir);
  const data = path.join(root, "data");
  const cache = path.join(data, "cache");

  return Object.freeze({
    root,
    data,
    database: path.join(data, "clip360.db"),
    bin: path.join(data, "bin"),
    cache,
    ttsCache: path.join(cache, "tts"),
    input: path.join(root, "input"),
    projects: path.join(root, "projects"),
    fonts: path.join(root, "fonts"),
    env: path.join(root, ".env"),
  });
}

export const paths = createPaths();
export const PATHS = paths;

/**
 * Create only Clip360-owned runtime directories. Keeping this small and
 * explicit prevents an accidental broad mkdir when a path is malformed.
 */
export function ensureDirectories(appPaths = paths) {
  const directories = [
    appPaths.data,
    appPaths.bin,
    appPaths.cache,
    appPaths.ttsCache,
    appPaths.input,
    appPaths.projects,
    appPaths.fonts,
  ];

  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }

  return appPaths;
}

export const ensureRuntimeDirectories = ensureDirectories;

/**
 * รับค่า .env รุ่นเก่าที่ยังขึ้นต้นด้วย CLIPPANG_ ต่อไปได้
 *
 * ตอนเปลี่ยนแบรนด์เป็น Clip360 ชื่อตัวแปรเปลี่ยนเป็น CLIP360_ ทั้งชุด แต่เครื่องที่
 * ติดตั้งไปแล้วยังมี .env เดิมอยู่ ถ้าไม่รับชื่อเก่าด้วย โหมดเข้าจากเครื่องอื่นจะเงียบ
 * ไปเฉย ๆ (ไม่มีโฮสต์ที่อนุญาต ไม่มีบัญชี) ซึ่งดูเหมือนระบบพังโดยไม่บอกสาเหตุ
 *
 * ชื่อใหม่ชนะเสมอ — ชื่อเก่าเติมให้เฉพาะช่องที่ยังว่าง
 */
export function applyLegacyEnvAliases(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("CLIPPANG_")) continue;
    const renamed = `CLIP360_${key.slice("CLIPPANG_".length)}`;
    if (env[renamed] == null || env[renamed] === "") env[renamed] = value;
  }
  return env;
}

/**
 * ย้ายไฟล์ฐานข้อมูลชื่อเดิม clippang.db มาเป็น clip360.db ให้อัตโนมัติ
 *
 * ย้าย -wal และ -shm ไปด้วย เพราะ SQLite เขียนค้างไว้ในนั้น ถ้าย้ายแต่ไฟล์หลัก
 * ธุรกรรมรอบสุดท้ายจะหาย ไม่ทำอะไรเลยถ้าไฟล์ชื่อใหม่มีอยู่แล้ว
 */
export function migrateLegacyDatabase(databaseFile = DATABASE_FILE) {
  const legacy = path.join(path.dirname(databaseFile), "clippang.db");
  if (legacy === databaseFile) return false;
  if (!fs.existsSync(legacy) || fs.existsSync(databaseFile)) return false;

  // ถ้าย้ายไม่ได้ต้องหยุดและบอกเหตุผล ห้ามปล่อยผ่าน เพราะการเปิดต่อจะสร้างไฟล์เปล่า
  // ขึ้นมาใหม่ แล้วผู้ใช้จะเห็นว่าโปรเจกต์หายทั้งหมดทั้งที่ข้อมูลยังอยู่ครบในไฟล์เดิม
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(legacy + suffix)) fs.renameSync(legacy + suffix, databaseFile + suffix);
    }
  } catch (error) {
    throw new Error(
      `ย้ายฐานข้อมูลเดิม ${legacy} ไปเป็น ${databaseFile} ไม่สำเร็จ (${error.code ?? error.message})
` +
      "มักเกิดจากยังมี Clip360 อีกหน้าต่างเปิดค้างอยู่ ปิดให้หมดแล้วเปิดใหม่อีกครั้ง",
      { cause: error },
    );
  }
  return true;
}
