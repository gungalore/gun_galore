'use client';

// RecordVisit — invisible client component that pushes the current
// listing's ID into the recently-viewed localStorage stack on mount.
// Mounted in listing-detail server-component pages so the rail on
// other pages picks up this visit. Renders nothing.

import { useEffect } from 'react';
import { useRecentlyViewed } from '@/lib/use-recently-viewed';

export function RecordVisit({ listingId }: { listingId: string }) {
  const { push } = useRecentlyViewed();
  useEffect(() => {
    if (listingId) push(listingId);
  }, [listingId, push]);
  return null;
}
