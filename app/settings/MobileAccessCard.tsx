"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Smartphone } from "lucide-react";

type Tunnel = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  url: string;
  host: string;
  error: string;
};

/**
 * เปิดและปิด URL สำหรับเข้าจากมือถือ
 *
 * มีอยู่ในหน้าติดตั้งครั้งแรกด้วย แต่ต้องมีที่นี่เพราะ URL ของ quick tunnel
 * เปลี่ยนใหม่ทุกครั้งที่เปิดโปรแกรม การกลับไปหน้าติดตั้งครั้งแรกเพื่อดู URL ของวันนี้
 * เป็นเส้นทางที่ไม่มีใครเดาได้ว่าต้องไปทางนั้น
 */
export function MobileAccessCard({ engineState }: { engineState: string }) {
  const [tunnel, setTunnel] = useState<Tunnel | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [hasOwner, setHasOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tunnel");
      const data = await response.json();
      if (!data?.ok) return;
      setTunnel(data.tunnel ?? null);
      setAutoStart(Boolean(data.autoStart));
      setHasOwner(Boolean(data.account?.hasOwner));
    } catch {
      // เงียบไว้ — การ์ดนี้ไม่ใช่ของหลักของหน้า ไม่ควรขึ้นข้อความแดงเพราะโหลดพลาดครั้งเดียว
    }
  }, []);

  useEffect(() => {
    if (engineState !== "connected") return undefined;
    let active = true;
    fetch("/api/tunnel")
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data?.ok) return;
        setTunnel(data.tunnel ?? null);
        setAutoStart(Boolean(data.autoStart));
        setHasOwner(Boolean(data.account?.hasOwner));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [engineState]);

  const post = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!data?.ok) throw new Error(data?.error?.message ?? "ทำรายการไม่สำเร็จ");
      if (data.tunnel) setTunnel(data.tunnel);
      if (typeof data.autoStart === "boolean") setAutoStart(data.autoStart);
      if (data.warning) setMessage(data.warning);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!tunnel?.url) return;
    try {
      await navigator.clipboard.writeText(tunnel.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอกเอง");
    }
  };

  if (engineState !== "connected" || tunnel?.supported === false) return null;

  return (
    <section className="settings-card" aria-labelledby="mobile-title">
      <div className="settings-section-head">
        <div className="settings-section-icon settings-icon-folder"><Smartphone size={20} /></div>
        <div>
          <h2 id="mobile-title">ใช้จากมือถือ</h2>
          <p>เปิด URL ส่วนตัวให้เข้าจากที่ไหนก็ได้ ต้องใส่รหัสผ่านทุกครั้ง</p>
        </div>
      </div>

      {!hasOwner && (
        <p className="mobile-note warn">
          <CircleAlert size={16} /> ยังไม่ได้ตั้งรหัสผ่าน — ตั้งได้ที่หน้าเริ่มต้นใช้งาน ขั้นที่ 6
          เปิด URL โดยไม่มีรหัสผ่านไม่ได้
        </p>
      )}

      {tunnel?.running && tunnel.url && (
        <div className="mobile-url">
          <code>{tunnel.url}</code>
          <button type="button" onClick={() => void copy()}>
            <Copy size={15} /> {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </button>
        </div>
      )}

      {/* สวิตช์นี้คือสิ่งที่ทำให้ไม่ต้องมากดเปิดเองทุกวัน แต่ต้องบอกให้ชัดว่าเปิดค้างไว้
          แปลว่าเครื่องนี้เข้าถึงได้จากอินเทอร์เน็ตตลอดเวลาที่โปรแกรมเปิดอยู่ */}
      <div className="mobile-toggle">
        <input
          id="tunnel-auto-start"
          type="checkbox"
          checked={autoStart}
          disabled={busy || !hasOwner}
          onChange={(event) => void post("/api/tunnel/auto", { enabled: event.target.checked })}
        />
        <label htmlFor="tunnel-auto-start">
          <strong>เปิด URL ให้อัตโนมัติทุกครั้งที่เริ่มโปรแกรม</strong>
          <small>
            เปิดไว้แล้วหยิบมือถือมาใช้ได้เลย ไม่ต้องมากดเอง — URL จะเปลี่ยนใหม่ทุกครั้ง
            กลับมาดูที่นี่หรือดูในหน้าต่างโปรแกรมได้
          </small>
        </label>
      </div>

      {message && <p className="mobile-note warn"><CircleAlert size={16} /> {message}</p>}

      <div className="mobile-actions">
        {!tunnel?.installed && (
          <button type="button" className="button" disabled={busy} onClick={() => void post("/api/setup/tunnel").then(load)}>
            {busy ? "กำลังดาวน์โหลด…" : "ดาวน์โหลดตัวเชื่อมต่อ"}
          </button>
        )}
        {tunnel?.installed && !tunnel.running && (
          <button type="button" className="button button-primary" disabled={busy || !hasOwner} onClick={() => void post("/api/setup/tunnel/start")}>
            {busy ? "กำลังเปิด…" : "เปิด URL ตอนนี้"}
          </button>
        )}
        {tunnel?.running && (
          <>
            <span className="mobile-live"><Check size={14} strokeWidth={3} /> เปิดอยู่</span>
            <button type="button" className="button" disabled={busy} onClick={() => void post("/api/setup/tunnel/stop")}>
              ปิด URL
            </button>
          </>
        )}
      </div>

      <style>{`
        .mobile-url {
          display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
          margin-top: 14px; padding: 12px 14px;
          border: 1px solid rgba(98, 217, 163, 0.34); border-radius: 11px;
          background: rgba(98, 217, 163, 0.06);
        }
        .mobile-url code {
          flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere;
          font-family: ui-monospace, monospace; font-size: 13.5px; user-select: all;
        }
        .mobile-url button {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 13px; border: 1px solid var(--line, #d9dcd2); border-radius: 9px;
          background: transparent; font-size: 13px; cursor: pointer;
        }
        .mobile-toggle {
          display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 11px;
          align-items: start; margin-top: 16px; cursor: pointer;
        }
        .mobile-toggle input { margin-top: 4px; width: 17px; height: 17px; }
        .mobile-toggle label { cursor: pointer; }
        .mobile-toggle strong { display: block; font-size: 14px; font-weight: 600; }
        .mobile-toggle small { display: block; margin-top: 3px; font-size: 12.5px; line-height: 1.55; opacity: 0.72; }
        .mobile-note {
          display: flex; align-items: flex-start; gap: 8px;
          margin: 14px 0 0; font-size: 12.5px; line-height: 1.6;
        }
        .mobile-note.warn > svg { flex: 0 0 auto; margin-top: 2px; }
        .mobile-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 16px; }
        .mobile-live {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12.5px; font-weight: 600; color: #2f7d52;
        }
      `}</style>
    </section>
  );
}
