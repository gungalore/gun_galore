'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isGaMeasurementId, shouldTrackGaPage } from '@/lib/analytics';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Google Analytics 4 for the public site.
 *
 * Mounted from the root layout only when the server has a real
 * `GA_MEASUREMENT_ID`; with no id this renders nothing, so a deploy can land
 * before the GA property exists.
 *
 * The App Router is a SPA: `gtag('config')` fires ONE page_view (the first
 * load), so every later client-side navigation needs its own `page_view`
 * event. `send_page_view: false` + an explicit event per pathname is the only
 * way to avoid double-counting the first page and missing the rest.
 *
 * `/admin` and `/a/<token>` are skipped by `shouldTrackGaPage` — the Desk is
 * internal and an action-token URL is a credential that must not be sent to a
 * third party.
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!isGaMeasurementId(measurementId)) return;
    if (!shouldTrackGaPage(pathname)) return;
    if (lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    window.gtag?.('event', 'page_view', {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
      send_to: measurementId,
    });
  }, [measurementId, pathname]);

  if (!isGaMeasurementId(measurementId)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
          measurementId,
        )}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=window.gtag||gtag;gtag('js',new Date());gtag('config','${measurementId}',{send_page_view:false});`}
      </Script>
    </>
  );
}
