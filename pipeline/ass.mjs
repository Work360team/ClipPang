// ass — คอมไพล์ timeline + style เป็นไฟล์ซับ .ass (เลน A)  →  อนาคตคือ packages/media/ass
//
// หนึ่ง Dialogue event = หนึ่งคำที่ถูกไฮไลต์ ณ เวลานั้น
// ข้อความทั้งท่อนถูกวาดใหม่ทุก event โดยเปลี่ยนแค่สีของคำที่กำลังพูด → ได้เอฟเฟกต์คาราโอเกะ
import { assTime, srtTime } from "./lib.mjs";
import { anchorMarginV, normalizeAnchor } from "./core.mjs";

/** numpad ของ ASS: 7-9 บน · 4-6 กลาง · 1-3 ล่าง (คอลัมน์กลางคือ 8 / 5 / 2) */
const ALIGNMENT = { top: 8, middle: 5, bottom: 2 };

/** #RRGGBB → &HAABBGGRR สำหรับบรรทัด Style (AA: 00 ทึบ, FF โปร่ง) */
function assColor(hex, alpha = 0) {
  const h = String(hex || "#FFFFFF").replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

/**
 * #RRGGBB → &HBBGGRR& สำหรับ override tag กลางบรรทัด
 * ต่างจาก assColor: \c รับได้แค่ 6 หลักและต้องปิดท้ายด้วย & — ใส่ alpha เข้าไปแล้ว libass
 * จะ parse ไม่ผ่านแล้วเงียบ ๆ ถอยไปใช้สีของ style (ไฮไลต์หาย โดยไม่มี error ให้เห็น)
 */
function tagColor(hex) {
  const h = String(hex || "#FFFFFF").replace("#", "");
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

const escapeText = (s) =>
  String(s).replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N");

export function compileAss(timeline, style, { width = 1080, height = 1920 } = {}) {
  const p = style.params;
  const font = p.font || {};
  const bold = (font.weight || 700) >= 700 ? -1 : 0;
  const borderStyle = p.box ? 3 : 1;
  const anchor = normalizeAnchor(p.position?.anchor);
  const marginV = anchorMarginV(anchor, p.position?.marginV);

  const head = [
    "[Script Info]",
    `; ${style.name} — สร้างโดย ClipPang`,
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour," +
      " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline," +
      " Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    [
      "Style: Main",
      font.family || "Kanit",
      font.size || 96,
      assColor(p.fill, p.fillAlpha ?? 0),
      assColor(p.activeFill),
      assColor(p.outline?.color || "#000000"),
      assColor(p.box?.color || "#000000", p.box?.alpha ?? 0x40),
      bold, 0, 0, 0,
      100, 100,
      p.spacing ?? 0, 0,
      borderStyle,
      p.outline?.width ?? 7,
      p.shadow?.offset ?? 3,
      ALIGNMENT[anchor],
      p.position?.marginH ?? 90,
      p.position?.marginH ?? 90,
      marginV,
      1,
    ].join(","),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const anim = p.animation || {};
  const popScale = Math.round((anim.scale || 1) * 100);
  const popMs = anim.durationMs ?? 120;
  const idleAlpha = p.idleAlpha ?? null; // สไตล์แบบ "คำที่ยังไม่พูดจางไว้ก่อน"

  const events = [];
  for (const chunk of timeline.chunks) {
    const words = chunk.words;
    words.forEach((w, wi) => {
      const isFirst = wi === 0;
      const isLast = wi === words.length - 1;
      const pre = escapeText(chunk.text.slice(0, w.s));
      const mid = escapeText(chunk.text.slice(w.s, w.e));
      const post = escapeText(chunk.text.slice(w.e));

      const lead = [];
      if (isFirst && (p.fadeMs ?? 70)) lead.push(`\\fad(${p.fadeMs ?? 70},0)`);
      if (isLast && (p.fadeMs ?? 70)) lead.push(`\\fad(0,${p.fadeMs ?? 70})`);

      const activeTags = [`\\c${tagColor(p.activeFill)}`];
      if (idleAlpha !== null) activeTags.push(`\\1a&H00&`);
      if (anim.enter === "pop" && popScale !== 100) {
        activeTags.push(`\\fscx${popScale}\\fscy${popScale}\\t(0,${popMs},\\fscx100\\fscy100)`);
      }
      if (w.emphasis && p.emphasisFill) activeTags[0] = `\\c${tagColor(p.emphasisFill)}`;

      const resetTags = [`\\c${tagColor(p.fill)}`];
      if (idleAlpha !== null) resetTags.push(`\\1a&H${idleAlpha.toString(16).padStart(2, "0").toUpperCase()}&`);

      const prefixTags = idleAlpha !== null ? `{\\1a&H${idleAlpha.toString(16).padStart(2, "0").toUpperCase()}&}` : "";
      const text =
        (lead.length ? `{${lead.join("")}}` : "") +
        (pre ? prefixTags + pre : "") +
        `{${activeTags.join("")}}${mid}{${resetTags.join("")}}` +
        post;

      events.push(
        `Dialogue: 0,${assTime(w.startMs)},${assTime(w.endMs)},Main,,0,0,0,,${text}`,
      );
    });
  }

  return `${head.concat(events).join("\n")}\n`;
}

export function compileSrt(timeline) {
  return timeline.chunks
    .map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`)
    .join("\n");
}
