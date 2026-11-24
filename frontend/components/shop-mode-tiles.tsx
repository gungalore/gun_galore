// 'use client' — the Armory disclosure needs useState, the bar reads the
// session, and it reads the pathname to gate itself.
'use client';

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { findAccountItem } from '@/lib/account-menu-data';
import { useUser } from '@/lib/auth';
import { isFinePrintRoute } from '@/lib/fine-print-routes';
import { isTabRoute } from '@/lib/shell-routes';

/**
 * The quick actions bar — Sell your gear, Motivation Creator and Armory —
 * mounted once in components/shell/app-shell.tsx directly under the top nav.
 *
 * ⚠️ THE OLD FOUR-BOX STRIP IS GONE (operator, 2026-11-23). It had grown
 * descriptions, live counts, a primary-fill button, a gold-fill button and an
 * Armory panel; every one of those competed with the nav, the hero and the
 * product feed. The shopping surfaces (Marketplace / Auction) now live in the
 * three-way switch above, and this bar is three label-only buttons.
 *
 * Armory is the one disclosure. Signed in, it opens three child buttons, each
 * carrying its own short description INSIDE the button. Signed out it is a
 * link to /account instead: the member tool names must not render on the
 * public homepage, and /account is already behind the auth wall.
 */

const ARMORY_PANEL_SOURCE: { href: string; blurb: string }[] = [
  { href: '/documents', blurb: 'Store all Motivation Documents' },
  { href: '/bench', blurb: 'Work up a load' },
  { href: '/licence-centre/tracking', blurb: 'Track your Application' },
];

const ARMORY_CHILDREN = ARMORY_PANEL_SOURCE.flatMap(({ href, blurb }) => {
  const item = findAccountItem(href);
  // Defensive, not paranoid: this component must not crash over a menu-data
  // edit made elsewhere. app/account/page.tsx uses the same pattern.
  if (!item) return [];
  return [{ href: item.href, label: item.label, blurb }];
});

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform var(--dur-fast) var(--ease-standard)',
        flexShrink: 0,
      }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** How far the panel must be dragged before letting go dismisses it. */
const DISMISS_DRAG_PX = 90;

