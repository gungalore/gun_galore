'use client';

// MobileSearchBar — sticky search input at the top of every applicable
// page when the app is running as an installed PWA.
//
// In browser mode the existing nav.tsx already has a search input in
// the top toolbar, so this is a no-op there. In standalone mode the
// top nav is hidden (the bottom tab bar replaces it), so without this
// bar the user has no quick search affordance.
//
// Self-gates on:
//   * standalone mode (browsers use the top-nav search)
//   * a route denylist for focus-flow pages where a sticky search bar
//     would be distracting or have nowhere to go (checkout, /sign-in,
//     /listings/new, KYC, admin chrome, offline fallback).
// Parent pages don't have to think about when to render it: mount once
// in the root layout and the component decides.

import { usePathname } from 'next/navigation';
import { useStandalone } from '@/lib/use-standalone';
import { LiveSearch } from '@/components/live-search';

// Pathname prefixes where the sticky search bar should NOT render. All
// of these are either focus flows (checkout / sell / KYC) where search
// noise hurts conversion, or have their own chrome (admin, offline).
const HIDDEN_PREFIXES = [
  '/admin',
  '/checkout',
  '/sign-in',
  '/sign-up',
  '/listings/new',
  '/kyc/verify',
  '/offline',
  '/notifications', // page has its own header; no need for inline search
];

function shouldHide(pathname: string): boolean {
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Dealer-verification upload pages live at /transactions/:id/dealer-verification
  if (pathname.endsWith('/dealer-verification')) return true;
  return false;
}

export function MobileSearchBar() {
  const isStandalone = useStandalone();
  const pathname = usePathname();

  if (!isStandalone) return null;
  if (shouldHide(pathname)) return null;

  return (
    <div
      className="app-chrome"
      style={{
        position: 'sticky',
        top: 0,
        // Must sit ABOVE UrgentNotifications (zIndex 49) so the
        // LiveSearch dropdown — which renders absolute-positioned
        // inside this container — stacks above the urgent strip.
        // Without this the dropdown disappears behind the urgent
        // notifications bar in PWA mode.
        zIndex: 50,
        padding: '10px 12px',
        background: 'var(--bg-deep)',
        borderBottom: '0.5px solid var(--border)',
        // Sit below the iOS status bar in standalone mode (translucent
        // status bar is layered over our content).
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
      }}
    >
      <LiveSearch />
    </div>
  );
}
