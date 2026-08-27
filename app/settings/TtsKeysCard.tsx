"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Plus, RefreshCw, Trash2, TriangleAlert, Volume2 } from "lucide-react";
import { localApi } from "../lib/local-api";

const TEST_SENTENCE = "สวัสดีค่ะ Clip360 พร้อมช่วยทำคลิปให้ปังขึ้น";
const TEST_CAPTIONS = `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT

00:00.000 --> 00:10.000
${TEST_SENTENCE}`)}`;

type KeyStatus = {
  slot: string;
  last4: string;
  usable: boolean;
  code: string;
  note: string | null;
};

type Health = {
  ok: boolean;
  code: string;
  reason: string | null;
  availableKeys: number;
  totalKeys: number;
  keys: KeyStatus[];
};

/**
 * จัดการคีย์ Gemini หลายใบสำหรับ failover
 *
 * โควตา free tier นับต่อโปรเจกต์ (วันละ 10 คำขอต่อโมเดล) คีย์จากคนละโปรเจกต์
 * จึงมีโควตาแยกกัน ถ้าใบหนึ่งเต็มระบบจะสลับไปใบถัดไปเองระหว่างเรนเดอร์
 */
export function TtsKeysCard({ engineState }: { engineState: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await fetch(`/api/tts/health${refresh ? "?refresh=1" : ""}`);
      const data = await response.json();
      setHealth(data.health ?? null);
    } catch {
      setHealth(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (engineState !== "connected") return undefined;
    let active = true;
    fetch("/api/tts/health")
      .then((response) => response.json())
      .then((data) => { if (active) setHealth(data.health ?? null); })
      .catch(() => undefined)
      .finally(() => active && setLoaded(true));
    return () => { active = false; };
  }, [engineState]);

  if (engineState !== "connected") return null;

  const keys = health?.keys ?? [];

  const addKey = async () => {
    setBusy("add");
    setMessage("");
    try {
      const response = await fetch("/api/tts/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: draft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "เพิ่มคีย์ไม่สำเร็จ");
      setDraft("");
      setMessage(`เพิ่มคีย์ ••••${data.last4} แล้ว`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เพิ่มคีย์ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  const removeKey = async (slot: string) => {
    setBusy(slot);
    setMessage("");
    try {
      const response = await fetch(`/api/tts/keys/${slot}`, { method: "DELETE" });
      if (!response.ok) throw new Error("ลบคีย์ไม่สำเร็จ");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ลบคีย์ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="settings-card" aria-labelledby="tts-keys-title">
      <div className="settings-section-head">
        <div className="settings-section-icon settings-icon-key"><KeyRound size={20} /></div>
        <div>
          <h2 id="tts-keys-title">เสียงพากย์ (Gemini)</h2>
          <p>คีย์ที่ใช้สร้างเสียง ใส่ได้หลายใบ ถ้าใบหนึ่งโควตาเต็มระบบจะสลับไปใบถัดไปให้เอง</p>
        </div>
        <button type="button" className="text-button" onClick={() => void load(true)} disabled={Boolean(busy)}>
          <RefreshCw size={15} /> ตรวจใหม่
        </button>
      </div>

      {!loaded ? <p className="key-hint">กำลังตรวจสถานะคีย์…</p> : (
        <>
          {health && (
            <div className={`key-summary ${health.ok ? "ok" : "bad"}`}>
              {health.ok ? <Check size={16} /> : <TriangleAlert size={16} />}
              <span>
                <b>ใช้ได้ {health.availableKeys} จาก {health.totalKeys} คีย์</b>
                {health.reason ? ` · ${health.reason}` : " · พร้อมสร้างคลิป"}
              </span>
            </div>
          )}

          <ul className="key-list">
            {keys.map((key) => (
              <li className={`key-row ${key.usable ? "" : "is-down"}`} key={key.slot}>
                <span className={`key-dot ${key.usable ? "ok" : "bad"}`} aria-hidden="true" />
                <div>
                  <b>••••{key.last4}</b>
                  <small>{key.note ?? "พร้อมใช้งาน"}</small>
                </div>
                <span className="key-slot">{key.slot === "GEMINI_API_KEY" ? "ใบหลัก" : `ใบที่ ${key.slot.replace("GEMINI_API_KEY_", "")}`}</span>
                <button
                  type="button"
                  className="key-remove"
                  aria-label={`ลบคีย์ ••••${key.last4}`}
                  disabled={Boolean(busy) || keys.length === 1}
                  title={keys.length === 1 ? "ต้องเหลืออย่างน้อยหนึ่งคีย์" : "ลบคีย์นี้"}
                  onClick={() => void removeKey(key.slot)}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>

          <div className="key-add">
            <div className="settings-input-wrap">
              <KeyRound size={16} aria-hidden="true" />
              <input
                type="password"
                value={draft}
                placeholder="วางคีย์อีกใบจากอีกโปรเจกต์เพื่อเพิ่มโควตา"
                autoComplete="off"
                spellCheck={false}
                aria-label="Gemini API key ใบใหม่"
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="button button-outline"
              disabled={Boolean(busy) || draft.trim().length < 16}
              onClick={() => void addKey()}
            >
              <Plus size={15} /> {busy === "add" ? "กำลังตรวจคีย์…" : "เพิ่มคีย์"}
            </button>
          </div>

          {message && <p className="key-hint" role="status">{message}</p>}

          {/* ฟังเสียงจริงหนึ่งประโยค — พิสูจน์ว่าคีย์ใช้ได้จริง ไม่ใช่แค่ผ่านการตรวจ */}
          <div className="key-try">
            <button
              type="button"
              className="button button-outline"
              disabled={Boolean(busy) || !health?.ok}
              onClick={() => {
                setBusy("preview");
                setPreviewError("");
                setPreviewUrl("");
                localApi
                  .previewVoice("Kore", { text: TEST_SENTENCE, speed: 1, tone: "เป็นกันเอง" })
                  .then((blob) => setPreviewUrl(URL.createObjectURL(blob)))
                  .catch((error) => setPreviewError(error instanceof Error ? error.message : "สร้างเสียงทดสอบไม่สำเร็จ"))
                  .finally(() => setBusy(""));
              }}
            >
              <Volume2 size={15} /> {busy === "preview" ? "กำลังสร้างเสียง…" : "ฟังเสียงทดสอบ"}
            </button>
            <small>ใช้โควตา 1 คำขอ</small>
          </div>
          {previewUrl && (
            <audio className="key-audio" controls src={previewUrl}>
              {/* ประโยคทดสอบเป็นข้อความคงที่ ใส่ track ไว้ให้คนที่ฟังไม่ได้อ่านแทน */}
              <track kind="captions" srcLang="th" label="คำบรรยาย" src={TEST_CAPTIONS} default />
            </audio>
          )}
          {previewError && <p className="key-hint" role="alert">{previewError}</p>}

          <p className="key-note">
            คีย์ใหม่ต้องมาจาก<strong>คนละโปรเจกต์ Google Cloud</strong>ถึงจะได้โควตาเพิ่ม —
            สร้างหลายคีย์ในโปรเจกต์เดียวกันใช้โควตาก้อนเดียวกัน
            หากใช้งานจริงจัง การเปิด billing คุ้มกว่าและไม่ต้องดูแลหลายบัญชี (ราว ฿0.15 ต่อคลิป)
          </p>
        </>
      )}

      <style>{`
        .key-summary { display: flex; align-items: center; gap: 9px; padding: 10px 13px; border-radius: 9px; font-size: 13.5px; margin-bottom: 14px; }
        .key-summary.ok { background: rgba(58,154,104,.09); border: 1px solid rgba(58,154,104,.28); color: var(--green); }
        .key-summary.bad { background: rgba(198,155,0,.09); border: 1px solid rgba(198,155,0,.28); color: var(--yellow-dark); }
        .key-summary b { font-weight: 700; }
        .key-list { display: grid; gap: 8px; margin: 0 0 14px; padding: 0; list-style: none; }
        .key-row { display: grid; grid-template-columns: 10px 1fr auto auto; gap: 11px; align-items: center; padding: 10px 13px; border: 1px solid var(--line); border-radius: 9px; }
        .key-row.is-down { opacity: .72; }
        .key-row b { display: block; font-size: 13.5px; font-family: ui-monospace, monospace; }
        .key-row small { display: block; font-size: 11.5px; opacity: .65; }
        .key-dot { width: 9px; height: 9px; border-radius: 50%; }
        .key-dot.ok { background: var(--green); }
        .key-dot.bad { background: var(--yellow-dark); }
        .key-slot { font-size: 11.5px; opacity: .6; white-space: nowrap; }
        .key-remove { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
        .key-remove:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
        .key-remove:disabled { opacity: .35; cursor: not-allowed; }
        .key-add { display: flex; gap: 8px; align-items: center; }
        .key-add .settings-input-wrap { flex: 1; min-width: 0; }
        /* ช่องกรอกมีความกว้างตั้งต้นของมันเองราว 280px ถ้าไม่ปลดออก แถวนี้จะย่อ
           ไม่ลงและดันหน้าตั้งค่าทั้งหน้าให้กว้างเกินจอมือถือ */
        .key-add .settings-input-wrap input { min-width: 0; }
        .key-try { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
        .key-try small { font-size: 11.5px; opacity: .6; }
        .key-audio { width: 100%; margin-top: 10px; height: 38px; }
        .key-hint { margin: 10px 0 0; font-size: 12.5px; opacity: .72; }
        .key-note { margin: 14px 0 0; padding: 10px 13px; border-radius: 9px; font-size: 12.5px; line-height: 1.6; background: rgba(255,210,63,.06); border: 1px solid rgba(255,210,63,.2); }
      `}</style>
    </section>
  );
}
