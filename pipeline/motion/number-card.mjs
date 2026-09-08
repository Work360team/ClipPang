// การ์ดตัวเลข — การ์ดโปร่งแสงที่ลอยขึ้นมาบนฟุตเทจจริง ไม่ใช่จอทึบที่มาแทนภาพ
//
// ภาพเบื้องหลังยังเล่นอยู่ตลอด คนดูจึงไม่รู้สึกว่าคลิปสะดุด และได้ลุกแบบ B-roll
// ที่มีข้อมูลเด้งขึ้นมาทับ ซึ่งดูแพงกว่าการตัดไปจอตัวหนังสือเต็มจอ
//
// หมายเหตุทางเทคนิค: กระจกฝ้าจริง (backdrop-filter) ทำไม่ได้ในสถาปัตยกรรมนี้
// เพราะ composition ถูกเรนเดอร์แยกบนพื้นโปร่งใส แล้วค่อยเอาไปทับวิดีโอด้วย ffmpeg
// ตอนเรนเดอร์จึงไม่มีภาพอยู่ข้างหลังให้เบลอ — ความโปร่งแสงใช้ rgba ล้วนแทน
// ซึ่ง overlay ผสม alpha ให้ถูกต้องอยู่แล้ว

export const slug = "number-card";
export const name = "การ์ดตัวเลข";
export const tagline = "การ์ดโปร่งแสงลอยขึ้นบนภาพจริง ตัวเลขนับขึ้นให้เห็นค่าไต่";

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

