"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  FolderInput,
  FolderOpen,
  FolderOutput,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import {
  detectLocalEngine,
  localApi,
  type LocalEngineState,
  type SetupStatus,
} from "../lib/local-api";

type KeyStatus = "idle" | "testing" | "success" | "error";
const VOICE_TEST_CAPTIONS = `data:text/vtt;charset=utf-8,${encodeURIComponent("WEBVTT\n\n00:00.000 --> 00:10.000\nสวัสดีค่ะ ClipPang พร้อมช่วยทำคลิปให้ปังขึ้น")}`;

type DetailedSetupStatus = Omit<SetupStatus, "node" | "ffmpeg"> & {
  node?: boolean | { ready?: boolean; version?: string };
  ffmpeg?: boolean | { ready?: boolean; version?: string; libass?: boolean; reason?: string };
};

function statusReady(value: boolean | { ready?: boolean } | undefined) {
  return typeof value === "boolean" ? value : Boolean(value?.ready);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function SettingsPage() {
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [setupStatus, setSetupStatus] = useState<DetailedSetupStatus | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [savedLast4, setSavedLast4] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voicePreviewError, setVoicePreviewError] = useState("");
  const [inputFolder, setInputFolder] = useState("");
  const [projectFolder, setProjectFolder] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const [cacheError, setCacheError] = useState("");

  const loadLocalSettings = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setEngineState("checking");

    const engine = await detectLocalEngine();
    if (!engine) {
      setEngineState("unavailable");
      setLoading(false);
      setSetupStatus(null);
      setInputFolder("");
      setProjectFolder("");
      return;
    }

    setEngineState("connected");
    try {
      const [settingsResponse, statusResponse] = await Promise.all([
        localApi.settings(),
        localApi.setupStatus(),
      ]);
      const settings = settingsResponse.settings;
      const status = statusResponse as DetailedSetupStatus;
      const key = status.key ?? status.gemini ?? (
        typeof settings.key === "object" && settings.key
          ? settings.key as { configured?: boolean; last4?: string }
          : undefined
      );

      setSetupStatus(status);
      setInputFolder(typeof settings.inputFolder === "string" ? settings.inputFolder : status.paths?.input ?? "");
      setProjectFolder(typeof settings.projectFolder === "string" ? settings.projectFolder : status.paths?.projects ?? "");
      setAppVersion(typeof settings.version === "string" ? settings.version : "");
      setSavedLast4(key?.configured ? key.last4 ?? "" : "");
    } catch (error) {
      setLoadError(errorMessage(error, "อ่านการตั้งค่าจาก ClipPang Local ไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLocalSettings(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLocalSettings]);

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, [voicePreviewUrl]);

  async function playVoicePreview() {
    if (engineState !== "connected") {
      setVoicePreviewError("กรุณาเปิด ClipPang Local ก่อนทดสอบเสียง");
      return false;
    }
    setPreviewingVoice(true);
    setVoicePreviewError("");
    try {
      const blob = await localApi.previewVoice("Kore", {
        text: "สวัสดีค่ะ ClipPang พร้อมช่วยทำคลิปให้ปังขึ้น",
        speed: 1,
        tone: "เป็นกันเอง",
      });
      setVoicePreviewUrl(URL.createObjectURL(blob));
      return true;
    } catch (error) {
      setVoicePreviewError(errorMessage(error, "สร้างเสียงทดสอบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง"));
      return false;
    } finally {
      setPreviewingVoice(false);
    }
  }

  async function testKey() {
    const cleanKey = geminiKey.trim();
    if (cleanKey.length < 16) {
      setKeyStatus("error");
      setKeyMessage("กรุณาวาง API key ตัวเต็มจาก Google AI Studio");
      return;
    }

    if (engineState !== "connected") {
      setKeyStatus("error");
      setKeyMessage("เว็บตัวอย่างบันทึกคีย์ไม่ได้ กรุณาเปิด ClipPang Local ก่อน");
      return;
    }

    setKeyStatus("testing");
    setKeyMessage("");
    try {
      const result = await localApi.saveKey(cleanKey);
      setSavedLast4(result.key.last4);
      setGeminiKey("");
      setShowKey(false);
      setKeyStatus("success");
      const previewReady = await playVoicePreview();
      setKeyMessage(previewReady
        ? "เชื่อมต่อสำเร็จ บันทึกคีย์แล้ว และสร้างเสียงทดสอบด้านล่าง"
        : "บันทึกคีย์แล้ว แต่เสียงทดสอบยังไม่สำเร็จ ดูรายละเอียดด้านล่าง");
    } catch (error) {
      setKeyStatus("error");
      setKeyMessage(errorMessage(error, "ทดสอบ API key ไม่สำเร็จ กรุณาตรวจคีย์และอินเทอร์เน็ต"));
    }
  }

  async function clearCache() {
    if (engineState !== "connected") return;
    setClearingCache(true);
    setCacheError("");
    try {
      const result = await localApi.clearCache();
      setClearedCount(Number(result.removed ?? 0));
      setCacheCleared(true);
      setConfirmClear(false);
    } catch (error) {
      setCacheError(errorMessage(error, "ล้างแคชไม่สำเร็จ กรุณาลองอีกครั้ง"));
    } finally {
      setClearingCache(false);
    }
  }

  const nodeInfo = typeof setupStatus?.node === "object" ? setupStatus.node : null;
  const ffmpegInfo = typeof setupStatus?.ffmpeg === "object" ? setupStatus.ffmpeg : null;
  const ffmpegReady = statusReady(setupStatus?.ffmpeg) && (
    typeof setupStatus?.ffmpeg === "boolean" || setupStatus?.ffmpeg?.libass !== false
  );

  return (
    <AppShell>
      <div className="settings-page">
        <header className="settings-heading">
          <div>
            <div className="settings-kicker"><Sparkles size={15} /> ตั้งค่า ClipPang</div>
            <h1>จัดการการเชื่อมต่อและไฟล์</h1>
            <p>การตั้งค่าทั้งหมดบันทึกไว้บนเครื่องนี้เท่านั้น เปลี่ยนได้ทุกเมื่อ</p>
          </div>
          <div className="settings-local-badge" data-connected={engineState === "connected"}>
            {engineState === "connected" ? <CheckCircle2 size={14} /> : <WifiOff size={14} />}
            {engineState === "connected" ? "Local เชื่อมต่อแล้ว" : engineState === "checking" ? "กำลังตรวจ Local" : "เว็บตัวอย่าง"}
          </div>
        </header>

        {engineState === "unavailable" && (
          <div className="settings-hosted-note" role="status">
            <WifiOff size={20} aria-hidden="true" />
            <div>
              <strong>หน้านี้กำลังแสดงในโหมดเว็บตัวอย่าง</strong>
              <span>เปิด ClipPang ด้วย “เริ่มโปรแกรม.bat” เพื่อบันทึกคีย์ ดูพาธจริง และล้างแคชบนคอมเครื่องนี้</span>
            </div>
            <button type="button" onClick={() => void loadLocalSettings()}><RefreshCw size={14} /> ตรวจอีกครั้ง</button>
          </div>
        )}

        {loadError && (
          <div className="settings-error-note" role="alert"><CircleHelp size={17} /> {loadError}</div>
        )}

        <div className="settings-layout">
          <div className="settings-main-column">
            <section className="settings-card" aria-labelledby="gemini-title">
              <div className="settings-section-head">
                <div className="settings-section-icon settings-icon-key"><KeyRound size={20} /></div>
                <div>
                  <h2 id="gemini-title">Gemini API key</h2>
                  <p>ใช้สำหรับสร้างเสียงพากย์และช่วยเขียนสคริปต์</p>
                </div>
                <span className="settings-required">จำเป็น</span>
              </div>

              <div className="settings-key-field">
                <label htmlFor="gemini-key">API key ของคุณ</label>
                <div className="settings-input-wrap">
                  <KeyRound size={17} aria-hidden="true" />
                  <input
                    id="gemini-key"
                    type={showKey ? "text" : "password"}
                    value={geminiKey}
                    onChange={(event) => {
                      setGeminiKey(event.target.value);
                      setKeyStatus("idle");
                      setKeyMessage("");
                    }}
                    placeholder={savedLast4 ? `ใส่คีย์ใหม่เพื่อเปลี่ยนคีย์ ••••${savedLast4}` : "วาง Gemini API key ตัวเต็ม"}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="gemini-key-hint"
                    disabled={engineState !== "connected" || loading || keyStatus === "testing"}
                  />
                  <button
                    type="button"
                    className="settings-eye-button"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? "ซ่อน API key" : "แสดง API key"}
                  >
                    {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <div className="settings-key-assist" id="gemini-key-hint">
                  <span className={keyStatus === "success" ? "settings-hint-success" : keyStatus === "error" ? "settings-hint-error" : ""}>
                    {keyStatus === "success" && <CheckCircle2 size={13} />}
                    {keyMessage || (savedLast4 ? `คีย์ที่บันทึกไว้ ••••${savedLast4}` : "ยังไม่ได้บันทึก API key")}
                  </span>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                    ขอ API key ฟรี <ChevronRight size={13} />
                  </a>
                </div>
                {(voicePreviewUrl || voicePreviewError || previewingVoice) && (
                  <div className="settings-voice-preview" aria-live="polite">
                    <div>
                      <span>เสียงทดสอบ · Kore</span>
                      <button type="button" onClick={() => void playVoicePreview()} disabled={previewingVoice || engineState !== "connected"}>
                        {previewingVoice ? <LoaderCircle className="settings-spin" size={13} /> : <Sparkles size={13} />}
                        {previewingVoice ? "กำลังสร้างเสียง…" : "ฟังอีกครั้ง"}
                      </button>
                    </div>
                    {voicePreviewUrl && (
                      <audio controls autoPlay src={voicePreviewUrl} aria-label="เสียงทดสอบ Gemini TTS">
                        <track kind="captions" src={VOICE_TEST_CAPTIONS} srcLang="th" label="คำพูดภาษาไทย" default />
                      </audio>
                    )}
                    {voicePreviewError && <p role="alert">บันทึกคีย์แล้ว แต่เสียงทดสอบไม่สำเร็จ: {voicePreviewError}</p>}
                  </div>
                )}
              </div>

              <div className="settings-key-actions">
                <button
                  type="button"
                  className="settings-button settings-button-primary"
                  onClick={testKey}
                  disabled={keyStatus === "testing" || !geminiKey.trim() || engineState !== "connected"}
                >
                  {keyStatus === "testing" ? <LoaderCircle className="settings-spin" size={16} /> : keyStatus === "success" ? <Check size={16} strokeWidth={3} /> : <RefreshCw size={15} />}
                  {keyStatus === "testing" ? "กำลังทดสอบ…" : keyStatus === "success" ? "บันทึกแล้ว" : "บันทึกและทดสอบคีย์"}
                </button>
                <div className="settings-security-note"><LockKeyhole size={14} /> หลังบันทึก หน้านี้จะเห็นเพียง 4 ตัวท้าย</div>
              </div>
            </section>

            <section className="settings-card" aria-labelledby="folder-title">
              <div className="settings-section-head">
                <div className="settings-section-icon settings-icon-folder"><FolderOpen size={20} /></div>
                <div>
                  <h2 id="folder-title">โฟลเดอร์ที่ใช้</h2>
                  <p>ตำแหน่งจริงที่ ClipPang Local ใช้รับคลิปและเก็บโปรเจกต์</p>
                </div>
              </div>

              <div className="settings-folder-list">
                <div className="settings-folder-row">
                  <div className="settings-folder-label">
                    <span className="settings-mini-icon"><FolderInput size={16} /></span>
                    <div><label htmlFor="input-folder">คลิปต้นฉบับ</label><small>วางคลิปใหม่ไว้ในโฟลเดอร์นี้</small></div>
                  </div>
                  <div className="settings-folder-control">
                    <input id="input-folder" value={inputFolder} placeholder={loading ? "กำลังอ่านจาก Local…" : "เชื่อมต่อ Local เพื่อดูพาธ"} readOnly aria-readonly="true" spellCheck={false} />
                    <span className="settings-readonly-badge"><LockKeyhole size={12} /> อ่านอย่างเดียว</span>
                  </div>
                </div>

                <div className="settings-folder-row">
                  <div className="settings-folder-label">
                    <span className="settings-mini-icon"><FolderOutput size={16} /></span>
                    <div><label htmlFor="project-folder">โปรเจกต์และไฟล์ผลลัพธ์</label><small>รวมไฟล์เสียง ซับ และวิดีโอที่เสร็จแล้ว</small></div>
                  </div>
                  <div className="settings-folder-control">
                    <input id="project-folder" value={projectFolder} placeholder={loading ? "กำลังอ่านจาก Local…" : "เชื่อมต่อ Local เพื่อดูพาธ"} readOnly aria-readonly="true" spellCheck={false} />
                    <span className="settings-readonly-badge"><LockKeyhole size={12} /> อ่านอย่างเดียว</span>
                  </div>
                </div>
              </div>

              <div className="settings-folder-actions">
                <span><CircleHelp size={13} /> ตำแหน่งนี้กำหนดโดย ClipPang Local เพื่อป้องกันการเปิดพาธนอกพื้นที่งาน</span>
              </div>
            </section>
          </div>

          <aside className="settings-side-column">
            <section className="settings-card settings-version-card" aria-labelledby="version-title">
              <div className="settings-section-head settings-section-head-compact">
                <div className="settings-section-icon settings-icon-version"><HardDrive size={19} /></div>
                <div>
                  <h2 id="version-title">ระบบ</h2>
                  <p>สถานะบนเครื่องนี้</p>
                </div>
              </div>
              <dl className="settings-status-list">
                <div><dt>ClipPang</dt><dd>{appVersion ? `v${appVersion}` : engineState === "connected" ? "Local" : "Web Demo"}</dd></div>
                <div><dt>FFmpeg</dt><dd><i className="settings-status-dot" data-ready={ffmpegReady} /> {loading ? "กำลังตรวจ" : ffmpegReady ? ffmpegInfo?.version ?? "พร้อมใช้" : "ยังไม่พร้อม"}</dd></div>
                <div><dt>Node.js</dt><dd>{nodeInfo?.version ? `v${nodeInfo.version}` : loading ? "กำลังตรวจ" : "—"}</dd></div>
              </dl>
              <button type="button" className="settings-text-button" onClick={() => void loadLocalSettings()} disabled={loading}>
                <RefreshCw className={loading ? "settings-spin" : ""} size={14} /> ตรวจสถานะอีกครั้ง
              </button>
            </section>

            <section className="settings-privacy-card" aria-labelledby="privacy-title">
              <div className="settings-privacy-icon"><ShieldCheck size={21} /></div>
              <h2 id="privacy-title">ข้อมูลอยู่กับคุณ</h2>
              <p>คลิป สคริปต์ และ API key เก็บอยู่บนคอมเครื่องนี้ ไม่มีระบบติดตาม และไม่มีข้อมูลส่งกลับมาหาเรา</p>
              <div className="settings-privacy-chips"><span>ไม่มี telemetry</span><span>ไม่อัปโหลดคลิป</span></div>
            </section>

            <section className="settings-card settings-cache-card" aria-labelledby="cache-title">
              <div className="settings-cache-head">
                <div>
                  <h2 id="cache-title">แคชเสียงพากย์</h2>
                  <p>{cacheCleared ? `ล้างแล้ว${clearedCount ? ` ${clearedCount} รายการ` : ""} พร้อมเริ่มสะสมใหม่` : "ช่วยให้ประโยคเดิมใช้ซ้ำได้ทันที"}</p>
                </div>
                <strong>{cacheCleared ? "ล้างแล้ว" : engineState === "connected" ? "LOCAL" : "OFFLINE"}</strong>
              </div>
              {!confirmClear ? (
                <button type="button" className="settings-danger-button" onClick={() => setConfirmClear(true)} disabled={cacheCleared || clearingCache || engineState !== "connected"}>
                  <Trash2 size={14} /> {cacheCleared ? "ล้างแคชแล้ว" : engineState !== "connected" ? "เปิด Local เพื่อล้างแคช" : "ล้างแคช"}
                </button>
              ) : (
                <div className="settings-confirm-clear">
                  <span>ล้างไฟล์เสียงที่จำไว้ทั้งหมด?</span>
                  <div>
                    <button type="button" onClick={() => void clearCache()} disabled={clearingCache}>{clearingCache ? <LoaderCircle className="settings-spin" size={13} /> : <Check size={13} />} {clearingCache ? "กำลังล้าง" : "ล้างเลย"}</button>
                    <button type="button" onClick={() => setConfirmClear(false)} aria-label="ยกเลิก" disabled={clearingCache}><X size={14} /></button>
                  </div>
                </div>
              )}
              {cacheError && <p className="settings-cache-error" role="alert">{cacheError}</p>}
            </section>
          </aside>
        </div>
      </div>

      <style>{`
        .settings-page {
          --settings-ink: #20251f;
          --settings-muted: #6e756d;
          --settings-line: #dedfd8;
          --settings-card: #fff;
          --settings-soft: #f4f5f0;
          --settings-accent: #ffd23f;
          --settings-accent-ink: #342900;
          width: 100%;
          max-width: 1180px;
          margin: 0 auto;
          padding: 38px 40px 58px;
          color: var(--settings-ink);
          font-family: "Kanit", "Leelawadee UI", system-ui, sans-serif;
        }

        .settings-heading {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 28px;
        }

        .settings-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 9px;
          color: #806300;
          font-size: 13px;
          font-weight: 650;
        }

        .settings-heading h1 {
          margin: 0;
          font-size: clamp(30px, 4vw, 44px);
          line-height: 1.08;
          letter-spacing: -.035em;
          font-weight: 720;
        }

        .settings-heading p {
          margin: 10px 0 0;
          color: var(--settings-muted);
          font-size: 14px;
        }

        .settings-local-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          flex: 0 0 auto;
          padding: 8px 12px;
          border: 1px solid #eadca6;
          border-radius: 999px;
          color: #755b00;
          background: #fff8dd;
          font-size: 11px;
          font-weight: 600;
        }

        .settings-local-badge[data-connected="true"] {
          border-color: #cfe4d5;
          color: #2c6c4b;
          background: #edf8f0;
        }

        .settings-hosted-note,
        .settings-error-note {
          display: flex;
          align-items: center;
          gap: 11px;
          margin: -10px 0 20px;
          padding: 12px 14px;
          border: 1px solid #eadca6;
          border-radius: 12px;
          color: #765f18;
          background: #fff9e7;
          font-size: 10.5px;
        }

        .settings-hosted-note > div {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 2px;
        }

        .settings-hosted-note strong { color: #413913; font-size: 11.5px; }
        .settings-hosted-note button {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 9px;
          border: 1px solid #ddcb88;
          border-radius: 8px;
          color: #66530d;
          background: #fff;
          font: inherit;
          font-size: 9px;
          font-weight: 600;
          cursor: pointer;
        }

        .settings-error-note {
          border-color: #efc9c3;
          color: #874c44;
          background: #fff2ef;
        }

        .settings-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.7fr) minmax(270px, .82fr);
          gap: 17px;
          align-items: start;
        }

        .settings-main-column,
        .settings-side-column {
          display: grid;
          gap: 17px;
        }

        .settings-card {
          padding: 22px;
          border: 1px solid var(--settings-line);
          border-radius: 19px;
          background: var(--settings-card);
          box-shadow: 0 9px 34px rgba(41,47,38,.045);
        }

        .settings-section-head {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          margin-bottom: 21px;
        }

        .settings-section-icon {
          display: grid;
          place-items: center;
          width: 41px;
          height: 41px;
          border-radius: 13px;
        }

        .settings-icon-key { color: #695500; background: #fff3bf; }
        .settings-icon-folder { color: #31555c; background: #e5f2f3; }
        .settings-icon-version { color: #4c5148; background: #eff0eb; }

        .settings-section-head h2,
        .settings-cache-head h2 {
          margin: 0;
          font-size: 16px;
          line-height: 1.25;
          letter-spacing: -.01em;
          font-weight: 680;
        }

        .settings-section-head p,
        .settings-cache-head p {
          margin: 3px 0 0;
          color: var(--settings-muted);
          font-size: 11px;
          line-height: 1.45;
        }

        .settings-required {
          padding: 4px 8px;
          border-radius: 999px;
          color: #7a6400;
          background: #fff6cf;
          font-size: 9px;
          font-weight: 650;
        }

        .settings-key-field > label {
          display: block;
          margin-bottom: 7px;
          color: #4f564e;
          font-size: 11px;
          font-weight: 600;
        }

        .settings-input-wrap {
          display: flex;
          align-items: center;
          height: 47px;
          padding: 0 12px;
          border: 1px solid #d6d9d1;
          border-radius: 12px;
          color: #91978e;
          background: #fafbf8;
          transition: border-color .18s, box-shadow .18s;
        }

        .settings-input-wrap:focus-within {
          border-color: #9cae45;
          box-shadow: 0 0 0 3px rgba(185,211,65,.16);
        }

        .settings-input-wrap input {
          min-width: 0;
          flex: 1;
          height: 100%;
          padding: 0 10px;
          border: 0;
          outline: 0;
          color: var(--settings-ink);
          background: transparent;
          font-family: ui-monospace, "Cascadia Code", monospace;
          font-size: 12px;
          letter-spacing: .035em;
        }

        .settings-eye-button {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: #777e75;
          background: transparent;
          cursor: pointer;
        }
        .settings-eye-button:hover { background: #eef0e9; }

        .settings-key-assist {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          margin-top: 7px;
          color: #8a9087;
          font-size: 10px;
        }

        .settings-key-assist span,
        .settings-key-assist a {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .settings-key-assist a {
          color: #5f6900;
          text-decoration: none;
          font-weight: 600;
        }
        .settings-key-assist a:hover { text-decoration: underline; }
        .settings-key-assist .settings-hint-success { color: #26724e; }
        .settings-key-assist .settings-hint-error { color: #a34c43; }

        .settings-voice-preview {
          display: grid;
          gap: 7px;
          margin-top: 11px;
          padding: 10px;
          border: 1px solid #e1e4dc;
          border-radius: 10px;
          background: #fafbf8;
        }
        .settings-voice-preview > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #70766e; font-size: 9px; }
        .settings-voice-preview button { display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border: 1px solid #d9dcd4; border-radius: 7px; color: #50584f; background: #fff; font: inherit; font-size: 8.5px; cursor: pointer; }
        .settings-voice-preview button:disabled { cursor: wait; opacity: .7; }
        .settings-voice-preview audio { width: 100%; height: 31px; }
        .settings-voice-preview p { margin: 0; color: #a34c43; font-size: 8.5px; line-height: 1.5; }

        .settings-key-actions,
        .settings-folder-actions {
          display: flex;
          align-items: center;
          gap: 13px;
          margin-top: 19px;
          padding-top: 17px;
          border-top: 1px solid #eceee8;
        }

        .settings-button {
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 0 15px;
          border: 1px solid transparent;
          border-radius: 10px;
          font: inherit;
          font-size: 11px;
          font-weight: 650;
          cursor: pointer;
          transition: transform .15s, background .15s;
        }
        .settings-button:active { transform: translateY(1px); }
        .settings-button:disabled { cursor: wait; opacity: .75; }
        .settings-button-primary { color: var(--settings-accent-ink); background: var(--settings-accent); }
        .settings-button-primary:hover { background: #f4c532; }
        .settings-button-dark { color: #fff; background: #252b24; }
        .settings-button-dark:hover { background: #121612; }

        .settings-spin { animation: settings-spin .8s linear infinite; }
        @keyframes settings-spin { to { transform: rotate(360deg); } }

        .settings-security-note {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #858b82;
          font-size: 9.5px;
        }

        .settings-folder-list { display: grid; gap: 10px; }

        .settings-folder-row {
          display: grid;
          grid-template-columns: minmax(150px, .8fr) minmax(220px, 1.2fr);
          align-items: center;
          gap: 14px;
          padding: 12px;
          border: 1px solid #e6e8e1;
          border-radius: 13px;
          background: #fbfcf9;
        }

        .settings-folder-label {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
        }

        .settings-mini-icon {
          display: grid;
          place-items: center;
          width: 31px;
          height: 31px;
          flex: 0 0 31px;
          border-radius: 9px;
          color: #55625b;
          background: #edf0ec;
        }

        .settings-folder-label label { display: block; color: #3d443c; font-size: 10.5px; font-weight: 650; }
        .settings-folder-label small { display: block; overflow: hidden; margin-top: 2px; color: #92978f; font-size: 8.5px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }

        .settings-folder-control {
          display: flex;
          height: 36px;
          overflow: hidden;
          border: 1px solid #dcded7;
          border-radius: 9px;
          background: #fff;
        }

        .settings-folder-control:focus-within { border-color: #a4b455; box-shadow: 0 0 0 2px rgba(185,211,65,.12); }
        .settings-folder-control input {
          min-width: 0;
          flex: 1;
          padding: 0 10px;
          border: 0;
          outline: 0;
          color: #5d635c;
          background: transparent;
          font-family: ui-monospace, "Cascadia Code", monospace;
          font-size: 9.5px;
        }
        .settings-folder-control input[readonly] { cursor: default; }
        .settings-readonly-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex: 0 0 auto;
          padding: 0 9px;
          border-left: 1px solid #e1e3dd;
          color: #737a72;
          background: #f3f4f0;
          font-size: 8.5px;
          white-space: nowrap;
        }
        .settings-folder-control button {
          padding: 0 11px;
          border: 0;
          border-left: 1px solid #e1e3dd;
          color: #515850;
          background: #f3f4f0;
          font: inherit;
          font-size: 9.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .settings-folder-control button:hover { background: #e9ece5; }

        .settings-folder-actions span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #8a9087;
          font-size: 9.5px;
        }

        .settings-section-head-compact { grid-template-columns: auto 1fr; margin-bottom: 16px; }

        .settings-status-list { margin: 0; }
        .settings-status-list > div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid #eceee8;
          font-size: 10.5px;
        }
        .settings-status-list dt { color: var(--settings-muted); }
        .settings-status-list dd { display: flex; align-items: center; gap: 5px; margin: 0; color: #343a33; font-weight: 600; }
        .settings-status-list dd span { padding: 2px 5px; border-radius: 999px; color: #347051; background: #e5f4e9; font-size: 7.5px; }
        .settings-status-list dd i { width: 6px; height: 6px; border-radius: 50%; background: #49a16f; box-shadow: 0 0 0 3px #e5f4e9; }
        .settings-status-list dd i[data-ready="false"] { background: #c9786d; box-shadow: 0 0 0 3px #fae7e4; }

        .settings-text-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 14px;
          padding: 0;
          border: 0;
          color: #5d650d;
          background: transparent;
          font: inherit;
          font-size: 9.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .settings-text-button:disabled { color: #91978f; cursor: wait; }

        .settings-privacy-card {
          position: relative;
          overflow: hidden;
          padding: 21px;
          border: 1px solid #eadca6;
          border-radius: 19px;
          background: linear-gradient(145deg, #fff9e4 0%, #fff4cc 100%);
        }
        .settings-privacy-card::after {
          content: "";
          position: absolute;
          width: 130px;
          height: 130px;
          top: -66px;
          right: -55px;
          border-radius: 50%;
          background: rgba(255,210,63,.35);
        }
        .settings-privacy-icon {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          margin-bottom: 13px;
          border-radius: 12px;
          color: #6d5500;
          background: var(--settings-accent);
        }
        .settings-privacy-card h2 { margin: 0 0 6px; font-size: 15px; }
        .settings-privacy-card p { margin: 0; color: #746a4f; font-size: 10.5px; line-height: 1.65; }
        .settings-privacy-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
        .settings-privacy-chips span { padding: 4px 7px; border: 1px solid #e7d69b; border-radius: 999px; color: #746a4f; background: rgba(255,255,255,.6); font-size: 8px; }

        .settings-cache-card { padding: 19px; }
        .settings-cache-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .settings-cache-head strong { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; white-space: nowrap; }
        .settings-cache-track { height: 4px; overflow: hidden; margin: 13px 0; border-radius: 999px; background: #eceee8; }
        .settings-cache-track span { display: block; height: 100%; border-radius: inherit; background: #9baa4e; transition: width .3s ease; }
        .settings-danger-button {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0;
          border: 0;
          color: #a34c43;
          background: transparent;
          font: inherit;
          font-size: 9.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .settings-danger-button:disabled { color: #91978f; cursor: default; }

        .settings-confirm-clear {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 9px;
          border-radius: 9px;
          color: #7e453e;
          background: #fff0ed;
          font-size: 8.5px;
        }
        .settings-confirm-clear > div { display: flex; gap: 4px; }
        .settings-confirm-clear button { display: inline-flex; align-items: center; gap: 3px; height: 25px; padding: 0 7px; border: 0; border-radius: 7px; color: #fff; background: #a65349; font: inherit; font-size: 8px; font-weight: 600; cursor: pointer; }
        .settings-confirm-clear button:last-child { padding: 0 6px; color: #7e453e; background: #ffe1dc; }
        .settings-confirm-clear button:disabled { cursor: wait; opacity: .7; }
        .settings-cache-error { margin: 9px 0 0; color: #a34c43; font-size: 8.5px; }

        .settings-page button:focus-visible,
        .settings-page a:focus-visible,
        .settings-page input:focus-visible {
          outline: 3px solid rgba(136,156,38,.26);
          outline-offset: 2px;
        }

        @media (max-width: 900px) {
          .settings-layout { grid-template-columns: 1fr; }
          .settings-side-column { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }
          .settings-side-column > section { height: 100%; }
        }

        @media (max-width: 720px) {
          .settings-page { padding: 26px 18px 42px; }
          .settings-heading { align-items: flex-start; flex-direction: column; gap: 13px; }
          .settings-local-badge { display: none; }
          .settings-hosted-note { align-items: flex-start; flex-wrap: wrap; }
          .settings-hosted-note button { margin-left: 31px; }
          .settings-card { padding: 18px; }
          .settings-folder-row { grid-template-columns: 1fr; gap: 10px; }
          .settings-key-assist, .settings-key-actions, .settings-folder-actions { align-items: flex-start; flex-direction: column; }
          .settings-key-assist a { align-self: flex-start; }
          .settings-side-column { grid-template-columns: 1fr; }
        }

        @media (prefers-reduced-motion: reduce) {
          .settings-spin { animation: none; }
          .settings-cache-track span { transition: none; }
        }
      `}</style>
    </AppShell>
  );
}
