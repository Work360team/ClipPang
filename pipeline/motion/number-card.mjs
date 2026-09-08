// การ์ดตัวเลข — การ์ดโปร่งแสงที่ลอยขึ้นมาบนฟุตเทจจริง ไม่ใช่จอทึบที่มาแทนภาพ
//
// ภาพเบื้องหลังยังเล่นอยู่ตลอด คนดูจึงไม่รู้สึกว่าคลิปสะดุด และได้ลุคแบบ B-roll
// ที่มีข้อมูลเด้งขึ้นมาทับ ซึ่งดูแพงกว่าการตัดไปจอตัวหนังสือเต็มจอ
//
// มีสองโทน เพราะคลิปสองแบบต้องการคนละอารมณ์:
//   soft  — ครีมอุ่น มุมมนมาก เอียงเหมือนสติกเกอร์ เด้งตอนเข้า ใช้กับคลิปปักตะกร้า
//   night — กระจกเข้ม เรียบนิ่ง ใช้กับคลิปเล่าเรื่องที่ไม่ควรดูขายของ
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
  { key: "tone", label: "โทน", options: ["soft", "night"] },
];

/**
 * โทนสองแบบ
 *
 * soft ใช้พื้นสว่างเพราะบนฟีดขายของ การ์ดครีมอ่านว่าเป็นมิตร ส่วนการ์ดดำอ่านว่าเป็น
 * กราฟิกข่าว ตัวเลขจึงต้องเป็นสีส้มอุ่นแทนเหลืองแบรนด์ ซึ่งบนพื้นครีมแทบมองไม่เห็น
 * ส่วนเหลืองแบรนด์ย้ายไปอยู่บนป้ายหน่วยที่เป็นเม็ดกลม ๆ ข้างตัวเลขแทน
 */
const TONES = {
  soft: {
    cardBg: "rgba(255, 251, 243, 0.88)",
    cardSheen: "linear-gradient(180deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.12) 46%, rgba(255, 255, 255, 0) 100%)",
    border: "rgba(255, 255, 255, 0.92)",
    shadow: "rgba(74, 52, 18, 0.3)",
    number: "#f0662f",
    numberShadow: "rgba(240, 102, 47, 0.16)",
    label: "#2f2a22",
    note: "rgba(75, 68, 57, 0.86)",
    pillBg: "#ffd23f",
    pillInk: "#4a3a06",
    tilt: -1.6,
    radiusScale: 0.046,
    springIn: "back.out(2.1)",
  },
  night: {
    cardBg: "rgba(12, 14, 11, 0.72)",
    cardSheen: "linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 42%, rgba(255, 255, 255, 0) 100%)",
    border: "rgba(255, 255, 255, 0.16)",
    shadow: "rgba(0, 0, 0, 0.45)",
    number: "#ffd23f",
    numberShadow: "rgba(0, 0, 0, 0.5)",
    label: "#f4f5f0",
    note: "rgba(244, 245, 240, 0.76)",
    pillBg: "rgba(255, 210, 63, 0.16)",
    pillInk: "#ffd23f",
    tilt: 0,
    radiusScale: 0.026,
    springIn: "power4.out",
  },
};

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

/**
 * ใส่จุลภาคคั่นหลักพันถ้าค่าที่ผู้ใช้เขียนมามีอยู่แล้ว
 *
 * สคริปต์เขียน "20,000mAh" ซับก็ขึ้น 20,000 ถ้าการ์ดขึ้น 20000 เฉย ๆ จะดูเหมือน
 * คนละตัวเลขทั้งที่อยู่บนจอพร้อมกัน
 */
