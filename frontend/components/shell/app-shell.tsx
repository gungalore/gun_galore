'use client';

// The mobile app shell: header, scrolling pane, tab bar.
//
// Mounted once in the root layout, wrapping every page. What it actually DOES
// depends entirely on CSS (see the .gg-shell block in app/globals.css):
//
//   mobile web / desktop — the wrapper and the pane are `display: contents`,
//                          so neither is a box. The document scrolls exactly as
//                          it always has and page layout is untouched.
//   installed PWA        — the wrapper is a locked viewport-height flex column
//                          and the pane is what scrolls.
//
// Keeping the markup identical in all three cases is the point: the server
// renders the same HTML for a phone and a desktop, so nothing depends on
// guessing the viewport before hydration and there is no layout flash. The
// alternative — branching on a width or on display-mode in JS — renders one
// chrome on the server and possibly another after hydration, which is the exact
// failure components/public-chrome.tsx was written to avoid.

import { Suspense, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BottomTabBar } from '@/components/bottom-tab-bar';
import { ShopModeBar } from '@/components/shop-mode-tiles';
import { ShellHeader } from '@/components/shell/shell-header';
import { ShellScrollProvider } from '@/components/shell/shell-scroll';
import { ShellStepProvider } from '@/components/shell/shell-step';
import { hasShell } from '@/lib/shell-routes';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const paneRef = useRef<HTMLDivElement>(null);

  // Admin has its own chrome; /witness and /consent are statutory statements
  // that must carry no marketplace furniture at all; the Clerk pages and the
  // offline fallback own their whole screen. These get the page and nothing
  // else — not even the wrapper, so no context, no pane, and useShellScroller
  // correctly falls back to the window.
  if (!hasShell(pathname)) return <>{children}</>;

  return (
    <ShellScrollProvider paneRef={paneRef}>
      <ShellStepProvider>
        <div className="gg-shell">
        {/* No Suspense boundary here, on purpose — see the note in
            shell-header.tsx. The header reads no search params, so it must not
            be behind a boundary: one would make it absent from the prerendered
            HTML of every static route and pop in after hydration. */}
        <ShellHeader />

        {/* The shop-mode bar — the Buy Now / Auctions / Armory fork, directly
            under the nav. It slots in AFTER the header and BEFORE the pane so
            the order is header → bar → content in both modes: on mobile the
            shell is a real flex column and the bar is the second row; on
            desktop the shell is `display: contents`, so the bar lands in
            normal flow after the sticky <Nav> (components/nav.tsx) and is
            simply the first thing on the page.

            ⚠️ THE BAR IS NOT STICKY, unlike the nav above it — an operator
            decision, and the reason it lives inside the flow rather than in a
            fixed layer. See the [data-shop-mode-bar] block in globals.css.

            It self-gates (fine print, /checkout, and the mobile shop-surface
            allowlist), so nothing here has to know those rules. AppShell's own
            early return above keeps it off admin / sign-in / sign-up / offline
            / witness / consent for free. */}
        <ShopModeBar />

        <div ref={paneRef} className="gg-shell-pane" data-shell-pane>
          {children}
        </div>

        <Suspense fallback={null}>
          <BottomTabBar />
        </Suspense>
        </div>
      </ShellStepProvider>
    </ShellScrollProvider>
  );
}
