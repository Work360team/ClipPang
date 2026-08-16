"use client";

import { localApi, type LocalProject, type LocalRender } from "./local-api";

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
 * ภาพปกของโปรเจกต์ = เฟรมจริงจากคลิปที่เรนเดอร์ล่าสุด
 *
 * ทุกงานเรนเดอร์ทิ้ง poster ไว้ใน out/ อยู่แล้ว แต่รายการโปรเจกต์กลับโชว์ภาพ
 * ตัวอย่างใบเดียวกันหมดทุกอัน ทำให้ดูไม่ออกว่าอันไหนเป็นสินค้าอะไร
 * เลือกงานตัวจริงก่อน ถ้ายังไม่มีค่อยใช้ร่าง และข้ามงานที่ถูกมาร์กว่า stale
 * เพราะภาพของมันไม่ตรงกับสิ่งที่อยู่บน timeline แล้ว
 */
export function projectPoster(project: { renders?: LocalRender[] } | null | undefined): string | null {
  const renders = (project?.renders ?? []).filter((render) => !render.stale && render.outputs?.poster?.url);
  if (!renders.length) return null;
  const newest = (list: LocalRender[]) => list.reduce((best, render) => (
    String(render.finishedAt ?? render.createdAt ?? "") > String(best.finishedAt ?? best.createdAt ?? "") ? render : best
  ));
  const finals = renders.filter((render) => render.kind === "final");
  return newest(finals.length ? finals : renders).outputs!.poster!.url ?? null;
}

/**
 * ปล่อยไฟล์สื่อของโปรเจกต์ที่เบราว์เซอร์ยังถือค้างไว้ ก่อนสั่งลบ
 *
 * <video> ที่ชี้ไปยังไฟล์ในโปรเจกต์จะคาคำขอไว้กับเซิร์ฟเวอร์แม้หยุดเล่นแล้ว เซิร์ฟเวอร์
 * จึงยังเปิดไฟล์นั้นค้างอยู่ และบน Windows โฟลเดอร์ที่มีไฟล์ถูกเปิดอยู่จะย้ายไม่ได้
 * (EPERM) ทำให้ลบโปรเจกต์ไม่ผ่าน — ต้องตัด src ทิ้งแล้ว load() ใหม่ถึงจะปิดคำขอจริง
 */
export function releaseProjectMedia(id: string) {
  if (typeof document === "undefined") return;
  const marker = `/api/projects/${encodeURIComponent(id)}/`;
  document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((element) => {
    const source = element.currentSrc || element.src;
    if (!source || !source.includes(marker)) return;
    element.pause();
    element.removeAttribute("src");
    element.load();
  });
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
