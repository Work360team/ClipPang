import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This value is intentionally not configurable. ClipPang stores a user's API
// key locally, so listening on every network interface would expose the local
// API to other devices on the same network.
export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4321;
export const MIN_NODE_VERSION = "22.13.0";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(SERVER_DIR, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const DATABASE_FILE = path.join(DATA_DIR, "clippang.db");
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
    database: path.join(data, "clippang.db"),
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
 * Create only ClipPang-owned runtime directories. Keeping this small and
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
