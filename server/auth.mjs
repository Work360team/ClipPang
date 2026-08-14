/**
 * ล็อกอินด้วยชื่อผู้ใช้และรหัสผ่าน สำหรับตอนเปิดให้เข้าจากเครื่องอื่น
 *
 * ข้อกำหนดที่ยึดไว้:
 * - ไม่เก็บรหัสผ่านเป็นข้อความธรรมดา เก็บเป็น scrypt hash พร้อม salt สุ่มต่อคน
 * - คุกกี้เซสชันถูกเซ็นด้วย HMAC จึงปลอมไม่ได้ และไม่มีรหัสผ่านอยู่ในนั้น
 * - เทียบทุกอย่างด้วย timingSafeEqual ไม่ให้เดาจากเวลาที่ตอบกลับ
 * - เดารหัสถี่ ๆ จะถูกหน่วง เพื่อกันการไล่เดาอัตโนมัติ
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SESSION_COOKIE = "clippang_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** เก็บ secret ของเซสชันไว้ในไฟล์ ไม่งั้นรีสตาร์ตทีคนก็หลุดล็อกอินทุกที */
export function sessionSecret(dataDir) {
  const file = path.join(dataDir, "session.key");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch { /* ยังไม่มีไฟล์ ค่อยสร้างข้างล่าง */ }
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, key] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(key, "base64");
    const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const sign = (value, secret) => crypto.createHmac("sha256", secret).update(value).digest("base64url");

export function createSession(username, secret) {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + SESSION_DAYS * 86_400_000,
  })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSession(cookieValue, secret) {
  if (!cookieValue) return null;
  const [payload, signature] = String(cookieValue).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function sessionCookie(value, { clear = false } = {}) {
  const age = clear ? 0 : SESSION_DAYS * 86_400;
  return `${SESSION_COOKIE}=${clear ? "" : value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax`;
}

export function readCookie(header, name) {
  const found = String(header || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}

/**
 * หน่วงเวลาเมื่อเดารหัสผิดซ้ำ ๆ จาก IP เดิม
 * เก็บในหน่วยความจำพอ เพราะโปรแกรมนี้รันบนเครื่องคนเดียวไม่ได้กระจายหลายเครื่อง
 */
const attempts = new Map();
export function throttle(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now > record.until) return 0;
  return record.until - now;
}
export function noteFailure(ip) {
  const record = attempts.get(ip) ?? { count: 0, until: 0 };
  record.count += 1;
  // ปล่อยผ่านสามครั้งแรก จากนั้นหน่วงเพิ่มเป็นเท่าตัว สูงสุดห้านาที
  if (record.count > 3) record.until = Date.now() + Math.min(300_000, 2 ** (record.count - 3) * 1000);
  attempts.set(ip, record);
}
export function noteSuccess(ip) {
  attempts.delete(ip);
}

export function loginPage({ error = "", nextPath = "/" } = {}) {
  const safeNext = /^\/[^\s"']*$/.test(nextPath) ? nextPath : "/";
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>เข้าสู่ระบบ · ClipPang</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:22px;
    background:#f5f4ef; color:#181b18; font:400 15px/1.6 "Kanit","Leelawadee UI",system-ui,sans-serif; }
  form { width:100%; max-width:360px; padding:26px 24px; border:1px solid #e2e3dc; border-radius:20px;
    background:#fff; box-shadow:0 18px 44px rgba(20,25,19,.10); }
  .mark { width:46px; height:46px; margin-bottom:14px; padding:4px;
    border-radius:13px; background:#171b16; object-fit:contain; display:block; }
  h1 { margin:0 0 4px; font-size:19px; font-weight:700; }
  p.sub { margin:0 0 18px; font-size:13px; color:#8b9289; }
  label { display:block; margin-bottom:12px; font-size:13px; font-weight:600; }
  input { width:100%; margin-top:5px; padding:11px 12px; border:1px solid #dfe2da; border-radius:11px;
    font:inherit; font-size:14px; font-weight:400; background:#fafbf8; }
  input:focus { outline:2px solid #ffd23f; outline-offset:1px; border-color:#c69b00; }
  button { width:100%; min-height:46px; margin-top:6px; border:0; border-radius:12px; background:#ffd23f;
    color:#2a2205; font:inherit; font-size:15px; font-weight:700; cursor:pointer; }
  button:hover { background:#ffc71a; }
  .error { margin:0 0 14px; padding:10px 12px; border:1px solid rgba(198,94,85,.3); border-radius:10px;
    background:rgba(198,94,85,.08); color:#c65e55; font-size:13px; }
  .note { margin:16px 0 0; font-size:12px; line-height:1.6; color:#8b9289; }
</style></head>
<body>
  <form method="post" action="/api/auth/login">
    <img class="mark" src="/clippang-logo-192.png" alt="ClipPang" />
    <h1>ClipPang</h1>
    <p class="sub">เข้าสู่ระบบเพื่อใช้งานจากเครื่องนี้</p>
    ${error ? `<p class="error">${error}</p>` : ""}
    <input type="hidden" name="next" value="${safeNext}" />
    <label>ชื่อผู้ใช้
      <input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required />
    </label>
    <label>รหัสผ่าน
      <input name="password" type="password" autocomplete="current-password" required />
    </label>
    <button type="submit">เข้าสู่ระบบ</button>
    <p class="note">เครื่องที่รัน ClipPang อยู่เข้าได้เลยโดยไม่ต้องล็อกอิน หน้านี้มีไว้สำหรับเครื่องอื่น</p>
  </form>
</body></html>`;
}
