// hyperframes — เลน B: คอมไพล์ timeline เป็น composition แล้วเรนเดอร์เป็นเลเยอร์ซับโปร่งใส
//                →  อนาคตคือ packages/media/hyperframes
//
// ต่างจากเลน A (libass เบิร์นลงภาพตรง ๆ) ตรงที่เลนนี้เรนเดอร์ "เฉพาะตัวหนังสือ" ออกมาเป็นไฟล์ที่มี
// alpha แล้วค่อยเอาไปวางทับด้วย ffmpeg — คลิปต้นฉบับจึงไม่ถูก re-encode ผ่าน Chrome
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ffprobe, run } from "./lib.mjs";
import { anchorMarginV, normalizeAnchor } from "./core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GSAP = path.join(ROOT, "vendor", "gsap.min.js");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ฝังฟอนต์เป็น data URI — เลี่ยงจุดที่พังเงียบที่สุดของการเรนเดอร์ใน headless Chrome */
function fontFace(family, file, weight) {
  const b64 = fs.readFileSync(file).toString("base64");
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;` +
    `src:url(data:font/ttf;base64,${b64}) format('truetype')}`;
}

export function compileComposition(timeline, style, { width, height, fps = 30 }) {
  const p = style.params;
  const fontFile = path.join(ROOT, "fonts", p.font.file);
  if (!fs.existsSync(fontFile)) {
    throw new Error(`ไม่พบฟอนต์ ${p.font.file} ใน spike/fonts — ดาวน์โหลดก่อน (ดู README)`);
  }

  const dur = (timeline.durationMs / 1000).toFixed(3);

  // marginV = ระยะห่างจากขอบที่ยึด ให้ตีความเหมือนเลน A เป๊ะ ๆ
  // (ก่อนหน้านี้เลนนี้คำนวณกลับด้านเป็น height - marginV สไตล์เดียวกันจึงไปโผล่คนละที่)
  const anchor = normalizeAnchor(p.position?.anchor);
  const marginV = anchorMarginV(anchor, p.position?.marginV);
  const placement =
    anchor === "top"
      ? `top: ${marginV}px; bottom: auto;`
      : anchor === "middle"
        ? "top: 50%; bottom: auto; transform: translateY(-50%);"
        : `bottom: ${marginV}px; top: auto;`;

  // ท่อนที่ยาวกว่าเกณฑ์จะย่อฟอนต์ลงพอดีหนึ่งบรรทัด — ปล่อยให้ตัดบรรทัดเองจะได้คำโดด ๆ ห้อยอยู่
  // (ประมาณจากจำนวน grapheme พอใช้ได้กับไทย เพราะความกว้างต่อตัวค่อนข้างสม่ำเสมอ)
  const FIT_CHARS = p.fitChars ?? 14;
  const fitScale = (n) => Math.max(0.68, Math.min(1, FIT_CHARS / Math.max(1, n)));

  const clips = timeline.chunks
    .map((c, ci) => {
      const spans = c.words
        .map((w, wi) => {
          // ช่องว่างเดิมถูกผนวกไว้ท้ายคำตอนตัดคำ จึงต้องดูจากข้อความต้นฉบับ ไม่ใช่ช่องว่างระหว่าง index
          const trailingSpace = /\s$/.test(c.text.slice(w.s, w.e));
          return (
            `<span class="w" id="c${ci}w${wi}">${esc(w.text)}</span>` +
            (trailingSpace ? '<span class="sp"> </span>' : "")
          );
        })
        .join("");
      const chars = c.words.reduce((n, w) => n + w.text.length, 0);
      const size = Math.round(p.font.size * fitScale(chars));
      return (
        `<div id="c${ci}" class="clip cap" data-start="${(c.startMs / 1000).toFixed(3)}" ` +
        `data-duration="${((c.endMs - c.startMs) / 1000).toFixed(3)}" data-track-index="0">` +
        `<div class="line" id="l${ci}" style="font-size:${size}px">${spans}</div></div>`
      );
    })
    .join("\n      ");

  const beats = [];
  timeline.chunks.forEach((c, ci) => {
    beats.push({ t: c.startMs / 1000, sel: `#l${ci}`, kind: "enter" });
    c.words.forEach((w, wi) => {
      beats.push({
        t: w.startMs / 1000,
        sel: `#c${ci}w${wi}`,
        kind: "on",
        color: w.emphasis && p.emphasisFill ? p.emphasisFill : p.activeFill,
      });
      beats.push({ t: w.endMs / 1000, sel: `#c${ci}w${wi}`, kind: "off" });
    });
  });

  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(style.name)}</title>
    <style>
      ${fontFace(p.font.family, fontFile, p.font.weight)}
      html, body { margin: 0; padding: 0; background: transparent; }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: transparent;
      }
      .cap {
        position: absolute;
        left: 0;
        right: 0;
        ${placement}
        display: flex;
        justify-content: center;
        padding: 0 ${p.position?.marginH ?? 80}px;
      }
      .line {
        display: flex;
        flex-wrap: nowrap;
        justify-content: center;
        align-items: flex-end;
        max-width: 100%;
        font-size: ${p.font.size}px;
      }
      .w, .sp {
        font-family: '${p.font.family}', sans-serif;
        font-weight: ${p.font.weight};
        font-size: inherit;
        line-height: 1.16;
        color: ${p.fill};
        -webkit-text-stroke: ${p.outline.width}px ${p.outline.color};
        paint-order: stroke fill;
        ${p.shadow ? `text-shadow: 0 ${p.shadow.offset}px 0 ${p.shadow.color};` : ""}
        display: inline-block;
        transform-origin: 50% 78%;
        white-space: pre;
      }
      .sp { -webkit-text-stroke: 0; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="captions"
      data-start="0"
      data-duration="${dur}"
      data-width="${width}"
      data-height="${height}"
      data-fps="${fps}"
    >
      ${clips}
    </div>

    <script>${fs.readFileSync(GSAP, "utf8")}</script>
    <script>
      (function () {
        gsap.defaults({ immediateRender: false });
        var FILL = ${JSON.stringify(p.fill)};
        var POP = ${JSON.stringify(p.animation?.scale ?? 1.12)};
        var POP_S = ${JSON.stringify((p.animation?.durationMs ?? 160) / 1000)};
        var BEATS = ${JSON.stringify(beats)};

        gsap.set(".w", { color: FILL, scale: 1, y: 0 });
        var tl = gsap.timeline({ paused: true });

        BEATS.forEach(function (b) {
          if (b.kind === "enter") {
            tl.fromTo(
              b.sel,
              { y: 34, opacity: 0, filter: "blur(6px)" },
              { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power3.out" },
              b.t,
            );
          } else if (b.kind === "on") {
            tl.set(b.sel, { color: b.color }, b.t);
            tl.fromTo(
              b.sel,
              { scale: POP, y: -8 },
              { scale: 1, y: 0, duration: POP_S, ease: "back.out(2.4)" },
              b.t,
            );
          } else {
            tl.set(b.sel, { color: FILL }, b.t);
          }
        });

        tl.set({}, {}, ${dur});
        tl.seek(0);
        window.__timelines = window.__timelines || {};
        window.__timelines.captions = tl;
      })();
    </script>
  </body>
</html>
`;
}

/**
 * เขียน project แล้วเรียก HyperFrames CLI เรนเดอร์เป็นไฟล์ที่มี alpha
 * คืน path ของไฟล์เลเยอร์ซับ (webm ถ้า alpha ใช้ได้ ไม่งั้นถอยไป mov/ProRes 4444)
 */
export async function renderOverlay(timeline, style, runDir, opts, onLog = () => {}) {
  const hfDir = path.join(runDir, "hf");
  fs.mkdirSync(hfDir, { recursive: true });
  fs.writeFileSync(path.join(hfDir, "index.html"), compileComposition(timeline, style, opts), "utf8");

  // เรียก entry .mjs ของ hyperframes ด้วย node โดยตรง
  // อย่าเรียกผ่าน npx/npx.cmd — Node บน Windows บล็อกการ spawn .cmd (CVE-2024-27980)
  // และ cmd.exe ยังพัง path ภาษาไทยเพราะ codepage อีกชั้น
  const bin = path.join(ROOT, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
  if (!fs.existsSync(bin)) {
    throw new Error("ไม่พบ hyperframes — รัน `npm install` ในโฟลเดอร์ spike ก่อน");
  }

  const render = async (format) => {
    const out = path.join(runDir, `captions.${format}`);
    await run(process.execPath, [
      bin, "render", hfDir,
      "--format", format,
      "--fps", String(opts.fps),
      "--quality", "high",
      "--output", out,
    ], { cwd: runDir });
    return out;
  };

  // วัดแล้ว: webm ที่ HyperFrames 0.7.106 ออกมาถอดรหัสได้เป็น yuv420p ไม่มี alpha จริง
  // (ตรวจทั้งระดับ stream และระดับ frame) จึงใช้ mov/ProRes 4444 เป็นค่าเริ่มต้น
  // ไฟล์ใหญ่กว่ามากแต่เป็นแค่ไฟล์ระหว่างทาง และไม่ต้องเสียเวลาเรนเดอร์สองรอบ
  const format = opts.overlayFormat || "mov";
  const file = await render(format);

  const { out } = await ffprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-read_intervals", "%+#1",
    "-show_entries", "frame=pix_fmt",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  if (!/(yuva|rgba|argb|bgra|gbrap)/.test(out)) {
    onLog(`เลเยอร์ซับ .${format} ไม่มี alpha (${out.trim().split("\n")[0]}) — ซับจะทับภาพเป็นพื้นทึบ`);
  }
  return file;
}
