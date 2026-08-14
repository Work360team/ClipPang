"use client";

import { useEffect, useState, type CSSProperties } from "react";

/** พารามิเตอร์สไตล์เท่าที่ตัวอย่างต้องใช้ — ชุดเดียวกับที่ตัวเรนเดอร์อ่าน */
export type StylePreviewParams = {
  fill?: string;
  activeFill?: string;
  emphasisFill?: string;
  outline?: { color?: string; width?: number };
  font?: { family?: string; weight?: number; size?: number };
  position?: { anchor?: string };
  pill?: { color?: string; padV?: number; padH?: number; radius?: number };
  glow?: { color?: string; blur?: number };
  gradient?: { from?: string; to?: string; angle?: number };
  animation?: { enter?: string; scale?: number; durationMs?: number };
  glitch?: { offset?: number; cyan?: string; red?: string };
  scanlines?: { alpha?: number; gap?: number };
  emphasis?: { scale?: number; weight?: number };
  weightShift?: { base?: number; active?: number };
  wiggle?: { amountPx?: number; rotateDeg?: number; durationMs?: number };
};

/**
 * สีและฟอนต์มาจากไฟล์สไตล์จริงที่ engine ใช้เรนเดอร์
 * แก้ไฟล์ใน pipeline/styles แล้วทุกที่ที่โชว์ตัวอย่างเปลี่ยนตามทันที ไม่ต้องแก้ CSS ซ้ำ
 */
export function stylePreviewVars(params?: StylePreviewParams): CSSProperties {
  if (!params) return {};
  const outlineWidth = Math.max(1, Math.round((params.outline?.width ?? 7) / 5));
  const outlineColor = params.outline?.color ?? "#111";
  return {
    "--style-fill": params.fill ?? "#fff",
    "--style-active": params.activeFill ?? "var(--yellow)",
    "--style-weight": String(params.font?.weight ?? 800),
    "--style-stroke": `${-outlineWidth}px ${-outlineWidth}px 0 ${outlineColor}, ${outlineWidth}px ${-outlineWidth}px 0 ${outlineColor}, ${-outlineWidth}px ${outlineWidth}px 0 ${outlineColor}, ${outlineWidth}px ${outlineWidth}px 0 ${outlineColor}`,
  } as CSSProperties;
}

/** ประโยคตัวอย่างที่ใช้ทุกสไตล์ ให้เทียบกันได้ว่าจังหวะต่างกันยังไง */
const PREVIEW_WORDS = ["ตัวนี้", "ต้องมี", "บอกเลย", "ว่าคุ้ม"];
const WORD_MS = 620;

/**
 * ตัวอย่างซับที่ "ขยับจริง" ตามพารามิเตอร์ของสไตล์นั้น ๆ
 *
 * ของเดิมเป็นข้อความนิ่ง 4 แบบตายตัว สไตล์ใหม่ทั้งหกจึงตกไปใช้แบบ kanit เหมือนกันหมด
 * และไม่มีอันไหนขยับเลย ที่นี่อ่าน pill / glow / gradient / animation.enter ชุดเดียว
 * กับที่ pipeline/hyperframes.mjs ใช้ตอนเรนเดอร์จริง ตัวอย่างกับผลลัพธ์จึงตรงกัน
 */
export function StyleCaptionPreview({ params, index = 0 }: { params?: StylePreviewParams; index?: number }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % (PREVIEW_WORDS.length + 1));
    }, WORD_MS);
    return () => window.clearInterval(timer);
  }, []);

  const enter = params?.animation?.enter ?? "blur";
  const pill = params?.pill;
  const glow = params?.glow;
  const gradient = params?.gradient;
  const glitch = params?.glitch;
  const emphasis = params?.emphasis;
  const weightShift = params?.weightShift;
  const anchor = params?.position?.anchor === "top" ? "top" : params?.position?.anchor === "middle" ? "middle" : "bottom";
  const big = (params?.font?.size ?? 90) >= 110;

  const lineStyle: CSSProperties = {
    ...(pill ? {
      background: pill.color ?? "rgba(0,0,0,0.62)",
      borderRadius: `${Math.round((pill.radius ?? 999) / 3)}px`,
      padding: `${Math.round((pill.padV ?? 18) / 3)}px ${Math.round((pill.padH ?? 34) / 3)}px`,
    } : {}),
  };

  const wordStyle = (state: "done" | "now" | "todo", isEmphasis: boolean): CSSProperties => ({
    color: gradient ? "transparent" : state === "now" ? "var(--style-active)" : "var(--style-fill)",
    ...(gradient ? {
      backgroundImage: `linear-gradient(${gradient.angle ?? 100}deg, ${gradient.from}, ${gradient.to})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      // ตัวอักษรโปร่งใสแต่ text-shadow ยังวาดอยู่ เงาสี่มุมที่ใช้แทนเส้นขอบจึงทะลุ
      // ขึ้นมาเป็นก้อนดำกลางตัวอักษร ใช้ drop-shadow แทน เพราะมันเงาของพิกเซลที่วาดจริง
      textShadow: "none",
    } : {}),
    ...(glow ? { filter: `drop-shadow(0 0 ${Math.max(3, Math.round((glow.blur ?? 18) / 3))}px ${glow.color ?? "#38f6ff"})` } : {}),
    ...(gradient && !glow ? { filter: "drop-shadow(0 1px 2px rgba(0,0,0,.85)) drop-shadow(0 0 4px rgba(0,0,0,.55))" } : {}),
    ...(glitch ? {
      textShadow: `${-(glitch.offset ?? 6) / 3}px 0 0 ${glitch.cyan ?? "#00E5FF"}, ${(glitch.offset ?? 6) / 3}px 0 0 ${glitch.red ?? "#FF2D55"}`,
    } : {}),
    ...(emphasis && isEmphasis ? { fontSize: `${emphasis.scale ?? 1.5}em`, fontWeight: emphasis.weight ?? 800 } : {}),
    ...(weightShift ? { fontWeight: state === "now" ? (weightShift.active ?? 800) : (weightShift.base ?? 600) } : {}),
    transform: state === "now" ? `scale(${params?.animation?.scale ?? 1.12})` : "scale(1)",
    opacity: state === "todo" && !pill ? 0.72 : 1,
    transitionDuration: `${params?.animation?.durationMs ?? 160}ms`,
  });

  return (
    <div
      className={`style-caption style-caption-live anchor-${anchor}${big ? " style-caption-big" : ""} enter-${enter}${params?.wiggle ? " has-wiggle" : ""}`}
      aria-hidden="true"
      style={params?.scanlines ? {
        "--scan-alpha": String(params.scanlines.alpha ?? 0.22),
        "--scan-gap": `${params.scanlines.gap ?? 4}px`,
      } as CSSProperties : undefined}
    >
      {/* key ผูกกับรอบการเล่น เพื่อให้อนิเมชันเข้าเล่นใหม่ทุกครั้งที่วนกลับมา */}
      <span className="style-caption-line" style={lineStyle} key={`${index}-${active === 0 ? "in" : "hold"}`}>
        {PREVIEW_WORDS.map((word, wordIndex) => {
          const state = active === 0 ? "todo" : wordIndex < active - 1 ? "done" : wordIndex === active - 1 ? "now" : "todo";
          const isEmphasis = wordIndex === PREVIEW_WORDS.length - 1;
          return (
            <span className="style-caption-word" key={word} style={wordStyle(state, isEmphasis)}>{word}</span>
          );
        })}
      </span>
    </div>
  );
}

