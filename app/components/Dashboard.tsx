"use client";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Play,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./AppShell";
import { HardLink as Link } from "./HardLink";
import { detectLocalEngine, localApi, type LocalEngineState, type LocalProject } from "../lib/local-api";
import { projectPoster, refreshProjects, releaseProjectMedia, removeProjectLocally, subscribeProjects } from "../lib/project-store";

type DashboardCard = {
  id: string | null;
  running: boolean;
  title: string;
  meta: string;
  status: string;
  statusClass: string;
  image: string;
  href: string;
  updated: string;
  progress?: number;
};

const demoProjects: DashboardCard[] = [
  {
    id: null,
    running: false,
    title: "หัวชาร์จพกพาแม่เหล็ก",
    meta: "29 วินาที · ซับป๊อปเหลือง",
    status: "พร้อมดาวน์โหลด",
    statusClass: "ready",
    image: "/clippang-sample-poster.jpg",
    href: "/p/charger",
    updated: "12 นาทีที่แล้ว",
  },
  {
    id: null,
    running: false,
    title: "เซรั่มผิวโกลว์ 7 วัน",
    meta: "42 วินาที · ซับมินิมอล",
    status: "ร่าง 3 เวอร์ชัน",
    statusClass: "draft",
    image: "/clippang-sample-poster.jpg",
    href: "/p/serum",
    updated: "เมื่อวาน 18:24",
  },
  {
    id: null,
    running: false,
    title: "แก้วเก็บความเย็น 890 ml",
    meta: "กำลังสร้างเสียงพากย์",
    status: "กำลังทำ 58%",
    statusClass: "running",
    image: "/clippang-sample-poster.jpg",
    href: "/p/cup",
    updated: "กำลังทำงาน",
  },
];

