/**
 * ข้อความอธิบายตอนถูกปฏิเสธ — บอกว่าต้องทำอะไรต่อ ไม่ใช่เจอกำแพงเปล่า ๆ
 *
 * แยกออกมาเป็นไฟล์เพราะเป็นข้อความยาวหลายกรณี ปนอยู่ใน index.mjs แล้วอ่านยาก
 */
export function remoteHelpText({ host, allowedHosts, hasUser, hasHash }) {
  const shown = host || "<โดเมนของคุณ>";
  if (!allowedHosts.size) {
    return [
      "ClipPang Local รับคำขอจากเครื่องนี้เท่านั้น",
      "",
      "ถ้าต้องการเปิดให้เครื่องอื่น (เช่นมือถือ) เข้าใช้ ทำสองอย่างนี้:",
      "",
      "1) ตั้งโฮสต์ที่อนุญาตใน .env แล้วเปิดโปรแกรมใหม่",
      `     CLIPPANG_ALLOWED_HOSTS=${shown}`,
      "",
      "2) สร้างบัญชีสำหรับล็อกอิน",
      "     node scripts/set-password.mjs <ชื่อผู้ใช้> <รหัสผ่าน>",
      "",
      "ขาดอย่างใดอย่างหนึ่งระบบจะยังรับเฉพาะเครื่องตัวเองเหมือนเดิม",
      "ถ้าเปิดออกอินเทอร์เน็ตจริง แนะนำให้มี Cloudflare Access คั่นอีกชั้นด้วย",
    ].join("\n");
  }
  if (!hasUser || !hasHash) {
    return [
      "ตั้ง CLIPPANG_ALLOWED_HOSTS ไว้แล้ว แต่ยังไม่มีบัญชีสำหรับล็อกอิน",
      "",
      "สร้างด้วยคำสั่ง:  node scripts/set-password.mjs <ชื่อผู้ใช้> <รหัสผ่าน>",
      "แล้วเปิดโปรแกรมใหม่อีกครั้ง",
    ].join("\n");
  }
  if (!allowedHosts.has(String(host).toLowerCase())) {
    return `โฮสต์ ${shown} ไม่ได้อยู่ใน CLIPPANG_ALLOWED_HOSTS`;
  }
  return `เปิด https://${shown}/ แล้วเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านของคุณ`;
}
