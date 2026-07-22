'use client';

// Fires a page_view beacon on every client navigation. Mounted once in the
// root layout. Skips /admin/* (operator traffic) entirely.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView } from '@/lib/activity-beacon';

export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;
    trackPageView(pathname);
  }, [pathname]);
  return null;
}