function group(text, grouped) {
  if (!grouped) return text;
  const [whole, fraction] = text.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${withCommas}.${fraction}` : withCommas;
}

function countFrames(target, decimals, grouped) {
  const frames = [];
  for (let step = 1; step <= COUNT_STEPS; step += 1) {
    // ผ่อนปลายทางให้ช้าลง (easeOut) จะได้ความรู้สึกเดียวกับ tween จริง
    const progress = 1 - (1 - step / COUNT_STEPS) ** 3;
    frames.push(group((target * progress).toFixed(decimals), grouped));
  }
  frames[frames.length - 1] = group(target.toFixed(decimals), grouped);
  return frames;
}

export function render({ id, shot, width, height, font, safe, data }) {
  const tone = TONES[data.tone] || TONES.soft;
  const target = countTarget(data.value);
  const decimals = target !== null && String(target).includes(".")
    ? String(target).split(".")[1].length
    : 0;

  // ขนาดทุกอย่างผูกกับความสูงเฟรม เพราะเรนเดอร์ที่ 720x1280 และ 1080x1920 ทั้งคู่
  const numberSize = Math.round(height * 0.128);
  const labelSize = Math.round(height * 0.033);
  const noteSize = Math.round(height * 0.023);
  const pillSize = Math.round(height * 0.03);
  const cardPadV = Math.round(height * 0.034);
  const cardPadH = Math.round(width * 0.062);
  const radius = Math.round(height * tone.radiusScale);

  const family = font?.family ? `'${font.family}', sans-serif` : "sans-serif";

  // ถ้าค่าที่เขียนมามีจุลภาค การ์ดต้องมีด้วย จะได้ตรงกับซับที่ขึ้นพร้อมกัน
  const grouped = String(data.value ?? "").includes(",");
  const frames = target !== null ? countFrames(target, decimals, grouped) : [];
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
    `    <div class="mo-num-row">`,
    data.prefix ? `      <span class="mo-num-affix">${esc(data.prefix)}</span>` : "",
    `      ${value}`,
    // หน่วยอยู่ในเม็ดกลม ๆ แทนที่จะเป็นตัวหนังสือลอย ทำให้การ์ดดูเป็นมิตรขึ้นมาก
    data.suffix ? `      <span class="mo-num-pill" id="${id}-pill">${esc(data.suffix)}</span>` : "",
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
        padding: 0 ${Math.round(width * 0.075)}px;
      }
      /* โปร่งแสงพอให้เห็นภาพข้างหลังขยับ แต่ทึบพอให้ตัวหนังสืออ่านออกบนฟุตเทจสว่าง
         เอียงนิดหน่อยให้เหมือนสติกเกอร์ที่แปะไว้ ไม่ใช่กล่องที่ระบบวางให้ตรงเป๊ะ */
      .mo-num-card {
        position: relative;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: ${Math.round(height * 0.007)}px;
        padding: ${cardPadV}px ${cardPadH}px ${Math.round(cardPadV * 1.08)}px;
        border: ${Math.max(1, Math.round(height * 0.0016))}px solid ${tone.border};
        border-radius: ${radius}px;
        background: ${tone.cardSheen}, ${tone.cardBg};
        box-shadow: 0 ${Math.round(height * 0.016)}px ${Math.round(height * 0.046)}px ${tone.shadow};
        text-align: center;
      }
      .mo-num-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: ${Math.round(width * 0.018)}px;
      }
      .mo-num-value {
        position: relative;
        display: inline-block;
        font-family: ${family};
        font-weight: 700;
        font-size: ${numberSize}px;
        line-height: 1.04;
        color: ${tone.number};
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.03em;
        text-shadow: 0 ${Math.round(height * 0.003)}px ${Math.round(height * 0.01)}px ${tone.numberShadow};
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
      .mo-num-pill {
        display: inline-flex;
        align-items: center;
        padding: ${Math.round(pillSize * 0.38)}px ${Math.round(pillSize * 0.78)}px;
        border-radius: 999px;
        background: ${tone.pillBg};
        color: ${tone.pillInk};
        font-family: ${family};
        font-weight: 700;
        font-size: ${pillSize}px;
        line-height: 1;
        white-space: nowrap;
      }
      .mo-num-affix {
        font-family: ${family};
        font-weight: 600;
        font-size: ${Math.round(numberSize * 0.4)}px;
        line-height: 1;
        color: ${tone.number};
        opacity: 0.82;
      }
      .mo-num-label {
        max-width: 17ch;
        font-family: ${family};
        font-weight: 600;
        font-size: ${labelSize}px;
        line-height: 1.3;
        color: ${tone.label};
      }
      .mo-num-note {
        max-width: 24ch;
        font-family: ${family};
        font-weight: 400;
        font-size: ${noteSize}px;
        line-height: 1.38;
        color: ${tone.note};
      }`;

  // การ์ดเด้งขึ้นมาแล้วนิ่ง ตอนจบค่อยหดลงไป ไม่ใช่หายวับซึ่งจะดูเหมือนภาพกระตุก
  // ท่าเข้าใช้ back.out ในโทน soft เพื่อให้มีจังหวะเกินแล้วเด้งกลับ ซึ่งคือสิ่งที่
  // ทำให้รู้สึก "น่ารัก" มากกว่าการเลื่อนเข้าตรง ๆ
  const holdSec = Math.max(0.6, (shot.endMs - shot.startMs) / 1000);
  const outAt = Math.max(0.5, holdSec - 0.4);

  const beats = [
    {
      kind: "fromTo",
      sel: `#${id}-card`,
      from: { y: Math.round(height * 0.03), scale: 0.86, rotation: tone.tilt - 3.2, opacity: 0 },
      to: { y: 0, scale: 1, rotation: tone.tilt, opacity: 1 },
      duration: 0.48,
      ease: tone.springIn,
      t: 0,
    },
  ];

  if (data.suffix) {
    beats.push({
      kind: "fromTo",
      sel: `#${id}-pill`,
      from: { scale: 0.2, opacity: 0 },
      to: { scale: 1, opacity: 1 },
      duration: 0.42,
      ease: "back.out(3.4)",
      t: 0.26,
    });
  }

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
    beats.push({ kind: "fromTo", sel: `#${id}-label`, from: { y: Math.round(height * 0.016), opacity: 0 }, to: { y: 0, opacity: 1 }, duration: 0.32, ease: "power3.out", t: 0.32 });
  }
  if (data.note) {
    beats.push({ kind: "fromTo", sel: `#${id}-note`, from: { opacity: 0 }, to: { opacity: 1 }, duration: 0.32, ease: "power2.out", t: 0.46 });
  }

  beats.push({
    kind: "fromTo",
    sel: `#${id}-card`,
    from: { scale: 1, rotation: tone.tilt, opacity: 1 },
    to: { scale: 0.9, rotation: tone.tilt - 1.4, opacity: 0 },
    duration: 0.38,
    ease: "back.in(1.6)",
    t: outAt,
  });

  return { html, css, beats };
}
