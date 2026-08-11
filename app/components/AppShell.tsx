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
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

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

  useEffect(() => setMenuOpen(false), [pathname]);

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
          <Link href="/p/charger" className="mini-project">
            <span className="mini-project-thumb thumb-peach" aria-hidden="true" />
            <span>
              <b>หัวชาร์จพกพา</b>
              <small>พร้อมดาวน์โหลด</small>
            </span>
          </Link>
          <Link href="/p/serum" className="mini-project">
            <span className="mini-project-thumb thumb-mint" aria-hidden="true" />
            <span>
              <b>เซรั่มผิวโกลว์</b>
              <small>ร่าง 3 เวอร์ชัน</small>
            </span>
          </Link>
        </div>

        <div className="sidebar-bottom">
          <div className="system-ready">
            <span className="status-orbit" aria-hidden="true">
              <span />
            </span>
            <div>
              <b>เครื่องนี้พร้อมใช้งาน</b>
              <small>Gemini และ FFmpeg เชื่อมต่อแล้ว</small>
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
            <button className="icon-button notification-button" type="button" aria-label="การแจ้งเตือน">
              <Bell size={19} />
              <span aria-hidden="true" />
            </button>
            <div className="profile-chip">
              <span className="avatar">ป</span>
              <span className="profile-copy">
                <b>ปังปอนด์</b>
                <small>Creator</small>
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
