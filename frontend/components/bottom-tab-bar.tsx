'use client';

// Bottom tab bar — the primary nav for installed-PWA users.
//
// Replaces the top hamburger nav (which gets hidden via CSS when
// html[data-standalone="true"]) so the installed app reads as
// native-iOS rather than "website opened fullscreen".
//
// Rendered always in the layout but the component is a no-op (returns
// null) when not in standalone mode. That keeps server HTML identical
// for browser-mobile users — they continue using the existing
// hamburger drawer in nav.tsx.
//
// Five tabs — Sell sits dead-centre (position 3) so the raised FAB
// styling reads symmetric:
//   1. Shop     → opens a CATEGORY-FIRST bottom sheet: the real
//                 top-level category tree (Camping, Optics, Fishing,
//                 Firearms…) up top, with the selling-mode surfaces
//                 (All listings / Marketplace / Auctions / Take a Shot /
//                 Swop / Daily Deals / Prize Draw) demoted below it.
//                 A buyer opening "Shop" is looking for a THING, not a
//                 transaction format; only someone who already knows how
//                 the site sells thinks in modes.
//   2. Saved    → /wishlist. Heart icon with a saved-count badge.
//   3. Sell     → /listings/new (centred, raised red FAB — the
//                 prominent primary action).
//   4. Alerts   → routes to /notifications. Bell icon. When there are
//                 unresolved notifications, shows a red active-count
//                 badge in the top-right corner of the bell.
//   5. Account  → bottom sheet headed by the user's avatar + username,
//                 followed by My account / Shop / Legal sections.
//                 All `/my/*` destinations + /dashboard + /profile
//                 live in here.
//
// ⚠️ ASK BOET IS NOT A TAB, DELIBERATELY. It held slot 4, which pushed the
// wishlist up into the top bar and left the primary navigation with no CART —
// so an installed member could fill a basket and then, on any route where the
// top bar is hidden, have no way back to it. A paid assistant does not outrank
// the basket. Ask Boet is now the floating launcher it already was in browser
// mode (components/ask-gg/ask-gg-host.tsx), which reaches every shopping
// screen rather than one tab in five. Do not put it back in here.
//
// Active-route highlighting via usePathname() + a search-aware match
// helper (so /?listingType=AUCTION lights up the Shop tab even
// though the pathname is just '/').

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton, useUser, useClerk, useAuth } from '@clerk/nextjs';
import { useStandalone } from '@/lib/use-standalone';
import { useCart } from '@/lib/cart-store';
import { useWishlist } from '@/lib/use-wishlist';
import { useViewerFetch } from '@/lib/use-viewer-fetch';
import { isTabRoute } from '@/lib/shell-routes';
import { PushToggleRow } from '@/components/push-opt-in-banner';
import { AccountMenuList } from '@/lib/account-menu';
import type { CategoryWithCount } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Category tree for the Shop sheet ──────────────────────────────
// Same GET /categories/with-counts the homepage curtain and the desktop
// CategoryMenu flyout use — one canonical taxonomy, rolled-up counts (a
// root already includes its children), so the sheet can never disagree
// with the rest of the site.
//
// The flyout's loadCategories() is module-private (not exported), so the
// pattern is repeated here rather than imported. That costs at most ONE
// extra request per session: `cache: 'force-cache'` means the browser HTTP
// cache serves whichever consumer asks second, and the module cache below
// makes every later sheet open free.
//
// Rejects on ANY unusable outcome (HTTP error, non-array, empty list) and
// clears `inflight` on the way out, so a bad response is never cached and
// the NEXT sheet open transparently retries. An empty payload on a seeded
// marketplace means the response was broken, not that the taxonomy is
// empty — caching it would freeze the sheet mode-only for the session.
// Keyed by viewer bucket for the same reason category-menu.tsx is: the tree
// differs by audience, and an installed PWA keeps this module alive across
// sign-out, so one shared cache would show the previous audience's categories.
type ShopViewerKey = 'member' | 'anon';
const catCache: Partial<Record<ShopViewerKey, CategoryWithCount[]>> = {};
const catInflight: Partial<Record<ShopViewerKey, Promise<CategoryWithCount[]>>> = {};

async function loadShopCategories(
  key: ShopViewerKey,
  viewerFetch: (url: string) => Promise<Response>,
): Promise<CategoryWithCount[]> {
  const cached = catCache[key];
  if (cached) return cached;
  if (!catInflight[key]) {
    // no-store (inside viewerFetch), NOT force-cache — the browser cache keys
    // on URL alone and would replay a member response after sign-out.
    catInflight[key] = viewerFetch(`${API_URL}/categories/with-counts`)
      .then((r) => {
        if (!r.ok) throw new Error(`categories ${r.status}`);
        return r.json();
      })
      .then((data: CategoryWithCount[]) => {
        const list = Array.isArray(data) ? data : [];
        if (list.length === 0) throw new Error('categories empty');
        catCache[key] = list;
        return list;
      })
      .catch((err) => {
        catInflight[key] = undefined; // let the next sheet open retry
        throw err;
      });
  }
  return catInflight[key]!;
}

interface Tab {
  key: string;
  label: string;
  href: string;
  // Returns true when the active route belongs to this tab.
  isActive: (pathname: string, search: URLSearchParams) => boolean;
  // Centred-prominent tabs (currently just Sell) get the raised
  // circular-FAB treatment. Only works at 5 tabs (position 3 = 50%).
  prominent?: boolean;
  // 'shop' / 'more' open sheets instead of navigating.
  action?: 'shop' | 'more' | 'search';
}

