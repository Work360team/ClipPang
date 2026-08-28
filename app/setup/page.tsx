"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clapperboard,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderLock,
  Gauge,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Mic2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
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

type Step = 1 | 2 | 3 | 4 | 5 | 6;
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
    title: "ผู้ช่วยเขียนสคริปต์",
    description: "จำเป็น · เลือกทางไหนก็ได้",
    icon: KeyRound,
  },
  {
    id: 4 as Step,
    title: "ประหยัดโควตา",
    description: "จำเป็น · ได้คลิปมากขึ้น 15 เท่า",
    icon: Gauge,
  },
  {
    id: 5 as Step,
    title: "เสียงของคุณเอง",
    description: "ไม่บังคับ · ข้ามได้",
    icon: Mic2,
  },
  {
    id: 6 as Step,
    title: "ใช้จากมือถือ",
    description: "ไม่บังคับ · เปิด URL ส่วนตัว",
    icon: Smartphone,
  },
];

function progressMessage(progress: number) {
  if (progress < 22) return "กำลังเตรียมไฟล์สำหรับเครื่องนี้…";
  if (progress < 68) return "กำลังดาวน์โหลด FFmpeg…";
  if (progress < 92) return "กำลังแตกไฟล์ไว้ใน data/bin…";
  return "กำลังตรวจสอบการรองรับซับภาษาไทย…";
}

type ScriptOption = {
  id: string;
  kind: string;
  label: string;
  note: string | null;
  available: boolean;
  version: string | null;
  reason: string | null;
  keyUrl: string | null;
  installUrl: string | null;
  command: string | null;
};

type TunnelStatus = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  url: string;
  host: string;
  error: string;
};

