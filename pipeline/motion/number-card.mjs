// จอตัวเลข — ช็อตที่ยกตัวเลขเดียวขึ้นมาเป็นพระเอก
//
// ใช้กับสถิติ ราคา จำนวนวัน เปอร์เซ็นต์ ฯลฯ ตัวเลขนับขึ้นให้เห็นว่าค่ากำลังไต่ ซึ่งดึงตา
// ได้ดีกว่าเลขที่โผล่มานิ่ง ๆ และเป็นจังหวะให้เสียงประกอบเกาะได้พอดี

export const slug = "number-card";
export const name = "จอตัวเลข";
export const tagline = "ยกตัวเลขเดียวขึ้นมาเต็มจอ นับขึ้นให้เห็นค่าไต่";

export const fields = [
  { key: "value", label: "ตัวเลข", required: true },
  { key: "prefix", label: "นำหน้า" },
  { key: "suffix", label: "ต่อท้าย" },
  { key: "label", label: "บรรทัดอธิบาย" },
  { key: "note", label: "หมายเหตุตัวเล็ก" },
];

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * ตัวเลขที่นับขึ้นได้ต้องเป็นจำนวนล้วน
 *
 * ค่าอย่าง "1,200" หรือ "80%" ยังนับได้ถ้าถอดสัญลักษณ์ออกก่อน ส่วนค่าที่ไม่ใช่ตัวเลข
 * เลย (เช่น "ครึ่งหนึ่ง") ให้แสดงนิ่ง ๆ แทนที่จะนับจาก NaN แล้วได้จอว่าง
 */
function countTarget(value) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) && cleaned !== "" ? number : null;
}

/**
 * ขั้นของการนับเลข
 *
 * ต้องทำเป็นเฟรมสำเร็จรูปแล้วสลับกันโชว์ ไม่ใช่ tween ที่เขียนตัวเลขใน onUpdate
 * เพราะ HyperFrames เรนเดอร์ทีละเฟรมด้วย timeline.seek() ซึ่ง GSAP ระงับ callback
 * ทุกตัวโดยค่าเริ่มต้น — วัดแล้ว: seek(t) ไม่เรียก onUpdate ส่วน seek(t, false) เรียก
 * ผลคือถ้าใช้ onUpdate ตัวเลขจะค้างที่ค่าตั้งต้นตลอดทั้งคลิป
 * สิ่งที่รอดจาก seek คือคุณสมบัติที่ GSAP วาดจริงเท่านั้น เช่น opacity
 */
const COUNT_STEPS = 14;

function countFrames(target, decimals) {
  const frames = [];
  for (let step = 1; step <= COUNT_STEPS; step += 1) {
    // ผ่อนปลายทางให้ช้าลง (easeOut) จะได้ความรู้สึกเดียวกับ tween จริง
    const progress = 1 - (1 - step / COUNT_STEPS) ** 3;
    frames.push((target * progress).toFixed(decimals));
  }
  frames[frames.length - 1] = target.toFixed(decimals);
  return frames;
}

