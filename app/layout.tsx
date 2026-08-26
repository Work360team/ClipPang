import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource/kanit/300.css";
import "@fontsource/kanit/400.css";
import "@fontsource/kanit/500.css";
import "@fontsource/kanit/600.css";
import "@fontsource/kanit/700.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Clip360 — เปลี่ยนคลิปสินค้าให้พร้อมขาย";
  const description =
    "สร้างเสียงพากย์ไทย สคริปต์ขาย และซับคาราโอเกะให้คลิปสินค้าในไม่กี่นาที พร้อมพรีวิวก่อนเรนเดอร์จริง";

  return {
    metadataBase: new URL(origin),
    title: {
      default: title,
      template: "%s · Clip360",
    },
    description,
    applicationName: "Clip360",
    keywords: ["Clip360", "ซับไตเติล", "เสียงพากย์ AI", "คลิปสินค้า", "ปักตะกร้า"],
    authors: [{ name: "Clip360" }],
    creator: "Clip360",
    robots: { index: true, follow: true },
    // โลโก้จริงของโปรเจกต์ ใช้ทั้งแท็บเบราว์เซอร์ หน้าจอโฮมของมือถือ และ PWA
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
        { url: "/clip360-logo-32.png", type: "image/png", sizes: "32x32" },
        { url: "/clip360-logo-192.png", type: "image/png", sizes: "192x192" },
        { url: "/clip360-logo-512.png", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/clip360-logo-180.png", sizes: "180x180", type: "image/png" }],
      shortcut: ["/favicon.ico"],
    },
    openGraph: {
      type: "website",
      locale: "th_TH",
      url: origin,
      siteName: "Clip360",
      title,
      description,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1732,
          height: 909,
          alt: "Clip360 — คลิปพร้อมขายในไม่กี่นาที",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
