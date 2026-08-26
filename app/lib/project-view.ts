"use client";

import { type LocalProject, type LocalRender } from "./local-api";
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

/**
 * บรรทัดรองของคลิปที่เสร็จแล้ว — ความยาวกับขนาดไฟล์
 *
 * เดิมเขียนว่า "คลิปตัวจริงพร้อมแล้ว" ซึ่งซ้ำกับป้ายสถานะข้าง ๆ ที่บอกว่าพร้อม
 * ดาวน์โหลดอยู่แล้ว สองบรรทัดจึงไม่ได้บอกอะไรเพิ่ม ส่วนความยาวกับขนาดไฟล์คือ
 * สิ่งที่ต้องรู้ก่อนเอาไปลง ไม่ต้องเปิดคลิปดูเอง
 *
 * selectedTotalMs ตรงกับความยาวไฟล์ .mp4 ที่ ffprobe อ่านได้ (19700 กับ 19.70 วิ)
 */
function outputSummary(latest: LocalRender | undefined) {
  const config = (latest?.config ?? {}) as { selectedTotalMs?: number };
  const durationMs = Number(latest?.outputs?.video?.durationMs ?? config.selectedTotalMs ?? 0);
  const bytes = Number(latest?.outputs?.video?.sizeBytes ?? 0);
  const parts: string[] = [];
  if (durationMs > 0) parts.push(`${Math.round(durationMs / 1000)} วินาที`);
  if (bytes > 0) parts.push(`${(bytes / 1048576).toFixed(1)} MB`);
  return parts.join(" · ");
}

export function toProjectCard(project: LocalProject): ProjectCard {
  const latest = project.renders?.[0];
  const ready = latest?.state === "ready";
  const final = latest?.kind === "final";
  const running = Boolean(latest && RUNNING_STATES.includes(String(latest.state)));
  const updatedAt = project.updated_at ? new Date(project.updated_at).getTime() : 0;

  return {
    id: project.id,
    title: project.title,
    running,
    meta: ready
      // งานเก่าที่ไม่มีขนาดหรือความยาวเก็บไว้ ยังต้องมีอะไรให้อ่านอยู่ดี
      ? outputSummary(latest) || (final ? "คลิปตัวจริงพร้อมแล้ว" : "ร่างพร้อมให้เลือก")
      : running
        ? latest?.message || "กำลังประมวลผล"
        : `ทำต่อจากขั้นที่ ${project.wizard_step ?? 1}`,
    status: ready
      ? (final ? "พร้อมดาวน์โหลด" : "ร่างพร้อมดู")
      : running ? `กำลังทำ ${latest?.progress ?? 0}%` : "บันทึกแล้ว",
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