// Inline SVG icons — no extra dep. 24×24 viewbox, currentColor stroke
// so the active state can tint via `color: var(--red)`.
function IconHome() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 10.5 L12 3.5 L20.5 10.5 V20 A1 1 0 0 1 19.5 21 H14.5 V15 H9.5 V21 H4.5 A1 1 0 0 1 3.5 20 Z"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth={1.9} />
      <path
        d="M15.5 15.5 21 21"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconShop() {
  // Shopping-bag silhouette — universal "browse / shop" affordance.
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 8V6a3 3 0 0 1 6 0v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconGavel() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 4l6 6m-3-3l-7 7m-4-4l5 5m-5-5l-3 3 4 4 3-3m9-13l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 20h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
/* Orders. A parcel, not a receipt or a cart: what the member is checking on
   this tab is the thing in transit, and it is the only glyph in the bar that
   has to read at 24px against four line-drawn siblings. */
function IconBox() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconCart() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 5h2l2.5 11a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.5L21 9H7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
// Same outline heart the top-bar wishlist button used, so the control that
// moved down here is visually the one members already knew.
function IconHeart() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}
function IconSparkles() {
  // Four-point sparkle cluster — universal "AI / magic" affordance.
  // A large centre sparkle with two smaller satellite sparkles reads
  // as the "smart helper" idiom established by ChatGPT / Apple
  // Intelligence / Copilot. Drawn with currentColor stroke so the
  // active-tab tint (var(--red)) flows through.
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Main sparkle — centred, larger */}
      <path
        d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Small sparkle — top-right */}
      <path
        d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Small sparkle — bottom-right */}
      <path
        d="M18.5 16 L19 17.2 L20.2 17.7 L19 18.2 L18.5 19.4 L18 18.2 L16.8 17.7 L18 17.2 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BottomTabBar() {
  const isStandalone = useStandalone();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const [shopOpen, setShopOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [alertsCount, setAlertsCount] = useState<number>(0);
  // Saved-count badge for the Saved tab — same store the old top-bar
  // wishlist button read, so the number cannot disagree between surfaces.
  const wishlist = useWishlist();

  // Hide the tab bar when the user is scrolling DOWN (give them more
  // reading room) and re-show when they scroll back up — standard
  // native-iOS app pattern (Safari does this with its tab bar too).
  // Always show when a sheet is open so the bar doesn't disappear
  // mid-interaction. `data-bottom-chrome-hidden` is mirrored onto
  // <body> so the sticky featured strip can hide in sync.
  const sheetOpen = shopOpen || moreOpen;
  // ⚠️ THE AUTO-HIDE IS GONE, DELIBERATELY. The bar used to slide away on
  // scroll-down and return on scroll-up. Three reasons it went:
  //   * No board shows it. All eleven draw a static bar.
  //   * On a touch device momentum scrolling flips direction constantly, so it
  //     flickered under the reader's thumb. The header's identical experiment
  //     was reverted the same day for exactly this — see the history in the
  //     .gg-shell note in app/globals.css.
  //   * It read window.scrollY, which in the installed app never changes
  //     again: the pane scrolls, not the document. The behaviour was about to
  //     become permanently stuck in the "visible" state anyway.

  // ── Hardware BACK closes the sheet ────────────────────────────────
  // In the installed PWA the Android back gesture was leaving the page
  // (or exiting the app from the home screen) while a sheet was open —
  // the most jarring non-native behaviour in the app. Fix: opening a
  // sheet pushes a throwaway history entry at the SAME url, so back pops
  // that entry instead of navigating, and our popstate handler closes the
  // sheet. The ref tracks whether that entry is still ours to consume so
  // we never pop somebody else's page.
  const sheetHistoryRef = useRef(false);

  const openSheet = useCallback((which: 'shop' | 'more') => {
    if (!sheetHistoryRef.current) {
      try {
        // Spread the CURRENT state and keep the CURRENT url: the App
        // Router keeps its own bookkeeping in history.state, and pushing a
        // bare object would strand the new entry without it. Same url =
        // no navigation, just a stack entry for back to eat.
        window.history.pushState(
          { ...(window.history.state ?? {}), ggSheet: which },
          '',
          window.location.href,
        );
        sheetHistoryRef.current = true;
      } catch {
        // pushState can throw under exotic sandboxing — the sheet still
        // opens, it just won't intercept back.
      }
    }
    if (which === 'shop') setShopOpen(true);
    else setMoreOpen(true);
  }, []);

  // Dismiss (backdrop tap, Escape, swipe-down, handle tap). Consumes our
  // history entry so the stack is left exactly as we found it.
  const dismissSheet = useCallback(() => {
    setShopOpen(false);
    setMoreOpen(false);
    if (sheetHistoryRef.current) {
      sheetHistoryRef.current = false;
      window.history.back();
    }
  }, []);

  // Closing because the user is NAVIGATING away (a link inside the sheet).
  // Deliberately does NOT pop: the router is about to push its own entry
  // and racing history.back() against it cancels the navigation. The
  // leftover entry is same-url, so back from the destination still lands
  // the user on the page they came from.
  const closeSheetForNavigation = useCallback(() => {
    sheetHistoryRef.current = false;
    setShopOpen(false);
    setMoreOpen(false);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    const onPop = () => {
      // The browser already unwound our entry — just close. Calling
      // history.back() here would eat the user's real previous page.
      sheetHistoryRef.current = false;
      setShopOpen(false);
      setMoreOpen(false);
    };
    // Escape for the desktop/keyboard path (nav.tsx's drawer already has
    // this; the sheets never did despite aria-modal).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissSheet();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen, dismissSheet]);


  // Auto-close any open sheet on route change (mirrors the mobile-drawer
  // behaviour in nav.tsx). Drops the history claim WITHOUT popping — the
  // navigation itself is what closed the sheet, so there is nothing of
  // ours left to unwind (see closeSheetForNavigation).
  useEffect(() => {
    sheetHistoryRef.current = false;
    setShopOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Body-scroll lock while any sheet is open.
  useEffect(() => {
    if (shopOpen || moreOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [shopOpen, moreOpen]);

  // Active-count poll for the bell badge. Cheap COUNT query on the
  // server. Resilient: silently no-ops if the endpoint isn't deployed
  // yet (Drop 1 ships the UI before the backend; badge stays at 0
  // until the migration + controller land). Also refreshes when the
  // user navigates (covers the case where they just took an action).
  useEffect(() => {
    // ⚠️ WAS `!isStandalone || !isSignedIn`. The bar renders on mobile web
    // now, so gating the poll on standalone would have shipped a badge that is
    // always zero — visible, and permanently wrong — to every phone visitor.
    if (!isSignedIn) {
      setAlertsCount(0);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`${API_URL}/notifications/me/active-count`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return; // endpoint not deployed yet → silent no-op
        const data = (await r.json()) as { total?: number };
        if (!cancelled) {
          const n = data.total ?? 0;
          setAlertsCount(n);
          // Mirror onto the home-screen APP ICON (iOS 16.4+ installed PWAs
          // + desktop Chromium support the Badging API) — the native-app
          // cue users expect. Best-effort; unsupported platforms no-op.
          try {
            const nav = navigator as Navigator & {
              setAppBadge?: (c?: number) => Promise<void>;
              clearAppBadge?: () => Promise<void>;
            };
            if (n > 0) void nav.setAppBadge?.(n);
            else void nav.clearAppBadge?.();
          } catch {
            /* Badging API unsupported — ignore */
          }
        }
      } catch {
        // Network blip — keep last known count.
      }
    }
    poll();
    const t = setInterval(poll, 60_000);
    // Mobile OSes suspend timers while the PWA is backgrounded — without
    // these, a user reopening the installed app sees a STALE badge until
    // the next tick. Re-poll the moment the app becomes visible/focused.
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // Dismissing a notification elsewhere in the app must drop the badge NOW,
    // not up to 60s later — a badge still showing "3" after the user cleared
    // the last item reads as broken. notifications-list fires this event on
    // both the optimistic dismiss and its rollback, so the count re-syncs
    // either way. Repolling (rather than decrementing locally) keeps this the
    // single source of truth, and re-syncs the app-icon badge for free.
    const onAlertsChanged = () => void poll();
    window.addEventListener('gg:alerts-changed', onAlertsChanged);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('gg:alerts-changed', onAlertsChanged);
    };
  }, [isStandalone, isSignedIn, getToken, pathname]);

  // ⚠️ A ROUTE ALLOWLIST, NOT A DISPLAY-MODE CHECK. This used to read
  // `if (!isStandalone) return null`, which had two faults at once. It hid the
  // bar from every mobile-web visitor, so the phone's only navigation was the
  // hamburger drawer and the Shop/Account sheets did not exist for them at all.
  // And having no route awareness, it put a five-tab shopping bar across
  // /witness and /consent for installed users — the statutory statements that
  // lib/chromeless-routes.ts exists to keep marketplace chrome off — plus every
  // /admin page.
  //
  // The allowlist in lib/shell-routes.ts fixes both, and is wrong only in the
  // safe direction: a missing tab bar, never a shopping bar over a legal
  // notice. Visibility by width is CSS's job (.gg-shell-chrome), so the server
  // HTML stays identical at every viewport.
  if (!isTabRoute(pathname)) return null;

  // "Shop" tab is active on the shopping surfaces (i.e. anywhere the
  // picker would point to). /category/* is included now that the sheet
  // leads with the category grid — a user who tapped Shop → Camping would
  // otherwise land on a page where no tab is lit at all.
  const isShopSurface = pathname === '/' || pathname.startsWith('/category/');

  const tabs: Tab[] = [
    {
      // ⚠️ "Home", AND IT IS A LINK NOW, NOT A SHEET TRIGGER. This was "Shop",
      // and it opened a category-first bottom sheet. Every mobile board names
      // this tab Home and points it at the storefront, and the storefront
      // itself now carries the category rail the sheet existed to provide —
      // so the sheet was one tap of indirection in front of the same list.
      key: 'home',
      label: 'Home',
      href: '/',
      isActive: (p, sp) =>
        (p === '/' && !sp?.get('q')) || p.startsWith('/category/'),
    },
    {
      // ⚠️ THIS SLOT WAS "SAVED" (→ /wishlist). The design names it Search and
      // puts the wishlist heart in the header instead, where it sits beside the
      // cart on every root screen — so nothing was lost, it moved up.
      //
      // There is no /search route and there should not be one: the storefront
      // at "/" IS the search surface (it already takes q, listingType,
      // categoryId and sort, and /listings redirects to it). So this tab does
      // what the design's Search board actually shows — the storefront with its
      // search field focused. Routing to a new page that rendered the same
      // results would have duplicated the homepage's whole data path to no end.
      key: 'search',
      label: 'Search',
      href: '/',
      isActive: (_p, sp) => Boolean(sp?.get('q')),
      action: 'search',
    },
    {
      key: 'sell',
      label: 'Sell',
      href: '/listings/new',
      isActive: (p) => p.startsWith('/listings/new'),
      prominent: true,
    },
    {
      // ⚠️ THIS SLOT WAS "ALERTS" (→ /notifications) UNTIL THE THEME PACK.
      //
      // All ten mobile boards name this tab Orders, and none of them shows a
      // notifications surface anywhere — so a straight swap would have taken
      // the unread-alert badge, the one "you have unfinished business" signal
      // an installed member gets, and left it nowhere. It did not go: it moved
      // onto the Account tab below, which is where everything else about the
      // member's own business already lives. /notifications is still one tap
      // away inside that sheet.
      key: 'orders',
      label: 'Orders',
      href: '/my/orders',
      isActive: (p) => p.startsWith('/my/orders') || p.startsWith('/orders/'),
      // No `action` — this is a real Link, not a sheet.
    },
    {
      // ⚠️ "Account", NOT "More" — and a route, not a sheet. "More" is a name
      // for a place with no idea what is in it. The sheet it opened rendered
      // ACCOUNT_GROUPS from lib/account-menu-data; /account renders the same
      // ACCOUNT_GROUPS as a full page, which is what the design draws, so the
      // sheet was a smaller window onto identical content.
      key: 'account',
      label: 'Account',
      href: '/account',
      isActive: (p) => p.startsWith('/account'),
    },
  ];

  function renderIcon(key: string) {
    switch (key) {
      case 'home':
        return <IconHome />;
      case 'search':
        return <IconSearch />;
      case 'orders':
        return <IconBox />;
      case 'account':
        // The badge, NOT the bell, is the thing that had to survive the tab
        // rename: it only renders when alertsCount > 0, polls via active-count,
        // and only clears when the member ACTS on the underlying entity
        // (server-side auto-resolve) rather than merely opening the inbox.
        // It now rides on the Account glyph, since everything it points at
        // lives inside that sheet.
        return (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <IconUser />
            {alertsCount > 0 && (
              <span
                aria-label={`${alertsCount} unresolved`}
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--red)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  // Crisp ring around the badge so it pops off the
                  // dark tab-bar background.
                  border: '1.5px solid var(--bg-deep)',
                }}
              >
                {alertsCount > 9 ? '9+' : alertsCount}
              </span>
            )}
          </span>
        );
      case 'sell':
        return <IconPlus />;
      case 'wishlist':
        // Heart + saved count, caps at 50+ like the old top-bar button did.
        return (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <IconHeart />
            {wishlist.count > 0 && (
              <span
                aria-label={`${wishlist.count} saved`}
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--red)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  border: '1.5px solid var(--bg-deep)',
                }}
              >
                {wishlist.count > 50 ? '50+' : wishlist.count}
              </span>
            )}
          </span>
        );
      default:
        return null;
    }
  }

  return (
    <>
      <nav
        data-shell-tabs
        className="app-chrome gg-shell-chrome"
        aria-label="Primary"
        style={{
          // ⚠️ position / bottom / z-index LIVE IN CSS NOW, not here. The bar is
          // fixed over the document on mobile web but a plain flex sibling
          // inside the locked shell in the installed app, and only a stylesheet
          // can express "different in standalone" without a JS branch that
          // would make the server HTML depend on display mode. See
          // [data-shell-tabs] in app/globals.css. z-index stays 55, which is
          // the number the "anything floating must be z >= 60" house rule is
          // measured against — don't move it without updating that rule
          // everywhere it is written down.
          flexDirection: 'column',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border)',
          // Pad below the home indicator so the tappable row sits above it.
          // The design draws no device chrome at all, so this is ours.
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <ul
          style={{
            display: 'flex',
            // ⚠️ flex-start, not centre. The design pins each tab to the top of
            // the row and spaces it with its own padding-top — 9px for the four
            // icon tabs, 4px for the raised Sell button. Centring them instead
            // and the FAB no longer lines up with the icons beside it.
            alignItems: 'flex-start',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            height: 62,
          }}
        >
          {tabs.map((tab) => {
            const active = tab.isActive(pathname, searchParams);
            // Three greys, not two. Active is red; Sell's label is
            // --text-tertiary (#7A7267); every other inactive tab is one step
            // lighter again at --text-faint (#9C948A). The old code used
            // --text-primary for Sell, which made the one label under a red
            // button the darkest text in the row.
            const color = active
              ? 'var(--red)'
              : tab.prominent
                ? 'var(--text-tertiary)'
                : 'var(--text-faint)';

            const inner = (
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: tab.prominent ? 4 : 5,
                  paddingTop: tab.prominent ? 4 : 9,
                  color,
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  textDecoration: 'none',
                }}
              >
                {tab.prominent ? (
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      background: 'var(--red)',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      // ⚠️ NO marginTop: -8 AND NO boxShadow HERE ANY MORE. The
                      // design seats this button flush in the row rather than
                      // lifting it above the border, and the shadow that was
                      // supposed to sell the lift never rendered at all —
                      // `* { box-shadow: none !important }` is global in
                      // globals.css and has been for the whole rebuild. It was
                      // a declaration that read as an intent and did nothing.
                    }}
                    className="gg-tab-fab"
                  >
                    {renderIcon(tab.key)}
                  </span>
                ) : (
                  <span className="gg-tab-icon" style={{ display: 'inline-flex' }}>
                    {renderIcon(tab.key)}
                  </span>
                )}
                <span>{tab.label}</span>
              </span>
            );

            return (
              <li key={tab.key} style={{ flex: 1, height: '100%' }}>
                {tab.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (tab.action === 'search') {
                        // The storefront IS the search surface, so this focuses
                        // the field the shell header already renders rather
                        // than navigating to a second page that would run the
                        // same query. Route there first if we are elsewhere;
                        // the focus then lands after the header mounts.
                        if (pathname !== '/') router.push('/');
                        requestAnimationFrame(() => {
                          const input = document.querySelector<HTMLInputElement>(
                            '[data-shell-header] input',
                          );
                          input?.focus();
                        });
                      }
                    }}
                    aria-label={tab.label}
                    style={{
                      width: '100%',
                      height: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link
                    href={tab.href}
                    aria-label={tab.label}
                    style={{
                      display: 'block',
                      height: '100%',
                      textDecoration: 'none',
                    }}
                  >
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {shopOpen && (
        <ShopSheet
          pathname={pathname}
          searchParams={searchParams}
          onClose={dismissSheet}
          onNavigate={closeSheetForNavigation}
        />
      )}

      {moreOpen && (
        <MoreSheet
          isSignedIn={!!isSignedIn}
          username={user?.username ?? user?.firstName ?? null}
          email={user?.primaryEmailAddress?.emailAddress ?? null}
          imageUrl={user?.imageUrl ?? null}
          onClose={dismissSheet}
          onNavigate={closeSheetForNavigation}
          onSignOut={() => {
            void signOut(() => {
              // Release the sheet's history claim WITHOUT popping — after a
              // sign-out we can't be sure our throwaway entry is still on
              // top, and an unwanted history.back() would yank the user off
              // the page Clerk just landed them on.
              closeSheetForNavigation();
            });
          }}
        />
      )}
    </>
  );
}

// (SearchSheet removed — search now lives as the sticky MobileSearchBar
// at the top of every applicable page in standalone mode.)

// ─── Swipe-down-to-dismiss for the bottom sheets ───────────────────
// The drag-handle pill used to be pure decoration ("doesn't actually
// drag"), so the flick-down gesture every native sheet teaches did
// nothing. This follows the finger and dismisses past a threshold.
//
// Touch-only on purpose: the gesture is a phone idiom, and the pointer
// path already has the backdrop + Escape. Drag only starts when the
// sheet's own scroller is at the top — otherwise a downward swipe means
// "scroll this list", which is what the user expects mid-list.
const SHEET_DISMISS_PX = 90;

function useSwipeDown(onDismiss: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  // Once a drag has happened the entry animation must stay off: it also
  // animates transform, so re-enabling it on snap-back would replay the
  // whole slide-up. By drag time the entry animation is long finished, so
  // dropping it is invisible.
  const [dragged, setDragged] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if ((panelRef.current?.scrollTop ?? 0) > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? startY.current) - startY.current;
    if (dy > 0 && !dragged) setDragged(true);
    // Never track upward movement — the sheet is already at its rest
    // position, so a negative offset would tear it off the screen edge.
    setDragY(dy > 0 ? dy : 0);
  };
  const onTouchEnd = () => {
    if (startY.current === null) return;
    const travelled = dragY;
    startY.current = null;
    setDragY(0);
    if (travelled > SHEET_DISMISS_PX) onDismiss();
  };

  return {
    panelRef,
    // Spread onto the sheet panel.
    dragHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
    // Merge into the panel's inline style.
    dragStyle: {
      transform: dragY ? `translateY(${dragY}px)` : undefined,
      // No transition while the finger is down (the transform IS the
      // finger position); ease back on release.
      transition: dragY ? 'none' : 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      animation: dragged
        ? undefined
        : 'gg-sheet-up 240ms cubic-bezier(0.4, 0, 0.2, 1)',
      // Keep an over-drag from scroll-chaining into the page behind.
      overscrollBehavior: 'contain' as const,
    },
  };
}

