import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { PATHS } from "./config.mjs";
import {
  assertSafeFilename,
  resolveUnderRoot,
  safeProjectPath,
} from "./security.mjs";
import { probe } from "../pipeline/media.mjs";

export const MAX_SOURCE_ASSETS = 12;
export const MAX_TIMELINE_CLIPS = 24;
export const MAX_TIMELINE_DURATION_MS = 60_000;

function validationError(message, code, details) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  if (details) error.details = details;
  return error;
}

function stableOrder(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = Number.isFinite(Number(a.item?.order)) ? Number(a.item.order) : a.index;
      const right = Number.isFinite(Number(b.item?.order)) ? Number(b.item.order) : b.index;
      return left - right || a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Validate the unique upload catalog stored in product.assets/config.assets. */
export function normalizeAssetCatalog(input, { optional = false } = {}) {
  if (input == null && optional) return null;
  if (!Array.isArray(input)) {
    throw validationError("รายการไฟล์ต้นฉบับไม่ถูกต้อง กรุณาอัปโหลดคลิปใหม่", "INVALID_ASSET_CATALOG");
  }
  if (input.length > MAX_SOURCE_ASSETS) {
    throw validationError(
      `อัปโหลดได้สูงสุด ${MAX_SOURCE_ASSETS} ไฟล์ต่อโปรเจกต์ กรุณาลบบางไฟล์ก่อน`,
      "TOO_MANY_SOURCE_ASSETS",
      { maximum: MAX_SOURCE_ASSETS, received: input.length },
    );
  }

  const seen = new Set();
  return input.map((asset, index) => {
    if (!asset || typeof asset !== "object") {
      throw validationError(`ข้อมูลไฟล์ลำดับที่ ${index + 1} ไม่ถูกต้อง`, "INVALID_ASSET_CATALOG");
    }
    const name = String(asset.name ?? asset.assetName ?? "").normalize("NFC");
    if (!name) {
      throw validationError(`ไฟล์ลำดับที่ ${index + 1} ไม่มีชื่อไฟล์`, "ASSET_NAME_REQUIRED");
    }
    assertSafeFilename(name, { fallback: "video", maxLength: 160 });
    if (seen.has(name)) {
      throw validationError(`ไฟล์ “${name}” ซ้ำในรายการอัปโหลด`, "DUPLICATE_SOURCE_ASSET");
    }
    seen.add(name);
    return { ...asset, name };
  });
}

/**
 * Validate and canonicalize the editable timeline. The same asset may occur
 * more than once (for split/repeated sections); each occurrence is a distinct
 * timeline clip.
 */
export function normalizeTimelineClips(input, { assetNames } = {}) {
  if (!Array.isArray(input) || input.length === 0) {
    throw validationError("ยังไม่มีชิ้นวิดีโอบนไทม์ไลน์ กรุณาเพิ่มและเรียงคลิปก่อนสร้าง", "TIMELINE_CLIPS_REQUIRED");
  }
  if (input.length > MAX_TIMELINE_CLIPS) {
    throw validationError(
      `ไทม์ไลน์มีได้สูงสุด ${MAX_TIMELINE_CLIPS} ชิ้น กรุณารวมชิ้นที่ต่อเนื่องกัน`,
      "TOO_MANY_TIMELINE_CLIPS",
      { maximum: MAX_TIMELINE_CLIPS, received: input.length },
    );
  }

  const allowed = assetNames ? new Set(assetNames) : null;
  const ids = new Set();
  const orders = new Set();
  let totalMs = 0;
  const canonical = input.map((clip, index) => {
    if (!clip || typeof clip !== "object") {
      throw validationError(`ชิ้นวิดีโอลำดับที่ ${index + 1} ไม่ถูกต้อง`, "INVALID_TIMELINE_CLIP");
    }
    const assetName = String(clip.assetName ?? clip.name ?? "").normalize("NFC");
    if (!assetName) {
      throw validationError(`ชิ้นวิดีโอลำดับที่ ${index + 1} ไม่ได้อ้างถึงไฟล์ต้นฉบับ`, "TIMELINE_ASSET_REQUIRED");
    }
    assertSafeFilename(assetName, { fallback: "video", maxLength: 160 });
    if (allowed && !allowed.has(assetName)) {
      throw validationError(
        `ชิ้นวิดีโออ้างถึงไฟล์ “${assetName}” ที่ไม่ได้อยู่ในโปรเจกต์`,
        "TIMELINE_ASSET_NOT_FOUND",
      );
    }

    const id = String(clip.id ?? `clip-${index + 1}`).slice(0, 120);
    if (!id || ids.has(id)) {
      throw validationError(
        id ? `รหัสชิ้นวิดีโอ “${id}” ซ้ำกัน` : `ชิ้นวิดีโอลำดับที่ ${index + 1} ไม่มีรหัส`,
        "DUPLICATE_TIMELINE_CLIP_ID",
      );
    }
    ids.add(id);

    const trimStartMs = Math.round(Number(clip.trimStartMs));
    const trimEndMs = Math.round(Number(clip.trimEndMs));
    if (!Number.isFinite(trimStartMs) || trimStartMs < 0) {
      throw validationError(`เวลาเริ่มของชิ้น “${id}” ต้องไม่น้อยกว่า 0`, "INVALID_CLIP_TRIM");
    }
    if (!Number.isFinite(trimEndMs) || trimEndMs <= trimStartMs) {
      throw validationError(`เวลาสิ้นสุดของชิ้น “${id}” ต้องมากกว่าเวลาเริ่ม`, "INVALID_CLIP_TRIM");
    }
    const order = clip.order == null ? index : Number(clip.order);
    if (!Number.isInteger(order) || order < 0 || order >= input.length || orders.has(order)) {
      throw validationError(
        `ลำดับของชิ้น “${id}” ต้องเป็นเลขจำนวนเต็มไม่ซ้ำ ตั้งแต่ 0 ถึง ${input.length - 1}`,
        "INVALID_TIMELINE_ORDER",
      );
    }
    orders.add(order);
    totalMs += trimEndMs - trimStartMs;
    return {
      ...clip,
      id,
      assetName,
      order,
      trimStartMs,
      trimEndMs,
    };
  });

  if (totalMs <= 0) {
    throw validationError("ความยาวไทม์ไลน์ต้องมากกว่า 0 วินาที", "INVALID_TIMELINE_DURATION");
  }
  if (totalMs > MAX_TIMELINE_DURATION_MS) {
    throw validationError(
      `ความยาวรวม ${Number((totalMs / 1000).toFixed(3))} วินาที เกินกำหนดสูงสุด 60 วินาที`,
      "TIMELINE_DURATION_LIMIT",
      { maximumMs: MAX_TIMELINE_DURATION_MS, totalMs },
    );
  }

  return { clips: stableOrder(canonical), totalMs };
}

/** Resolve product/config into one immutable media plan for a render job. */
export function resolveMediaPlan(config = {}, product = {}, { requireTimeline = false } = {}) {
  const catalogInput = Array.isArray(config.assets) ? config.assets : product.assets;
  const timelineInput = Array.isArray(config.timelineClips) ? config.timelineClips : product.timelineClips;
  const hasCatalog = Array.isArray(catalogInput);
  const hasTimeline = Array.isArray(timelineInput);

  if (!hasCatalog && !hasTimeline) return null;
  const assets = normalizeAssetCatalog(catalogInput);
  if (!hasTimeline) {
    if (requireTimeline) {
      throw validationError("กรุณาจัดลำดับและกำหนดช่วงเวลาบนไทม์ไลน์ก่อนสร้างคลิป", "TIMELINE_CLIPS_REQUIRED");
    }
    return { assets, timelineClips: null, selectedTotalMs: 0 };
  }
  const timeline = normalizeTimelineClips(timelineInput, { assetNames: assets.map((asset) => asset.name) });
  const plan = { assets, timelineClips: timeline.clips, selectedTotalMs: timeline.totalMs };
  plan.editPlanHash = hashEditPlan(plan);
  return plan;
}

/** Stable manifest hash used to reject promotion of a stale draft. */
export function hashEditPlan(plan) {
  if (!plan?.timelineClips) return null;
  const manifest = {
    assets: [...new Set(plan.timelineClips.map((clip) => clip.assetName))].sort(),
    timelineClips: plan.timelineClips.map((clip) => ({
      id: clip.id,
      assetName: clip.assetName,
      order: clip.order,
      trimStartMs: clip.trimStartMs,
      trimEndMs: clip.trimEndMs,
    })),
  };
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

async function copySource(name, { inputDir, projectSourceDir }) {
  const inputFile = resolveUnderRoot(inputDir, name);
  try {
    await fsp.access(inputFile, fs.constants.R_OK);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw validationError(`ไม่พบไฟล์ต้นฉบับ “${name}” กรุณาอัปโหลดใหม่`, "SOURCE_NOT_FOUND");
  }
  await fsp.mkdir(projectSourceDir, { recursive: true });
  const projectSource = resolveUnderRoot(projectSourceDir, name);
  try {
    await fsp.access(projectSource, fs.constants.R_OK);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fsp.copyFile(inputFile, projectSource);
  }
  return projectSource;
}

/**
 * Copy and ffprobe every unique timeline asset exactly once, then validate all
 * repeated/split timeline clips against the server-observed media duration.
 */
export async function prepareSources(project, config = {}, product = {}, options = {}) {
  const inputDir = path.resolve(options.inputDir ?? PATHS.input);
  const projectSourceDir = path.resolve(options.projectSourceDir ?? safeProjectPath(project.id, "src"));
  const probeVideo = options.probeVideo ?? probe;
  const onProgress = options.onProgress ?? (() => {});
  const mediaPlan = resolveMediaPlan(config, product, { requireTimeline: true });

  if (!mediaPlan) {
    const legacyAsset = config.assetName ?? config.asset?.name ?? product.assetName ?? product.asset?.name ?? product.source?.name;
    if (!legacyAsset) {
      throw validationError("ยังไม่ได้เลือกคลิปต้นฉบับ กรุณากลับไปขั้น ‘คลิป’ แล้วอัปโหลดไฟล์ก่อน", "SOURCE_REQUIRED");
    }
    const name = assertSafeFilename(String(legacyAsset).normalize("NFC"), { fallback: "video", maxLength: 160 });
    const file = await copySource(name, { inputDir, projectSourceDir });
    return {
      sourceFiles: [file],
      sourceSelections: null,
      clipPlan: null,
      selectedTotalMs: null,
      editPlanHash: null,
      assets: [{ name, file }],
      legacy: true,
    };
  }

  const referencedNames = [];
  const referenced = new Set();
  for (const clip of mediaPlan.timelineClips) {
    if (!referenced.has(clip.assetName)) {
      referenced.add(clip.assetName);
      referencedNames.push(clip.assetName);
    }
  }

  const prepared = new Map();
  for (const [index, name] of referencedNames.entries()) {
    await onProgress({
      stage: "ingest",
      progress: 1 + Math.round(((index + 1) / referencedNames.length) * 3),
      message: `กำลังตรวจไฟล์ต้นฉบับ ${index + 1}/${referencedNames.length}`,
      current: index + 1,
      total: referencedNames.length,
    });
    const file = await copySource(name, { inputDir, projectSourceDir });
    let meta;
    try {
      meta = await probeVideo(file, { signal: options.signal, timeoutMs: options.timeoutMs });
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
      throw validationError(`อ่านข้อมูลวิดีโอ “${name}” ไม่สำเร็จ กรุณาแปลงเป็น MP4 แล้วอัปโหลดใหม่`, "VIDEO_PROBE_FAILED");
    }
    prepared.set(name, { name, file, meta });
  }

  const sourceSelections = mediaPlan.timelineClips.map((clip) => {
    const asset = prepared.get(clip.assetName);
    const actualDurationMs = Math.round(Number(asset.meta.durationMs));
    if (!Number.isFinite(actualDurationMs) || actualDurationMs <= 0) {
      throw validationError(`อ่านความยาววิดีโอ “${clip.assetName}” ไม่ได้`, "VIDEO_DURATION_INVALID");
    }
    if (clip.trimEndMs > actualDurationMs) {
      throw validationError(
        `ช่วงของชิ้น “${clip.id}” สิ้นสุดที่ ${Number((clip.trimEndMs / 1000).toFixed(3))} วินาที แต่ไฟล์ “${clip.assetName}” ยาวเพียง ${Number((actualDurationMs / 1000).toFixed(3))} วินาที`,
        "CLIP_TRIM_OUT_OF_RANGE",
        { clipId: clip.id, assetName: clip.assetName, actualDurationMs },
      );
    }
    return {
      id: clip.id,
      assetName: clip.assetName,
      file: asset.file,
      order: clip.order,
      trimStartMs: clip.trimStartMs,
      trimEndMs: clip.trimEndMs,
      selectedDurationMs: clip.trimEndMs - clip.trimStartMs,
      actualDurationMs,
    };
  });

  return {
    sourceFiles: referencedNames.map((name) => prepared.get(name).file),
    sourceSelections,
    clipPlan: mediaPlan.timelineClips,
    selectedTotalMs: mediaPlan.selectedTotalMs,
    editPlanHash: mediaPlan.editPlanHash,
    assets: referencedNames.map((name) => prepared.get(name)),
    legacy: false,
  };
}
