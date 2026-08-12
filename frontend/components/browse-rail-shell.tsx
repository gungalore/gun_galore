'use client';

import type { ReactNode } from 'react';
import { FeaturedRail } from './featured-rail';

// Wraps a browse/content page body with the site's featured-listings
// sidebar (the sticky, full-bleed left rail). The featured rail used to
// live ONLY on the homepage + listing-detail — every category / deals /
// raffle / brand / seller page had nothing (operator 2026-07-20:
// "EVERY page should have featured listings"). Drop this INSIDE a page's
// existing `max-w-[var(--page-max)] mx-auto px-4` container: the rail's full-bleed
// margin maths reference that container's content box exactly (identical
// to the homepage), and the page content flows to its right.
//
// FeaturedRail is `hidden lg:block`, so on mobile the content takes the
// full width and the sticky bottom strip (layout-level) carries featured.
export function BrowseRailShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <FeaturedRail />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
