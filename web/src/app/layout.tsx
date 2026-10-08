import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentCraft Genesis — G7 Product Experience",
  description:
    "Give Genesis a goal. It builds the AI organization needed to achieve it. Calm enterprise UI client to the verified Genesis Gateway.",
  keywords: [
    "AgentCraft",
    "Genesis",
    "AGI",
    "multi-agent",
    "goal-driven",
    "TypeScript",
  ],
  authors: [{ name: "AgentCraft Genesis" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // WCAG 2.2 AA: support 200%+ zoom
  themeColor: "#F7F9FC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
