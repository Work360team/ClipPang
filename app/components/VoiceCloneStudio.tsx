"use client";

import { Check, Loader2, Mic, Square, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { localApi, type LocalVoiceClone, type VoiceCloneLibrary, type VoiceGender } from "../lib/local-api";
import { toneSample, VOICE_GENDERS } from "../../pipeline/core.mjs";

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
  locked = false,
  onActivityChange,
}: {
  selectedId: string | null;
  onSelect: (clone: LocalVoiceClone | null) => void;
  locked?: boolean;
  onActivityChange?: (active: boolean) => void;
}) {
  const [library, setLibrary] = useState<VoiceCloneLibrary | null>(null);
  const [speaker, setSpeaker] = useState("");
  const [tone, setTone] = useState("");
  // ไม่ตั้งค่าเริ่มต้นให้ เพราะเดาเพศของคนอื่นแทนเขาไม่ได้ และประโยคที่ให้อ่าน
  // ต้องลงท้ายให้ตรงเพศ ไม่งั้นเสียงต้นแบบจะฝืนตั้งแต่ประโยคแรก
  const [gender, setGender] = useState<VoiceGender | "">("");
  const [script, setScript] = useState("");
  const [scriptEdited, setScriptEdited] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  // getUserMedia อาจค้างอยู่ที่กล่องขอสิทธิ์หลายนาที ระหว่างนั้น React state
  // ยังไม่ทันกันการกดซ้ำ จึงต้องมี ref ที่ล็อกตั้งแต่ event แรกทันที
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const lockedRef = useRef(locked);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    onActivityChange?.(recording || Boolean(busy));
  }, [busy, onActivityChange, recording]);
  useEffect(() => () => onActivityChange?.(false), [onActivityChange]);
  // ค่าที่ต้องตั้งพร้อมกันทุกครั้งที่รายการเปลี่ยน — ชื่อกับโทนตั้งให้เฉพาะตอนที่ยังว่าง
  // จะได้ไม่ทับสิ่งที่ผู้ใช้กำลังพิมพ์หรือเลือกอยู่
  const applyLibrary = useCallback((result: VoiceCloneLibrary) => {
    setLibrary(result);
    setTone((current) => current || result.tones[0]?.id || "");
    setSpeaker((current) => current || result.speakers[0]?.speaker || "");
    // ตอนเปิดโปรเจกต์กลับมา parent มีเพียง id ที่บันทึกไว้ เติม metadata ให้ครบ
    // เพื่อรู้เพศของเสียงก่อนอนุญาตให้สร้างสคริปต์
    const restored = selectedId ? result.clones.find((clone) => clone.id === selectedId) : null;
    if (restored) onSelect(restored);
  }, [onSelect, selectedId]);

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
  }, [applyLibrary]);

  // ปล่อยไมค์และเคลียร์ตัวจับเวลาเสมอเมื่อออกจากหน้านี้ ไม่งั้นไฟไมค์ค้างอยู่
  useEffect(() => {
    // React Strict Mode เรียก setup → cleanup → setup ใน dev จึงต้องตั้งกลับทุก setup
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startingRef.current = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder) {
        // ออกจากขั้นระหว่างอัดต้องไม่ให้ onstop นำเสียงครึ่งหนึ่งไปบันทึกต่อ
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startRecording = async () => {
    if (locked || recording || busy || startingRef.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("เบราว์เซอร์นี้อัดเสียงไม่ได้ ลองใช้ Chrome หรือ Edge");
      return;
    }
    startingRef.current = true;
    // ล็อก stepper/สวิตช์เครื่องยนต์ทันที ไม่ต้องรอ effect หลัง render รอบถัดไป
    onActivityChange?.(true);
    setBusy("กำลังขอใช้ไมโครโฟน…");
    let stream: MediaStream | null = null;
    let started = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // เปิดตัวลดเสียงรบกวนไว้ เพราะเสียงต้นแบบที่มีเสียงแทรกทำให้โคลนออกมาเพี้ยน
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // ผู้ใช้อาจปิดหน้า/สลับเครื่องยนต์ระหว่างรอกดอนุญาต เมื่อ promise กลับมา
      // ต้องทิ้ง stream ใหม่นี้ทันที ไม่งั้นไฟไมค์ค้างและเริ่มอัดหลัง component หายไป
      if (!mountedRef.current || lockedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      // ช่องประโยคถูกล็อกระหว่างอัด จึงใช้ snapshot ตอนเริ่มอัดได้ตรงกับเสียงรอบนี้เสมอ
      const recordedText = sample;
      recorder.onstop = () => { void save(new Blob(chunksRef.current, { type: recorder.mimeType }), recordedText); };
      recorderRef.current = recorder;
      recorder.start();
      started = true;
      setRecording(true);
      setBusy("");
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          // หยุดให้เองเมื่อครบเวลา ผู้ใช้ไม่ต้องคอยจ้องนาฬิกา
          if (current + 1 >= MAX_SECONDS) window.setTimeout(() => stopRecording(), 0);
          return current + 1;
        });
      }, 1000);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      if (mountedRef.current) {
        setError("เปิดไมโครโฟนไม่ได้ — ต้องกดอนุญาตให้เบราว์เซอร์ใช้ไมค์ก่อน");
      }
    } finally {
      startingRef.current = false;
      if (!started) {
        if (mountedRef.current) setBusy("");
        onActivityChange?.(false);
      }
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      // onstop เป็น event ถัดไป ถ้าไม่ล็อกช่วงรอนี้ผู้ใช้จะเปลี่ยนขั้นได้แวบหนึ่ง
      setBusy("กำลังเตรียมเสียงที่อัด…");
      recorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const save = async (blob: Blob, recordedText: string) => {
    stopTracks();
    const name = speaker.trim() || "เสียงของฉัน";
    setBusy("กำลังถอดข้อความจากเสียงที่อัด…");
    setError("");
    try {
      if (!gender) throw new Error("กรุณาเลือกเพศของเสียงก่อนบันทึก");
      const result = await localApi.addVoiceClone(blob, { speaker: name, tone, gender, text: recordedText });
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

  const setExistingCloneGender = async (clone: LocalVoiceClone, nextGender: VoiceGender) => {
    setBusy("กำลังบันทึกเพศของเสียง…");
    setError("");
    try {
      const result = await localApi.updateVoiceCloneGender(clone.id, nextGender);
      await reload();
      if (selectedId === clone.id) onSelect(result.clone);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "บันทึกเพศของเสียงไม่สำเร็จ");
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

  // ประโยคเปลี่ยนตามโทนและเพศ เว้นแต่ผู้ใช้พิมพ์เองแล้ว
  const suggested = gender && tone ? toneSample(tone, gender) : "";
  const sample = scriptEdited ? script : suggested;
  const canEditScript = Boolean(gender) && Boolean(tone);
  const canRecord = canEditScript && Boolean(sample.trim());

  return (
    <div className="clone-studio">
      <div className="clone-recorder">
        <label className="field">
          <span>ชื่อเจ้าของเสียง</span>
          <input
            value={speaker}
            list="clip360-speakers"
            placeholder="เช่น เสียงของฉัน"
            disabled={recording || locked || Boolean(busy)}
            onChange={(event) => setSpeaker(event.target.value)}
          />
          <datalist id="clip360-speakers">
            {library.speakers.map((item) => <option value={item.speaker} key={item.speaker} />)}
          </datalist>
        </label>

        <div className="field">
          <span>เพศของเสียง</span>
          <div className="tone-options">
            {VOICE_GENDERS.map((item: VoiceGender) => (
              <button
                type="button"
                key={item}
                className={gender === item ? "active" : ""}
                disabled={recording || locked || Boolean(busy)}
                onClick={() => { setGender(item); setScriptEdited(false); }}
              >
                {item}
              </button>
            ))}
          </div>
          <small>ใช้บอกคนเขียนสคริปต์ว่าให้ลงท้ายด้วย ครับ หรือ ค่ะ</small>
        </div>

        <div className="field">
          <span>อัดไว้เป็นโทนไหน</span>
          <div className="tone-options">
            {library.tones.map((item) => (
              <button
                type="button"
                key={item.id}
                className={tone === item.id ? "active" : ""}
                disabled={recording || locked || Boolean(busy)}
                onClick={() => { setTone(item.id); setScriptEdited(false); }}
              >
                {item.id}
              </button>
            ))}
          </div>
        </div>

        <div className="clone-script">
          <small>
            {canEditScript
              ? `อ่านประโยคนี้ด้วยโทน “${tone}” ให้เป็นธรรมชาติที่สุด — แก้เป็นประโยคของคุณเองได้`
              : "เลือกเพศของเสียงก่อน ประโยคที่ให้อ่านจะได้ลงท้ายถูก"}
          </small>
          <textarea
            value={sample}
            rows={2}
            disabled={recording || locked || Boolean(busy) || !canEditScript}
            aria-label="ประโยคสำหรับอ่านตอนอัดเสียง"
            onChange={(event) => { setScript(event.target.value); setScriptEdited(true); }}
          />
        </div>

        <div className="clone-actions">
          {recording ? (
            <button type="button" className="button button-danger" onClick={stopRecording}>
              <Square size={15} /> หยุดอัด ({seconds} วิ)
            </button>
          ) : (
            <button type="button" className="button button-primary" disabled={locked || Boolean(busy) || !canRecord} onClick={() => void startRecording()}>
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
                  <button type="button" className="clone-pick" disabled={locked || Boolean(busy)} onClick={() => onSelect(clone)}>
                    <span className="clone-tone">
                      {selectedId === clone.id && <Check size={13} strokeWidth={3} />}
                      {clone.tone}
                      <em className={clone.gender ? "" : "missing"}>{clone.gender ?? "ยังไม่ระบุเพศ"}</em>
                    </span>
                    <small>{clone.durationMs ? `${(clone.durationMs / 1000).toFixed(1)} วิ · ` : ""}{clone.text}</small>
                  </button>
                  {!clone.gender && (
                    <div className="clone-gender-fix">
                      <small>เสียงนี้อัดไว้ก่อนมีตัวเลือกเพศ กรุณาระบุก่อนนำไปสร้างสคริปต์</small>
                      <div>
                        {VOICE_GENDERS.map((item: VoiceGender) => (
                          <button
                            type="button"
                            key={item}
                            disabled={locked || Boolean(busy)}
                            onClick={() => void setExistingCloneGender(clone, item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className="clone-remove"
                    aria-label={`ลบเสียง ${clone.label}`}
                    disabled={locked || Boolean(busy)}
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
