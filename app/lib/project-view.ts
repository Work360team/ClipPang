"use client";

import { type LocalProject } from "./local-api";
import { projectPoster } from "./project-store";

/**
 * แปลงโปรเจกต์จากเซิร์ฟเวอร์เป็นข้อมูลที่การ์ดในหน้าเว็บใช้
 *
 * อยู่ที่เดียวเพราะทั้งหน้าภาพรวมและหน้ารวมโปรเจกต์วาดการ์ดหน้าตาเดียวกัน
 * ถ้าต่างคนต่างแปลง สถานะหรือข้อความจะเริ่มไม่ตรงกันตอนใดตอนหนึ่งโดยไม่มีใครสังเกต
 */

/** สถานะที่งานเรนเดอร์กำลังเดินอยู่ — ลบโปรเจกต์ตอนนี้ไม่ได้ */
const RUNNING_STATES = ["queued", "running", "ingesting", "processing", "retrying"];

export type ProjectCard = {
  id: string;
  title: string;
  meta: string;
  status: string;
  statusClass: "ready" | "running" | "draft";
  running: boolean;
  image: string;
  href: string;
  updated: string;
  updatedAt: number;
  progress: number;
};

export function toProjectCard(project: LocalProject): ProjectCard {
  const latest = project.renders?.[0];
  const ready = latest?.state === "ready";
  const running = Boolean(latest && RUNNING_STATES.includes(String(latest.state)));
  const updatedAt = project.updated_at ? new Date(project.updated_at).getTime() : 0;

  return {
    id: project.id,
    title: project.title,
    running,
    meta: ready
      ? (latest?.kind === "final" ? "คลิปตัวจริงพร้อมแล้ว" : "ร่างพร้อมให้เลือก")
      : running
        ? latest?.message || "กำลังประมวลผล"
        : `ทำต่อจากขั้นที่ ${project.wizard_step ?? 1}`,
    status: ready ? "พร้อมดาวน์โหลด" : running ? `กำลังทำ ${latest?.progress ?? 0}%` : "บันทึกแล้ว",
    statusClass: ready ? "ready" : running ? "running" : "draft",
    // เฟรมจริงจากคลิปที่เรนเดอร์แล้ว ถ้ายังไม่เคยเรนเดอร์ค่อยใช้ภาพตัวอย่าง
    image: projectPoster(project) ?? "/clip360-sample-poster.jpg",
    href: `/p/${encodeURIComponent(project.id)}`,
    updated: Number.isFinite(updatedAt) && updatedAt > 0
      ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" }).format(new Date(updatedAt))
      : "เมื่อสักครู่",
    updatedAt,
    progress: latest?.progress ?? 0,
  };
}
