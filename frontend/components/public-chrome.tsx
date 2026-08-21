'use client';

// Thin client wrapper that decides whether to render the public-site
// chrome (Nav at the top, SiteFooter at the bottom). The root layout
// is server-rendered + wraps every route, but admin pages have their
// own layout/chrome and shouldn't show the public Nav or footer.
//
// Uses usePathname to detect /admin/* routes (and the /admin/login
// page which sits OUTSIDE the (protected) group but should still
// hide the public chrome).

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Nav } from '@/components/nav';
import { av } from '@/lib/asset-version';

// UX-8 — stripped checkout chrome: logo + "Secure checkout 🔒" + Help only.
// Replaces the full marketplace nav on /checkout/* so the buyer stays focused
// through the secure flow. Rendered WITHOUT the data-public-nav wrapper so it
// stays visible in installed-PWA (standalone) mode too — the buyer keeps a
// clear header + a route home while paying (the bottom tab bar is still there).
function CheckoutHeader() {
  return (
    <div style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg-deep)' }}>
      <div className="max-w-[var(--page-max)] mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" aria-label="All Outdoor" className="flex items-center shrink-0">
          {/* /logo-nav.svg, not /logo.svg: the full-scene lockup is 1.5:1, so at
              36px tall it draws 54px wide and the wordmark becomes ~7px — an
              illegible smudge at the exact moment the buyer is handing over
              money. The nav mark is the same wordmark at 2.66:1. */}
          <Image src={av('/logo-nav.svg')} alt="All Outdoor" width={96} height={36} priority style={{ height: 36, width: 'auto' }} />
        </Link>
        <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <span aria-hidden>🔒</span> Secure checkout
        </span>
        <Link href="/support" className="text-sm" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
          Help
        </Link>
      </div>
    </div>
  );
}

export function PublicNav() {
  const pathname = usePathname();
  if (pathname.startsWith('/admin')) return null;
  // ⚠️ NO SHOP CHROME AROUND A STATUTORY FORM. /witness/* is opened by a
  // member of the public who received an SMS — not a customer, not a member,
  // and not somebody who came here to browse. Wrapping their character
  // statement in a marketplace nav, a Sell button and a cart puts a firearms
  // storefront around a document going to the police, and invites a stranger
  // to shop while they are being asked whether somebody is fit to hold a
  // firearm. It also reads as the wrong site entirely, which for a link from
  // an unfamiliar sender is the difference between completing it and closing
  // it.
  if (pathname.startsWith('/witness')) return null;
  // UX-8 — minimal secure chrome on the checkout flow (single-item, offer,
  // and the post-payment complete page all live under /checkout/*).
  if (pathname.startsWith('/checkout')) return <CheckoutHeader />;
  // data-public-nav wrapper lets globals.css hide the whole thing in
  // standalone-PWA mode (`html[data-standalone='true'] [data-public-nav]`).
  // We deliberately keep it server-renderable — no useStandalone here —
  // so initial HTML matches for browser-mobile users and the CSS does
  // the hide on first paint via the pre-paint script in layout.tsx.
  return (
    <div data-public-nav>
      <Nav />
    </div>
  );
}

// Takes the (server-rendered) SiteFooter as children so its data fetch
// (UX-1f category row) stays server-side — a client wrapper can't render an
// async server component it imports directly, but it CAN slot one passed as
// children.
export function PublicFooter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Hide on admin pages (own chrome) and on the offline fallback (PWA).
  if (pathname.startsWith('/admin')) return null;
  if (pathname === '/offline') return null;
  // UX-8 — no marketplace footer during the secure checkout flow.
  if (pathname.startsWith('/checkout')) return null;
  // See PublicNav: the witness form is not a page of the shop.
  if (pathname.startsWith('/witness')) return null;
  return <div data-public-footer>{children}</div>;
}
