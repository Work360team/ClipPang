export type LocalEngineState = "checking" | "connected" | "unavailable";

export interface ApiErrorShape {
  code?: string;
  message: string;
  details?: unknown;
}

export class ClipPangApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status = 500, code?: string, details?: unknown) {
    super(message);
    this.name = "ClipPangApiError";
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
      : { message: typeof data === "string" ? data : `ClipPang ตอบกลับ ${response.status}` };
    throw new ClipPangApiError(error.message, response.status, error.code, error.details);
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

export const localApi = {
  setupStatus: () => apiFetch<SetupStatus>("/api/setup/status"),
  installFfmpeg: () => apiFetch<{ ok: true; status: string; progress: number }>("/api/setup/ffmpeg", { method: "POST", body: "{}" }),
  saveKey: (key: string) => apiFetch<{ ok: true; key: { configured: boolean; last4: string; masked: string } }>("/api/setup/key", { method: "POST", body: JSON.stringify({ key }) }),
  listInput: () => apiFetch<{ ok: true; files: LocalAsset[] }>("/api/input"),
  uploadAsset: async (file: File, onProgress?: (progress: number) => void) => {
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
      xhr.onerror = () => reject(new ClipPangApiError("อัปโหลดไม่สำเร็จ ตรวจว่า ClipPang Local ยังเปิดอยู่แล้วลองใหม่"));
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status < 200 || xhr.status >= 300) throw new ClipPangApiError(body?.error?.message || "อัปโหลดไม่สำเร็จ", xhr.status, body?.error?.code);
          resolve(body);
        } catch (error) { reject(error); }
      };
      xhr.send(file);
    });
  },
  listProjects: () => apiFetch<{ ok: true; projects: LocalProject[] }>("/api/projects"),
  createProject: (body: Record<string, unknown>) => apiFetch<{ ok: true; project: LocalProject }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => apiFetch<{ ok: true; project: LocalProject }>(`/api/projects/${encodeURIComponent(id)}`),
  updateProject: (id: string, body: Record<string, unknown>) => apiFetch<{ ok: true; project: LocalProject }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  generateScripts: (id: string, body: Record<string, unknown>) => apiFetch<{ ok: true; scripts: LocalScript[] }>(`/api/projects/${encodeURIComponent(id)}/script`, { method: "POST", body: JSON.stringify(body) }),
  regenerateChunk: (id: string, variantId: string, index: number, body: Record<string, unknown>) => apiFetch<{ ok: true; chunk: string; scripts?: LocalScript[] }>(`/api/projects/${encodeURIComponent(id)}/script/${encodeURIComponent(variantId)}/chunk/${index}`, { method: "POST", body: JSON.stringify(body) }),
  voices: () => apiFetch<{ ok: true; voices: LocalVoice[] }>("/api/voices"),
  styles: () => apiFetch<{ ok: true; styles: LocalCaptionStyle[] }>("/api/styles"),
  previewVoice: async (voiceId: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/voices/${encodeURIComponent(voiceId)}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) await parseResponse(response);
    return response.blob();
  },
  startRender: (id: string, body: Record<string, unknown>) => apiFetch<{ ok: true; renderId: string; render: LocalRender }>(`/api/projects/${encodeURIComponent(id)}/renders`, { method: "POST", body: JSON.stringify(body) }),
  getRender: (id: string) => apiFetch<{ ok: true; render: LocalRender }>(`/api/renders/${encodeURIComponent(id)}`),
  promoteRender: (id: string, body: Record<string, unknown> = {}) => apiFetch<{ ok: true; renderId: string; render: LocalRender }>(`/api/renders/${encodeURIComponent(id)}/promote`, { method: "POST", body: JSON.stringify(body) }),
  cancelRender: (id: string) => apiFetch<{ ok: true; render: LocalRender }>(`/api/renders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  openProject: (projectId: string, target: "out" | "project" = "out") => apiFetch<{ ok: true }>("/api/open", { method: "POST", body: JSON.stringify({ projectId, target }) }),
  settings: () => apiFetch<{ ok: true; settings: Record<string, unknown> }>("/api/settings"),
  clearCache: () => apiFetch<{ ok: true; removed: number }>("/api/settings/cache/clear", { method: "POST", body: "{}" }),
};

export interface LocalAsset { name: string; originalName?: string; size: number; updatedAt?: string; url: string }
export interface LocalScript { id: string; name?: string; tag?: string; score?: number; chunks: string[] }
export interface LocalVoice { id: string; name?: string; label?: string; gender?: string; tone?: string; provider?: string; color?: string; initials?: string }
export interface LocalCaptionStyle { id: string; name: string; note?: string; speed?: string; premium?: boolean }
export interface LocalOutput { filename: string; url: string; size?: number; durationMs?: number }
export interface LocalRender {
  id: string; project_id: string; kind: "draft" | "final"; state: string; progress: number;
  stage?: string | null; message?: string | null; queue_position?: number | null;
  outputs?: Record<string, LocalOutput> | null; error?: { message?: string } | null;
}
export interface LocalProject {
  id: string; title: string; wizard_step?: number; product?: Record<string, unknown>;
  updated_at?: string; created_at?: string; renders?: LocalRender[];
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
