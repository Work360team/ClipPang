"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { localApi, type LocalQuota } from "../lib/local-api";

/**
 * โควตาของฉัน
 *
 * ตัวเลขที่นี่คือจำนวนคำขอที่ "เราเป็นคนนับเอง" ไม่ใช่โควตาจริงจาก Google —
 * โควตาจริงผูกกับคีย์ ไม่ได้ผูกกับบัญชีในระบบเรา ใครใช้คีย์ของเครื่องร่วมกัน
 * ก็แชร์โควตาก้อนเดียวกัน การ์ดนี้จึงบอกให้ชัดว่ากำลังใช้คีย์ชุดไหนอยู่
 */

/** เที่ยงคืนเวลาแปซิฟิกคือจุดรีเซ็ตโควตาของ Google เหลืออีกกี่ชั่วโมง */
function hoursToReset(now = Date.now()) {
  const pacific = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const passed = pacific.getHours() + pacific.getMinutes() / 60;
  return Math.max(0, 24 - passed);
}

function dayLabel(day: string) {
  const parsed = new Date(`${day}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/** ช่วง 7 วันย้อนหลังตามวันแบบแปซิฟิก เพราะโควตาของ Google รีเซ็ตตามเขตเวลานั้น */
function lastSevenDays(history: LocalQuota["history"], now: number) {
  const byDay = new Map(history.map((entry) => [entry.day, entry.requests]));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now - (6 - index) * 86_400_000)
      .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    return { day, requests: byDay.get(day) ?? 0 };
  });
}

interface QuotaView {
  quota: LocalQuota;
  days: { day: string; requests: number }[];
  today: string;
  reset: number;
}

export function QuotaCard({ engineState }: { engineState: string }) {
  const [view, setView] = useState<QuotaView | null>(null);
  const [busy, setBusy] = useState(false);

  // คำนวณวันทั้งหมดตอนข้อมูลมาถึง ไม่ใช่ตอน render — เวลาปัจจุบันไม่ควรเปลี่ยนผลลัพธ์
  // ของการ render รอบเดียวกัน
  const load = useCallback(() => {
    return localApi.quota()
      .then((quota) => {
        const now = Date.now();
        setView({
          quota,
          days: lastSevenDays(quota.history, now),
          today: new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
          reset: Math.round(hoursToReset(now)),
        });
      })
      .catch(() => setView(null));
  }, []);

  useEffect(() => {
    if (engineState !== "connected") return;
    void load();
  }, [engineState, load]);

  if (engineState !== "connected" || !view) return null;

  const { quota, days: history, today, reset } = view;
  const refresh = () => {
    setBusy(true);
    void load().finally(() => setBusy(false));
  };
  const peak = Math.max(1, ...history.map((entry) => entry.requests));
  const capped = quota.cap > 0;
  const used = quota.usedToday;
  const percent = capped ? Math.min(100, Math.round((used / quota.cap) * 100)) : 0;

  return (
    <section className="settings-card" aria-labelledby="quota-title">
      <div className="settings-section-head">
        <div className="settings-section-icon settings-icon-key"><Gauge size={20} /></div>
        <div>
          <h2 id="quota-title">โควตาของฉัน</h2>
          <p>จำนวนคำขอสร้างเสียงที่ใช้ไปวันนี้ และคีย์ที่บัญชีนี้กำลังใช้อยู่</p>
        </div>
        <button type="button" className="text-button quota-refresh" onClick={refresh} disabled={busy}>
          <RefreshCw size={14} /> {busy ? "กำลังโหลด…" : "รีเฟรช"}
        </button>
      </div>

      <div className="quota-grid">
        <div className="quota-stat">
          <b>{used}</b>
          <small>คำขอวันนี้</small>
        </div>
        <div className="quota-stat">
          <b>{capped ? quota.remaining ?? 0 : "ไม่จำกัด"}</b>
          <small>{capped ? "เหลือได้อีก" : "ไม่มีเพดานรายวัน"}</small>
        </div>
        <div className="quota-stat">
          <b>{quota.keyCount}</b>
          <small>{quota.scope === "user" ? "คีย์ของตัวเอง" : "คีย์ของเครื่อง (ใช้ร่วมกัน)"}</small>
        </div>
      </div>

      {capped && (
        <div className="quota-bar" role="img" aria-label={`ใช้ไป ${used} จากเพดาน ${quota.cap} คำขอ`}>
          <span style={{ width: `${percent}%` }} data-full={percent >= 100 || undefined} />
        </div>
      )}

      <p className="key-hint">
        {quota.scope === "user"
          ? `บัญชีนี้ใช้คีย์ของตัวเอง โควตาจึงแยกจากคนอื่นจริง ๆ${capped ? "" : " และไม่ถูกจำกัดโดยเพดานของระบบ"}`
          : "บัญชีนี้ยังใช้คีย์ของเครื่องร่วมกับคนอื่น — ใส่คีย์ Gemini ของตัวเองในหน้านี้เพื่อแยกโควตาออกมา"}
        {" · "}โควตาฝั่ง Google รีเซ็ตอีกประมาณ {reset} ชั่วโมง
      </p>

      <h3 className="quota-sub">7 วันล่าสุด</h3>
      <ul className="quota-history">
        {history.map((entry) => (
          <li key={entry.day} className={entry.day === today ? "is-today" : ""}>
            <span className="quota-track">
              <span style={{ height: `${Math.round((entry.requests / peak) * 100)}%` }} />
            </span>
            <b>{entry.requests}</b>
            <small>{dayLabel(entry.day)}</small>
          </li>
        ))}
      </ul>

      <p className="key-note">
        ตัวเลขนี้นับจากคำขอที่ Clip360 ยิงออกไปเอง หนึ่งท่อนเสียงเท่ากับหนึ่งคำขอ —
        โควตาจริงของ Google ผูกกับคีย์ ไม่ได้ผูกกับบัญชี ถ้าเอาคีย์เดียวกันไปใช้ที่อื่นด้วย ตัวเลขจะไม่ตรงกัน
      </p>

      <style>{`
        .quota-refresh { margin-left: auto; align-self: flex-start; }
        .quota-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
        .quota-stat { padding: 12px 13px; border: 1px solid var(--line); border-radius: 11px; background: #fafbf8; }
        .quota-stat b { display: block; font-size: 21px; font-weight: 680; line-height: 1.15; }
        .quota-stat small { display: block; margin-top: 3px; font-size: 11.5px; color: var(--ink-faint); }
        .quota-bar { height: 7px; border-radius: 999px; background: #eef0ea; overflow: hidden; margin-bottom: 10px; }
        .quota-bar span { display: block; height: 100%; border-radius: 999px; background: var(--yellow-dark); transition: width .3s ease; }
        .quota-bar span[data-full] { background: var(--red); }
        .quota-sub { margin: 16px 0 8px; font-size: 13px; font-weight: 620; color: var(--ink-soft); }
        .quota-history { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px;
          margin: 0 0 12px; padding: 0; list-style: none; }
        .quota-history li { display: grid; justify-items: center; gap: 4px; }
        .quota-track { display: flex; align-items: flex-end; width: 100%; height: 52px; padding: 3px;
          border-radius: 8px; background: #f1f2ec; }
        .quota-track > span { width: 100%; min-height: 3px; border-radius: 6px; background: #cdd2c6; }
        .quota-history li.is-today .quota-track > span { background: var(--yellow-dark); }
        .quota-history b { font-size: 12.5px; font-weight: 620; }
        .quota-history small { font-size: 11px; color: var(--ink-faint); }
        @media (max-width: 640px) { .quota-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}
