// providers — ทะเบียนผู้ให้บริการ AI สำหรับ "เขียนสคริปต์"
//
// มีสองชนิด:
//   api  — เรียก REST ด้วย API key ของผู้ใช้ (ผู้ใช้จ่ายตามการใช้งาน)
//   cli  — เรียกเครื่องมือทางการที่ผู้ใช้ติดตั้งและล็อกอินไว้เองบนเครื่อง
//          (claude / codex / gemini) ผู้ใช้ที่มี subscription อยู่แล้วจึงไม่ต้องจ่ายค่า API เพิ่ม
//
// หมายเหตุสำคัญ: ไม่มีทางที่แอปภายนอกจะล็อกอิน subscription ของ Claude / ChatGPT / Gemini
// ได้โดยตรง — ไม่มี OAuth สาธารณะให้ third-party และการหาทางลัดผิดเงื่อนไขการใช้งาน
// เส้นทาง cli ข้างล่างคือ "ผู้ใช้รันเครื่องมือของตัวเองบนเครื่องตัวเอง" ซึ่งถูกต้องตามกติกา
//
// TTS ใช้ทางนี้ไม่ได้ — CLI ทั้งสามตัวคืนข้อความอย่างเดียว การพากย์เสียงยังต้องใช้ Gemini API key
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * คีย์อาจอยู่ใน .env โดยที่ยังไม่ถูกโหลดเข้า process.env (เซิร์ฟเวอร์โหลดตอนรัน pipeline เท่านั้น)
 * ถ้าอ่านแค่ process.env หน้าตั้งค่าจะรายงานผิดว่า "ยังไม่ได้ใส่คีย์" ทั้งที่ใส่แล้ว
 */
function envFileValues(envFile = path.join(WORKSPACE_ROOT, ".env")) {
  try {
    const values = {};
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      let value = match[2].trim().replace(/\s+#.*$/, "");
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) values[match[1]] = value;
    }
    return values;
  } catch {
    return {};
  }
}

/** process.env ชนะเสมอ ส่วน .env เป็นตัวเติมช่องที่ยังว่าง */
export function resolvedEnvironment(environment = process.env) {
  return { ...envFileValues(), ...Object.fromEntries(Object.entries(environment).filter(([, value]) => value)) };
}

export const SCRIPT_PROVIDERS = [
  {
    id: "gemini",
    kind: "api",
    label: "Google Gemini",
    note: "ใช้คีย์ตัวเดียวกับที่ ClipPang ใช้พากย์เสียงอยู่แล้ว",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    keyName: "GEMINI_API_KEY",
    modelEnv: "GEMINI_SCRIPT_MODEL",
    defaultModel: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "claude",
    kind: "api",
    label: "Anthropic Claude",
    note: "เขียนคอปปี้ขายของภาษาไทยได้เป็นธรรมชาติที่สุดจากที่ทดสอบมา",
    envKeys: ["ANTHROPIC_API_KEY"],
    keyName: "ANTHROPIC_API_KEY",
    modelEnv: "SCRIPT_MODEL",
    defaultModel: "claude-sonnet-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    kind: "api",
    label: "OpenAI",
    envKeys: ["OPENAI_API_KEY"],
    keyName: "OPENAI_API_KEY",
    modelEnv: "OPENAI_SCRIPT_MODEL",
    defaultModel: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    kind: "api",
    label: "OpenRouter",
    note: "คีย์เดียวเรียกได้หลายรุ่น เปลี่ยนชื่อรุ่นได้ในช่องด้านล่าง",
    envKeys: ["OPENROUTER_API_KEY"],
    keyName: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_SCRIPT_MODEL",
    defaultModel: "anthropic/claude-sonnet-4.5",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "claude-cli",
    kind: "cli",
    label: "Claude Code (ใช้ subscription ที่ล็อกอินไว้)",
    command: "claude",
    args: ["-p", "--output-format", "text"],
    versionArgs: ["--version"],
    installUrl: "https://claude.com/claude-code",
  },
  {
    id: "codex-cli",
    kind: "cli",
    label: "Codex CLI (ใช้ subscription ที่ล็อกอินไว้)",
    command: "codex",
    args: ["exec", "-"],
    versionArgs: ["--version"],
    installUrl: "https://developers.openai.com/codex/cli",
  },
  {
    id: "gemini-cli",
    kind: "cli",
    label: "Gemini CLI (ใช้ subscription ที่ล็อกอินไว้)",
    command: "gemini",
    args: [],
    versionArgs: ["--version"],
    installUrl: "https://github.com/google-gemini/gemini-cli",
  },
];

export const getProvider = (id) => SCRIPT_PROVIDERS.find((provider) => provider.id === id) ?? null;

export const providerModel = (provider, environment = process.env) =>
  (provider.modelEnv ? environment[provider.modelEnv] : null) || provider.defaultModel || null;

const readEnvKey = (provider, environment = process.env) => {
  for (const name of provider.envKeys ?? []) {
    const value = environment[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
};

/* ---------- ตรวจว่า CLI ติดตั้งไว้ไหม ---------- */

const cliProbeCache = new Map();

function runProcess(command, args, { input = null, timeoutMs = 8000, signal } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // shell: true จำเป็นบน Windows เพราะ CLI พวกนี้ติดตั้งมาเป็น .cmd/.ps1 shim
      child = spawn(command, args, { shell: process.platform === "win32", windowsHide: true });
    } catch (error) {
      return resolve({ ok: false, code: -1, stdout: "", stderr: String(error?.message || error) });
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: -1, stdout, stderr: `หมดเวลา ${Math.round(timeoutMs / 1000)} วินาที` });
    }, timeoutMs);
    signal?.addEventListener("abort", () => {
      child.kill();
      finish({ ok: false, code: -1, stdout, stderr: "ยกเลิกแล้ว" });
    }, { once: true });

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: -1, stdout, stderr: String(error?.message || error) }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout, stderr }));

    if (input != null) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    } else {
      child.stdin?.end();
    }
  });
}

