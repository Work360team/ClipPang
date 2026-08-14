"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { localApi, type LocalUser } from "../lib/local-api";

/**
 * จัดการบัญชีผู้ใช้ — เห็นเฉพาะเจ้าของระบบ
 *
 * เซิร์ฟเวอร์เป็นคนตัดสินสิทธิ์อยู่แล้ว (403 ถ้าไม่ใช่เจ้าของ) การ์ดนี้แค่ซ่อนตัวเอง
 * เมื่อเรียกแล้วไม่ผ่าน ไม่ได้ใช้เป็นด่านความปลอดภัย
 */
export function UsersCard({ engineState }: { engineState: string }) {
  const [users, setUsers] = useState<LocalUser[] | null>(null);
  const [me, setMe] = useState("");
  const [unowned, setUnowned] = useState(0);
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ username: "", password: "" });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pendingDelete, setPendingDelete] = useState<LocalUser | null>(null);

  const load = useCallback(() => {
    localApi.users()
      .then((result) => {
        setUsers(result.users);
        setMe(result.me);
        setUnowned(result.unownedProjects);
        setAllowed(true);
      })
      .catch((caught) => {
        if ((caught as { status?: number })?.status === 403) setAllowed(false);
        else setError(caught instanceof Error ? caught.message : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
      });
  }, []);

  useEffect(() => {
    if (engineState !== "connected") return;
    load();
  }, [engineState, load]);

  if (engineState !== "connected" || !allowed) return null;

  const run = async (label: string, action: () => Promise<unknown>, done: string) => {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(done);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="settings-card" aria-labelledby="users-title">
      <div className="settings-section-head">
        <div className="settings-section-icon settings-icon-key"><Users size={20} /></div>
        <div>
          <h2 id="users-title">บัญชีผู้ใช้</h2>
          <p>เพิ่มคนเข้ามาใช้ระบบ แต่ละคนเห็นเฉพาะโปรเจกต์ของตัวเอง และใช้โควตาคีย์ของตัวเอง</p>
        </div>
      </div>

      {users === null ? <p className="key-hint">กำลังโหลดรายชื่อ…</p> : (
        <>
          <ul className="user-list">
            {users.map((user) => (
              <li className={`user-row ${user.disabled ? "is-off" : ""}`} key={user.id}>
                <span className={`user-avatar ${user.role === "owner" ? "is-owner" : ""}`}>
                  {user.role === "owner" ? <ShieldCheck size={15} /> : user.username.slice(0, 1).toUpperCase()}
                </span>
                <div className="user-copy">
                  <b>
                    {user.username}
                    {user.id === me && <em className="user-tag">คุณ</em>}
                    {user.role === "owner" && <em className="user-tag is-owner">เจ้าของระบบ</em>}
                    {user.disabled && <em className="user-tag is-off">ปิดใช้งาน</em>}
                  </b>
                  <small>
                    {user.projects} โปรเจกต์ · {user.keys ? `คีย์ของตัวเอง ${user.keys} ใบ` : "ใช้คีย์ของเครื่อง"} · วันนี้ใช้ {user.usedToday} คำขอ
                  </small>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() => { setResetFor(resetFor === user.id ? null : user.id); setNewPassword(""); }}
                  >
                    <KeyRound size={14} /> รหัสผ่าน
                  </button>
                  {user.id !== me && (
                    <>
                      <button
                        type="button"
                        className="text-button"
                        disabled={Boolean(busy)}
                        onClick={() => void run("toggle", () => localApi.updateUser(user.id, { disabled: !user.disabled }),
                          user.disabled ? `เปิดใช้งาน ${user.username} แล้ว` : `ปิดใช้งาน ${user.username} แล้ว`)}
                      >
                        {user.disabled ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                      </button>
                      <button
                        type="button"
                        className="key-remove"
                        aria-label={`ลบบัญชี ${user.username}`}
                        disabled={Boolean(busy)}
                        onClick={() => setPendingDelete(user)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>

                {resetFor === user.id && (
                  <form
                    className="user-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run("password", () => localApi.updateUser(user.id, { password: newPassword }),
                        `เปลี่ยนรหัสผ่านของ ${user.username} แล้ว`).then(() => setResetFor(null));
                    }}
                  >
                    <input
                      type="password"
                      value={newPassword}
                      placeholder="รหัสผ่านใหม่ อย่างน้อย 8 ตัวอักษร"
                      autoComplete="new-password"
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <button type="submit" className="button button-outline button-small" disabled={newPassword.length < 8 || Boolean(busy)}>
                      บันทึก
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {unowned > 0 && (
            <p className="key-hint">มีโปรเจกต์ที่ยังไม่มีเจ้าของ {unowned} รายการ — ทุกคนยังเห็นได้จนกว่าจะยกให้ใครสักคน</p>
          )}

          <form
            className="user-add"
            onSubmit={(event) => {
              event.preventDefault();
              void run("create", () => localApi.createUser(draft), `เพิ่มบัญชี ${draft.username} แล้ว`)
                .then(() => setDraft({ username: "", password: "" }));
            }}
          >
            <div className="settings-input-wrap">
              <UserPlus size={16} aria-hidden="true" />
              <input
                value={draft.username}
                placeholder="ชื่อผู้ใช้ใหม่"
                autoComplete="off"
                autoCapitalize="none"
                aria-label="ชื่อผู้ใช้ใหม่"
                onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
              />
            </div>
            <div className="settings-input-wrap">
              <KeyRound size={16} aria-hidden="true" />
              <input
                type="password"
                value={draft.password}
                placeholder="รหัสผ่าน อย่างน้อย 8 ตัวอักษร"
                autoComplete="new-password"
                aria-label="รหัสผ่านของบัญชีใหม่"
                onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
              />
            </div>
            <button
              type="submit"
              className="button button-outline"
              disabled={draft.username.trim().length < 2 || draft.password.length < 8 || Boolean(busy)}
            >
              <Plus size={15} /> {busy === "create" ? "กำลังเพิ่ม…" : "เพิ่มบัญชี"}
            </button>
          </form>

          {message && <p className="key-hint" role="status">{message}</p>}
          {error && <p className="key-hint idea-error" role="alert">{error}</p>}

          <p className="key-note">
            บัญชีใหม่จะยังไม่มีคีย์ Gemini ของตัวเอง จึงใช้คีย์ของเครื่องร่วมกันไปก่อน —
            ให้เขาไปใส่คีย์ของตัวเองในหน้าตั้งค่าเพื่อแยกโควตาออกจากกัน
          </p>
        </>
      )}

      {pendingDelete && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-delete-title">
          <button type="button" className="confirm-scrim" aria-label="ยกเลิก" onClick={() => setPendingDelete(null)} />
          <div className="confirm-card">
            <h3 id="user-delete-title">ลบบัญชี “{pendingDelete.username}” ?</h3>
            <p>
              โปรเจกต์ {pendingDelete.projects} รายการของเขาจะไม่ถูกลบ แต่จะไม่มีเจ้าของ —
              ย้ายให้คนอื่นก่อนลบได้ด้วยคำสั่ง transfer
            </p>
            <div className="confirm-actions">
              <button type="button" className="button button-outline" disabled={Boolean(busy)} onClick={() => setPendingDelete(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="button button-danger"
                disabled={Boolean(busy)}
                onClick={() => {
                  const target = pendingDelete;
                  void run("delete", () => localApi.deleteUser(target.id), `ลบบัญชี ${target.username} แล้ว`)
                    .then(() => setPendingDelete(null));
                }}
              >
                {busy === "delete" ? "กำลังลบ…" : "ลบบัญชี"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .user-list { display: grid; gap: 8px; margin: 0 0 14px; padding: 0; list-style: none; }
        .user-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 11px; align-items: center;
          padding: 11px 13px; border: 1px solid var(--line); border-radius: 11px; }
        .user-row.is-off { opacity: .6; }
        .user-avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px;
          background: #eef0ea; color: var(--ink-soft); font-size: 13px; font-weight: 700; }
        .user-avatar.is-owner { background: rgba(255,210,63,.22); color: var(--yellow-dark); }
        .user-copy b { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 620; }
        .user-copy small { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-faint); }
        .user-tag { padding: 1px 7px; border-radius: 999px; background: #eef0ea; color: var(--ink-soft);
          font-size: 11px; font-style: normal; font-weight: 500; }
        .user-tag.is-owner { background: rgba(255,210,63,.2); color: var(--yellow-dark); }
        .user-tag.is-off { background: rgba(198,94,85,.12); color: var(--red); }
        .user-actions { display: flex; align-items: center; gap: 10px; }
        .user-inline-form { grid-column: 1 / -1; display: flex; gap: 8px; margin-top: 4px; }
        .user-inline-form input { flex: 1; min-width: 0; padding: 8px 11px; border: 1px solid var(--line);
          border-radius: 9px; font: inherit; font-size: 13px; background: #fafbf8; }
        .user-add { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: center; }
        @media (max-width: 720px) { .user-add { grid-template-columns: 1fr; } .user-row { grid-template-columns: 32px minmax(0,1fr); } .user-actions { grid-column: 1 / -1; } }
      `}</style>
    </section>
  );
}
