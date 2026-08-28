// tunnel — เปิด URL สาธารณะให้เข้า Clip360 จากมือถือ ด้วย cloudflared quick tunnel
//
// ทำไมถึงเลือก cloudflared ไม่ใช่ ngrok: quick tunnel ไม่ต้องสมัครบัญชี ไม่ต้องใส่ token
// เป็นไฟล์เดียวโหลดแล้วรันได้เลย ส่วน ngrok ตอนนี้บังคับ authtoken ซึ่งแปลว่าผู้ใช้มือใหม่
// ต้องไปสมัครสมาชิกก่อนถึงจะเริ่มได้
//
// อุโมงค์ต่อออกจากเครื่องเราไปหา Cloudflare แล้ววิ่งกลับเข้ามาที่ 127.0.0.1 เอง
// เซิร์ฟเวอร์จึงไม่ต้องเปิดพอร์ตออก LAN และไม่ต้องแตะไฟร์วอลล์
//
// ข้อสำคัญเรื่องความปลอดภัย: URL ของ quick tunnel เดาไม่ได้ก็จริง แต่มันคือที่อยู่
// สาธารณะจริง ๆ ใครมี URL ก็เข้าถึงได้ โมดูลนี้จึงปฏิเสธที่จะเปิดอุโมงค์ถ้ายังไม่มี
// บัญชีสำหรับล็อกอิน — ไม่มีทางลัดให้เปิดแบบไม่มีรหัสผ่าน

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN_DIR } from "./config.mjs";
import { downloadTo, report } from "./installer-lib.mjs";

const TUNNEL_DIR = path.join(BIN_DIR, "cloudflared");
const BINARY = path.join(TUNNEL_DIR, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

/** ดาวน์โหลดจาก release ล่าสุดของ Cloudflare เอง ไม่ผ่านตัวกลาง */
const DOWNLOADS = {
  "win32-x64": "cloudflared-windows-amd64.exe",
  "darwin-arm64": "cloudflared-darwin-arm64.tgz",
  "darwin-x64": "cloudflared-darwin-amd64.tgz",
  "linux-x64": "cloudflared-linux-amd64",
  "linux-arm64": "cloudflared-linux-arm64",
};

const RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";

/** URL ของ quick tunnel โผล่มาใน log ในรูปนี้ */
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const STARTUP_TIMEOUT_MS = 90_000;

let child = null;
let publicUrl = "";
let lastError = "";
let starting = false;

export function tunnelSupported() {
  return Boolean(DOWNLOADS[`${process.platform}-${process.arch}`]);
}

export function tunnelInstalled() {
  return fs.existsSync(BINARY);
}

export function tunnelStatus() {
  return {
    supported: tunnelSupported(),
    installed: tunnelInstalled(),
    running: Boolean(child) && child.exitCode === null,
    starting,
    url: publicUrl,
    host: publicUrl ? new URL(publicUrl).hostname : "",
    error: lastError,
  };
}

/**
 * โหลดตัว cloudflared มาเก็บใน data/bin
 *
 * บน Windows และ Linux ไฟล์ที่โหลดมาคือ binary ตรง ๆ ไม่ต้องแตะอะไรต่อ
 * ส่วน macOS มาเป็น .tgz ต้องแตกก่อน — ใช้ tar ที่ติดมากับเครื่องอยู่แล้ว
 */
export async function installTunnel({ onProgress, signal } = {}) {
  const asset = DOWNLOADS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`ยังไม่รองรับ ${process.platform}-${process.arch}`);
  if (tunnelInstalled()) return { installed: true, path: BINARY };

  fs.mkdirSync(TUNNEL_DIR, { recursive: true });
  report(onProgress, { progress: 5, message: "กำลังโหลดตัวเชื่อมต่อจาก Cloudflare" });

  const url = `${RELEASE_BASE}/${asset}`;
  if (asset.endsWith(".tgz")) {
    const archive = path.join(TUNNEL_DIR, asset);
    await downloadTo(url, archive, { onProgress, signal, label: "cloudflared" });
    report(onProgress, { progress: 80, message: "กำลังแตกไฟล์" });
    await new Promise((resolve, reject) => {
      const tar = spawn("tar", ["-xzf", archive, "-C", TUNNEL_DIR], { windowsHide: true });
      tar.on("error", reject);
      tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`แตกไฟล์ไม่สำเร็จ (exit ${code})`))));
    });
    fs.rmSync(archive, { force: true });
  } else {
    await downloadTo(url, BINARY, { onProgress, signal, label: "cloudflared" });
  }

  if (!fs.existsSync(BINARY)) throw new Error("โหลดเสร็จแล้วแต่ไม่พบไฟล์ cloudflared");
  if (process.platform !== "win32") fs.chmodSync(BINARY, 0o755);
  report(onProgress, { progress: 100, message: "พร้อมเปิด URL สำหรับมือถือแล้ว" });
  return { installed: true, path: BINARY };
}

