/**
 * ชุดสีไฮไลต์ซับ
 *
 * สไตล์ซับ 15 อันต่างกันที่ "ท่าเคลื่อนไหว" เป็นหลัก แต่ 9 อันใช้สีชุดเดียวกันเป๊ะ
 * (เหลือง #FFD400 กับชมพู #FF3B6B) คลิปที่ทำออกมาจึงหน้าตาสีเหมือนกันไปหมด
 * ชุดสีนี้เลยแยกเรื่อง "สี" ออกจาก "ท่า" ให้เลือกประกอบกันเองได้
 *
 * ให้เลือกจากชุดที่คุมมาแล้ว ไม่เปิดจานสีอิสระ เพราะผู้ใช้กลุ่มหลักไม่ใช่ดีไซเนอร์
 * และสีที่เลือกเองมักจมหายไปกับพื้นหลัง ทุกชุดในนี้อยู่บนตัวอักษรที่มีขอบดำหนา
 * จึงอ่านออกทั้งบนภาพสว่างและภาพมืด
 */

/** primary = คำที่กำลังพูด · secondary = คำที่เน้น */
export const CAPTION_COLOR_SETS = [
  { id: "yellow-pop", name: "เหลืองปัง", primary: "#FFD400", secondary: "#FF3B6B", hint: "ค่ามาตรฐานสายปักตะกร้า" },
  { id: "basket-orange", name: "ส้มตะกร้า", primary: "#FF7A1A", secondary: "#FFE04D", hint: "เข้าโทนตะกร้าส้ม" },
  { id: "sweet-pink", name: "ชมพูหวาน", primary: "#FF4D9D", secondary: "#FFD400", hint: "ความงาม ของน่ารัก" },
  { id: "fresh-green", name: "เขียวสด", primary: "#3DF07B", secondary: "#FFFFFF", hint: "อาหารเสริม ของสด" },
  { id: "neon-cyan", name: "ฟ้านีออน", primary: "#00E5FF", secondary: "#FF2D55", hint: "แกดเจ็ต ไอที" },
  { id: "premium-violet", name: "ม่วงพรีเมียม", primary: "#B26BFF", secondary: "#4DFFB0", hint: "ของดูแพง" },
  { id: "sale-red", name: "แดงลดราคา", primary: "#FF3B30", secondary: "#FFD400", hint: "โปรโมชัน เร่งตัดสินใจ" },
  { id: "clean-white", name: "ขาวสะอาด", primary: "#FFFFFF", secondary: "#FFD400", hint: "ภาพรก ไม่อยากให้สีแย่งสินค้า" },
];

export function captionColorSet(id) {
  if (!id) return null;
  return CAPTION_COLOR_SETS.find((set) => set.id === String(id)) ?? null;
}

/**
 * ทาชุดสีลงบน params ของสไตล์
 *
 * ต้องดูก่อนว่าสไตล์นั้นใช้ช่องไหนเป็น "สีเน้น" จริง ๆ — บางสไตล์ (ไฮไลต์คำสำคัญ,
 * เผยทีละคำ) ตั้งสีคำที่พูดเป็นสีขาวเท่ากับคำปกติโดยตั้งใจ แล้วไปใส่สีที่คำเน้นแทน
 * ถ้าทาลง activeFill ตรง ๆ ทุกคำจะกลายเป็นสีทั้งประโยคและดีไซน์ของสไตล์พังทันที
 */
export function applyColorSet(params, set) {
  if (!set) return params;
  const accentIsActive = String(params.activeFill ?? "").toUpperCase() !== String(params.fill ?? "").toUpperCase();

  if (accentIsActive) {
    params.activeFill = set.primary;
    if (params.emphasisFill) params.emphasisFill = set.secondary;
  } else {
    // สไตล์ที่คำพูดเป็นสีเดียวกับคำปกติ — สีของชุดต้องไปอยู่ที่คำเน้น
    params.emphasisFill = set.primary;
  }

  // สไตล์เรืองแสงมีแสงรอบตัวอักษรเป็นอีกสีหนึ่ง ปล่อยไว้จะตีกับสีใหม่
  if (params.glow) params.glow.color = set.primary;
  return params;
}
