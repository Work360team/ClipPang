// ทดสอบเส้นทาง Gemini TTS แยกเดี่ยว ๆ ก่อนเอาเข้า pipeline
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, ensureDir } from "../src/lib.mjs";
import { resolveProvider, synthesize } from "../src/tts.mjs";
import { graphemeCount } from "../src/core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

const lines = [
  "หนีบติดคันชักกระเป๋าได้เลย",
  "พับเก็บได้ ไม่เกะกะ",
  "กดตะกร้าส้มด้านล่างเลย",
];

console.log("provider ที่เลือกอัตโนมัติ:", resolveProvider("auto"));
const dir = ensureDir(path.join(ROOT, ".cache", "probe"));

let g = 0;
let ms = 0;
for (const [i, text] of lines.entries()) {
  const t0 = Date.now();
  const r = await synthesize({
    text,
    provider: "gemini",
    voice: process.argv[2] || "Kore",
    speed: 1,
    styleHint: "พูดโทนสนุก เป็นกันเอง แบบพรีเซนต์ขายของ",
    outFile: path.join(dir, `g${i}.wav`),
  });
  g += graphemeCount(text);
  ms += r.durationMs;
  console.log(
    `${String(i).padStart(2)} ${text.padEnd(28)} ${String(r.durationMs).padStart(5)}ms ` +
    `(ยิง ${Date.now() - t0}ms)`,
  );
}
console.log(`\nรวม ${g} grapheme / ${(ms / 1000).toFixed(2)}s → ${(g / (ms / 1000)).toFixed(2)} grapheme/sec`);