// The grab-handle: a REAL button so it is keyboard-focusable and
// screen-reader announced, wrapping the pill that used to be an
// aria-hidden div. Tap-to-close is the discoverable fallback for anyone
// who doesn't try the swipe.
function SheetHandle({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 0',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'block',
          width: 44,
          height: 4,
          borderRadius: 2,
          background: 'var(--border-hover)',
          margin: '0 auto',
        }}
      />
    </button>
  );
}

// ─── Shop sheet — CATEGORY-first browse entry point ────────────────
// Two stacked sections:
//   1. Shop by category — the live top-level taxonomy with counts. This
//      is what a buyer actually wants: they came for a tent, a scope, a
//      rod. Until now the installed app (the flagship mobile experience)
//      had NO category browsing at all — the desktop nav got a
//      CategoryMenu flyout and this sheet was never touched.
//   2. Or browse by how it sells — the selling-mode surfaces, demoted.
//      A transaction-mode taxonomy only helps someone who already knows
//      how All Outdoor sells, so it stops being the first thing you see.
// Patterned after the App Store's "Today / Games / Apps / ..." selector.
function ShopSheet({
  pathname,
  searchParams,
  onClose,
  onNavigate,
}: {
  pathname: string;
  searchParams: URLSearchParams;
  // Dismiss (backdrop / handle / Escape / swipe) — unwinds the sheet's
  // history entry. onNavigate closes without touching history because the
  // router is about to push its own entry.
  onClose: () => void;
  onNavigate: () => void;
}) {
  const { panelRef, dragHandlers, dragStyle } = useSwipeDown(onClose);

  // Categories load LAZILY on first open — the sheet is only mounted while
  // it's open (`{shopOpen && <ShopSheet/>}`), so mount === the user just
  // tapped Shop. Nothing is fetched for users who never open it.
  const { viewerFetch, isSignedIn } = useViewerFetch();
  const shopKey: ShopViewerKey = isSignedIn ? 'member' : 'anon';
  const [cats, setCats] = useState<CategoryWithCount[]>(
    catCache[shopKey] ?? [],
  );
  const [catState, setCatState] = useState<'loading' | 'ready' | 'error'>(
    catCache[shopKey] ? 'ready' : 'loading',
  );

  useEffect(() => {
    const warm = catCache[shopKey];
    if (warm) {
      // Warm bucket — adopt it (also covers a sign-in/out swap).
      setCats(warm);
      setCatState('ready');
      return;
    }
    setCats([]);
    let alive = true;
    loadShopCategories(shopKey, viewerFetch).then(
      (list) => {
        if (!alive) return;
        setCats(list);
        setCatState('ready');
      },
      () => {
        // Degrade to modes-only rather than showing a dead retry card: the
        // sheet's whole job (get me somewhere) still works via the surface
        // list below, and loadShopCategories() already re-arms itself so the
        // next open silently tries again.
        if (alive) setCatState('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [shopKey, viewerFetch]);

  // Roots only — the sheet is a launcher, not the full tree (tapping through
  // to /category/[slug] shows the children). Curated sortOrder is preserved
  // so the sheet agrees with the nav flyout and homepage curtain, EXCEPT that
  // categories with no active stock sink to the bottom: an empty category at
  // the top of a browse sheet is a dead end occupying the best real estate.
  const roots = useMemo(
    () =>
      cats
        .filter((c) => c.parentId === null && c.isActive)
        .sort((a, b) => {
          const aEmpty = a.count === 0 ? 1 : 0;
          const bEmpty = b.count === 0 ? 1 : 0;
          if (aEmpty !== bEmpty) return aEmpty - bEmpty;
          return a.sortOrder - b.sortOrder;
        }),
    [cats],
  );

  // Skeletons while the first fetch is in flight; real tiles once we have
  // roots; nothing at all if the call failed or the taxonomy has no active
  // roots (modes-only degrade). Drives both the grid and the modes heading
  // below it, so the two can never disagree.
  const showCategories = catState === 'loading' || roots.length > 0;

  // Source of truth for the picker. Order = how prominent we want
  // each surface to be. Taglines mirror those in app/page.tsx
  // (SURFACE_TITLES) so the picker and the destination header speak
  // the same language.
  const surfaces: Array<{
    key: string;
    href: string;
    title: string;
    tagline: string;
    icon: React.ReactNode;
    isActive: boolean;
  }> = [
    {
      key: 'all',
      // Explicit sort=newest disables the curated Featured-landing on
      // page.tsx (showHero condition excludes when sort is set) so the
      // user lands on the actual all-listings grid sorted latest-first.
      // The grid mounts a SortToggle that lets them flip to price_asc.
      href: '/?sort=newest',
      title: 'All listings',
      tagline: 'Everything on sale right now, across every surface',
      icon: <IconList />,
      isActive:
        pathname === '/' &&
        !searchParams.get('listingType') &&
        !!searchParams.get('sort'),
    },
    {
      key: 'marketplace',
      href: '/?listingType=BUY_NOW',
      title: 'Buy Now',
      // Was "Used firearms and gear — …": gun-first copy on a general
      // outdoor surface (the sheet also fronts camping, fishing, optics).
      // Describe the MECHANIC, which is what distinguishes this surface
      // from Auctions / Take a Shot, and let the categories above say what
      // is for sale.
      tagline: 'Buy it now at the listed price — no bidding, no waiting',
      icon: <IconCart />,
      isActive:
        pathname === '/' && searchParams.get('listingType') === 'BUY_NOW',
    },
    {
      key: 'auctions',
      href: '/?listingType=AUCTION',
      title: 'Auctions',
      tagline: 'Timed bidding with proxy bids and snipe protection',
      icon: <IconGavel />,
      isActive:
        pathname === '/' && searchParams.get('listingType') === 'AUCTION',
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 56,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        {...dragHandlers}
        role="dialog"
        aria-label="Shop"
        aria-modal="true"
        style={{
          width: '100%',
          maxHeight: '85dvh',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          borderTop: '0.5px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingTop: 6,
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          ...dragStyle,
        }}
      >
        <SheetHandle onClose={onClose} />

        {/* ── 1. Shop by category ──────────────────────────────────
            Hidden entirely when the taxonomy call failed (catState
            'error') or came back with no active roots — a bare heading
            over empty space is worse than the modes-only sheet, which
            still gets the user somewhere. */}
        {showCategories && (
          <>
            <p
              style={{
                padding: '4px 20px 10px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                margin: 0,
              }}
            >
              Shop by category
            </p>
            <ul
              aria-label="Shop by category"
              aria-busy={catState === 'loading'}
              style={{
                listStyle: 'none',
                margin: 0,
                padding: '0 12px',
                // Two columns: the longest root names ("Reloading
                // Components", "Gun Smithing & Parts") still fit on a
                // 390px phone, and 14 roots stay a short scroll rather
                // than a 14-row wall.
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 6,
              }}
            >
              {catState === 'loading'
                ? /* Same-height placeholders so the sheet doesn't jump when
                     the real tiles land. Only ever seen on the very first
                     open — the module cache serves every open after that. */
                  Array.from({ length: 6 }).map((_, i) => (
                    <li
                      key={`cat-skel-${i}`}
                      aria-hidden
                      style={{
                        height: 58,
                        borderRadius: 10,
                        background: 'var(--bg-inset)',
                        border: '0.5px solid var(--border)',
                        opacity: 0.55,
                      }}
                    />
                  ))
                : roots.map((c) => {
                    const active = pathname === `/category/${c.slug}`;
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/category/${c.slug}`}
                          onClick={onNavigate}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            gap: 2,
                            // Fill the grid row so tiles in the same row
                            // stay equal height even when one hides its
                            // count.
                            height: '100%',
                            minHeight: 58,
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: active
                              ? 'rgba(200, 16, 46, 0.10)'
                              : 'var(--bg-inset)',
                            border: `0.5px solid ${
                              active
                                ? 'rgba(200, 16, 46, 0.40)'
                                : 'var(--border)'
                            }`,
                            color: 'var(--text-primary)',
                            textDecoration: 'none',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13.5,
                              fontWeight: 600,
                              lineHeight: 1.25,
                              color: active
                                ? 'var(--red)'
                                : 'var(--text-primary)',
                            }}
                          >
                            {c.name}
                          </span>
                          {/* Hide a 0 — "0 items" reads worse than no
                              number at all (same rule as the homepage
                              curtain tiles). */}
                          {c.count > 0 && (
                            <span
                              style={{
                                fontSize: 11.5,
                                color: 'var(--text-tertiary)',
                                lineHeight: 1.3,
                              }}
                            >
                              {c.count.toLocaleString('en-ZA')} item
                              {c.count !== 1 ? 's' : ''}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
            </ul>
          </>
        )}

        {/* ── 2. Selling modes, demoted ────────────────────────────
            Divider + heading (same idiom as the More sheet's Section)
            so the modes read as a secondary way in rather than the main
            event. When the category section is absent there is nothing
            to be "or" to, and a hairline directly under the grab handle
            just looks like a rendering fault — so fall back to the
            original standalone heading. */}
        <p
          style={{
            padding: showCategories ? '14px 20px 10px' : '4px 20px 12px',
            margin: showCategories ? '10px 0 0' : 0,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            borderTop: showCategories
              ? '0.5px solid var(--border-divider)'
              : undefined,
          }}
        >
          {showCategories ? 'Or browse by how it sells' : 'Choose a surface'}
        </p>

        <ul
          aria-label="Browse by how it sells"
          style={{ listStyle: 'none', margin: 0, padding: '0 12px' }}
        >
          {surfaces.map((s) => (
            <li key={s.key} style={{ marginBottom: 6 }}>
              <Link
                href={s.href}
                onClick={onNavigate}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: s.isActive
                    ? 'rgba(200, 16, 46, 0.10)'
                    : 'var(--bg-inset)',
                  border: `0.5px solid ${
                    s.isActive ? 'rgba(200, 16, 46, 0.40)' : 'var(--border)'
                  }`,
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: s.isActive
                      ? 'rgba(200, 16, 46, 0.20)'
                      : 'var(--bg-card)',
                    color: s.isActive
                      ? 'var(--red)'
                      : 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {s.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 15,
                      fontWeight: 600,
                      color: s.isActive
                        ? 'var(--red)'
                        : 'var(--text-primary)',
                      marginBottom: 2,
                    }}
                  >
                    {s.title}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {s.tagline}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* The gg-sheet-up keyframes used to live ONLY inside MoreSheet, so
          the Shop sheet's slide-up silently did nothing unless the More
          sheet happened to be mounted. Same rule, declared where it's
          used (duplicate @keyframes of identical content are harmless). */}
      <style>{`
        @keyframes gg-sheet-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Bottom-sheet drawer for secondary destinations ────────────────
//
// Top-to-bottom layout:
//   1. Drag-handle pill (visual cue)
//   2. Profile header card — avatar + username + tier → tap opens
//      /profile. For signed-out users this collapses to a Sign-in
//      pill instead.
//   3. My account section — Dashboard, Profile, all /my/* destinations.
//      Folded into the sheet because the "My" tab was replaced by
//      Wishlist; the My destinations still need a permanent home.
//   4. Shop section — Cart + Wishlist (fallbacks for the routes where the
//      top search bar that hosts them is hidden), then the secondary shop
//      surfaces (Take a Shot, Swop, Deals, Prize Draw).
//   5. Legal section — terms / privacy / refund / legal index.
//   6. Sign out (signed-in only) — destructive-styled button below.
//
// Visual notes:
//   - Trailing chevron on every nav row so they read as "tap to go".
//   - Sections separated by a thin border-top + the uppercase label.
//   - Tighter row text (14px) + more vertical padding (14px) for
//     thumb-friendly tapping without feeling sparse.
function MoreSheet({
  isSignedIn,
  username,
  email,
  imageUrl,
  onClose,
  onNavigate,
  onSignOut,
}: {
  isSignedIn: boolean;
  username: string | null;
  email: string | null;
  imageUrl: string | null;
  // onClose = dismiss (unwinds the sheet's history entry);
  // onNavigate = the router is taking over, leave history alone.
  onClose: () => void;
  onNavigate: () => void;
  onSignOut: () => void;
}) {
  const { panelRef, dragHandlers, dragStyle } = useSwipeDown(onClose);
  // UNITS, not lines — same rule as the nav's CartButton and TopCartButton.
  const cartItems = useCart();
  const cartCount = cartItems.reduce((sum, i) => sum + (i.quantity ?? 1), 0);
  // Secondary destinations — order = discoverability priority
  // (most-likely-used first).
  //
  // Cart and Wishlist are listed FIRST as fallbacks for the routes where the
  // top sticky search bar (which hosts the primary Cart + Wishlist buttons)
  // is hidden: /admin, /checkout, /sign-in, /sign-up, /listings/new,
  // /kyc/verify, /offline, /notifications, dealer-verification. On any of
  // those pages users still have one tap to either via this More-sheet entry.
  //
  // The cart carries its count here as well as on the button, because this
  // sheet is the ONLY cart affordance on those pages — a buyer who parked
  // three items and then went to check their notifications should still be
  // told the basket is waiting.
  const shopLinks = [
    {
      href: '/cart',
      label: 'Cart',
      badge: cartCount,
      badgeLabel: `${cartCount} item${cartCount === 1 ? '' : 's'}`,
    },
    { href: '/wishlist', label: 'Wishlist' },
  ];
  // Account destinations now come from the shared ACCOUNT_GROUPS (rendered via
  // <AccountMenuList/>) so this sheet stays in lockstep with the desktop
  // dropdown + mobile drawer.
  const pathname = usePathname();
  const legalLinks = [
    { href: '/terms', label: 'Terms of service' },
    { href: '/privacy', label: 'Privacy policy' },
    { href: '/refund-policy', label: 'Refund & disputes' },
    { href: '/legal', label: 'All legal documents' },
  ];

  const displayName = username ?? 'Member';
  // First letter for the avatar fallback. Prefer username, then email.
  const initial = (
    username?.charAt(0) ??
    email?.charAt(0) ??
    'M'
  ).toUpperCase();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 56,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        {...dragHandlers}
        role="dialog"
        aria-label="More"
        aria-modal="true"
        style={{
          width: '100%',
          maxHeight: '88dvh',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          borderTop: '0.5px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingTop: 6,
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
          ...dragStyle,
        }}
      >
        {/* Grab handle — now really does drag (swipe down to dismiss) and
            closes on tap/Enter for anyone who doesn't try the gesture. */}
        <SheetHandle onClose={onClose} />
        <div style={{ height: 4 }} />

        {/* Profile header. Signed-in users see avatar + username + an
            "Account overview" chevron — tapping the whole card opens the
            /account hub (the flat grouped list still lives below, so the
            hub is additive). Signed-out users see a single Sign in pill.
            Sits flush at the top of the sheet to give the bottom-
            sheet a clear "this is YOUR drawer" anchor. */}
        {isSignedIn ? (
          <Link
            href="/account"
            onClick={onNavigate}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '0 12px 8px',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
            }}
          >
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={displayName}
                width={44}
                height={44}
                sizes="44px"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
                unoptimized
              />
            ) : (
              /* Initial-circle fallback when Clerk doesn't return an
                 imageUrl (rare but possible for non-OAuth sign-ups). */
              <span
                aria-hidden
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(200,16,46,0.18)',
                  color: 'var(--red)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {initial}
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {displayName}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                }}
              >
                Account overview
              </span>
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              <IconChevronRight />
            </span>
          </Link>
        ) : (
          <div style={{ padding: '0 12px 8px' }}>
            <SignInButton mode="modal">
              <button
                type="button"
                className="app-chrome"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sign in or sign up
              </button>
            </SignInButton>
          </div>
        )}

        {isSignedIn && (
          <div style={{ marginTop: 8 }}>
            {/* Grouped account list (Buying / Selling / Account)
                from the shared source of truth — same on every surface. */}
            <AccountMenuList
              pathname={pathname}
              onNavigate={onNavigate}
              showChevron
            />
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                borderTop: '0.5px solid var(--border-divider)',
              }}
            >
              {/* Push toggle — self-hides when push isn't supported /
                  backend isn't configured / iOS-in-browser. */}
              <PushToggleRow />
              <li>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="app-chrome"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '14px 20px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--red)',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </li>
            </ul>
          </div>
        )}

        <Section title="Shop">
          {shopLinks.map((l) => (
            <SheetLink
              key={l.href}
              href={l.href}
              label={l.label}
              badge={l.badge}
              badgeLabel={l.badgeLabel}
              onNavigate={onNavigate}
            />
          ))}
        </Section>

        <Section title="Legal">
          {legalLinks.map((l) => (
            <SheetLink
              key={l.href}
              href={l.href}
              label={l.label}
              onNavigate={onNavigate}
            />
          ))}
        </Section>
      </div>

      <style>{`
        @keyframes gg-sheet-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      {/* Section header sits on top of a thin divider line so the
          sheet reads as grouped sections rather than one wall of
          links. */}
      <p
        style={{
          padding: '14px 20px 6px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          margin: 0,
          borderTop: '0.5px solid var(--border-divider)',
        }}
      >
        {title}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </div>
  );
}

function SheetLink({
  href,
  label,
  badge,
  badgeLabel,
  onNavigate,
}: {
  href: string;
  label: string;
  /** Optional count pill before the chevron. Hidden at 0/undefined. */
  badge?: number;
  /** How the count should be SPOKEN, e.g. "3 items". Falls back to the bare
   *  number, which reads as "Cart, 3" — understandable but not English. */
  badgeLabel?: string;
  onNavigate?: () => void;
}) {
  return (
    <li>
      {/* Trailing chevron + tighter row text — reads as iOS Settings
          row rather than inert link text. */}
      <Link
        href={href}
        onClick={onNavigate}
        // The count belongs in the accessible name, not just the pill —
        // otherwise a screen-reader user hears "Cart" and learns nothing
        // about the two items sitting in it.
        aria-label={badge ? `${label}, ${badgeLabel ?? badge}` : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '13px 20px',
          color: 'var(--text-primary)',
          fontSize: 14,
          textDecoration: 'none',
        }}
      >
        <span>{label}</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-tertiary)',
          }}
        >
          {!!badge && badge > 0 && (
            <span
              aria-hidden
              style={{
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: 'var(--red)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              {badge > 50 ? '50+' : badge}
            </span>
          )}
          <IconChevronRight />
        </span>
      </Link>
    </li>
  );
}
