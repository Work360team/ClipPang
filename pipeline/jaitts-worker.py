"""jaitts-worker — โหลดโมเดล JaiTTS ครั้งเดียว แล้วรอรับงานสังเคราะห์ทาง stdin

ทำไมต้องมีตัวนี้
    jaitts_synth.py ของต้นทางสร้าง FlowTTSPipeline ใหม่ทุกครั้งที่เรียก วัดบนเครื่อง
    จริงได้ 40.7 วินาทีต่อการเรียกหนึ่งครั้ง คลิปหนึ่งมี 10-12 ท่อนก็เกือบเจ็ดนาที
    ทั้งที่เวลาสังเคราะห์จริงอยู่แค่ราว 4 วินาที ที่เหลือคือโหลดโมเดลซ้ำ ๆ

โปรโตคอล (JSON บรรทัดละหนึ่งคำขอ)
    เข้า : {"id": 1, "text": "...", "ref_wav": "...", "ref_text": "...", "out": "...", "speed": 1.0}
    ออก  : {"id": 1, "ok": true, "ms": 4130}
           {"id": 1, "ok": false, "error": "..."}
    ตอนพร้อม: {"ready": true, "device": "cuda:0"}

stdout สงวนไว้ให้โปรโตคอลเท่านั้น
    flowtts พิมพ์ข้อความออก stdout ระหว่างทำงาน (utils_infer.py พิมพ์ ref_text ทุกครั้ง
    ที่สังเคราะห์) ถ้าปล่อยไว้บรรทัดพวกนั้นจะปนกับ JSON จนฝั่ง Node อ่านไม่ออก
    จึงเบน stdout ของไลบรารีไปที่ stderr แล้วเก็บ stdout จริงไว้ใช้ส่งผลลัพธ์อย่างเดียว
"""
import contextlib
import json
import os
import sys
import time

# ข้อความไทยที่ไลบรารีพิมพ์ออกมาทำให้ล้มด้วย UnicodeEncodeError บน Windows
# เพราะ stdout เป็น cp1252 ตั้งไว้ตรงนี้ด้วยเผื่อผู้เรียกลืมส่ง env มา
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

PROTOCOL_OUT = sys.stdout


def emit(payload):
    PROTOCOL_OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def fail(message, detail=None):
    emit({"ready": False, "error": message, "detail": detail})
    sys.exit(1)


def main():
    home = os.environ.get("JAITTS_HOME")
    if not home or not os.path.isdir(home):
        fail("ไม่พบโฟลเดอร์ JaiTTS — ต้องตั้ง JAITTS_HOME ให้ชี้ไปที่ที่ติดตั้งไว้", home)
    if not os.path.isfile(os.path.join(home, "jaitts_synth.py")):
        fail("โฟลเดอร์ JaiTTS ไม่สมบูรณ์ — ไม่เจอ jaitts_synth.py", home)

    sys.path.insert(0, home)
    # เข้าโฟลเดอร์ของ JaiTTS เพราะ pipeline เขียนไฟล์ชั่วคราวลง temp_f5/ แบบ relative
    os.chdir(home)

    try:
        # ใช้ load() ของต้นทางตรง ๆ จะได้ค่า checkpoint กับ config ชุดเดียวกันเสมอ
        # ถ้าเขาปรับ nfe_step หรือ vocoder ตัวนี้ได้ตามโดยไม่ต้องแก้สองที่
        with contextlib.redirect_stdout(sys.stderr):
            from jaitts_synth import load, pick_device

            device = pick_device()
            pipe = load(device=device)
    except Exception as error:  # noqa: BLE001 — ส่งกลับให้ฝั่ง Node ตัดสินใจ
        fail(f"โหลดโมเดล JaiTTS ไม่สำเร็จ: {error}", repr(error))
        return

    emit({"ready": True, "device": device})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError as error:
            emit({"id": None, "ok": False, "error": f"อ่านคำขอไม่ออก: {error}"})
            continue

        request_id = request.get("id")
        if request.get("shutdown"):
            break

        started = time.perf_counter()
        try:
            out_path = os.path.abspath(request["out"])
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with contextlib.redirect_stdout(sys.stderr):
                pipe(
                    text=request["text"],
                    ref_voice=request["ref_wav"],
                    ref_text=request["ref_text"],
                    output_file=out_path,
                    speed=float(request.get("speed", 1.0)),
                    check_duration=True,
                )
            if not os.path.isfile(out_path):
                raise RuntimeError("สังเคราะห์เสร็จแต่ไม่มีไฟล์เสียงออกมา")
            emit({
                "id": request_id,
                "ok": True,
                "ms": int((time.perf_counter() - started) * 1000),
            })
        except Exception as error:  # noqa: BLE001 — งานหนึ่งพังต้องไม่ล้มทั้ง worker
            emit({"id": request_id, "ok": False, "error": str(error) or repr(error)})


if __name__ == "__main__":
    main()
