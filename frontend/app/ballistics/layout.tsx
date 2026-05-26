// frontend/app/ballistics/layout.tsx
//
// Layout wrapper for every ballistics route. Wraps children in
// `.bc-app` so the scoped instrument tokens apply.
//
// Crucially: does NOT render the marketplace header / footer / bottom
// tab bar. The ballistic calculator is a distinct product with its
// own chrome. Users who land here via ballistics.gungalore.co.za
// don't see Gun Galore marketplace nav at all.
//
// Font choice — currently using system-stack fallbacks (Helvetica /
// SF Mono on macOS, Segoe UI / Consolas on Windows, Roboto / Roboto
// Mono on Android) instead of the design's Space Grotesk + JetBrains
// Mono. Why: `next/font/google` cold-fetches the font files at first
// compile + bundles them locally. On a slow/blocked network that
// download HANGS the entire page compile forever (HeadersTimeoutError
// in the dev log; page never renders). System stack is one less
// network dependency in the critical path and the readout font-
// variant-numeric: tabular-nums still gives the locked-grid feel.
// To restore the bespoke fonts: self-host the .woff2 files in
// /public/fonts/ and reference them in ballistics.css via @font-face
// — that bypasses Google Fonts entirely.

import type { Metadata, Viewport } from 'next';
import './ballistics.css';

export const metadata: Metadata = {
  title: {
    default: 'Gun Galore Ballistic Calculator',
    template: '%s · Gun Galore Ballistics',
  },
  description:
    'Standalone South African ballistic calculator with AI bullet lookup, GPS-aware atmospherics, and the Spot Tracker for finding fallen game. Works offline. R299 lifetime.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Ballistics',
  },
};

// themeColor lives on `viewport`, not `metadata`, per Next 14+.
export const viewport: Viewport = {
  themeColor: '#050507',
};

export default function BallisticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="bc-app">{children}</div>;
}