export function render({ id, width, height, font, safe, data }) {
  const target = countTarget(data.value);
  const decimals = target !== null && String(target).includes(".")
    ? String(target).split(".")[1].length
    : 0;

  // ขนาดทุกอย่างผูกกับความสูงเฟรม เพราะเรนเดอร์ที่ 720x1280 และ 1080x1920 ทั้งคู่
  const numberSize = Math.round(height * 0.19);
  const labelSize = Math.round(height * 0.038);
  const noteSize = Math.round(height * 0.026);
  const affixSize = Math.round(numberSize * 0.42);
  const pad = Math.round(width * 0.09);

  const family = font?.family ? `'${font.family}', sans-serif` : "sans-serif";

  const frames = target !== null ? countFrames(target, decimals) : [];
  const value = target !== null
    ? [
        `<span class="mo-num-value">`,
        // ตัวจัดขนาดที่มองไม่เห็น ตรึงความกว้างไว้ที่ค่าสุดท้าย เลขจะได้ไม่กระตุกตอนนับ
        `<span class="mo-num-sizer">${esc(frames[frames.length - 1])}</span>`,
        ...frames.map((frame, index) =>
          `<span class="mo-num-step" id="${id}-s${index}">${esc(frame)}</span>`),
        `</span>`,
      ].join("")
    : `<span class="mo-num-value"><span class="mo-num-sizer">${esc(data.value)}</span>` +
      `<span class="mo-num-step" id="${id}-s0">${esc(data.value)}</span></span>`;

  const html = [
    `<div class="mo-num-ground"></div>`,
    `<div class="mo-num-body">`,
    `  <div class="mo-num-row">`,
    data.prefix ? `    <span class="mo-num-affix" id="${id}-pre">${esc(data.prefix)}</span>` : "",
    `    ${value}`,
    data.suffix ? `    <span class="mo-num-affix" id="${id}-suf">${esc(data.suffix)}</span>` : "",
    `  </div>`,
    data.label ? `  <div class="mo-num-label" id="${id}-label">${esc(data.label)}</div>` : "",
    data.note ? `  <div class="mo-num-note" id="${id}-note">${esc(data.note)}</div>` : "",
    `</div>`,
  ].filter(Boolean).join("\n        ");

  const css = `
      /* ช็อตโมชันต้องทึบเต็มจอ เพราะมันมาแทนภาพในช่วงเวลาของตัวเอง ไม่ใช่ซ้อนทับ */
      .clip.mo { position: absolute; inset: 0; }
      .mo-num-ground {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(120% 78% at 50% 22%, #22271f 0%, #14170f 55%, #0e100c 100%);
      }
      /* จัดกึ่งกลาง "เฉพาะพื้นที่ที่ซับไม่ได้จอง" ไม่ใช่กึ่งกลางเฟรม
         ไม่งั้นบรรทัดอธิบายจะไปนอนทับซับพอดี */
      .mo-num-body {
        position: absolute;
        top: ${safe?.top ?? 0}px;
        right: 0;
        bottom: ${safe?.bottom ?? 0}px;
        left: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: ${Math.round(height * 0.012)}px;
        padding: 0 ${pad}px;
        text-align: center;
      }
      .mo-num-row {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: ${Math.round(width * 0.014)}px;
      }
      .mo-num-value {
        position: relative;
        display: inline-block;
        font-family: ${family};
        font-weight: 700;
        font-size: ${numberSize}px;
        line-height: 1;
        color: #ffd23f;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }
      /* ทุกขั้นของการนับซ้อนทับกันในกล่องเดียว โชว์ทีละขั้นด้วย opacity */
      .mo-num-sizer { visibility: hidden; }
      .mo-num-step {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
      }
      .mo-num-affix {
        font-family: ${family};
        font-weight: 600;
        font-size: ${affixSize}px;
        line-height: 1;
        color: #c69b00;
      }
      .mo-num-label {
        max-width: 18ch;
        font-family: ${family};
        font-weight: 600;
        font-size: ${labelSize}px;
        line-height: 1.32;
        color: #f2f3ee;
      }
      .mo-num-note {
        max-width: 24ch;
        margin-top: ${Math.round(height * 0.008)}px;
        font-family: ${family};
        font-weight: 400;
        font-size: ${noteSize}px;
        line-height: 1.4;
        color: #8b9289;
      }`;

  const beats = [
    { kind: "set", sel: `#${id} .mo-num-ground`, vars: { opacity: 0 }, t: 0 },
    { kind: "fromTo", sel: `#${id} .mo-num-ground`, from: { opacity: 0 }, to: { opacity: 1 }, duration: 0.22, ease: "power2.out", t: 0 },
    { kind: "fromTo", sel: `#${id} .mo-num-row`, from: { y: Math.round(height * 0.04), opacity: 0 }, to: { y: 0, opacity: 1 }, duration: 0.34, ease: "power4.out", t: 0.06 },
  ];

  // สลับขั้นการนับด้วย opacity ล้วน ทุกคำสั่งเป็น set ที่ GSAP วาดจริงตอน seek
  const countSec = target !== null ? Math.min(1, 0.45 + Math.abs(target) / 400) : 0;
  if (frames.length) {
    const stepSec = countSec / frames.length;
    frames.forEach((_, index) => {
      const at = 0.1 + index * stepSec;
      beats.push({ kind: "set", sel: `#${id}-s${index}`, vars: { opacity: 1 }, t: at });
      if (index > 0) {
        beats.push({ kind: "set", sel: `#${id}-s${index - 1}`, vars: { opacity: 0 }, t: at });
      }
    });
  } else {
    beats.push({ kind: "set", sel: `#${id}-s0`, vars: { opacity: 1 }, t: 0.1 });
  }

  if (data.label) {
    beats.push({ kind: "fromTo", sel: `#${id}-label`, from: { y: Math.round(height * 0.022), opacity: 0 }, to: { y: 0, opacity: 1 }, duration: 0.3, ease: "power3.out", t: 0.26 });
  }
  if (data.note) {
    beats.push({ kind: "fromTo", sel: `#${id}-note`, from: { opacity: 0 }, to: { opacity: 1 }, duration: 0.3, ease: "power2.out", t: 0.4 });
  }

  return { html, css, beats };
}
