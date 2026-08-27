'use client';

import type { ReactNode } from 'react';

// Formerly wrapped page content with the featured-listings sidebar
// (FeaturedRail, now removed). Kept as a passthrough shell rather than
// deleted outright: seven pages import and render it, and collapsing it to
// a no-op wrapper means none of them need to change.
export function BrowseRailShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
