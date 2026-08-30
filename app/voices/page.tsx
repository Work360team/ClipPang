"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Mic, Settings, Sparkles, TriangleAlert } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { HardLink as Link } from "../components/HardLink";
import { VoiceCloneStudio } from "../components/VoiceCloneStudio";
import { localApi, type LocalVoiceClone, type VoiceCloneLibrary } from "../lib/local-api";

/** สิ่งที่คนอัดเสียงครั้งแรกมักพลาด วางไว้ก่อนถึงปุ่มอัดจะได้ไม่ต้องอัดซ้ำ */
const TIPS = [
  { title: "อยู่ในที่เงียบ", note: "ปิดพัดลม แอร์ และเพลง เสียงรบกวนติดไปด้วยจะทำให้เสียงที่โคลนออกมาแหบ" },
  { title: "พูดให้เป็นธรรมชาติ", note: "อ่านเหมือนคุยกับเพื่อน ไม่ต้องดัดเสียงแบบพิธีกร โมเดลเลียนตามที่ได้ยินจริง" },
  { title: "หนึ่งโทน หนึ่งตัวอย่าง", note: "อยากได้ทั้งสดใสและหนักแน่น ต้องอัดแยกกัน สั่งเปลี่ยนโทนทีหลังไม่ได้" },
  { title: "ห่างไมค์หนึ่งฝ่ามือ", note: "ใกล้เกินจะมีเสียงลมปะทะ ไกลเกินจะได้เสียงห้องมาแทนเสียงคุณ" },
];

