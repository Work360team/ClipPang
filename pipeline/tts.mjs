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
import { buildBatchPrompt, cutSpans, splitOnSilence } from "./tts-batch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ป้าย gender มาจากการวัด F0 ของเสียงตัวอย่างจริง ไม่ใช่จากเอกสารของ Google
 * ซึ่งระบุไว้แค่ลักษณะเสียง (Bright, Firm, …) ไม่ได้บอกเพศ
 * ตรวจซ้ำได้ด้วย scripts/audit-voice-gender.mjs
 */
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


/** ลองใหม่ได้กี่ครั้งเมื่อโมเดลไม่คืนเสียงโดยไม่มีเหตุผลที่แก้ได้ */
const MAX_NO_AUDIO_RETRIES = 3;

/** อธิบายว่าทำไม Gemini ตอบ 200 แต่ไม่มีเสียง โดยอิงข้อมูลที่ API ส่งกลับมาจริง */
function ttsNoAudioMessage({ blocked, finish, spoken, text, attempts = 1 }) {
  const excerpt = String(text || "").slice(0, 40);
  if (blocked) return `Gemini ปฏิเสธข้อความนี้ (${blocked}) — ลองแก้คำในท่อน "${excerpt}…" แล้วสั่งใหม่`;
  if (finish === "MAX_TOKENS") return `ท่อน "${excerpt}…" ยาวเกินกว่าที่โมเดลจะพากย์ได้ในครั้งเดียว ลองตัดให้สั้นลง`;
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") return `Gemini ตีว่าท่อน "${excerpt}…" ผิดนโยบายเนื้อหา ลองเปลี่ยนคำแล้วสั่งใหม่`;
  if (finish === "RECITATION") return `Gemini ตีว่าท่อน "${excerpt}…" ลอกข้อความมีลิขสิทธิ์ ลองเขียนใหม่ด้วยคำของเราเอง`;
  if (spoken) return `Gemini ตอบกลับเป็นข้อความแทนเสียงแม้สั่งย้ำแล้ว: "${spoken.slice(0, 80)}" — ลองแก้ท่อนนี้ให้เป็นประโยคบอกเล่า`;
  return `Gemini ไม่คืนเสียงกลับมา ${attempts} ครั้งติด (finishReason=${finish ?? "ไม่ระบุ"}) `
    + `อาการนี้เป็นที่ฝั่งโมเดลไม่ใช่ที่ข้อความของเรา รอสักครู่แล้วกดสร้างใหม่มักจะผ่าน`;
}

