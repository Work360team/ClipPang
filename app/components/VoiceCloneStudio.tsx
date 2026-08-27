"use client";

import { Check, Loader2, Mic, Square, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { localApi, type LocalVoiceClone, type VoiceCloneLibrary } from "../lib/local-api";

/** ต่ำกว่านี้โมเดลจับโทนเสียงไม่ทัน ตรงกับ MIN_REF_MS/MAX_REF_MS ฝั่งเซิร์ฟเวอร์ */
const MIN_SECONDS = 3;
const MAX_SECONDS = 15;

/**
 * อัดเสียงต้นแบบสำหรับให้เครื่องยนต์ในเครื่องโคลนตาม
 *
 * คนหนึ่งคนอัดได้หลายโทน เพราะโมเดลโคลนตามที่ได้ยินในตัวอย่างเท่านั้น สั่งให้
 * "อ่านแบบตื่นเต้น" ด้วยข้อความไม่ได้เหมือน Gemini อยากได้โทนไหนต้องอัดโทนนั้น
 */
export function VoiceCloneStudio({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (clone: LocalVoiceClone | null) => void;
}) {
  const [library, setLibrary] = useState<VoiceCloneLibrary | null>(null);
  const [speaker, setSpeaker] = useState("");
  const [tone, setTone] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // ค่าที่ต้องตั้งพร้อมกันทุกครั้งที่รายการเปลี่ยน — ชื่อกับโทนตั้งให้เฉพาะตอนที่ยังว่าง
  // จะได้ไม่ทับสิ่งที่ผู้ใช้กำลังพิมพ์หรือเลือกอยู่
  const applyLibrary = (result: VoiceCloneLibrary) => {
    setLibrary(result);
    setTone((current) => current || result.tones[0]?.id || "");
    setSpeaker((current) => current || result.speakers[0]?.speaker || "");
  };

  const reload = async () => {
    try {
      applyLibrary(await localApi.voiceClones());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดรายการเสียงไม่สำเร็จ");
    }
  };

  // โหลดรายการรอบแรก มีตัวกันไว้เผื่อผู้ใช้ออกจากขั้นนี้ก่อนคำขอจะกลับมา
  // ไม่งั้นจะไป setState ให้คอมโพเนนต์ที่ถูกถอดออกไปแล้ว
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await localApi.voiceClones();
        if (active) applyLibrary(result);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "โหลดรายการเสียงไม่สำเร็จ");
      }
    })();
    return () => { active = false; };
  }, []);

  // ปล่อยไมค์และเคลียร์ตัวจับเวลาเสมอเมื่อออกจากหน้านี้ ไม่งั้นไฟไมค์ค้างอยู่
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("เบราว์เซอร์นี้อัดเสียงไม่ได้ ลองใช้ Chrome หรือ Edge");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // เปิดตัวลดเสียงรบกวนไว้ เพราะเสียงต้นแบบที่มีเสียงแทรกทำให้โคลนออกมาเพี้ยน
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { void save(new Blob(chunksRef.current, { type: recorder.mimeType })); };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          // หยุดให้เองเมื่อครบเวลา ผู้ใช้ไม่ต้องคอยจ้องนาฬิกา
          if (current + 1 >= MAX_SECONDS) window.setTimeout(() => stopRecording(), 0);
          return current + 1;
        });
      }, 1000);
    } catch {
      setError("เปิดไมโครโฟนไม่ได้ — ต้องกดอนุญาตให้เบราว์เซอร์ใช้ไมค์ก่อน");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const save = async (blob: Blob) => {
    stopTracks();
    const name = speaker.trim() || "เสียงของฉัน";
    setBusy("กำลังถอดข้อความจากเสียงที่อัด…");
    setError("");
    try {
      const result = await localApi.addVoiceClone(blob, { speaker: name, tone });
      await reload();
      onSelect(result.clone);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกเสียงต้นแบบไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  const remove = async (clone: LocalVoiceClone) => {
    setBusy("กำลังลบ…");
    try {
      await localApi.deleteVoiceClone(clone.id);
      if (selectedId === clone.id) onSelect(null);
      await reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  };

  if (!library) {
    return <div className="clone-empty"><Loader2 size={18} className="spin" /> กำลังโหลดรายการเสียง…</div>;
  }

  if (!library.engine.ready) {
    return (
      <div className="clone-empty">
        <TriangleAlert size={20} />
        <b>ยังใช้เสียงในเครื่องไม่ได้</b>
        <p>{library.engine.reason}</p>
        <p className="clone-note">ติดตั้งได้ในหน้าตั้งค่า แล้วกลับมาอัดเสียงต้นแบบที่นี่</p>
      </div>
    );
  }

  const sample = library.tones.find((item) => item.id === tone)?.sample ?? "";

  return (
    <div className="clone-studio">
      <div className="clone-recorder">
        <label className="field">
          <span>ชื่อเจ้าของเสียง</span>
          <input
            value={speaker}
            list="clip360-speakers"
            placeholder="เช่น เสียงของฉัน"
            disabled={recording}
            onChange={(event) => setSpeaker(event.target.value)}
          />
          <datalist id="clip360-speakers">
            {library.speakers.map((item) => <option value={item.speaker} key={item.speaker} />)}
          </datalist>
        </label>

        <div className="field">
          <span>อัดไว้เป็นโทนไหน</span>
          <div className="tone-options">
            {library.tones.map((item) => (
              <button
                type="button"
                key={item.id}
                className={tone === item.id ? "active" : ""}
                disabled={recording}
                onClick={() => setTone(item.id)}
              >
                {item.id}
              </button>
            ))}
          </div>
        </div>

        <div className="clone-script">
          <small>อ่านประโยคนี้ด้วยโทน “{tone}” ให้เป็นธรรมชาติที่สุด</small>
          <p>{sample}</p>
        </div>

        <div className="clone-actions">
          {recording ? (
            <button type="button" className="button button-danger" onClick={stopRecording}>
              <Square size={15} /> หยุดอัด ({seconds} วิ)
            </button>
          ) : (
            <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void startRecording()}>
              <Mic size={16} /> {busy ? busy : "เริ่มอัด"}
            </button>
          )}
          <small>
            {recording
              ? seconds < MIN_SECONDS
                ? `อัดต่ออีกอย่างน้อย ${MIN_SECONDS - seconds} วินาที`
                : "กดหยุดได้เลยเมื่อพอใจ"
              : `พูดต่อเนื่อง ${MIN_SECONDS}–${MAX_SECONDS} วินาที ในที่เงียบ ไม่มีเพลงคลอ`}
          </small>
        </div>

        {!library.canTranscribe && (
          <p className="clone-note">
            ยังไม่ได้ติดตั้ง whisper.cpp ระบบจะถอดข้อความให้อัตโนมัติไม่ได้ — ติดตั้งในหน้าตั้งค่าก่อนจะได้ผลแม่นกว่า
          </p>
        )}
        {error && <p className="clone-error">{error}</p>}
      </div>

      <div className="clone-library">
        {library.speakers.length === 0 ? (
          <div className="clone-empty">
            <Mic size={20} />
            <b>ยังไม่มีเสียงต้นแบบ</b>
            <p>อัดสักโทนหนึ่งก่อน แล้วค่อยเพิ่มโทนอื่นทีหลังได้</p>
          </div>
        ) : library.speakers.map((person) => (
          <div className="clone-person" key={person.speaker}>
            <h4>{person.speaker} <em>{person.tones.length} โทน</em></h4>
            <div className="clone-takes">
              {person.tones.map((clone) => (
                <div className={`clone-take${selectedId === clone.id ? " active" : ""}`} key={clone.id}>
                  <button type="button" className="clone-pick" onClick={() => onSelect(clone)}>
                    <span className="clone-tone">{selectedId === clone.id && <Check size={13} strokeWidth={3} />} {clone.tone}</span>
                    <small>{clone.durationMs ? `${(clone.durationMs / 1000).toFixed(1)} วิ · ` : ""}{clone.text}</small>
                  </button>
                  <button
                    type="button"
                    className="clone-remove"
                    aria-label={`ลบเสียง ${clone.label}`}
                    disabled={Boolean(busy)}
                    onClick={() => void remove(clone)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
