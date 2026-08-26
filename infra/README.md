# สัปดาห์ที่ 2 — ตั้ง infra

เป้าหมายของสัปดาห์นี้ไม่ใช่เขียนฟีเจอร์ แต่คือ **พิสูจน์ว่าสถาปัตยกรรมที่วางไว้ใช้ได้จริงบน hosting ที่มี**
ก่อนจะลงแรงเขียนโค้ดที่พึ่งมัน

ทุกอย่างในโฟลเดอร์นี้รันบนเครื่องคุณ ผมรันแทนไม่ได้ — แต่สคริปต์จะบอกเองว่าผ่านหรือไม่ผ่าน

---

## ลำดับงาน

| # | ทำอะไร | ที่ไหน | ผ่านเมื่อ |
|---|---|---|---|
| 1 | `preflight.sh` | VPS (เพิ่งเปิดเครื่อง) | ไม่มี ✗ — โดยเฉพาะ KVM และไม่มี CPU throttle |
| 2 | `provision.sh` | VPS | ได้ `REDIS_URL` กลับมา |
| 3 | `verify.sh` | VPS | เรนเดอร์จริงผ่าน + เลเยอร์มี alpha |
| 4 | deploy `probe/` | Plesk | หน้าเว็บบอกผลทั้งสามข้อ |
| 5 | ตัดสินใจเรื่อง SSE | — | เขียนผลลง blueprint §08 |

---

## 1–3 · ฝั่ง VPS

```bash
# บนเครื่องคุณ — ส่งไฟล์ขึ้น VPS
scp infra/*.sh root@<vps-ip>:/root/

# บน VPS
ssh root@<vps-ip>
bash preflight.sh                                   # ~5 นาที · อ่านอย่างเดียว + stress test
bash provision.sh --plesk-ip <ไอพีของ Plesk>        # ~4 นาที · ลงของทั้งหมด
bash verify.sh                                      # ~3 นาที · เรนเดอร์จริง
```

`provision.sh` จะพิมพ์ `REDIS_URL` ออกมาตอนจบ **เก็บไว้ให้ดี ไม่ได้บันทึกไว้ที่อื่น**

หา IP ของ Plesk ได้จาก Plesk → Tools & Settings → IP Addresses หรือ `ping clippang.work360.in.th`

### ถ้า preflight ไม่ผ่าน

| อาการ | ความหมาย | ทำอย่างไร |
|---|---|---|
| `virtualization = lxc / openvz` | เป็น container ไม่ใช่ KVM | Chrome จะสตาร์ตไม่ขึ้น — ขอเปลี่ยนเป็น KVM หรือเปลี่ยนผู้ให้บริการ |
| ช่วงสุดท้าย < 75% ของช่วงแรก | CPU โดน throttle | เครื่องนี้รันงานเรนเดอร์ไม่ไหว แจ้ง support ก่อน ถ้าไม่แก้ให้ย้าย |
| `/dev/shm` < 1GB | Chrome จะใช้ดิสก์แทน RAM | เพิ่มใน `/etc/fstab`: `tmpfs /dev/shm tmpfs defaults,size=2G 0 0` |
| เน็ต < 40 Mbps | ดึงคลิปช้ากว่าเรนเดอร์ | ยังใช้ได้ แต่ต้องยึดกฎ normalize ครั้งเดียว (blueprint §02) เคร่งครัด |

---

## 4 · ฝั่ง Plesk — deploy `probe/`

อัปโหลดโฟลเดอร์ `probe/` ทั้งอันขึ้น `httpdocs/probe` แล้วตั้งค่าใน Plesk:

**Domains → clippang.work360.in.th → Node.js**

| ช่อง | ค่า |
|---|---|
| Node.js Version | 20 หรือใหม่กว่า |
| Application Mode | production |
| Application Root | `/httpdocs/probe` |
| Application Startup File | `server.mjs` |
| Custom environment variables | `REDIS_URL` = ค่าที่ได้จาก provision.sh |

กด **Enable Node.js** แล้วเปิด `https://clippang.work360.in.th/probe/`

> ไม่ต้อง `npm install` — probe ไม่มี dependency เลย ตั้งใจให้เป็นแบบนั้นเพื่อตัดตัวแปรออกจากการทดสอบ
> ถ้า Plesk ไม่ยอมรับนามสกุล `.mjs` ให้เปลี่ยนชื่อเป็น `server.js` ได้เลย (`package.json` มี `"type": "module"` อยู่แล้ว)

หน้าเว็บมี 3 ปุ่ม กดตามลำดับ:

1. **ENVIRONMENT** — ดูว่า Node รันจริงและมี proxy คั่นอยู่ไหม
2. **SSE** — ส่ง event ทุก 1 วินาที 12 ครั้ง แล้ววาดกราฟระยะห่าง
3. **REDIS** — ต่อจาก Plesk ไป Redis บน VPS

