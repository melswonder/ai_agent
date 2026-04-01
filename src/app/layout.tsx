import type { Metadata } from "next";
import { IBM_Plex_Mono, M_PLUS_1p } from "next/font/google";
import "./globals.css";

const mplus = M_PLUS_1p({
  variable: "--font-mplus",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Spotify Chat DJ",
  description: "LangGraph と Spotify をつないだチャット型ミュージックコントローラー",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${mplus.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
