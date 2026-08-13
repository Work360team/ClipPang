"use client";

import { usePathname } from "next/navigation";
import {
  Bell,
  Captions,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Radio,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { detectLocalEngine, localApi, type LocalEngineState, type LocalProject } from "../lib/local-api";
import { HardLink as Link } from "./HardLink";

const navItems = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/p/new", label: "สร้างคลิป", icon: Sparkles },
  { href: "/styles", label: "สไตล์ซับ", icon: Captions },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
];

const pageTitles: Record<string, string> = {
  "/": "ภาพรวม",
  "/styles": "คลังสไตล์ซับ",
  "/settings": "ตั้งค่า",
};

/** ค่าที่เก็บใน settings เป็น JSON string (ฝั่งเซิร์ฟเวอร์ stringify ให้) */
function parsePinned(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function isRunning(project: LocalProject) {
  const latest = project.renders?.[0];
  return Boolean(latest && ["queued", "running", "processing"].includes(latest.state));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [setupReady, setSetupReady] = useState(false);
  const [allProjects, setAllProjects] = useState<LocalProject[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    detectLocalEngine().then(async (engine) => {
      if (!active) return;
      if (!engine) {
        setEngineState("unavailable");
        return;
      }
      setEngineState("connected");
      try {
        const [status, projects, settings] = await Promise.all([
          localApi.setupStatus(),
          localApi.listProjects(),
          localApi.settings().catch(() => null),
        ]);
        if (active) {
          setSetupReady(Boolean(status.ready));
          setAllProjects(projects.projects);
          setPinnedIds(parsePinned(settings?.settings?.pinnedProjects));
        }
      } catch {
        if (active) setSetupReady(false);
      }
    });
    return () => { active = false; };
  }, []);

  // ปิดเมนูสามจุดเมื่อคลิกที่อื่นหรือกด Esc
  useEffect(() => {
    if (!openMenu) return undefined;
    const close = () => setOpenMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // ที่ปักหมุดขึ้นก่อนเสมอ ที่เหลือเติมด้วยโปรเจกต์ล่าสุดจนครบสี่รายการ
  const pinnedProjects = pinnedIds
    .map((id) => allProjects.find((project) => project.id === id))
    .filter((project): project is LocalProject => Boolean(project));
  const restProjects = allProjects.filter((project) => !pinnedIds.includes(project.id));
  const sidebarProjects = [...pinnedProjects, ...restProjects.slice(0, Math.max(0, 4 - pinnedProjects.length))];

  const savePinned = async (ids: string[]) => {
    const previous = pinnedIds;
    setPinnedIds(ids);
    setOpenMenu(null);
    try {
      await localApi.updateSettings({ pinnedProjects: ids });
    } catch {
      setPinnedIds(previous);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await localApi.deleteProject(pendingDelete.id);
      setAllProjects((current) => current.filter((project) => project.id !== pendingDelete.id));
      if (pinnedIds.includes(pendingDelete.id)) {
        void savePinned(pinnedIds.filter((id) => id !== pendingDelete.id));
      }
      setPendingDelete(null);
      if (pathname === `/p/${pendingDelete.id}`) window.location.href = "/";
    } finally {
      setBusy(false);
    }
  };

  const currentTitle = pathname.startsWith("/p/")
    ? "สร้างคลิปใหม่"
    : pageTitles[pathname] ?? "ClipPang";

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <Link href="/" className="brand" aria-label="ClipPang หน้าแรก">
            <span className="brand-mark" aria-hidden="true">
              <span>C</span>
            </span>
            <span className="brand-word">ClipPang</span>
          </Link>
          <button
            type="button"
            className="icon-button sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label="ปิดเมนู"
          >
            <X size={20} />
          </button>
        </div>

        <Link href="/p/new" className="sidebar-create">
          <Plus size={18} strokeWidth={2.4} />
          สร้างคลิปใหม่
        </Link>

        <nav className="sidebar-nav" aria-label="เมนูหลัก">
          <p className="nav-kicker">พื้นที่ทำงาน</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : item.href === "/p/new"
                  ? pathname.startsWith("/p/")
                  : pathname.startsWith(item.href);
            return (
              <Link
                href={item.href}
                key={item.href}
                className={`sidebar-link ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} strokeWidth={2} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-projects">
          <div className="sidebar-section-title">
            <span>โปรเจกต์ล่าสุด</span>
            <Link href="/" aria-label="ดูโปรเจกต์ทั้งหมด">
              <ChevronRight size={15} />
            </Link>
          </div>
          {engineState === "connected" ? (
            sidebarProjects.length ? sidebarProjects.map((project, index) => {
              const latest = project.renders?.[0];
              const running = isRunning(project);
              const status = latest?.state === "ready"
                ? (latest.kind === "final" ? "ตัวจริงพร้อมดาวน์โหลด" : "ร่างพร้อมให้เลือก")
                : running
                  ? latest?.message || `กำลังทำ ${latest?.progress ?? 0}%`
                  : `ทำต่อจากขั้นที่ ${project.wizard_step ?? 1}`;
              const pinned = pinnedIds.includes(project.id);
              const title = project.title || "โปรเจกต์ไม่มีชื่อ";
              return (
                <div className={`mini-project-row ${openMenu === project.id ? "menu-open" : ""}`} key={project.id}>
                  <Link href={`/p/${project.id}`} className="mini-project">
                    <span className={`mini-project-thumb ${index % 2 ? "thumb-mint" : "thumb-peach"}`} aria-hidden="true" />
                    <span>
                      <b>{pinned && <Pin size={11} aria-label="ปักหมุดไว้" />}{title}</b>
                      <small>{status}</small>
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="mini-project-more"
                    aria-label={`ตัวเลือกของ ${title}`}
                    aria-expanded={openMenu === project.id}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenu((current) => (current === project.id ? null : project.id));
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {openMenu === project.id && (
                    // ไม่ต้อง stopPropagation: ปุ่มข้างในทำงานก่อน แล้ว listener ที่ window
                    // ค่อยปิดเมนู ซึ่งเป็นสิ่งที่ทั้งสองคำสั่งทำอยู่แล้ว
                    <div className="mini-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void savePinned(pinned ? pinnedIds.filter((id) => id !== project.id) : [...pinnedIds, project.id])}
                      >
                        {pinned ? <PinOff size={15} /> : <Pin size={15} />}
                        {pinned ? "เลิกปักหมุด" : "ปักหมุดไว้ในเมนู"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="mini-menu-danger"
                        disabled={running}
                        title={running ? "กำลังสร้างคลิปอยู่ ลบไม่ได้ตอนนี้" : undefined}
                        onClick={() => {
                          setOpenMenu(null);
                          setPendingDelete({ id: project.id, title });
                        }}
                      >
                        <Trash2 size={15} />
                        ลบโปรเจกต์
                      </button>
                    </div>
                  )}
                </div>
              );
            }) : (
              <Link href="/p/new" className="mini-project">
                <span className="mini-project-thumb thumb-mint" aria-hidden="true" />
                <span>
                  <b>สร้างโปรเจกต์แรก</b>
                  <small>เริ่มจากคลิปสินค้าของคุณ</small>
                </span>
              </Link>
            )
          ) : (
            <>
              <Link href="/p/charger" className="mini-project">
                <span className="mini-project-thumb thumb-peach" aria-hidden="true" />
                <span><b>หัวชาร์จพกพา</b><small>ตัวอย่างพร้อมดาวน์โหลด</small></span>
              </Link>
              <Link href="/p/serum" className="mini-project">
                <span className="mini-project-thumb thumb-mint" aria-hidden="true" />
                <span><b>เซรั่มผิวโกลว์</b><small>ตัวอย่างร่าง 3 เวอร์ชัน</small></span>
              </Link>
            </>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className={`system-ready engine-${engineState}`}>
            <span className="status-orbit" aria-hidden="true">
              <span />
            </span>
            <div>
              <b>{engineState === "connected" ? (setupReady ? "เครื่องนี้พร้อมใช้งาน" : "เชื่อมต่อ Local แล้ว") : engineState === "checking" ? "กำลังตรวจ ClipPang Local" : "เว็บตัวอย่าง ClipPang"}</b>
              <small>{engineState === "connected" ? (setupReady ? "Gemini และ FFmpeg พร้อมแล้ว" : "ตั้งค่าอีกเล็กน้อยก่อนเรนเดอร์") : engineState === "checking" ? "รอสักครู่…" : "เปิดด้วย เริ่มโปรแกรม.bat เพื่อใช้งานจริง"}</small>
            </div>
          </div>
          <Link href="/setup" className="help-link">
            <CircleHelp size={17} />
            ศูนย์ช่วยเหลือการติดตั้ง
          </Link>
        </div>
      </aside>

      {pendingDelete && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="sidebar-delete-title">
          <button type="button" className="confirm-scrim" aria-label="ยกเลิก" onClick={() => setPendingDelete(null)} />
          <div className="confirm-card">
            <h3 id="sidebar-delete-title">ลบ “{pendingDelete.title}” ?</h3>
            <p>ไฟล์จะถูกย้ายไปโฟลเดอร์ data/trash ไม่ได้ลบถาวร ถ้ากดพลาดยังกู้กลับมาเองได้</p>
            <div className="confirm-actions">
              <button type="button" className="button button-outline" disabled={busy} onClick={() => setPendingDelete(null)}>
                ยกเลิก
              </button>
              <button type="button" className="button button-danger" disabled={busy} onClick={() => void confirmDelete()}>
                {busy ? "กำลังลบ…" : "ลบโปรเจกต์"}
              </button>
            </div>
          </div>
        </div>
      )}

      {menuOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="ปิดเมนู"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="content-frame">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              className="icon-button menu-button"
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="เปิดเมนู"
            >
              <Menu size={21} />
            </button>
            <div className="crumb">
              <FolderKanban size={15} />
              <span>พื้นที่ของฉัน</span>
              <ChevronRight size={13} />
              <b>{currentTitle}</b>
            </div>
          </div>
          <div className="topbar-actions">
            <Link
              href={engineState === "connected" && setupReady ? "/settings" : "/setup"}
              className={`engine-chip engine-${engineState}`}
              title={engineState === "connected" && setupReady ? "เปิดการตั้งค่า ClipPang Local" : engineState === "connected" ? "ตั้งค่า ClipPang Local ให้เสร็จ" : "หน้านี้เป็นเว็บตัวอย่าง"}
            >
              <Radio size={14} />
              {engineState === "connected" ? "LOCAL เชื่อมต่อแล้ว" : engineState === "checking" ? "กำลังเชื่อมต่อ" : "WEB DEMO"}
            </Link>
            <button className="icon-button notification-button" type="button" aria-label="การแจ้งเตือน">
              <Bell size={19} />
              <span aria-hidden="true" />
            </button>
            <div className="profile-chip">
              <span className="avatar">C</span>
              <span className="profile-copy">
                <b>ClipPang Local</b>
                <small>ไม่ต้องมีบัญชี</small>
              </span>
            </div>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="เมนูมือถือ">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : item.href === "/p/new"
                ? pathname.startsWith("/p/")
                : pathname.startsWith(item.href);
          return (
            <Link href={item.href} key={item.href} className={active ? "active" : ""}>
              <Icon size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
