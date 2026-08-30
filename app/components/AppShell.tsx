"use client";

import { usePathname } from "next/navigation";
import {
  Captions,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  Film,
  LayoutDashboard,
  Mic,
  Menu,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Radio,
  Settings,
  Sparkles,
  LogOut,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { detectLocalEngine, localApi, type LocalEngineState, type LocalProject } from "../lib/local-api";
import { projectPoster, refreshProjects, releaseProjectMedia, removeProjectLocally, subscribeProjects } from "../lib/project-store";
import { HardLink as Link } from "./HardLink";
import { NotificationBell } from "./NotificationBell";

const navItems = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/projects", label: "โปรเจกต์", icon: Film },
  { href: "/p/new", label: "สร้างคลิป", icon: Sparkles },
  { href: "/styles", label: "สไตล์ซับ", icon: Captions },
  { href: "/voices", label: "เสียงของฉัน", icon: Mic },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
];

/** แถบล่างบนมือถือรับได้ห้าช่องก่อนที่ป้ายจะเริ่มตัดคำ เสียงของฉันจึงอยู่ในเมนูเต็ม
 *  ซึ่งเปิดจากปุ่มขีดสามขีด และมีลิงก์ตรงจากขั้นเลือกเสียงอยู่แล้ว */
const mobileNavItems = navItems.filter((item) => item.href !== "/voices");

