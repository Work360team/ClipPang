/**
 * ข้อความอธิบายตอนถูกปฏิเสธ — บอกว่าต้องทำอะไรต่อ ไม่ใช่เจอกำแพงเปล่า ๆ
 *
 * แยกออกมาเป็นไฟล์เพราะเป็นข้อความยาวหลายกรณี ปนอยู่ใน index.mjs แล้วอ่านยาก
 */
export function remoteHelpText({ host, allowedHosts, tokenLength }) {
  const shown = host || "<โดเมนของคุณ>";
  if (!allowedHosts.size) {
    return [
      "ClipPang Local รับคำขอจากเครื่องนี้เท่านั้น",
      "",
      "ถ้าต้องการเปิดให้เครื่องอื่น (เช่นมือถือ) เข้าใช้ ให้ตั้งสองค่านี้ใน .env แล้วเปิดโปรแกรมใหม่:",
      `  CLIPPANG_ALLOWED_HOSTS=${shown}`,
      "  CLIPPANG_ACCESS_TOKEN=<รหัสยาวอย่างน้อย 16 ตัวอักษร>",
      "",
      "โปรแกรมนี้ไม่มีระบบล็อกอินในตัว ใครเข้าถึง URL ได้จะใช้คีย์ Gemini และไฟล์ในเครื่องคุณได้",
      "ถ้าเปิดออกอินเทอร์เน็ตจริง ควรมีระบบยืนยันตัวตนคั่นไว้ด้านหน้าด้วย เช่น Cloudflare Access",
    ].join("\n");
  }
  if (tokenLength < 16) {
    return [
      "ตั้ง CLIPPANG_ALLOWED_HOSTS ไว้แล้ว แต่ CLIPPANG_ACCESS_TOKEN ยังไม่ถึง 16 ตัวอักษร",
      "ระบบจะไม่เปิดให้เข้าจากเครื่องอื่นถ้าไม่มีรหัสที่ยาวพอ",
    ].join("\n");
  }
  if (!allowedHosts.has(String(host).toLowerCase())) {
    return `โฮสต์ ${shown} ไม่ได้อยู่ใน CLIPPANG_ALLOWED_HOSTS`;
  }
  return [
    `ต้องแนบรหัสมาด้วย — เปิด https://${shown}/?token=<รหัสของคุณ> หนึ่งครั้ง`,
    "ระบบจะจำไว้ในคุกกี้ของเครื่องนั้นให้เอง ครั้งต่อไปเข้าได้เลย",
  ].join("\n");
}
