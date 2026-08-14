"use client";

import { useEffect, useMemo, useState } from "react";
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
import { StyleCaptionPreview, stylePreviewVars, type StylePreviewParams } from "../components/StyleCaptionPreview";

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

type EngineStyle = {
  id: string;
  name: string;
  description?: string;
  lane?: string;
  tier?: string;
  params?: StylePreviewParams;
};

export default function StylesPage() {
  const [selectedStyle, setSelectedStyle] = useState("karaoke-pop");
  const [laneFilter, setLaneFilter] = useState<"all" | "hyperframes" | "ass">("all");
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
    if (!engineStyles?.length) {
      return captionStyles.map((style) => ({
        ...style,
        lane: style.id === "kanit-hf" ? "hyperframes" : "ass",
        params: undefined as StylePreviewParams | undefined,
        live: false,
      }));
    }
    return engineStyles.map((engineStyle) => {
      const local = captionStyles.find((style) => style.id === engineStyle.id);
      return {
        id: engineStyle.id,
        name: engineStyle.name || local?.name || engineStyle.id,
        description: engineStyle.description || local?.description || "",
        // เร็ว/ละเอียด อ่านจาก lane จริง ไม่ใช่ข้อความที่พิมพ์ไว้ตายตัว
        lane: engineStyle.lane === "hyperframes" ? "hyperframes" : "ass",
        speed: engineStyle.lane === "hyperframes" ? "ละเอียดกว่า" : "เร็วมาก",
        mode: local?.mode ?? (engineStyle.lane === "hyperframes" ? "kanit" : "karaoke"),
        badge: engineStyle.lane === "hyperframes" ? "คุณภาพสูง" : local?.badge,
        params: engineStyle.params,
        live: true,
      };
    });
  }, [engineStyles]);

  // กรองตามเลนที่ใช้เรนเดอร์จริง — สองเลนนี้ต่างกันทั้งหน้าตาและเวลาเรนเดอร์
  // จึงเป็นสิ่งแรกที่คนเลือกสไตล์อยากแยก
  const laneCounts = {
    all: styles.length,
    hyperframes: styles.filter((style) => style.lane === "hyperframes").length,
    ass: styles.filter((style) => style.lane !== "hyperframes").length,
  };
  const visibleStyles = laneFilter === "all" ? styles : styles.filter((style) => (
    laneFilter === "hyperframes" ? style.lane === "hyperframes" : style.lane !== "hyperframes"
  ));

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

        <div className="style-filter-row" role="group" aria-label="กรองตามวิธีเรนเดอร์">
          {([
            ["all", "ทั้งหมด", laneCounts.all],
            ["hyperframes", "HyperFrames", laneCounts.hyperframes],
            ["ass", "เรนเดอร์เร็ว", laneCounts.ass],
          ] as const).map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={laneFilter === value ? "active" : ""}
              disabled={count === 0}
              aria-pressed={laneFilter === value}
              onClick={() => setLaneFilter(value)}
            >
              {label} <em>{count}</em>
            </button>
          ))}
          <span className="style-filter-note">
            {laneFilter === "hyperframes"
              ? "เลเยอร์ซับเรนเดอร์แยกแล้ววางทับ ลูกเล่นเยอะกว่า แต่ใช้เวลานานกว่า"
              : laneFilter === "ass"
                ? "เผาซับลงภาพตรง ๆ เสร็จไวที่สุด เหมาะกับงานร่าง"
                : "สองวิธีเรนเดอร์ ต่างกันทั้งลูกเล่นและเวลาที่ใช้"}
          </span>
        </div>

        <section className="style-gallery" aria-label="สไตล์คำบรรยาย">
          {visibleStyles.map((style, index) => {
            const isSelected = selectedStyle === style.id;
            return (
              <article
                className={`style-card${isSelected ? " style-card-selected" : ""}`}
                key={style.id}
                style={stylePreviewVars(style.params)}
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
                  <StyleCaptionPreview params={style.params} index={index} />
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

        .style-filter-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
          margin-bottom: 15px;
        }

        .style-filter-row button {
          min-height: 32px;
          padding: 0 13px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          color: var(--ink-soft);
          font: inherit;
          font-size: 12.5px;
          cursor: pointer;
          transition: border-color .14s ease, background .14s ease, color .14s ease;
        }

        .style-filter-row button:hover:not(:disabled):not(.active) {
          border-color: var(--ink-faint);
          color: var(--ink);
        }

        .style-filter-row button.active {
          border-color: #262b25;
          background: #242924;
          color: #fff;
        }

        .style-filter-row button em {
          margin-left: 4px;
          font-style: normal;
          font-variant-numeric: tabular-nums;
          opacity: .6;
        }

        .style-filter-row button:disabled { opacity: .42; cursor: not-allowed; }

        .style-filter-note {
          margin-left: 4px;
          color: var(--ink-faint);
          font-size: 12px;
        }

        @media (max-width: 720px) {
          .style-filter-note { flex-basis: 100%; margin: 2px 0 0; }
        }

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
          .style-filter-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
          margin-bottom: 15px;
        }

        .style-filter-row button {
          min-height: 32px;
          padding: 0 13px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          color: var(--ink-soft);
          font: inherit;
          font-size: 12.5px;
          cursor: pointer;
          transition: border-color .14s ease, background .14s ease, color .14s ease;
        }

        .style-filter-row button:hover:not(:disabled):not(.active) {
          border-color: var(--ink-faint);
          color: var(--ink);
        }

        .style-filter-row button.active {
          border-color: #262b25;
          background: #242924;
          color: #fff;
        }

        .style-filter-row button em {
          margin-left: 4px;
          font-style: normal;
          font-variant-numeric: tabular-nums;
          opacity: .6;
        }

        .style-filter-row button:disabled { opacity: .42; cursor: not-allowed; }

        .style-filter-note {
          margin-left: 4px;
          color: var(--ink-faint);
          font-size: 12px;
        }

        @media (max-width: 720px) {
          .style-filter-note { flex-basis: 100%; margin: 2px 0 0; }
        }

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
          .style-filter-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
          margin-bottom: 15px;
        }

        .style-filter-row button {
          min-height: 32px;
          padding: 0 13px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          color: var(--ink-soft);
          font: inherit;
          font-size: 12.5px;
          cursor: pointer;
          transition: border-color .14s ease, background .14s ease, color .14s ease;
        }

        .style-filter-row button:hover:not(:disabled):not(.active) {
          border-color: var(--ink-faint);
          color: var(--ink);
        }

        .style-filter-row button.active {
          border-color: #262b25;
          background: #242924;
          color: #fff;
        }

        .style-filter-row button em {
          margin-left: 4px;
          font-style: normal;
          font-variant-numeric: tabular-nums;
          opacity: .6;
        }

        .style-filter-row button:disabled { opacity: .42; cursor: not-allowed; }

        .style-filter-note {
          margin-left: 4px;
          color: var(--ink-faint);
          font-size: 12px;
        }

        @media (max-width: 720px) {
          .style-filter-note { flex-basis: 100%; margin: 2px 0 0; }
        }

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
