import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";

// Falls back to localhost in dev; set NEXT_PUBLIC_SITE_URL in your
// production env (Vercel project settings) to your real domain.
// metadataBase turns the relative og:image path below into the
// absolute URL that WhatsApp/Slack/Twitter/etc. actually require —
// without it, link-unfurlers silently fail to load the preview image.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const title = "LeetTrack — Class Leaderboards & LeetCode Tracking";
const description =
  "LeetTrack turns daily LeetCode practice into ranked, live performance for your whole class.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    // Pages can override just their own segment, e.g.
    // `title: "Leaderboard"` renders as "Leaderboard | LeetTrack".
    template: "%s | LeetTrack",
  },
  description,
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "LeetTrack",
    // 1200x630 is the size every major unfurler (WhatsApp, iMessage,
    // Slack, Discord, Twitter/X, LinkedIn, Facebook) expects — anything
    // off-ratio gets awkwardly cropped instead of shown in full.
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "LeetTrack",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#08080B] text-[#EDEDEF] font-body">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
