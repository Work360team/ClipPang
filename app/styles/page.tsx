"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronRight,
  Film,
  Gauge,
  Layers3,
  Play,
  Sparkles,
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { HardLink as Link } from "../components/HardLink";

type CaptionStyle = {
  id: string;
  name: string;
  description: string;
  speed: string;
  mode: "karaoke" | "box" | "reveal" | "kanit";
  badge?: string;
};

const captionStyles: CaptionStyle[] = [
  {
    id: "karaoke-pop",
    name: "คาราโอเกะ ป๊อป",
    description: "ขาวขอบดำ คำที่กำลังพูดเด้งเป็นสีเหลือง เหมาะกับคลิปขายของทั่วไป",
    speed: "เร็วมาก",
    mode: "karaoke",
  },
  {
    id: "box-bold",
    name: "กล่องทึบ อ่านง่าย",
    description: "กล่องดำช่วยให้ข้อความอ่านชัด แม้คลิปจะมีฉากหลังสว่างหรือรายละเอียดเยอะ",
    speed: "เร็วมาก",
    mode: "box",
  },
  {
    id: "reveal-clean",
    name: "เผยทีละคำ มินิมอล",
    description: "คำที่ยังไม่พูดจะจางไว้ แล้วค่อยสว่างตามเสียง ดูสุภาพและเป็นธรรมชาติ",
    speed: "เร็วมาก",
    mode: "reveal",
  },
  {
    id: "kanit-hf",
    name: "Kanit เด้ง",
    description: "ตัวอักษร Kanit คมชัด พร้อมจังหวะเด้งและเบลอเข้า สำหรับงานที่อยากให้ดูพิเศษ",
    speed: "ละเอียดกว่า",
    mode: "kanit",
    badge: "คุณภาพสูง",
  },
];

type StyleParams = {
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
};

type EngineStyle = {
  id: string;
  name: string;
  description?: string;
  lane?: string;
  tier?: string;
  params?: StyleParams;
};

/**
 * สีและฟอนต์ในตัวอย่างมาจากไฟล์สไตล์จริงที่ engine ใช้เรนเดอร์
 * ถ้าใครแก้ไฟล์ใน pipeline/styles หน้านี้จะเปลี่ยนตามทันที ไม่ต้องมาแก้ CSS ซ้ำอีกที่
 */
