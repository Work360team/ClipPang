"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Captions,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Plus,
  Radio,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { detectLocalEngine, localApi, type LocalEngineState, type LocalProject } from "../lib/local-api";

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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [engineState, setEngineState] = useState<LocalEngineState>("checking");
  const [setupReady, setSetupReady] = useState(false);
  const [recentProjects, setRecentProjects] = useState<LocalProject[]>([]);

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
        const [status, projects] = await Promise.all([
          localApi.setupStatus(),
          localApi.listProjects(),
        ]);
        if (active) {
          setSetupReady(Boolean(status.ready));
          setRecentProjects(projects.projects.slice(0, 2));
        }
      } catch {
        if (active) setSetupReady(false);
      }
    });
    return () => { active = false; };
  }, []);

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
            recentProjects.length ? recentProjects.map((project, index) => {
              const latest = project.renders?.[0];
              const status = latest?.state === "ready"
                ? (latest.kind === "final" ? "ตัวจริงพร้อมดาวน์โหลด" : "ร่างพร้อมให้เลือก")
                : latest && ["queued", "running", "processing"].includes(latest.state)
                  ? latest.message || `กำลังทำ ${latest.progress ?? 0}%`
                  : `ทำต่อจากขั้นที่ ${project.wizard_step ?? 1}`;
              return (
                <Link href={`/p/${project.id}`} className="mini-project" key={project.id}>
                  <span className={`mini-project-thumb ${index % 2 ? "thumb-mint" : "thumb-peach"}`} aria-hidden="true" />
                  <span>
                    <b>{project.title || "โปรเจกต์ไม่มีชื่อ"}</b>
                    <small>{status}</small>
                  </span>
                </Link>
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
            <Link href={engineState === "connected" ? "/setup" : "/setup"} className={`engine-chip engine-${engineState}`} title={engineState === "connected" ? "ClipPang Local เชื่อมต่ออยู่" : "หน้านี้เป็นเว็บตัวอย่าง"}>
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
