"use client";

import { useEffect, useState } from "react";
import { CircleUser, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { localApi, type LocalAccount } from "../lib/local-api";

/**
 * บัญชีของฉัน — เปลี่ยนรหัสผ่านของตัวเองได้โดยไม่ต้องรอเจ้าของระบบ
 *
 * ต้องกรอกรหัสเดิมเสมอ ไม่ใช่พิธีกรรม แต่เพราะคุกกี้เซสชันที่ถูกขโมยไปจะได้
 * เปลี่ยนรหัสยึดบัญชีไม่ได้ และเมื่อเปลี่ยนสำเร็จ เซสชันบนเครื่องอื่นทั้งหมดจะหลุด
 */
export function AccountCard({ engineState }: { engineState: string }) {
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (engineState !== "connected") return;
    localApi.account().then(setAccount).catch(() => setAccount(null));
  }, [engineState]);

  if (engineState !== "connected" || !account) return null;

  const mismatch = form.confirm.length > 0 && form.next !== form.confirm;
  const ready = form.current.length > 0 && form.next.length >= 8 && form.next === form.confirm;

  const submit = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await localApi.changePassword(form.current, form.next);
      setForm({ current: "", next: "", confirm: "" });
      setMessage("เปลี่ยนรหัสผ่านแล้ว — เครื่องอื่นที่ยังค้างล็อกอินอยู่จะถูกให้เข้าใหม่");
      localApi.account().then(setAccount).catch(() => {});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card" aria-labelledby="account-title">
      <div className="settings-section-head">
        <div className="settings-section-icon settings-icon-key"><CircleUser size={20} /></div>
        <div>
          <h2 id="account-title">บัญชีของฉัน</h2>
          <p>ดูว่ากำลังใช้งานในชื่อไหน และเปลี่ยนรหัสผ่านของตัวเองได้ที่นี่</p>
        </div>
      </div>

      <div className="account-id">
        <span className={`user-avatar ${account.role === "owner" ? "is-owner" : ""}`}>
          {account.role === "owner" ? <ShieldCheck size={15} /> : account.username.slice(0, 1).toUpperCase()}
        </span>
        <div className="account-id-copy">
          <b>{account.username}</b>
          <small>
            {account.role === "owner" ? "เจ้าของระบบ" : "สมาชิก"}
            {account.passwordChangedAt
              ? ` · เปลี่ยนรหัสล่าสุด ${new Date(account.passwordChangedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}`
              : " · ยังไม่เคยเปลี่ยนรหัสผ่าน"}
          </small>
        </div>
      </div>

      {account.canChangePassword ? (
        <form
          className="account-form"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <label className="account-field">
            <span>รหัสผ่านเดิม</span>
            <div className="settings-input-wrap">
              <KeyRound size={16} aria-hidden="true" />
              <input
                type={reveal ? "text" : "password"}
                value={form.current}
                autoComplete="current-password"
                onChange={(event) => setForm((current) => ({ ...current, current: event.target.value }))}
              />
            </div>
          </label>
          <label className="account-field">
            <span>รหัสผ่านใหม่</span>
            <div className="settings-input-wrap">
              <KeyRound size={16} aria-hidden="true" />
              <input
                type={reveal ? "text" : "password"}
                value={form.next}
                autoComplete="new-password"
                placeholder="อย่างน้อย 8 ตัวอักษร"
                onChange={(event) => setForm((current) => ({ ...current, next: event.target.value }))}
              />
            </div>
          </label>
          <label className="account-field">
            <span>ยืนยันรหัสผ่านใหม่</span>
            <div className="settings-input-wrap" data-bad={mismatch || undefined}>
              <KeyRound size={16} aria-hidden="true" />
              <input
                type={reveal ? "text" : "password"}
                value={form.confirm}
                autoComplete="new-password"
                onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))}
              />
            </div>
          </label>

          <div className="account-actions">
            <button type="button" className="text-button" onClick={() => setReveal((value) => !value)}>
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />} {reveal ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            </button>
            <button type="submit" className="button button-outline" disabled={!ready || busy}>
              {busy ? "กำลังเปลี่ยน…" : "เปลี่ยนรหัสผ่าน"}
            </button>
          </div>

          {mismatch && <p className="key-hint idea-error">รหัสผ่านใหม่สองช่องยังไม่ตรงกัน</p>}
          {message && <p className="key-hint" role="status">{message}</p>}
          {error && <p className="key-hint idea-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className="key-note">
          ตอนนี้คุณเปิดจากเครื่องที่รัน Clip360 อยู่ จึงเข้าได้โดยไม่ต้องใส่รหัสผ่าน —
          การเปลี่ยนรหัสต้องทำจากการเข้าผ่านหน้าล็อกอิน หรือใช้คำสั่ง
          <code> node scripts/users.mjs password {account.username} &lt;รหัสใหม่&gt;</code>
        </p>
      )}

      <style>{`
        .account-id { display: flex; align-items: center; gap: 11px; padding: 11px 13px; margin-bottom: 14px;
          border: 1px solid var(--line); border-radius: 11px; background: #fafbf8; }
        .account-id-copy b { display: block; font-size: 13.5px; font-weight: 620; }
        .account-id-copy small { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-faint); }
        .account-form { display: grid; gap: 11px; }
        .account-field span { display: block; margin-bottom: 5px; font-size: 12.5px; color: var(--ink-soft); }
        .account-field .settings-input-wrap[data-bad] { border-color: var(--red); }
        .account-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .account-form code, .key-note code { padding: 1px 5px; border-radius: 5px; background: #eef0ea; font-size: 12px; }
      `}</style>
    </section>
  );
}