async function geminiTts({ text, voice, styleHint, signal, timeoutMs, geminiEnv, onRequest, promptOverride }, rawFile) {
  const prompt = promptOverride || (styleHint ? `${styleHint}: ${text}` : text);
  // โมเดลตอบกลับเป็นข้อความแทนเสียงได้ ถ้าท่อนนั้นอ่านแล้วเหมือนคำถามหรือคำสั่ง
  // (Google เรียกอาการนี้ว่า "Model tried to generate text") สั่งย้ำให้อ่านตามตัวอักษร
  // แล้วลองใหม่หนึ่งรอบ ดีกว่าทิ้งงานเรนเดอร์ทั้งงานเพราะท่อนเดียว
  const strictPrompt = promptOverride || `Read the following text aloud, verbatim and in its original language. Do not answer it, translate it, or add words.${styleHint ? ` Style: ${styleHint}.` : ""}

${text}`;
  let useStrictPrompt = false;
  let noAudioRetries = 0;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`;
  const requestTimeoutMs = Number(timeoutMs ?? process.env.GEMINI_TTS_TIMEOUT_MS ?? 45_000);

  // geminiEnv = คีย์ของผู้ใช้คนที่สั่งงานนี้ ถ้าไม่ส่งมาก็ใช้คีย์ของเครื่องตามเดิม
  // โควตาของ Google ผูกกับคีย์ การใช้คีย์คนละชุดจึงเป็นการแยกโควตาจริง ๆ
  const keys = listGeminiKeys(geminiEnv);
  if (!keys.length) {
    throw new Error(geminiEnv
      ? "บัญชีนี้ยังไม่ได้ใส่คีย์ Gemini ของตัวเอง — เพิ่มได้ในหน้าตั้งค่า"
      : "ยังไม่ได้ตั้ง GEMINI_API_KEY ใน .env");
  }

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
    // นับก่อนยิง: คำขอที่โดน 429 ก็ถูกนับที่ฝั่ง Google เหมือนกัน การนับหลังสำเร็จ
    // อย่างเดียวจะทำให้ตัวเลขต่ำกว่าความจริงตอนโควตาใกล้หมด
    onRequest?.();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: useStrictPrompt ? strictPrompt : prompt }] }],
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
    const candidate = data?.candidates?.[0];
    const part = candidate?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) {
      // ตอบ 200 แต่ไม่มีเสียง เกิดได้หลายสาเหตุ อย่าเดาว่าเป็น safety filter เสมอ
      const spoken = candidate?.content?.parts?.find((p) => p.text)?.text?.trim();
      const blocked = data?.promptFeedback?.blockReason;
      const finish = candidate?.finishReason;
      if (spoken && !useStrictPrompt) {
        useStrictPrompt = true;
        if (process.env.TTS_VERBOSE) process.stderr.write("   [tts] ได้ข้อความแทนเสียง → สั่งย้ำให้อ่านตามตัวอักษรแล้วลองใหม่\n");
        continue;
      }

      // finishReason=OTHER คือโมเดลพลาดเอง ไม่ใช่ปัญหาที่ข้อความ — ท่อนเดียวกันส่งซ้ำ
      // แล้วได้เสียงตามปกติ จึงต้องลองใหม่ ไม่ใช่ล้มทั้งงานเพราะโมเดลสะดุดหนึ่งครั้ง
      // ต่างจาก SAFETY/RECITATION/MAX_TOKENS ที่ส่งซ้ำอีกกี่ครั้งก็ได้ผลเดิม
      const permanent = Boolean(blocked) || ["SAFETY", "PROHIBITED_CONTENT", "RECITATION", "MAX_TOKENS"].includes(finish);
      if (!permanent && noAudioRetries < MAX_NO_AUDIO_RETRIES && attempt < maxAttempts - 1) {
        noAudioRetries += 1;
        lastErr = new Error(ttsNoAudioMessage({ blocked, finish, spoken, text }));
        if (process.env.TTS_VERBOSE) {
          process.stderr.write(`   [tts] ไม่มีเสียงกลับมา (finishReason=${finish ?? "-"}) → ลองใหม่ครั้งที่ ${noAudioRetries}\n`);
        }
        await abortableDelay(1200 * noAudioRetries + Math.random() * 500, signal);
        continue;
      }
      throw new Error(ttsNoAudioMessage({ blocked, finish, spoken, text, attempts: noAudioRetries + 1 }));
    }
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
/**
 * ทำให้ไฟล์เสียงเป็นรูปแบบเดียวกันทุก provider + เร่ง/ลดความเร็ว
 * แยกออกมาเพราะทางที่รวมหลายท่อนเป็นคำขอเดียวก็ต้องผ่านขั้นตอนนี้เหมือนกัน
 */
async function normalizeAudio(rawFile, outFile, { provider, speed, signal, timeoutMs }) {
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
}

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
  geminiEnv,
  onRequest,
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
    const providerOpts = { text, voice, speed, styleHint, signal, timeoutMs, geminiEnv, onRequest };
    if (provider === "gemini") await geminiTts(providerOpts, rawFile);
    else if (provider === "edge") await edgeTts(providerOpts, rawFile);
    else if (provider === "silence") await silenceTts(providerOpts, rawFile);
    else if (provider === "mock") await mockTts(providerOpts, rawFile);
    else throw new Error(`ไม่รู้จัก TTS provider: ${provider}`);

    await normalizeAudio(rawFile, outFile, { provider, speed, signal, timeoutMs });
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

/** ไฟล์แคชของท่อนหนึ่ง — กติกาเดียวกับใน synthesize() */
function cachePathFor({ provider, voice, speed, styleHint, text }, cacheDir) {
  if (!cacheDir) return null;
  const key = sha256([provider, voice, speed, styleHint, text].join(" ")).slice(0, 32);
  return path.join(cacheDir, `${key}.wav`);
}

/**
 * ยิงทุกท่อนที่ยังไม่มีในแคชด้วยคำขอเดียว แล้วตัดเสียงกลับเป็นรายท่อน
 *
 * คืน true เมื่อสำเร็จครบทุกท่อน — ถ้าตัดกลับไม่ลงตัวจะคืน false โดยไม่เขียนไฟล์อะไรเลย
 * ให้ผู้เรียกถอยไปยิงทีละท่อนตามเดิม ยอมเสียหนึ่งคำขอดีกว่าปล่อยเสียงเลื่อนไม่ตรงซับ
 */
async function tryBatchSynthesize(items, opts) {
  const { provider, voice, speed, styleHint = "", cacheDir, signal, timeoutMs, geminiEnv, onRequest } = opts;
  // โฟลเดอร์ปลายทางกับแคชต้องมีก่อน — ทางเดิมสร้างไว้ใน synthesize() ซึ่งทางนี้ไม่ได้ผ่าน
  for (const item of items) ensureDir(path.dirname(item.outFile));
  if (cacheDir) ensureDir(cacheDir);
  const scratch = `${items[0].outFile}.batch.wav`;
  try {
    await geminiTts({
      text: items.map((item) => item.text).join(" "),
      voice, styleHint, signal, timeoutMs, geminiEnv, onRequest,
      promptOverride: buildBatchPrompt(items.map((item) => item.text), styleHint),
    }, scratch);

    const spans = await splitOnSilence(scratch, items.length, { signal, timeoutMs });
    if (!spans) return false;

    const rawFiles = items.map((item) => `${item.outFile}.seg.wav`);
    try {
      await cutSpans(scratch, spans, rawFiles, { signal, timeoutMs });
      for (let i = 0; i < items.length; i += 1) {
        await normalizeAudio(rawFiles[i], items[i].outFile, { provider, speed, signal, timeoutMs });
        const cached = cachePathFor({ provider, voice, speed, styleHint, text: items[i].text }, cacheDir);
        if (cached) fs.copyFileSync(items[i].outFile, cached);
      }
    } finally {
      for (const file of rawFiles) fs.rmSync(file, { force: true });
    }
    return true;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

/** ยิงหลายท่อนพร้อมกันแบบจำกัดจำนวน (กัน rate limit ของ provider) */
export async function synthesizeAll(items, opts, concurrency = 4, onEach = () => {}) {
  if (!items.length) return [];
  // จำนวนท่อนที่ได้เสียงมาจากคำขอเดียว ติดไปกับผลลัพธ์เพื่อให้รายงานบอกได้ว่าประหยัดจริงไหม
  let batchedCount = 0;

  // รวมเป็นคำขอเดียวก่อน ถ้าทำได้ — free tier ให้ 10 คำขอต่อวันต่อคีย์ คลิปหนึ่งมี
  // สคริปต์ราว 9 ท่อน การยิงทีละท่อนจึงกินโควตาทั้งวันไปกับคลิปเดียว
  // ท่อนที่มีในแคชแล้วไม่ต้องนับ เพราะไม่ได้ยิงอยู่แล้ว
  if (opts?.provider === "gemini" && items.length > 1 && process.env.GEMINI_TTS_BATCH !== "0") {
    const pending = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const cached = cachePathFor({ ...opts, ...item }, opts.cacheDir);
        return !(cached && fs.existsSync(cached));
      });
    if (pending.length > 1) {
      try {
        const ok = await tryBatchSynthesize(pending.map(({ item }) => ({ ...opts, ...item })), opts);
        if (ok) batchedCount = pending.length;
        if (ok && process.env.TTS_VERBOSE) {
          process.stderr.write(`   [tts] รวม ${pending.length} ท่อนเป็นคำขอเดียวสำเร็จ
`);
        }
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "PROCESS_TIMEOUT") throw error;
        // รวมไม่สำเร็จก็ไม่เป็นไร ด้านล่างจะยิงทีละท่อนตามเดิม
        if (process.env.TTS_VERBOSE) process.stderr.write(`   [tts] รวมคำขอไม่สำเร็จ (${error.message}) → ยิงทีละท่อน
`);
      }
    }
  }

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
  Object.defineProperty(results, "batchedCount", { value: batchedCount, enumerable: false });
  return results;
}
