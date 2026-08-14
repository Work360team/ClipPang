"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, CircleAlert, Loader, TriangleAlert } from "lucide-react";
import { localApi, type LocalNotification } from "../lib/local-api";
import { HardLink as Link } from "./HardLink";

const TONE_ICON = {
  success: CheckCircle2,
  error: CircleAlert,
  warning: TriangleAlert,
  progress: Loader,
} as const;

/** เวลาแบบ "เมื่อ 3 นาทีที่แล้ว" อ่านง่ายกว่าเวลาเต็มสำหรับของที่เพิ่งเกิด */
function timeAgo(at: number) {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "เมื่อสักครู่";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  return `${Math.round(hours / 24)} วันที่แล้ว`;
}

/**
 * กระดิ่งแจ้งเตือน
 *
 * ทุกอย่างมาจาก /api/notifications ซึ่งคำนวณจากตาราง renders และสถานะโควตาที่มีอยู่แล้ว
 * จุดแดงจึงขึ้นเฉพาะตอนมีของจริง ไม่ใช่จุดแดงถาวรแบบก่อนหน้านี้
 */
export function NotificationBell({ engineState }: { engineState: string }) {
  const [items, setItems] = useState<LocalNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    localApi.notifications()
      .then((result) => {
        setItems(result.items ?? []);
        setUnread(result.unread ?? 0);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (engineState !== "connected") return undefined;
    load();
    // ถี่พอให้รู้ว่าเรนเดอร์เสร็จโดยไม่ต้องเฝ้าหน้าจอ แต่ไม่ถี่จนกวนเครื่อง
    const timer = window.setInterval(load, 15_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [engineState, load]);

  // ปิดเมื่อคลิกที่อื่นหรือกด Esc เหมือนเมนูอื่นในแอป
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // เปิดดู = อ่านแล้ว แต่ของที่ยังค้างอยู่ (คิว/โควตา) เซิร์ฟเวอร์จะยังนับให้อยู่
    if (next && unread > 0) {
      localApi.markNotificationsSeen().then(load).catch(() => undefined);
    }
  };

  if (engineState !== "connected") return null;

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        className="icon-button notification-button"
        type="button"
        aria-label={unread ? `การแจ้งเตือน ${unread} รายการใหม่` : "การแจ้งเตือน"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <Bell size={19} />
        {unread > 0 && <span aria-hidden="true" />}
      </button>

      {open && (
        <div className="notification-panel" role="menu">
          <div className="notification-head">
            <b>การแจ้งเตือน</b>
            <span>{items.length ? `${items.length} รายการ` : "ไม่มีรายการ"}</span>
          </div>

          {items.length === 0 ? (
            <p className="notification-empty">ยังไม่มีอะไรต้องแจ้ง — เรนเดอร์เสร็จหรือมีปัญหาเมื่อไหร่จะขึ้นตรงนี้</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => {
                const Icon = TONE_ICON[item.tone] ?? CheckCircle2;
                const body = (
                  <>
                    <span className={`notification-icon tone-${item.tone}`}><Icon size={15} /></span>
                    <span className="notification-copy">
                      <b>{item.title}</b>
                      <small>{item.detail}</small>
                      <time>{timeAgo(item.at)}</time>
                    </span>
                  </>
                );
                return (
                  <li className="notification-item" key={item.id}>
                    {item.href
                      ? <Link href={item.href} className="notification-link" onClick={() => setOpen(false)}>{body}</Link>
                      : <span className="notification-link">{body}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
