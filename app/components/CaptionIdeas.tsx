"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { localApi, type LocalCaptionSet } from "../lib/local-api";

/**
 * แคปชั่นพร้อมแฮชแท็กสำหรับเอาไปวางตอนอัปโหลด
 *
 * แทนที่กล่องพรีวิวสดหลังเรนเดอร์เสร็จ เพราะถึงตอนนั้นพรีวิวไม่บอกอะไรเพิ่มแล้ว
 * แต่สิ่งที่ผู้ใช้ต้องทำต่อทันทีคือเขียนแคปชั่น ซึ่งเป็นงานที่คนส่วนใหญ่ติด
 */
export function CaptionIdeas({ projectId, onToast }: { projectId: string | null; onToast: (message: string) => void }) {
  const [data, setData] = useState<LocalCaptionSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const generate = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const result = await localApi.generateCaptions(projectId);
      setData(result.captions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "สร้างแคปชั่นไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // ชุดที่เคยสร้างไว้ถูกเก็บกับโปรเจกต์ กลับมาหน้าเดิมจึงเห็นของเดิมไม่ต้องสร้างซ้ำ
  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    localApi.captions(projectId)
      .then((result) => { if (active) setData(result.captions ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [projectId]);

  const copy = async (idea: { angle: string; text: string; hashtags: string[] }) => {
    const payload = `${idea.text}\n\n${idea.hashtags.map((tag) => `#${tag}`).join(" ")}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(idea.angle);
      window.setTimeout(() => setCopied(""), 1800);
      onToast("คัดลอกแคปชั่นพร้อมแฮชแท็กแล้ว");
    } catch {
      onToast("คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วกด Ctrl+C");
    }
  };

  return (
    <aside className="caption-ideas-panel">
      <div className="preview-panel-head">
        <div>
          <span className="live-dot idea-dot"><Sparkles size={13} /> แคปชั่นสำหรับโพสต์</span>
          <p>{data ? "กดคัดลอกแล้ววางตอนอัปโหลดได้เลย" : "ให้ ClipPang ร่างแคปชั่นหลายแนวให้เลือก"}</p>
        </div>
        {data && (
          <button type="button" className="text-button" onClick={() => void generate()} disabled={loading}>
            <RefreshCw size={14} /> ขอใหม่
          </button>
        )}
      </div>

      {!data && !loading && (
        <div className="idea-empty">
          <p>แคปชั่น 5 แนว พร้อมแฮชแท็ก — ตะขอ เล่าเรื่อง สรุปสั้น ชวนคุย และเร่งตัดสินใจ</p>
          <button type="button" className="button button-primary button-small" onClick={() => void generate()}>
            <Sparkles size={15} /> สร้างแคปชั่นให้หน่อย
          </button>
        </div>
      )}

      {loading && <p className="idea-note">กำลังคิดแคปชั่นให้…</p>}
      {error && <p className="idea-note idea-error" role="alert">{error}</p>}

      {data && (
        <>
          <ul className="idea-list">
            {data.captions.map((idea) => (
              <li className="idea-card" key={idea.angle}>
                <div className="idea-card-head">
                  <b>{idea.label}</b>
                  <button
                    type="button"
                    className="idea-copy"
                    aria-label={`คัดลอกแคปชั่นแนว${idea.label}`}
                    onClick={() => void copy(idea)}
                  >
                    {copied === idea.angle ? <Check size={14} /> : <Copy size={14} />}
                    {copied === idea.angle ? "คัดลอกแล้ว" : "คัดลอก"}
                  </button>
                </div>
                <p className="idea-text">{idea.text}</p>
                {/* ใส่ # ให้ครบทุกตัว ไม่ใช้ไอคอนแทนตัวแรก เพราะเวลาลากคลุมคัดลอกเอง
                    ไอคอนจะไม่ติดไปด้วย แล้วแท็กแรกจะกลายเป็นคำเปล่า ๆ */}
                <p className="idea-tags">{idea.hashtags.map((tag) => `#${tag}`).join(" ")}</p>
              </li>
            ))}
          </ul>
          {data.fallbackFrom && (
            <p className="idea-note">ใช้ตัวเขียนสำรองในเครื่อง เพราะ {data.fallbackFrom}</p>
          )}
          {!data.fallbackFrom && data.provider.startsWith("template") && (
            <p className="idea-note">เขียนด้วยแม่แบบในเครื่อง — ตั้งค่าผู้ช่วย AI ในหน้าตั้งค่าเพื่อให้ได้แคปชั่นที่หลากหลายกว่านี้</p>
          )}
        </>
      )}
    </aside>
  );
}