export default function VoicesPage() {
  const [library, setLibrary] = useState<VoiceCloneLibrary | null>(null);
  // หน้านี้ไม่ผูกกับโปรเจกต์ไหน การเลือกจึงเป็นแค่ไฮไลต์ว่ากำลังดูตัวไหนอยู่
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // ต้องคงตัวตนของฟังก์ชันไว้ ไม่งั้นคลังเสียงจะมองว่า prop เปลี่ยนแล้วโหลดรายการซ้ำทุกครั้ง
  const handleSelect = useCallback((clone: LocalVoiceClone | null) => setHighlighted(clone?.id ?? null), []);

  useEffect(() => {
    let active = true;
    void localApi.voiceClones()
      .then((result) => { if (active) setLibrary(result); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const total = library?.clones.length ?? 0;
  const people = library?.speakers.length ?? 0;
  const engineReady = library?.engine.ready ?? true;

  return (
    <AppShell>
      <div className="voices-page">
        <header className="voices-heading">
          <div>
            <div className="voices-kicker"><Mic size={15} strokeWidth={2.3} /> เสียงของฉัน</div>
            <h1>พากย์คลิปด้วยเสียงตัวเอง</h1>
            <p>อัดครั้งเดียวใช้ได้ทุกคลิป เสียงเก็บไว้ในเครื่องคุณ และไม่กินโควตา Gemini</p>
          </div>
          <Link href="/p/new" className="voices-cta">
            <Sparkles size={16} /> สร้างคลิปด้วยเสียงนี้
          </Link>
        </header>

        <div className="voices-stats">
          <div className="voices-stat"><b>{total}</b><span>เสียงที่อัดไว้</span></div>
          <div className="voices-stat"><b>{people}</b><span>คนพูด</span></div>
          <div className={`voices-stat voices-status ${engineReady ? "ok" : "warn"}`}>
            {engineReady ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
            <span>{engineReady ? "เครื่องยนต์พร้อมใช้" : "ยังติดตั้งไม่ครบ"}</span>
            {!engineReady && <Link href="/setup"><Settings size={13} /> ไปติดตั้ง</Link>}
          </div>
        </div>

        <div className="voices-body">
          <section className="voices-studio">
            <VoiceCloneStudio
              variant="page"
              selectedId={highlighted}
              onSelect={handleSelect}
            />
          </section>

          <aside className="voices-tips">
            <h2>อัดยังไงให้เสียงเหมือนที่สุด</h2>
            <ol>
              {TIPS.map((tip) => (
                <li key={tip.title}>
                  <b>{tip.title}</b>
                  <small>{tip.note}</small>
                </li>
              ))}
            </ol>
            <p className="voices-privacy">
              เสียงต้นแบบเก็บอยู่ในเครื่องคุณเท่านั้น ไม่ถูกส่งขึ้นคลาวด์ และลบออกได้ตลอดเวลา
            </p>
          </aside>
        </div>
      </div>

      <style>{`
        .voices-page {
          width: 100%;
          max-width: 1180px;
          margin: 0 auto;
          padding: 34px 40px 56px;
        }

        .voices-heading {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 22px;
        }

        .voices-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
          color: #806300;
          font-size: 13px;
          font-weight: 650;
        }

        .voices-heading h1 { margin: 0; font-size: clamp(26px, 3.4vw, 38px); font-weight: 680; letter-spacing: -.02em; }
        .voices-heading p { margin: 7px 0 0; max-width: 52ch; color: var(--ink-soft); font-size: 14px; line-height: 1.6; }

        .voices-cta {
          flex: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 18px;
          height: 44px;
          border-radius: 12px;
          background: var(--yellow);
          color: #332800;
          font-size: 14px;
          font-weight: 620;
        }

        .voices-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        .voices-stat {
          display: grid;
          gap: 2px;
          padding: 14px 16px;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: var(--card);
        }

        .voices-stat b { font-size: 24px; font-weight: 680; line-height: 1.1; }
        .voices-stat span { color: var(--ink-faint); font-size: 12.5px; }

        .voices-status {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
        }

        .voices-status span { color: var(--ink); font-size: 13.5px; font-weight: 600; }
        .voices-status.ok { color: var(--green); }
        .voices-status.warn { border-color: #e8c98a; background: #fffaf0; color: #8a6316; }
        .voices-status a {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 9px;
          border-radius: 8px;
          background: #fff;
          border: 1px solid #e2c795;
          color: #7a5713;
          font-size: 12px;
          font-weight: 600;
        }

        .voices-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          align-items: start;
          gap: 18px;
        }

        .voices-studio,
        .voices-tips {
          padding: 18px;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: var(--card);
        }

        .voices-tips h2 { margin: 0 0 12px; font-size: 15px; font-weight: 640; }
        .voices-tips ol { display: grid; gap: 12px; margin: 0; padding: 0 0 0 18px; }
        .voices-tips li { color: var(--ink-soft); }
        .voices-tips li b { display: block; color: var(--ink); font-size: 13.5px; font-weight: 620; }
        .voices-tips li small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.55; }

        .voices-privacy {
          margin: 14px 0 0;
          padding-top: 12px;
          border-top: 1px solid var(--line);
          color: var(--ink-faint);
          font-size: 11.5px;
          line-height: 1.55;
        }

        /* บนมือถือหน้านี้ต้องอ่านได้ทีละเรื่อง เคล็ดลับลงไปอยู่ท้ายสุดหลังคลังเสียง
           เพราะคนที่เปิดหน้านี้ซ้ำมาเพื่อเลือกเสียง ไม่ได้มาอ่านวิธีอัดใหม่ทุกครั้ง */
        @media (max-width: 900px) {
          .voices-body { grid-template-columns: 1fr; }
        }

        @media (max-width: 700px) {
          .voices-page { padding: 14px 13px 20px; }
          .voices-heading { flex-direction: column; align-items: stretch; gap: 12px; margin-bottom: 14px; }
          .voices-kicker { display: none; }
          .voices-heading h1 { font-size: 22px; }
          .voices-heading p { font-size: 12.5px; }
          .voices-cta { justify-content: center; }
          .voices-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-bottom: 14px; }
          .voices-stat { padding: 11px 13px; border-radius: 12px; }
          .voices-stat b { font-size: 20px; }
          .voices-status { grid-column: 1 / -1; }
          .voices-studio, .voices-tips { padding: 13px; border-radius: 14px; }
        }
      `}</style>
    </AppShell>
  );
}
