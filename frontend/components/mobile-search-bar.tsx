'use client';

// MobileSearchBar — sticky search input shown ONLY at the top of the
// Browse screen ("/") when the app is running as an installed PWA.
//
// In browser mode the existing nav.tsx already has a search input in
// the top toolbar. In standalone mode the top nav is hidden (the
// bottom tab bar replaces it), so the user has no search affordance
// — this thin sticky bar fills the gap on the page they're most
// likely to want to search from.
//
// Self-gating on standalone AND pathname means parent pages don't
// have to think about when to render it: just mount once in the root
// layout and the component decides whether to show.

import { usePathname } from 'next/navigation';
import { useStandalone } from '@/lib/use-standalone';
import { LiveSearch } from '@/components/live-search';

export function MobileSearchBar() {
  const isStandalone = useStandalone();
  const pathname = usePathname();

  // Browse-screen-only. Listing-type filtered routes still get the
  // search bar so users can refine inside the surface (e.g. "rifle"
  // inside Auctions).
  if (!isStandalone) return null;
  if (pathname !== '/') return null;

  return (
    <div
      className="app-chrome"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
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
