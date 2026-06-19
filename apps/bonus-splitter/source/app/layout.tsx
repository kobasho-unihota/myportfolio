import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ボーナス分配",
  description: "ボーナスを家計貯金と個人枠へ分配する計算ツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