export function ShopModeBar() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  /**
   * The panel is a page-level disclosure, not a mode. It closes on the next
   * real interaction outside the bar, on Escape, on scroll, and whenever the
   * route changes — the installed PWA keeps the shell mounted across
   * navigations, so the route effect is not redundant.
   */
  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: Event) => {
      const bar = barRef.current;
      if (bar && event.target instanceof Node && bar.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close();
    };

    document.addEventListener('pointerdown', closeIfOutside, true);
    // iOS and some installed-PWA webviews do not always emit pointerdown for
    // a touch that starts a scroll; touchstart is the one that always fires.
    document.addEventListener('touchstart', closeIfOutside, {
      capture: true,
      passive: true,
    });
    document.addEventListener('focusin', closeIfOutside, true);
    // Capture scroll, not bubble: the page may scroll a nested element and the
    // window's own scroll event would not fire for it.
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('popstate', close);
    window.addEventListener('hashchange', close);
    window.addEventListener('resize', close);

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('touchstart', closeIfOutside, true);
      document.removeEventListener('focusin', closeIfOutside, true);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('popstate', close);
      window.removeEventListener('hashchange', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Keep the panel from surviving a route change while the shell stays
  // mounted. The App Router does not unmount the shell on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // A document, or a focused secure flow — not a shop surface. See
  // lib/fine-print-routes.ts for why the policy pages are enumerated.
  //
  // ⚠️ /checkout MATCHES ON PATH SEGMENTS, NOT ON THE RAW PREFIX. A bare
  // `startsWith('/checkout')` also swallows a future `/checkouts` or
  // `/checkout-help`.
  const path = pathname ?? '';
  const hidden =
    isFinePrintRoute(pathname) ||
    path === '/checkout' ||
    path.startsWith('/checkout/') ||
    // The Community feed and Messages are main screens, not shop surfaces.
    // Community's ROOT header carries the three-way switch; Messages now has
    // its own bottom tab. The Sell/Motivation/Armory shortcuts would be a
    // second navigation band over either.
    path === '/community' ||
    path === '/messages' ||
    path.startsWith('/messages/');

  // ── Drag-to-dismiss (phones only) ──────────────────────────────────
  // The handle at the top of the panel takes a downward drag; released past
  // DISMISS_DRAG_PX the panel closes, otherwise it springs back. Upward drag
  // is damped, because there is nothing up there to reveal.
  const drag = useRef({ active: false, startY: 0, dy: 0 });
  const [dragY, setDragY] = useState(0);

  function onHandleDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { active: true, startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onHandleMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    const raw = e.clientY - drag.current.startY;
    const dy = raw > 0 ? raw : raw * 0.2;
    drag.current.dy = dy;
    setDragY(dy);
  }
  function onHandleUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (drag.current.dy > DISMISS_DRAG_PX) setOpen(false);
    drag.current.dy = 0;
    setDragY(0);
  }

  if (hidden) return null;

  // The public licence entry is the neutral /motivation page; a signed-in
  // member goes straight to the application. Both are the same product.
  const motivationHref = isSignedIn
    ? '/licence-centre/applications'
    : '/motivation';

  // Until the session settles, treat Armory as signed out. That renders a
  // plain /account link rather than briefly mounting the member-only panel.
  const canOpenArmory = isLoaded && isSignedIn;

  return (
    // `data-shop-scope` is the mobile gate, and it is CSS-only. On desktop the
    // band shows on every surface the shell renders; on a phone and in the
    // installed app it is a shop-surface thing ('tabs-only'). Keeping the
    // markup identical at every viewport is what lets the server render it
    // without guessing the audience.
    <div
      ref={barRef}
      data-shop-mode-bar
      data-shop-scope={isTabRoute(pathname) ? 'tabs' : 'tabs-only'}
      data-signed-out={canOpenArmory ? undefined : 'true'}
    >
      <nav
        aria-label="Quick actions"
        className="max-w-[var(--page-max)] mx-auto px-4 sm:px-6 pt-[18px]"
      >
        <div className="gg-quick-actions">
          {/* PWA only. On desktop/tablet this lives beside Explore Gear in the
              hero; repeating it under the nav would be the duplicate the
              move was meant to remove. */}
          <Link
            href={motivationHref}
            className="gg-quick-action gg-quick-action-mobile gg-press"
          >
            Motivation Creator
          </Link>
          {/* Armory is member-only; it is deliberately absent signed out so
              no restricted member-tool vocabulary reaches a public crawler. */}
          {canOpenArmory && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls="armory-panel"
              onClick={() => setOpen((o) => !o)}
              className="gg-quick-action gg-press"
            >
              Armory
              <Caret open={open} />
            </button>
          )}
        </div>
      </nav>

      {canOpenArmory && open && (
        <div
          className="max-w-[var(--page-max)] mx-auto px-4 sm:px-6"
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: drag.current.active
              ? 'none'
              : 'transform var(--dur-fast) var(--ease-out)',
            touchAction: dragY ? 'none' : undefined,
          }}
        >
          <div
            className="sm:hidden flex justify-center pt-[11px]"
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            aria-hidden
          >
            <span
              style={{
                width: 38,
                height: 4,
                borderRadius: 999,
                background: 'var(--border-hover)',
              }}
            />
          </div>
          <div
            id="armory-panel"
            className="grid grid-cols-1 sm:grid-cols-3 gap-[11px] sm:gap-[14px] pt-[11px] items-stretch"
          >
            {ARMORY_CHILDREN.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className="gg-armory-action gg-press gg-armory-sub"
                style={{ animationDelay: `${index * 120}ms` }}
              >
                <span className="gg-armory-action-title">{item.label}</span>
                <span className="gg-armory-action-desc">{item.blurb}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
