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
  const title = "ClipPang — เปลี่ยนคลิปสินค้าให้พร้อมขาย";
  const description =
    "สร้างเสียงพากย์ไทย สคริปต์ขาย และซับคาราโอเกะให้คลิปสินค้าในไม่กี่นาที พร้อมพรีวิวก่อนเรนเดอร์จริง";

  return {
    metadataBase: new URL(origin),
    title: {
      default: title,
      template: "%s · ClipPang",
    },
    description,
    applicationName: "ClipPang",
    keywords: ["ClipPang", "ซับไตเติล", "เสียงพากย์ AI", "คลิปสินค้า", "ปักตะกร้า"],
    authors: [{ name: "ClipPang" }],
    creator: "ClipPang",
    robots: { index: true, follow: true },
    // โลโก้จริงของโปรเจกต์ ใช้ทั้งแท็บเบราว์เซอร์ หน้าจอโฮมของมือถือ และ PWA
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
        { url: "/clippang-logo-32.png", type: "image/png", sizes: "32x32" },
        { url: "/clippang-logo-192.png", type: "image/png", sizes: "192x192" },
        { url: "/clippang-logo-512.png", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/clippang-logo-180.png", sizes: "180x180", type: "image/png" }],
      shortcut: ["/favicon.ico"],
    },
    openGraph: {
      type: "website",
      locale: "th_TH",
      url: origin,
      siteName: "ClipPang",
      title,
      description,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1732,
          height: 909,
          alt: "ClipPang — คลิปพร้อมขายในไม่กี่นาที",
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
