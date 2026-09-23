// app/layout.tsx - ALL Outdoor fonts, icons and social metadata (Next.js App Router)
// 1. Copy into /public:
//      favicon.ico                         (04-Favicons/favicon.ico)
//      icons/favicon-dark-32.png, icons/favicon-dark-192.png
//      icons/apple-touch-icon-180.png      (03-App-Icons/iOS)
//      icons/pwa-icon-192.png, icons/pwa-icon-512.png, icons/pwa-maskable-512.png
//      og/open-graph-dark-1200x630.png     (05-Social-Media)
//      brand/logo-horizontal-light-transparent.svg, brand/logo-horizontal-dark-transparent.svg,
//      brand/emblem-light-transparent.svg, brand/emblem-dark-transparent.svg
//      site.webmanifest                    (09-Developer-Files)
// 2. Merge the below into your root layout.

import type { Metadata, Viewport } from "next";
import { League_Spartan, Montserrat } from "next/font/google";

export const display = League_Spartan({
  subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap",
});
export const body = Montserrat({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap",
});
// <html lang="en-ZA" className={`${display.variable} ${body.variable}`}>

export const metadata: Metadata = {
  metadataBase: new URL("https://alloutdoor.co.za"),
  title: { default: "ALL Outdoor", template: "%s | ALL Outdoor" },
  description: "New and secondhand outdoor gear. Marketplace, auctions and more across South Africa.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/favicon-dark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-dark-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website", locale: "en_ZA", siteName: "ALL Outdoor",
    images: [{ url: "/og/open-graph-dark-1200x630.png", width: 1200, height: 630, alt: "ALL Outdoor" }],
  },
  twitter: { card: "summary_large_image", images: ["/og/open-graph-dark-1200x630.png"] },
};

export const viewport: Viewport = { themeColor: "#111111" };
