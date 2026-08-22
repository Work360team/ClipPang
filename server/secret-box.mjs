// secret-box — เข้ารหัสความลับที่ต้องเก็บลงฐานข้อมูล
//
// คีย์ Gemini ของผู้ใช้เคยเก็บเป็น plaintext ในตาราง user_keys ซึ่งพอรับได้ตอนที่
// ฐานข้อมูลอยู่บนเครื่องเจ้าของเอง (ไม่ต่างจาก .env) แต่รับไม่ได้ทันทีที่มีผู้ใช้
// คนอื่นฝากคีย์ไว้ หรือวันที่ย้ายฐานข้อมูลขึ้นคลาวด์
//
// กุญแจอยู่คนละที่กับฐานข้อมูล (ไฟล์ data/secret.key สิทธิ์ 0600) การได้ไฟล์ .db
// ไปเฉย ๆ จึงยังอ่านคีย์ไม่ได้ — ยังไม่ใช่ระดับ KMS แต่ปิดช่องที่ง่ายที่สุดไปแล้ว

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PREFIX = "v1";
let cachedKey = null;

/** อ่านกุญแจจากไฟล์ ถ้ายังไม่มีก็สร้างใหม่ */
export function secretKeyFor(dataDir) {
  if (cachedKey) return cachedKey;
  const file = path.join(dataDir, "secret.key");
  try {
    const existing = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
    if (existing.length === 32) {
      cachedKey = existing;
      return cachedKey;
    }
  } catch { /* ยังไม่มีไฟล์ ค่อยสร้างข้างล่าง */ }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  cachedKey = key;
  return cachedKey;
}

/** ใช้ในเทสต์เพื่อบังคับให้อ่านกุญแจใหม่ */
export function resetSecretKeyCache() {
  cachedKey = null;
}

export function encryptSecret(text, dataDir) {
  const value = String(text ?? "");
  if (!value) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKeyFor(dataDir), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":");
}

/**
 * ถอดรหัสกลับ — ค่าที่ไม่ได้อยู่ในรูปแบบนี้ถือว่าเป็นของเก่าที่ยังเป็น plaintext
 * คืนไปตรง ๆ เพื่อให้เครื่องที่ใช้อยู่ก่อนหน้าไม่พังตอนอัปเดต
 */
export function decryptSecret(blob, dataDir) {
  const value = String(blob ?? "");
  if (!value.startsWith(`${PREFIX}:`)) return value;
  const [, iv, tag, body] = value.split(":");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKeyFor(dataDir), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // กุญแจไม่ตรงหรือข้อมูลเสีย — คืนค่าว่างดีกว่าโยน error ทั้งหน้า
    // ผู้ใช้จะเห็นว่าคีย์ใช้ไม่ได้แล้วใส่ใหม่ได้เอง
    return "";
  }
}

export function isEncrypted(blob) {
  return String(blob ?? "").startsWith(`${PREFIX}:`);
}