---

## 5 · อ่านผล SSE แล้วตัดสินใจ

นี่คือผลลัพธ์จริงจากเครื่อง dev ที่ไม่มี proxy คั่น ใช้เป็นเกณฑ์เทียบ:

```
  1015 ms  data: {"i":1}
  2023 ms  data: {"i":2}
  3032 ms  data: {"i":3}
  4040 ms  data: {"i":4}
```

ห่างกันสม่ำเสมอ ~1000 ms = ไม่มี buffer

| ผลบน Plesk | แปลว่า | ทำอย่างไร |
|---|---|---|
| แท่งห่างเท่า ๆ กัน ครบ 12 วินาที | Passenger ปล่อยผ่าน | ใช้ SSE ตามสเปก §08 ได้เลย |
| แท่งกระจุกท้าย มาพร้อมกันหมด | โดน buffer | **ตัด SSE ออกจากสเปก** ใช้ polling ทุก 3 วินาทีอย่างเดียว |
| ต่อไม่ติดเลย | proxy ตัด long-lived connection | เหมือนข้างบน + ตั้ง timeout ของ job ให้สั้นลง |

ถ้าผลออกมาเป็นสองแบบหลัง อย่าพยายามฝืน — polling ทุก 3 วินาทีสำหรับงานที่ใช้เวลา 2 นาที
เพิ่ม request แค่ ~40 ครั้งต่องาน ซึ่งไม่ใช่ปัญหาเลย แต่การสู้กับ proxy ที่คุมไม่ได้เป็นปัญหา

---

## เกณฑ์ผ่านของสัปดาห์ที่ 2

- [ ] `preflight.sh` ไม่มี ✗
- [ ] `verify.sh` เรนเดอร์เลเยอร์ซับที่มี alpha ได้ และได้ ≥ 3 fps
- [ ] ฟอนต์ไทยเรนเดอร์ถูกต้อง (ไม่ใช่ DejaVu Sans)
- [ ] probe บน Plesk ต่อ Redis บน VPS ได้ พร้อม auth
- [ ] รู้คำตอบแล้วว่าจะใช้ SSE หรือ polling — และบันทึกลง blueprint §08
- [ ] `systemctl status clip360-worker` แสดง unit ที่พร้อมรอโค้ด

ครบแล้วค่อยเข้าสัปดาห์ที่ 3 (API + Mongo + คิว)

---

## หมายเหตุความปลอดภัย

`provision.sh` เปิดพอร์ต Redis ออกอินเทอร์เน็ตโดยมีสองชั้นกัน: **รหัสผ่าน 40 ตัวอักษร** และ
**ufw ที่อนุญาตเฉพาะ IP ของ Plesk** — ถ้า IP ของ Plesk เป็น dynamic หรือคุณย้าย hosting
ให้เปลี่ยนไปใช้ WireGuard ระหว่างสองเครื่องแทนการเปิดพอร์ตตรง อย่าแก้ด้วยการเปิด ufw ให้ทุก IP

---

## ย้ายเครื่องที่ provision ไว้ตั้งแต่ยังชื่อ ClipPang

`provision.sh` เปลี่ยนไปใช้ชื่อ `clip360` หมดแล้ว (ผู้ใช้ระบบ, `/opt/clip360`,
`clip360-worker.service`, `/usr/local/share/fonts/clip360`, `/etc/cron.daily/clip360-cleanup`)
เครื่องที่ติดตั้งไว้ก่อนหน้ายังเป็นชื่อเดิมอยู่ทั้งหมด

**อย่ารัน `provision.sh` ทับเฉย ๆ** เพราะมันจะสร้างผู้ใช้และ unit ชุดใหม่ขึ้นมาซ้อนของเดิม
กลายเป็น worker สองตัวแย่งคิวกัน ให้ย้ายด้วยมือแทน:

```bash
systemctl stop clippang-worker
systemctl disable clippang-worker
rm /etc/systemd/system/clippang-worker.service
mv /opt/clippang /opt/clip360
usermod -l clip360 -d /home/clip360 -m clippang
groupmod -n clip360 clippang
chown -R clip360:clip360 /opt/clip360
mv /usr/local/share/fonts/clippang /usr/local/share/fonts/clip360 && fc-cache -f
rm -f /etc/cron.daily/clippang-cleanup
```

แล้วค่อยรัน `provision.sh` ปกติเพื่อสร้าง unit กับ cron ชุดใหม่ จากนั้น
`systemctl enable --now clip360-worker`

> ชื่อโดเมนไม่ได้เปลี่ยน — ยังเป็น `clippang.work360.in.th` เหมือนเดิม
> ถ้าจะย้ายโดเมนด้วยต้องตั้ง DNS กับ Plesk ให้เสร็จก่อน แล้วค่อยแก้ `CLIP360_ALLOWED_HOSTS`
