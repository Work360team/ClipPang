#!/usr/bin/env node
/**
 * จัดการบัญชีผู้ใช้ของ Clip360
 *
 * รหัสผ่านถูกเก็บเป็น scrypt hash เหมือนกับ set-password.mjs ต่างกันแค่ที่นี่เก็บลง
 * ฐานข้อมูลแทน .env จึงมีได้หลายคน และแต่ละคนเห็นเฉพาะโปรเจกต์ของตัวเอง
 *
 * วิธีใช้:
 *   node scripts/users.mjs list
 *   node scripts/users.mjs add <ชื่อผู้ใช้> <รหัสผ่าน> [--owner]
 *   node scripts/users.mjs password <ชื่อผู้ใช้> <รหัสผ่านใหม่>
 *   node scripts/users.mjs disable <ชื่อผู้ใช้>
 *   node scripts/users.mjs enable <ชื่อผู้ใช้>
 *   node scripts/users.mjs remove <ชื่อผู้ใช้>        (โปรเจกต์ไม่ถูกลบ แต่จะไม่มีเจ้าของ)
 *   node scripts/users.mjs transfer <จาก> <ไป>        (ย้ายโปรเจกต์ทั้งหมดให้อีกคน)
 */
import { hashPassword } from "../server/auth.mjs";
import { PATHS, ensureDirectories } from "../server/config.mjs";
import { createStore } from "../server/store/index.mjs";

ensureDirectories();
const store = createStore({
  rootDir: PATHS.root,
  dataDir: PATHS.data,
  projectsDir: PATHS.projects,
  cacheDir: PATHS.ttsCache,
  dbPath: PATHS.database,
});
store.init?.();

const [command, ...args] = process.argv.slice(2);

function requireUser(username) {
  const user = store.getUserByUsername(username);
  if (!user) {
    console.error(`ไม่พบผู้ใช้ “${username}”`);
    process.exit(1);
  }
  return user;
}

function printUsers() {
  const users = store.listUsers();
  if (!users.length) return console.log("ยังไม่มีบัญชีผู้ใช้");
  const counts = new Map();
  for (const user of users) counts.set(user.id, store.listProjects({ ownerId: user.id }).length);
  const orphans = store.listProjects({ ownerId: null }).length;
  console.log("ชื่อผู้ใช้".padEnd(20), "สิทธิ์".padEnd(8), "สถานะ".padEnd(10), "โปรเจกต์");
  for (const user of users) {
    console.log(
      user.username.padEnd(20),
      user.role.padEnd(8),
      (user.disabled ? "ปิดใช้งาน" : "ใช้งานได้").padEnd(10),
      String(counts.get(user.id) ?? 0),
    );
  }
  if (orphans) console.log(`\nมีโปรเจกต์ที่ยังไม่มีเจ้าของอีก ${orphans} รายการ (ทุกคนยังเห็นได้)`);
}

switch (command) {
  case "list":
    printUsers();
    break;

  case "add": {
    const [username, password] = args;
    if (!username || !password) {
      console.error("ใช้: node scripts/users.mjs add <ชื่อผู้ใช้> <รหัสผ่าน> [--owner]");
      process.exit(1);
    }
    if (password.length < 8) {
      console.error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
      process.exit(1);
    }
    const role = args.includes("--owner") ? "owner" : "member";
    const user = store.createUser({ username, passwordHash: hashPassword(password), role });
    console.log(`สร้างบัญชี “${user.username}” (${user.role}) เรียบร้อย`);
    break;
  }

  case "password": {
    const [username, password] = args;
    if (!username || !password) {
      console.error("ใช้: node scripts/users.mjs password <ชื่อผู้ใช้> <รหัสผ่านใหม่>");
      process.exit(1);
    }
    if (password.length < 8) {
      console.error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
      process.exit(1);
    }
    const user = requireUser(username);
    store.updateUser(user.id, { passwordHash: hashPassword(password) });
    console.log(`เปลี่ยนรหัสผ่านของ “${username}” แล้ว — เครื่องที่ค้างล็อกอินอยู่ต้องเข้าใหม่ทั้งหมด`);
    break;
  }

  case "disable":
  case "enable": {
    const [username] = args;
    const user = requireUser(username);
    store.updateUser(user.id, { disabled: command === "disable" });
    console.log(`${command === "disable" ? "ปิด" : "เปิด"}การใช้งานบัญชี “${username}” แล้ว`);
    break;
  }

  case "remove": {
    const [username] = args;
    const user = requireUser(username);
    const owned = store.listProjects({ ownerId: user.id }).length;
    store.deleteUser(user.id);
    console.log(`ลบบัญชี “${username}” แล้ว — โปรเจกต์ ${owned} รายการยังอยู่ครบแต่ไม่มีเจ้าของ`);
    console.log("ย้ายให้คนอื่นได้ด้วย: node scripts/users.mjs transfer <ชื่อเดิม> <ชื่อใหม่> (ก่อนลบ)");
    break;
  }

  case "transfer": {
    const [from, to] = args;
    if (!from || !to) {
      console.error("ใช้: node scripts/users.mjs transfer <จาก> <ไป>");
      process.exit(1);
    }
    const source = requireUser(from);
    const target = requireUser(to);
    let moved = 0;
    for (const project of store.listProjects({ ownerId: source.id })) {
      if (store.setProjectOwner(project.id, target.id)) moved += 1;
    }
    console.log(`ย้ายโปรเจกต์ ${moved} รายการจาก “${from}” ไปให้ “${to}” แล้ว`);
    break;
  }

  default:
    console.log(`จัดการบัญชีผู้ใช้ Clip360

  list                                 ดูรายชื่อและจำนวนโปรเจกต์ของแต่ละคน
  add <ชื่อ> <รหัส> [--owner]          เพิ่มบัญชี
  password <ชื่อ> <รหัสใหม่>            เปลี่ยนรหัสผ่าน
  disable <ชื่อ> / enable <ชื่อ>        ปิด/เปิดการใช้งานบัญชี
  remove <ชื่อ>                        ลบบัญชี (โปรเจกต์ยังอยู่)
  transfer <จาก> <ไป>                  ย้ายโปรเจกต์ทั้งหมดให้อีกคน`);
}

store.close?.();
