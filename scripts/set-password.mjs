#!/usr/bin/env node
/**
 * ตั้งชื่อผู้ใช้และรหัสผ่านสำหรับเข้าใช้ Clip360 จากเครื่องอื่น
 *
 * เขียนลง .env เป็น scrypt hash ไม่ได้เก็บรหัสผ่านตรง ๆ ถ้าไฟล์ .env หลุดออกไป
 * คนที่ได้ไปก็ยังเอารหัสกลับคืนไม่ได้
 *
 * วิธีใช้:  node scripts/set-password.mjs <ชื่อผู้ใช้> <รหัสผ่าน>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("วิธีใช้: node scripts/set-password.mjs <ชื่อผู้ใช้> <รหัสผ่าน>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
  process.exit(1);
}

/** แทนค่าเดิมถ้ามีอยู่แล้ว ไม่งั้นต่อท้าย — กันบรรทัดซ้ำที่ทำให้งงว่าอันไหนมีผล */
function upsert(lines, key, value) {
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
const lines = existing.split(/\r?\n/);
upsert(lines, "CLIP360_USER", username);
upsert(lines, "CLIP360_PASSWORD_HASH", hashPassword(password));

const output = lines.filter((line, index) => line.trim() || index < lines.length - 1).join("\n");
fs.writeFileSync(ENV_FILE, output.endsWith("\n") ? output : `${output}\n`, { mode: 0o600 });

console.log(`ตั้งบัญชี "${username}" เรียบร้อย บันทึกเป็น scrypt hash ใน .env แล้ว`);
console.log("อย่าลืมตั้ง CLIP360_ALLOWED_HOSTS ให้เป็นโดเมนที่จะเข้าใช้ แล้วเปิดโปรแกรมใหม่");