export async function probeCliProvider(provider, { refresh = false } = {}) {
  if (!refresh && cliProbeCache.has(provider.id)) return cliProbeCache.get(provider.id);
  const result = await runProcess(provider.command, provider.versionArgs ?? ["--version"], { timeoutMs: 8000 });
  const version = (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.slice(0, 60) ?? "";
  const status = result.ok
    ? { installed: true, version }
    : { installed: false, version: "", reason: `ไม่พบคำสั่ง ${provider.command} บนเครื่องนี้` };
  cliProbeCache.set(provider.id, status);
  return status;
}

/**
 * สถานะของทุกผู้ให้บริการ — ไม่คืนค่าคีย์เต็มออกไปเด็ดขาด คืนแค่ 4 ตัวท้าย
 */
export async function detectScriptProviders({ environment, refresh = false } = {}) {
  environment = resolvedEnvironment(environment ?? process.env);
  return Promise.all(
    SCRIPT_PROVIDERS.map(async (provider) => {
      const base = {
        id: provider.id,
        kind: provider.kind,
        label: provider.label,
        note: provider.note ?? null,
        model: providerModel(provider, environment),
        defaultModel: provider.defaultModel ?? null,
      };
      if (provider.kind === "api") {
        const key = readEnvKey(provider, environment);
        return {
          ...base,
          keyName: provider.keyName,
          keyUrl: provider.keyUrl,
          available: Boolean(key),
          keyConfigured: Boolean(key),
          keyLast4: key ? key.slice(-4) : null,
          reason: key ? null : "ยังไม่ได้ใส่ API key",
        };
      }
      const probe = await probeCliProvider(provider, { refresh });
      return {
        ...base,
        command: provider.command,
        installUrl: provider.installUrl,
        available: probe.installed,
        version: probe.version || null,
        reason: probe.installed ? null : probe.reason,
      };
    }),
  );
}

/** ผู้ให้บริการตัวแรกที่ใช้ได้จริง เรียงตามลำดับความชอบ */
export async function pickAvailableProvider({ preferred = "auto", environment = process.env } = {}) {
  const statuses = await detectScriptProviders({ environment });
  if (preferred && preferred !== "auto") {
    const chosen = statuses.find((status) => status.id === preferred);
    if (chosen?.available) return chosen.id;
    if (chosen) throw new Error(`ใช้ ${chosen.label} ไม่ได้: ${chosen.reason}`);
  }
  // CLI มาก่อนเพราะผู้ใช้จ่าย subscription ไปแล้ว เรียกเพิ่มไม่มีค่าใช้จ่ายต่อครั้ง
  const order = ["claude-cli", "codex-cli", "gemini-cli", "claude", "openai", "openrouter", "gemini"];
  for (const id of order) {
    if (statuses.find((status) => status.id === id)?.available) return id;
  }
  return "template";
}

/* ---------- ตัวเรียกจริง ---------- */

/** OpenAI และ OpenRouter ใช้รูปแบบ chat/completions เหมือนกัน */
export async function callOpenAICompatible(provider, { system, user, signal, timeoutMs = 45_000, environment = process.env }) {
  const key = readEnvKey(provider, environment);
  const model = providerModel(provider, environment);
  const signals = [signal, AbortSignal.timeout(timeoutMs)].filter(Boolean);
  const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
  if (provider.id === "openrouter") {
    // OpenRouter ขอให้ระบุแอปที่เรียก เพื่อให้เห็นในหน้า usage ของผู้ใช้เอง
    headers["http-referer"] = "https://github.com/clippang";
    headers["x-title"] = "ClipPang";
  }
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
    }),
    signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
  });
  if (!response.ok) throw new Error(`${provider.label} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`${provider.label} ไม่ได้ส่งข้อความกลับมา`);
  return { text, model };
}

/** ส่ง prompt เข้า stdin ของ CLI แล้วอ่าน stdout — ไม่ผ่าน shell argument จึงไม่มีปัญหาการ escape */
export async function callCliProvider(provider, { system, user, signal, timeoutMs = 120_000 }) {
  const probe = await probeCliProvider(provider);
  if (!probe.installed) throw new Error(`ยังไม่ได้ติดตั้ง ${provider.command} — ดูวิธีที่ ${provider.installUrl}`);
  const result = await runProcess(provider.command, provider.args ?? [], {
    input: `${system}\n\n${user}\n`,
    timeoutMs,
    signal,
  });
  if (!result.ok) {
    const detail = (result.stderr || result.stdout || "").trim().slice(0, 300);
    throw new Error(`${provider.label} ทำงานไม่สำเร็จ: ${detail || `exit ${result.code}`}`);
  }
  const text = result.stdout.trim();
  if (!text) throw new Error(`${provider.label} ไม่ได้ส่งข้อความกลับมา (อาจยังไม่ได้ล็อกอิน — ลองรัน ${provider.command} ในเทอร์มินัลก่อน)`);
  return { text, model: `${provider.command} (subscription)` };
}

/** ดึงก้อน JSON ก้อนแรกออกจากข้อความที่โมเดลตอบ — CLI มักห่อด้วย markdown fence */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ผู้ให้บริการไม่ได้ตอบเป็น JSON ที่อ่านได้");
  return JSON.parse(source.slice(start, end + 1));
}
