'use client';

// Fires a page_view beacon on every client navigation. Mounted once in the
// root layout.
//
// Watches the QUERY STRING as well as the pathname: the main browse views are
// query-only variants of "/" (/?listingType=BUY_NOW|AUCTION|TAKE_A_SHOT|SWOP,
// /?q=…), so a pathname-only effect never fires for them and those views —
// the most-visited ones on the site — recorded zero page views.
//
// useSearchParams() forces its subtree out of static rendering, so the
// component wraps ITSELF in <Suspense>. That keeps the boundary local (this
// renders null) instead of deopting every page in the root layout to dynamic.
import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { trackPageView } from '@/lib/activity-beacon';

// Never record these — operator traffic, or URLs carrying single-use tokens /
// auth material we must not persist into the analytics table.
const SKIP_PREFIXES = ['/admin', '/a/', '/sign-in', '/sign-up', '/sso-callback'];

// Query params that may carry credentials or one-time codes. (The campaign
// key `c` is deliberately KEPT — it's the click-attribution signal.)
const SENSITIVE_PARAMS = ['token', 'code', 'secret', 'password', 'ticket'];

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

    trackPageView(path);
  }, [pathname, searchParams]);

  return null;
}

export function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
