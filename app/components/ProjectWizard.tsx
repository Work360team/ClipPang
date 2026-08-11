"use client";

import Link from "next/link";
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
  Image as ImageIcon,
  LoaderCircle,
  Mic2,
  PackageCheck,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { AppShell } from "./AppShell";

type WizardStep = 1 | 2 | 3 | 4 | 5;

const steps: { id: WizardStep; label: string; helper: string; icon: typeof Film }[] = [
  { id: 1, label: "คลิป", helper: "เลือกวิดีโอ", icon: Film },
  { id: 2, label: "สินค้า", helper: "บอกจุดขาย", icon: PackageCheck },
  { id: 3, label: "เสียง", helper: "เลือกนักพากย์", icon: Mic2 },
  { id: 4, label: "สคริปต์ + ซับ", helper: "ปรับสไตล์", icon: Captions },
  { id: 5, label: "ผลลัพธ์", helper: "เรนเดอร์และโหลด", icon: Download },
];

const voices = [
  { id: "mesa", name: "เมษา", gender: "หญิง", tone: "สดใส เป็นกันเอง", color: "#ffd6a6", initials: "ม" },
  { id: "nammon", name: "น้ำมนต์", gender: "หญิง", tone: "นุ่มนวล น่าเชื่อถือ", color: "#d9d4ff", initials: "น" },
  { id: "tonkla", name: "ต้นกล้า", gender: "ชาย", tone: "พลังดี กระชับ", color: "#c9eddc", initials: "ต" },
  { id: "prim", name: "พริม", gender: "หญิง", tone: "หรูหรา มีระดับ", color: "#ffd8df", initials: "พ" },
  { id: "kin", name: "คิน", gender: "ชาย", tone: "อบอุ่น เป็นธรรมชาติ", color: "#cde5f5", initials: "ค" },
  { id: "aim", name: "เอม", gender: "หญิง", tone: "มั่นใจ ขายเก่ง", color: "#f2e4b8", initials: "อ" },
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
  { id: "pop", name: "ป๊อปขายดี", note: "เด่น อ่านไว", label: "ติดแน่นทุกที่", className: "caption-pop", speed: "เร็ว" },
  { id: "clean", name: "คลีนมินิมอล", note: "สะอาด ดูแพง", label: "ชาร์จได้ทันที", className: "caption-clean", speed: "เร็ว" },
  { id: "boxed", name: "กล่องครีเอเตอร์", note: "ชัดบนทุกพื้นหลัง", label: "พกง่ายมาก", className: "caption-boxed", speed: "เร็ว" },
  { id: "karaoke", name: "คาราโอเกะพรีเมียม", note: "ไฮไลต์ตามคำพูด", label: "ไม่ต้องพกสาย", className: "caption-karaoke", speed: "ละเอียด" },
];

const replacementLines = [
  "ตัวเดียวจบทั้งชาร์จ ทั้งจับมือถือ พกออกจากบ้านได้แบบสบายมาก",
  "แบตใกล้หมดไม่ต้องตกใจ แปะแล้วใช้ต่อได้ทันทีเลยค่ะ",
  "เบาจนแทบไม่รู้สึก แต่กำลังสำรองพร้อมช่วยได้ทั้งวัน",
  "ใครใช้มือถือทำงานหรือถ่ายคลิปบ่อย ตัวนี้ตอบโจทย์มาก",
];