export function Dashboard() {
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteNote, setDeleteNote] = useState("");
  const [folderError, setFolderError] = useState("");

  useEffect(() => {
    let active = true;
    detectLocalEngine().then(async (engine) => {
      if (!active) return;
      if (!engine) return setEngineState("unavailable");
      setEngineState("connected");
    });
    return () => { active = false; };
  }, []);

  // ใช้คลังกลางร่วมกับเมนูซ้าย ลบที่นี่เมนูซ้ายหายตาม และกลับกัน
  useEffect(() => subscribeProjects(setLocalProjects), []);

  const projects = useMemo(() => engineState === "connected"
    ? localProjects.map((project) => {
      const latest = project.renders?.[0];
      const ready = latest?.state === "ready";
      const running = latest && ["queued", "running", "ingesting", "processing", "retrying"].includes(latest.state);
      return {
        id: project.id,
        running: Boolean(running),
        title: project.title,
        meta: ready ? (latest.kind === "final" ? "คลิปตัวจริงพร้อมแล้ว" : "ร่างพร้อมให้เลือก") : running ? latest.message || "กำลังประมวลผล" : `ทำต่อจากขั้นที่ ${project.wizard_step ?? 1}`,
        status: ready ? "พร้อมดาวน์โหลด" : running ? `กำลังทำ ${latest.progress ?? 0}%` : "บันทึกแล้ว",
        statusClass: ready ? "ready" : running ? "running" : "draft",
        // เฟรมจริงจากคลิปที่เรนเดอร์แล้ว ถ้ายังไม่เคยเรนเดอร์ค่อยใช้ภาพตัวอย่าง
        image: projectPoster(project) ?? "/clippang-sample-poster.jpg",
        href: `/p/${encodeURIComponent(project.id)}`,
        updated: project.updated_at ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" }).format(new Date(project.updated_at)) : "เมื่อสักครู่",
        progress: latest?.progress ?? 0,
      };
    })
    : demoProjects, [engineState, localProjects]);

  const runningProject = engineState === "connected"
    ? projects.find((project) => project.statusClass === "running")
    : projects[2];

  // สถิติต้องนับจากงานจริงบนเครื่อง ไม่ใช่ตัวเลขที่เขียนตายไว้
  // ตัวเลขปลอมในแดชบอร์ดทำให้ผู้ใช้เลิกเชื่อทั้งหน้า รวมถึงส่วนที่จริงด้วย
  const stats = useMemo(() => {
    if (engineState !== "connected") return null;
    let ready = 0;
    let running = 0;
    let attempts = 0;
    let succeeded = 0;
    for (const project of localProjects) {
      const renders = project.renders ?? [];
      if (renders.some((render) => render.state === "ready")) ready += 1;
      if (renders.some((render) => ["queued", "running", "ingesting", "processing", "retrying"].includes(render.state))) running += 1;
      for (const render of renders) {
        if (["ready", "failed"].includes(render.state)) attempts += 1;
        if (render.state === "ready") succeeded += 1;
      }
    }
    return {
      total: localProjects.length,
      ready,
      running,
      successRate: attempts > 0 ? Math.round((succeeded / attempts) * 100) : null,
    };
  }, [engineState, localProjects]);

  const openLatestOutput = async () => {
    setFolderError("");
    if (engineState !== "connected") {
      window.location.assign("/setup");
      return;
    }
    const project = localProjects.find((item) => item.renders?.some((render) => render.state === "ready"))
      ?? localProjects[0];
    if (!project) {
      window.location.assign("/p/new");
      return;
    }
    try {
      await localApi.openProject(project.id, "out");
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : "เปิดโฟลเดอร์ผลงานไม่สำเร็จ");
    }
  };

  return (
    <AppShell>
      <div className="dashboard page-stack">
        {engineState === "unavailable" && (
          <section className="local-mode-banner" role="status">
            <span><WifiOff size={17} /></span>
            <div><b>ตอนนี้กำลังดูเว็บตัวอย่าง</b><small>หากต้องการอัปโหลดและเรนเดอร์จริง ให้เปิด <strong>เริ่มโปรแกรม.bat</strong> จากโฟลเดอร์ ClipPang</small></div>
            <Link href="/setup">ดูวิธีเปิดใช้งาน <ArrowRight size={15} /></Link>
          </section>
        )}
        <section className="dashboard-heading">
          <div>
            <p className="eyebrow">แดชบอร์ดครีเอเตอร์</p>
            <h1>สวัสดีครับ ครีเอเตอร์ <span aria-hidden="true">👋</span></h1>
            <p>เปลี่ยนคลิปสินค้าดิบให้พร้อมปักตะกร้า—เสียงพากย์ ซับ และไฟล์ส่งออก ครบในที่เดียว</p>
          </div>
          <Link href="/p/new" className="button button-primary desktop-heading-cta">
            <Plus size={18} />
            สร้างคลิปใหม่
          </Link>
        </section>

        <section className="creator-hero">
          <div className="hero-copy">
            <span className="hero-pill"><Sparkles size={14} /> AI ช่วยคิดให้ครบทุกท่อน</span>
            <h2>คลิปพร้อมขาย<br /><mark>ในไม่กี่นาที</mark></h2>
            <p>
              วางคลิป กรอกจุดขาย แล้วเลือกเสียงที่ใช่ ClipPang จะสร้างสคริปต์ 5 แบบ
              พร้อมซับคาราโอเกะให้คุณเลือกก่อนเรนเดอร์จริง
            </p>
            <div className="hero-actions">
              <Link href="/p/new" className="button button-dark">
                <WandSparkles size={18} />
                เริ่มสร้างคลิป
              </Link>
              <Link href="/styles" className="button button-ghost-dark">
                ดูสไตล์ซับ <ArrowRight size={17} />
              </Link>
            </div>
            <div className="hero-proof">
              <span><Check size={14} /> ไม่ต้องตัดต่อเป็น</span>
              <span><Check size={14} /> ข้อมูลอยู่บนเครื่องคุณ</span>
            </div>
          </div>

          <div className="hero-studio" aria-label="ตัวอย่างก่อนและหลังใช้ ClipPang">
            <div className="hero-grid-lines" aria-hidden="true" />
            <div className="phone-preview hero-phone">
              <video
                src="/clippang-hero.mp4"
                poster="/clippang-hero-poster.jpg"
                muted
                playsInline
                loop
                autoPlay
                aria-label="ตัวอย่างคลิปสินค้าที่ใส่ซับแล้ว"
              />
              <span className="preview-badge"><Play size={10} fill="currentColor" /> 00:29</span>
              <div className="preview-caption preview-caption-pop">
                พกง่าย <em>ติดแน่น</em>ทุกที่
              </div>
            </div>
            <div className="floating-card floating-script">
              <span className="float-icon"><Sparkles size={16} /></span>
              <div><small>AI SCRIPT</small><b>พร้อมแล้ว 5 แบบ</b></div>
              <Check size={17} className="float-check" />
            </div>
            <div className="floating-card floating-voice">
              <span className="wave-mini"><i/><i/><i/><i/><i/></span>
              <div><small>VOICEOVER</small><b>เสียงเมษา · สดใส</b></div>
            </div>
            <div className="hero-sticker">ขาย<br />ปัง!</div>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="projects-panel panel">
            <div className="section-heading">
              <div>
                <h2>โปรเจกต์ล่าสุด</h2>
                <p>กลับมาทำต่อหรือดาวน์โหลดไฟล์ที่พร้อมแล้ว</p>
              </div>
              <Link href="/" className="text-link">ดูทั้งหมด <ChevronRight size={15} /></Link>
            </div>

            <div className="project-list">
              {projects.length === 0 && engineState === "connected" ? (
                <div className="projects-empty"><Film size={22} /><b>ยังไม่มีโปรเจกต์</b><p>เริ่มจากคลิปแรกได้เลย ทุกไฟล์จะอยู่บนเครื่องนี้</p><Link href="/p/new" className="button button-primary"><Plus size={16} /> สร้างคลิปแรก</Link></div>
              ) : projects.map((project) => (
                <div className="project-row-wrap" key={project.id ?? project.title}>
                  <Link href={project.href} className="project-row">
                    <div className="project-thumb">
                      <img src={project.image} alt="" />
                      {project.statusClass === "running" && <span className="project-progress-ring">{("progress" in project ? project.progress : 58)}</span>}
                    </div>
                    <div className="project-main">
                      <h3>{project.title}</h3>
                      <p>{project.meta}</p>
                      <span className={`project-status ${project.statusClass}`}>
                        <i /> {project.status}
                      </span>
                    </div>
                    <time>{project.updated}</time>
                  </Link>
                  {project.id && (
                    <button
                      type="button"
                      className="project-delete"
                      // ยังทำงานอยู่ก็ลบไม่ได้ ไม่งั้นไฟล์ถูกย้ายทิ้งกลางคันแล้ว worker พังแบบงง ๆ
                      disabled={project.running || deletingId === project.id}
                      aria-label={`ลบโปรเจกต์ ${project.title}`}
                      title={project.running ? "กำลังสร้างคลิปอยู่ ลบไม่ได้ตอนนี้" : "ลบโปรเจกต์"}
                      onClick={() => { if (project.id) setPendingDelete({ id: project.id, title: project.title }); }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <aside className="activity-column">
            {runningProject ? <div className="running-card panel-dark">
              <div className="running-top">
                <span className="live-pill"><i /> กำลังทำงาน</span>
                <Clock3 size={18} />
              </div>
              <h3>{runningProject.title}</h3>
              <p>{runningProject.meta}</p>
              <div className="running-progress"><span style={{ width: `${"progress" in runningProject ? runningProject.progress : 58}%` }} /></div>
              <div className="running-meta"><b>{"progress" in runningProject ? runningProject.progress : 58}%</b><span>ปิดหน้านี้ได้ งานจะทำต่อบนเครื่อง</span></div>
              <Link href={runningProject.href} className="running-link">ดูความคืบหน้า <ArrowRight size={16} /></Link>
            </div> : <div className="running-card panel-dark running-idle"><div className="running-top"><span className="live-pill">คิวว่าง</span><Clock3 size={18} /></div><h3>พร้อมสร้างคลิปใหม่</h3><p>ยังไม่มีงานที่กำลังประมวลผล</p><Link href="/p/new" className="running-link">เริ่มทำคลิป <ArrowRight size={16} /></Link></div>}

            <div className="quick-card panel">
              <div className="section-heading compact"><h2>ทางลัด</h2></div>
              <Link href="/p/new" className="quick-link">
                <span className="quick-icon yellow"><UploadCloud size={18} /></span>
                <span><b>วางคลิปใหม่</b><small>MP4, MOV สูงสุด 500 MB</small></span>
                <ChevronRight size={16} />
              </Link>
              <button type="button" className="quick-link quick-link-button" onClick={() => void openLatestOutput()}>
                <span className="quick-icon green"><FolderOpen size={18} /></span>
                <span><b>เปิดโฟลเดอร์ผลงาน</b><small>ดูไฟล์ที่เรนเดอร์แล้ว</small></span>
                <ChevronRight size={16} />
              </button>
              {folderError && <p className="quick-link-error" role="alert">{folderError}</p>}
              <Link href="/styles" className="quick-link">
                <span className="quick-icon purple"><Film size={18} /></span>
                <span><b>เลือกสไตล์โปรด</b><small>พรีวิวซับ 4 รูปแบบ</small></span>
                <ChevronRight size={16} />
              </Link>
            </div>
          </aside>
        </section>

        <section className="stats-strip" aria-label="สถิติการใช้งาน">
          <div><span className="stat-icon"><Film size={18} /></span><p><small>โปรเจกต์ทั้งหมด</small><b>{stats ? stats.total : 12}</b></p></div>
          <div><span className="stat-icon"><Clock3 size={18} /></span><p><small>{stats ? "กำลังทำอยู่" : "เวลาที่ประหยัด"}</small><b>{stats ? `${stats.running} งาน` : "4.8 ชม."}</b></p></div>
          <div><span className="stat-icon"><Download size={18} /></span><p><small>คลิปที่เสร็จแล้ว</small><b>{stats ? stats.ready : "98%"}</b></p></div>
          <div className="stats-message"><Sparkles size={18} />{stats
            ? <span>{stats.successRate === null
                ? "ยังไม่มีงานที่เรนเดอร์เสร็จ — สร้างคลิปแรกได้เลย"
                : <>เรนเดอร์สำเร็จ <b>{stats.successRate}%</b> จากทั้งหมด {stats.ready + Math.max(0, stats.total - stats.ready)} โปรเจกต์</>}</span>
            : <span>คุณสร้างคลิปเร็วขึ้น <b>3.2 เท่า</b> จากสัปดาห์แรก</span>}</div>
        </section>
      </div>

      {pendingDelete && (
        <div className="confirm-backdrop">
          {/* ปุ่มจริงแทน div ที่ดักคลิก เพื่อให้ปิดด้วยคีย์บอร์ดได้และผ่านเกณฑ์ a11y */}
          <button type="button" className="confirm-scrim" aria-label="ปิดหน้าต่างยืนยัน" onClick={() => setPendingDelete(null)} />
          <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">ลบ “{pendingDelete.title}” ไหม</h2>
            <p>
              ไฟล์จะถูกย้ายไปที่โฟลเดอร์ <code>data/trash</code> บนเครื่องคุณ ไม่ได้ลบถาวร
              ถ้ากดพลาดยังเข้าไปกู้คืนเองได้
            </p>
            {deleteNote && <p className="confirm-error">{deleteNote}</p>}
            <div className="confirm-actions">
              <button type="button" className="button button-quiet" onClick={() => setPendingDelete(null)} disabled={Boolean(deletingId)}>ยกเลิก</button>
              <button
                type="button"
                className="button button-danger"
                disabled={Boolean(deletingId)}
                onClick={() => {
                  const target = pendingDelete;
                  setDeletingId(target.id);
                  setDeleteNote("");
                  // ปล่อยไฟล์ที่เบราว์เซอร์ถือไว้ก่อน ไม่งั้นเซิร์ฟเวอร์ย้ายโฟลเดอร์ไม่ได้
                  releaseProjectMedia(target.id);
                  localApi.deleteProject(target.id)
                    .then(() => {
                      removeProjectLocally(target.id);
                      void refreshProjects();
                      setPendingDelete(null);
                    })
                    .catch((error) => setDeleteNote(error instanceof Error ? error.message : "ลบไม่สำเร็จ ลองใหม่อีกครั้ง"))
                    .finally(() => setDeletingId(null));
                }}
              >
                {deletingId ? "กำลังลบ…" : "ย้ายไปถังขยะ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
