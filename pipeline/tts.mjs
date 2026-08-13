// tts — TTSProvider interface + 3 ผู้ให้บริการ  →  อนาคตคือ packages/ai/tts
//
// สัญญาเดียวกันทุกเจ้า:  synthesize({text, voice, speed}) → ไฟล์ WAV 24kHz mono
// ความยาวที่คืนมา "วัดจากไฟล์จริง" เสมอ ไม่ใช่ค่าประมาณ  (นี่คือหัวใจของ chunked TTS)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durationMs, ensureDir, ffmpeg, run, sha256, throwIfAborted, toAbortError } from "./lib.mjs";
import { keyQuotaStatus, noteQuotaOk, noteRateLimited } from "./tts-quota.mjs";
import { listGeminiKeys } from "./gemini-keys.mjs";
import { graphemeCount } from "./core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VOICES = {
  gemini: [
    { id: "Zephyr", label: "สว่าง เป็นมิตร", gender: "หญิง" },
    { id: "Puck", label: "สนุก กระฉับกระเฉง", gender: "ชาย" },
    { id: "Charon", label: "ให้ข้อมูล ชัดถ้อยชัดคำ", gender: "ชาย" },
    { id: "Kore", label: "หนักแน่น น่าเชื่อถือ", gender: "หญิง" },
    { id: "Fenrir", label: "ตื่นเต้น มีพลัง", gender: "ชาย" },
    { id: "Leda", label: "อ่อนเยาว์ สดใส", gender: "หญิง" },
    { id: "Orus", label: "มั่นคง หนักแน่น", gender: "ชาย" },
    { id: "Aoede", label: "โปร่ง สบาย ๆ", gender: "หญิง" },
    { id: "Callirrhoe", label: "ผ่อนคลาย ฟังง่าย", gender: "หญิง" },
    { id: "Autonoe", label: "สว่าง ชัดเจน", gender: "หญิง" },
    { id: "Enceladus", label: "นุ่ม มีลมหายใจ", gender: "ชาย" },
    { id: "Iapetus", label: "ชัดเจน อ่านง่าย", gender: "ชาย" },
    { id: "Umbriel", label: "สบาย ๆ เป็นธรรมชาติ", gender: "ชาย" },
    { id: "Algieba", label: "ลื่นไหล นุ่มนวล", gender: "ชาย" },
    { id: "Despina", label: "นุ่มลื่น สุภาพ", gender: "หญิง" },
    { id: "Erinome", label: "ใส ชัดถ้อยชัดคำ", gender: "หญิง" },
    { id: "Algenib", label: "แหบเท่ มีเอกลักษณ์", gender: "ชาย" },
    { id: "Rasalgethi", label: "ให้ข้อมูล เป็นมืออาชีพ", gender: "ชาย" },
    { id: "Laomedeia", label: "ร่าเริง กระฉับกระเฉง", gender: "หญิง" },
    { id: "Achernar", label: "อ่อนโยน นุ่มฟังสบาย", gender: "หญิง" },
    { id: "Alnilam", label: "หนักแน่น มั่นใจ", gender: "ชาย" },
    { id: "Schedar", label: "เรียบสม่ำเสมอ", gender: "ชาย" },
    { id: "Gacrux", label: "เป็นผู้ใหญ่ สุขุม", gender: "หญิง" },
    { id: "Pulcherrima", label: "ตรงไปตรงมา เด่นชัด", gender: "หญิง" },
    { id: "Achird", label: "เป็นมิตร เข้าถึงง่าย", gender: "ชาย" },
    { id: "Zubenelgenubi", label: "กันเอง ไม่เป็นทางการ", gender: "ชาย" },
    { id: "Vindemiatrix", label: "อ่อนโยน ละมุน", gender: "หญิง" },
    { id: "Sadachbia", label: "มีชีวิตชีวา สนุก", gender: "ชาย" },
    { id: "Sadaltager", label: "รอบรู้ น่าเชื่อถือ", gender: "ชาย" },
    { id: "Sulafat", label: "อบอุ่น เป็นกันเอง", gender: "หญิง" },
  ],
  edge: [
    { id: "th-TH-PremwadeeNeural", label: "หญิงไทย เป็นมิตร" },
    { id: "th-TH-NiwatNeural", label: "ชายไทย เป็นมิตร" },
  ],
  mock: [{ id: "mock-th", label: "เสียงทดสอบออฟไลน์ (tone สั้นตามความยาวข้อความ)" }],
  silence: [{ id: "-", label: "ไม่มีเสียง (ทดสอบ pipeline)" }],
};

export const DEFAULT_VOICE = {
  gemini: "Kore",
  edge: "th-TH-PremwadeeNeural",
  mock: "mock-th",
  silence: "-",
};