function previewVars(params?: StyleParams): CSSProperties {
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
function CaptionPreview({ params, index }: { params?: StyleParams; index: number }) {
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
  const anchor = params?.position?.anchor === "top" ? "top" : params?.position?.anchor === "middle" ? "middle" : "bottom";
  const big = (params?.font?.size ?? 90) >= 110;

  const lineStyle: CSSProperties = {
    ...(pill ? {
      background: pill.color ?? "rgba(0,0,0,0.62)",
      borderRadius: `${Math.round((pill.radius ?? 999) / 3)}px`,
      padding: `${Math.round((pill.padV ?? 18) / 3)}px ${Math.round((pill.padH ?? 34) / 3)}px`,
    } : {}),
  };

  const wordStyle = (state: "done" | "now" | "todo"): CSSProperties => ({
    color: gradient ? "transparent" : state === "now" ? "var(--style-active)" : "var(--style-fill)",
    ...(gradient ? {
      backgroundImage: `linear-gradient(${gradient.angle ?? 100}deg, ${gradient.from}, ${gradient.to})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
    } : {}),
    ...(glow ? { filter: `drop-shadow(0 0 ${Math.max(3, Math.round((glow.blur ?? 18) / 3))}px ${glow.color ?? "#38f6ff"})` } : {}),
    transform: state === "now" ? `scale(${params?.animation?.scale ?? 1.12})` : "scale(1)",
    opacity: state === "todo" && !pill ? 0.72 : 1,
    transitionDuration: `${params?.animation?.durationMs ?? 160}ms`,
  });

  return (
    <div
      className={`style-caption style-caption-live anchor-${anchor}${big ? " style-caption-big" : ""} enter-${enter}`}
      aria-hidden="true"
    >
      {/* key ผูกกับรอบการเล่น เพื่อให้อนิเมชันเข้าเล่นใหม่ทุกครั้งที่วนกลับมา */}
      <span className="style-caption-line" style={lineStyle} key={`${index}-${active === 0 ? "in" : "hold"}`}>
        {PREVIEW_WORDS.map((word, wordIndex) => {
          const state = active === 0 ? "todo" : wordIndex < active - 1 ? "done" : wordIndex === active - 1 ? "now" : "todo";
          return (
            <span className="style-caption-word" key={word} style={wordStyle(state)}>{word}</span>
          );
        })}
      </span>
    </div>
  );
}

export default function StylesPage() {
  const [selectedStyle, setSelectedStyle] = useState("karaoke-pop");
  const [engineStyles, setEngineStyles] = useState<EngineStyle[] | null>(null);

  // อ่านคลังสไตล์จาก engine จริง — ถ้าเพิ่มไฟล์สไตล์ใหม่ หน้านี้จะขึ้นเองโดยไม่ต้องแก้โค้ด
  useEffect(() => {
    let active = true;
    fetch("/api/styles")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => { if (active && Array.isArray(data.styles)) setEngineStyles(data.styles); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const styles = useMemo(() => {
    if (!engineStyles?.length) return captionStyles.map((style) => ({ ...style, params: undefined as StyleParams | undefined, live: false }));
    return engineStyles.map((engineStyle) => {
      const local = captionStyles.find((style) => style.id === engineStyle.id);
      return {
        id: engineStyle.id,
        name: engineStyle.name || local?.name || engineStyle.id,
        description: engineStyle.description || local?.description || "",
        // เร็ว/ละเอียด อ่านจาก lane จริง ไม่ใช่ข้อความที่พิมพ์ไว้ตายตัว
        speed: engineStyle.lane === "hyperframes" ? "ละเอียดกว่า" : "เร็วมาก",
        mode: local?.mode ?? (engineStyle.lane === "hyperframes" ? "kanit" : "karaoke"),
        badge: engineStyle.lane === "hyperframes" ? "คุณภาพสูง" : local?.badge,
        params: engineStyle.params,
        live: true,
      };
    });
  }, [engineStyles]);

  const selected = styles.find((style) => style.id === selectedStyle) ?? styles[0];

  return (
    <AppShell>
      <div className="style-page">
        <header className="style-heading">
          <div>
            <div className="style-kicker">
              <Sparkles size={15} strokeWidth={2.3} /> คลังสไตล์ซับ
            </div>
            <h1>เลือกหน้าตาของคลิปคุณ</h1>
            <p>ดูตัวอย่างจากคลิปจริงก่อนเลือก ทุกสไตล์จับจังหวะตามเสียงให้อัตโนมัติ</p>
          </div>
          <div className="style-heading-note" aria-label="จำนวนสไตล์ที่พร้อมใช้">
            <Layers3 size={18} />
            <span><strong>{styles.length}</strong> สไตล์พร้อมใช้</span>
          </div>
        </header>

        <section className="style-gallery" aria-label="สไตล์คำบรรยาย">
          {styles.map((style, index) => {
            const isSelected = selectedStyle === style.id;
            return (
              <article
                className={`style-card${isSelected ? " style-card-selected" : ""}`}
                key={style.id}
                style={previewVars(style.params)}
              >
                <div className="style-video-frame">
                  <video
                    aria-label={`วิดีโอตัวอย่างสไตล์ ${style.name}`}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload={index === 0 ? "auto" : "metadata"}
                    poster="/clippang-style-preview-poster.jpg"
                  >
                    <source src="/clippang-style-preview.mp4" type="video/mp4" />
                  </video>
                  <div className="style-video-shade" />
                  <CaptionPreview params={style.params} index={index} />
                  <div className="style-preview-pill">
                    <Play size={10} fill="currentColor" /> {style.live ? "สีจากไฟล์สไตล์จริง" : "ตัวอย่างสไตล์"}
                  </div>
                  {style.badge && (
                    <div className="style-quality-pill">
                      <Sparkles size={11} /> {style.badge}
                    </div>
                  )}
                </div>

                <div className="style-card-body">
                  <div className="style-card-title-row">
                    <div>
                      <span className="style-number">0{index + 1}</span>
                      <h2>{style.name}</h2>
                    </div>
                    <span
                      className={`style-check${isSelected ? " style-check-on" : ""}`}
                      aria-hidden="true"
                    >
                      {isSelected && <Check size={15} strokeWidth={3} />}
                    </span>
                  </div>
                  <p>{style.description}</p>
                  <div className="style-meta">
                    <span><Gauge size={14} /> {style.speed}</span>
                    <span><Film size={14} /> 9:16</span>
                  </div>
                  <button
                    className="style-select-button"
                    type="button"
                    onClick={() => setSelectedStyle(style.id)}
                    aria-pressed={isSelected}
                  >
                    {isSelected ? "เลือกใช้อยู่" : "เลือกสไตล์นี้"}
                    {!isSelected && <ChevronRight size={16} />}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="style-selection-summary" aria-live="polite">
          <div className="style-summary-icon"><Check size={18} strokeWidth={3} /></div>
          <div>
            <span>สไตล์ที่เลือก</span>
            <strong>{selected.name}</strong>
          </div>
          <p>คุณยังเปลี่ยนสไตล์และตำแหน่งซับได้อีกครั้งก่อนเริ่มเรนเดอร์</p>
          <Link className="style-use-link" href={`/p/new?style=${encodeURIComponent(selected.id)}`}>
            ใช้กับคลิปใหม่ <ChevronRight size={16} />
          </Link>
        </aside>
      </div>

      <style>{`
        .style-page {
          --style-ink: #1f251f;
          --style-muted: #70776f;
          --style-line: #dedfd8;
          --style-card: #ffffff;
          --style-soft: #f3f4ee;
          --style-accent: #ffd23f;
          --style-accent-ink: #332800;
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 38px 40px 56px;
          color: var(--style-ink);
          font-family: "Kanit", "Leelawadee UI", system-ui, sans-serif;
        }

        .style-heading {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 28px;
          margin-bottom: 28px;
        }

        .style-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 9px;
          color: #806300;
          font-size: 13px;
          font-weight: 650;
          letter-spacing: .02em;
        }

        .style-heading h1 {
          margin: 0;
          font-size: clamp(30px, 4vw, 46px);
          line-height: 1.08;
          letter-spacing: -.035em;
          font-weight: 720;
        }

        .style-heading p {
          max-width: 650px;
          margin: 10px 0 0;
          color: var(--style-muted);
          font-size: 15px;
          line-height: 1.65;
        }

        .style-heading-note {
          display: flex;
          align-items: center;
          gap: 9px;
          flex: 0 0 auto;
          padding: 10px 14px;
          border: 1px solid var(--style-line);
          border-radius: 999px;
          background: rgba(255,255,255,.72);
          color: var(--style-muted);
          font-size: 13px;
          box-shadow: 0 8px 22px rgba(30,35,27,.04);
        }

        .style-heading-note strong { color: var(--style-ink); }

        .style-gallery {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .style-card {
          min-width: 0;
          overflow: hidden;
          border: 1px solid var(--style-line);
          border-radius: 20px;
          background: var(--style-card);
          box-shadow: 0 8px 30px rgba(39,44,35,.045);
          transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
        }

        .style-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 16px 40px rgba(39,44,35,.09);
        }

        .style-card-selected {
          border-color: #d3a700;
          box-shadow: 0 0 0 2px rgba(255,210,63,.24), 0 16px 42px rgba(83,65,0,.09);
        }

        .style-video-frame {
          position: relative;
          aspect-ratio: 9 / 12;
          overflow: hidden;
          margin: 7px;
          border-radius: 15px;
          background: #171914;
          isolation: isolate;
        }

        .style-video-frame video {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .style-video-shade {
          position: absolute;
          inset: 42% 0 0;
          z-index: 1;
          background: linear-gradient(transparent, rgba(0,0,0,.48));
          pointer-events: none;
        }

        .style-preview-pill,
        .style-quality-pill {
          position: absolute;
          z-index: 3;
          top: 10px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 8px;
          border: 1px solid rgba(255,255,255,.28);
          border-radius: 999px;
          background: rgba(15,17,13,.58);
          color: #fff;
          font-size: 12.5px;
          font-weight: 600;
          line-height: 1;
          backdrop-filter: blur(8px);
        }

        .style-preview-pill { left: 10px; }
        .style-quality-pill { right: 10px; color: #352900; background: rgba(255,210,63,.95); border-color: transparent; }

        .style-caption {
          position: absolute;
          z-index: 2;
          left: 8%;
          right: 8%;
          bottom: 15%;
          color: #fff;
          text-align: center;
          font-family: "Kanit", "Leelawadee UI", sans-serif;
          font-weight: 800;
          letter-spacing: -.02em;
          line-height: 1.13;
          text-shadow: -2px -2px 0 #111, 2px -2px 0 #111, -2px 2px 0 #111, 2px 2px 0 #111, 0 3px 7px rgba(0,0,0,.55);
          pointer-events: none;
        }

        /* ตัวอย่างที่ขยับจริง — ท่าเข้าชุดเดียวกับที่ hyperframes.mjs ใช้ตอนเรนเดอร์ */
        .style-caption-live { font-size: clamp(15px, 1.45vw, 21px); }
        .style-caption-live.style-caption-big { font-size: clamp(21px, 2.1vw, 30px); }
        .style-caption-live.anchor-top { top: 14%; bottom: auto; }
        .style-caption-live.anchor-middle { top: 50%; bottom: auto; transform: translateY(-50%); }

        .style-caption-line {
          display: inline-flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: .28em;
          font-weight: var(--style-weight, 800);
          text-shadow: var(--style-stroke, none);
        }

        .style-caption-word {
          display: inline-block;
          transform-origin: 50% 78%;
          transition-property: color, transform, opacity, filter;
          transition-timing-function: cubic-bezier(.22,1.4,.4,1);
        }

        .enter-blur .style-caption-line { animation: hf-enter-blur .34s cubic-bezier(.2,.9,.3,1) both; }
        .enter-slam .style-caption-line { animation: hf-enter-slam .32s cubic-bezier(.2,1.6,.4,1) both; }
        .enter-wipe .style-caption-line { animation: hf-enter-wipe .42s cubic-bezier(.5,0,.3,1) both; }
        .enter-rise .style-caption-line { animation: hf-enter-rise .36s cubic-bezier(.16,1,.3,1) both; }
        /* สองท่านี้มาจากสไตล์เลน ASS ที่มีอยู่เดิม ไม่ใช่ของ HyperFrames */
        .enter-pop .style-caption-line { animation: hf-enter-pop .3s cubic-bezier(.2,1.5,.4,1) both; }
        .enter-none .style-caption-line { animation: hf-enter-fade .26s ease-out both; }

        @keyframes hf-enter-blur {
          from { opacity: 0; transform: translateY(14px); filter: blur(6px); }
          to   { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes hf-enter-slam {
          from { opacity: 0; transform: scale(1.75); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes hf-enter-wipe {
          from { clip-path: inset(0 100% 0 0); }
          to   { clip-path: inset(0 0 0 0); }
        }
        @keyframes hf-enter-pop {
          from { opacity: 0; transform: scale(.82); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes hf-enter-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes hf-enter-rise {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .style-caption-line { animation: none !important; }
          .style-caption-word { transition: none !important; }
        }

        .style-caption-karaoke { font-size: clamp(16px, 1.55vw, 22px); }
        .style-caption-karaoke strong { color: #ffe039; font-weight: 800; }
        .style-caption-karaoke small { display: block; color: #fff; font-size: .82em; }

        .style-caption-box {
          left: 11%;
          right: 11%;
          bottom: 14%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          font-size: clamp(15px, 1.4vw, 20px);
          text-shadow: none;
        }
        .style-caption-box span,
        .style-caption-box strong {
          padding: 3px 8px;
          border-radius: 4px;
          background: rgba(0,0,0,.82);
        }
        .style-caption-box strong { color: #ffd23f; font-weight: 800; }

        .style-caption-reveal {
          left: 5%;
          right: 5%;
          bottom: 15%;
          font-size: clamp(14px, 1.28vw, 19px);
          color: rgba(255,255,255,.48);
        }
        .style-caption-reveal .style-word-done { color: #fff; }
        .style-caption-reveal .style-word-now { color: #ffe039; }

        .style-caption-kanit {
          bottom: 14%;
          font-size: clamp(18px, 1.65vw, 24px);
          transform: rotate(-1.2deg);
          text-shadow: -3px -3px 0 #151515, 3px -3px 0 #151515, -3px 3px 0 #151515, 3px 3px 0 #151515, 0 7px 16px rgba(0,0,0,.42);
        }
        .style-caption-kanit span { display: block; color: #ff5f8f; font-size: .86em; }

        .style-card-body { padding: 13px 15px 15px; }

        .style-card-title-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .style-number {
          display: block;
          margin-bottom: 3px;
          color: #92978e;
          font-family: ui-monospace, "Cascadia Code", monospace;
          font-size: 12.5px;
          letter-spacing: .11em;
        }

        .style-card h2 {
          margin: 0;
          font-size: 17px;
          line-height: 1.28;
          letter-spacing: -.018em;
          font-weight: 680;
        }

        .style-check {
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          flex: 0 0 24px;
          border: 1px solid #d7d9d2;
          border-radius: 50%;
          color: var(--style-accent-ink);
          background: #fff;
        }

        .style-check-on { border-color: var(--style-accent); background: var(--style-accent); }

        .style-card-body > p {
          min-height: 62px;
          margin: 9px 0 12px;
          color: var(--style-muted);
          font-size: 12px;
          line-height: 1.55;
        }

        .style-meta {
          display: flex;
          gap: 12px;
          padding-top: 11px;
          border-top: 1px solid #eeefe9;
          color: #777d74;
          font-size: 13px;
        }

        .style-meta span { display: inline-flex; align-items: center; gap: 5px; }

        .style-select-button {
          width: 100%;
          height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          margin-top: 13px;
          border: 1px solid #d9dcd3;
          border-radius: 11px;
          color: var(--style-ink);
          background: #f7f8f4;
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background .18s ease, border-color .18s ease;
        }

        .style-card-selected .style-select-button {
          border-color: var(--style-accent);
          color: var(--style-accent-ink);
          background: var(--style-accent);
        }

        .style-select-button:hover { border-color: #aeb5a4; background: #eef1e8; }
        .style-card-selected .style-select-button:hover { border-color: #e7b900; background: #f4c532; }
        .style-select-button:focus-visible { outline: 3px solid rgba(206,163,0,.24); outline-offset: 2px; }

        .style-selection-summary {
          display: grid;
          grid-template-columns: auto auto minmax(180px, 1fr) auto;
          align-items: center;
          gap: 12px;
          margin-top: 18px;
          padding: 14px 16px;
          border: 1px solid #eadca6;
          border-radius: 15px;
          background: linear-gradient(90deg, #fff8dd 0%, #fffdf6 70%);
        }

        .style-summary-icon {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border-radius: 11px;
          color: var(--style-accent-ink);
          background: var(--style-accent);
        }

        .style-selection-summary span { display: block; color: var(--style-muted); font-size: 13px; }
        .style-selection-summary strong { display: block; margin-top: 1px; font-size: 13px; }
        .style-selection-summary p { justify-self: end; margin: 0; color: var(--style-muted); font-size: 11px; }

        .style-use-link {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 0 13px;
          border-radius: 10px;
          background: var(--style-ink);
          color: white;
          font-size: 11px;
          font-weight: 650;
          white-space: nowrap;
        }

        .style-use-link:hover { background: #343a33; }
        .style-use-link:focus-visible { outline: 3px solid rgba(206,163,0,.24); outline-offset: 2px; }

        @media (max-width: 1120px) {
          .style-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .style-video-frame { aspect-ratio: 9 / 10; }
          .style-card-body > p { min-height: 0; }
          .style-caption-karaoke { font-size: clamp(18px, 2.6vw, 28px); }
          .style-caption-box { font-size: clamp(17px, 2.3vw, 25px); }
          .style-caption-reveal { font-size: clamp(16px, 2.15vw, 24px); }
          .style-caption-kanit { font-size: clamp(20px, 2.8vw, 30px); }
        }

        @media (max-width: 700px) {
          .style-page { padding: 26px 18px 40px; }
          .style-heading { align-items: flex-start; flex-direction: column; gap: 16px; }
          .style-heading-note { display: none; }
          .style-gallery { grid-template-columns: 1fr; }
          .style-video-frame { aspect-ratio: 9 / 10.5; }
          .style-selection-summary { grid-template-columns: auto 1fr; }
          .style-selection-summary p { grid-column: 1 / -1; justify-self: start; padding-top: 2px; }
          .style-use-link { grid-column: 1 / -1; width: 100%; }
        }

        @media (prefers-reduced-motion: reduce) {
          .style-card { transition: none; }
          .style-card:hover { transform: none; }
        }
      `}</style>
    </AppShell>
  );
}