const pageTitles: Record<string, string> = {
  "/": "ภาพรวม",
  "/projects": "โปรเจกต์ของฉัน",
  "/styles": "คลังสไตล์ซับ",
  "/voices": "เสียงของฉัน",
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
  // ใครที่เข้ามาผ่านหน้าล็อกอินเท่านั้นที่ควรเห็นปุ่มออกจากระบบ
  const [account, setAccount] = useState<{ username: string; canSignOut: boolean } | null>(null);
  const [allProjects, setAllProjects] = useState<LocalProject[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteNote, setDeleteNote] = useState("");

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
        const [status, settings, me] = await Promise.all([
          localApi.setupStatus(),
          localApi.settings().catch(() => null),
          localApi.account().catch(() => null),
        ]);
        if (active) {
          setSetupReady(Boolean(status.ready));
          setPinnedIds(parsePinned(settings?.settings?.pinnedProjects));
          setAccount(me ? { username: me.username, canSignOut: me.canSignOut } : null);
        }
      } catch {
        if (active) setSetupReady(false);
      }
    });
    return () => { active = false; };
  }, []);

  // รายการโปรเจกต์มาจากคลังกลาง ลบหรือสร้างที่หน้าไหนเมนูซ้ายก็ตามทันที
  // และสถานะระหว่างเรนเดอร์ก็ไหลเข้ามาเองโดยไม่ต้องรีเฟรชหน้า
  useEffect(() => subscribeProjects(setAllProjects), []);

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
    const target = pendingDelete;
    setBusy(true);
    setDeleteNote("");
    // ปล่อยไฟล์ที่เบราว์เซอร์ถือไว้ก่อน ไม่งั้นเซิร์ฟเวอร์ย้ายโฟลเดอร์ไม่ได้
    releaseProjectMedia(target.id);
    try {
      await localApi.deleteProject(target.id);
    } catch (error) {
      // 404 แปลว่าโปรเจกต์หายไปแล้ว (เช่นลบจากอีกหน้าหนึ่ง) ซึ่งก็คือผลลัพธ์ที่ต้องการอยู่ดี
      // ปล่อยให้ error หลุดออกไปจะทำให้รายการค้างอยู่ทั้งที่ของจริงไม่มีแล้ว
      const code = (error as { code?: string })?.code;
      if (code !== "PROJECT_NOT_FOUND") {
        setDeleteNote(error instanceof Error ? error.message : "ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
        setBusy(false);
        return;
      }
    }
    removeProjectLocally(target.id);
    void refreshProjects();
    if (pinnedIds.includes(target.id)) {
      void savePinned(pinnedIds.filter((id) => id !== target.id));
    }
    setPendingDelete(null);
    setBusy(false);
    if (pathname === `/p/${target.id}`) window.location.href = "/";
  };

  const currentTitle = pathname.startsWith("/p/")
    ? "สร้างคลิปใหม่"
    : pageTitles[pathname] ?? "Clip360";

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <Link href="/" className="brand" aria-label="Clip360 หน้าแรก">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-mark" src="/clip360-logo-192.png" alt="" width={35} height={35} aria-hidden="true" />
            <span className="brand-word">Clip360</span>
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
            <Link href="/projects" aria-label="ดูโปรเจกต์ทั้งหมด">
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
              const open = pathname === `/p/${project.id}`;
              const poster = projectPoster(project);
              return (
                <div className={`mini-project-row ${openMenu === project.id ? "menu-open" : ""} ${open ? "is-open" : ""}`} key={project.id}>
                  <Link href={`/p/${project.id}`} className="mini-project" aria-current={open ? "page" : undefined}>
                    {poster
                      ? <img className="mini-project-thumb" src={poster} alt="" loading="lazy" />
                      : <span className={`mini-project-thumb ${index % 2 ? "thumb-mint" : "thumb-peach"}`} aria-hidden="true" />}
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
            // เดิมโชว์โปรเจกต์ตัวอย่างสองอันตอนยังต่อ engine ไม่ติด ซึ่งเกิดทุกครั้งที่โหลดหน้า
            // คนที่เพิ่งล็อกอินจึงเห็นชื่อโปรเจกต์ที่ไม่ใช่ของตัวเองแวบหนึ่ง เหมือนข้อมูลรั่ว
            <div className="mini-project mini-project-loading">
              <span className="mini-project-thumb thumb-mint" aria-hidden="true" />
              <span><b>{engineState === "checking" ? "กำลังโหลด…" : "ยังไม่ได้เชื่อมต่อ"}</b><small>{engineState === "checking" ? "ดึงโปรเจกต์ของคุณอยู่" : "เปิด Clip360 Local เพื่อดูโปรเจกต์"}</small></span>
            </div>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className={`system-ready engine-${engineState}`}>
            <span className="status-orbit" aria-hidden="true">
              <span />
            </span>
            <div>
              <b>{engineState === "connected" ? (setupReady ? "เครื่องนี้พร้อมใช้งาน" : "เชื่อมต่อ Local แล้ว") : engineState === "checking" ? "กำลังตรวจ Clip360 Local" : "เว็บตัวอย่าง Clip360"}</b>
              <small>{engineState === "connected" ? (setupReady ? "Gemini และ FFmpeg พร้อมแล้ว" : "ตั้งค่าอีกเล็กน้อยก่อนเรนเดอร์") : engineState === "checking" ? "รอสักครู่…" : "เปิดด้วย เริ่มโปรแกรม.bat เพื่อใช้งานจริง"}</small>
            </div>
          </div>
          <Link href="/setup" className="help-link">
            <CircleHelp size={17} />
            ศูนย์ช่วยเหลือการติดตั้ง
          </Link>
          {account?.canSignOut && (
            // ส่งเป็นฟอร์ม POST จริง ไม่ใช่ลิงก์ เพราะ GET ที่เตะคนออกจากระบบได้
            // ถูกกดแทนผู้ใช้จากที่อื่นได้ และยังทำงานต่อได้แม้ JS ไม่ทำงาน
            <form method="post" action="/api/auth/logout" className="signout-form">
              <button type="submit" className="signout-button">
                <LogOut size={17} />
                <span>ออกจากระบบ<small>{account.username}</small></span>
              </button>
            </form>
          )}
        </div>
      </aside>

      {pendingDelete && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="sidebar-delete-title">
          <button type="button" className="confirm-scrim" aria-label="ยกเลิก" onClick={() => setPendingDelete(null)} />
          <div className="confirm-card">
            <h3 id="sidebar-delete-title">ลบ “{pendingDelete.title}” ?</h3>
            <p>ไฟล์จะถูกย้ายไปโฟลเดอร์ data/trash ไม่ได้ลบถาวร ถ้ากดพลาดยังกู้กลับมาเองได้</p>
            {deleteNote && <p className="confirm-note" role="alert">{deleteNote}</p>}
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
              title={engineState === "connected" && setupReady ? "เปิดการตั้งค่า Clip360 Local" : engineState === "connected" ? "ตั้งค่า Clip360 Local ให้เสร็จ" : "หน้านี้เป็นเว็บตัวอย่าง"}
            >
              <Radio size={14} />
              {engineState === "connected" ? "LOCAL เชื่อมต่อแล้ว" : engineState === "checking" ? "กำลังเชื่อมต่อ" : "WEB DEMO"}
            </Link>
            <NotificationBell engineState={engineState} />
            <div className="profile-chip">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="avatar" src="/clip360-logo-192.png" alt="" width={34} height={34} aria-hidden="true" />
              <span className="profile-copy">
                <b>Clip360 Local</b>
                <small>ไม่ต้องมีบัญชี</small>
              </span>
            </div>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="เมนูมือถือ">
        {mobileNavItems.map((item) => {
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