/** เลือก provider ที่ใช้ได้จริงในเครื่องนี้ ตามลำดับความชอบ */
export function resolveProvider(requested = "auto") {
  const has = {
    // นับทุกช่องคีย์ ไม่ใช่แค่ใบหลัก — ผู้ใช้ที่ลบใบแรกออกแต่ยังมีใบสำรองต้องใช้งานได้
    gemini: listGeminiKeys().length > 0,
    edge: fs.existsSync(pythonBin()),
    mock: true,
    silence: true,
  };
  if (requested !== "auto") {
    if (!has[requested]) {
      const why = requested === "gemini"
        ? "ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env"
        : requested === "edge"
          ? "ยังไม่ได้ติดตั้ง edge-tts (ดู README)"
          : `ไม่รู้จัก provider ${requested}`;
      throw new Error(`ใช้ --tts ${requested} ไม่ได้: ${why}`);
    }
    return requested;
  }
  return has.gemini ? "gemini" : has.edge ? "edge" : "mock";
}

function pythonBin() {
  if (process.env.EDGE_TTS_PYTHON) return path.resolve(process.env.EDGE_TTS_PYTHON);
  return process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");
}

/* ---------- Gemini (ตัวหลักตาม blueprint) ---------- */

const geminiModel = () => process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

function wavFromPcm(pcm, { rate = 24000, channels = 1, bits = 16 } = {}) {
  const header = Buffer.alloc(44);
  const byteRate = (rate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(toAbortError(signal?.reason));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function geminiTts({ text, voice, styleHint, signal, timeoutMs }, rawFile) {
  const prompt = styleHint ? `${styleHint}: ${text}` : text;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`;
  const requestTimeoutMs = Number(timeoutMs ?? process.env.GEMINI_TTS_TIMEOUT_MS ?? 45_000);

  const keys = listGeminiKeys();
  if (!keys.length) throw new Error("ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env");

  // ลองได้อย่างน้อยหนึ่งรอบต่อคีย์ บวกอีกสองรอบไว้เผื่อ backoff ของคีย์สุดท้าย
  const maxAttempts = keys.length + 4;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(signal);

    // เลือกคีย์ใบแรกที่ยังไม่ติดโควตา ถ้าติดหมดค่อยกลับไปใช้ใบที่จะคืนเร็วที่สุด
    const usable = keys.filter((entry) => !keyQuotaStatus(entry.id).limited);
    const entry = usable[0] ?? keys
      .map((item) => ({ item, wait: keyQuotaStatus(item.id).retryInMs ?? 0 }))
      .sort((a, b) => a.wait - b.wait)[0].item;
    const key = entry.key;

    const signals = [signal, AbortSignal.timeout(requestTimeoutMs)].filter(Boolean);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });

    if (res.status === 429 || res.status >= 500) {
      const body = await res.text();
      lastErr = new Error(`Gemini TTS ${res.status} (คีย์ ••${entry.last4}): ${body.slice(0, 240)}`);
      // Google บอกมาเองว่าให้รอกี่วินาที — เชื่อค่านั้นก่อน exponential backoff ของเรา
      const hinted = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1] || 0);
      const waitMs = Math.min(60_000, hinted ? hinted * 1000 + 800 : 2000 * 2 ** attempt);
      if (res.status === 429) {
        noteRateLimited({ provider: "gemini", keyId: entry.id, retryAfterMs: waitMs, detail: body.slice(0, 1200) });
      }

      // มีคีย์อื่นที่ยังว่างอยู่ → สลับไปใช้ทันที ไม่ต้องนั่งรอ backoff ของคีย์ที่เพิ่งเต็ม
      // นี่คือเหตุผลหลักที่ทำ multi-key: คีย์ใบหนึ่งหมดโควตาไม่ควรหยุดงานทั้งงาน
      const hasSpare = keys.some((item) => item.id !== entry.id && !keyQuotaStatus(item.id).limited);
      if (process.env.TTS_VERBOSE) {
        process.stderr.write(
          `   [tts] ${res.status} คีย์ ••${entry.last4} ${hasSpare ? "→ สลับคีย์ถัดไปทันที" : `รออีก ${Math.round(waitMs / 1000)}s`}\n`,
        );
      }
      if (hasSpare) continue;
      await abortableDelay(waitMs + Math.random() * 400, signal);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) throw new Error("Gemini TTS ไม่ได้คืนเสียงกลับมา (อาจโดน safety filter)");
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || "")?.[1] || 24000);
    fs.writeFileSync(rawFile, wavFromPcm(Buffer.from(part.inlineData.data, "base64"), { rate }));
    noteQuotaOk(entry.id);
    return rawFile;
  }
  throw lastErr;
}

/* ---------- Edge (ฟรี ไม่ต้องมี key — สำหรับ spike เท่านั้น) ---------- */

async function edgeTts({ text, voice, speed, signal, timeoutMs }, rawFile) {
  const pct = Math.round((speed - 1) * 100);
  const rate = `${pct >= 0 ? "+" : ""}${pct}%`;
  await run(pythonBin(), [
    "-m", "edge_tts",
    "--voice", voice,
    `--rate=${rate}`,
    "--text", text,
    "--write-media", rawFile,
  ], {
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    signal,
    timeoutMs: Number(timeoutMs ?? process.env.EDGE_TTS_TIMEOUT_MS ?? 60_000),
  });
  return rawFile;
}

/* ---------- Silence (ออฟไลน์ล้วน ใช้ตรวจว่า pipeline ทั้งเส้นเดินได้) ---------- */

async function silenceTts({ text, signal, timeoutMs }, rawFile) {
  const sec = Math.max(0.6, graphemeCount(text) / 13);
  await ffmpeg([
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-t", sec.toFixed(3),
    "-c:a", "pcm_s16le",
    "-y", rawFile,
  ], { signal, timeoutMs });
  return rawFile;
}

/** Deterministic local provider for tests and no-key development. */
async function mockTts({ text, signal, timeoutMs }, rawFile) {
  const sec = Math.max(0.65, graphemeCount(text) / 8.2);
  await ffmpeg([
    "-f", "lavfi",
    "-i", `sine=frequency=220:sample_rate=24000:duration=${sec.toFixed(3)}`,
    "-af", "volume=0.018",
    "-c:a", "pcm_s16le",
    "-y", rawFile,
  ], { signal, timeoutMs });
  return rawFile;
}

/* ---------- ทางเข้าเดียว ---------- */

/**
 * สร้างเสียงหนึ่งท่อน แล้วคืนความยาวจริงที่วัดจากไฟล์
 * cache key ผูกกับ provider+voice+speed+text → พูดประโยคเดิมซ้ำไม่เสียเงินอีก
 */
export async function synthesize({
  text,
  provider,
  voice,
  speed = 1,
  styleHint = "",
  outFile,
  cacheDir,
  signal,
  timeoutMs,
}) {
  throwIfAborted(signal);
  if (!text?.trim()) throw new Error("TTS text ต้องไม่ว่าง");
  if (!outFile) throw new Error("TTS ต้องระบุ outFile");
  provider = provider || resolveProvider("auto");
  voice = voice || DEFAULT_VOICE[provider];
  speed = Number(speed);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error("TTS speed ต้องอยู่ระหว่าง 0.5–2.0");
  }
  ensureDir(path.dirname(outFile));
  if (cacheDir) ensureDir(cacheDir);

  const key = sha256([provider, voice, speed, styleHint, text].join(" ")).slice(0, 32);
  const cached = cacheDir ? path.join(cacheDir, `${key}.wav`) : null;

  if (cached && fs.existsSync(cached)) {
    try {
      fs.copyFileSync(cached, outFile);
      return {
        file: outFile,
        durationMs: await durationMs(outFile, { signal }),
        cached: true,
        provider,
        voice,
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      fs.rmSync(cached, { force: true });
      fs.rmSync(outFile, { force: true });
    }
  }

  const rawFile = `${outFile}.raw.wav`;
  try {
    const providerOpts = { text, voice, speed, styleHint, signal, timeoutMs };
    if (provider === "gemini") await geminiTts(providerOpts, rawFile);
    else if (provider === "edge") await edgeTts(providerOpts, rawFile);
    else if (provider === "silence") await silenceTts(providerOpts, rawFile);
    else if (provider === "mock") await mockTts(providerOpts, rawFile);
    else throw new Error(`ไม่รู้จัก TTS provider: ${provider}`);

    // ทำให้เป็นรูปแบบเดียวกันทุกเจ้า + เร่ง/ลดความเร็วสำหรับเจ้าที่ไม่มี rate ในตัว
    const filters = provider === "silence" || provider === "mock"
      ? []
      : ["silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05"];
    if (provider !== "edge" && Math.abs(speed - 1) > 0.01) filters.push(`atempo=${speed.toFixed(3)}`);
    await ffmpeg([
      "-i", rawFile,
      ...(filters.length ? ["-af", filters.join(",")] : []),
      "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
      "-y", outFile,
    ], { signal, timeoutMs });
  } finally {
    fs.rmSync(rawFile, { force: true });
  }

  if (cached) fs.copyFileSync(outFile, cached);
  return {
    file: outFile,
    durationMs: await durationMs(outFile, { signal }),
    cached: false,
    provider,
    voice,
  };
}

/**
 * จำนวนที่ยิงพร้อมกันได้ต่อ provider
 * Gemini TTS ยัง preview และโควตา free tier ต่ำมาก — ยิงทีละคำขอปลอดภัยที่สุด
 * ตั้ง GEMINI_TTS_CONCURRENCY ใน .env เพื่อเร่งเมื่อขึ้น paid tier
 */
export function concurrencyFor(provider) {
  if (provider === "gemini") return Number(process.env.GEMINI_TTS_CONCURRENCY || 1);
  return 4;
}

/** ยิงหลายท่อนพร้อมกันแบบจำกัดจำนวน (กัน rate limit ของ provider) */
export async function synthesizeAll(items, opts, concurrency = 4, onEach = () => {}) {
  if (!items.length) return [];
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  let failed = false;
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      if (failed) return;
      throwIfAborted(opts?.signal);
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = await synthesize({ ...opts, ...items[idx] });
        completed += 1;
        await onEach(completed, items.length, results[idx], idx);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  // Wait for already-running siblings to stop before the caller removes its
  // work directory. Promise.all() would reject early and leave ffmpeg children
  // writing into a directory that cleanup is deleting.
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((result) => result.status === "rejected");
  if (rejected) throw rejected.reason;
  return results;
}