export function render({ id, shot, width, height, font, safe, data }) {
  const target = countTarget(data.value);
  const decimals = target !== null && String(target).includes(".")
    ? String(target).split(".")[1].length
    : 0;

  // ขนาดทุกอย่างผูกกับความสูงเฟรม เพราะเรนเดอร์ที่ 720x1280 และ 1080x1920 ทั้งคู่
  const numberSize = Math.round(height * 0.125);
  const labelSize = Math.round(height * 0.032);
  const noteSize = Math.round(height * 0.023);
  const affixSize = Math.round(numberSize * 0.44);
  const cardPadV = Math.round(height * 0.032);
  const cardPadH = Math.round(width * 0.06);
  const radius = Math.round(height * 0.026);
  const rail = Math.round(height * 0.004);

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
    `<div class="mo-num-stage">`,
    `  <div class="mo-num-card" id="${id}-card">`,
    `    <span class="mo-num-rail" id="${id}-rail"></span>`,
    `    <div class="mo-num-row">`,
    data.prefix ? `      <span class="mo-num-affix">${esc(data.prefix)}</span>` : "",
    `      ${value}`,
    data.suffix ? `      <span class="mo-num-affix">${esc(data.suffix)}</span>` : "",
    `    </div>`,
    data.label ? `    <div class="mo-num-label" id="${id}-label">${esc(data.label)}</div>` : "",
    data.note ? `    <div class="mo-num-note" id="${id}-note">${esc(data.note)}</div>` : "",
    `  </div>`,
    `</div>`,
  ].filter(Boolean).join("\n        ");

  const css = `
      /* ช็อตโมชันกินพื้นที่เต็มเฟรม แต่ตัวการ์ดลอยอยู่ตรงกลางเขตที่ซับไม่ได้จอง
         พื้นที่นอกการ์ดโปร่งใสสนิท ภาพจริงจึงเล่นต่อได้ตามปกติ */
      .clip.mo { position: absolute; inset: 0; }
      .mo-num-stage {
        position: absolute;
        top: ${safe?.top ?? 0}px;
        right: 0;
        bottom: ${safe?.bottom ?? 0}px;
        left: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 ${Math.round(width * 0.07)}px;
      }
      /* โปร่งแสงพอให้เห็นภาพข้างหลังขยับ แต่ทึบพอให้ตัวหนังสืออ่านออกบนฟุตเทจสว่าง
         ไล่สีอ่อนลงด้านบนคือสิ่งที่ทำให้อ่านเป็นแผ่นกระจก ไม่ใช่กล่องดำธรรมดา */
      .mo-num-card {
        position: relative;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: ${Math.round(height * 0.008)}px;
        padding: ${cardPadV}px ${cardPadH}px ${Math.round(cardPadV * 1.05)}px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: ${radius}px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 42%, rgba(255, 255, 255, 0) 100%),
          rgba(12, 14, 11, 0.72);
        box-shadow: 0 ${Math.round(height * 0.018)}px ${Math.round(height * 0.05)}px rgba(0, 0, 0, 0.45);
        text-align: center;
        overflow: hidden;
      }
      /* เส้นเหลืองบาง ๆ ด้านบน เป็นจุดเดียวที่ใส่สีแบรนด์ลงไป ที่เหลือปล่อยให้ภาพเป็นพระเอก */
      .mo-num-rail {
        position: absolute;
        top: 0;
        left: 50%;
        width: 42%;
        height: ${rail}px;
        border-radius: 0 0 ${rail}px ${rail}px;
        background: linear-gradient(90deg, rgba(255, 210, 63, 0) 0%, #ffd23f 50%, rgba(255, 210, 63, 0) 100%);
        transform: translateX(-50%);
      }
      .mo-num-row {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: ${Math.round(width * 0.012)}px;
      }
      .mo-num-value {
        position: relative;
        display: inline-block;
        font-family: ${family};
        font-weight: 700;
        font-size: ${numberSize}px;
        line-height: 1.04;
        color: #ffd23f;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.025em;
        text-shadow: 0 ${Math.round(height * 0.004)}px ${Math.round(height * 0.014)}px rgba(0, 0, 0, 0.5);
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
        color: rgba(255, 210, 63, 0.82);
      }
      .mo-num-label {
        max-width: 17ch;
        font-family: ${family};
        font-weight: 600;
        font-size: ${labelSize}px;
        line-height: 1.3;
        color: #f4f5f0;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      }
      .mo-num-note {
        max-width: 24ch;
        font-family: ${family};
        font-weight: 400;
        font-size: ${noteSize}px;
        line-height: 1.38;
        color: rgba(244, 245, 240, 0.76);
      }`;

  // การ์ดลอยขึ้นมาแล้วนิ่ง ตอนจบค่อยจมลงไป ไม่ใช่หายวับซึ่งจะดูเหมือนภาพกระตุก
  const holdSec = Math.max(0.6, (shot.endMs - shot.startMs) / 1000);
  const outAt = Math.max(0.5, holdSec - 0.42);

  const beats = [
    {
      kind: "fromTo",
      sel: `#${id}-card`,
      from: { y: Math.round(height * 0.035), scale: 0.94, opacity: 0 },
      to: { y: 0, scale: 1, opacity: 1 },
      duration: 0.42,
      ease: "power4.out",
      t: 0,
    },
    {
      kind: "fromTo",
      sel: `#${id}-rail`,
      from: { scaleX: 0, opacity: 0 },
      to: { scaleX: 1, opacity: 1 },
      duration: 0.5,
      ease: "power3.out",
      t: 0.12,
    },
  ];

  // สลับขั้นการนับด้วย opacity ล้วน ทุกคำสั่งเป็น set ที่ GSAP วาดจริงตอน seek
  const countSec = target !== null ? Math.min(1, 0.45 + Math.abs(target) / 400) : 0;
  if (frames.length) {
    const stepSec = countSec / frames.length;
    frames.forEach((_, index) => {
      const at = 0.16 + index * stepSec;
      beats.push({ kind: "set", sel: `#${id}-s${index}`, vars: { opacity: 1 }, t: at });
      if (index > 0) {
        beats.push({ kind: "set", sel: `#${id}-s${index - 1}`, vars: { opacity: 0 }, t: at });
      }
    });
  } else {
    beats.push({ kind: "set", sel: `#${id}-s0`, vars: { opacity: 1 }, t: 0.16 });
  }

  if (data.label) {
    beats.push({ kind: "fromTo", sel: `#${id}-label`, from: { y: Math.round(height * 0.018), opacity: 0 }, to: { y: 0, opacity: 1 }, duration: 0.32, ease: "power3.out", t: 0.3 });
  }
  if (data.note) {
    beats.push({ kind: "fromTo", sel: `#${id}-note`, from: { opacity: 0 }, to: { opacity: 1 }, duration: 0.32, ease: "power2.out", t: 0.44 });
  }

  beats.push({
    kind: "fromTo",
    sel: `#${id}-card`,
    from: { y: 0, scale: 1, opacity: 1 },
    to: { y: Math.round(height * 0.016), scale: 0.985, opacity: 0 },
    duration: 0.4,
    ease: "power2.in",
    t: outAt,
  });

  return { html, css, beats };
}
