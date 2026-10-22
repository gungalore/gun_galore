'use client';

// Fires a page_view beacon on every client navigation, and a page_dwell
// beacon when the member leaves that route (or backgrounds the tab).
//
// Watches the QUERY STRING as well as the pathname: the main browse views are
// query-only variants of "/" (/?listingType=BUY_NOW|AUCTION, /?q=…), so a
// pathname-only effect never fires for them and those views — the most-visited
// ones on the site — recorded zero page views.
//
// useSearchParams() forces its subtree out of static rendering, so the
// component wraps ITSELF in <Suspense>. That keeps the boundary local (this
// renders null) instead of deopting every page in the root layout to dynamic.
import { Suspense, useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  listingIdForPath,
  sectionForPath,
  trackPageDwell,
  trackPageView,
} from '@/lib/activity-beacon';

// Never record these — operator traffic, or URLs carrying single-use tokens /
// auth material we must not persist into the analytics table.
const SKIP_PREFIXES = ['/admin', '/a/', '/sign-in', '/sign-up', '/sso-callback'];

// Query params that may carry credentials or one-time codes. (The campaign
// key `c` is deliberately KEPT — it's the click-attribution signal.)
const SENSITIVE_PARAMS = ['token', 'code', 'secret', 'password', 'ticket'];

// A glance does not answer "what did they spend time on". Two seconds is the
// floor for an intentional visit and also filters the StrictMode double-mount.
const MIN_DWELL_SEC = 2;

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = useRef<{
    path: string;
    section: ReturnType<typeof sectionForPath>;
    listingId?: string;
    startedAt: number | null;
  } | null>(null);

  const flush = useCallback(() => {
    const cur = current.current;
    if (!cur || cur.startedAt === null) return;
    const seconds = Math.round((Date.now() - cur.startedAt) / 1000);
    cur.startedAt = null;
    if (seconds < MIN_DWELL_SEC) return;
    trackPageDwell({
      path: cur.path,
      durationSec: seconds,
      section: cur.section,
      ...(cur.listingId ? { listingId: cur.listingId } : {}),
    });
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;

    let path = pathname;
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    for (const key of [...params.keys()]) {
      if (
        SENSITIVE_PARAMS.includes(key.toLowerCase()) ||
        key.toLowerCase().startsWith('__clerk')
      ) {
        params.delete(key);
      }
    }
    const qs = params.toString();
    if (qs) path += `?${qs}`;

    current.current = {
      path,
      section: sectionForPath(path),
      listingId: listingIdForPath(path),
      // A route change while the tab is in the background starts paused; the
      // visibility handler below arms it the moment it comes forward.
      startedAt:
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
          ? Date.now()
          : null,
    };
    trackPageView(path, current.current.section);

    return () => flush();
  }, [pathname, searchParams, flush]);

  // Active foreground time only. A backgrounded tab is not "time spent"; it
  // is a parked tab, and counting it is how analytics grows a 9-hour visit.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        flush();
      } else if (current.current && current.current.startedAt === null) {
        current.current.startedAt = Date.now();
      }
    }
    function onPageHide() {
      flush();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush]);

  return null;
}

export function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