/**
 * เปิดอุโมงค์แล้วรอจนกว่าจะได้ URL
 *
 * cloudflared พิมพ์ URL ออก stderr ระหว่างเริ่มทำงาน ไม่มีทางถามทีหลังได้ จึงต้องอ่าน
 * จากสายที่มันพิมพ์ออกมาตอนนั้นเลย ถ้าไม่เจอภายในเวลาที่กำหนดถือว่าเปิดไม่สำเร็จ
 * แล้วปิดทิ้ง ไม่ปล่อยให้มี process ค้างที่ไม่มีใครรู้ว่าทำอะไรอยู่
 */
export function startTunnel({ port, hasOwner }) {
  if (!hasOwner) {
    throw Object.assign(
      new Error("ต้องตั้งชื่อผู้ใช้และรหัสผ่านก่อน จึงจะเปิด URL สาธารณะได้"),
      { code: "TUNNEL_NEEDS_PASSWORD", status: 400 },
    );
  }
  if (!tunnelInstalled()) {
    throw Object.assign(new Error("ยังไม่ได้ติดตั้งตัวเชื่อมต่อ"), { code: "TUNNEL_NOT_INSTALLED", status: 400 });
  }
  if (child && child.exitCode === null) return Promise.resolve(tunnelStatus());

  starting = true;
  lastError = "";
  publicUrl = "";

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, [
      "tunnel",
      "--url", `http://127.0.0.1:${port}`,
      "--no-autoupdate",
    ], { windowsHide: true });
    child = proc;

    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      starting = false;
      clearTimeout(timer);
      if (error) {
        lastError = error.message;
        stopTunnel();
        reject(error);
      } else {
        resolve(tunnelStatus());
      }
    };

    const timer = setTimeout(
      () => finish(new Error("เปิดอุโมงค์ไม่สำเร็จภายใน 90 วินาที — ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่")),
      STARTUP_TIMEOUT_MS,
    );

    const read = (buffer) => {
      const text = String(buffer);
      const match = URL_PATTERN.exec(text);
      if (match && !publicUrl) {
        publicUrl = match[0];
        finish(null);
      }
    };

    proc.stdout?.on("data", read);
    proc.stderr?.on("data", read);
    proc.on("error", (error) => finish(new Error(`เริ่ม cloudflared ไม่สำเร็จ: ${error.message}`)));
    proc.on("close", () => {
      if (child === proc) {
        child = null;
        publicUrl = "";
      }
      finish(new Error("cloudflared ปิดตัวลงก่อนจะได้ URL"));
    });
  });
}

export function stopTunnel() {
  starting = false;
  publicUrl = "";
  if (!child) return;
  const proc = child;
  child = null;
  try {
    if (process.platform === "win32" && Number.isInteger(proc.pid)) {
      spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    proc.kill("SIGKILL");
  }
}

// อุโมงค์ต้องตายไปพร้อมเซิร์ฟเวอร์ ไม่งั้นปิดโปรแกรมแล้วเครื่องยังเปิดออกเน็ตอยู่
// โดยที่ไม่มีอะไรบนจอบอกเลยว่ายังเปิดค้างไว้
for (const event of ["exit", "SIGINT", "SIGTERM"]) process.on(event, stopTunnel);
