"use client";

import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  FileAudio,
  FileText,
  Film,
  FolderOpen,
  Gauge,
  GripVertical,
  LoaderCircle,
  Mic2,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from "react";
import { AppShell } from "./AppShell";
import { HardLink as Link } from "./HardLink";
import {
  detectLocalEngine,
  ClipPangApiError,
  localApi,
  watchRender,
  type LocalEngineState,
  type LocalAsset,
  type LocalOutput,
  type LocalProjectAsset,
  type LocalRender,
  type LocalScript,
  type LocalTimelineClip,
  type LocalVoice,
} from "../lib/local-api";

type WizardStep = 1 | 2 | 3 | 4 | 5;

type WizardAsset = LocalProjectAsset & {
  clientId: string;
  previewUrl?: string;
  durationKnown?: boolean;
};

const MAX_CLIPS = 12;
const MAX_TIMELINE_CLIPS = 24;
const MAX_TOTAL_DURATION_SEC = 60;

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function persistedAssets(assets: WizardAsset[], timeline: LocalTimelineClip[] = []): LocalProjectAsset[] {
  return [...assets]
    .sort((a, b) => a.order - b.order)
    .map(({ name, originalName, url, size, durationMs, selectedDurationSec, width, height }, order) => ({
      name,
      originalName,
      url,
      size,
      durationMs,
      selectedDurationSec: timeline.length
        ? timeline.filter((clip) => clip.assetName === name).reduce((total, clip) => total + Math.max(0, clip.trimEndMs - clip.trimStartMs), 0) / 1000
        : selectedDurationSec,
      order,
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
    }));
}

function persistedTimeline(clips: LocalTimelineClip[]) {
  return [...clips]
    .sort((a, b) => a.order - b.order)
    .map((clip, order) => ({ ...clip, order }));
}

function makeTimelineId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function browserVideoDuration(file: File, objectUrl: string) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(() => {
      video.removeAttribute("src");
      reject(new Error(`อ่านความยาวของ ${file.name} ไม่สำเร็จ`));
    }, 12_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const durationMs = Math.round(video.duration * 1000);
      video.removeAttribute("src");
      if (!Number.isFinite(durationMs) || durationMs <= 0) reject(new Error(`ไม่พบความยาวของ ${file.name}`));
      else resolve(durationMs);
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      reject(new Error(`เปิด ${file.name} เพื่ออ่านความยาวไม่ได้`));
    };
    video.src = objectUrl;
  });
}

const steps: { id: WizardStep; label: string; helper: string; icon: typeof Film }[] = [
  { id: 1, label: "คลิป", helper: "เลือกวิดีโอ", icon: Film },
  { id: 2, label: "สินค้า", helper: "บอกจุดขาย", icon: PackageCheck },
  { id: 3, label: "เสียง", helper: "เลือกนักพากย์", icon: Mic2 },
  { id: 4, label: "สคริปต์ + ซับ", helper: "ปรับสไตล์", icon: Captions },
  { id: 5, label: "ผลลัพธ์", helper: "เรนเดอร์และโหลด", icon: Download },
];

const voices = [
  { id: "Kore", name: "เมษา", gender: "หญิง", tone: "หนักแน่น น่าเชื่อถือ", color: "#ffd6a6", initials: "ม", provider: "gemini" },
  { id: "Aoede", name: "น้ำมนต์", gender: "หญิง", tone: "นุ่มนวล โปร่งใส", color: "#d9d4ff", initials: "น", provider: "gemini" },
  { id: "Puck", name: "ต้นกล้า", gender: "ชาย", tone: "สดใส กระฉับกระเฉง", color: "#c9eddc", initials: "ต", provider: "gemini" },
  { id: "Zephyr", name: "พริม", gender: "หญิง", tone: "สว่าง เป็นมิตร", color: "#ffd8df", initials: "พ", provider: "gemini" },
  { id: "Charon", name: "คิน", gender: "ชาย", tone: "ชัดถ้อยชัดคำ", color: "#cde5f5", initials: "ค", provider: "gemini" },
  { id: "Leda", name: "เอม", gender: "หญิง", tone: "อ่อนเยาว์ สดใส", color: "#f2e4b8", initials: "อ", provider: "gemini" },
];

const initialScripts = [
  {
    id: "hook",
    tag: "ขายตรง เข้าใจไว",
    name: "เปิดด้วยปัญหา",
    score: 96,
    chunks: [
      "ใครที่ชอบลืมสายชาร์จ ต้องดูตัวนี้เลย",
      "แค่แปะด้านหลังมือถือ ก็ชาร์จได้ทันที ไม่ต้องพกสายให้วุ่นวาย",
      "ตัวเล็ก พกง่าย ติดแน่น แถมใช้เป็นห่วงจับมือถือได้ด้วย",
      "วันนี้มีราคาพิเศษ กดที่ตะกร้าแล้วลองใช้ได้เลยค่ะ",
    ],
  },
  {
    id: "review",
    tag: "จริงใจ เหมือนเพื่อนบอก",
    name: "รีวิวจากประสบการณ์",
    score: 92,
    chunks: [
      "ตอนแรกคิดว่าไม่จำเป็น จนได้ลองพกอันนี้ออกจากบ้าน",
      "แบตใกล้หมดเมื่อไหร่ แปะปุ๊บชาร์จปั๊บ ไม่ต้องหาปลั๊ก",
      "ชอบตรงที่เบามาก แล้ววงแหวนก็ช่วยให้ถือถ่ายคลิปถนัดขึ้น",
      "ใครเดินทางบ่อย บอกเลยว่าควรมีติดกระเป๋าค่ะ",
    ],
  },
  {
    id: "wow",
    tag: "ไวรัล จังหวะเร็ว",
    name: "ว้าวตั้งแต่วินาทีแรก",
    score: 89,
    chunks: [
      "ของชิ้นนี้ทำให้สายชาร์จในกระเป๋ากลายเป็นของเกินจำเป็น",
      "เพราะแค่แตะ ก็เติมแบตให้มือถือได้ทันที",
      "ทั้งบาง ทั้งเบา และล็อกแน่นแบบเดินถ่ายคลิปได้สบาย",
      "ของมันต้องมีอยู่ในตะกร้าแล้ว รีบกดก่อนหมดโปรค่ะ",
    ],
  },
  {
    id: "story",
    tag: "เล่าเรื่อง ดูจนจบ",
    name: "หนึ่งวันกับสินค้า",
    score: 86,
    chunks: [
      "เช้านี้ออกจากบ้านด้วยแบตแค่ยี่สิบเปอร์เซ็นต์",
      "แต่ยังไม่ต้องห่วง เพราะมีแบตแม่เหล็กตัวจิ๋วอยู่ในกระเป๋า",
      "แปะไว้ระหว่างเดินทาง พอถึงร้านกาแฟแบตก็พร้อมทำงานต่อ",
      "เล็กแค่นี้แต่ช่วยชีวิตได้ทั้งวัน กดดูสีที่ตะกร้าได้เลยค่ะ",
    ],
  },
  {
    id: "deal",
    tag: "เร่งตัดสินใจ",
    name: "โปรแรง ต้องรีบกด",
    score: 84,
    chunks: [
      "หยุดก่อน ถ้าเห็นราคานี้แล้วยังไม่กดถือว่าพลาดมาก",
      "ได้ทั้งพาวเวอร์แบงก์แม่เหล็กและห่วงจับในชิ้นเดียว",
      "พกง่าย ชาร์จไว สีสวยเข้ากับมือถือทุกเครื่อง",
      "โปรนี้มีจำนวนจำกัด กดเก็บโค้ดในตะกร้าตอนนี้เลยค่ะ",
    ],
  },
];

const captionStyles = [
  { id: "karaoke-pop", name: "ป๊อปขายดี", note: "เด่น อ่านไว", label: "ติดแน่นทุกที่", className: "caption-pop", speed: "เร็ว" },
  { id: "reveal-clean", name: "คลีนมินิมอล", note: "สะอาด ดูแพง", label: "ชาร์จได้ทันที", className: "caption-clean", speed: "เร็ว" },
  { id: "box-bold", name: "กล่องครีเอเตอร์", note: "ชัดบนทุกพื้นหลัง", label: "พกง่ายมาก", className: "caption-boxed", speed: "เร็ว" },
  { id: "kanit-hf", name: "คาราโอเกะพรีเมียม", note: "ไฮไลต์ตามคำพูด", label: "ไม่ต้องพกสาย", className: "caption-karaoke", speed: "ละเอียด" },
];

const replacementLines = [
  "ตัวเดียวจบทั้งชาร์จ ทั้งจับมือถือ พกออกจากบ้านได้แบบสบายมาก",
  "แบตใกล้หมดไม่ต้องตกใจ แปะแล้วใช้ต่อได้ทันทีเลยค่ะ",
  "เบาจนแทบไม่รู้สึก แต่กำลังสำรองพร้อมช่วยได้ทั้งวัน",
  "ใครใช้มือถือทำงานหรือถ่ายคลิปบ่อย ตัวนี้ตอบโจทย์มาก",
];

type ProductBrief = {
  name: string;
  category: string;
  price: string;
  features: string;
  audience: string;
  tone: string;
  cta: string;
};

const initialBrief: ProductBrief = {
  name: "หัวชาร์จพกพาแม่เหล็ก 5,000 mAh",
  category: "มือถือและอุปกรณ์เสริม",
  price: "399 บาท จากปกติ 590 บาท",
  features: "ชาร์จไร้สายแบบแม่เหล็ก, ติดแน่น, น้ำหนักเบา, ใช้เป็นห่วงจับมือถือได้, พกขึ้นเครื่องได้",
  audience: "คนทำงาน ครีเอเตอร์ และคนเดินทางบ่อย",
  tone: "เหมือนเพื่อนแนะนำ",
  cta: "กดรับโปรที่ตะกร้าได้เลยค่ะ",
};

