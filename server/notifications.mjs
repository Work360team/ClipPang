/**
 * การแจ้งเตือน — สร้างจากข้อมูลที่มีอยู่แล้ว ไม่มีตารางใหม่
 *
 * ทุกอย่างที่ควรบอกผู้ใช้ถูกบันทึกไว้ในตาราง renders อยู่แล้ว (เสร็จเมื่อไหร่ ล้มเพราะอะไร
 * ค้างอยู่ในคิวกี่งาน) ส่วนโควตา Gemini อยู่ในหน่วยความจำของ tts-quota ที่นี่แค่แปลง
 * ข้อมูลพวกนั้นเป็นข้อความที่คนอ่านรู้เรื่อง จึงไม่มีสถานะให้ค้างหรือหลุดจากกัน
 *
 * "อ่านแล้ว" เก็บเป็นเวลาเดียว (notificationsSeenAt) ไม่ได้ทำเป็นรายอัน เพราะโปรแกรมนี้
 * ใช้คนเดียวบนเครื่องเดียว การกดดูครั้งหนึ่งคือเห็นทั้งหมดอยู่แล้ว
 */

/** เก็บเฉพาะช่วงที่ยังมีความหมาย ของเมื่อสามวันก่อนไม่ต้องเตือนแล้ว */
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 12;

const RUNNING_STATES = new Set(["queued", "running", "processing"]);

/**
 * ข้อความ error บางอันมี JSON ของ API ต่อท้ายมาทั้งก้อน ขึ้นแบบนั้นในแผงแจ้งเตือน
 * อ่านไม่รู้เรื่อง ตัดเหลือบรรทัดแรกก่อนวงเล็บปีกกา แล้วยุบช่องว่างซ้อน
 */
function cleanError(message) {
  const text = String(message ?? "").split("\n")[0].split("{")[0].replace(/\s+/g, " ").trim();
  return (text || "ไม่ทราบสาเหตุ").slice(0, 110);
}

function timeOf(render) {
  return render.finishedAt ?? render.startedAt ?? render.createdAt ?? 0;
}

function titleOf(project, fallback) {
  const name = String(project?.title ?? "").trim();
  return name || fallback;
}

export function buildNotifications({ store, quota = null, now = Date.now() } = {}) {
  const items = [];
  const renders = store.listRenders?.({ limit: 40 }) ?? [];
  const projects = new Map();
  const projectFor = (id) => {
    if (!projects.has(id)) projects.set(id, store.getProject?.(id) ?? null);
    return projects.get(id);
  };

  for (const render of renders) {
    const at = timeOf(render);
    if (!at || now - at > WINDOW_MS) continue;
    const projectId = render.projectId ?? render.project_id;
    const name = titleOf(projectFor(projectId), "โปรเจกต์ไม่มีชื่อ");
    const isFinal = render.kind === "final";

    if (render.state === "ready") {
      items.push({
        id: `ready-${render.id}`,
        tone: "success",
        title: isFinal ? "คลิปตัวจริงพร้อมดาวน์โหลด" : "ร่างพร้อมให้เลือกแล้ว",
        detail: name,
        at,
        href: projectId ? `/p/${projectId}` : null,
      });
    } else if (render.state === "failed") {
      items.push({
        id: `failed-${render.id}`,
        tone: "error",
        title: isFinal ? "สร้างคลิปตัวจริงไม่สำเร็จ" : "สร้างร่างไม่สำเร็จ",
        // ข้อความจริงจาก error ของงานนั้น ไม่ใช่คำว่า "เกิดข้อผิดพลาด" ลอย ๆ
        detail: cleanError(render.error?.message),
        at,
        href: projectId ? `/p/${projectId}` : null,
      });
    }
  }

  // งานที่ยังวิ่งอยู่รวมเป็นรายการเดียว ไม่งั้นคิวยาว ๆ จะท่วมรายการแจ้งเตือน
  const running = renders.filter((render) => RUNNING_STATES.has(render.state));
  if (running.length) {
    const latest = running.reduce((best, render) => (timeOf(render) > timeOf(best) ? render : best), running[0]);
    const projectId = latest.projectId ?? latest.project_id;
    items.push({
      id: `queue-${running.length}-${latest.id}`,
      tone: "progress",
      title: running.length === 1 ? "กำลังสร้างคลิปอยู่" : `กำลังสร้างคลิป ${running.length} งาน`,
      detail: latest.message || `${titleOf(projectFor(projectId), "โปรเจกต์")} · ${latest.progress ?? 0}%`,
      at: now,
      href: projectId ? `/p/${projectId}` : null,
      sticky: true,
    });
  }

  if (quota?.limited) {
    const minutes = Math.max(1, Math.round((quota.retryInMs ?? 0) / 60000));
    items.push({
      id: `quota-${quota.retryAt ?? "now"}`,
      tone: "warning",
      title: "คีย์ Gemini เต็มโควตาทุกใบ",
      detail: quota.retryInMs
        ? `สร้างเสียงต่อได้อีกครั้งในอีกราว ${minutes} นาที`
        : "เพิ่มคีย์จากอีกโปรเจกต์ในหน้าตั้งค่าเพื่อใช้ต่อได้เลย",
      at: now,
      href: "/settings",
      sticky: true,
    });
  }

  items.sort((a, b) => b.at - a.at);
  return items.slice(0, MAX_ITEMS);
}

/**
 * นับอันที่ยังไม่ได้อ่าน — ของที่ค้างอยู่ (คิว/โควตา) นับเสมอ เพราะมันคือสถานะปัจจุบัน
 * ไม่ใช่เหตุการณ์ที่ผ่านไปแล้ว การกดอ่านจึงไม่ควรทำให้มันหายไปทั้งที่ยังเป็นจริงอยู่
 */
export function countUnread(items, seenAt = 0) {
  return items.filter((item) => item.sticky || item.at > seenAt).length;
}
