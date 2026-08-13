"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, Check, KeyRound, RefreshCw, TerminalSquare } from "lucide-react";

type ProviderStatus = {
  id: string;
  kind: "api" | "cli";
  label: string;
  note: string | null;
  model: string | null;
  defaultModel: string | null;
  available: boolean;
  reason: string | null;
  keyName?: string;
  keyUrl?: string;
  keyConfigured?: boolean;
  keyLast4?: string | null;
  command?: string;
  installUrl?: string;
  version?: string | null;
};

/**
 * เลือกผู้ให้บริการที่ใช้ "เขียนสคริปต์"
 *
 * สองชนิด: ใส่ API key เอง กับใช้ CLI ทางการที่ล็อกอิน subscription ไว้แล้วบนเครื่อง
 * การพากย์เสียงไม่เกี่ยวกับหน้านี้ — ยังต้องใช้ Gemini API key เสมอ (การ์ดถัดไป)
 */
export function AiProviderCard({ engineState }: { engineState: string }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selected, setSelected] = useState("auto");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await fetch(`/api/ai/providers${refresh ? "?refresh=1" : ""}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setProviders(data.providers ?? []);
      setSelected(data.selected ?? "auto");
    } catch {
      setProviders([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  // ตั้ง state ใน callback ของ promise ไม่ใช่ในตัว effect ตรง ๆ (กฎ react-hooks/set-state-in-effect)
  useEffect(() => {
    if (engineState !== "connected") return undefined;
    let active = true;
    fetch("/api/ai/providers")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        if (!active) return;
        setProviders(data.providers ?? []);
        setSelected(data.selected ?? "auto");
      })
      .catch(() => active && setProviders([]))
      .finally(() => active && setLoaded(true));
    return () => { active = false; };
  }, [engineState]);

  // ยังไม่ต่อ Local ก็ไม่ต้องรออะไร ถือว่าโหลดจบแล้ว
  const loading = engineState === "connected" && !loaded;

  const post = async (path: string, body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? "บันทึกไม่สำเร็จ");
      await load();
      setMessage(data?.message ?? "บันทึกแล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  if (engineState !== "connected") {
    return (
      <section className="settings-card" aria-labelledby="ai-title">
        <div className="settings-section-head">
          <div className="settings-section-icon settings-icon-key"><BrainCircuit size={20} /></div>
          <div>
            <h2 id="ai-title">ผู้ช่วยเขียนสคริปต์</h2>
            <p>เปิด ClipPang ผ่าน เริ่มโปรแกรม.bat เพื่อตั้งค่าส่วนนี้</p>
          </div>
        </div>
      </section>
    );
  }

  const apiProviders = providers.filter((provider) => provider.kind === "api");
  const cliProviders = providers.filter((provider) => provider.kind === "cli");
  const readyCli = cliProviders.filter((provider) => provider.available);

  return (
    <section className="settings-card" aria-labelledby="ai-title">
      <div className="settings-section-head">
        <div className="settings-section-icon settings-icon-key"><BrainCircuit size={20} /></div>
        <div>
          <h2 id="ai-title">ผู้ช่วยเขียนสคริปต์</h2>
          <p>เลือกได้ว่าจะใช้ API key ของคุณ หรือใช้ subscription ที่ล็อกอินไว้บนเครื่องแล้ว</p>
        </div>
        <button type="button" className="text-button" onClick={() => void load(true)} disabled={busy !== ""}>
          <RefreshCw size={15} /> ตรวจใหม่
        </button>
      </div>

      {loading ? <p className="ai-hint">กำลังตรวจสิ่งที่ใช้ได้บนเครื่องนี้…</p> : (
        <>
          <div className="ai-choice-list" role="radiogroup" aria-label="ผู้ให้บริการที่จะใช้">
            <button
              type="button"
              role="radio"
              aria-checked={selected === "auto"}
              className={`ai-choice ${selected === "auto" ? "is-selected" : ""}`}
              onClick={() => void post("/api/ai/providers/select", { provider: "auto" }, "auto")}
            >
              <span className="ai-choice-title">อัตโนมัติ <b>แนะนำ</b></span>
              <span className="ai-choice-sub">
                {readyCli.length > 0
                  ? `ใช้ ${readyCli[0].label.split(" (")[0]} ก่อน เพราะจ่าย subscription ไปแล้ว ไม่มีค่าใช้จ่ายต่อครั้ง`
                  : "เลือกตัวแรกที่ใช้ได้ให้เอง"}
              </span>
            </button>

            {cliProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={selected === provider.id}
                disabled={!provider.available || busy !== ""}
                className={`ai-choice ${selected === provider.id ? "is-selected" : ""} ${provider.available ? "" : "is-off"}`}
                onClick={() => void post("/api/ai/providers/select", { provider: provider.id }, provider.id)}
              >
                <span className="ai-choice-title"><TerminalSquare size={15} /> {provider.label}</span>
                <span className="ai-choice-sub">
                  {provider.available
                    ? <><Check size={13} /> พบแล้ว · {provider.version} · ไม่คิดค่า API เพิ่ม</>
                    : <>{provider.reason} — <a href={provider.installUrl} target="_blank" rel="noreferrer">วิธีติดตั้ง</a></>}
                </span>
              </button>
            ))}
          </div>

          {/* ช่องคีย์ 4 เจ้าทำให้การ์ดยาวมากทั้งที่คนส่วนใหญ่ใช้ค่าอัตโนมัติอยู่แล้ว
              ซ่อนไว้หลังหัวข้อที่กดเปิดได้ ใครต้องใช้ค่อยกาง */}
          <details className="ai-advanced">
            <summary>ใช้ API key ของคุณเอง (ไม่จำเป็นถ้าใช้โหมดอัตโนมัติ)</summary>
          <div className="ai-key-list">
            {apiProviders.map((provider) => (
              <div key={provider.id} className={`ai-key-row ${selected === provider.id ? "is-selected" : ""}`}>
                <div className="ai-key-head">
                  <b>{provider.label}</b>
                  {provider.keyConfigured
                    ? <span className="ai-badge ok"><Check size={12} /> ••••{provider.keyLast4}</span>
                    : <span className="ai-badge">ยังไม่ได้ใส่คีย์</span>}
                  {provider.keyConfigured && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy !== ""}
                      onClick={() => void post("/api/ai/providers/select", { provider: provider.id }, provider.id)}
                    >
                      {selected === provider.id ? "กำลังใช้อยู่" : "ใช้ตัวนี้"}
                    </button>
                  )}
                </div>
                {provider.note && <p className="ai-hint">{provider.note}</p>}
                <div className="ai-key-inputs">
                  <div className="settings-input-wrap">
                    <KeyRound size={16} aria-hidden="true" />
                    <input
                      type="password"
                      value={keyDrafts[provider.id] ?? ""}
                      placeholder={provider.keyConfigured ? "ใส่คีย์ใหม่เพื่อเปลี่ยน" : `วาง API key ของ ${provider.label}`}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`API key ของ ${provider.label}`}
                      onChange={(event) => setKeyDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                    />
                  </div>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy !== "" || (keyDrafts[provider.id] ?? "").trim().length < 16}
                    onClick={() => void post("/api/ai/providers/key", { provider: provider.id, key: keyDrafts[provider.id] }, provider.id)
                      .then(() => setKeyDrafts((current) => ({ ...current, [provider.id]: "" })))}
                  >
                    บันทึกคีย์
                  </button>
                </div>
                <div className="ai-key-inputs">
                  <div className="settings-input-wrap">
                    <input
                      value={modelDrafts[provider.id] ?? provider.model ?? ""}
                      spellCheck={false}
                      aria-label={`ชื่อรุ่นของ ${provider.label}`}
                      onChange={(event) => setModelDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                    />
                  </div>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy !== "" || !(modelDrafts[provider.id] ?? "").trim() || modelDrafts[provider.id] === provider.model}
                    onClick={() => void post("/api/ai/providers/model", { provider: provider.id, model: modelDrafts[provider.id] }, provider.id)}
                  >
                    เปลี่ยนรุ่น
                  </button>
                </div>
                {provider.keyUrl && !provider.keyConfigured && (
                  <p className="ai-hint">ขอคีย์ได้ที่ <a href={provider.keyUrl} target="_blank" rel="noreferrer">{new URL(provider.keyUrl).host}</a></p>
                )}
              </div>
            ))}
          </div>
          </details>

          {message && <p className="ai-hint" role="status">{message}</p>}

          <p className="ai-note">
            ส่วนนี้ใช้กับ<strong>การเขียนสคริปต์</strong>เท่านั้น การพากย์เสียงยังต้องใช้ Gemini API key เสมอ
            เพราะเครื่องมือแบบ CLI ทั้งสามตัวคืนได้แค่ข้อความ ไม่มี subscription ไหนครอบคลุม TTS
          </p>
        </>
      )}

      <style>{`
        .ai-choice-list { display: grid; gap: 9px; margin-bottom: 18px; }
        .ai-choice {
          display: grid; gap: 4px; padding: 12px 14px; text-align: left; cursor: pointer;
          border: 1px solid var(--line, #2a312a); border-radius: 10px; background: transparent; color: inherit; font: inherit;
        }
        .ai-choice.is-selected { border-color: var(--yellow); background: rgba(255, 210, 63, .07); }
        .ai-choice.is-off { opacity: .55; cursor: not-allowed; }
        .ai-choice:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
        .ai-choice-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 14px; }
        .ai-choice-title b { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: var(--yellow); color: #10161a; }
        .ai-choice-sub { display: flex; align-items: center; gap: 5px; font-size: 12.5px; opacity: .72; }
        .ai-advanced { margin-top: 18px; border-top: 1px solid var(--line, #2a312a); padding-top: 14px; }
        .ai-advanced > summary { cursor: pointer; font-size: 13px; font-weight: 600; opacity: .78; list-style: none; display: flex; align-items: center; gap: 7px; }
        .ai-advanced > summary::before { content: "▸"; font-size: 11px; transition: transform .15s; }
        .ai-advanced[open] > summary::before { transform: rotate(90deg); }
        .ai-advanced > summary:focus-visible { outline: 2px solid var(--yellow); outline-offset: 3px; border-radius: 4px; }
        .ai-advanced .ai-key-list { margin-top: 14px; }
        .ai-subhead { margin: 20px 0 10px; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; }
        .ai-key-list { display: grid; gap: 14px; }
        .ai-key-row { padding: 13px 14px; border: 1px solid var(--line, #2a312a); border-radius: 10px; display: grid; gap: 9px; }
        .ai-key-row.is-selected { border-color: var(--yellow); }
        .ai-key-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
        .ai-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; opacity: .7; }
        .ai-badge.ok { color: #4fbf8b; opacity: 1; }
        .ai-key-inputs { display: flex; gap: 8px; align-items: center; }
        .ai-key-inputs .settings-input-wrap { flex: 1; min-width: 0; }
        .ai-hint { margin: 0; font-size: 12.5px; opacity: .7; }
        .ai-note { margin: 16px 0 0; padding: 10px 13px; border-radius: 9px; font-size: 12.5px; line-height: 1.6; background: rgba(255, 210, 63, .06); border: 1px solid rgba(255, 210, 63, .2); }
      `}</style>
    </section>
  );
}
