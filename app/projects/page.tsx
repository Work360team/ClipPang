"use client";

import { Film, Plus, Search, Trash2, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog";
import { HardLink as Link } from "../components/HardLink";
import { detectLocalEngine, type LocalEngineState, type LocalProject } from "../lib/local-api";
import { subscribeProjects } from "../lib/project-store";
import { toProjectCard } from "../lib/project-view";

type StatusFilter = "all" | "running" | "ready" | "draft";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "running", label: "กำลังทำ" },
  { id: "ready", label: "พร้อมดาวน์โหลด" },
  { id: "draft", label: "ร่าง" },
];

export default function ProjectsPage() {
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let active = true;
    void detectLocalEngine().then((engine) => {
      if (active) setEngineState(engine ? "connected" : "unavailable");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => subscribeProjects(setLocalProjects), []);

  // ต่อ engine ไม่ติด = ไม่มีข้อมูลจริง แสดงว่างไว้ตรง ๆ ดีกว่าเดารายการให้
  const cards = useMemo(
    () => (engineState === "connected" ? localProjects.map(toProjectCard) : [])
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [engineState, localProjects],
  );

  const counts = useMemo(() => ({
    all: cards.length,
    running: cards.filter((card) => card.statusClass === "running").length,
    ready: cards.filter((card) => card.statusClass === "ready").length,
    draft: cards.filter((card) => card.statusClass === "draft").length,
  }), [cards]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (filter !== "all" && card.statusClass !== filter) return false;
      return !needle || card.title.toLowerCase().includes(needle);
    });
  }, [cards, filter, query]);

  return (
    <AppShell>
      <div className="style-page">
        <header className="style-heading">
          <div>
            <div className="style-kicker"><Film size={15} strokeWidth={2.3} /> โปรเจกต์ของฉัน</div>
            <h1>รวมทุกคลิปที่ทำไว้</h1>
            <p>ค้นหา กลับไปทำต่อ หรือดาวน์โหลดไฟล์ที่เสร็จแล้ว ทุกอย่างอยู่บนเครื่องนี้</p>
          </div>
          <Link href="/p/new" className="button button-primary"><Plus size={16} /> สร้างคลิปใหม่</Link>
        </header>

        {engineState === "unavailable" ? (
          <div className="projects-empty">
            <WifiOff size={22} />
            <b>ยังไม่ได้เชื่อมต่อ Clip360 Local</b>
            <p>เปิดโปรแกรมด้วย เริ่มโปรแกรม.bat บนเครื่องแล้วรีเฟรชหน้านี้</p>
          </div>
        ) : (
          <>
            <div className="projects-toolbar">
              <div className="projects-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ค้นหาจากชื่อโปรเจกต์"
                  aria-label="ค้นหาโปรเจกต์"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>
                )}
              </div>
              <div className="style-filter-row" role="group" aria-label="กรองตามสถานะ">
                {FILTERS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={filter === item.id ? "active" : ""}
                    disabled={counts[item.id] === 0 && item.id !== "all"}
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label} <em>{counts[item.id]}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="project-list">
              {visible.length === 0 ? (
                <div className="projects-empty">
                  <Film size={22} />
                  {cards.length === 0 ? (
                    <>
                      <b>{engineState === "checking" ? "กำลังโหลดโปรเจกต์ของคุณ" : "ยังไม่มีโปรเจกต์"}</b>
                      <p>{engineState === "checking" ? "รอสักครู่…" : "เริ่มจากคลิปแรกได้เลย ทุกไฟล์จะอยู่บนเครื่องนี้"}</p>
                      {engineState !== "checking" && (
                        <Link href="/p/new" className="button button-primary"><Plus size={16} /> สร้างคลิปแรก</Link>
                      )}
                    </>
                  ) : (
                    <>
                      <b>ไม่พบโปรเจกต์ที่ตรงกับที่ค้นหา</b>
                      <p>ลองเปลี่ยนคำค้นหรือเลือกสถานะอื่น</p>
                    </>
                  )}
                </div>
              ) : visible.map((project) => (
                <div className="project-row-wrap" key={project.id}>
                  <Link href={project.href} className="project-row">
                    <div className="project-thumb">
                      <img src={project.image} alt="" />
                      {project.statusClass === "running" && <span className="project-progress-ring">{project.progress}</span>}
                    </div>
                    <div className="project-main">
                      <h3>{project.title}</h3>
                      <p>{project.meta}</p>
                      <span className={`project-status ${project.statusClass}`}><i /> {project.status}</span>
                    </div>
                    <time>{project.updated}</time>
                  </Link>
                  <button
                    type="button"
                    className="project-delete"
                    // ยังทำงานอยู่ก็ลบไม่ได้ ไม่งั้นไฟล์ถูกย้ายทิ้งกลางคันแล้ว worker พังแบบงง ๆ
                    disabled={project.running}
                    aria-label={`ลบโปรเจกต์ ${project.title}`}
                    title={project.running ? "กำลังสร้างคลิปอยู่ ลบไม่ได้ตอนนี้" : "ลบโปรเจกต์"}
                    onClick={() => setPendingDelete({ id: project.id, title: project.title })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <DeleteProjectDialog target={pendingDelete} onClose={() => setPendingDelete(null)} />
    </AppShell>
  );
}
