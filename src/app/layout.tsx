import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "무협 챗 게임",
  description: "개인용 로컬 무협 챗 게임",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