type DetailedSetupStatus = Omit<SetupStatus, "node" | "ffmpeg"> & {
  script?: { ready?: boolean; options?: ScriptOption[] };
  account?: { hasOwner?: boolean };
  tunnel?: TunnelStatus;
  node?: boolean | { ready?: boolean; version?: string; required?: string };
  kanit?: boolean | { ready?: boolean; directory?: string; files?: string[]; reason?: string };
  whisper?: {
    ready?: boolean;
    supported?: boolean;
    gpu?: boolean;
    approxBytes?: number | null;
    reason?: string | null;
  };
  whisperInstalling?: boolean;
  whisperProgress?: number | null;
  whisperMessage?: string | null;
  whisperError?: string | null;
  jaitts?: {
    installed?: boolean;
    supported?: boolean;
    gpu?: boolean;
    approxBytes?: number | null;
    reason?: string | null;
  };
  jaittsInstalling?: boolean;
  jaittsProgress?: number | null;
  jaittsMessage?: string | null;
  jaittsError?: string | null;
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
  const [whisperReady, setWhisperReady] = useState(false);
  const [whisperSupported, setWhisperSupported] = useState(true);
  const [whisperGpu, setWhisperGpu] = useState(false);
  const [whisperBytes, setWhisperBytes] = useState<number | null>(null);
  const [whisperInstalling, setWhisperInstalling] = useState(false);
  const [whisperProgress, setWhisperProgress] = useState(0);
  const [whisperMessage, setWhisperMessage] = useState("");
  const [whisperError, setWhisperError] = useState("");
  const [jaittsReady, setJaittsReady] = useState(false);
  const [jaittsSupported, setJaittsSupported] = useState(true);
  const [jaittsInstalling, setJaittsInstalling] = useState(false);
  const [jaittsProgress, setJaittsProgress] = useState(0);
  const [jaittsMessage, setJaittsMessage] = useState("");
  const [jaittsError, setJaittsError] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptOptions, setScriptOptions] = useState<ScriptOption[]>([]);
  const [hasOwner, setHasOwner] = useState(false);
  const [accountUser, setAccountUser] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tunnelError, setTunnelError] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);

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

    const whisper = result.whisper;
    setWhisperReady(Boolean(whisper?.ready));
    setWhisperSupported(whisper?.supported !== false);
    setWhisperGpu(Boolean(whisper?.gpu));
    setWhisperBytes(whisper?.approxBytes ?? null);
    setWhisperInstalling(Boolean(result.whisperInstalling));
    setWhisperProgress(whisper?.ready ? 100 : Math.max(0, Math.min(100, Number(result.whisperProgress ?? 0))));
    setWhisperMessage(result.whisperMessage ?? "");
    setWhisperError(result.whisperError ?? "");

    const jaitts = result.jaitts;
    setJaittsReady(Boolean(jaitts?.installed));
    setJaittsSupported(jaitts?.supported !== false);
    setJaittsInstalling(Boolean(result.jaittsInstalling));
    setJaittsProgress(jaitts?.installed ? 100 : Math.max(0, Math.min(100, Number(result.jaittsProgress ?? 0))));
    setJaittsMessage(result.jaittsMessage ?? "");
    setJaittsError(result.jaittsError ?? "");

    setScriptReady(Boolean(result.script?.ready));
    setScriptOptions(result.script?.options ?? []);
    setHasOwner(Boolean(result.account?.hasOwner));
    setTunnel(result.tunnel ?? null);

    if (chooseStep) {
      setCurrentStep(!nextSystemReady ? 1 : !nextFfmpegReady ? 2 : 3);
    }
  }, []);

  /**
   * ตั้งบัญชีสำหรับเข้าจากมือถือ
   *
   * เดิมทำได้ทางเดียวคือรัน node scripts/set-password.mjs ในเทอร์มินัล ซึ่งคนที่ไม่ได้
   * เขียนโปรแกรมไม่มีทางเดาได้ว่าต้องทำแบบนั้น
   */
  const saveAccount = async (event: FormEvent) => {
    event.preventDefault();
    setAccountError("");
    setSavingAccount(true);
    try {
      const response = await fetch("/api/setup/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: accountUser.trim(), password: accountPassword }),
      });
      const data = await response.json();
      if (!data?.ok) throw new Error(data?.error?.message ?? "ตั้งบัญชีไม่สำเร็จ");
      setHasOwner(true);
      setAccountPassword("");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "ตั้งบัญชีไม่สำเร็จ");
    } finally {
      setSavingAccount(false);
    }
  };

  const callTunnel = async (path: string) => {
    setTunnelError("");
    setTunnelBusy(true);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!data?.ok) throw new Error(data?.error?.message ?? "ทำรายการไม่สำเร็จ");
      if (data.tunnel) setTunnel(data.tunnel);
      else await runSystemCheck();
    } catch (error) {
      setTunnelError(error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setTunnelBusy(false);
    }
  };

  const copyTunnelUrl = async () => {
    if (!tunnel?.url) return;
    try {
      await navigator.clipboard.writeText(tunnel.url);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      setTunnelError("คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอกเอง");
    }
  };

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

  // ติดตั้งเสียงพากย์ในเครื่องใช้เวลาหลายนาทีและดาวน์โหลดหลายกิกะไบต์
  // ถามสถานะเป็นระยะแทนการค้างรอ ผู้ใช้จะได้ปิดหน้านี้ไปทำอย่างอื่นได้
  useEffect(() => {
    if (!jaittsInstalling || engineState !== "connected") return;
    let active = true;
    const poll = async () => {
      try {
        const result = await localApi.setupStatus() as DetailedSetupStatus;
        if (!active) return;
        applySetupStatus(result);
        if (result.jaitts?.installed) {
          setJaittsInstalling(false);
          setJaittsProgress(100);
          setJaittsError("");
        } else if (!result.jaittsInstalling) {
          setJaittsInstalling(false);
          setJaittsError(result.jaittsError || "ติดตั้งไม่สำเร็จ กดลองใหม่ได้");
        }
      } catch {
        // เน็ตสะดุดระหว่าง poll ไม่ใช่เหตุให้เลิกติดตั้ง รอบหน้าค่อยถามใหม่
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [jaittsInstalling, engineState, applySetupStatus]);

  useEffect(() => {
    if (!whisperInstalling || engineState !== "connected") return;
    let active = true;

    const poll = async () => {
      try {
        const result = await localApi.setupStatus() as DetailedSetupStatus;
        if (!active) return;
        applySetupStatus(result);
        if (result.whisper?.ready) {
          setWhisperInstalling(false);
          setWhisperProgress(100);
          setWhisperError("");
        } else if (!result.whisperInstalling) {
          setWhisperInstalling(false);
          // เก็บข้อความจากเซิร์ฟเวอร์ไว้ ผู้ใช้จะได้รู้ว่าติดตรงดาวน์โหลดหรือตรงตรวจสอบ
          setWhisperError(result.whisperError || "ติดตั้ง whisper.cpp ไม่สำเร็จ กดลองใหม่ได้");
        }
      } catch {
        // เน็ตสะดุดระหว่าง poll ไม่ใช่เหตุให้เลิกติดตั้ง รอบหน้าค่อยถามใหม่
      }
    };

    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [whisperInstalling, engineState, applySetupStatus]);

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

  const startJaittsInstall = async () => {
    if (engineState !== "connected") {
      setJaittsError("หน้านี้เป็นเว็บตัวอย่าง กรุณาเปิด Clip360 Local บนคอมก่อนติดตั้ง");
      return;
    }
    setJaittsProgress(0);
    setJaittsError("");
    setJaittsInstalling(true);
    try {
      await localApi.installJaitts();
    } catch (error) {
      setJaittsInstalling(false);
      setJaittsError(messageFrom(error, "สั่งติดตั้งไม่สำเร็จ กรุณาลองอีกครั้ง"));
    }
  };

  const startWhisperInstall = async () => {
    if (engineState !== "connected") {
      setWhisperError("หน้านี้เป็นเว็บตัวอย่าง กรุณาเปิด Clip360 Local บนคอมก่อนติดตั้ง");
      return;
    }
    setWhisperProgress(0);
    setWhisperError("");
    setWhisperInstalling(true);
    try {
      await localApi.installWhisper();
    } catch (error) {
      setWhisperInstalling(false);
      setWhisperError(messageFrom(error, "สั่งติดตั้ง whisper.cpp ไม่สำเร็จ กรุณาลองอีกครั้ง"));
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

  /**
   * ขั้นที่ติ๊กถูกคือขั้นที่ "ติดตั้งเสร็จจริง" ไม่ใช่ขั้นที่เดินผ่านมาแล้ว
   *
   * สองขั้นหลังเพิ่งเพิ่มเข้ามาทีหลังและตกหล่นจากรายการนี้ ผลคือ whisper.cpp
   * ติดตั้งเสร็จแล้วแต่ในแถบซ้ายยังเป็นเลข 4 อยู่ ดูไม่ออกว่าทำไปถึงไหนแล้ว
   */
  const completedSteps = new Set<Step>([
    ...(systemReady ? ([1] as Step[]) : []),
    ...(ffmpegReady ? ([2] as Step[]) : []),
    ...(scriptReady ? ([3] as Step[]) : []),
    ...(whisperReady ? ([4] as Step[]) : []),
    ...(jaittsReady ? ([5] as Step[]) : []),
    ...(hasOwner ? ([6] as Step[]) : []),
  ]);
  // เครื่องที่รัน whisper.cpp ไม่ได้ ข้ามขั้นนั้นได้ จึงไม่นับเป็นเงื่อนไขของคำว่าพร้อม
  // ส่วนเสียงโคลนเป็นของเสริม ไม่ติดตั้งก็ใช้ Gemini พากย์ได้ตามปกติ
  // เขียนสคริปต์ต้องมีทางใดทางหนึ่งเสมอ ไม่งั้นกดสร้างสคริปต์แล้วเจอ error
  // ส่วนเสียงพากย์ต้องมี Gemini key หรือ JaiTTS อย่างใดอย่างหนึ่ง เพราะ CLI คืนได้แค่ข้อความ
  const voiceReady = keyValid || jaittsReady;
  const requiredDone = systemReady && ffmpegReady && scriptReady && voiceReady
    && (whisperReady || !whisperSupported);

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
              <strong>{requiredDone ? "พร้อมแล้ว" : `${currentStep} / ${steps.length}`}</strong>
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
                    <span className={styles.stepKicker}>ขั้นที่ 3 · จำเป็น</span>
                    <h2>ผู้ช่วยเขียนสคริปต์และเสียงพากย์</h2>
                    <p>ต้องมีอย่างน้อยหนึ่งทาง ไม่งั้นกดสร้างสคริปต์แล้วจะขึ้นข้อผิดพลาด</p>
                  </div>
                </div>

                {/* ระบบเขียนสคริปต์ได้เจ็ดทาง แต่หน้านี้เคยดูแค่คีย์ Gemini คนที่ล็อกอิน
                    เครื่องมือ CLI ไว้แล้วจึงโดนบังคับขอคีย์ทั้งที่ไม่ต้องใช้ ส่วนคนที่กดข้าม
                    ก็ไปเจอข้อผิดพลาดตอนสร้างสคริปต์ — ยกมาไว้บนสุดให้เห็นก่อนเลย */}
                <div className={styles.assistantBox} data-ready={scriptReady}>
                  <div className={styles.assistantHead}>
                    <span>{scriptReady ? <Check size={17} strokeWidth={3} /> : <CircleAlert size={17} />}</span>
                    <div>
                      <strong>{scriptReady ? "มีผู้ช่วยเขียนสคริปต์พร้อมใช้แล้ว" : "ยังไม่มีผู้ช่วยเขียนสคริปต์"}</strong>
                      <p>
                        {scriptReady
                          ? "ผ่านขั้นนี้ได้เลย ไม่ต้องหาคีย์เพิ่มถ้าไม่อยากใช้"
                          : "เลือกทางที่ง่ายที่สุดสำหรับคุณจากด้านล่าง ทำอย่างใดอย่างหนึ่งพอ"}
                      </p>
                    </div>
                    <button type="button" className={styles.textButton} onClick={() => void runSystemCheck()} disabled={checking}>
                      <RefreshCw size={14} className={checking ? styles.spin : undefined} aria-hidden="true" /> ตรวจใหม่
                    </button>
                  </div>

                  {/* เรียงเครื่องมือที่ล็อกอินไว้แล้วขึ้นก่อน เพราะไม่ต้องทำอะไรเพิ่มเลย
                      คนที่ไม่เคยสมัครอะไรมาก่อนจะได้เห็นทางที่ง่ายที่สุดเป็นอันแรก */}
                  <ul className={styles.assistantList}>
                    {scriptOptions
                      .filter((option) => option.kind === "cli")
                      .sort((a, b) => Number(b.available) - Number(a.available))
                      .map((option) => (
                        <li key={option.id} data-ready={option.available}>
                          <Terminal size={15} aria-hidden="true" />
                          <div>
                            <strong>{option.label.replace(" (ใช้ subscription ที่ล็อกอินไว้)", "")}</strong>
                            <small>
                              {option.available
                                ? `พบแล้ว ${option.version ?? ""} · ใช้ได้เลย ไม่ต้องใส่คีย์`
                                : `ยังไม่พบคำสั่ง ${option.command ?? option.id} บนเครื่องนี้`}
                            </small>
                          </div>
                          {option.available ? (
                            <span className={styles.assistantTick}><Check size={14} strokeWidth={3} aria-hidden="true" /></span>
                          ) : option.installUrl ? (
                            <a href={option.installUrl} target="_blank" rel="noreferrer">วิธีติดตั้ง<ExternalLink size={12} aria-hidden="true" /></a>
                          ) : null}
                        </li>
                      ))}
                  </ul>

                  {!scriptReady && (
                    <p className={styles.assistantHint}>
                      <strong>ยังไม่เคยสมัครอะไรเลย?</strong> ทางที่เร็วที่สุดคือขอ API key ของ Google
                      ด้านล่างนี้ — ฟรี ใช้บัญชี Google ที่มีอยู่แล้ว ไม่ต้องผูกบัตร และคีย์เดียวนี้
                      ใช้ได้ทั้งเขียนสคริปต์และพากย์เสียง
                    </p>
                  )}
                </div>

                <div className={styles.assistantDivider}>
                  <span>ส่วนเสียงพากย์</span>
                </div>

                <p className={styles.assistantHint}>
                  เครื่องมือ CLI ด้านบนคืนได้แค่ข้อความ การพากย์เสียงจึงต้องมี
                  <strong> Gemini API key</strong> หรือติดตั้ง <strong>เสียงในเครื่อง</strong> ที่ขั้นที่ 5
                  อย่างใดอย่างหนึ่ง
                </p>

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
                    <button type="button" className={styles.readyButton} onClick={() => setCurrentStep(4)}>
                      {whisperReady ? "ไปขั้นตอนสุดท้าย" : "อีกขั้นเดียว · ประหยัดโควตา"}
                      <ArrowRight size={19} aria-hidden="true" />
                    </button>
                    <small>หรือ <button type="button" className={styles.textButton} onClick={goHome}>ข้ามไปหน้าแรกเลย</button></small>
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
                    {/* มีผู้ช่วยเขียนสคริปต์ทางอื่นอยู่แล้วก็ไปต่อได้ ไม่ต้องกรอกคีย์
                        แต่ยังต้องมีเสียงพากย์ ซึ่งไปติดตั้งในเครื่องที่ขั้นที่ 5 ได้ */}
                    {scriptReady && (
                      <button type="button" className={styles.primaryButton} onClick={() => setCurrentStep(4)} disabled={testingKey}>
                        ใช้ผู้ช่วยที่มีอยู่แล้ว
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentStep === 4 && (
              <div className={styles.panelInner}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Gauge size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.stepKicker}>ขั้นที่ 4 · จำเป็น</span>
                    <h2>ประหยัดโควตา Gemini</h2>
                    <p>ติดตั้ง whisper.cpp เพื่อสร้างคลิปได้มากขึ้นต่อวัน</p>
                  </div>
                </div>

                <p>
                  โควตาฟรีของ Gemini ให้สร้างเสียงได้ราว 15 ครั้งต่อวัน คลิปหนึ่งมีบทพูดราว 9 ท่อน
                  ถ้าสร้างทีละท่อนจะได้แค่วันละคลิปเดียว
                </p>
                <p>
                  whisper.cpp ทำให้สร้างเสียงทั้งคลิปในครั้งเดียวได้ แล้วหาเองว่าแต่ละท่อนอยู่ช่วงไหน
                  <strong> ทำให้ได้ราว 15 คลิปต่อวันแทน</strong>
                </p>

                {!whisperSupported && (
                  <div className={styles.errorMessage} role="status">
                    <CircleAlert size={18} aria-hidden="true" />
                    <span>
                      <strong>เครื่องนี้ยังไม่มีตัวติดตั้งอัตโนมัติ</strong>
                      {setupStatus?.whisper?.reason ?? "ติดตั้งเองแล้วตั้ง WHISPER_CLI_PATH ใน .env ได้"}
                    </span>
                  </div>
                )}

                {whisperSupported && !whisperReady && !whisperInstalling && (
                  <div className={styles.installIntro}>
                    <div className={styles.toolTile} aria-hidden="true">
                      <HardDrive size={32} />
                      <span>W</span>
                    </div>
                    <div>
                      <h3>ต้องดาวน์โหลดราว {whisperBytes ? Math.round((whisperBytes / 1e9) * 10) / 10 : 3.8} GB</h3>
                      <p>
                        {whisperGpu
                          ? "ตรวจพบการ์ดจอ NVIDIA จะใช้รุ่นที่เร็วกว่า"
                          : "ไม่พบการ์ดจอ NVIDIA จะใช้รุ่นสำหรับ CPU ซึ่งไฟล์เล็กกว่ามาก"}
                      </p>
                      <ul>
                        <li>เก็บไว้ใน data/bin เหมือน FFmpeg ไม่แก้ระบบของเครื่อง</li>
                        <li>ติดตั้งครั้งเดียว ใช้ได้ตลอด ไม่ต้องต่อเน็ตตอนทำคลิป</li>
                        <li>ใช้ตอนอัดเสียงตัวเองด้วย — ถอดข้อความให้อัตโนมัติ</li>
                      </ul>
                    </div>
                  </div>
                )}

                {whisperInstalling && (
                  <div className={styles.progressBlock} aria-live="polite">
                    <div className={styles.progressTopline}>
                      <span>{whisperMessage || "กำลังติดตั้ง…"}</span>
                      <strong>{whisperProgress}%</strong>
                    </div>
                    <div
                      className={styles.progressTrack}
                      role="progressbar"
                      aria-label="ความคืบหน้าการติดตั้ง whisper.cpp"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={whisperProgress}
                    >
                      <span style={{ width: `${whisperProgress}%` }} />
                    </div>
                    <div className={styles.progressMeta}>
                      <span>ไฟล์โมเดลใหญ่ ใช้เวลาสักครู่</span>
                      <span>ปิดหน้านี้ได้ งานยังทำต่อบนเครื่อง</span>
                    </div>
                  </div>
                )}

                {whisperReady && (
                  <div className={styles.goodMessage} role="status">
                    <CheckCircle2 size={19} aria-hidden="true" />
                    <span>
                      <strong>whisper.cpp พร้อมใช้งานแล้ว</strong>
                      ระบบจะสร้างเสียงทั้งคลิปในคำขอเดียวให้อัตโนมัติ
                    </span>
                  </div>
                )}

                {whisperError && (
                  <div className={styles.errorMessage} role="alert">
                    <CircleAlert size={18} aria-hidden="true" />
                    <span><strong>ติดตั้งไม่สำเร็จ</strong>{whisperError}</span>
                  </div>
                )}

                <div className={styles.actions}>
                  {/* ทางออกเหลือไว้เฉพาะเครื่องที่ติดตั้งอัตโนมัติไม่ได้ ไม่งั้นผู้ใช้จะติดค้าง
                      อยู่ตรงนี้ตลอดไปโดยไม่มีทางไปต่อ ส่วนเครื่องที่ติดตั้งได้ให้ติดตั้งก่อน */}
                  {(whisperReady || !whisperSupported) && (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={goHome}
                      disabled={whisperInstalling}
                    >
                      {whisperReady ? "ไปหน้าแรก" : "ข้ามไปก่อน"}
                    </button>
                  )}
                  {!whisperReady && whisperSupported && (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void startWhisperInstall()}
                      disabled={whisperInstalling || engineState !== "connected"}
                    >
                      {whisperInstalling ? (
                        <LoaderCircle className={styles.spin} size={18} aria-hidden="true" />
                      ) : (
                        <Download size={18} aria-hidden="true" />
                      )}
                      {whisperInstalling ? "กำลังติดตั้ง…" : "ดาวน์โหลดและติดตั้ง"}
                    </button>
                  )}
                  {whisperReady && (
                    <button type="button" className={styles.primaryButton} onClick={() => setCurrentStep(5)}>
                      ต่อไป: เสียงของคุณเอง
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {currentStep === 5 && (
              <div className={styles.panelInner}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Mic2 size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.stepKicker}>ขั้นที่ 5 · ไม่บังคับ</span>
                    <h2>ใช้เสียงของคุณเองพากย์</h2>
                    <p>โคลนเสียงจากคลิปสั้น ๆ ที่อัดเอง ทำงานในเครื่อง ไม่ใช้โควตา</p>
                  </div>
                </div>

                <p>
                  ติดตั้งแล้วจะมีตัวเลือก “เสียงของฉัน” เพิ่มขึ้นมาในขั้นเลือกเสียง
                  อัดเสียงตัวเอง 3–15 วินาที แล้วให้ระบบพากย์ด้วยเสียงนั้นได้ทุกคลิป
                  โดยไม่นับโควตา Gemini เลย
                </p>

                {!jaittsSupported && (
                  <div className={styles.errorMessage} role="status">
                    <CircleAlert size={18} aria-hidden="true" />
                    <span>
                      <strong>เครื่องนี้ยังไม่มีตัวติดตั้งอัตโนมัติ</strong>
                      {setupStatus?.jaitts?.reason ?? "ติดตั้งเองแล้วตั้ง JAITTS_HOME ใน .env ได้"}
                    </span>
                  </div>
                )}

                {jaittsSupported && !jaittsReady && !jaittsInstalling && (
                  <div className={styles.installIntro}>
                    <div className={styles.toolTile} aria-hidden="true">
                      <HardDrive size={32} />
                      <span>J</span>
                    </div>
                    <div>
                      <h3>ต้องดาวน์โหลดราว 7 GB</h3>
                      <p>ใหญ่กว่าขั้นอื่นมาก เพราะต้องลงชุดคำนวณของ Python ทั้งชุด</p>
                      <ul>
                        <li>เก็บใน data/bin เหมือนตัวอื่น ไม่แก้ระบบของเครื่อง</li>
                        <li>ข้ามได้ กลับมาติดตั้งทีหลังจากหน้านี้ก็ได้</li>
                        <li>ไม่ติดตั้งก็ยังทำคลิปได้ตามปกติด้วยเสียง Gemini</li>
                      </ul>
                    </div>
                  </div>
                )}

                {jaittsInstalling && (
                  <div className={styles.progressBlock} aria-live="polite">
                    <div className={styles.progressTopline}>
                      <span>{jaittsMessage || "กำลังติดตั้ง…"}</span>
                      <strong>{jaittsProgress}%</strong>
                    </div>
                    <div
                      className={styles.progressTrack}
                      role="progressbar"
                      aria-label="ความคืบหน้าการติดตั้งเสียงพากย์ในเครื่อง"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={jaittsProgress}
                    >
                      <span style={{ width: `${jaittsProgress}%` }} />
                    </div>
                    <div className={styles.progressMeta}>
                      <span>ใช้เวลาหลายนาที ขึ้นกับความเร็วเน็ต</span>
                      <span>ปิดหน้านี้ได้ งานยังทำต่อบนเครื่อง</span>
                    </div>
                  </div>
                )}

                {jaittsReady && (
                  <div className={styles.goodMessage} role="status">
                    <CheckCircle2 size={19} aria-hidden="true" />
                    <span>
                      <strong>เสียงพากย์ในเครื่องพร้อมใช้งานแล้ว</strong>
                      ไปอัดเสียงตัวเองได้ที่ขั้นเลือกเสียงตอนสร้างคลิป
                    </span>
                  </div>
                )}

                {jaittsError && (
                  <div className={styles.errorMessage} role="alert">
                    <CircleAlert size={18} aria-hidden="true" />
                    <span><strong>ติดตั้งไม่สำเร็จ</strong>{jaittsError}</span>
                  </div>
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={goHome}
                    disabled={jaittsInstalling}
                  >
                    {jaittsReady ? "ไปหน้าแรก" : "ข้ามไปก่อน"}
                  </button>
                  {!jaittsReady && jaittsSupported && (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void startJaittsInstall()}
                      disabled={jaittsInstalling || engineState !== "connected"}
                    >
                      {jaittsInstalling ? (
                        <LoaderCircle className={styles.spin} size={18} aria-hidden="true" />
                      ) : (
                        <Download size={18} aria-hidden="true" />
                      )}
                      {jaittsInstalling ? "กำลังติดตั้ง…" : "ดาวน์โหลดและติดตั้ง"}
                    </button>
                  )}
                  {jaittsReady && (
                    <button type="button" className={styles.primaryButton} onClick={() => setCurrentStep(6)}>
                      ต่อไป: ใช้จากมือถือ
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {currentStep === 6 && (
              <div className={styles.panelInner}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Smartphone size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.stepKicker}>ขั้นที่ 6 · ไม่บังคับ</span>
                    <h2>ใช้จากมือถือ</h2>
                    <p>เปิด URL ส่วนตัวให้เข้าจากที่ไหนก็ได้ ไม่ต้องสมัครบริการอะไรเพิ่ม</p>
                  </div>
                </div>

                {/* ทางที่ปลอดภัยที่สุดคือ Wi-Fi เดียวกัน ต้องบอกก่อนเสมอ ไม่ใช่เชียร์ให้เปิด
                    ออกอินเทอร์เน็ตทั้งที่หลายคนไม่ได้ต้องการขนาดนั้น */}
                <div className={styles.assistantHint}>
                  <strong>ถ้ามือถืออยู่ Wi-Fi เดียวกับคอมเครื่องนี้</strong> ไม่ต้องเปิดอะไรเลย
                  พิมพ์ที่อยู่ของเครื่องนี้ในเบราว์เซอร์มือถือได้ทันที ส่วนด้านล่างมีไว้สำหรับตอนอยู่
                  นอกบ้านหรืออยู่คนละเครือข่าย
                </div>

                {/* บัญชีต้องมาก่อนเสมอ — เปิด URL สาธารณะโดยไม่มีรหัสผ่านไม่ได้เด็ดขาด */}
                <div className={styles.assistantBox} data-ready={hasOwner}>
                  <div className={styles.assistantHead}>
                    <span>{hasOwner ? <Check size={17} strokeWidth={3} /> : <CircleAlert size={17} />}</span>
                    <div>
                      <strong>{hasOwner ? "ตั้งรหัสผ่านไว้แล้ว" : "ตั้งชื่อผู้ใช้และรหัสผ่านก่อน"}</strong>
                      <p>ใครเปิด URL นี้ก็ต้องใส่รหัสก่อนถึงจะเข้าได้ ไม่มีทางเปิดแบบไม่ตั้งรหัส</p>
                    </div>
                  </div>
                  <form className={styles.accountForm} onSubmit={saveAccount}>
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="ชื่อผู้ใช้"
                      value={accountUser}
                      onChange={(event) => setAccountUser(event.target.value)}
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="รหัสผ่าน อย่างน้อย 8 ตัว"
                      value={accountPassword}
                      onChange={(event) => setAccountPassword(event.target.value)}
                    />
                    <button type="submit" className={styles.secondaryButton} disabled={savingAccount || accountUser.trim().length < 3 || accountPassword.length < 8}>
                      {savingAccount ? "กำลังบันทึก…" : hasOwner ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่าน"}
                    </button>
                  </form>
                  {accountError && (
                    <div className={styles.errorMessage} role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <span>{accountError}</span>
                    </div>
                  )}
                </div>

                {tunnel?.supported === false ? (
                  <div className={styles.assistantHint}>เครื่องนี้ยังไม่รองรับการเปิด URL อัตโนมัติ</div>
                ) : (
                  <div className={styles.assistantBox} data-ready={Boolean(tunnel?.running)}>
                    <div className={styles.assistantHead}>
                      <span>{tunnel?.running ? <Check size={17} strokeWidth={3} /> : <Smartphone size={17} />}</span>
                      <div>
                        <strong>{tunnel?.running ? "URL พร้อมใช้แล้ว" : "เปิด URL สำหรับมือถือ"}</strong>
                        <p>ใช้ตัวเชื่อมต่อของ Cloudflare ไม่ต้องสมัครบัญชี ไม่ต้องตั้งค่าเราเตอร์</p>
                      </div>
                    </div>

                    {tunnel?.running && tunnel.url && (
                      <div className={styles.tunnelUrl}>
                        <code>{tunnel.url}</code>
                        <button type="button" className={styles.secondaryButton} onClick={() => void copyTunnelUrl()}>
                          <Copy size={15} aria-hidden="true" />
                          {urlCopied ? "คัดลอกแล้ว" : "คัดลอก"}
                        </button>
                      </div>
                    )}

                    {/* URL สุ่มใหม่ทุกครั้งที่เปิด ต้องบอกไว้ ไม่งั้นผู้ใช้บุ๊กมาร์กไว้แล้วงงว่าเข้าไม่ได้ */}
                    {tunnel?.running && (
                      <p className={styles.assistantHint}>
                        URL นี้ใช้ได้จนกว่าจะปิดโปรแกรม และจะ<strong>เปลี่ยนใหม่ทุกครั้งที่เปิด</strong>
                        {' '}อย่าบุ๊กมาร์กไว้ ให้กลับมาดูที่หน้านี้
                      </p>
                    )}

                    {tunnelError && (
                      <div className={styles.errorMessage} role="alert">
                        <CircleAlert size={18} aria-hidden="true" />
                        <span>{tunnelError}</span>
                      </div>
                    )}

                    <div className={styles.actions}>
                      {!tunnel?.installed && (
                        <button type="button" className={styles.secondaryButton} onClick={() => void callTunnel("/api/setup/tunnel")} disabled={tunnelBusy}>
                          <Download size={17} aria-hidden="true" />
                          {tunnelBusy ? "กำลังดาวน์โหลด…" : "ดาวน์โหลดตัวเชื่อมต่อ"}
                        </button>
                      )}
                      {tunnel?.installed && !tunnel.running && (
                        <button type="button" className={styles.primaryButton} onClick={() => void callTunnel("/api/setup/tunnel/start")} disabled={tunnelBusy || !hasOwner}>
                          {tunnelBusy ? "กำลังเปิด…" : "เปิด URL"}
                        </button>
                      )}
                      {tunnel?.running && (
                        <button type="button" className={styles.textButton} onClick={() => void callTunnel("/api/setup/tunnel/stop")} disabled={tunnelBusy}>
                          ปิด URL
                        </button>
                      )}
                    </div>

                    {!hasOwner && tunnel?.installed && (
                      <p className={styles.assistantHint}>ตั้งรหัสผ่านด้านบนก่อน ปุ่มเปิด URL ถึงจะกดได้</p>
                    )}
                  </div>
                )}

                <div className={styles.actions}>
                  <button type="button" className={styles.textButton} onClick={() => setCurrentStep(5)}>ย้อนกลับ</button>
                  <button type="button" className={styles.primaryButton} onClick={goHome}>
                    เริ่มทำคลิป
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
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
