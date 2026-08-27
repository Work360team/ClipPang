export type LocalEngineState = "checking" | "connected" | "unavailable";

export interface ApiErrorShape {
  code?: string;
  message: string;
  details?: unknown;
}

export class Clip360ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status = 500, code?: string, details?: unknown) {
    super(message);
    this.name = "Clip360ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = typeof data === "object" && data && "error" in data
      ? (data as { error: ApiErrorShape }).error
      : { message: typeof data === "string" ? data : `Clip360 ตอบกลับ ${response.status}` };
    throw new Clip360ApiError(error.message, response.status, error.code, error.details);
  }
  return data as T;
}

export async function apiFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(pathname, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof Blob) && !(init.body instanceof File) ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  return parseResponse<T>(response);
}

export async function detectLocalEngine(timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/health", { signal: controller.signal, cache: "no-store" });
    if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) return null;
    const result = await response.json();
    return result?.local === true ? result : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface SetupStatus {
  ok: boolean;
  ready?: boolean;
  node?: { ready?: boolean; version?: string } | boolean;
  ffmpeg?: { ready?: boolean; path?: string; libass?: boolean; error?: string } | boolean;
  key?: { configured?: boolean; last4?: string; masked?: string };
  gemini?: { configured?: boolean; last4?: string; masked?: string };
  installing?: boolean;
  installProgress?: number | null;
  installMessage?: string;
  paths?: { input: string; projects: string };
}

async function uploadAssetFile(file: File, onProgress?: (progress: number) => void) {
  if (!onProgress) {
    return apiFetch<{ ok: true; asset: LocalAsset }>(`/api/assets/${encodeURIComponent(file.name)}`, {
      method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" },
    });
  }
  return new Promise<{ ok: true; asset: LocalAsset }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/assets/${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () => reject(new Clip360ApiError("อัปโหลดไม่สำเร็จ ตรวจว่า Clip360 Local ยังเปิดอยู่แล้วลองใหม่"));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status < 200 || xhr.status >= 300) throw new Clip360ApiError(body?.error?.message || "อัปโหลดไม่สำเร็จ", xhr.status, body?.error?.code);
        resolve(body);
      } catch (error) { reject(error); }
    };
    xhr.send(file);
  });
}

