"use client";

import { useState } from "react";
import { localApi } from "../lib/local-api";
import { refreshProjects, releaseProjectMedia, removeProjectLocally } from "../lib/project-store";

/**
 * กล่องยืนยันลบโปรเจกต์ ใช้ร่วมกันทุกหน้าที่มีรายการโปรเจกต์
 *
 * ลำดับตอนลบสำคัญ: ต้องปล่อยไฟล์ที่เบราว์เซอร์ถือไว้ก่อนเสมอ ไม่งั้นเซิร์ฟเวอร์
 * ย้ายโฟลเดอร์ไม่ได้เพราะไฟล์ยังถูกเปิดค้าง แล้วผู้ใช้จะเจอ error ที่แก้เองไม่ได้
 */
export function DeleteProjectDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: { id: string; title: string } | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState("");

  if (!target) return null;

  const close = () => {
    if (deleting) return;
    setNote("");
    onClose();
  };

  return (
    <div className="confirm-backdrop">
      {/* ปุ่มจริงแทน div ที่ดักคลิก เพื่อให้ปิดด้วยคีย์บอร์ดได้และผ่านเกณฑ์ a11y */}
      <button type="button" className="confirm-scrim" aria-label="ปิดหน้าต่างยืนยัน" onClick={close} />
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">ลบ “{target.title}” ไหม</h2>
        <p>
          ไฟล์จะถูกย้ายไปที่โฟลเดอร์ <code>data/trash</code> บนเครื่องคุณ ไม่ได้ลบถาวร
          ถ้ากดพลาดยังเข้าไปกู้คืนเองได้
        </p>
        {note && <p className="confirm-error">{note}</p>}
        <div className="confirm-actions">
          <button type="button" className="button button-quiet" onClick={close} disabled={deleting}>ยกเลิก</button>
          <button
            type="button"
            className="button button-danger"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setNote("");
              releaseProjectMedia(target.id);
              localApi.deleteProject(target.id)
                .then(() => {
                  removeProjectLocally(target.id);
                  void refreshProjects();
                  onDeleted?.(target.id);
                  onClose();
                })
                .catch((error) => setNote(error instanceof Error ? error.message : "ลบไม่สำเร็จ ลองใหม่อีกครั้ง"))
                .finally(() => setDeleting(false));
            }}
          >
            {deleting ? "กำลังลบ…" : "ย้ายไปถังขยะ"}
          </button>
        </div>
      </div>
    </div>
  );
}