export function ProjectWizard() {
  const params = useParams<{ id?: string }>();
  const rawRouteId = typeof params?.id === "string" ? params.id : null;
  let decodedRouteId = rawRouteId;
  try {
    // vinext currently exposes dynamic path params in their URL-encoded form.
    // Decode once before localApi encodes the id for the API request, otherwise
    // Thai project ids become double-encoded and cannot be restored on reload.
    decodedRouteId = rawRouteId ? decodeURIComponent(rawRouteId) : null;
  } catch {
    // Keep the original value so the API can return its normal safe 4xx error.
  }
  const routeId = decodedRouteId && decodedRouteId !== "new" ? decodedRouteId : null;
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [projectId, setProjectId] = useState<string | null>(routeId);
  const [assetName, setAssetName] = useState<string | null>(null);
  const [clipAssets, setClipAssets] = useState<WizardAsset[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [timelineClips, setTimelineClips] = useState<LocalTimelineClip[]>([]);
  const [timelineEditorOpen, setTimelineEditorOpen] = useState(false);
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null);
  const [timelinePlayheadMs, setTimelinePlayheadMs] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [operationMessage, setOperationMessage] = useState("");
  const [activeStep, setActiveStep] = useState<WizardStep>(1);
  const [completedSteps, setCompletedSteps] = useState<WizardStep[]>([]);
  const [videoUrl, setVideoUrl] = useState("/clippang-sample.mp4");
  const [fileName, setFileName] = useState("คลิปตัวอย่าง.mp4");
  const [uploadError, setUploadError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [voiceLibrary, setVoiceLibrary] = useState(voices);
  const [selectedVoice, setSelectedVoice] = useState("Kore");
  const [voiceFilter, setVoiceFilter] = useState("ทั้งหมด");
  const [voicePlaying, setVoicePlaying] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [tone, setTone] = useState("เป็นกันเอง");
  const [scriptVariants, setScriptVariants] = useState<LocalScript[]>(initialScripts);
  const [selectedScript, setSelectedScript] = useState("hook");
  const [scriptTexts, setScriptTexts] = useState(() =>
    Object.fromEntries(initialScripts.map((script) => [script.id, [...script.chunks]])),
  );
  const [selectedStyle, setSelectedStyle] = useState("karaoke-pop");
  const [captionPosition, setCaptionPosition] = useState("ล่าง");
  const [selectedDraft, setSelectedDraft] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderDone, setRenderDone] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [renderId, setRenderId] = useState<string | null>(null);
  const [renderKind, setRenderKind] = useState<"draft" | "final">("draft");
  const [renderError, setRenderError] = useState("");
  const [renderOutputs, setRenderOutputs] = useState<Record<string, LocalOutput>>({});
  const [brief, setBrief] = useState<ProductBrief>(initialBrief);
  const [toast, setToast] = useState("");
  const [recentlyDeletedClip, setRecentlyDeletedClip] = useState<{ clip: LocalTimelineClip; index: number; message: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineVideoRef = useRef<HTMLVideoElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const stopWatchingRenderRef = useRef<(() => void) | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const pendingTimelineSeekRef = useRef<number | null>(null);
  const timelinePlaybackRevisionRef = useRef(0);
  const uploadLockRef = useRef(false);
  const pendingUploadFilesRef = useRef<File[]>([]);
  const editRevisionRef = useRef(0);
  const activeRenderEditRevisionRef = useRef<number | null>(null);
  const projectSaveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const skipNextTimelineAutosaveRef = useRef(false);
  const projectReadyForAutosaveRef = useRef(false);

  const selectedScriptData = scriptVariants.find((item) => item.id === selectedScript) ?? scriptVariants[0] ?? initialScripts[0];
  const selectedStyleData = captionStyles.find((item) => item.id === selectedStyle) ?? captionStyles[0];
  const selectedVoiceData = voiceLibrary.find((item) => item.id === selectedVoice) ?? voiceLibrary[0] ?? voices[0];
  const currentChunks = scriptTexts[selectedScript] ?? selectedScriptData.chunks;

  const filteredVoices = voiceLibrary.filter((voice) => voiceFilter === "ทั้งหมด" || voice.tone.includes(voiceFilter));
  const orderedClipAssets = useMemo(() => [...clipAssets].sort((a, b) => a.order - b.order), [clipAssets]);
  const orderedTimelineClips = useMemo(() => [...timelineClips].sort((a, b) => a.order - b.order), [timelineClips]);
  const activeClip = orderedClipAssets.find((asset) => asset.clientId === activeClipId) ?? orderedClipAssets[0] ?? null;
  const selectedTimelineClip = orderedTimelineClips.find((clip) => clip.id === selectedTimelineClipId) ?? orderedTimelineClips[0] ?? null;
  const selectedTimelineAsset = selectedTimelineClip
    ? orderedClipAssets.find((asset) => asset.name === selectedTimelineClip.assetName) ?? null
    : null;
  const timelineTotalMs = useMemo(
    () => orderedTimelineClips.reduce((total, clip) => total + Math.max(0, clip.trimEndMs - clip.trimStartMs), 0),
    [orderedTimelineClips],
  );
  const selectedTotalSec = timelineTotalMs / 1000;
  const clipDurationInvalid = orderedTimelineClips.some((clip) => {
    const asset = orderedClipAssets.find((item) => item.name === clip.assetName);
    return !asset || clip.trimStartMs < 0 || clip.trimEndMs <= clip.trimStartMs || clip.trimEndMs > asset.durationMs + 1;
  });
  const totalDurationInvalid = selectedTotalSec <= 0 || selectedTotalSec > MAX_TOTAL_DURATION_SEC + 0.001;
  const clipSelectionInvalid = orderedClipAssets.length === 0 || orderedTimelineClips.length === 0 || clipDurationInvalid || totalDurationInvalid;
  const hasChosenClip = orderedClipAssets.length > 0;
  const previewVideoUrl = activeClip?.previewUrl || activeClip?.url || videoUrl;
  const timelinePreviewUrl = selectedTimelineAsset?.previewUrl || selectedTimelineAsset?.url || "/clippang-sample.mp4";
  const renderedVideoUrl = chooseVideoOutput(renderOutputs) || (engineState === "connected" ? null : "/clippang-sample.mp4");
  const downloadableOutputs = Object.entries(renderOutputs).filter(([, output]) => output?.url && output?.filename);

  /* ---------- พรีวิวสด: เล่น Timeline จริง ไม่ใช่คลิปเดียวค้างไว้ ---------- */

  const graphemeSegmenter = useMemo(
    () => (typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("th", { granularity: "grapheme" }) : null),
    [],
  );
  const countGraphemes = useCallback(
    (value: string) => (graphemeSegmenter ? [...graphemeSegmenter.segment(value)].length : value.length),
    [graphemeSegmenter],
  );

  // ต่อคลิปที่ตัดไว้เป็นเส้นเวลาเดียว แต่ละช่วงรู้ว่าต้องเล่นไฟล์ไหนตั้งแต่วินาทีที่เท่าไหร่
  const programSegments = useMemo(() => {
    let cursor = 0;
    const segments: { id: string; assetName: string; src: string; sourceStartMs: number; startMs: number; endMs: number; durationMs: number }[] = [];
    for (const clip of orderedTimelineClips) {
      const asset = orderedClipAssets.find((item) => item.name === clip.assetName) ?? null;
      const durationMs = Math.max(0, clip.trimEndMs - clip.trimStartMs);
      const src = asset?.previewUrl || asset?.url || "";
      if (durationMs <= 0 || !src) continue;
      segments.push({ id: clip.id, assetName: clip.assetName, src, sourceStartMs: clip.trimStartMs, startMs: cursor, endMs: cursor + durationMs, durationMs });
      cursor += durationMs;
    }
    return segments;
  }, [orderedTimelineClips, orderedClipAssets]);

  const previewTotalMs = programSegments.length ? programSegments[programSegments.length - 1].endMs : 0;
  const hasProgram = programSegments.length > 0;

  // แบ่งเวลาให้แต่ละท่อนตามจำนวนตัวอักษร — วิธีเดียวกับที่ pipeline ใช้ตอนสร้างจริง
  // ก่อนเรนเดอร์เรายังไม่รู้ความยาวเสียงจริง ค่านี้จึงเป็นค่าประมาณที่บอกผู้ใช้ตรง ๆ
  const captionCues = useMemo(() => {
    const texts = currentChunks.map((chunk) => (chunk ?? "").trim()).filter(Boolean);
    if (!texts.length || previewTotalMs <= 0) return [] as { text: string; startMs: number; endMs: number }[];
    const weights = texts.map((text) => Math.max(1, countGraphemes(text)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = 0;
    return texts.map((text, index) => {
      const span = index === texts.length - 1 ? previewTotalMs - cursor : Math.round((weights[index] / totalWeight) * previewTotalMs);
      const cue = { text, startMs: cursor, endMs: cursor + span };
      cursor += span;
      return cue;
    });
  }, [currentChunks, previewTotalMs, countGraphemes]);

  const [rawPreviewTimeMs, setPreviewTimeMs] = useState(0);
  const [rawPreviewSegmentIndex, setPreviewSegmentIndex] = useState(0);
  const previewSeekRef = useRef<number | null>(null);
  const appliedSegmentRef = useRef(-1);

  // ผู้ใช้ลบหรือตัดคลิปได้ตลอด เส้นเวลาจึงหดได้ — หนีบค่าตอนอ่าน ไม่ใช่ตั้ง state ใหม่ใน effect
  const previewTimeMs = previewTotalMs > 0 ? Math.min(rawPreviewTimeMs, Math.max(0, previewTotalMs - 1)) : 0;
  const previewSegmentIndex = hasProgram ? Math.min(rawPreviewSegmentIndex, programSegments.length - 1) : 0;

  const activeCue = captionCues.find((cue) => previewTimeMs >= cue.startMs && previewTimeMs < cue.endMs) ?? null;
  const previewCaptionText = activeCue?.text ?? (isPlaying ? "" : captionCues[0]?.text ?? currentChunks[0] ?? "");

  // ย้าย playhead ไปตำแหน่งที่ต้องการ แล้วปล่อยให้ effect ข้างล่างจัดการไฟล์และ currentTime
  const seekPreviewTo = useCallback(
    (targetMs: number) => {
      if (!hasProgram) return;
      const clamped = Math.min(Math.max(0, targetMs), Math.max(0, previewTotalMs - 1));
      const index = programSegments.findIndex((segment) => clamped >= segment.startMs && clamped < segment.endMs);
      previewSeekRef.current = clamped;
      appliedSegmentRef.current = -1;
      setPreviewSegmentIndex(index < 0 ? 0 : index);
      setPreviewTimeMs(clamped);
    },
    [hasProgram, previewTotalMs, programSegments],
  );

  // สลับไฟล์ต้นทางเมื่อ playhead ข้ามไปช่วงถัดไป
  useEffect(() => {
    const video = videoRef.current;
    const segment = programSegments[previewSegmentIndex];
    if (!video || !segment) return;
    if (appliedSegmentRef.current === previewSegmentIndex && previewSeekRef.current == null) return;
    appliedSegmentRef.current = previewSegmentIndex;

    const wanted = new URL(segment.src, window.location.href).href;
    if (video.src !== wanted) video.src = segment.src;
    const offsetMs = Math.max(0, (previewSeekRef.current ?? segment.startMs) - segment.startMs);
    previewSeekRef.current = null;
    const seekTo = (segment.sourceStartMs + offsetMs) / 1000;
    const apply = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(seekTo, Math.max(0, video.duration - 0.05));
      else video.currentTime = seekTo;
      if (isPlaying) void video.play().catch(() => undefined);
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }, [previewSegmentIndex, programSegments, isPlaying]);

  // อ่านเวลาจากวิดีโอจริงแล้วเลื่อน playhead — เรียกได้จากทั้ง timeupdate และ rAF
  const syncPreviewFromVideo = useCallback(() => {
    const video = videoRef.current;
    const segment = programSegments[previewSegmentIndex];
    if (!video || !segment) return;
    const localMs = video.currentTime * 1000 - segment.sourceStartMs;
    const globalMs = segment.startMs + Math.max(0, localMs);
    if (globalMs >= segment.endMs - 40 || video.ended) {
      const nextIndex = previewSegmentIndex + 1;
      if (nextIndex >= programSegments.length) {
        seekPreviewTo(0); // วนกลับไปต้นเส้นเวลา
      } else {
        previewSeekRef.current = programSegments[nextIndex].startMs;
        appliedSegmentRef.current = -1;
        setPreviewSegmentIndex(nextIndex);
        setPreviewTimeMs(programSegments[nextIndex].startMs);
      }
    } else {
      setPreviewTimeMs(globalMs);
    }
  }, [programSegments, previewSegmentIndex, seekPreviewTo]);

  // timeupdate เป็นตัวหลักเพราะยังทำงานตอนแท็บถูกซ่อน ส่วน rAF ใช้แค่ให้ playhead ลื่นตอนมองอยู่
  // ถ้าพึ่ง rAF อย่างเดียว ผู้ใช้สลับแท็บแล้วกลับมาจะเห็นซับค้างคนละที่กับเสียง
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasProgram) return;
    const onTimeUpdate = () => syncPreviewFromVideo();
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onTimeUpdate);
    };
  }, [hasProgram, syncPreviewFromVideo]);

  useEffect(() => {
    if (!isPlaying || !hasProgram) return;
    let frame = requestAnimationFrame(function tick() {
      syncPreviewFromVideo();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, hasProgram, syncPreviewFromVideo]);

  // แถบจังหวะพูด: สูง = ช่วงที่มีเสียงพูด, เตี้ย = ช่องว่างระหว่างท่อน
  // สร้างจาก cue จริง ไม่ใช่ตัวเลขสุ่มเหมือนเดิม
  const speechBars = useMemo(() => {
    const BARS = 40;
    if (!captionCues.length || previewTotalMs <= 0) return Array.from({ length: BARS }, () => 0);
    return Array.from({ length: BARS }, (_, index) => {
      const from = (index / BARS) * previewTotalMs;
      const to = ((index + 1) / BARS) * previewTotalMs;
      const covered = captionCues.reduce((sum, cue) => sum + Math.max(0, Math.min(cue.endMs, to) - Math.max(cue.startMs, from)), 0);
      return Math.min(1, covered / Math.max(1, to - from));
    });
  }, [captionCues, previewTotalMs]);

  const previewProgressRatio = previewTotalMs > 0 ? Math.min(1, previewTimeMs / previewTotalMs) : 0;

  const renderStage = useMemo(() => {
    // ข้อความจริงมาจากเซิร์ฟเวอร์ผ่าน SSE — ข้างล่างเป็นข้อความสำรองตอนยังไม่ต่อ Local เท่านั้น
    // จึงต้องไม่อ้างตัวเลขที่เราไม่รู้จริง เช่น "ท่อนที่ 5 จาก 12"
    if (operationMessage) return operationMessage;
    if (renderProgress < 20) return "กำลังเตรียมคลิปและจับจังหวะภาพ";
    if (renderProgress < 52) return "กำลังพากย์เสียงทีละท่อน";
    if (renderProgress < 78) return "กำลังวางซับให้ตรงกับเสียง";
    if (renderProgress < 96) return "กำลังรวมภาพ เสียง และซับ";
    return "กำลังตรวจไฟล์รอบสุดท้าย";
  }, [operationMessage, renderProgress]);

  function applyProject(project: { id: string; title: string; wizard_step?: number; product?: Record<string, unknown>; renders?: LocalRender[] }) {
    setProjectId(project.id);
    const product = project.product ?? {};
    const savedBrief = (product.brief ?? product) as Partial<ProductBrief>;
    setBrief((current) => ({
      ...current,
      ...savedBrief,
      features: Array.isArray(savedBrief.features) ? savedBrief.features.join(", ") : savedBrief.features ?? current.features,
    }));
    const legacyAsset = product.asset as Partial<LocalProjectAsset> | undefined;
    const savedAssets = Array.isArray(product.assets) && product.assets.length
      ? product.assets as Partial<LocalProjectAsset>[]
      : legacyAsset?.name ? [legacyAsset] : [];
    const restoredAssets = savedAssets
      .filter((asset): asset is Partial<LocalProjectAsset> & { name: string } => typeof asset.name === "string" && Boolean(asset.name))
      .slice(0, MAX_CLIPS)
      .map((asset, index): WizardAsset => {
        const durationKnown = typeof asset.durationMs === "number" && asset.durationMs > 0;
        const durationMs = durationKnown ? asset.durationMs as number : 60_000;
        const selectedDurationSec = typeof asset.selectedDurationSec === "number" && asset.selectedDurationSec > 0
          ? Math.min(asset.selectedDurationSec, durationMs / 1000)
          : Math.min(durationMs / 1000, 8);
        return {
          name: asset.name,
          originalName: asset.originalName || asset.name,
          url: asset.url || `/api/assets/${encodeURIComponent(asset.name)}`,
          size: typeof asset.size === "number" ? asset.size : 0,
          durationMs,
          selectedDurationSec,
          order: typeof asset.order === "number" ? asset.order : index,
          ...(typeof asset.width === "number" ? { width: asset.width } : {}),
          ...(typeof asset.height === "number" ? { height: asset.height } : {}),
          clientId: `saved-${index}-${asset.name}`,
          durationKnown,
        };
      })
      .sort((a, b) => a.order - b.order)
      .map((asset, order) => ({ ...asset, order }));
    if (restoredAssets.length) {
      const first = restoredAssets[0];
      setClipAssets(restoredAssets);
      setActiveClipId(first.clientId);
      setAssetName(first.name);
      setFileName(first.originalName || first.name);
      setVideoUrl(first.url);
    }
    const hasSavedTimeline = Array.isArray(product.timelineClips);
    const savedTimeline = hasSavedTimeline
      ? product.timelineClips as Partial<LocalTimelineClip>[]
      : [];
    const restoredTimeline = savedTimeline
      .filter((clip): clip is Partial<LocalTimelineClip> & { assetName: string } =>
        typeof clip.assetName === "string" && restoredAssets.some((asset) => asset.name === clip.assetName))
      .slice(0, MAX_TIMELINE_CLIPS)
      .map((clip, index): LocalTimelineClip => {
        const asset = restoredAssets.find((item) => item.name === clip.assetName)!;
        const trimStartMs = Math.max(0, Number(clip.trimStartMs) || 0);
        const requestedEndMs = Number(clip.trimEndMs) || Math.min(asset.durationMs, trimStartMs + 8_000);
        if (!asset.durationKnown && requestedEndMs > asset.durationMs) asset.durationMs = requestedEndMs;
        return {
          id: typeof clip.id === "string" && clip.id ? clip.id : makeTimelineId(),
          assetName: clip.assetName,
          order: typeof clip.order === "number" ? clip.order : index,
          trimStartMs,
          trimEndMs: Math.max(trimStartMs + 100, Math.min(asset.durationMs, requestedEndMs)),
        };
      });
    const initialTimeline = persistedTimeline(hasSavedTimeline
      ? restoredTimeline
      : restoredAssets.map((asset, index) => ({
          id: makeTimelineId(),
          assetName: asset.name,
          order: index,
          trimStartMs: 0,
          trimEndMs: Math.min(asset.durationMs, Math.max(100, asset.selectedDurationSec * 1000)),
        })));
    setTimelineClips(initialTimeline);
    setSelectedTimelineClipId(initialTimeline[0]?.id ?? null);
    skipNextTimelineAutosaveRef.current = true;
    projectReadyForAutosaveRef.current = true;
    const savedScripts = product.scripts as LocalScript[] | undefined;
    if (savedScripts?.length) {
      setScriptVariants(savedScripts);
      setSelectedScript(savedScripts[0].id);
      setScriptTexts(Object.fromEntries(savedScripts.map((script) => [script.id, [...script.chunks]])));
    }
    const config = (product.config ?? {}) as Record<string, unknown>;
    if (typeof config.voiceId === "string") setSelectedVoice(config.voiceId);
    if (typeof config.styleId === "string") setSelectedStyle(config.styleId);
    if (typeof config.position === "string") setCaptionPosition(config.position === "top" ? "บน" : config.position === "middle" || config.position === "center" ? "กลาง" : config.position === "bottom" ? "ล่าง" : config.position);
    if (typeof config.speed === "number") setSpeed(config.speed);
    setActiveStep(Math.max(1, Math.min(5, Number(project.wizard_step ?? 1))) as WizardStep);
    const latest = project.renders?.find((render) => !render.stale);
    if (latest) restoreRender(latest);
  }

  function chooseVideoOutput(outputs: Record<string, LocalOutput> | null | undefined) {
    if (!outputs) return null;
    const preferred = outputs.final ?? outputs.video ?? outputs.mp4;
    return preferred?.url ?? Object.values(outputs).find((output) => output.filename?.toLowerCase().endsWith(".mp4"))?.url ?? null;
  }

  async function completeRender(
    id: string,
    kind: "draft" | "final",
    expectedEditRevision?: number,
  ) {
    try {
      const result = await localApi.getRender(id);
      if (expectedEditRevision != null && expectedEditRevision !== editRevisionRef.current) return;
      const record = result.render;
      setRenderOutputs(record.outputs ?? {});
      const outputUrl = chooseVideoOutput(record.outputs);
      if (outputUrl) setVideoUrl(outputUrl);
      setRendering(false);
      setRenderProgress(100);
      if (kind === "draft") {
        setDraftReady(true);
        setToast("ร่างพร้อมแล้ว กดสร้างคลิปตัวจริงได้โดยไม่ยิงเสียงซ้ำ");
      } else {
        setRenderDone(true);
        setToast("คลิปตัวจริงพร้อมดาวน์โหลดแล้ว");
      }
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "อ่านผลลัพธ์ไม่สำเร็จ");
      setRendering(false);
    }
  }

  function observeRender(
    id: string,
    kind: "draft" | "final",
    expectedEditRevision?: number,
  ) {
    stopWatchingRenderRef.current?.();
    stopWatchingRenderRef.current = watchRender(id, (event) => {
      if (expectedEditRevision != null && expectedEditRevision !== editRevisionRef.current) return;
      setRenderProgress(Number(event.progress ?? 0));
      setOperationMessage(event.message || "กำลังประมวลผล");
      if (event.state === "ready") void completeRender(id, kind, expectedEditRevision);
      else if (event.state === "failed") {
        setRendering(false);
        setRenderError(event.error?.message || "สร้างคลิปไม่สำเร็จ กรุณาตรวจ FFmpeg และ API key แล้วลองใหม่");
      } else if (event.state === "canceled") {
        setRendering(false);
        setRenderProgress(0);
        setOperationMessage("");
      }
    }, () => {
      window.setTimeout(async () => {
        if (expectedEditRevision != null && expectedEditRevision !== editRevisionRef.current) return;
        try {
          const result = await localApi.getRender(id);
          if (result.render.state === "ready") await completeRender(id, kind, expectedEditRevision);
          else if (result.render.state === "failed") {
            setRendering(false);
            setRenderError(result.render.error?.message || "สร้างคลิปไม่สำเร็จ");
          }
        } catch {
          setRenderError("อ่านสถานะงานไม่สำเร็จ กรุณารีเฟรชหน้านี้อีกครั้ง");
        }
      }, 900);
    });
  }

  function restoreRender(render: LocalRender) {
    setRenderId(render.id);
    setRenderKind(render.kind);
    setRenderProgress(Number(render.progress ?? 0));
    setOperationMessage(render.message || "");
    if (render.state === "ready") {
      const revision = editRevisionRef.current;
      activeRenderEditRevisionRef.current = revision;
      void completeRender(render.id, render.kind, revision);
    } else if (["queued", "running", "ingesting", "processing", "retrying"].includes(render.state)) {
      setActiveStep(5);
      setRendering(true);
      const revision = editRevisionRef.current;
      activeRenderEditRevisionRef.current = revision;
      observeRender(render.id, render.kind, revision);
    } else if (render.state === "failed") setRenderError(render.error?.message || "งานครั้งล่าสุดไม่สำเร็จ");
  }

  useEffect(() => {
    if (routeId) return;
    const requestedStyle = new URLSearchParams(window.location.search).get("style");
    if (!requestedStyle || !captionStyles.some((style) => style.id === requestedStyle)) return;
    const timer = window.setTimeout(() => setSelectedStyle(requestedStyle), 0);
    return () => window.clearTimeout(timer);
  }, [routeId]);

  useEffect(() => {
    let active = true;
    const objectUrls = objectUrlsRef.current;
    detectLocalEngine().then(async (engine) => {
      if (!active) return;
      if (!engine) {
        setEngineState("unavailable");
        return;
      }
      setEngineState("connected");
      try {
        const voiceResult = await localApi.voices();
        const geminiVoices = voiceResult.voices.filter((voice) => !voice.provider || voice.provider === "gemini");
        if (active && geminiVoices.length) {
          const colors = ["#ffd6a6", "#d9d4ff", "#c9eddc", "#ffd8df", "#cde5f5", "#f2e4b8"];
          setVoiceLibrary(geminiVoices.map((voice: LocalVoice, index) => ({
            id: voice.id,
            name: voice.name || voice.id,
            gender: voice.gender || "Gemini",
            tone: voice.tone || voice.label || "เป็นธรรมชาติ",
            color: voice.color || colors[index % colors.length],
            initials: voice.initials || (voice.name || voice.id).slice(0, 1),
            provider: voice.provider || "gemini",
          })));
        }
        if (routeId) {
          const result = await localApi.getProject(routeId);
          if (active) applyProject(result.project);
        }
      } catch (error) {
        if (active) setUploadError(error instanceof Error ? error.message : "โหลดข้อมูลโปรเจกต์ไม่สำเร็จ");
      }
    });
    return () => {
      active = false;
      stopWatchingRenderRef.current?.();
      previewAudioRef.current?.pause();
      pendingUploadFilesRef.current = [];
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
    // routeId is stable for the lifetime of this editor; replacing the address should not reset in-flight state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rendering || engineState === "connected") return;
    const timer = window.setInterval(() => {
      setRenderProgress((current) => {
        const next = Math.min(100, current + (current < 70 ? 3 : 2));
        if (next >= 100) {
          window.clearInterval(timer);
          setRendering(false);
          setRenderDone(true);
        }
        return next;
      });
    }, 170);
    return () => window.clearInterval(timer);
  }, [engineState, rendering]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast("");
      setRecentlyDeletedClip(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [toast, recentlyDeletedClip]);

  const briefForApi = () => ({
    ...brief,
    features: brief.features.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
  });

  const projectProduct = (extra: Record<string, unknown> = {}) => {
    const savedTimeline = persistedTimeline(timelineClips);
    const savedAssets = persistedAssets(clipAssets, savedTimeline);
    const legacyAsset = savedAssets.find((asset) => asset.name === savedTimeline[0]?.assetName) ?? savedAssets[0];
    return {
      brief: briefForApi(),
      assets: savedAssets,
      timelineClips: savedTimeline,
      ...(legacyAsset ? { asset: legacyAsset } : {}),
      scripts: scriptVariants.map((script) => ({ ...script, chunks: scriptTexts[script.id] ?? script.chunks })),
      config: { voiceId: selectedVoice, provider: selectedVoiceData.provider || "gemini", speed, tone, styleId: selectedStyle, position: captionPosition },
      ...extra,
    };
  };

  const queueProjectUpdate = (id: string, body: Record<string, unknown>) => {
    const task = projectSaveChainRef.current
      .catch(() => undefined)
      .then(() => localApi.updateProject(id, body));
    projectSaveChainRef.current = task.then(() => undefined, () => undefined);
    return task;
  };

  const ensureProject = async (
    productOverride?: Record<string, unknown>,
    titleOverride?: string,
  ) => {
    if (projectId) return projectId;
    const result = await localApi.createProject({
      title: titleOverride || brief.name || fileName || "โปรเจกต์ใหม่",
      product: productOverride ?? projectProduct(),
    });
    setProjectId(result.project.id);
    projectReadyForAutosaveRef.current = true;
    window.history.replaceState(null, "", `/p/${encodeURIComponent(result.project.id)}`);
    return result.project.id;
  };

  useEffect(() => {
    if (engineState !== "connected" || !projectId || !projectReadyForAutosaveRef.current) return;
    if (skipNextTimelineAutosaveRef.current) {
      skipNextTimelineAutosaveRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void queueProjectUpdate(projectId, {
        product: projectProduct(),
      }).catch((error) => setUploadError(error instanceof Error ? error.message : "บันทึก Timeline อัตโนมัติไม่สำเร็จ"));
    }, 450);
    return () => window.clearTimeout(timer);
    // Autosave is intentionally scoped to edits that change clip sources, trims, splits, or ordering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipAssets, timelineClips, projectId, engineState]);

  const saveProject = async (message = "บันทึกโปรเจกต์และ Timeline แล้ว") => {
    if (engineState !== "connected") {
      setToast("โหมดตัวอย่าง: Timeline อยู่เฉพาะในหน้านี้และไม่ได้อัปโหลดไฟล์ออกจากเครื่อง");
      return true;
    }
    try {
      const id = await ensureProject();
      await queueProjectUpdate(id, {
        title: brief.name || fileName || "โปรเจกต์ใหม่",
        wizardStep: activeStep,
        product: projectProduct(),
      });
      setToast(message);
      return true;
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "บันทึกโปรเจกต์ไม่สำเร็จ");
      return false;
    }
  };

  const invalidateRenderedDraft = () => {
    editRevisionRef.current += 1;
    activeRenderEditRevisionRef.current = null;
    stopWatchingRenderRef.current?.();
    stopWatchingRenderRef.current = null;
    if (rendering && renderId && engineState === "connected") {
      void localApi.cancelRender(renderId).catch(() => undefined);
    }
    setDraftReady(false);
    setRenderDone(false);
    setRenderOutputs({});
    setRendering(false);
    setRenderId(null);
    setRenderProgress(0);
    setOperationMessage("");
  };

  const selectFiles = async (
    incoming?: FileList | File[],
    resolvedEngineState: LocalEngineState = engineState,
  ) => {
    const files = Array.from(incoming ?? []);
    if (!files.length) {
      setUploadError("ไม่พบไฟล์วิดีโอจากรายการที่ลากมา หากลากจากหน้าต่างดาวน์โหลดของ Chrome ให้เปิดโฟลเดอร์ดาวน์โหลดแล้วลากจาก File Explorer หรือกดเลือกไฟล์จากเครื่อง");
      return;
    }
    if (uploadLockRef.current || analyzing) {
      setUploadError("กำลังเพิ่มคลิปชุดก่อนหน้า กรุณารอให้เสร็จก่อนเพิ่มคลิปอีกครั้ง");
      return;
    }
    setUploadError("");
    if (resolvedEngineState === "checking") {
      const queuedFiles = [...pendingUploadFilesRef.current, ...files].filter((file, index, all) => (
        index === all.findIndex((candidate) => (
          candidate.name === file.name
          && candidate.size === file.size
          && candidate.lastModified === file.lastModified
        ))
      ));
      pendingUploadFilesRef.current = queuedFiles;
      setUploadError(`รับคลิป ${queuedFiles.length} ไฟล์แล้ว กำลังตรวจการเชื่อมต่อ ClipPang Local และจะเริ่มเพิ่มคลิปให้อัตโนมัติ`);
      return;
    }
    if (resolvedEngineState !== "connected" && resolvedEngineState !== "unavailable") {
      setUploadError("ยังไม่พร้อมรับคลิป กรุณารีเฟรชหน้าแล้วลองใหม่");
      return;
    }
    if (clipAssets.length + files.length > MAX_CLIPS) {
      setUploadError(`อัปโหลดได้สูงสุด ${MAX_CLIPS} คลิปต่อโปรเจกต์ (ตอนนี้มี ${clipAssets.length} คลิป)`);
      return;
    }
    if (timelineClips.length + files.length > MAX_TIMELINE_CLIPS) {
      setUploadError(`Timeline รองรับได้สูงสุด ${MAX_TIMELINE_CLIPS} ช่วง (ตอนนี้มี ${timelineClips.length} ช่วง)`);
      return;
    }
    const invalidType = files.find((file) => !file.type.startsWith("video/") && !/\.(mp4|mov|webm)$/i.test(file.name));
    if (invalidType) {
      setUploadError(`${invalidType.name} ไม่ใช่วิดีโอ รองรับเฉพาะ MP4, MOV หรือ WebM`);
      return;
    }
    const oversized = files.find((file) => file.size > 500 * 1024 * 1024);
    if (oversized) {
      setUploadError(`${oversized.name} ใหญ่เกิน 500 MB กรุณาบีบอัดหรือตัดให้สั้นลงก่อน`);
      return;
    }
    uploadLockRef.current = true;
    setAnalyzing(true);
    setUploadProgress(0);
    const newObjectUrls: string[] = [];
    let assetsCommitted = false;
    try {
      setOperationMessage(`กำลังอ่านความยาว ${files.length} คลิป…`);
      const metadataResults = await Promise.allSettled(files.map(async (file) => {
        const previewUrl = URL.createObjectURL(file);
        newObjectUrls.push(previewUrl);
        objectUrlsRef.current.add(previewUrl);
        const durationMs = await browserVideoDuration(file, previewUrl);
        return { file, previewUrl, durationMs };
      }));
      const batchErrors: string[] = [];
      const prepared = metadataResults.flatMap((result, index) => {
        if (result.status === "fulfilled") return [result.value];
        batchErrors.push(`${files[index].name}: อ่านความยาวไม่ได้`);
        const failedUrl = newObjectUrls[index];
        if (failedUrl) {
          URL.revokeObjectURL(failedUrl);
          objectUrlsRef.current.delete(failedUrl);
        }
        return [];
      });
      if (!prepared.length) throw new Error(batchErrors.join(" · ") || "ไม่พบคลิปที่เปิดอ่านได้");

      let successfulUploads: { prepared: typeof prepared[number]; uploaded: LocalAsset }[];
      if (resolvedEngineState === "connected") {
        setOperationMessage(`กำลังอัปโหลด ${prepared.length} คลิปไว้ในเครื่อง…`);
        const result = await localApi.uploadAssets(prepared.map((item) => item.file), (progress, current, total) => {
          setUploadProgress(progress);
          setOperationMessage(`กำลังอัปโหลดคลิป ${current} จาก ${total}…`);
        });
        successfulUploads = result.results.flatMap((uploadResult, index) => {
          if (uploadResult.asset) return [{ prepared: prepared[index], uploaded: uploadResult.asset }];
          batchErrors.push(`${uploadResult.fileName}: ${uploadResult.error || "อัปโหลดไม่สำเร็จ"}`);
          const previewUrl = prepared[index].previewUrl;
          URL.revokeObjectURL(previewUrl);
          objectUrlsRef.current.delete(previewUrl);
          return [];
        });
      } else {
        successfulUploads = prepared.map((item, index) => ({
          prepared: item,
          uploaded: {
            name: `demo-${Date.now()}-${index}-${item.file.name}`,
            originalName: item.file.name,
            size: item.file.size,
            url: item.previewUrl,
            durationMs: item.durationMs,
          },
        }));
      }
      if (!successfulUploads.length) throw new Error(batchErrors.join(" · ") || "อัปโหลดคลิปไม่สำเร็จ");

      const nextAssets = [...orderedClipAssets];
      const newlyAdded: WizardAsset[] = [];
      successfulUploads.forEach(({ prepared: { file, previewUrl, durationMs: browserDurationMs }, uploaded }) => {
        const durationMs = typeof uploaded.durationMs === "number" && uploaded.durationMs > 0
          ? uploaded.durationMs
          : browserDurationMs;
        const existingIndex = nextAssets.findIndex((asset) => asset.name === uploaded.name);
        const nextAsset: WizardAsset = {
          ...uploaded,
          originalName: uploaded.originalName || file.name,
          durationMs,
          selectedDurationSec: Math.min(durationMs / 1000, 8),
          order: existingIndex >= 0 ? nextAssets[existingIndex].order : nextAssets.length,
          clientId: existingIndex >= 0 ? nextAssets[existingIndex].clientId : makeTimelineId(),
          previewUrl,
          durationKnown: true,
        };
        if (existingIndex >= 0) {
          const oldPreview = nextAssets[existingIndex].previewUrl;
          if (oldPreview && oldPreview !== previewUrl && objectUrlsRef.current.has(oldPreview)) {
            URL.revokeObjectURL(oldPreview);
            objectUrlsRef.current.delete(oldPreview);
          }
          nextAssets[existingIndex] = nextAsset;
        } else {
          nextAssets.push(nextAsset);
        }
        newlyAdded.push(nextAsset);
      });
      const normalizedAssets = nextAssets.map((asset, order) => ({ ...asset, order }));
      const newTimelineClips = newlyAdded.map((asset, index): LocalTimelineClip => ({
        id: makeTimelineId(),
        assetName: asset.name,
        order: orderedTimelineClips.length + index,
        trimStartMs: 0,
        trimEndMs: Math.min(asset.durationMs, 8_000),
      }));
      const nextTimeline = persistedTimeline([...orderedTimelineClips, ...newTimelineClips]);
      const firstNew = newlyAdded[0];
      invalidateRenderedDraft();
      setClipAssets(normalizedAssets);
      setTimelineClips(nextTimeline);
      setActiveClipId(firstNew.clientId);
      setSelectedTimelineClipId(newTimelineClips[0]?.id ?? nextTimeline[0]?.id ?? null);
      setAssetName(normalizedAssets[0]?.name ?? null);
      setFileName(firstNew.originalName || firstNew.name);
      setVideoUrl(firstNew.previewUrl || firstNew.url);
      setTimelinePlayheadMs(orderedTimelineClips.reduce((sum, clip) => sum + clip.trimEndMs - clip.trimStartMs, 0));
      setTimelineEditorOpen(true);
      assetsCommitted = true;

      if (resolvedEngineState === "connected") {
        const savedAssets = persistedAssets(normalizedAssets, nextTimeline);
        const nextProduct = projectProduct({
          assets: savedAssets,
          asset: savedAssets[0],
          timelineClips: nextTimeline,
        });
        const nextTitle = brief.name || pathlessName(firstNew.originalName || firstNew.name);
        const id = await ensureProject(nextProduct, nextTitle);
        await queueProjectUpdate(id, {
          title: nextTitle,
          wizardStep: 1,
          product: nextProduct,
        });
      }
      setUploadProgress(100);
      setUploadError(batchErrors.length ? `เพิ่มบางไฟล์ไม่สำเร็จ: ${batchErrors.join(" · ")}` : "");
      setToast(`เพิ่ม ${newlyAdded.length} คลิปแล้ว จัดลำดับและตัดความยาวบน Timeline ได้เลย`);
    } catch (error) {
      if (!assetsCommitted) {
        for (const url of newObjectUrls) {
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(url);
        }
      }
      setUploadError(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      uploadLockRef.current = false;
      setOperationMessage("");
      setAnalyzing(false);
    }
  };

  const pathlessName = (name: string) => name.replace(/\.[^.]+$/, "").slice(0, 120);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void selectFiles(event.target.files ?? undefined);
    event.target.value = "";
  };
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (Array.from(event.dataTransfer.types).includes("Files")) event.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const fileList = Array.from(event.dataTransfer.files);
    const itemFiles = fileList.length
      ? []
      : Array.from(event.dataTransfer.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
    void selectFiles(fileList.length ? fileList : itemFiles);
  };

  useEffect(() => {
    if (engineState === "checking" || pendingUploadFilesRef.current.length === 0) return;
    const queuedFiles = pendingUploadFilesRef.current;
    pendingUploadFilesRef.current = [];
    void selectFiles(queuedFiles, engineState);
    // Process each queued batch exactly once when the Local availability check settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState]);

  const timelineClipStartMs = (clipId: string) => {
    let elapsed = 0;
    for (const clip of orderedTimelineClips) {
      if (clip.id === clipId) return elapsed;
      elapsed += Math.max(0, clip.trimEndMs - clip.trimStartMs);
    }
    return elapsed;
  };

  const playTimelineVideo = (video: HTMLVideoElement) => {
    const revision = timelinePlaybackRevisionRef.current;
    void video.play().catch(() => {
      if (timelinePlaybackRevisionRef.current === revision) setTimelinePlaying(false);
    });
  };

  const seekTimeline = (requestedMs: number, autoplay = false) => {
    if (!orderedTimelineClips.length) return;
    timelinePlaybackRevisionRef.current += 1;
    const targetMs = Math.max(0, Math.min(timelineTotalMs, requestedMs));
    let elapsed = 0;
    let targetClip = orderedTimelineClips[orderedTimelineClips.length - 1];
    let localMs = targetClip.trimEndMs;
    for (const clip of orderedTimelineClips) {
      const duration = Math.max(0, clip.trimEndMs - clip.trimStartMs);
      if (targetMs < elapsed + duration || (targetMs === 0 && elapsed === 0)) {
        targetClip = clip;
        localMs = clip.trimStartMs + Math.max(0, targetMs - elapsed);
        break;
      }
      elapsed += duration;
    }
    const asset = orderedClipAssets.find((item) => item.name === targetClip.assetName);
    pendingTimelineSeekRef.current = localMs;
    setTimelinePlayheadMs(targetMs);
    setSelectedTimelineClipId(targetClip.id);
    if (asset) {
      setActiveClipId(asset.clientId);
      setFileName(asset.originalName || asset.name);
    }
    setTimelinePlaying(autoplay);
    const video = timelineVideoRef.current;
    if (video && selectedTimelineClip?.id === targetClip.id && video.readyState >= 1) {
      video.currentTime = localMs / 1000;
      pendingTimelineSeekRef.current = null;
      if (autoplay) playTimelineVideo(video);
    }
  };

  useEffect(() => {
    if (!timelineEditorOpen || !selectedTimelineClip) return;
    const video = timelineVideoRef.current;
    if (!video || video.readyState < 1) return;
    const targetMs = pendingTimelineSeekRef.current ?? selectedTimelineClip.trimStartMs;
    video.currentTime = Math.max(selectedTimelineClip.trimStartMs, Math.min(selectedTimelineClip.trimEndMs, targetMs)) / 1000;
    pendingTimelineSeekRef.current = null;
    if (timelinePlaying) playTimelineVideo(video);
    // The selected segment controls the source and local seek position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTimelineClipId, timelinePreviewUrl, timelineEditorOpen]);

  useEffect(() => {
    const video = timelineVideoRef.current;
    if (!video) return;
    if (timelinePlaying) playTimelineVideo(video);
    else {
      timelinePlaybackRevisionRef.current += 1;
      video.pause();
    }
  }, [timelinePlaying]);

  const reconcileAssetDuration = (assetNameToUpdate: string, actualDurationMs: number) => {
    if (!Number.isFinite(actualDurationMs) || actualDurationMs <= 0) return;
    setClipAssets((current) => current.map((asset) => asset.name === assetNameToUpdate
      ? { ...asset, durationMs: actualDurationMs, durationKnown: true, selectedDurationSec: Math.min(asset.selectedDurationSec, actualDurationMs / 1000) }
      : asset));
    setTimelineClips((current) => current.map((clip) => {
      if (clip.assetName !== assetNameToUpdate) return clip;
      const trimStartMs = Math.min(clip.trimStartMs, Math.max(0, actualDurationMs - 100));
      return { ...clip, trimStartMs, trimEndMs: Math.max(trimStartMs + 100, Math.min(clip.trimEndMs, actualDurationMs)) };
    }));
  };

  const handleTimelineLoadedMetadata = () => {
    const video = timelineVideoRef.current;
    if (!video || !selectedTimelineClip || !selectedTimelineAsset) return;
    const actualDurationMs = Math.round(video.duration * 1000);
    if (Number.isFinite(actualDurationMs) && actualDurationMs > 0 && (!selectedTimelineAsset.durationKnown || Math.abs(selectedTimelineAsset.durationMs - actualDurationMs) > 500)) {
      reconcileAssetDuration(selectedTimelineAsset.name, actualDurationMs);
    }
    const targetMs = pendingTimelineSeekRef.current ?? selectedTimelineClip.trimStartMs;
    video.currentTime = Math.max(selectedTimelineClip.trimStartMs, Math.min(selectedTimelineClip.trimEndMs, targetMs)) / 1000;
    pendingTimelineSeekRef.current = null;
    if (timelinePlaying) playTimelineVideo(video);
  };

  const handleTimelineTimeUpdate = () => {
    const video = timelineVideoRef.current;
    if (!video || !selectedTimelineClip) return;
    const localMs = video.currentTime * 1000;
    const clipStart = timelineClipStartMs(selectedTimelineClip.id);
    const clipDuration = selectedTimelineClip.trimEndMs - selectedTimelineClip.trimStartMs;
    setTimelinePlayheadMs(Math.min(timelineTotalMs, clipStart + Math.max(0, Math.min(clipDuration, localMs - selectedTimelineClip.trimStartMs))));
    if (localMs < selectedTimelineClip.trimEndMs - 35) return;
    video.pause();
    const currentIndex = orderedTimelineClips.findIndex((clip) => clip.id === selectedTimelineClip.id);
    const nextClip = orderedTimelineClips[currentIndex + 1];
    if (timelinePlaying && nextClip) seekTimeline(clipStart + clipDuration, true);
    else {
      setTimelinePlaying(false);
      setTimelinePlayheadMs(nextClip ? clipStart + clipDuration : timelineTotalMs);
    }
  };

  const selectTimelineClip = (clip: LocalTimelineClip) => {
    timelineVideoRef.current?.pause();
    setTimelinePlaying(false);
    pendingTimelineSeekRef.current = clip.trimStartMs;
    setSelectedTimelineClipId(clip.id);
    setTimelinePlayheadMs(timelineClipStartMs(clip.id));
    const asset = orderedClipAssets.find((item) => item.name === clip.assetName);
    if (asset) {
      setActiveClipId(asset.clientId);
      setFileName(asset.originalName || asset.name);
    }
  };

  const updateTimelineTrim = (clipId: string, edge: "start" | "end", seconds: number) => {
    const clip = orderedTimelineClips.find((item) => item.id === clipId);
    if (!clip) return;
    const asset = orderedClipAssets.find((item) => item.name === clip.assetName);
    if (!asset) return;
    const requestedMs = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
    const nextClip = edge === "start"
      ? { ...clip, trimStartMs: Math.max(0, Math.min(clip.trimEndMs - 100, requestedMs)) }
      : { ...clip, trimEndMs: Math.min(asset.durationMs, Math.max(clip.trimStartMs + 100, requestedMs)) };
    invalidateRenderedDraft();
    setTimelinePlaying(false);
    timelineVideoRef.current?.pause();
    setTimelineClips((current) => current.map((item) => item.id === clipId ? nextClip : item));
    if (selectedTimelineClip?.id === clipId) {
      const clipStartMs = timelineClipStartMs(clipId);
      const currentSourceMs = clip.trimStartMs + Math.max(0, timelinePlayheadMs - clipStartMs);
      const clampedSourceMs = Math.max(nextClip.trimStartMs, Math.min(nextClip.trimEndMs, currentSourceMs));
      const nextPlayheadMs = clipStartMs + clampedSourceMs - nextClip.trimStartMs;
      pendingTimelineSeekRef.current = clampedSourceMs;
      setTimelinePlayheadMs(nextPlayheadMs);
      if (timelineVideoRef.current?.readyState) timelineVideoRef.current.currentTime = clampedSourceMs / 1000;
    }
  };

  const moveTimelineClip = (clipId: string, nextIndex: number) => {
    const currentIndex = orderedTimelineClips.findIndex((clip) => clip.id === clipId);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedTimelineClips.length || currentIndex === nextIndex) return;
    const selectedBefore = selectedTimelineClip;
    const selectedStartBefore = selectedBefore ? timelineClipStartMs(selectedBefore.id) : 0;
    const selectedDuration = selectedBefore ? Math.max(0, selectedBefore.trimEndMs - selectedBefore.trimStartMs) : 0;
    const selectedLocalOffset = Math.max(0, Math.min(selectedDuration, timelinePlayheadMs - selectedStartBefore));
    const next = [...orderedTimelineClips];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(nextIndex, 0, moved);
    const normalized = next.map((clip, order) => ({ ...clip, order }));
    const nextSelectedIndex = selectedBefore ? normalized.findIndex((clip) => clip.id === selectedBefore.id) : -1;
    const nextSelectedStart = nextSelectedIndex > 0
      ? normalized.slice(0, nextSelectedIndex).reduce((sum, clip) => sum + clip.trimEndMs - clip.trimStartMs, 0)
      : 0;
    invalidateRenderedDraft();
    setTimelinePlaying(false);
    timelineVideoRef.current?.pause();
    setTimelineClips(normalized);
    setTimelinePlayheadMs(nextSelectedStart + selectedLocalOffset);
    if (selectedBefore) pendingTimelineSeekRef.current = selectedBefore.trimStartMs + selectedLocalOffset;
  };

  const dropTimelineClip = (targetId: string) => {
    if (!draggingClipId || draggingClipId === targetId) return;
    const targetIndex = orderedTimelineClips.findIndex((clip) => clip.id === targetId);
    moveTimelineClip(draggingClipId, targetIndex);
    setDraggingClipId(null);
  };

  const splitTimelineClip = () => {
    if (!selectedTimelineClip) return;
    if (orderedTimelineClips.length >= MAX_TIMELINE_CLIPS) {
      setUploadError(`Timeline รองรับได้สูงสุด ${MAX_TIMELINE_CLIPS} ช่วงคลิป`);
      return;
    }
    const clipStart = timelineClipStartMs(selectedTimelineClip.id);
    const splitAtMs = selectedTimelineClip.trimStartMs + (timelinePlayheadMs - clipStart);
    if (splitAtMs <= selectedTimelineClip.trimStartMs + 99 || splitAtMs >= selectedTimelineClip.trimEndMs - 99) {
      setUploadError("เลื่อนจุดเล่นให้อยู่ด้านในคลิปอย่างน้อย 0.1 วินาที แล้วจึงกดแยกคลิป");
      return;
    }
    const secondId = makeTimelineId();
    invalidateRenderedDraft();
    const next: LocalTimelineClip[] = [];
    for (const clip of orderedTimelineClips) {
      if (clip.id !== selectedTimelineClip.id) next.push(clip);
      else {
        next.push({ ...clip, trimEndMs: Math.round(splitAtMs) });
        next.push({ ...clip, id: secondId, trimStartMs: Math.round(splitAtMs) });
      }
    }
    setTimelinePlaying(false);
    timelineVideoRef.current?.pause();
    setTimelineClips(next.map((clip, order) => ({ ...clip, order })));
    setSelectedTimelineClipId(secondId);
    pendingTimelineSeekRef.current = splitAtMs;
    setUploadError("");
    setToast("แยกคลิปตรงจุดเล่นแล้ว");
  };

  const deleteTimelineClip = (clipId: string) => {
    const index = orderedTimelineClips.findIndex((clip) => clip.id === clipId);
    if (index < 0) return;
    const removedClip = orderedTimelineClips[index];
    const removedAsset = orderedClipAssets.find((asset) => asset.name === removedClip.assetName);
    const selectedBefore = selectedTimelineClip;
    const selectedStartBefore = selectedBefore ? timelineClipStartMs(selectedBefore.id) : 0;
    const selectedDuration = selectedBefore ? Math.max(0, selectedBefore.trimEndMs - selectedBefore.trimStartMs) : 0;
    const selectedLocalOffset = Math.max(0, Math.min(selectedDuration, timelinePlayheadMs - selectedStartBefore));
    invalidateRenderedDraft();
    const next = orderedTimelineClips.filter((clip) => clip.id !== clipId).map((clip, order) => ({ ...clip, order }));
    const wasSelected = selectedBefore?.id === clipId;
    const nextSelected = wasSelected
      ? next[Math.min(index, next.length - 1)] ?? null
      : next.find((clip) => clip.id === selectedBefore?.id) ?? next[0] ?? null;
    const nextSelectedIndex = nextSelected ? next.findIndex((clip) => clip.id === nextSelected.id) : -1;
    const nextSelectedStart = nextSelectedIndex > 0
      ? next.slice(0, nextSelectedIndex).reduce((sum, clip) => sum + clip.trimEndMs - clip.trimStartMs, 0)
      : 0;
    const nextLocalOffset = wasSelected
      ? 0
      : Math.max(0, Math.min(nextSelected ? nextSelected.trimEndMs - nextSelected.trimStartMs : 0, selectedLocalOffset));
    setTimelinePlaying(false);
    timelineVideoRef.current?.pause();
    setTimelineClips(next);
    setSelectedTimelineClipId(nextSelected?.id ?? null);
    setTimelinePlayheadMs(nextSelected ? nextSelectedStart + nextLocalOffset : 0);
    if (nextSelected) pendingTimelineSeekRef.current = nextSelected.trimStartMs + nextLocalOffset;
    const message = `ลบช่วง ${index + 1} · ${removedAsset?.originalName || removedAsset?.name || "คลิป"} แล้ว`;
    setRecentlyDeletedClip({ clip: removedClip, index, message });
    setToast(message);
  };

  const undoDeleteTimelineClip = () => {
    if (!recentlyDeletedClip) return;
    const { clip, index } = recentlyDeletedClip;
    const restored = [...orderedTimelineClips].filter((item) => item.id !== clip.id);
    restored.splice(Math.min(index, restored.length), 0, clip);
    const normalized = restored.map((item, order) => ({ ...item, order }));
    const restoredIndex = normalized.findIndex((item) => item.id === clip.id);
    const restoredStart = normalized.slice(0, restoredIndex).reduce((sum, item) => sum + item.trimEndMs - item.trimStartMs, 0);
    invalidateRenderedDraft();
    setTimelinePlaying(false);
    timelineVideoRef.current?.pause();
    setTimelineClips(normalized);
    setSelectedTimelineClipId(clip.id);
    setTimelinePlayheadMs(restoredStart);
    pendingTimelineSeekRef.current = clip.trimStartMs;
    setRecentlyDeletedClip(null);
    setToast("นำช่วงคลิปกลับเข้า Timeline แล้ว");
  };

  const addAssetToTimeline = (asset: WizardAsset) => {
    if (orderedTimelineClips.length >= MAX_TIMELINE_CLIPS) {
      setUploadError(`Timeline รองรับได้สูงสุด ${MAX_TIMELINE_CLIPS} ช่วงคลิป`);
      return;
    }
    const remainingMs = MAX_TOTAL_DURATION_SEC * 1000 - timelineTotalMs;
    if (remainingMs < 100) {
      setUploadError("Timeline เต็ม 60 วินาทีแล้ว กรุณาตัดหรือลบบางช่วงก่อนเพิ่มคลิป");
      return;
    }
    const clip: LocalTimelineClip = {
      id: makeTimelineId(),
      assetName: asset.name,
      order: orderedTimelineClips.length,
      trimStartMs: 0,
      trimEndMs: Math.min(asset.durationMs, 8_000, remainingMs),
    };
    invalidateRenderedDraft();
    setTimelinePlaying(false);
    timelineVideoRef.current?.pause();
    setTimelineClips([...orderedTimelineClips, clip]);
    setSelectedTimelineClipId(clip.id);
    setActiveClipId(asset.clientId);
    setTimelinePlayheadMs(timelineTotalMs);
    pendingTimelineSeekRef.current = 0;
    setUploadError("");
    setToast(`เพิ่ม ${asset.originalName || asset.name} เข้า Timeline แล้ว`);
  };

  const finishTimelineEdit = async () => {
    if (clipSelectionInvalid) {
      setUploadError(orderedTimelineClips.length === 0
        ? "Timeline ต้องมีอย่างน้อย 1 ช่วงคลิป"
        : selectedTotalSec > MAX_TOTAL_DURATION_SEC
          ? `Timeline ยาว ${selectedTotalSec.toFixed(1)} วินาที กรุณาตัดให้ไม่เกิน 60 วินาที`
          : "กรุณาตรวจเวลาเริ่มและเวลาจบของคลิปที่เลือก");
      return;
    }
    const saved = await saveProject("บันทึก Timeline เรียบร้อยแล้ว");
    if (saved) {
      setTimelinePlaying(false);
      timelineVideoRef.current?.pause();
      setTimelineEditorOpen(false);
      setUploadError("");
    }
  };

  const goNext = async () => {
    if (activeStep === 1 && clipSelectionInvalid) {
      setUploadError(orderedTimelineClips.length === 0
        ? "กรุณาอัปโหลดและจัด Timeline อย่างน้อย 1 คลิปก่อนเข้าสู่ขั้นถัดไป"
        : selectedTotalSec > MAX_TOTAL_DURATION_SEC
          ? `Timeline ยาว ${selectedTotalSec.toFixed(1)} วินาที กรุณาตัดให้ไม่เกิน 60 วินาที`
          : "เวลาเริ่ม–จบของบางคลิปไม่ถูกต้อง กรุณาแก้ใน Timeline");
      return;
    }
    setUploadError("");
    setCompletedSteps((current) =>
      current.includes(activeStep) ? current : [...current, activeStep],
    );
    if (engineState !== "connected") {
      if (activeStep < 5) setActiveStep((activeStep + 1) as WizardStep);
      return;
    }
    try {
      const id = await ensureProject();
      if (activeStep === 2) {
        if (!brief.name.trim() || !brief.features.trim()) {
          setUploadError("กรุณากรอกชื่อสินค้าและจุดขายหลักก่อนสร้างสคริปต์");
          return;
        }
        setOperationMessage("กำลังสร้างสคริปต์ 5 แบบ…");
        await queueProjectUpdate(id, { title: brief.name, product: projectProduct(), wizardStep: 2 });
        const result = await localApi.generateScripts(id, { brief: briefForApi(), targetSec: selectedTotalSec });
        if (result.scripts.length) {
          setScriptVariants(result.scripts);
          setSelectedScript(result.scripts[0].id);
          setScriptTexts(Object.fromEntries(result.scripts.map((script) => [script.id, [...script.chunks]])));
        }
      } else {
        await queueProjectUpdate(id, { title: brief.name, product: projectProduct(), wizardStep: Math.min(5, activeStep + 1) });
      }
      if (activeStep < 4) setActiveStep((activeStep + 1) as WizardStep);
      else if (activeStep === 4) {
        setActiveStep(5);
        await beginRender("draft", id);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "บันทึกขั้นตอนนี้ไม่สำเร็จ");
    } finally {
      setOperationMessage("");
    }
  };

  const previewVoice = async (voiceId: string) => {
    previewAudioRef.current?.pause();
    if (voicePlaying === voiceId) {
      setVoicePlaying(null);
      return;
    }
    if (engineState === "connected") {
      try {
        setVoicePlaying(voiceId);
        const audioBlob = await localApi.previewVoice(voiceId, { speed, tone });
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        previewAudioRef.current = audio;
        audio.onended = () => { setVoicePlaying(null); URL.revokeObjectURL(url); };
        audio.onerror = () => { setVoicePlaying(null); URL.revokeObjectURL(url); setToast("เล่นเสียงตัวอย่างไม่สำเร็จ"); };
        await audio.play();
      } catch (error) {
        setVoicePlaying(null);
        setToast(error instanceof Error ? error.message : "สร้างเสียงตัวอย่างไม่สำเร็จ");
      }
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setToast("เบราว์เซอร์นี้ยังไม่รองรับการฟังตัวอย่างเสียง");
      return;
    }
    window.speechSynthesis.cancel();
    const voice = voiceLibrary.find((item) => item.id === voiceId) ?? voiceLibrary[0] ?? voices[0];
    const utterance = new SpeechSynthesisUtterance(
      `สวัสดีค่ะ ฉัน${voice.name} พร้อมช่วยเล่าเรื่องสินค้าของคุณให้น่าฟังขึ้น`,
    );
    utterance.lang = "th-TH";
    utterance.rate = speed;
    utterance.onend = () => setVoicePlaying(null);
    setVoicePlaying(voiceId);
    window.speechSynthesis.speak(utterance);
  };

  const regenerateChunk = async (index: number) => {
    if (engineState === "connected" && projectId) {
      try {
        setOperationMessage(`กำลังเขียนท่อนที่ ${index + 1} ใหม่…`);
        const result = await localApi.regenerateChunk(projectId, selectedScript, index, {
          brief: briefForApi(),
          scripts: scriptVariants.map((script) => ({ ...script, chunks: scriptTexts[script.id] ?? script.chunks })),
        });
        setScriptTexts((current) => ({
          ...current,
          [selectedScript]: current[selectedScript].map((line, lineIndex) => lineIndex === index ? result.chunk : line),
        }));
        setToast(`เขียนท่อนที่ ${index + 1} ใหม่แล้ว โดยไม่กระทบท่อนอื่น`);
      } catch (error) {
        setToast(error instanceof Error ? error.message : "เขียนท่อนใหม่ไม่สำเร็จ");
      } finally {
        setOperationMessage("");
      }
      return;
    }
    const replacement = replacementLines[(index + selectedScript.length) % replacementLines.length];
    setScriptTexts((current) => ({
      ...current,
      [selectedScript]: current[selectedScript].map((line, lineIndex) =>
        lineIndex === index ? replacement : line,
      ),
    }));
    setToast(`เขียนท่อนที่ ${index + 1} ใหม่แล้ว โดยไม่กระทบท่อนอื่น`);
  };

  const beginRender = async (kind: "draft" | "final", knownProjectId?: string) => {
    const id = knownProjectId ?? projectId ?? await ensureProject();
    const renderEditRevision = editRevisionRef.current;
    activeRenderEditRevisionRef.current = renderEditRevision;
    setRenderError("");
    setActiveStep(5);
    if (kind === "final") setRenderDone(false);
    setRenderProgress(4);
    setRendering(true);
    setRenderKind(kind);
    setOperationMessage(kind === "draft" ? "กำลังเข้าคิวสร้างร่าง" : "กำลังเข้าคิวสร้างคลิปตัวจริง");
    try {
      // Promotion compares the draft hash with the persisted project. Flush the
      // latest edit first so a quick trim-then-render can never reuse a stale draft.
      await queueProjectUpdate(id, {
        title: brief.name || fileName || "โปรเจกต์ใหม่",
        wizardStep: 5,
        product: projectProduct(),
      });
      const position = captionPosition === "บน" ? "top" : captionPosition === "กลาง" ? "middle" : "bottom";
      const result = kind === "final" && draftReady && renderId
        ? await localApi.promoteRender(renderId, { styleId: selectedStyle, position })
        : await localApi.startRender(id, {
          kind,
          styleId: selectedStyle,
          assets: persistedAssets(clipAssets, timelineClips),
          timelineClips: persistedTimeline(timelineClips),
          targetSec: selectedTotalSec,
          config: {
            assetName: orderedTimelineClips[0]?.assetName ?? assetName,
            assets: persistedAssets(clipAssets, timelineClips),
            timelineClips: persistedTimeline(timelineClips),
            targetSec: selectedTotalSec,
            selectedTotalSec,
            brief: briefForApi(),
            scriptId: selectedScript,
            script: currentChunks,
            voiceId: selectedVoice,
            provider: selectedVoiceData.provider || "gemini",
            speed,
            tone,
            styleId: selectedStyle,
            position,
          },
        });
      if (editRevisionRef.current !== renderEditRevision) {
        await localApi.cancelRender(result.renderId).catch(() => undefined);
        return;
      }
      setRenderId(result.renderId);
      observeRender(result.renderId, kind, renderEditRevision);
    } catch (error) {
      if (editRevisionRef.current !== renderEditRevision) return;
      setRendering(false);
      if (error instanceof ClipPangApiError && error.code === "STALE_DRAFT") {
        setDraftReady(false);
        setRenderId(null);
        setRenderOutputs({});
        setRenderProgress(0);
        setOperationMessage("");
        setRenderError("Timeline เปลี่ยนไปแล้ว กรุณากดสร้างร่างใหม่ก่อนสร้างคลิปตัวจริง");
        return;
      }
      setRenderError(error instanceof Error ? error.message : "เริ่มสร้างคลิปไม่สำเร็จ");
    }
  };

  const startRender = () => {
    if (engineState === "connected") {
      void beginRender(draftReady ? "final" : "draft");
      return;
    }
    setActiveStep(5);
    setRenderDone(false);
    setRenderProgress(4);
    setRendering(true);
  };

  const cancelRender = async () => {
    if (engineState === "connected" && renderId) {
      try { await localApi.cancelRender(renderId); } catch (error) { setToast(error instanceof Error ? error.message : "ยกเลิกงานไม่สำเร็จ"); }
    }
    setRendering(false);
    setRenderProgress(0);
    setOperationMessage("");
  };

  const downloadText = (type: "srt" | "json") => {
    const content =
      type === "srt"
        ? currentChunks
            .map((line, index) => `${index + 1}\n00:00:0${index * 6},000 --> 00:00:${String((index + 1) * 6).padStart(2, "0")},000\n${line}\n`)
            .join("\n")
        : JSON.stringify(
            {
              product: "หัวชาร์จพกพาแม่เหล็ก",
              voice: selectedVoiceData.name,
              speed,
              style: selectedStyleData.name,
              position: captionPosition,
              script: currentChunks,
            },
            null,
            2,
          );
    const blob = new Blob([content], { type: type === "srt" ? "text/plain;charset=utf-8" : "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clippang-${type === "srt" ? "captions.srt" : "project.json"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // ถึงท้ายเส้นเวลาแล้วกดเล่นอีกครั้ง = เริ่มใหม่ ไม่ใช่ค้างอยู่เฟรมสุดท้าย
      if (hasProgram && previewTotalMs > 0 && previewTimeMs >= previewTotalMs - 60) seekPreviewTo(0);
      void video.play().catch(() => undefined);
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <AppShell>
      <div className={`wizard-page ${timelineEditorOpen && activeStep === 1 ? "timeline-editor-active" : ""}`}>
        <header className="wizard-heading">
          <div className="wizard-title-row">
            <Link href="/" className="back-link" aria-label="กลับหน้าภาพรวม"><ArrowLeft size={18} /></Link>
            <div>
              <div className="title-line">
                <h1>{brief.name || "โปรเจกต์ใหม่"}</h1>
                <span className="autosave"><Check size={13} /> {engineState === "connected" ? "Timeline บันทึกอัตโนมัติ" : "โหมดตัวอย่าง"}</span>
              </div>
              <p>โปรเจกต์ใหม่ · สร้างเมื่อสักครู่</p>
            </div>
          </div>
          <button className="button button-quiet" type="button" onClick={() => void saveProject()}>
            <Save size={16} /> บันทึก
          </button>
        </header>

        <nav className="wizard-stepper" aria-label="ขั้นตอนสร้างคลิป">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const complete = completedSteps.includes(step.id) || step.id < activeStep;
            const active = step.id === activeStep;
            return (
              <button
                type="button"
                key={step.id}
                className={`${active ? "active" : ""} ${complete ? "complete" : ""}`}
                disabled={step.id > 1 && clipSelectionInvalid}
                onClick={() => {
                  if (step.id > 1 && clipSelectionInvalid) {
                    setUploadError("จัด Timeline ให้มีความยาว 1–60 วินาทีก่อนเข้าสู่ขั้นถัดไป");
                    return;
                  }
                  setActiveStep(step.id);
                }}
                aria-current={active ? "step" : undefined}
              >
                <span className="step-number">{complete ? <Check size={15} /> : <Icon size={17} />}</span>
                <span className="step-copy"><b>{step.label}</b><small>{step.helper}</small></span>
                {index < steps.length - 1 && <i className="step-rail" />}
              </button>
            );
          })}
        </nav>

        <div className={`wizard-workspace ${timelineEditorOpen && activeStep === 1 ? "timeline-mode" : ""}`}>
          <section className="wizard-card">
            {(uploadError || renderError) && <div className="form-alert error wizard-global-alert" role="alert"><CircleAlert size={17} />{uploadError || renderError}<button type="button" onClick={() => { setUploadError(""); setRenderError(""); }} aria-label="ปิด"><X size={14} /></button></div>}
            {activeStep === 1 && (
              <div className={`step-panel ${timelineEditorOpen ? "timeline-editor-panel" : ""}`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  multiple
                  disabled={analyzing}
                  onChange={handleFileChange}
                  hidden
                />

                {!timelineEditorOpen ? (
                  <>
                    <div className="step-panel-heading inline-heading clip-step-heading">
                      <div>
                        <span className="step-kicker">ขั้นที่ 1 จาก 5</span>
                        <h2>{hasChosenClip ? "คลิปและ Timeline ของคุณ" : "อัปโหลดคลิปสินค้าของคุณ"}</h2>
                        <p>เลือกพร้อมกันได้หลายคลิป แล้วเรียง ตัด และต่อให้เป็นวิดีโอเดียว ความยาวรวม 1–60 วินาที</p>
                      </div>
                      {hasChosenClip && <button type="button" className="button button-outline" onClick={() => {
                        setTimelineEditorOpen(true);
                        const clip = selectedTimelineClip ?? orderedTimelineClips[0];
                        if (clip) selectTimelineClip(clip);
                      }}><Film size={16} /> แก้ไข Timeline</button>}
                    </div>

                    {clipAssets.length < MAX_CLIPS && <div
                      className={`upload-zone upload-zone-multiple ${analyzing ? "disabled" : ""} ${engineState === "checking" ? "checking" : ""}`}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      role="button"
                      tabIndex={0}
                      aria-disabled={analyzing}
                      aria-busy={analyzing || engineState === "checking"}
                      onClick={() => { if (!analyzing) fileInputRef.current?.click(); }}
                      onKeyDown={(event) => { if (!analyzing && (event.key === "Enter" || event.key === " ")) fileInputRef.current?.click(); }}
                    >
                      <span className="upload-illustration"><UploadCloud size={28} /></span>
                      <h3>{hasChosenClip ? "เพิ่มคลิปเข้า Timeline" : "ลากหลายคลิปมาวางตรงนี้"}</h3>
                      <p>หรือ <span>เลือกหลายไฟล์จากเครื่องพร้อมกัน</span></p>
                      <small>MP4, MOV, WebM · ไฟล์ละไม่เกิน 500 MB · สูงสุด {MAX_CLIPS} คลิป</small>
                    </div>}

                    {analyzing && (
                      <div className="analysis-box"><LoaderCircle size={18} className="spin" /><div><b>{operationMessage || "กำลังตรวจคลิป..."}</b><span>{uploadProgress > 0 && uploadProgress < 100 ? `อัปโหลดรวมแล้ว ${uploadProgress}%` : "กำลังอ่านความยาวและเตรียมภาพตัวอย่างของแต่ละคลิป"}</span></div></div>
                    )}

                    {hasChosenClip && !analyzing && <div className="timeline-summary-card">
                      <div className="timeline-summary-head">
                        <div><span><BadgeCheck size={16} /> พร้อมนำไปต่อคลิป</span><h3>{orderedTimelineClips.length} ช่วง จาก {orderedClipAssets.length} ไฟล์ต้นฉบับ</h3></div>
                        <div className={`timeline-total ${clipSelectionInvalid ? "invalid" : "valid"}`}><small>ความยาวรวม</small><b>{formatDuration(selectedTotalSec)}</b><span>สูงสุด 01:00</span></div>
                      </div>
                      <div className="timeline-summary-list" aria-label="ลำดับคลิปใน Timeline">
                        {orderedTimelineClips.map((clip, index) => {
                          const asset = orderedClipAssets.find((item) => item.name === clip.assetName);
                          return <button type="button" key={clip.id} onClick={() => { selectTimelineClip(clip); setTimelineEditorOpen(true); }}>
                            <span className="summary-order">{index + 1}</span>
                            <span className="summary-thumb">{asset && <video src={asset.previewUrl || asset.url} preload="metadata" muted playsInline />}</span>
                            <span className="summary-copy"><b>{asset?.originalName || asset?.name || "คลิป"}</b><small>{(clip.trimStartMs / 1000).toFixed(1)}s–{(clip.trimEndMs / 1000).toFixed(1)}s · ใช้ {((clip.trimEndMs - clip.trimStartMs) / 1000).toFixed(1)}s</small></span>
                            <ArrowRight size={15} />
                          </button>;
                        })}
                      </div>
                      {clipSelectionInvalid && <div className="timeline-validation"><CircleAlert size={15} />{orderedTimelineClips.length === 0 ? "Timeline ต้องมีอย่างน้อย 1 ช่วงคลิป" : selectedTotalSec > 60 ? `เกินกำหนด ${(selectedTotalSec - 60).toFixed(1)} วินาที — เปิด Timeline เพื่อตัดให้สั้นลง` : "มีช่วงคลิปที่เวลาเริ่ม–จบไม่ถูกต้อง"}</div>}
                    </div>}

                    {engineState === "unavailable" && <div className="demo-editor-note"><CircleAlert size={15} /><span><b>โหมดตัวอย่าง</b> คลิปจะอยู่เฉพาะในเบราว์เซอร์หน้านี้ ไม่ถูกอัปโหลดหรือบันทึกถาวร</span></div>}
                    <div className="copyright-note"><CircleAlert size={16} /><p>ใช้เฉพาะคลิปที่คุณมีสิทธิ์เผยแพร่ เพื่อป้องกันปัญหาลิขสิทธิ์และเนื้อหาซ้ำบนแพลตฟอร์ม</p></div>
                  </>
                ) : (
                  <>
                    <div className="timeline-editor-heading">
                      <div><span className="step-kicker">CLIPPANG VIDEO EDITOR</span><h2>ตัดต่อและจัดลำดับคลิป</h2><p>เลือกคลิปเพื่อปรับเวลา ลากเพื่อสลับลำดับ หรือกดปุ่มบนคลิปเพื่อย้ายและลบได้ทันที</p></div>
                      <div className={`timeline-total timeline-total-editor ${clipSelectionInvalid ? "invalid" : "valid"}`}><small>ความยาวรวม</small><b>{formatDuration(selectedTotalSec)}</b><span>กำหนด 00:01–01:00</span></div>
                    </div>

                    <div className="timeline-editor-shell">
                      <section className="timeline-preview-column" aria-label="พรีวิว Timeline">
                        <div className="timeline-panel-bar"><b>จอพรีวิว</b><span>{orderedTimelineClips.length} ช่วง · {formatDuration(selectedTotalSec)}</span></div>
                        <div className="timeline-video-stage">
                          {selectedTimelineClip ? <video
                            ref={timelineVideoRef}
                            key={timelinePreviewUrl}
                            src={timelinePreviewUrl}
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={handleTimelineLoadedMetadata}
                            onTimeUpdate={handleTimelineTimeUpdate}
                            onEnded={handleTimelineTimeUpdate}
                          /> : <div className="timeline-video-empty"><Film size={32} /><span>เพิ่มคลิปลง Timeline</span></div>}
                          {selectedTimelineClip && <span className="timeline-preview-label">คลิป {orderedTimelineClips.findIndex((clip) => clip.id === selectedTimelineClip.id) + 1} · {selectedTimelineAsset?.originalName || selectedTimelineAsset?.name}</span>}
                          <button type="button" className="timeline-stage-play" onClick={() => timelinePlaying ? setTimelinePlaying(false) : seekTimeline(timelinePlayheadMs >= timelineTotalMs ? 0 : timelinePlayheadMs, true)} aria-label={timelinePlaying ? "หยุด Timeline" : "เล่น Timeline ต่อเนื่อง"}>{timelinePlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
                        </div>
                        <div className="timeline-transport">
                          <button type="button" onClick={() => timelinePlaying ? setTimelinePlaying(false) : seekTimeline(timelinePlayheadMs >= timelineTotalMs ? 0 : timelinePlayheadMs, true)} aria-label={timelinePlaying ? "หยุด" : "เล่น"}>{timelinePlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
                          <b>{formatDuration(timelinePlayheadMs / 1000)}</b>
                          <input type="range" min="0" max={Math.max(1, timelineTotalMs)} step="50" value={Math.min(timelinePlayheadMs, timelineTotalMs)} onChange={(event) => { timelineVideoRef.current?.pause(); seekTimeline(Number(event.target.value), false); }} aria-label="ตำแหน่งจุดเล่นใน Timeline" />
                          <span>{formatDuration(selectedTotalSec)}</span>
                        </div>
                      </section>

                      <aside className="timeline-inspector" aria-label="ตั้งค่าช่วงคลิปที่เลือก">
                        <div className="timeline-panel-bar"><b>คุณสมบัติคลิป</b><span>ปรับหัว–ท้ายอย่างละเอียด</span></div>
                        <div className="timeline-inspector-body">
                          {selectedTimelineClip && selectedTimelineAsset ? <>
                            <div className="timeline-inspector-head"><span><GripVertical size={18} /></span><div><small>ช่วงที่ {orderedTimelineClips.findIndex((clip) => clip.id === selectedTimelineClip.id) + 1} · {selectedTimelineAsset.size ? `${(selectedTimelineAsset.size / 1024 / 1024).toFixed(1)} MB` : "ไฟล์บนเครื่อง"}</small><b>{selectedTimelineAsset.originalName || selectedTimelineAsset.name}</b></div></div>
                            <div className="trim-duration-readout"><span>ระยะเวลาที่ใช้ใน Timeline</span><b>{((selectedTimelineClip.trimEndMs - selectedTimelineClip.trimStartMs) / 1000).toFixed(1)} วินาที</b></div>
                            <div className="trim-fields">
                              <label><span>จุดเริ่มคลิป</span><div><input type="number" min="0" max={Math.max(0, selectedTimelineClip.trimEndMs / 1000 - 0.1)} step="0.1" value={(selectedTimelineClip.trimStartMs / 1000).toFixed(1)} onChange={(event) => updateTimelineTrim(selectedTimelineClip.id, "start", event.target.valueAsNumber)} /><small>วินาที</small></div></label>
                              <label><span>จุดจบคลิป</span><div><input type="number" min={selectedTimelineClip.trimStartMs / 1000 + 0.1} max={selectedTimelineAsset.durationMs / 1000} step="0.1" value={(selectedTimelineClip.trimEndMs / 1000).toFixed(1)} onChange={(event) => updateTimelineTrim(selectedTimelineClip.id, "end", event.target.valueAsNumber)} /><small>วินาที</small></div></label>
                            </div>
                            <div className="dual-trim-control" style={{ "--trim-start": `${selectedTimelineClip.trimStartMs / selectedTimelineAsset.durationMs * 100}%`, "--trim-end": `${selectedTimelineClip.trimEndMs / selectedTimelineAsset.durationMs * 100}%` } as CSSProperties}>
                              <span className="trim-source-rail"><i /></span>
                              <input className="trim-start-range" type="range" min="0" max={Math.max(100, selectedTimelineAsset.durationMs)} step="100" value={selectedTimelineClip.trimStartMs} onChange={(event) => updateTimelineTrim(selectedTimelineClip.id, "start", Number(event.target.value) / 1000)} aria-label="ตัดหัวคลิป" />
                              <input className="trim-end-range" type="range" min="0" max={Math.max(100, selectedTimelineAsset.durationMs)} step="100" value={selectedTimelineClip.trimEndMs} onChange={(event) => updateTimelineTrim(selectedTimelineClip.id, "end", Number(event.target.value) / 1000)} aria-label="ตัดท้ายคลิป" />
                              <div><span>00:00</span><span>{formatDuration(selectedTimelineAsset.durationMs / 1000)}</span></div>
                            </div>
                            <div className="timeline-inspector-actions">
                              <button type="button" onClick={splitTimelineClip}><Scissors size={18} /> ตัดแบ่งที่หัวอ่าน</button>
                              <button type="button" className="danger" onClick={() => deleteTimelineClip(selectedTimelineClip.id)}><Trash2 size={18} /> ลบช่วงนี้</button>
                            </div>
                          </> : <div className="timeline-inspector-empty"><Film size={30} /><span>เลือกช่วงคลิปบน Timeline เพื่อปรับเวลา</span></div>}
                        </div>
                      </aside>
                    </div>

                    <div className="timeline-toolbar">
                      <div><span className="timeline-track-badge">V1</span><div><b>ไทม์ไลน์วิดีโอ</b><span>{orderedTimelineClips.length}/{MAX_TIMELINE_CLIPS} ช่วง · ลากเพื่อเรียง หรือใช้ปุ่มบนคลิป · กด Delete เพื่อลบ</span></div></div>
                      <button type="button" className="button button-outline button-small" disabled={clipAssets.length >= MAX_CLIPS || analyzing || engineState === "checking"} onClick={() => fileInputRef.current?.click()}><UploadCloud size={15} /> เพิ่มคลิป</button>
                    </div>
                    <div className="timeline-source-bin" aria-label="คลิปต้นฉบับในโปรเจกต์">
                      <div className="timeline-source-bin-head"><div><b>คลังคลิปต้นฉบับ</b><span>เพิ่มคลิปเดิมซ้ำ หรือนำช่วงที่ลบกลับเข้าไทม์ไลน์ได้</span></div><small>{orderedClipAssets.length}/{MAX_CLIPS} ไฟล์</small></div>
                      <div className="timeline-source-list">
                        {orderedClipAssets.map((asset) => <div className="timeline-source-card" key={asset.clientId}>
                          <video src={asset.previewUrl || asset.url} preload="metadata" muted playsInline />
                          <span><b>{asset.originalName || asset.name}</b><small>{formatDuration(asset.durationMs / 1000)} · {(asset.size / 1024 / 1024).toFixed(1)} MB</small></span>
                          <button type="button" onClick={() => addAssetToTimeline(asset)} disabled={orderedTimelineClips.length >= MAX_TIMELINE_CLIPS || timelineTotalMs >= MAX_TOTAL_DURATION_SEC * 1000 - 99} aria-label={`เพิ่ม ${asset.originalName || asset.name} เข้า Timeline`} title="เพิ่มเข้า Timeline"><Plus size={18} /></button>
                        </div>)}
                      </div>
                    </div>
                    <div className="timeline-scroll" aria-label="Timeline คลิป">
                      <div className="timeline-track-label" aria-hidden="true"><Film size={18} /><b>V1</b><span>วิดีโอ</span></div>
                      <div className="timeline-canvas" style={{ width: `${Math.max(980, selectedTotalSec * 42, orderedTimelineClips.length * 150)}px` }}>
                        <div className="timeline-ruler" aria-hidden="true">{Array.from({ length: 7 }).map((_, index) => <span key={index} style={{ left: `${index / 6 * 100}%` }}>{formatDuration(selectedTotalSec * index / 6)}</span>)}</div>
                        <div className="timeline-blocks" role="listbox" aria-label="เรียงลำดับช่วงคลิป">
                          {orderedTimelineClips.map((clip, index) => {
                            const asset = orderedClipAssets.find((item) => item.name === clip.assetName);
                            const durationMs = clip.trimEndMs - clip.trimStartMs;
                            return <div
                              key={clip.id}
                              role="option"
                              aria-selected={selectedTimelineClip?.id === clip.id}
                              aria-label={`ช่วงที่ ${index + 1} ${asset?.originalName || asset?.name || "คลิป"} ความยาว ${(durationMs / 1000).toFixed(1)} วินาที`}
                              tabIndex={0}
                              draggable
                              className={`timeline-block ${selectedTimelineClip?.id === clip.id ? "selected" : ""} ${draggingClipId === clip.id ? "dragging" : ""}`}
                              style={{ width: `${Math.max(2, durationMs / Math.max(1, timelineTotalMs) * 100)}%` }}
                              onDragStart={() => setDraggingClipId(clip.id)}
                              onDragEnd={() => setDraggingClipId(null)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => dropTimelineClip(clip.id)}
                              onClick={() => selectTimelineClip(clip)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  selectTimelineClip(clip);
                                }
                                if (event.key === "Delete" || event.key === "Backspace") {
                                  event.preventDefault();
                                  deleteTimelineClip(clip.id);
                                }
                                if (event.altKey && event.key === "ArrowLeft") {
                                  event.preventDefault();
                                  moveTimelineClip(clip.id, index - 1);
                                }
                                if (event.altKey && event.key === "ArrowRight") {
                                  event.preventDefault();
                                  moveTimelineClip(clip.id, index + 1);
                                }
                              }}
                            >
                              <span className="timeline-block-grip"><GripVertical size={18} /></span>
                              <span className="timeline-block-number">{index + 1}</span>
                              <span className="timeline-block-thumb">{asset && <video src={asset.previewUrl || asset.url} preload="metadata" muted playsInline />}</span>
                              <span className="timeline-block-copy"><b>{asset?.originalName || asset?.name || "คลิป"}</b><small>{(clip.trimStartMs / 1000).toFixed(1)}–{(clip.trimEndMs / 1000).toFixed(1)} วิ · ใช้ {(durationMs / 1000).toFixed(1)} วิ</small></span>
                              <span className="timeline-block-accessible-actions">
                                <button type="button" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveTimelineClip(clip.id, index - 1); }} aria-label={`ย้ายคลิป ${index + 1} ไปทางซ้าย`} title="ย้ายไปทางซ้าย"><ArrowLeft size={15} /></button>
                                <button type="button" disabled={index === orderedTimelineClips.length - 1} onClick={(event) => { event.stopPropagation(); moveTimelineClip(clip.id, index + 1); }} aria-label={`ย้ายคลิป ${index + 1} ไปทางขวา`} title="ย้ายไปทางขวา"><ArrowRight size={15} /></button>
                                <button type="button" className="timeline-block-delete" onClick={(event) => { event.stopPropagation(); deleteTimelineClip(clip.id); }} aria-label={`ลบคลิป ${index + 1} ออกจาก Timeline`} title="ลบออกจาก Timeline"><Trash2 size={15} /></button>
                              </span>
                            </div>;
                          })}
                        </div>
                        {timelineTotalMs > 0 && <span className="timeline-playhead" style={{ left: `${Math.min(100, timelinePlayheadMs / timelineTotalMs * 100)}%` }} aria-hidden="true"><i /></span>}
                      </div>
                    </div>
                    {clipSelectionInvalid && <div className="timeline-validation timeline-editor-validation"><CircleAlert size={15} />{orderedTimelineClips.length === 0 ? "Timeline ต้องมีอย่างน้อย 1 ช่วงคลิป" : selectedTotalSec > 60 ? `ความยาวรวมเกิน 60 วินาทีอยู่ ${(selectedTotalSec - 60).toFixed(1)} วินาที — ตัดหรือลบบางช่วงก่อนเสร็จสิ้น` : "เวลาเริ่ม–จบของบางช่วงไม่ถูกต้อง"}</div>}
                    {analyzing && <div className="analysis-box"><LoaderCircle size={18} className="spin" /><div><b>{operationMessage}</b><span>อัปโหลดรวมแล้ว {uploadProgress}%</span></div></div>}
                  </>
                )}
              </div>
            )}

            {activeStep === 2 && (
              <div className="step-panel">
                <div className="step-panel-heading">
                  <span className="step-kicker">ขั้นที่ 2 จาก 5</span>
                  <h2>บอกเราเกี่ยวกับสินค้าชิ้นนี้</h2>
                  <p>ยิ่งบอกชัด สคริปต์ยิ่งพูดเหมือนคุณขายเอง ไม่ต้องเขียนเป็นประโยคสวย ๆ</p>
                </div>
                <div className="brief-grid">
                  <label className="field field-span-2"><span>ชื่อสินค้า <b>*</b></span><input value={brief.name} onChange={(event) => setBrief((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className="field"><span>หมวดหมู่</span><select value={brief.category} onChange={(event) => setBrief((current) => ({ ...current, category: event.target.value }))}><option>มือถือและอุปกรณ์เสริม</option><option>บ้านและไลฟ์สไตล์</option><option>บิวตี้และสกินแคร์</option></select><ChevronDown size={15} /></label>
                  <label className="field"><span>ราคา / โปรโมชัน</span><input value={brief.price} onChange={(event) => setBrief((current) => ({ ...current, price: event.target.value }))} /></label>
                  <label className="field field-span-2"><span>จุดขายหลัก <b>*</b></span><textarea rows={4} value={brief.features} onChange={(event) => setBrief((current) => ({ ...current, features: event.target.value }))} /><small>แยกแต่ละข้อด้วยเครื่องหมายจุลภาคได้</small></label>
                  <label className="field"><span>กลุ่มลูกค้า</span><input value={brief.audience} onChange={(event) => setBrief((current) => ({ ...current, audience: event.target.value }))} /></label>
                  <label className="field"><span>โทนที่อยากได้</span><select value={brief.tone} onChange={(event) => setBrief((current) => ({ ...current, tone: event.target.value }))}><option>เหมือนเพื่อนแนะนำ</option><option>ขายเก่ง จังหวะไว</option><option>รีวิวจริงใจ</option><option>พรีเมียม ดูแพง</option></select><ChevronDown size={15} /></label>
                  <label className="field field-span-2"><span>คำที่อยากให้พูดปิดท้าย</span><input value={brief.cta} onChange={(event) => setBrief((current) => ({ ...current, cta: event.target.value }))} /></label>
                </div>
                <div className="ai-tip"><span><Sparkles size={18} /></span><p><b>ไม่ต้องคิดให้ครบทุกคำ</b> ClipPang จะสร้างสคริปต์ให้เลือก 5 แนว และคุณแก้ทีละท่อนได้ในขั้นถัดไป</p></div>
              </div>
            )}

            {activeStep === 3 && (
              <div className="step-panel">
                <div className="step-panel-heading inline-heading">
                  <div><span className="step-kicker">ขั้นที่ 3 จาก 5</span><h2>เลือกเสียงที่เป็นตัวคุณ</h2><p>กดฟังตัวอย่างได้ทันที แล้วปรับความเร็วให้เข้ากับจังหวะคลิป</p></div>
                  <span className="library-count">{voiceLibrary.length} เสียง</span>
                </div>
                <div className="filter-row">
                  {['ทั้งหมด','สดใส','นุ่ม','หนักแน่น'].map((filter) => <button type="button" key={filter} className={voiceFilter === filter ? "active" : ""} onClick={() => setVoiceFilter(filter)}>{filter}</button>)}
                </div>
                <div className="voice-grid">
                  {filteredVoices.map((voice) => (
                    <button type="button" className={`voice-card ${selectedVoice === voice.id ? "selected" : ""}`} key={voice.id} onClick={() => setSelectedVoice(voice.id)}>
                      <span className="voice-avatar" style={{ background: voice.color }}>{voice.initials}</span>
                      <span className="voice-card-copy"><b>{voice.name}</b><small>{voice.gender} · {voice.tone}</small></span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="voice-play"
                        aria-label={`ฟังเสียง ${voice.name}`}
                        onClick={(event) => { event.stopPropagation(); previewVoice(voice.id); }}
                        onKeyDown={(event) => { if (event.key === "Enter") previewVoice(voice.id); }}
                      >{voicePlaying === voice.id ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</span>
                      {selectedVoice === voice.id && <span className="selected-check"><Check size={12} /></span>}
                    </button>
                  ))}
                </div>
                <button className="show-more" type="button" onClick={() => setVoiceFilter("ทั้งหมด")}>ดูเสียงทั้งหมด {voiceLibrary.length} แบบ <ChevronDown size={15} /></button>

                <div className="voice-controls">
                  <div className="control-block">
                    <div className="control-label"><span>โทนการพูด</span><b>{tone}</b></div>
                    <div className="tone-options">{['เป็นกันเอง','มั่นใจ','ตื่นเต้น','นุ่มนวล'].map((item) => <button type="button" className={tone === item ? "active" : ""} onClick={() => setTone(item)} key={item}>{item}</button>)}</div>
                  </div>
                  <div className="control-block">
                    <div className="control-label"><span>ความเร็ว</span><b>{speed.toFixed(1)}×</b></div>
                    <input className="range" type="range" min="0.8" max="1.2" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="ความเร็วเสียง" />
                    <div className="range-labels"><span>ช้าชัดเจน</span><span>ธรรมชาติ</span><span>กระชับ</span></div>
                  </div>
                </div>
              </div>
            )}

            {activeStep === 4 && (
              <div className="step-panel">
                <div className="step-panel-heading inline-heading">
                  <div><span className="step-kicker">ขั้นที่ 4 จาก 5</span><h2>เลือกสคริปต์และหน้าตาซับ</h2><p>เราสร้างมาให้ 5 แนว เลือกแนวที่ชอบแล้วแก้เฉพาะท่อนได้เลย</p></div>
                  <button type="button" className="button button-quiet"><WandSparkles size={16} /> สร้างใหม่ทั้งหมด</button>
                </div>
                <div className="script-tabs" role="tablist" aria-label="สคริปต์ 5 เวอร์ชัน">
                  {scriptVariants.map((script, index) => (
                    <button type="button" role="tab" aria-selected={selectedScript === script.id} className={selectedScript === script.id ? "active" : ""} onClick={() => setSelectedScript(script.id)} key={script.id}>
                      <span>แบบ {index + 1}</span><b>{script.name || `สคริปต์ ${index + 1}`}</b><small>{script.tag || "AI สร้างให้"}</small><em>{script.score ?? Math.max(78, 96 - index * 3)}% เข้ากับคลิป</em>
                    </button>
                  ))}
                </div>
                <div className="script-editor">
                  <div className="editor-head"><div><span className="script-rank"><Sparkles size={14} /> AI แนะนำ</span><h3>{selectedScriptData.name}</h3></div><span>เป้าหมาย {formatDuration(selectedTotalSec)}</span></div>
                  <div className="chunk-list">
                    {currentChunks.map((chunk, index) => (
                      <div className="chunk" key={`${selectedScript}-${index}`}>
                        <span className="chunk-index">{String(index + 1).padStart(2, '0')}</span>
                        <textarea
                          value={chunk}
                          rows={2}
                          aria-label={`สคริปต์ท่อนที่ ${index + 1}`}
                          onChange={(event) => setScriptTexts((current) => ({ ...current, [selectedScript]: current[selectedScript].map((line, lineIndex) => lineIndex === index ? event.target.value : line) }))}
                        />
                        <button type="button" onClick={() => void regenerateChunk(index)} title="เขียนท่อนนี้ใหม่"><RotateCcw size={15} /></button>
                        <small>{index * 6}:00–{(index + 1) * 6}:00</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="subsection-heading"><div><h3>สไตล์ซับ</h3><p>พรีวิวจากคลิปจริงของคุณ</p></div><Link href="/styles" className="text-link">ดูแกลเลอรี <ArrowRight size={15} /></Link></div>
                <div className="caption-style-grid">
                  {captionStyles.map((style) => (
                    <button type="button" className={`caption-style-card ${selectedStyle === style.id ? "selected" : ""}`} onClick={() => setSelectedStyle(style.id)} key={style.id}>
                      <span className="style-preview"><img src="/clippang-sample-poster.jpg" alt="" /><b className={style.className}>{style.label}</b></span>
                      <span className="style-info"><b>{style.name}</b><small>{style.note}</small></span>
                      <em>{style.speed}</em>
                      {selectedStyle === style.id && <i className="style-selected"><Check size={12} /></i>}
                    </button>
                  ))}
                </div>
                <div className="position-control"><div><b>ตำแหน่งซับ</b><small>หลบสินค้าและปุ่มบนแพลตฟอร์ม</small></div><div>{['บน','กลาง','ล่าง'].map((position) => <button type="button" className={captionPosition === position ? "active" : ""} onClick={() => setCaptionPosition(position)} key={position}>{position}</button>)}</div></div>
              </div>
            )}

            {activeStep === 5 && (
              <div className="step-panel results-panel">
                <div className="step-panel-heading inline-heading">
                  <div><span className="step-kicker">ขั้นที่ 5 จาก 5</span><h2>{renderDone ? "คลิปของคุณพร้อมแล้ว 🎉" : draftReady ? "ร่างพร้อมแล้ว—สร้างตัวจริงได้เลย" : "เลือกร่างที่ชอบที่สุด"}</h2><p>{renderDone ? "ตรวจดูแล้ว ดาวน์โหลดไฟล์ได้ทันที หรือเปิดโฟลเดอร์ผลงานบนเครื่อง" : draftReady ? "ระบบจะใช้เสียงและ timeline เดิม จึงไม่ยิง TTS ซ้ำ" : "ร่างใช้เสียงและจังหวะจริง เลือกหนึ่งแบบก่อนสร้างไฟล์คุณภาพเต็ม"}</p></div>
                  {renderDone && <span className="ready-large"><CheckCircle2 size={17} /> พร้อมดาวน์โหลด</span>}
                </div>

                {!renderDone && !rendering && (
                  <>
                    <div className="draft-grid">
                      {captionStyles.slice(0, 3).map((style, index) => (
                        <button type="button" className={`draft-card ${selectedDraft === index ? "selected" : ""}`} onClick={() => { setSelectedDraft(index); setSelectedStyle(style.id); }} key={style.id}>
                          <span className="draft-video"><img src="/clippang-sample-poster.jpg" alt="" /><b className={style.className}>{style.label}</b><i><Play size={16} fill="currentColor" /></i></span>
                          <span><b>ร่าง {index + 1}</b><small>{style.name} · {formatDuration(selectedTotalSec)}</small></span>
                          {selectedDraft === index && <em><Check size={13} /> เลือกแล้ว</em>}
                        </button>
                      ))}
                    </div>
                    {draftReady && renderedVideoUrl && <div className="draft-ready-preview"><video src={renderedVideoUrl} controls playsInline><track kind="captions" srcLang="th" label="คำบรรยายภาษาไทยฝังอยู่ในวิดีโอ" /></video><span><CheckCircle2 size={15} /> ร่างที่ใช้ timeline และเสียงจริง</span></div>}
                    <div className="render-summary"><div><span><Mic2 size={15} /> เสียง {selectedVoiceData.name}</span><span><Captions size={15} /> {selectedStyleData.name}</span><span><Clock3 size={15} /> {draftReady ? "ตัวจริงประมาณ 1–3 นาที" : "ร่างประมาณ 25–40 วินาที"}</span></div><button className="button button-primary" type="button" onClick={startRender}><Zap size={17} /> {draftReady ? "สร้างคลิปตัวจริง" : "สร้างร่างที่เลือก"}</button></div>
                  </>
                )}

                {rendering && (
                  <div className="render-progress-card">
                    <div className="render-orbit"><span>{renderProgress}%</span></div>
                    <div className="render-copy"><span className="live-pill dark"><i /> กำลังสร้าง{renderKind === "draft" ? "ร่าง" : "คลิปตัวจริง"}</span><h3>{renderStage}</h3><p>คุณปิดหน้านี้ได้ งานจะทำต่อและกลับมาดูความคืบหน้าได้เสมอ</p><div className="render-bar"><span style={{ width: `${renderProgress}%` }} /></div><div className="render-time"><span>{renderProgress}% แล้ว</span><span>{operationMessage || "กำลังประมวลผลบนเครื่อง"}</span></div><button type="button" onClick={() => void cancelRender()}>ยกเลิกงาน</button></div>
                  </div>
                )}

                {renderDone && (
                  <div className="final-result">
                    <div className="final-video"><video src={renderedVideoUrl || videoUrl} poster="/clippang-sample-poster.jpg" controls playsInline><track kind="captions" srcLang="th" label="คำบรรยายภาษาไทยฝังอยู่ในวิดีโอ" /></video><span className={`final-caption ${selectedStyleData.className}`}>{currentChunks[1]}</span></div>
                    <div className="output-list">
                      <div className="output-head"><span className="output-icon"><Film size={20} /></span><div><h3>{renderedVideoUrl ? "final.mp4" : "คลิปตัวอย่าง"}</h3><p>1080 × 1920 · H.264 · พร้อมโพสต์</p></div><a className="button button-primary button-small" href={renderedVideoUrl || "/clippang-sample.mp4"} download><Download size={15} /> MP4</a></div>
                      {engineState === "connected" ? downloadableOutputs.filter(([, output]) => !output.filename.toLowerCase().endsWith(".mp4")).map(([key, output]) => (
                        <a className="output-row" href={output.url} download key={key}><span>{output.filename.endsWith(".wav") ? <FileAudio size={17} /> : <FileText size={17} />}</span><div><b>{output.filename}</b><small>ไฟล์ประกอบจาก ClipPang</small></div><Download size={16} /></a>
                      )) : <><button type="button" className="output-row" onClick={() => downloadText('srt')}><span><FileText size={17} /></span><div><b>captions.srt</b><small>ไฟล์ซับตัวอย่าง</small></div><Download size={16} /></button><button type="button" className="output-row" onClick={() => downloadText('json')}><span><FileAudio size={17} /></span><div><b>project.json</b><small>การตั้งค่าตัวอย่าง</small></div><Download size={16} /></button></>}
                      <button type="button" className="button button-outline output-folder" onClick={() => projectId && engineState === "connected" ? void localApi.openProject(projectId).then(() => setToast("เปิดโฟลเดอร์ผลงานแล้ว")).catch((error) => setToast(error instanceof Error ? error.message : "เปิดโฟลเดอร์ไม่สำเร็จ")) : setToast("เปิด ClipPang ผ่าน เริ่มโปรแกรม.bat เพื่อใช้ปุ่มนี้") }><FolderOpen size={17} /> เปิดโฟลเดอร์ผลงาน</button>
                      <button type="button" className="text-button" onClick={() => { setRenderDone(false); setRenderProgress(0); }}>กลับไปแก้แล้วสร้างใหม่</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <footer className="wizard-card-footer">
              {activeStep === 1 && timelineEditorOpen ? <>
                <button type="button" className="button button-quiet" onClick={() => { setTimelinePlaying(false); timelineVideoRef.current?.pause(); setTimelineEditorOpen(false); }}><ArrowLeft size={16} /> กลับไปดูสรุป</button>
                <button type="button" className="button button-primary" disabled={clipSelectionInvalid || analyzing || Boolean(operationMessage)} onClick={() => void finishTimelineEdit()}><Check size={17} /> เสร็จสิ้นการตัดต่อ</button>
              </> : <>
                <button type="button" className="button button-quiet" disabled={activeStep === 1} onClick={() => setActiveStep((activeStep - 1) as WizardStep)}><ArrowLeft size={16} /> ย้อนกลับ</button>
                {activeStep < 5 ? <button type="button" className="button button-primary" disabled={Boolean(operationMessage) || analyzing || (activeStep === 1 && clipSelectionInvalid)} onClick={() => void goNext()}>{activeStep === 1 ? "ใช้ Timeline นี้" : activeStep === 2 ? (operationMessage ? "กำลังสร้างสคริปต์…" : "สร้างสคริปต์") : activeStep === 3 ? "เลือกเสียงนี้" : "สร้างร่างคลิป"}<ArrowRight size={17} /></button> : !renderDone && !rendering ? <button type="button" className="button button-primary" onClick={startRender}><Zap size={17} /> {draftReady ? "สร้างคลิปตัวจริง" : "สร้างร่างที่เลือก"}</button> : null}
              </>}
            </footer>
          </section>

          {!(timelineEditorOpen && activeStep === 1) && <aside className="live-preview-panel">
            <div className="preview-panel-head"><div><span className="live-dot"><i /> พรีวิวสด</span><p>{hasProgram ? `${programSegments.length} ช่วง · ซับ ${captionCues.length} ท่อน` : "อัปเดตตามที่คุณเลือก"}</p></div><span className="preview-quality">9:16 · HD</span></div>
            <div className="phone-stage">
              <div className="editor-phone">
                <video ref={videoRef} src={hasProgram ? undefined : previewVideoUrl} poster="/clippang-sample-poster.jpg" muted playsInline loop={!hasProgram} onLoadedMetadata={(event) => {
                  const segment = programSegments[previewSegmentIndex];
                  const target = segment ? orderedClipAssets.find((asset) => asset.name === segment.assetName) : activeClip;
                  if (!target) return;
                  const durationMs = Math.round(event.currentTarget.duration * 1000);
                  if (!target.durationKnown || Math.abs(target.durationMs - durationMs) > 500) reconcileAssetDuration(target.name, durationMs);
                }} onEnded={() => { if (!hasProgram) setIsPlaying(false); }} />
                <button className="video-toggle" type="button" onClick={toggleVideo} aria-label={isPlaying ? "หยุดวิดีโอ" : "เล่นวิดีโอ"}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
                {previewCaptionText && <div className={`live-caption ${selectedStyleData.className} position-${captionPosition}`}>{previewCaptionText}</div>}
                <div className="video-safe-zone" aria-hidden="true"><span>safe area</span></div>
              </div>
            </div>
            <div className="preview-timeline">
              <div className="timeline-head">
                <span>{formatDuration(previewTimeMs / 1000)}</span>
                <b>{formatDuration(previewTotalMs > 0 ? previewTotalMs / 1000 : selectedTotalSec)}</b>
              </div>
              <div
                className={`timeline-track ${hasProgram ? "is-live" : ""}`}
                role={hasProgram ? "slider" : undefined}
                tabIndex={hasProgram ? 0 : -1}
                aria-label={hasProgram ? "เลื่อนดูตำแหน่งในคลิป" : undefined}
                aria-valuemin={0}
                aria-valuemax={Math.round(previewTotalMs / 1000)}
                aria-valuenow={Math.round(previewTimeMs / 1000)}
                onClick={(event) => {
                  if (!hasProgram) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  seekPreviewTo(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * previewTotalMs);
                }}
                onKeyDown={(event) => {
                  if (!hasProgram) return;
                  if (event.key === "ArrowRight") { event.preventDefault(); seekPreviewTo(previewTimeMs + 1000); }
                  if (event.key === "ArrowLeft") { event.preventDefault(); seekPreviewTo(previewTimeMs - 1000); }
                }}
              >
                {hasProgram
                  ? programSegments.map((segment, index) => (
                      <span
                        key={segment.id}
                        className={`scene ${index === previewSegmentIndex ? "is-active" : ""}`}
                        style={{ flexGrow: segment.durationMs, flexBasis: 0 }}
                        title={`${segment.assetName} · ${formatDuration(segment.durationMs / 1000)}`}
                      />
                    ))
                  : <><span className="scene s1"/><span className="scene s2"/><span className="scene s3"/><span className="scene s4"/></>}
                <i style={hasProgram ? { left: `${previewProgressRatio * 100}%` } : undefined} />
              </div>
              <div className="waveform" aria-hidden="true">
                {speechBars.map((level, index) => (
                  <i
                    key={index}
                    className={index / speechBars.length <= previewProgressRatio ? "is-past" : ""}
                    style={{ height: `${4 + level * 18}px` }}
                  />
                ))}
              </div>
              {hasProgram && <p className="preview-timeline-note">จังหวะซับเป็นค่าประมาณจากจำนวนตัวอักษร เวลาจริงจะล็อกตามไฟล์เสียงตอนสร้างคลิป</p>}
            </div>
            <div className="preview-config">
              <div><span className="config-icon" style={{background:selectedVoiceData.color}}><Mic2 size={15}/></span><p><small>เสียงพากย์</small><b>{selectedVoiceData.name} · {speed.toFixed(1)}×</b></p></div>
              <div><span className="config-icon yellow"><Captions size={15}/></span><p><small>สไตล์ซับ</small><b>{selectedStyleData.name}</b></p></div>
              <div><span className="config-icon blue"><Gauge size={15}/></span><p><small>ความยาว Timeline</small><b>{hasChosenClip ? formatDuration(selectedTotalSec) : "ยังไม่เลือกคลิป"}</b></p></div>
            </div>
          </aside>}
        </div>
      </div>
      {toast && <div className="toast" role="status" aria-live="polite">
        <CheckCircle2 size={18} />
        <span>{toast}</span>
        {recentlyDeletedClip?.message === toast && <button type="button" className="toast-undo" onClick={undoDeleteTimelineClip}><RotateCcw size={15} /> เลิกทำ</button>}
        <button type="button" className="toast-close" onClick={() => { setToast(""); setRecentlyDeletedClip(null); }} aria-label="ปิด"><X size={15}/></button>
      </div>}
    </AppShell>
  );
}
