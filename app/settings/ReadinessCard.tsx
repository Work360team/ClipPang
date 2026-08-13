"use client";

import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";

type Row = { id: string; label: string; ok: boolean; detail: string };

/**
 * สรุปว่า "เครื่องนี้พร้อมทำคลิปหรือยัง" ไว้บนสุดของหน้าตั้งค่า
 *
 * หน้านี้เดิมมีการ์ด 7 ใบเรียงกันโดยไม่บอกว่าอันไหนสำคัญ ผู้ใช้ต้องไล่อ่านเองว่า
 * ตกลงพร้อมใช้งานหรือยัง — สามบรรทัดนี้ตอบคำถามนั้นทันทีแล้วค่อยให้ไปแก้ทีละส่วน
 */
export function ReadinessCard({ engineState }: { engineState: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (engineState !== "connected") return undefined;
    let active = true;
    Promise.all([
      fetch("/api/setup/status").then((r) => r.json()).catch(() => null),
      fetch("/api/tts/health").then((r) => r.json()).catch(() => null),
      fetch("/api/ai/providers").then((r) => r.json()).catch(() => null),
    ]).then(([setup, tts, ai]) => {
      if (!active) return;
      const ffmpeg = setup?.ffmpeg;
      const ffmpegOk = typeof ffmpeg === "boolean" ? ffmpeg : Boolean(ffmpeg?.ready);
      const health = tts?.health;
      const providers = ai?.providers ?? [];
      const activeProvider = ai?.selected === "auto"
        ? providers.find((p: { available: boolean }) => p.available)
        : providers.find((p: { id: string }) => p.id === ai?.selected);
      setRows([
        {
          id: "ffmpeg",
          label: "ตัดต่อวิดีโอ (FFmpeg)",
          ok: ffmpegOk,
          detail: ffmpegOk
            ? `พร้อม${typeof ffmpeg === "object" && ffmpeg?.version ? ` · ${ffmpeg.version}` : ""}`
            : "ยังไม่พร้อม — ไปที่หน้าเริ่มต้นใช้งานเพื่อติดตั้ง",
        },
        {
          id: "voice",
          label: "เสียงพากย์",
          ok: Boolean(health?.ok),
          detail: health?.ok
            ? `พร้อม · ใช้ได้ ${health.availableKeys} จาก ${health.totalKeys} คีย์`
            : health?.reason ?? "ยังไม่ได้ใส่คีย์",
        },
        {
          id: "script",
          label: "ผู้ช่วยเขียนสคริปต์",
          ok: Boolean(activeProvider),
          detail: activeProvider
            ? `พร้อม · ${String(activeProvider.label).split(" (")[0]}`
            : "ยังไม่มีตัวเลือกที่ใช้ได้ — จะใช้ตัวเขียนสำรองในเครื่องแทน",
        },
      ]);
    });
    return () => { active = false; };
  }, [engineState]);

  if (engineState !== "connected" || !rows) return null;

  const blocked = rows.filter((row) => !row.ok);
  const allReady = blocked.length === 0;

  return (
    <section className={`ready-card ${allReady ? "ok" : "warn"}`} aria-labelledby="ready-title">
      <div className="ready-head">
        <span className="ready-icon">{allReady ? <Check size={19} /> : <TriangleAlert size={19} />}</span>
        <div>
          <h2 id="ready-title">{allReady ? "เครื่องนี้พร้อมทำคลิปแล้ว" : `ยังขาดอีก ${blocked.length} อย่างก่อนทำคลิปได้`}</h2>
          <p>{allReady ? "ทุกส่วนตรวจแล้วผ่าน กดสร้างคลิปได้เลย" : "แก้ตามรายการด้านล่าง แล้วกด ตรวจใหม่ ในการ์ดของส่วนนั้น"}</p>
        </div>
      </div>
      <ul className="ready-list">
        {rows.map((row) => (
          <li key={row.id} className={row.ok ? "ok" : "warn"}>
            <span className="ready-dot" aria-hidden="true" />
            <b>{row.label}</b>
            <small>{row.detail}</small>
          </li>
        ))}
      </ul>

      <style>{`
        .ready-card { padding: 20px 22px; border-radius: 14px; border: 1px solid var(--line, #2a312a); background: var(--panel, #141714); margin-bottom: 18px; }
        .ready-card.ok { border-color: rgba(79,191,139,.35); }
        .ready-card.warn { border-color: rgba(224,163,60,.35); }
        .ready-head { display: grid; grid-template-columns: auto 1fr; gap: 13px; align-items: start; margin-bottom: 14px; }
        .ready-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; }
        .ready-card.ok .ready-icon { background: rgba(79,191,139,.13); color: #4fbf8b; }
        .ready-card.warn .ready-icon { background: rgba(224,163,60,.13); color: #e0a33c; }
        .ready-head h2 { margin: 0 0 3px; font-size: 17px; }
        .ready-head p { margin: 0; font-size: 13px; opacity: .68; }
        .ready-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
        .ready-list li { display: grid; grid-template-columns: 9px auto 1fr; gap: 10px; align-items: baseline; font-size: 13.5px; }
        .ready-list b { font-weight: 600; white-space: nowrap; }
        .ready-list small { font-size: 12.5px; opacity: .66; }
        .ready-dot { width: 9px; height: 9px; border-radius: 50%; align-self: center; }
        .ready-list li.ok .ready-dot { background: #4fbf8b; }
        .ready-list li.warn .ready-dot { background: #e0a33c; }
        @media (max-width: 640px) {
          .ready-list li { grid-template-columns: 9px 1fr; }
          .ready-list small { grid-column: 2; }
        }
      `}</style>
    </section>
  );
}