export function ProjectWizard() {
  const [activeStep, setActiveStep] = useState<WizardStep>(1);
  const [completedSteps, setCompletedSteps] = useState<WizardStep[]>([]);
  const [videoUrl, setVideoUrl] = useState("/clippang-sample.mp4");
  const [fileName, setFileName] = useState("คลิปตัวอย่าง.mp4");
  const [fileSize, setFileSize] = useState("4.1 MB");
  const [uploadError, setUploadError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("mesa");
  const [voiceFilter, setVoiceFilter] = useState("ทั้งหมด");
  const [voicePlaying, setVoicePlaying] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [tone, setTone] = useState("เป็นกันเอง");
  const [selectedScript, setSelectedScript] = useState("hook");
  const [scriptTexts, setScriptTexts] = useState(() =>
    Object.fromEntries(initialScripts.map((script) => [script.id, [...script.chunks]])),
  );
  const [selectedStyle, setSelectedStyle] = useState("pop");
  const [captionPosition, setCaptionPosition] = useState("ล่าง");
  const [selectedDraft, setSelectedDraft] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderDone, setRenderDone] = useState(false);
  const [toast, setToast] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const selectedScriptData = initialScripts.find((item) => item.id === selectedScript) ?? initialScripts[0];
  const selectedStyleData = captionStyles.find((item) => item.id === selectedStyle) ?? captionStyles[0];
  const selectedVoiceData = voices.find((item) => item.id === selectedVoice) ?? voices[0];
  const currentChunks = scriptTexts[selectedScript] ?? selectedScriptData.chunks;

  const filteredVoices = voices.filter((voice) => voiceFilter === "ทั้งหมด" || voice.gender === voiceFilter);

  const renderStage = useMemo(() => {
    if (renderProgress < 20) return "กำลังเตรียมคลิปและจับจังหวะภาพ";
    if (renderProgress < 52) return "กำลังพากย์ท่อนที่ 5 จาก 12";
    if (renderProgress < 78) return "กำลังวางซับให้ตรงกับเสียง";
    if (renderProgress < 96) return "กำลังรวมภาพ เสียง และซับ";
    return "กำลังตรวจไฟล์รอบสุดท้าย";
  }, [renderProgress]);

  useEffect(() => {
    if (!rendering) return;
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
  }, [rendering]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectFile = (file?: File) => {
    if (!file) return;
    setUploadError("");
    if (!file.type.startsWith("video/")) {
      setUploadError("ไฟล์นี้ไม่ใช่วิดีโอ ลองเลือกไฟล์ MP4, MOV หรือ WebM อีกครั้ง");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setUploadError("ไฟล์ใหญ่เกิน 500 MB กรุณาบีบอัดหรือตัดให้สั้นลงก่อน");
      return;
    }
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setFileSize(`${(file.size / 1024 / 1024).toFixed(1)} MB`);
    setAnalyzing(true);
    window.setTimeout(() => setAnalyzing(false), 1400);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0]);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files?.[0]);
  };

  const goNext = () => {
    setCompletedSteps((current) =>
      current.includes(activeStep) ? current : [...current, activeStep],
    );
    if (activeStep < 5) setActiveStep((activeStep + 1) as WizardStep);
  };

  const previewVoice = (voiceId: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setToast("เบราว์เซอร์นี้ยังไม่รองรับการฟังตัวอย่างเสียง");
      return;
    }
    window.speechSynthesis.cancel();
    if (voicePlaying === voiceId) {
      setVoicePlaying(null);
      return;
    }
    const voice = voices.find((item) => item.id === voiceId) ?? voices[0];
    const utterance = new SpeechSynthesisUtterance(
      `สวัสดีค่ะ ฉัน${voice.name} พร้อมช่วยเล่าเรื่องสินค้าของคุณให้น่าฟังขึ้น`,
    );
    utterance.lang = "th-TH";
    utterance.rate = speed;
    utterance.onend = () => setVoicePlaying(null);
    setVoicePlaying(voiceId);
    window.speechSynthesis.speak(utterance);
  };

  const regenerateChunk = (index: number) => {
    const replacement = replacementLines[(index + selectedScript.length) % replacementLines.length];
    setScriptTexts((current) => ({
      ...current,
      [selectedScript]: current[selectedScript].map((line, lineIndex) =>
        lineIndex === index ? replacement : line,
      ),
    }));
    setToast(`เขียนท่อนที่ ${index + 1} ใหม่แล้ว โดยไม่กระทบท่อนอื่น`);
  };

  const startRender = () => {
    setActiveStep(5);
    setRenderDone(false);
    setRenderProgress(4);
    setRendering(true);
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
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      void videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <AppShell>
      <div className="wizard-page">
        <header className="wizard-heading">
          <div className="wizard-title-row">
            <Link href="/" className="back-link" aria-label="กลับหน้าภาพรวม"><ArrowLeft size={18} /></Link>
            <div>
              <div className="title-line">
                <h1>หัวชาร์จพกพาแม่เหล็ก</h1>
                <span className="autosave"><Check size={13} /> บันทึกแล้ว</span>
              </div>
              <p>โปรเจกต์ใหม่ · สร้างเมื่อสักครู่</p>
            </div>
          </div>
          <button className="button button-quiet" type="button" onClick={() => setToast("บันทึกโปรเจกต์ล่าสุดแล้ว") }>
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
                onClick={() => setActiveStep(step.id)}
                aria-current={active ? "step" : undefined}
              >
                <span className="step-number">{complete ? <Check size={15} /> : <Icon size={17} />}</span>
                <span className="step-copy"><b>{step.label}</b><small>{step.helper}</small></span>
                {index < steps.length - 1 && <i className="step-rail" />}
              </button>
            );
          })}
        </nav>

        <div className="wizard-workspace">
          <section className="wizard-card">
            {activeStep === 1 && (
              <div className="step-panel">
                <div className="step-panel-heading">
                  <span className="step-kicker">ขั้นที่ 1 จาก 5</span>
                  <h2>เริ่มจากคลิปสินค้าของคุณ</h2>
                  <p>เลือกคลิปแนวตั้งที่เห็นสินค้าได้ชัด เราจะจัดขนาด ตรวจฉาก และเตรียมพรีวิวให้เอง</p>
                </div>

                <div
                  className="upload-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    onChange={handleFileChange}
                    hidden
                  />
                  <span className="upload-illustration"><UploadCloud size={28} /></span>
                  <h3>ลากคลิปมาวางตรงนี้</h3>
                  <p>หรือ <span>เลือกไฟล์จากเครื่อง</span></p>
                  <small>รองรับ MP4, MOV, WebM · สูงสุด 500 MB</small>
                </div>
                {uploadError && <div className="form-alert error"><CircleAlert size={17} />{uploadError}</div>}

                <div className="asset-card">
                  <div className="asset-poster"><img src="/clippang-sample-poster.jpg" alt="ภาพตัวอย่างคลิปที่เลือก" /><Film size={17} /></div>
                  <div className="asset-info">
                    <h3>{fileName}</h3>
                    <p>{fileSize} · 720 × 1280 · 00:29</p>
                    <div className="asset-tags">
                      <span><CheckCircle2 size={13} /> แนวตั้ง 9:16</span>
                      <span><CheckCircle2 size={13} /> เสียงชัด</span>
                      <span className="warning"><CircleAlert size={13} /> พบซับเดิมบางช่วง</span>
                    </div>
                  </div>
                  <button type="button" className="icon-button" onClick={() => fileInputRef.current?.click()} aria-label="เปลี่ยนคลิป"><RotateCcw size={17} /></button>
                </div>

                {analyzing ? (
                  <div className="analysis-box"><LoaderCircle size={18} className="spin" /><div><b>กำลังตรวจคลิป...</b><span>กำลังดูฉาก แสง และซับที่ติดมากับวิดีโอ</span></div></div>
                ) : (
                  <div className="analysis-box ready"><BadgeCheck size={18} /><div><b>คลิปพร้อมใช้งาน</b><span>พบ 8 ฉาก · ความสว่างดี · จะครอปเป็น 1080 × 1920 อัตโนมัติ</span></div></div>
                )}
                <div className="copyright-note"><CircleAlert size={16} /><p>ใช้เฉพาะคลิปที่คุณมีสิทธิ์เผยแพร่ เพื่อป้องกันปัญหาลิขสิทธิ์และเนื้อหาซ้ำบนแพลตฟอร์ม</p></div>
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
                  <label className="field field-span-2"><span>ชื่อสินค้า <b>*</b></span><input defaultValue="หัวชาร์จพกพาแม่เหล็ก 5,000 mAh" /></label>
                  <label className="field"><span>หมวดหมู่</span><select defaultValue="mobile"><option value="mobile">มือถือและอุปกรณ์เสริม</option><option>บ้านและไลฟ์สไตล์</option><option>บิวตี้และสกินแคร์</option></select><ChevronDown size={15} /></label>
                  <label className="field"><span>ราคา / โปรโมชัน</span><input defaultValue="399 บาท จากปกติ 590 บาท" /></label>
                  <label className="field field-span-2"><span>จุดขายหลัก <b>*</b></span><textarea rows={4} defaultValue="ชาร์จไร้สายแบบแม่เหล็ก ติดแน่น น้ำหนักเบา ใช้เป็นห่วงจับมือถือได้ และพกขึ้นเครื่องได้" /><small>แยกแต่ละข้อด้วยเครื่องหมายจุลภาคได้</small></label>
                  <label className="field"><span>กลุ่มลูกค้า</span><input defaultValue="คนทำงาน ครีเอเตอร์ และคนเดินทางบ่อย" /></label>
                  <label className="field"><span>โทนที่อยากได้</span><select defaultValue="friend"><option value="friend">เหมือนเพื่อนแนะนำ</option><option>ขายเก่ง จังหวะไว</option><option>รีวิวจริงใจ</option><option>พรีเมียม ดูแพง</option></select><ChevronDown size={15} /></label>
                  <label className="field field-span-2"><span>คำที่อยากให้พูดปิดท้าย</span><input defaultValue="กดรับโปรที่ตะกร้าได้เลยค่ะ" /></label>
                </div>
                <div className="ai-tip"><span><Sparkles size={18} /></span><p><b>ไม่ต้องคิดให้ครบทุกคำ</b> ClipPang จะสร้างสคริปต์ให้เลือก 5 แนว และคุณแก้ทีละท่อนได้ในขั้นถัดไป</p></div>
              </div>
            )}

            {activeStep === 3 && (
              <div className="step-panel">
                <div className="step-panel-heading inline-heading">
                  <div><span className="step-kicker">ขั้นที่ 3 จาก 5</span><h2>เลือกเสียงที่เป็นตัวคุณ</h2><p>กดฟังตัวอย่างได้ทันที แล้วปรับความเร็วให้เข้ากับจังหวะคลิป</p></div>
                  <span className="library-count">30 เสียง</span>
                </div>
                <div className="filter-row">
                  {['ทั้งหมด','หญิง','ชาย'].map((filter) => <button type="button" key={filter} className={voiceFilter === filter ? "active" : ""} onClick={() => setVoiceFilter(filter)}>{filter}</button>)}
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
                <button className="show-more" type="button">ดูเสียงทั้งหมด 30 แบบ <ChevronDown size={15} /></button>

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
                  {initialScripts.map((script, index) => (
                    <button type="button" role="tab" aria-selected={selectedScript === script.id} className={selectedScript === script.id ? "active" : ""} onClick={() => setSelectedScript(script.id)} key={script.id}>
                      <span>แบบ {index + 1}</span><b>{script.name}</b><small>{script.tag}</small><em>{script.score}% เข้ากับคลิป</em>
                    </button>
                  ))}
                </div>
                <div className="script-editor">
                  <div className="editor-head"><div><span className="script-rank"><Sparkles size={14} /> AI แนะนำ</span><h3>{selectedScriptData.name}</h3></div><span>ประมาณ 27 วินาที</span></div>
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
                        <button type="button" onClick={() => regenerateChunk(index)} title="เขียนท่อนนี้ใหม่"><RotateCcw size={15} /></button>
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
                  <div><span className="step-kicker">ขั้นที่ 5 จาก 5</span><h2>{renderDone ? "คลิปของคุณพร้อมแล้ว 🎉" : "เลือกร่างที่ชอบที่สุด"}</h2><p>{renderDone ? "ตรวจดูแล้ว ดาวน์โหลดไฟล์ได้ทันที หรือเปิดโฟลเดอร์ผลงานบนเครื่อง" : "ร่างใช้เสียงและจังหวะจริง เลือกหนึ่งแบบก่อนสร้างไฟล์คุณภาพเต็ม"}</p></div>
                  {renderDone && <span className="ready-large"><CheckCircle2 size={17} /> พร้อมดาวน์โหลด</span>}
                </div>

                {!renderDone && !rendering && (
                  <>
                    <div className="draft-grid">
                      {captionStyles.slice(0, 3).map((style, index) => (
                        <button type="button" className={`draft-card ${selectedDraft === index ? "selected" : ""}`} onClick={() => { setSelectedDraft(index); setSelectedStyle(style.id); }} key={style.id}>
                          <span className="draft-video"><img src="/clippang-sample-poster.jpg" alt="" /><b className={style.className}>{style.label}</b><i><Play size={16} fill="currentColor" /></i></span>
                          <span><b>ร่าง {index + 1}</b><small>{style.name} · 00:29</small></span>
                          {selectedDraft === index && <em><Check size={13} /> เลือกแล้ว</em>}
                        </button>
                      ))}
                    </div>
                    <div className="render-summary"><div><span><Mic2 size={15} /> เสียง {selectedVoiceData.name}</span><span><Captions size={15} /> {selectedStyleData.name}</span><span><Clock3 size={15} /> ประมาณ 1–2 นาที</span></div><button className="button button-primary" type="button" onClick={startRender}><Zap size={17} /> สร้างคลิปตัวจริง</button></div>
                  </>
                )}

                {rendering && (
                  <div className="render-progress-card">
                    <div className="render-orbit"><span>{renderProgress}%</span></div>
                    <div className="render-copy"><span className="live-pill dark"><i /> กำลังสร้างคลิปตัวจริง</span><h3>{renderStage}</h3><p>คุณปิดหน้านี้ได้ งานจะทำต่อและกลับมาดูความคืบหน้าได้เสมอ</p><div className="render-bar"><span style={{ width: `${renderProgress}%` }} /></div><div className="render-time"><span>ผ่านไป 00:{String(Math.round(renderProgress * .8)).padStart(2,'0')}</span><span>เหลือประมาณ {Math.max(1, Math.round((100-renderProgress)*.8))} วินาที</span></div><button type="button" onClick={() => { setRendering(false); setRenderProgress(0); }}>ยกเลิกงาน</button></div>
                  </div>
                )}

                {renderDone && (
                  <div className="final-result">
                    <div className="final-video"><video src={videoUrl} poster="/clippang-sample-poster.jpg" controls playsInline /><span className={`final-caption ${selectedStyleData.className}`}>{currentChunks[1]}</span></div>
                    <div className="output-list">
                      <div className="output-head"><span className="output-icon"><Film size={20} /></span><div><h3>final.mp4</h3><p>1080 × 1920 · H.264 · 29 วินาที · 8.7 MB</p></div><a className="button button-primary button-small" href="/clippang-sample.mp4" download><Download size={15} /> MP4</a></div>
                      <button type="button" className="output-row" onClick={() => downloadText('srt')}><span><FileText size={17} /></span><div><b>captions.srt</b><small>ไฟล์ซับมาตรฐาน</small></div><Download size={16} /></button>
                      <button type="button" className="output-row" onClick={() => downloadText('json')}><span><FileAudio size={17} /></span><div><b>project.json</b><small>การตั้งค่าและสคริปต์ทั้งหมด</small></div><Download size={16} /></button>
                      <button type="button" className="button button-outline output-folder" onClick={() => setToast("ใน ClipPang Local ปุ่มนี้จะเปิดโฟลเดอร์ projects/.../out ให้ทันที") }><FolderOpen size={17} /> เปิดโฟลเดอร์ผลงาน</button>
                      <button type="button" className="text-button" onClick={() => { setRenderDone(false); setRenderProgress(0); }}>กลับไปแก้แล้วสร้างใหม่</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <footer className="wizard-card-footer">
              <button type="button" className="button button-quiet" disabled={activeStep === 1} onClick={() => setActiveStep((activeStep - 1) as WizardStep)}><ArrowLeft size={16} /> ย้อนกลับ</button>
              {activeStep < 5 ? <button type="button" className="button button-primary" onClick={goNext}>{activeStep === 1 ? "ใช้คลิปนี้" : activeStep === 2 ? "สร้างสคริปต์" : activeStep === 3 ? "เลือกเสียงนี้" : "ดูร่างคลิป"}<ArrowRight size={17} /></button> : !renderDone && !rendering ? <button type="button" className="button button-primary" onClick={startRender}><Zap size={17} /> สร้างคลิปตัวจริง</button> : null}
            </footer>
          </section>

          <aside className="live-preview-panel">
            <div className="preview-panel-head"><div><span className="live-dot"><i /> พรีวิวสด</span><p>อัปเดตตามที่คุณเลือก</p></div><span className="preview-quality">9:16 · HD</span></div>
            <div className="phone-stage">
              <div className="editor-phone">
                <video ref={videoRef} src={videoUrl} poster="/clippang-sample-poster.jpg" muted playsInline loop onEnded={() => setIsPlaying(false)} />
                <button className="video-toggle" type="button" onClick={toggleVideo} aria-label={isPlaying ? "หยุดวิดีโอ" : "เล่นวิดีโอ"}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
                <div className={`live-caption ${selectedStyleData.className} position-${captionPosition}`}>{currentChunks[0]}</div>
                <div className="video-safe-zone" aria-hidden="true"><span>safe area</span></div>
              </div>
            </div>
            <div className="preview-timeline">
              <div className="timeline-head"><span>00:00</span><b>00:29</b></div>
              <div className="timeline-track"><span className="scene s1"/><span className="scene s2"/><span className="scene s3"/><span className="scene s4"/><i /></div>
              <div className="waveform" aria-hidden="true">{Array.from({length:32}).map((_,index) => <i key={index} style={{ height: `${8 + (index * 7 % 18)}px` }} />)}</div>
            </div>
            <div className="preview-config">
              <div><span className="config-icon" style={{background:selectedVoiceData.color}}><Mic2 size={15}/></span><p><small>เสียงพากย์</small><b>{selectedVoiceData.name} · {speed.toFixed(1)}×</b></p></div>
              <div><span className="config-icon yellow"><Captions size={15}/></span><p><small>สไตล์ซับ</small><b>{selectedStyleData.name}</b></p></div>
              <div><span className="config-icon blue"><Gauge size={15}/></span><p><small>ความยาวโดยประมาณ</small><b>00:27–00:30</b></p></div>
            </div>
          </aside>
        </div>
      </div>
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}<button type="button" onClick={() => setToast("")} aria-label="ปิด"><X size={15}/></button></div>}
    </AppShell>
  );
}
