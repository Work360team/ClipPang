"use client";

import {
  ArrowRight,
  CircleAlert,
  Check,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderLock,
  HardDrive,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Type,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  detectLocalEngine,
  localApi,
  type LocalEngineState,
  type SetupStatus,
} from "../lib/local-api";
import styles from "./setup.module.css";

type Step = 1 | 2 | 3;
const VOICE_TEST_CAPTIONS = `data:text/vtt;charset=utf-8,${encodeURIComponent("WEBVTT\n\n00:00.000 --> 00:10.000\nสวัสดีค่ะ Clip360 พร้อมช่วยทำคลิปให้ปังขึ้น")}`;

const steps = [
  {
    id: 1 as Step,
    title: "ตรวจความพร้อม",
    description: "เช็กระบบและพื้นที่จัดเก็บ",
    icon: Cpu,
  },
  {
    id: 2 as Step,
    title: "ติดตั้ง FFmpeg",
    description: "เครื่องมือประมวลผลวิดีโอ",
    icon: Download,
  },
  {
    id: 3 as Step,
    title: "เชื่อมต่อ Gemini",
    description: "สำหรับเสียงพากย์และสคริปต์",
    icon: KeyRound,
  },
];

function progressMessage(progress: number) {
  if (progress < 22) return "กำลังเตรียมไฟล์สำหรับเครื่องนี้…";
  if (progress < 68) return "กำลังดาวน์โหลด FFmpeg…";
  if (progress < 92) return "กำลังแตกไฟล์ไว้ใน data/bin…";
  return "กำลังตรวจสอบการรองรับซับภาษาไทย…";
}

type DetailedSetupStatus = Omit<SetupStatus, "node" | "ffmpeg"> & {
  node?: boolean | { ready?: boolean; version?: string; required?: string };
  kanit?: boolean | { ready?: boolean; directory?: string; files?: string[]; reason?: string };
  ffmpeg?: boolean | {
    ready?: boolean;
    found?: boolean;
    path?: string;
    libass?: boolean;
    version?: string;
    reason?: string;
    error?: string;
  };
};

function isReady(value: boolean | { ready?: boolean } | undefined) {
  return typeof value === "boolean" ? value : Boolean(value?.ready);
}