export const localApi = {
  setupStatus: () => apiFetch<SetupStatus>("/api/setup/status"),
  installFfmpeg: () => apiFetch<{ ok: true; status: string; progress: number }>("/api/setup/ffmpeg", { method: "POST", body: "{}" }),
  installWhisper: () => apiFetch<{ ok: true; status: string; progress: number }>("/api/setup/whisper", { method: "POST", body: "{}" }),

  // เสียงต้นแบบที่ผู้ใช้อัดเองไว้ให้เครื่องยนต์เสียงในเครื่องโคลนตาม
  voiceClones: () => apiFetch<VoiceCloneLibrary>("/api/voice-clones"),
  addVoiceClone: (audio: Blob, fields: { speaker: string; tone: string; gender: string; text?: string }) => {
    const params = new URLSearchParams({ speaker: fields.speaker, tone: fields.tone, gender: fields.gender });
    if (fields.text) params.set("text", fields.text);
    return apiFetch<{ ok: true; clone: LocalVoiceClone }>(`/api/voice-clones?${params}`, { method: "POST", body: audio });
  },
  updateVoiceCloneGender: (id: string, gender: VoiceGender) => apiFetch<{ ok: true; clone: LocalVoiceClone }>(
    `/api/voice-clones/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ gender }) },
  ),
  deleteVoiceClone: (id: string) => apiFetch<{ ok: true }>(`/api/voice-clones/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveKey: (key: string) => apiFetch<{ ok: true; key: { configured: boolean; last4: string; masked: string } }>("/api/setup/key", { method: "POST", body: JSON.stringify({ key }) }),
  listInput: () => apiFetch<{ ok: true; files: LocalAsset[] }>("/api/input"),
  uploadAsset: uploadAssetFile,
  uploadAssets: async (files: File[], onProgress?: (progress: number, currentFile: number, totalFiles: number) => void) => {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let completedBytes = 0;
    const assets: LocalAsset[] = [];
    const results: { fileName: string; asset?: LocalAsset; error?: string }[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const result = await uploadAssetFile(file, (fileProgress) => {
          const loadedBytes = file.size * fileProgress / 100;
          onProgress?.(Math.round(((completedBytes + loadedBytes) / totalBytes) * 100), index + 1, files.length);
        });
        assets.push(result.asset);
        results.push({ fileName: file.name, asset: result.asset });
      } catch (error) {
        results.push({ fileName: file.name, error: error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ" });
      } finally {
        completedBytes += file.size;
        onProgress?.(Math.round((completedBytes / totalBytes) * 100), index + 1, files.length);
      }
    }
    return { ok: results.every((result) => Boolean(result.asset)), assets, results };
  },
  listProjects: () => apiFetch<{ ok: true; projects: LocalProject[] }>("/api/projects"),
  createProject: (body: Record<string, unknown>) => apiFetch<{ ok: true; project: LocalProject }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => apiFetch<{ ok: true; project: LocalProject }>(`/api/projects/${encodeURIComponent(id)}`),
  updateProject: (id: string, body: Record<string, unknown>) => apiFetch<{ ok: true; project: LocalProject }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  // เซิร์ฟเวอร์ย้ายไป data/trash ไม่ได้ลบทิ้งถาวร จึงกู้คืนเองได้ถ้ากดพลาด
  deleteProject: (id: string) => apiFetch<{ ok: true; recoverable: boolean; message: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  generateScripts: (
    id: string,
    body: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ) => {
    // Server จะตัด CLI ของตัวเองก่อนครบเวลานี้ ส่วน watchdog ฝั่งหน้าเว็บกันกรณี
    // connection หายแล้ว promise ไม่จบ ทำให้ปุ่มถูกล็อกค้างตลอดไป
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 90_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    return apiFetch<{ ok: true; scripts: LocalScript[]; brief?: Record<string, unknown>; updatedAt?: number; fallbackFrom?: string | null }>(
      `/api/projects/${encodeURIComponent(id)}/script`,
      { method: "POST", body: JSON.stringify(body), signal },
    );
  },
  regenerateChunk: (id: string, variantId: string, index: number, body: Record<string, unknown>) => apiFetch<{ ok: true; chunk: string; scripts?: LocalScript[] }>(`/api/projects/${encodeURIComponent(id)}/script/${encodeURIComponent(variantId)}/chunk/${index}`, { method: "POST", body: JSON.stringify(body) }),
  voices: () => apiFetch<{ ok: true; voices: LocalVoice[] }>("/api/voices"),
  styles: () => apiFetch<{ ok: true; styles: LocalCaptionStyle[]; colorSets?: LocalColorSet[] }>("/api/styles"),
  previewVoice: async (voiceId: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/voices/${encodeURIComponent(voiceId)}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) await parseResponse(response);
    return response.blob();
  },
  startRender: (id: string, body: Record<string, unknown>) => apiFetch<{ ok: true; renderId: string; render: LocalRender }>(`/api/projects/${encodeURIComponent(id)}/renders`, { method: "POST", body: JSON.stringify(body) }),
  getRender: (id: string) => apiFetch<{ ok: true; render: LocalRender }>(`/api/renders/${encodeURIComponent(id)}`),
  cancelRender: (id: string) => apiFetch<{ ok: true; render: LocalRender }>(`/api/renders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  openProject: (projectId: string, target: "out" | "project" = "out") => apiFetch<{ ok: true }>("/api/open", { method: "POST", body: JSON.stringify({ projectId, target }) }),
  captions: (projectId: string) =>
    apiFetch<{ ok: true; captions: LocalCaptionSet | null }>(`/api/projects/${encodeURIComponent(projectId)}/captions`),
  generateCaptions: (projectId: string, body: Record<string, unknown> = {}) =>
    apiFetch<{ ok: true; captions: LocalCaptionSet; updatedAt?: number }>(`/api/projects/${encodeURIComponent(projectId)}/captions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  notifications: () => apiFetch<{ ok: true; items: LocalNotification[]; unread: number; seenAt: number }>("/api/notifications"),
  markNotificationsSeen: () => apiFetch<{ ok: true; seenAt: number }>("/api/notifications", { method: "POST", body: "{}" }),
  users: () => apiFetch<{ ok: true; users: LocalUser[]; unownedProjects: number; me: string }>("/api/users"),
  createUser: (body: { username: string; password: string; role?: string }) =>
    apiFetch<{ ok: true; user: LocalUser }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: Record<string, unknown>) =>
    apiFetch<{ ok: true; user?: LocalUser; moved?: number; to?: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: string) =>
    apiFetch<{ ok: true; removed: string; orphanedProjects: number }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  quota: () => apiFetch<LocalQuota>("/api/tts/quota"),
  account: () => apiFetch<LocalAccount>("/api/account"),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: true; signedOutOthers: boolean }>("/api/account/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  settings: () => apiFetch<{ ok: true; settings: Record<string, unknown> }>("/api/settings"),
  updateSettings: (patch: Record<string, unknown>) =>
    apiFetch<{ ok: true; settings: Record<string, unknown> }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  clearCache: () => apiFetch<{ ok: true; removed: number }>("/api/settings/cache/clear", { method: "POST", body: "{}" }),
};

export interface LocalAsset {
  name: string;
  originalName?: string;
  size: number;
  updatedAt?: string;
  url: string;
  durationMs?: number;
  width?: number;
  height?: number;
}
export interface LocalProjectAsset extends LocalAsset {
  durationMs: number;
  selectedDurationSec: number;
  order: number;
}
export interface LocalTimelineClip {
  id: string;
  assetName: string;
  order: number;
  trimStartMs: number;
  trimEndMs: number;
}
// hookType และ estDurationMs มาจากตัวสร้างสคริปต์จริง ส่วน name/tag/score เป็นรูปแบบเดิม
// ที่ยังมีอยู่ในโปรเจกต์ที่บันทึกไว้ก่อนหน้า จึงต้องรับได้ทั้งสองแบบ
export interface LocalScript {
  id: string;
  name?: string;
  tag?: string;
  score?: number;
  hookType?: string;
  estDurationMs?: number;
  chunks: string[];
}
export type VoiceGender = "หญิง" | "ชาย";

export interface LocalVoiceClone {
  id: string;
  speaker: string;
  tone: string;
  gender: VoiceGender | null;
  label: string;
  text: string;
  durationMs: number | null;
  msPerGrapheme?: number;
  createdAt: string | null;
  transcribedBy?: string;
}

export interface VoiceCloneLibrary {
  ok: true;
  speakers: { speaker: string; tones: LocalVoiceClone[] }[];
  clones: LocalVoiceClone[];
  tones: { id: string; samples: Record<VoiceGender, string> }[];
  engine: { ready: boolean; reason: string | null };
  canTranscribe: boolean;
}

export interface LocalVoice { id: string; name?: string; label?: string; gender?: string; tone?: string; provider?: string; color?: string; initials?: string; msPerGrapheme?: number }
export interface LocalCaptionStyle { id: string; name: string; note?: string; speed?: string; premium?: boolean }
export interface LocalColorSet { id: string; name: string; primary: string; secondary: string; hint?: string }
export interface LocalUser {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
  createdAt: number;
  projects: number;
  keys: number;
  usedToday: number;
}
export interface LocalAccount {
  ok: true;
  id: string;
  username: string;
  role: "owner" | "member";
  createdAt: number;
  passwordChangedAt: number | null;
  canChangePassword: boolean;
  canSignOut: boolean;
}
export interface LocalQuota {
  ok: true;
  scope: "user" | "machine";
  keyCount: number;
  usedToday: number;
  cap: number;
  remaining: number | null;
  history: { day: string; requests: number }[];
}
export interface LocalNotification {
  id: string;
  tone: "success" | "error" | "warning" | "progress";
  title: string;
  detail: string;
  at: number;
  href: string | null;
  sticky?: boolean;
}
export interface LocalCaptionIdea { angle: string; label: string; hint: string; text: string; hashtags: string[] }
export interface LocalCaptionSet { provider: string; fallbackFrom: string | null; captions: LocalCaptionIdea[] }
export interface LocalOutput { filename: string; url: string; size?: number; sizeBytes?: number; durationMs?: number }
export interface LocalRender {
  id: string; project_id: string; kind: "draft" | "final"; state: string; progress: number;
  stage?: string | null; message?: string | null; queue_position?: number | null;
  outputs?: Record<string, LocalOutput> | null; error?: { message?: string } | null;
  // เซิร์ฟเวอร์คืน config ของงานมาด้วยเสมอ (server/api.mjs normalizeRender)
  // ต้องประกาศไว้ ไม่งั้นโค้ดที่อ่านเสียง/สคริปต์ของร่างจะหลุด type check
  config?: Record<string, unknown> | null;
  stale?: boolean;
  // เวลาของงาน ใช้เลือกว่างานไหนใหม่กว่ากันตอนหยิบภาพปกมาแสดง
  created_at?: string; finished_at?: string | null;
  createdAt?: string; finishedAt?: string | null;
}
export interface LocalProject {
  id: string; title: string; wizardStep?: number; wizard_step?: number; product?: Record<string, unknown>;
  updatedAt?: number; updated_at?: number; createdAt?: number; created_at?: number; renders?: LocalRender[];
}

export function watchRender(renderId: string, onEvent: (render: LocalRender & { current?: number; total?: number }) => void, onError?: (event: Event) => void) {
  const source = new EventSource(`/api/renders/${encodeURIComponent(renderId)}/events`);
  source.addEventListener("progress", (event) => {
    const render = JSON.parse((event as MessageEvent).data);
    onEvent(render);
    if (["ready", "failed", "canceled"].includes(render.state)) source.close();
  });
  // Keep the EventSource open here. Browsers reconnect automatically after a
  // brief network/server interruption, while terminal render events close it
  // explicitly above. Closing on every error left the UI stuck mid-render.
  source.onerror = (event) => { onError?.(event); };
  return () => source.close();
}
