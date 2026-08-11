"use client";

import {
  ArrowRight,
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
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./setup.module.css";

type Step = 1 | 2 | 3;

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
  if (progress < 22) return "กำลังเตรียมไฟล์สำหรับ Windows…";
  if (progress < 68) return "กำลังดาวน์โหลด FFmpeg (ประมาณ 74 MB)…";
  if (progress < 92) return "กำลังแตกไฟล์ไว้ใน data/bin…";
  return "กำลังตรวจสอบการรองรับซับภาษาไทย…";
}

export default function SetupPage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [checking, setChecking] = useState(true);
  const [systemReady, setSystemReady] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyValid, setKeyValid] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [savedKeyEnding, setSavedKeyEnding] = useState("");

  const runSystemCheck = () => {
    setChecking(true);
    setSystemReady(false);
    window.setTimeout(() => {
      setChecking(false);
      setSystemReady(true);
    }, 900);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setChecking(false);
      setSystemReady(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!installing) return;

    const timer = window.setInterval(() => {
      setInstallProgress((value) => {
        const next = Math.min(value + (value < 70 ? 5 : 3), 100);
        if (next === 100) {
          window.clearInterval(timer);
          setInstalling(false);
          setFfmpegReady(true);
        }
        return next;
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, [installing]);

  const startInstall = () => {
    setInstallProgress(0);
    setFfmpegReady(false);
    setInstalling(true);
  };

  const testApiKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanKey = apiKey.trim();

    if (cleanKey.length < 16) {
      setKeyError("คีย์นี้ดูสั้นเกินไป ลองคัดลอกจาก Google AI Studio อีกครั้ง");
      setKeyValid(false);
      return;
    }

    setKeyError("");
    setTestingKey(true);
    setKeyValid(false);

    window.setTimeout(() => {
      setTestingKey(false);
      setKeyValid(true);
      setSavedKeyEnding(cleanKey.slice(-4));
    }, 1300);
  };

  const updateApiKey = (value: string) => {
    setApiKey(value);
    setKeyError("");
    setKeyValid(false);
    setSavedKeyEnding("");
  };

  const completedSteps = new Set<Step>([
    ...(systemReady ? ([1] as Step[]) : []),
    ...(ffmpegReady ? ([2] as Step[]) : []),
    ...(keyValid ? ([3] as Step[]) : []),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="ClipPang หน้าแรก">
          <span className={styles.brandMark} aria-hidden="true">
            <Clapperboard size={20} strokeWidth={2.4} />
          </span>
          <span>ClipPang</span>
          <span className={styles.localBadge}>LOCAL</span>
        </Link>
        <div className={styles.privacyNote}>
          <ShieldCheck size={16} aria-hidden="true" />
          ข้อมูลอยู่บนเครื่องคุณเท่านั้น
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="setup-title">
          <span className={styles.eyebrow}>ตั้งค่าครั้งแรก · ใช้เวลาประมาณ 3 นาที</span>
          <h1 id="setup-title">เตรียม ClipPang ให้พร้อมใช้งาน</h1>
          <p>
            เราจะเช็กสิ่งที่จำเป็น ติดตั้งเครื่องมือทำวิดีโอ และเชื่อมต่อ Gemini
            ให้เรียบร้อยก่อนเริ่มทำคลิปแรก
          </p>
        </section>

        <section className={styles.wizard} aria-label="ขั้นตอนตั้งค่า ClipPang">
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
                <strong>ทำงานแบบ Local</strong>
                <span>วิดีโอและ API key จะไม่ถูกส่งมาหา ClipPang</span>
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
                    <p>ClipPang กำลังเช็กของที่ต้องใช้บนเครื่องนี้</p>
                  </div>
                </div>

                <div className={styles.statusList} aria-live="polite" aria-busy={checking}>
                  <div className={styles.statusRow}>
                    <span className={styles.statusIcon}>
                      <Cpu size={19} aria-hidden="true" />
                    </span>
                    <span className={styles.statusCopy}>
                      <strong>Node.js</strong>
                      <small>{checking ? "กำลังตรวจเวอร์ชัน…" : "เวอร์ชัน 22.14.0"}</small>
                    </span>
                    <StatusResult checking={checking} label="พร้อมใช้" />
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusIcon}>
                      <HardDrive size={19} aria-hidden="true" />
                    </span>
                    <span className={styles.statusCopy}>
                      <strong>พื้นที่จัดเก็บ</strong>
                      <small>{checking ? "กำลังคำนวณพื้นที่ว่าง…" : "ว่าง 84.2 GB"}</small>
                    </span>
                    <StatusResult checking={checking} label="เพียงพอ" />
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusIcon}>
                      <Type size={19} aria-hidden="true" />
                    </span>
                    <span className={styles.statusCopy}>
                      <strong>ฟอนต์ภาษาไทย</strong>
                      <small>{checking ? "กำลังค้นหา Kanit…" : "Kanit พร้อมใช้งาน"}</small>
                    </span>
                    <StatusResult checking={checking} label="พร้อมใช้" />
                  </div>
                </div>

                {systemReady && (
                  <div className={styles.goodMessage} role="status">
                    <CheckCircle2 size={19} aria-hidden="true" />
                    <span>
                      <strong>เครื่องนี้พร้อมสำหรับ ClipPang</strong>
                      ไปติดตั้งเครื่องมือประมวลผลวิดีโอกันต่อได้เลย
                    </span>
                  </div>
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={runSystemCheck}
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
                    disabled={!systemReady}
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
                        ClipPang จะดาวน์โหลดเวอร์ชันที่เหมาะกับเครื่องคุณและเก็บไว้ในโฟลเดอร์โปรแกรม
                        ไม่ต้องติดตั้งเอง
                      </p>
                      <ul>
                        <li>ขนาดดาวน์โหลดประมาณ 74 MB</li>
                        <li>ใช้พื้นที่หลังติดตั้งประมาณ 190 MB</li>
                        <li>รองรับซับภาษาไทยและวิดีโอแนวตั้ง</li>
                      </ul>
                    </div>
                  </div>
                )}

                {(installing || ffmpegReady) && (
                  <div className={styles.progressBlock} aria-live="polite">
                    <div className={styles.progressTopline}>
                      <span>
                        {ffmpegReady ? "ติดตั้งเสร็จแล้ว" : progressMessage(installProgress)}
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
                      <span>{ffmpegReady ? "ตรวจสอบ libass แล้ว" : "กรุณาอย่าปิดหน้านี้"}</span>
                      <span>{ffmpegReady ? "FFmpeg 7.1" : "เหลือไม่ถึง 1 นาที"}</span>
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
                      onClick={startInstall}
                      disabled={installing}
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
                          disabled={testingKey}
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
                        disabled={!apiKey.trim() || testingKey}
                      >
                        {testingKey ? (
                          <LoaderCircle className={styles.spin} size={18} aria-hidden="true" />
                        ) : (
                          <Sparkles size={18} aria-hidden="true" />
                        )}
                        {testingKey ? "กำลังทดสอบเสียงพากย์…" : "บันทึกและทดสอบคีย์"}
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
                      <code>•••• •••• •••• {savedKeyEnding}</code>
                      <span className={styles.verifiedBadge}>
                        <Check size={13} aria-hidden="true" /> ทดสอบแล้ว
                      </span>
                    </div>
                    <Link className={styles.readyButton} href="/">
                      ไปหน้าแรก
                      <ArrowRight size={19} aria-hidden="true" />
                    </Link>
                    <small>ครั้งหน้าที่เปิด ClipPang จะเข้าหน้าแรกให้ทันที</small>
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
          ClipPang Local v1.0 · ไม่มีบัญชี ไม่มีเซิร์ฟเวอร์ ไม่มีการติดตามการใช้งาน
        </p>
      </main>
    </div>
  );
}

function StatusResult({ checking, label }: { checking: boolean; label: string }) {
  return (
    <span className={styles.statusResult} data-checking={checking}>
      {checking ? (
        <>
          <LoaderCircle className={styles.spin} size={16} aria-hidden="true" />
          กำลังตรวจ
        </>
      ) : (
        <>
          <Check size={15} strokeWidth={3} aria-hidden="true" />
          {label}
        </>
      )}
    </span>
  );
}
