"use client";

import { localApi, type LocalProject } from "./local-api";

/**
 * รายชื่อโปรเจกต์ก้อนเดียวที่ทุกหน้าต่างของแอปใช้ร่วมกัน
 *
 * เดิมเมนูซ้ายกับหน้าภาพรวมต่างคนต่าง fetch แล้วเก็บ state ของตัวเอง ลบจากที่หนึ่ง
 * อีกที่จึงยังค้างอยู่จนกว่าจะรีเฟรชหน้า และสถานะที่เปลี่ยนระหว่างเรนเดอร์ก็ไม่ขึ้น
 * ที่เมนูซ้ายเลย ที่นี่เก็บรายการไว้ที่เดียว ใครแก้ก็กระจายให้ทุกที่พร้อมกัน
 */

type Listener = (projects: LocalProject[]) => void;

const listeners = new Set<Listener>();
let projects: LocalProject[] = [];
let loaded = false;
let inflight: Promise<LocalProject[]> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** ถี่พอให้เห็นความคืบหน้าระหว่างเรนเดอร์ แต่ไม่ถี่จนกวน SQLite บนเครื่องตัวเอง */
const POLL_MS = 4000;

function emit() {
  for (const listener of listeners) listener(projects);
}

/** ดึงรายการใหม่จากเซิร์ฟเวอร์ แล้วแจ้งทุกหน้าจอที่กำลังฟังอยู่ */
export async function refreshProjects(): Promise<LocalProject[]> {
  // ถ้ามีคำขอค้างอยู่แล้วให้ใช้ผลเดียวกัน กันการยิงซ้ำตอนหลายหน้าจอ mount พร้อมกัน
  if (inflight) return inflight;
  inflight = localApi.listProjects()
    .then((result) => {
      projects = result.projects;
      loaded = true;
      emit();
      return projects;
    })
    .catch(() => projects)
    .finally(() => { inflight = null; });
  return inflight;
}

/** เอาโปรเจกต์ออกจากรายการทันทีโดยไม่รอเซิร์ฟเวอร์ ให้ทุกหน้าจอตอบสนองพร้อมกัน */
export function removeProjectLocally(id: string) {
  const next = projects.filter((project) => project.id !== id);
  if (next.length === projects.length) return;
  projects = next;
  emit();
}

/**
 * ฟังรายการโปรเจกต์ คืนฟังก์ชันสำหรับเลิกฟัง
 * ผู้ฟังคนแรกเป็นคนเริ่ม polling และคนสุดท้ายที่เลิกฟังเป็นคนหยุด
 */
export function subscribeProjects(listener: Listener): () => void {
  listeners.add(listener);
  if (loaded) listener(projects);
  void refreshProjects();

  if (!timer) {
    timer = setInterval(() => { void refreshProjects(); }, POLL_MS);
    // กลับมาที่แท็บนี้แล้วต้องเห็นของจริงทันที ไม่ต้องรอรอบ polling ถัดไป
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    }
  };
}

function refreshOnFocus() {
  if (document.visibilityState === "visible") void refreshProjects();
}
