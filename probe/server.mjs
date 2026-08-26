// Clip360 probe — แอปจิ๋วสำหรับ deploy ขึ้น Plesk shared เพื่อตอบคำถามสองข้อของสัปดาห์ที่ 2
//
//   1. SSE ผ่าน Passenger ได้จริงไหม หรือโดน buffer จนไร้ประโยชน์
//   2. Plesk ต่อ Redis บน VPS worker ได้ไหม (auth + latency)
//
// ไม่มี dependency เลย — ใช้แค่ node:http และ node:net เพื่อให้ deploy บน Plesk ได้โดยไม่ต้อง npm install
//
//   PORT=3000 REDIS_URL=redis://:pass@1.2.3.4:6379 node server.mjs
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const STARTED = Date.now();

/* ---------- Redis: พูด RESP ดิบ ๆ เพื่อไม่ต้องมี dependency ---------- */

function parseRedisUrl(raw) {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: decodeURIComponent(u.password || ""),
    tls: u.protocol === "rediss:",
  };
}

const encode = (args) =>
  `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("");

/** อ่าน reply ทีละตัวจาก buffer — รองรับเท่าที่ probe ต้องใช้ */
function readReply(buf, offset) {
  if (offset >= buf.length) return null;
  const nl = buf.indexOf("\r\n", offset);
  if (nl === -1) return null;
  const type = buf[offset];
  const line = buf.slice(offset + 1, nl);
  if (type === "+" || type === "-" || type === ":") {
    return { value: type === "-" ? `ERR ${line}` : line, next: nl + 2, error: type === "-" };
  }
  if (type === "$") {
    const len = Number(line);
    if (len === -1) return { value: null, next: nl + 2 };
    const end = nl + 2 + len;
    if (buf.length < end + 2) return null;
    return { value: buf.slice(nl + 2, end), next: end + 2 };
  }
  return { value: line, next: nl + 2 };
}

function redisProbe(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let cfg;
    try {
      cfg = parseRedisUrl(url);
    } catch {
      return resolve({ ok: false, error: "REDIS_URL ผิดรูปแบบ" });
    }
    if (cfg.tls) {
      return resolve({ ok: false, error: "probe นี้ยังไม่รองรับ rediss:// — ทดสอบด้วย redis:// ก่อน" });
    }

    const t0 = Date.now();
    const cmds = [];
    if (cfg.password) cmds.push(["AUTH", cfg.password]);
    cmds.push(["PING"], ["SET", "clip360:probe", String(Date.now())], ["GET", "clip360:probe"], ["INFO", "server"]);

    const sock = net.createConnection({ host: cfg.host, port: cfg.port });
    let buf = "";
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(result);
    };

    sock.setTimeout(timeoutMs, () => finish({ ok: false, error: `ต่อไม่ติดภายใน ${timeoutMs}ms — เช็ค ufw ว่าเปิดให้ IP ของ Plesk แล้วหรือยัง` }));
    sock.on("error", (e) => finish({ ok: false, error: `${e.code || ""} ${e.message}`.trim() }));

    sock.on("connect", () => {
      const connectMs = Date.now() - t0;
      sock.write(cmds.map(encode).join(""));
      sock.connectMs = connectMs;
    });

    sock.on("data", (chunk) => {
      buf += chunk.toString("binary");
      const replies = [];
      let off = 0;
      for (;;) {
        const r = readReply(buf, off);
        if (!r) break;
        replies.push(r);
        off = r.next;
      }
      if (replies.length < cmds.length) return;

      const authFailed = cfg.password && replies[0].error;
      if (authFailed) {
        return finish({ ok: false, error: `AUTH ไม่ผ่าน: ${replies[0].value}` });
      }
      const base = cfg.password ? 1 : 0;
      const info = String(replies[base + 3]?.value || "");
      finish({
        ok: true,
        host: `${cfg.host}:${cfg.port}`,
        authenticated: Boolean(cfg.password),
        connectMs: sock.connectMs ?? null,
        roundTripMs: Date.now() - t0,
        ping: String(replies[base]?.value || ""),
        readWrite: String(replies[base + 2]?.value || "").length > 0,
        redisVersion: /redis_version:([^\r\n]+)/.exec(info)?.[1] || "?",
      });
    });
  });
}

/* ---------- HTTP ---------- */

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      node: process.version,
      uptimeSec: Math.round((Date.now() - STARTED) / 1000),
      redisConfigured: Boolean(process.env.REDIS_URL),
      // ถ้ามี header พวกนี้แปลว่าอยู่หลัง proxy — Passenger/nginx เป็นตัวที่ buffer SSE
      via: req.headers["x-forwarded-for"] ? "หลัง proxy" : "ตรง",
      proxyHeaders: Object.keys(req.headers).filter((h) => h.startsWith("x-")),
    });
  }

  if (url.pathname === "/api/poll") {
    return json(res, 200, { t: Date.now(), iso: new Date().toISOString() });
  }

  if (url.pathname === "/api/redis") {
    if (!process.env.REDIS_URL) return json(res, 200, { ok: false, error: "ยังไม่ได้ตั้ง REDIS_URL" });
    return json(res, 200, await redisProbe(process.env.REDIS_URL));
  }

  if (url.pathname === "/api/sse") {
    const total = Math.min(Number(url.searchParams.get("n") || 12), 60);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // บอก nginx ตรง ๆ ว่าอย่า buffer — ถ้า Plesk ยอมฟังจะช่วยได้เลย
      "x-accel-buffering": "no",
    });
    // padding 2KB ช่วยเตะ proxy บางตัวให้เริ่มส่ง — ถ้าต้องพึ่งอันนี้แปลว่ามี buffer อยู่จริง
    res.write(`: ${"-".repeat(2048)}\n\n`);

    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      res.write(`event: tick\ndata: ${JSON.stringify({ i, t: Date.now() })}\n\n`);
      if (i >= total) {
        clearInterval(timer);
        res.write(`event: done\ndata: ${JSON.stringify({ total, t: Date.now() })}\n\n`);
        res.end();
      }
    }, 1000);
    req.on("close", () => clearInterval(timer));
    return;
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const full = path.join(ROOT, "public", file);
  if (!full.startsWith(path.join(ROOT, "public")) || !fs.existsSync(full)) {
    return json(res, 404, { error: "ไม่พบ" });
  }
  const type = full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, () => {
  process.stdout.write(`Clip360 probe listening on :${PORT}\n`);
});
