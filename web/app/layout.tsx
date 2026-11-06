import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-sans-face" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "Chaperone · policy vault for AI agents",
  description: "Give an AI agent money without giving it the keys. A policy vault on NEAR.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fcfbf9" };

// Theme is applied before paint so dark mode does not flash.
const themeScript = `try{var t=localStorage.getItem("chaperone-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