function isFfmpegReady(value: DetailedSetupStatus["ffmpeg"]) {
  if (typeof value === "boolean") return value;
  return Boolean(value?.ready) && value?.libass !== false;
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function SetupPage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [setupStatus, setSetupStatus] = useState<DetailedSetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [systemReady, setSystemReady] = useState(false);
  const [systemError, setSystemError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [installError, setInstallError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyValid, setKeyValid] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [savedKeyEnding, setSavedKeyEnding] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voicePreviewError, setVoicePreviewError] = useState("");

  const applySetupStatus = useCallback((result: DetailedSetupStatus, chooseStep = false) => {
    const nodeReady = isReady(result.node);
    const kanitReady = isReady(result.kanit);
    const directoriesReady = Boolean(result.paths?.input && result.paths?.projects);
    const nextSystemReady = nodeReady && kanitReady && directoriesReady;
    const nextFfmpegReady = isFfmpegReady(result.ffmpeg);
    const key = result.key ?? result.gemini;

    setSetupStatus(result);
    setSystemReady(nextSystemReady);
    setFfmpegReady(nextFfmpegReady);
    setInstalling(Boolean(result.installing));
    setInstallProgress(nextFfmpegReady ? 100 : Math.max(0, Math.min(100, Number(result.installProgress ?? 0))));
    setKeyValid(Boolean(key?.configured));
    setSavedKeyEnding(key?.last4 ?? "");

    if (chooseStep) {
      setCurrentStep(!nextSystemReady ? 1 : !nextFfmpegReady ? 2 : 3);
    }
  }, []);

  const runSystemCheck = useCallback(async (chooseStep = false) => {
    setChecking(true);
    setSystemError("");
    setEngineState("checking");

    const engine = await detectLocalEngine();
    if (!engine) {
      setEngineState("unavailable");
      setChecking(false);
      setSystemReady(false);
      setSetupStatus(null);
      return;
    }

    setEngineState("connected");
    try {
      const result = await localApi.setupStatus() as DetailedSetupStatus;
      applySetupStatus(result, chooseStep);
    } catch (error) {
      setSystemReady(false);
      setSystemError(messageFrom(error, "อ่านสถานะ Clip360 Local ไม่สำเร็จ กรุณาลองอีกครั้ง"));
    } finally {
      setChecking(false);
    }
  }, [applySetupStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runSystemCheck(true), 0);
    return () => window.clearTimeout(timer);
  }, [runSystemCheck]);

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, [voicePreviewUrl]);

  useEffect(() => {
    if (!installing || engineState !== "connected") return;
    let active = true;

    const poll = async () => {
      try {
        const result = await localApi.setupStatus() as DetailedSetupStatus;
        if (!active) return;
        applySetupStatus(result);
        const ready = isFfmpegReady(result.ffmpeg);
        if (ready) {
          setInstallError("");
          setInstalling(false);
          setInstallProgress(100);
        } else if (!result.installing) {
          setInstalling(false);
          setInstallError("ติดตั้ง FFmpeg ไม่สำเร็จ กดลองใหม่ หรือวาง FFmpeg ที่รองรับ libass ไว้ใน data/bin");
        }
      } catch (error) {
        if (!active) return;
        setInstalling(false);
        setInstallError(messageFrom(error, "อ่านความคืบหน้าการติดตั้งไม่สำเร็จ กรุณาลองอีกครั้ง"));
      }
    };

    const timer = window.setInterval(() => void poll(), 900);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applySetupStatus, engineState, installing]);

  const startInstall = async () => {
    if (engineState !== "connected") {
      setInstallError("หน้านี้เป็นเว็บตัวอย่าง กรุณาเปิด Clip360 Local บนคอมก่อนติดตั้ง");
      return;
    }
    setInstallProgress(0);
    setFfmpegReady(false);
    setInstallError("");
    setInstalling(true);
    try {
      const result = await localApi.installFfmpeg();
      setInstallProgress(Math.max(0, Math.min(100, Number(result.progress ?? 0))));
    } catch (error) {
      setInstalling(false);
      setInstallError(messageFrom(error, "สั่งติดตั้ง FFmpeg ไม่สำเร็จ กรุณาลองอีกครั้ง"));
    }
  };

  const playVoicePreview = async () => {
    if (engineState !== "connected") {
      setVoicePreviewError("กรุณาเปิด Clip360 Local ก่อนทดสอบเสียง");
      return false;
    }
    setPreviewingVoice(true);
    setVoicePreviewError("");
    try {
      const blob = await localApi.previewVoice("Kore", {
        text: "สวัสดีค่ะ Clip360 พร้อมช่วยทำคลิปให้ปังขึ้น",
        speed: 1,
        tone: "เป็นกันเอง",
      });
      setVoicePreviewUrl(URL.createObjectURL(blob));
      return true;
    } catch (error) {
      setVoicePreviewError(messageFrom(error, "สร้างเสียงทดสอบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง"));
      return false;
    } finally {
      setPreviewingVoice(false);
    }
  };

  const testApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanKey = apiKey.trim();

    if (cleanKey.length < 16) {
      setKeyError("คีย์นี้ดูสั้นเกินไป ลองคัดลอกจาก Google AI Studio อีกครั้ง");
      setKeyValid(false);
      return;
    }

    if (engineState !== "connected") {
      setKeyError("หน้านี้เป็นเว็บตัวอย่าง กรุณาเปิด Clip360 Local ก่อนบันทึก API key");
      return;
    }

    setKeyError("");
    setTestingKey(true);
    setKeyValid(false);

    try {
      const result = await localApi.saveKey(cleanKey);
      setSavedKeyEnding(result.key.last4);
      setKeyValid(Boolean(result.key.configured));
      setApiKey("");
      setShowKey(false);
      await playVoicePreview();
    } catch (error) {
      setKeyValid(false);
      setKeyError(messageFrom(error, "ทดสอบ API key ไม่สำเร็จ กรุณาตรวจคีย์และอินเทอร์เน็ต"));
    } finally {
      setTestingKey(false);
    }
  };

  const updateApiKey = (value: string) => {
    setApiKey(value);
    setKeyError("");
    setKeyValid(false);
  };

  const goHome = () => {
    // Vinext beta can fail its RSC client transition after the long-running
    // setup flow. A full browser navigation is deterministic and also clears
    // setup-only listeners/audio before the dashboard mounts.
    window.location.assign("/");
  };

  const nodeInfo = typeof setupStatus?.node === "object" ? setupStatus.node : null;
  const kanitInfo = typeof setupStatus?.kanit === "object" ? setupStatus.kanit : null;
  const ffmpegInfo = typeof setupStatus?.ffmpeg === "object" ? setupStatus.ffmpeg : null;
  const nodeReady = isReady(setupStatus?.node);
  const kanitReady = isReady(setupStatus?.kanit);
  const directoriesReady = Boolean(setupStatus?.paths?.input && setupStatus?.paths?.projects);

  const completedSteps = new Set<Step>([
    ...(systemReady ? ([1] as Step[]) : []),
    ...(ffmpegReady ? ([2] as Step[]) : []),
    ...(keyValid ? ([3] as Step[]) : []),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <button type="button" className={styles.brand} onClick={goHome} aria-label="Clip360 หน้าแรก">
          <span className={styles.brandMark} aria-hidden="true">
            <Clapperboard size={20} strokeWidth={2.4} />
          </span>
          <span>Clip360</span>
          <span className={styles.localBadge}>{engineState === "connected" ? "LOCAL" : "WEB DEMO"}</span>
        </button>
        <div className={styles.privacyNote}>
          {engineState === "connected" ? <ShieldCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
          {engineState === "connected" ? "เชื่อมต่อ Clip360 Local แล้ว" : engineState === "checking" ? "กำลังค้นหา Clip360 Local…" : "นี่คือเว็บตัวอย่าง"}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="setup-title">
          <span className={styles.eyebrow}>ตั้งค่าครั้งแรก · ใช้เวลาประมาณ 3 นาที</span>
          <h1 id="setup-title">เตรียม Clip360 ให้พร้อมใช้งาน</h1>
          <p>
            เราจะเช็กสิ่งที่จำเป็น ติดตั้งเครื่องมือทำวิดีโอ และเชื่อมต่อ Gemini
            ให้เรียบร้อยก่อนเริ่มทำคลิปแรก
          </p>
        </section>

        {engineState === "unavailable" && (
          <section className={styles.engineNotice} role="status" aria-label="สถานะเว็บตัวอย่าง">
            <CircleAlert size={22} aria-hidden="true" />
            <div>
              <strong>ตอนนี้คุณกำลังดูเว็บตัวอย่าง</strong>
              <p>
                การติดตั้ง FFmpeg การบันทึก API key และการเรนเดอร์จะทำงานเมื่อเปิดหน้านี้ผ่าน
                Clip360 Local บนคอมเท่านั้น เปิดไฟล์ “เริ่มโปรแกรม.bat” แล้วกดตรวจอีกครั้ง
              </p>
            </div>
            <button type="button" onClick={() => void runSystemCheck(true)}>
              <RefreshCw size={15} aria-hidden="true" /> ตรวจการเชื่อมต่อ
            </button>
          </section>
        )}

        <section className={styles.wizard} aria-label="ขั้นตอนตั้งค่า Clip360">
          <aside className={styles.stepRail}>
            <div className={styles.railHeading}>
              <span>ความคืบหน้า</span>
              <strong>{keyValid ? "พร้อมแล้ว" : `${currentStep} / 3`}</strong>
            </div>
            <ol className={styles.stepList}>
              {steps.map((step) => {
                const Icon = step.icon;
                const isComplete = completedSteps.has(step.id);
                const isActive = currentStep === step.id;
                const isLocked =
                  engineState !== "connected" ||
                  (step.id === 2 && !systemReady) ||
                  (step.id === 3 && !ffmpegReady);

                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      className={styles.stepButton}
                      data-active={isActive}
                      data-complete={isComplete}
                      disabled={isLocked}
                      onClick={() => setCurrentStep(step.id)}
                      aria-current={isActive ? "step" : undefined}
                    >
                      <span className={styles.stepNumber}>
                        {isComplete ? (
                          <Check size={17} strokeWidth={3} aria-hidden="true" />
                        ) : (
                          step.id
                        )}
                      </span>
                      <span className={styles.stepCopy}>
                        <strong>{step.title}</strong>
                        <small>{step.description}</small>
                      </span>
                      <Icon className={styles.stepIcon} size={18} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className={styles.localCallout}>
              <FolderLock size={19} aria-hidden="true" />
              <div>
                <strong>{engineState === "connected" ? "ทำงานแบบ Local" : "โหมดเว็บตัวอย่าง"}</strong>
                <span>{engineState === "connected" ? "วิดีโอและ API key อยู่บนคอมเครื่องนี้" : "ยังติดตั้งหรือเรนเดอร์จริงจากหน้านี้ไม่ได้"}</span>
              </div>
            </div>
          </aside>

          <div className={styles.panel}>
            {currentStep === 1 && (
              <div className={styles.panelInner}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Cpu size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.stepKicker}>ขั้นที่ 1</span>
                    <h2>ตรวจความพร้อมของระบบ</h2>
                    <p>Clip360 กำลังเช็กของที่ต้องใช้บนเครื่องนี้</p>
                  </div>
                </div>

                <div className={styles.statusList} aria-live="polite" aria-busy={checking}>
                  <div className={styles.statusRow}>
                    <span className={styles.statusIcon}>
                      <Cpu size={19} aria-hidden="true" />
                    </span>
                    <span className={styles.statusCopy}>
                      <strong>Node.js</strong>
                      <small>{checking ? "กำลังตรวจเวอร์ชัน…" : nodeInfo?.version ? `เวอร์ชัน ${nodeInfo.version}` : "ยังอ่านเวอร์ชันไม่ได้"}</small>
                    </span>
                    <StatusResult checking={checking} ready={nodeReady} label="พร้อมใช้" failedLabel={engineState === "unavailable" ? "ยังไม่เชื่อมต่อ" : "ต้องอัปเดต"} />
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusIcon}>
                      <HardDrive size={19} aria-hidden="true" />
                    </span>
                    <span className={styles.statusCopy}>
                      <strong>โฟลเดอร์จัดเก็บ</strong>
                      <small>{checking ? "กำลังตรวจโฟลเดอร์…" : setupStatus?.paths?.input ?? "ยังอ่านตำแหน่งไม่ได้"}</small>
                    </span>
                    <StatusResult checking={checking} ready={directoriesReady} label="พร้อมใช้" failedLabel="ยังไม่พร้อม" />
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusIcon}>
                      <Type size={19} aria-hidden="true" />
                    </span>
                    <span className={styles.statusCopy}>
                      <strong>ฟอนต์ภาษาไทย</strong>
                      <small>{checking ? "กำลังค้นหา Kanit…" : kanitReady ? `${kanitInfo?.files?.length ?? 1} ไฟล์พร้อมใช้งาน` : kanitInfo?.reason ?? "ยังไม่พบ Kanit"}</small>
                    </span>
                    <StatusResult checking={checking} ready={kanitReady} label="พร้อมใช้" failedLabel="ยังไม่พร้อม" />
                  </div>
                </div>

                {systemError && (
                  <div className={styles.errorMessage} role="alert">
                    <CircleAlert size={18} aria-hidden="true" />
                    <span><strong>ตรวจระบบไม่สำเร็จ</strong>{systemError}</span>
                  </div>
                )}

                {systemReady && (
                  <div className={styles.goodMessage} role="status">
                    <CheckCircle2 size={19} aria-hidden="true" />
                    <span>
                      <strong>เครื่องนี้พร้อมสำหรับ Clip360</strong>
                      ไปติดตั้งเครื่องมือประมวลผลวิดีโอกันต่อได้เลย
                    </span>
                  </div>
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void runSystemCheck()}
                    disabled={checking}
                  >
                    <RefreshCw
                      size={17}
                      className={checking ? styles.spin : undefined}
                      aria-hidden="true"
                    />
                    ตรวจอีกครั้ง
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => setCurrentStep(2)}
                    disabled={!systemReady || engineState !== "connected"}
                  >
                    ไปขั้นต่อไป
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className={styles.panelInner}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Download size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.stepKicker}>ขั้นที่ 2</span>
                    <h2>ติดตั้ง FFmpeg</h2>
                    <p>เครื่องมือเบื้องหลังที่ใช้ใส่เสียงและซับลงในวิดีโอ</p>
                  </div>
                </div>

                {!installing && !ffmpegReady && (
                  <div className={styles.installIntro}>
                    <div className={styles.toolTile} aria-hidden="true">
                      <Clapperboard size={32} />
                      <span>FF</span>
                    </div>
                    <div>
                      <h3>ยังไม่พบ FFmpeg บนเครื่องนี้</h3>
                      <p>
                        {ffmpegInfo?.found && !ffmpegInfo.libass
                          ? "FFmpeg ที่พบยังไม่มี libass สำหรับซับภาษาไทย Clip360 จะติดตั้งตัวที่รองรับให้"
                          : "Clip360 จะดาวน์โหลดเวอร์ชันที่เหมาะกับเครื่องคุณและเก็บไว้ในโฟลเดอร์โปรแกรม"}
                        ไม่ต้องติดตั้งเอง
                      </p>
                      <ul>
                        <li>ขนาดดาวน์โหลดขึ้นอยู่กับระบบปฏิบัติการ</li>
                        <li>บันทึกไว้ใน data/bin โดยไม่แก้ระบบของเครื่อง</li>
                        <li>รองรับซับภาษาไทยและวิดีโอแนวตั้ง</li>
                      </ul>
                    </div>
                  </div>
                )}

                {(installing || ffmpegReady) && (
                  <div className={styles.progressBlock} aria-live="polite">
                    <div className={styles.progressTopline}>
                      <span>
                        {ffmpegReady ? "ติดตั้งเสร็จแล้ว" : setupStatus?.installMessage ?? progressMessage(installProgress)}
                      </span>
                      <strong>{installProgress}%</strong>
                    </div>
                    <div
                      className={styles.progressTrack}
                      role="progressbar"
                      aria-label="ความคืบหน้าการติดตั้ง FFmpeg"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={installProgress}
                    >
                      <span style={{ width: `${installProgress}%` }} />
                    </div>
                    <div className={styles.progressMeta}>
                      <span>{ffmpegReady ? "ตรวจสอบ libass แล้ว" : "กำลังติดตั้งใน Clip360 Local"}</span>
                      <span>{ffmpegReady ? `FFmpeg ${ffmpegInfo?.version ?? "พร้อมใช้"}` : "ปิดหน้านี้ได้ งานยังทำต่อบนเครื่อง"}</span>
                    </div>
                  </div>
                )}

                {ffmpegReady && (
                  <div className={styles.goodMessage} role="status">
                    <CheckCircle2 size={19} aria-hidden="true" />
                    <span>
                      <strong>FFmpeg พร้อมใช้งานแล้ว</strong>
                      ตรวจสอบการใส่ซับและฟอนต์ภาษาไทยเรียบร้อย
                    </span>
                  </div>
                )}

                {installError && (
                  <div className={styles.errorMessage} role="alert">
                    <CircleAlert size={18} aria-hidden="true" />
                    <span><strong>ติดตั้งไม่สำเร็จ</strong>{installError}</span>
                  </div>
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => setCurrentStep(1)}
                    disabled={installing}
                  >
                    ย้อนกลับ
                  </button>
                  {!ffmpegReady ? (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void startInstall()}
                      disabled={installing || engineState !== "connected"}
                    >
                      {installing ? (
                        <LoaderCircle className={styles.spin} size={18} aria-hidden="true" />
                      ) : (
                        <Download size={18} aria-hidden="true" />
                      )}
                      {installing ? "กำลังติดตั้ง…" : "ดาวน์โหลดและติดตั้ง"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => setCurrentStep(3)}
                    >
                      ไปเชื่อมต่อ Gemini
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className={styles.panelInner}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <KeyRound size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.stepKicker}>ขั้นที่ 3</span>
                    <h2>เชื่อมต่อ Gemini API</h2>
                    <p>ใช้สร้างเสียงพากย์ไทยและช่วยเขียนสคริปต์สินค้า</p>
                  </div>
                </div>

                {!keyValid ? (
                  <>
                    <div className={styles.keyIntro}>
                      <span className={styles.googleMark} aria-hidden="true">
                        <Sparkles size={21} />
                      </span>
                      <div>
                        <strong>ใช้ API key ของคุณเอง</strong>
                        <p>
                          ขอคีย์ฟรีได้จาก Google AI Studio ใช้เวลาไม่เกิน 2 นาที
                        </p>
                      </div>
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                      >
                        ขอ API key
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    </div>

                    <form className={styles.keyForm} onSubmit={testApiKey}>
                      <label htmlFor="gemini-key">Gemini API key</label>
                      <div className={styles.inputWrap}>
                        <KeyRound size={18} aria-hidden="true" />
                        <input
                          id="gemini-key"
                          type={showKey ? "text" : "password"}
                          value={apiKey}
                          onChange={(event) => updateApiKey(event.target.value)}
                          placeholder="AIzaSy••••••••••••••••••••••••••••••••"
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={Boolean(keyError)}
                          aria-describedby={keyError ? "key-error" : "key-help"}
                          disabled={testingKey || engineState !== "connected"}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((value) => !value)}
                          aria-label={showKey ? "ซ่อน API key" : "แสดง API key"}
                        >
                          {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {keyError ? (
                        <p className={styles.fieldError} id="key-error" role="alert">
                          {keyError}
                        </p>
                      ) : (
                        <p className={styles.fieldHelp} id="key-help">
                          คีย์จะถูกบันทึกในไฟล์ .env บนเครื่องนี้ และจะแสดงเพียง 4 ตัวท้าย
                        </p>
                      )}

                      <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={!apiKey.trim() || testingKey || engineState !== "connected"}
                      >
                        {testingKey ? (
                          <LoaderCircle className={styles.spin} size={18} aria-hidden="true" />
                        ) : (
                          <Sparkles size={18} aria-hidden="true" />
                        )}
                        {testingKey ? "กำลังตรวจสอบกับ Google…" : "บันทึกและทดสอบคีย์"}
                      </button>
                    </form>

                    <details className={styles.helpDetails}>
                      <summary>ยังไม่มี API key? ดูวิธีขอแบบ 4 ขั้น</summary>
                      <ol>
                        <li>เปิด Google AI Studio แล้วเข้าสู่ระบบด้วยบัญชี Google</li>
                        <li>กด “Create API key” และเลือกโปรเจกต์ใหม่</li>
                        <li>คัดลอกคีย์ที่ขึ้นต้นด้วย AIza แล้วกลับมาหน้านี้</li>
                        <li>วางคีย์ด้านบน แล้วกด “บันทึกและทดสอบคีย์”</li>
                      </ol>
                    </details>
                  </>
                ) : (
                  <div className={styles.readyState}>
                    <span className={styles.readyIcon}>
                      <CheckCircle2 size={35} aria-hidden="true" />
                    </span>
                    <span className={styles.readyEyebrow}>ตั้งค่าเสร็จสมบูรณ์</span>
                    <h3>พร้อมทำคลิปแรกแล้ว!</h3>
                    <p>
                      ระบบ เสียงพากย์ และเครื่องมือวิดีโอพร้อมใช้งานทั้งหมด
                    </p>
                    <div className={styles.savedKey}>
                      <span>
                        <KeyRound size={17} aria-hidden="true" />
                        Gemini API key
                      </span>
                        <code>••••{savedKeyEnding}</code>
                      <span className={styles.verifiedBadge}>
                        <Check size={13} aria-hidden="true" /> ทดสอบแล้ว
                      </span>
                    </div>
                    <div className={styles.voiceTest} aria-live="polite">
                      <span>เสียงทดสอบ · Kore</span>
                      {voicePreviewUrl && (
                        <audio controls autoPlay src={voicePreviewUrl} aria-label="เสียงทดสอบ Gemini TTS">
                          <track kind="captions" src={VOICE_TEST_CAPTIONS} srcLang="th" label="คำพูดภาษาไทย" default />
                        </audio>
                      )}
                      <button type="button" onClick={() => void playVoicePreview()} disabled={previewingVoice}>
                        {previewingVoice ? <LoaderCircle className={styles.spin} size={14} /> : <Sparkles size={14} />}
                        {previewingVoice ? "กำลังสร้างเสียง…" : voicePreviewUrl ? "ฟังเสียงทดสอบอีกครั้ง" : "สร้างเสียงทดสอบ"}
                      </button>
                    </div>
                    {voicePreviewError && (
                      <div className={styles.errorMessage} role="alert">
                        <CircleAlert size={18} aria-hidden="true" />
                        <span><strong>บันทึกคีย์แล้ว แต่เสียงทดสอบยังไม่สำเร็จ</strong>{voicePreviewError}</span>
                      </div>
                    )}
                    <button type="button" className={styles.readyButton} onClick={goHome}>
                      ไปหน้าแรก
                      <ArrowRight size={19} aria-hidden="true" />
                    </button>
                    <small>ครั้งหน้าที่เปิด Clip360 จะเข้าหน้าแรกให้ทันที</small>
                  </div>
                )}

                {!keyValid && (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => setCurrentStep(2)}
                      disabled={testingKey}
                    >
                      ย้อนกลับ
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <p className={styles.footerNote}>
          {engineState === "connected"
            ? "Clip360 Local · ไม่มีบัญชี ไม่มี telemetry ข้อมูลอยู่บนเครื่องนี้"
            : "Clip360 Web Demo · เปิดผ่าน Clip360 Local เพื่อใช้งานจริง"}
        </p>
      </main>
    </div>
  );
}

function StatusResult({
  checking,
  ready,
  label,
  failedLabel,
}: {
  checking: boolean;
  ready: boolean;
  label: string;
  failedLabel: string;
}) {
  return (
    <span className={styles.statusResult} data-checking={checking} data-ready={ready}>
      {checking ? (
        <>
          <LoaderCircle className={styles.spin} size={16} aria-hidden="true" />
          กำลังตรวจ
        </>
      ) : ready ? (
        <>
          <Check size={15} strokeWidth={3} aria-hidden="true" />
          {label}
        </>
      ) : (
        <>
          <CircleAlert size={15} aria-hidden="true" />
          {failedLabel}
        </>
      )}
    </span>
  );
}
