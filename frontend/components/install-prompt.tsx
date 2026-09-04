'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { InstallAnimation } from './install-animation';
import { installPlatform, useInstallPrompt } from '@/lib/use-install-prompt';
import { useWishlist } from '@/lib/use-wishlist';
import { BRAND_NAME } from '@/lib/brand';
import { isChromelessRoute } from '@/lib/chromeless-routes';
import { isTabRoute } from '@/lib/shell-routes';
import {
  trackInstall,
  type InstallPlatform,
  type InstallSurface,
} from '@/lib/activity-beacon';

// "Get the All Outdoor app" install popup + the shared install-help modal.
//
// Install state (native event capture, installed-detection, iOS) lives in
// useInstallPrompt() so the nav drawer's manual "Install app" button shares it.
// This component owns the proactive install popup and the instruction modal.
//
// We DON'T auto-fire the native prompt:
//   1. Chrome's engagement heuristic will reject .prompt() right after landing.
//   2. A surprise dialog interrupts whatever the user came to do.
//   3. The event is single-use; once consumed it won't re-fire this session.
//
// The popup is a proper, dismissible reminder card (app icon + benefits +
// Install button) shown to an ENGAGED visitor on the WEBSITE (never in the
// installed app, never on focused/checkout/admin flows). It offers three
// exits:
//   • ✕ / "Maybe later" / backdrop  → hide for 14 days (gentle re-remind).
//   • "Don't show this again"       → PERMANENT opt-out (localStorage).
//
// The instruction modal is also opened on demand from the nav via the
// `gg:show-install-help` window event — for when Chrome hasn't fired
// beforeinstallprompt yet (the only install path then is the browser's own
// ⋮ menu, which we can only explain, not trigger) or on iOS Safari.
//
// ─── WHY THE ENGAGEMENT GATE EXISTS — please don't "fix" it back ───
//
// This popup used to fire on a bare timer, so a first-time visitor got a modal
// over the page 3.5 seconds after landing, before they had seen a single
// product. That is the textbook intrusive interstitial: Google demotes pages
// that cover the content a searcher just arrived for, and a stranger asked to
// install an app for a store they haven't evaluated simply leaves. Asking is
// only reasonable once someone has shown they want to be here.
//
// So the popup now needs an engagement signal as well as the delay — EITHER a
// return visit (`gg-install-prompt-sessions` >= 2) OR real intent shown in this
// session: opening a listing, running a search, adding to the cart or saving to
// the wishlist. The landing view itself never counts (see the intent effect) —
// a listing link shared on WhatsApp drops people straight onto a detail page,
// and that arrival is precisely the moment we must not interrupt.
//
// The nav's manual "Install app" button is untouched and bypasses all of this:
// a person asking to install is the opposite problem.

const DISMISSED_KEY = 'gg-install-prompt-dismissed-until';
const NEVER_KEY = 'gg-install-prompt-never';
// Engagement gate. Sessions + last-seen live in localStorage (they must survive
// the tab closing); the counted-flag is per-tab sessionStorage so a reload
// can't inflate the count.
const SESSIONS_KEY = 'gg-install-prompt-sessions';
const LAST_SEEN_KEY = 'gg-install-prompt-last-seen';
const SESSION_COUNTED_KEY = 'gg-install-prompt-session-counted';
const DISMISS_DAYS = 14;
// Snooze after somebody OPENS the instruction modal and closes it without
// installing. Deliberately shorter than a refusal: they went looking for the
// steps, so they are interested — they just did not finish. Fourteen days is
// the right answer to "no"; it is the wrong answer to "not right this second".
const HELP_SNOOZE_DAYS = 3;
// Delay before the passive bottom bar appears. Much shorter than the popup's,
// because the bar does not cover anything — it is a strip above the bottom
// edge, so it costs the reader nothing to have it slide in early.
const BAR_DELAY_MS = 1200;
// Delay before the popup appears so it never slams in on first paint.
const SHOW_DELAY_MS = 3500;
// Gap after which a fresh page load counts as a NEW visit rather than a
// continuation. 30 minutes is the standard analytics session window.
const SESSION_GAP_MS = 30 * 60 * 1000;
// Visits needed before a landing view alone can trigger the popup.
const MIN_SESSIONS = 2;
// Breathing room between an intent signal and the popup, so we never land on
// top of the thing the visitor just did. The cart wait is longer because
// adding to the cart opens the added-to-cart drawer (see AddedToCartDrawer),
// and stacking our modal on that is worse than the original ambush.
const INTENT_DELAY_MS = 6000;
const CART_INTENT_DELAY_MS = 12000;

// Listing detail = /listings/<id>. `/listings/new` is the seller's create form,
// not a shopping signal — and interrupting a half-filled listing is unkind.
function isListingDetail(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/listings\/[^/]+$/.test(pathname) && pathname !== '/listings/new';
}

// Routes where an install popup would interrupt a focused task — never show
// there (matches the Ask Boet suppression spirit).
const SUPPRESS_PREFIXES = [
  '/checkout',
  '/admin',
  '/kyc',
  '/sign-in',
  '/sign-up',
  '/sso-callback',
  '/a/',
];
function isSuppressedRoute(pathname: string | null): boolean {
  // Never pitch the app to somebody who came here once, from an SMS, to
  // sign a document and leave.
  if (isChromelessRoute(pathname)) return true;
  if (!pathname) return false;
  return SUPPRESS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p),
  );
}

// The "did they run a search" signal reads useSearchParams(), which opts its
// subtree out of static rendering. Keeping the boundary here means only this
// popup goes dynamic instead of every page in the root layout — the same
// self-wrapping trick PageViewTracker uses.
export function InstallPrompt() {
  return (
    <Suspense fallback={null}>
      <InstallPromptBody />
    </Suspense>
  );
}

function InstallPromptBody() {
  const { canInstall, isInstalled, isIosSafari, isIosNonSafari, promptInstall } =
    useInstallPrompt();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Saving a listing is an intent signal; the hook is the only place that knows
  // a heart was tapped (there's no window event for it).
  const {
    ready: wishlistReady,
    count: wishlistCount,
    isSignedIn: wishlistSignedIn,
  } = useWishlist();
  const [dismissed, setDismissed] = useState(true); // assume dismissed until effect checks
  const [never, setNeverState] = useState(true); // assume opted-out until effect checks
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fallback nudge for phones where the one-tap install is never offered
  // (non-Chrome browsers, bottom-tier Android Go devices, etc.). We arm it
  // after a short delay so capable phones get the real "Install" button once
  // Chrome fires its event — only phones that never fire it fall through to the
  // "Add to home screen" shortcut hint.
  const [isMobile, setIsMobile] = useState(false);
  const [fallbackArmed, setFallbackArmed] = useState(false);
  // Desktop Chrome/Edge (Chromium) can install a PWA, but Chrome often won't
  // fire beforeinstallprompt on a passive visit — so, like mobile, desktop needs
  // a fallback that still offers install guidance when the native event stays
  // silent. Firefox/Safari desktop can't install PWAs, so they're excluded.
  const [isChromiumDesktop, setIsChromiumDesktop] = useState(false);
  const [desktopArmed, setDesktopArmed] = useState(false);
  // Delay-gate so the popup never appears on first paint.
  const [readyToShow, setReadyToShow] = useState(false);
  // Same, for the passive bottom bar — see BAR_DELAY_MS.
  const [barReady, setBarReady] = useState(false);
  // Engagement gate (see the header comment). `returning` is decided once at
  // mount; `engaged` flips when an intent signal's grace period elapses.
  const [returning, setReturning] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arm the popup off an intent signal. First signal wins — a visitor who
  // saves three listings shouldn't keep pushing the popup further away.
  const armIntent = useCallback((delayMs: number) => {
    if (intentTimer.current) return;
    intentTimer.current = setTimeout(() => setEngaged(true), delayMs);
  }, []);
  useEffect(
    () => () => {
      if (intentTimer.current) clearTimeout(intentTimer.current);
    },
    [],
  );

  useEffect(() => {
    setDismissed(isDismissedRecently());
    setNeverState(isNever());
    setReturning(noteSession() >= MIN_SESSIONS);
    const ua = navigator.userAgent;
    const mobile = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
    setIsMobile(mobile);
    // Chromium desktop = has "Chrome/" in the UA and isn't mobile. Captures
    // Chrome, Edge, Opera, Brave (all install PWAs); excludes Firefox/Safari
    // desktop (UA has no "Chrome/") so we never nag browsers that can't install.
    const chromiumDesktop = !mobile && /Chrome\//.test(ua);
    setIsChromiumDesktop(chromiumDesktop);
    const showTimer = setTimeout(() => setReadyToShow(true), SHOW_DELAY_MS);
    const barTimer = setTimeout(() => setBarReady(true), BAR_DELAY_MS);
    let fbTimer: ReturnType<typeof setTimeout> | undefined;
    if (mobile) fbTimer = setTimeout(() => setFallbackArmed(true), 5000);
    let dtTimer: ReturnType<typeof setTimeout> | undefined;
    // Give Chrome a few seconds to fire the native event (preferred one-click
    // path) before falling back to instruction-led install on desktop.
    if (chromiumDesktop) dtTimer = setTimeout(() => setDesktopArmed(true), 5000);
    // The nav's "Install app" button (and any other surface) can ask us to
    // pop the instruction modal — e.g. iOS, or Android before Chrome has fired
    // the install event. This works even after "Don't show again".
    function onShowHelp() {
      setHelpOpen(true);
    }
    window.addEventListener('gg:show-install-help', onShowHelp);
    return () => {
      window.removeEventListener('gg:show-install-help', onShowHelp);
      clearTimeout(showTimer);
      clearTimeout(barTimer);
      if (fbTimer) clearTimeout(fbTimer);
      if (dtTimer) clearTimeout(dtTimer);
    };
  }, []);

  // ─── Intent signals ─────────────────────────────────────────────
  //
  // Navigation. We watch the query string as well as the path because search
  // results are a query-only variant of "/" (/?q=…), so a pathname-only effect
  // never fires for them.
  // Remembering the landing VIEW rather than a "seen one" boolean also makes
  // this idempotent, so StrictMode's double-invoke in dev can't mistake the
  // landing page for a navigation and fire the popup we're trying to prevent.
  //
  // We store the arrival as its PARTS (path, q) rather than one joined string,
  // because the query string gets rewritten underneath us: WelcomeBanner strips
  // the `?c=` marketing key with history.replaceState, and Next re-renders
  // useSearchParams() when it does. A joined string would read that rewrite as
  // a navigation, so someone arriving from a marketing SMS on
  // /listings/<id>?c=KEY — a first-time visitor, on the page we least want to
  // cover — would get the popup ~6s after landing. Comparing the parts means a
  // query-only rewrite leaves both unchanged and cannot arm.
  const landing = useRef<{ path: string; q: string } | null>(null);
  useEffect(() => {
    // Refresh last-seen on every move so a long browse in one tab doesn't age
    // past SESSION_GAP_MS and let a second tab count as another visit.
    touchLastSeen();
    const path = pathname ?? '';
    const q = searchParams?.get('q') ?? '';
    // The first view of a mount is where the visitor ARRIVED. Landing on a
    // listing (shared link, Google result) is not intent — it's the page we
    // must not cover. Only what they navigate to afterwards counts.
    if (landing.current === null) {
      landing.current = { path, q };
      return;
    }
    const openedListing = isListingDetail(pathname) && path !== landing.current.path;
    const ranSearch = q !== '' && q !== landing.current.q;
    // ⚠️ ON iOS, ANY NAVIGATION COUNTS — not just a listing or a search.
    //
    // The engagement gate above was written for Android, where a visitor who
    // never earns the popup still has a way in: Chrome's own ⋮ → "Install
    // app". iOS has NOTHING. Apple ships no install affordance of any kind,
    // `beforeinstallprompt` never fires, and this popup is the only channel
    // that will ever tell an iPhone visitor the app exists. Holding it behind
    // "open a listing or run a search" on a catalogue that is thin for
    // signed-out visitors means most iPhone users are simply never told.
    //
    // The landing-view protection is untouched and is the part that matters:
    // `landing.current` is set on the first view and we return above, so a
    // listing link shared on WhatsApp still cannot be covered. This only says
    // that on iPhone the SECOND page view is enough, and it still goes through
    // armIntent's grace period rather than appearing the instant they arrive.
    const iosNavigated =
      (isIosSafari || isIosNonSafari) && path !== landing.current.path;
    if (openedListing || ranSearch || iosNavigated) armIntent(INTENT_DELAY_MS);
  }, [pathname, searchParams, armIntent, isIosSafari, isIosNonSafari]);

  // Add to cart — the strongest signal there is, and the only one with its own
  // window event (dispatched by AddToCartButton on a genuine add).
  useEffect(() => {
    function onAddedToCart() {
      armIntent(CART_INTENT_DELAY_MS);
    }
    window.addEventListener('gg:added-to-cart', onAddedToCart);
    return () => window.removeEventListener('gg:added-to-cart', onAddedToCart);
  }, [armIntent]);

  // Wishlist. The count jumps 0 → N when the provider hydrates the user's
  // EXISTING saves, so the first reading after `ready` is only a baseline —
  // an increase after that is a heart tapped now.
  //
  // Re-baseline whenever the identity changes. WishlistProvider reports
  // `ready` immediately for a signed-out visitor with a count of 0 and never
  // resets it, so a mid-session sign-in hydrates 0 → N against a live baseline
  // and would read as a save made just now.
  const savedBaseline = useRef<number | null>(null);
  const baselineIdentity = useRef<boolean | null>(null);
  useEffect(() => {
    if (!wishlistReady) return;
    if (baselineIdentity.current !== wishlistSignedIn) {
      baselineIdentity.current = wishlistSignedIn;
      savedBaseline.current = wishlistCount;
      return;
    }
    const previous = savedBaseline.current;
    savedBaseline.current = wishlistCount;
    if (previous !== null && wishlistCount > previous) armIntent(INTENT_DELAY_MS);
  }, [wishlistReady, wishlistCount, wishlistSignedIn, armIntent]);

  // Shared with the nav and footer buttons — see installPlatform().
  const platform: InstallPlatform = installPlatform({
    isIosSafari,
    isIosNonSafari,
  });

  async function install(surface: InstallSurface = 'popup') {
    trackInstall('clicked', platform, surface);
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'accepted') trackInstall('completed', platform, surface);
      if (outcome === 'dismissed') {
        trackInstall('dismissed', platform, surface);
        // ⚠️ BOTH HALVES. dismissFor() only writes localStorage, which is read
        // at mount — so without setDismissed the popup or bar stays on screen
        // for the rest of the page view, now relabelled "Get it" and offering
        // the instruction modal for the install the user has just refused in
        // Chrome's own dialog. dismissLater() below always did the pair; this
        // branch did not, and the bar made it reachable from a second surface.
        setDismissed(true);
        dismissFor(DISMISS_DAYS);
      }
      // If the native event wasn't ready, fall back to the steps modal.
      if (outcome === 'unavailable') setHelpOpen(true);
    } finally {
      setBusy(false);
    }
  }

  // ✕ / "Maybe later" / backdrop — hide for 14 days (gentle re-remind).
  // Also the bar's ✕: one refusal silences both surfaces, so nobody is asked
  // twice by two different pieces of chrome.
  function dismissLater(surface: InstallSurface = 'popup') {
    trackInstall('dismissed', platform, surface);
    setDismissed(true);
    dismissFor(DISMISS_DAYS);
  }
  // "Don't show this again" — permanent opt-out.
  function dismissForever() {
    trackInstall('dismissed', platform, 'popup');
    setNeverState(true);
    setNever();
  }
  // ⚠️ OPENING THE STEPS IS NOT A REFUSAL — DO NOT DISMISS HERE.
  //
  // This used to call dismissLater(), and on iPhone that was close to fatal:
  // `canInstall` can never be true on iOS (its only source is
  // beforeinstallprompt, which no iOS browser fires), so the popup's primary
  // button is ALWAYS this function there. One tap on "Show me how" — the
  // button we want them to press — silenced the popup for fourteen days, and
  // since iOS never fires `appinstalled` either, nothing could ever tell us
  // whether they went on to install or just closed the sheet.
  //
  // The snooze now lives on the modal's own close handler instead, at three
  // days rather than fourteen, so it is spent by giving up rather than by
  // showing interest.
  function openHelp(surface: InstallSurface = 'popup') {
    trackInstall('clicked', platform, surface);
    setHelpOpen(true);
  }
  // Closing the steps without installing. Short snooze, so somebody who read
  // them and wandered off is reminded again this month rather than next.
  function closeHelp() {
    setHelpOpen(false);
    dismissFor(HELP_SNOOZE_DAYS);
    setDismissed(true);
  }

  // Once armed, if the one-tap install still isn't available and it's neither
  // iOS-Safari nor iOS-non-Safari (both have their own path), show the generic
  // "Add to home screen" shortcut nudge (low-end / non-Chrome Android).
  const showFallbackHint =
    fallbackArmed &&
    isMobile &&
    !canInstall &&
    !isIosSafari &&
    !isIosNonSafari &&
    !isInstalled;

  // Desktop Chrome/Edge fallback: once armed, if the one-tap install still
  // isn't offered and the app isn't installed, show the popup anyway with a
  // "How to install" path (address-bar install icon / browser menu). Upgrades
  // to the native one-click button automatically if the event fires later.
  const showDesktopHint =
    desktopArmed && isChromiumDesktop && !canInstall && !isInstalled;

  // The popup shows when there's an actionable install path, the visitor has
  // earned it (return visit or intent shown this session), the user hasn't
  // dismissed / permanently opted out / already installed, we're not on a
  // focused route, and the initial delay has elapsed.
  const showPopup =
    readyToShow &&
    (returning || engaged) &&
    !isInstalled &&
    !dismissed &&
    !never &&
    !helpOpen &&
    !isSuppressedRoute(pathname) &&
    (canInstall ||
      isIosSafari ||
      isIosNonSafari ||
      showFallbackHint ||
      showDesktopHint);

  // ── THE PASSIVE BAR ─────────────────────────────────────────────
  //
  // A slim strip above the bottom edge, on mobile web only. It exists because
  // the popup — correctly — makes people earn it, and on iPhone that left a
  // real hole: no engagement, no popup, and Apple provides no install
  // affordance of its own, so the app may as well not exist. The site's only
  // other mentions are the footer (below the fold) and the nav drawer (behind
  // a closed hamburger, itself behind Clerk's isLoaded gate).
  //
  // It is deliberately NOT an interstitial: it covers no content, takes no
  // focus, and has no backdrop, so it is not the pattern Google demotes and
  // not the ambush the popup's header comment warns about. That is what lets
  // it skip the engagement gate the popup keeps.
  //
  // ⚠️ ONE REFUSAL SILENCES BOTH. The ✕ writes the same 14-day DISMISSED_KEY
  // the popup reads, and the bar reads it back — otherwise a visitor who
  // waved away the bar would be asked again by a modal ten seconds later.
  //
  // ⚠️ NOT ON LISTING DETAIL. That page has its own bottom buy bar at
  // bottom:0 in browser mode (app/listings/[id]/page.tsx), and covering a Buy
  // button to advertise an app is indefensible. This is a render gate rather
  // than a CSS one on purpose: the Boet lift below keys on `:has(
  // [data-install-bar])`, and `:has()` still matches a display:none element.
  const showBar =
    barReady &&
    isMobile &&
    !isInstalled &&
    !dismissed &&
    !never &&
    !helpOpen &&
    !showPopup &&
    !isSuppressedRoute(pathname) &&
    !isListingDetail(pathname);

  // The tab bar now renders on mobile web too, on the shopping routes
  // isTabRoute() names (lib/shell-routes) — it is no longer standalone-only.
  // The bar's own bottom-offset uses this to lift clear of it; see there.
  const tabBarPresent = isTabRoute(pathname);

  // Ask Boet Everywhere — keep the body attribute stamped while our popup is up
  // so the Sparkie daily-hello suppresses (it checks data-install-prompt) and
  // the launcher lift rules stay coherent. Harmless behind our backdrop.
  useEffect(() => {
    if (showPopup) {
      document.body.setAttribute('data-install-prompt', 'true');
    } else {
      document.body.removeAttribute('data-install-prompt');
    }
    return () => document.body.removeAttribute('data-install-prompt');
  }, [showPopup]);

  // One `install_shown` per appearance, not per render. The ref rather than a
  // state flag because this must not itself cause a re-render, and it must not
  // reset when the popup is replaced by the help modal and comes back.
  const shownLogged = useRef(false);
  useEffect(() => {
    if (!showPopup || shownLogged.current) return;
    shownLogged.current = true;
    trackInstall('shown', platform, 'popup');
  }, [showPopup, platform]);

  const barShownLogged = useRef(false);
  useEffect(() => {
    if (!showBar || barShownLogged.current) return;
    barShownLogged.current = true;
    trackInstall('shown', platform, 'bar');
  }, [showBar, platform]);

  // Primary-button copy adapts to the path.
  const primaryLabel = canInstall
    ? busy
      ? 'Opening…'
      : 'Install app'
    : isIosNonSafari
      ? 'Open in Safari'
      : isIosSafari
        ? 'Show me how'
        : isChromiumDesktop
          ? 'How to install'
          : 'Add to home screen';
  const subtitle = isIosNonSafari
    ? 'iPhone apps install through Safari — we’ll show you how.'
    : isChromiumDesktop && !isMobile
      ? 'Install it as an app — faster, fullscreen, one click from your desktop. Free, no store needed.'
      : 'Add it to your home screen for the full experience — free, no store needed.';

  // Shorter than the popup's subtitle — one line, and it must survive being
  // truncated on a 320px phone, so the important word comes first.
  const barSubtitle = isIosNonSafari
    ? 'Installs from Safari \u2014 tap to see how'
    : isIosSafari
      ? 'Two taps to your home screen \u2014 free'
      : 'Free \u2014 no app store needed';

  if (!showPopup && !helpOpen && !showBar) return null;

  return (
    <>
      {showPopup && (
        <div
          onClick={() => dismissLater('popup')}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.62)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            overflowY: 'auto',
            animation: 'gg-install-fade 0.2s ease-out',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Get the All Outdoor app"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 380,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 16,
              boxShadow:
                '0 24px 60px rgba(0,0,0,0.55), 0 0 22px rgba(200,16,46,0.22)',
              padding: '24px 22px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              alignItems: 'center',
              textAlign: 'center',
              animation: 'gg-install-pop 0.24s cubic-bezier(0.2,0.8,0.3,1)',
            }}
          >
            <button
              type="button"
              onClick={() => dismissLater('popup')}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                width: 28,
                height: 28,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                fontSize: 19,
                lineHeight: 1,
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              ×
            </button>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-192.png"
              alt="All Outdoor"
              width={56}
              height={56}
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                boxShadow:
                  '0 4px 14px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            />

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
            >
              <p
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: '-0.2px',
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                Get the {BRAND_NAME} app
              </p>
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                  margin: 0,
                }}
              >
                {subtitle}
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
                width: '100%',
                margin: '2px 0 0',
              }}
            >
              {[
                'One-tap launch from your home screen',
                'Faster & fullscreen — no browser bars',
                'Never miss an auction, offer or sale',
              ].map((b) => (
                <div
                  key={b}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    textAlign: 'left',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flex: '0 0 auto',
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'rgba(200,16,46,0.14)',
                      color: 'var(--red)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    ✓
                  </span>
                  {b}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => (canInstall ? install('popup') : openHelp('popup'))}
              disabled={busy}
              style={{
                width: '100%',
                background: 'var(--red)',
                color: '#fff',
                border: 'none',
                padding: '12px 14px',
                borderRadius: 10,
                fontSize: 14.5,
                fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {primaryLabel}
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                marginTop: 2,
              }}
            >
              <button
                type="button"
                onClick={() => dismissLater('popup')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  padding: '6px 2px',
                }}
              >
                Maybe later
              </button>
              <button
                type="button"
                onClick={dismissForever}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                  padding: '6px 2px',
                }}
              >
                Don&rsquo;t show this again
              </button>
            </div>
          </div>
          <style>{`
            @keyframes gg-install-fade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes gg-install-pop {
              from { opacity: 0; transform: translateY(10px) scale(0.98); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @media (prefers-reduced-motion: reduce) {
              [aria-label="Get the All Outdoor app"] { animation: none !important; }
            }
          `}</style>
        </div>
      )}

      {showBar && (
        <div
          data-install-bar="true"
          role="region"
          aria-label={`Get the ${BRAND_NAME} app`}
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            // Flush against the viewport edge on its own. When isTabRoute()
            // also puts the tab bar on this route, lift clear of it instead —
            // the tab bar occupies its own height plus its own safe-area
            // padding (see [data-shell-tabs] in globals.css), so that's what
            // this bar's floor becomes.
            // ⚠️ THE SAME min() CLAMP THE TAB BAR ITSELF USES. [data-shell-tabs]
            // pads with min(env(safe-area-inset-bottom), 34px) because Chrome
            // for iOS can report an inflated inset; reading the RAW inset here
            // would lift this bar past the top of the bar it is sitting on and
            // open a strip of page between them.
            bottom: tabBarPresent
              ? 'calc(var(--shell-tab-h) + min(env(safe-area-inset-bottom), 34px))'
              : 0,
            // Under Boet (z-60) and under the tab bar (z-55), both of which
            // outrank it by the house rule. Boet is lifted clear of this bar
            // by a rule in globals.css keyed on [data-install-bar]; the tab
            // bar is handled above instead of by a z-index assumption, now
            // that it renders on mobile web too and the two can share a
            // route.
            zIndex: 54,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            // ⚠️ THE INSET IS PAID FOR ONCE, NOT TWICE. `bottom` above already
            // lifts this bar clear of the home indicator whenever the tab bar
            // is present; adding the inset again here padded a second copy of
            // it INSIDE the bar, so on a notched iPhone the bar grew by ~34px
            // of empty --bg-deep under its own text. Only pad when the bar is
            // actually flush with the bottom edge and nothing else has paid.
            paddingBottom: tabBarPresent
              ? 9
              : 'calc(9px + min(env(safe-area-inset-bottom), 34px))',
            background: 'var(--bg-deep)',
            // The hairline is the whole separation. A box-shadow here would be
            // dead code: globals.css opens with `* { box-shadow: none
            // !important }` ("no gradients, no drop shadows, no glow", per
            // CLAUDE.md), which has already turned several shadows elsewhere
            // in this app into decoration nobody has ever seen.
            borderTop: '0.5px solid var(--border)',
            animation: 'gg-install-bar-up 0.28s cubic-bezier(0.2,0.8,0.3,1)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt=""
            width={34}
            height={34}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              flex: '0 0 auto',
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* ⚠️ ONE LINE, ALWAYS. The Boet lift (74px) and the body
                reservation (62px) in globals.css are both hard-coded against
                this bar's height, so a title that wraps on a narrow phone
                would push the bar taller than the space reserved for it and
                put the footer back under it. Truncating is the lesser
                failure, and the subtitle below already does the same. */}
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.1px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Get the {BRAND_NAME} app
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {barSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (canInstall ? install('bar') : openHelp('bar'))}
            disabled={busy}
            style={{
              flex: '0 0 auto',
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '9px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {canInstall ? 'Install' : 'Get it'}
          </button>
          <button
            type="button"
            onClick={() => dismissLater('bar')}
            aria-label="Not now"
            style={{
              flex: '0 0 auto',
              width: 30,
              height: 30,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              fontSize: 19,
              lineHeight: 1,
              cursor: 'pointer',
              borderRadius: 8,
            }}
          >
            ×
          </button>
          <style>{`
            @keyframes gg-install-bar-up {
              from { transform: translateY(100%); }
              to   { transform: translateY(0); }
            }
            @media (prefers-reduced-motion: reduce) {
              [data-install-bar] { animation: none !important; }
            }
          `}</style>
        </div>
      )}

      {helpOpen && (
        <InstallHelpModal
          isIos={isIosSafari}
          isIosNonSafari={isIosNonSafari}
          isDesktop={isChromiumDesktop && !isMobile}
          canInstall={canInstall}
          onInstall={async () => {
            trackInstall('clicked', platform, 'help');
            const outcome = await promptInstall();
            if (outcome === 'accepted')
              trackInstall('completed', platform, 'help');
            if (outcome !== 'unavailable') setHelpOpen(false);
          }}
          onClose={closeHelp}
        />
      )}
    </>
  );
}

// Instruction modal. On iOS shows the animated Safari Share → Add walkthrough;
// elsewhere shows the Android/desktop "browser menu → Install app" steps. If a
// native prompt is available it offers the one-tap Install button too.
function InstallHelpModal({
  isIos,
  isIosNonSafari,
  isDesktop,
  canInstall,
  onInstall,
  onClose,
}: {
  isIos: boolean;
  isIosNonSafari: boolean;
  isDesktop: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onClose: () => void;
}) {
  // Reset is unnecessary: the modal unmounts on close, so a reopened sheet
  // starts on "Copy link" again rather than lying about a stale copy.
  const [copied, setCopied] = useState(false);
  // Best-effort jump to Safari from a non-Safari iOS browser / in-app webview.
  // The undocumented `x-safari-` URL scheme force-opens Safari on most iOS
  // versions; if the OS ignores it nothing happens, so we ALWAYS show the manual
  // "⋯ → Open in Safari" fallback below the button as the guaranteed path.
  // `x-safari-https://...` is Chrome-for-iOS's own escape hatch. It is not a
  // standard, and Firefox iOS, Edge iOS and every in-app webview (Instagram,
  // Facebook, WhatsApp — where a good share of a marketplace's traffic
  // actually arrives) ignore it. Nothing throws when they do; the page simply
  // does not move, which is why the manual instruction and the copy button
  // below are not decoration.
  //
  // ⚠️ CARRY THE QUERY STRING. This used to send origin + pathname only, so
  // somebody handed off from a filtered search or a campaign link landed in
  // Safari on a different page than the one they were reading.
  function openInSafari() {
    try {
      window.location.href =
        'x-safari-' +
        window.location.origin +
        window.location.pathname +
        window.location.search;
    } catch {
      /* scheme unsupported — the manual steps below are the fallback */
    }
  }

  // The realistic fallback when the scheme is ignored: nobody retypes a URL.
  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard API needs a secure context and can be refused outright.
      // A selected-and-copied textarea is the old way and still works in the
      // webviews most likely to refuse.
      try {
        const el = document.createElement('textarea');
        el.value = url;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
      } catch {
        /* nothing left to try — the URL is on screen in the address bar */
      }
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How to install All Outdoor"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        // ⚠️ ABOVE THE CART DRAWER (z-70/71), NOT AT 61 WHERE THIS STARTED.
        // On Android this modal is a fallback nobody usually reaches. On
        // iPhone it is the ONLY install path there is — `canInstall` cannot
        // be true on iOS — so it losing a stacking contest to the
        // added-to-cart drawer meant the install flow silently rendering
        // underneath it. Sits alongside the popup's own 1000, one above, so
        // it wins the handoff if both are ever mounted at once.
        zIndex: 1001,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        overflowY: 'auto',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          width: '100%',
          padding: 16,
          borderRadius: 14,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxHeight: 'calc(100dvh - 24px)',
        }}
      >
        {isIosNonSafari ? (
          <>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                Open All Outdoor in Safari to install
              </p>
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                On iPhone, home-screen apps can only be added from{' '}
                <strong>Safari</strong>. You&rsquo;re in another browser — open
                All Outdoor in Safari, then add it to your home screen.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button
                type="button"
                onClick={openInSafari}
                style={{
                  flex: 1,
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  padding: '11px 14px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Open in Safari
              </button>
              <button
                type="button"
                onClick={copyLink}
                aria-live="polite"
                style={{
                  flex: '0 0 auto',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  padding: '11px 14px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: 'var(--text-tertiary)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              If nothing opens, tap your browser&rsquo;s{' '}
              <strong>⋯ / share</strong> menu → <strong>Open in Safari</strong>.
            </p>
            <div
              style={{
                width: '100%',
                aspectRatio: '9 / 16',
                maxHeight: '42dvh',
                margin: '0 auto',
              }}
            >
              <InstallAnimation />
            </div>
            <p
              style={{
                fontSize: 12.5,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Then in Safari: tap <strong>Share</strong> (the box with an arrow)
              → <strong>Add to Home Screen</strong> → <strong>Add</strong>.
            </p>
          </>
        ) : isIos ? (
          <>
            <div
              style={{
                width: '100%',
                aspectRatio: '9 / 16',
                maxHeight: '62dvh',
                margin: '0 auto',
              }}
            >
              <InstallAnimation />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                Add All Outdoor to your home screen
              </p>
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                In Safari: tap <strong>Share</strong> (the box with an arrow) →
                <strong> Add to Home Screen</strong> → <strong>Add</strong>.
              </p>
            </div>
          </>
        ) : (
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              {canInstall || isDesktop
                ? 'Install the All Outdoor app'
                : 'Add All Outdoor to your home screen'}
            </p>
            {canInstall ? (
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: '0 0 4px',
                }}
              >
                Tap <strong>Install</strong> below to add All Outdoor to your home
                screen.
              </p>
            ) : isDesktop ? (
              // Desktop Chrome/Edge, native prompt not (yet) offered — steps use
              // the omnibox install icon, with the browser menu as the fallback.
              <>
                <ol
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    margin: 0,
                    paddingLeft: 18,
                  }}
                >
                  <li>
                    Look for the <strong>install icon</strong> — a small screen
                    with a down-arrow (<strong>⊕</strong>) — at the right end of
                    the address bar, and click it.
                  </li>
                  <li>
                    Don&rsquo;t see it? Open the browser menu (<strong>⋮</strong>,
                    top-right) → <strong>Install All Outdoor…</strong>.
                  </li>
                  <li>
                    Click <strong>Install</strong> to confirm.
                  </li>
                </ol>
                <p
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-tertiary)',
                    lineHeight: 1.5,
                    margin: '8px 0 0',
                  }}
                >
                  All Outdoor opens in its own window and lives in your taskbar /
                  apps — no store needed.
                </p>
              </>
            ) : (
              <>
                <ol
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    margin: 0,
                    paddingLeft: 18,
                  }}
                >
                  <li>
                    Open your browser&rsquo;s menu — the <strong>⋮</strong> (or
                    <strong> ⋯</strong>) icon, usually top-right.
                  </li>
                  <li>
                    Tap <strong>Add to Home screen</strong> (or{' '}
                    <strong>Install app</strong> if you see it).
                  </li>
                  <li>
                    Confirm <strong>Add</strong>.
                  </li>
                </ol>
                <p
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-tertiary)',
                    lineHeight: 1.5,
                    margin: '8px 0 0',
                  }}
                >
                  On some phones only &ldquo;Add to Home screen&rdquo; is
                  available — that still puts an All Outdoor icon on your home
                  screen; it just opens in your browser.
                </p>
              </>
            )}
          </div>
        )}

        {!isIos && canInstall && (
          <button
            type="button"
            onClick={onInstall}
            style={{
              width: '100%',
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '11px 14px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            background: !isIos && canInstall ? 'transparent' : 'var(--red)',
            color: !isIos && canInstall ? 'var(--text-secondary)' : '#fff',
            border: !isIos && canInstall ? '0.5px solid var(--border)' : 'none',
            padding: '11px 14px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {!isIos && canInstall ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  );
}

// ─── Dismissal helpers (localStorage with safe fallbacks) ──────────

function dismissFor(days: number) {
  try {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISSED_KEY, String(until));
  } catch {
    // localStorage blocked in private mode — accept the prompt may re-show.
  }
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

// "Don't show this again" — permanent opt-out (never expires). The nav's
// manual "Install app" button still works; this only silences the auto popup.
function setNever() {
  try {
    localStorage.setItem(NEVER_KEY, '1');
  } catch {
    // localStorage blocked — accept the popup may re-show.
  }
}

function isNever(): boolean {
  try {
    return localStorage.getItem(NEVER_KEY) === '1';
  } catch {
    return false;
  }
}

// ─── Engagement helpers ────────────────────────────────────────────

/**
 * Count this page load as a visit — at most once — and return the running
 * total. Two guards, because each catches what the other misses: the
 * sessionStorage flag is per-tab so a reload can't inflate the count, and the
 * last-seen gap stops extra tabs (middle-clicking three listings) reading as
 * three separate visits.
 */
function noteSession(): number {
  try {
    const stored = Math.floor(Number(localStorage.getItem(SESSIONS_KEY)));
    let total = Number.isFinite(stored) && stored > 0 ? stored : 0;
    if (sessionStorage.getItem(SESSION_COUNTED_KEY) !== '1') {
      const last = Number(localStorage.getItem(LAST_SEEN_KEY));
      if (!Number.isFinite(last) || Date.now() - last > SESSION_GAP_MS) {
        total += 1;
        localStorage.setItem(SESSIONS_KEY, String(total));
      }
      sessionStorage.setItem(SESSION_COUNTED_KEY, '1');
    }
    touchLastSeen();
    return total;
  } catch {
    // Storage blocked (private mode, cookie-blocking extension). Reporting 0
    // means the visitor can still earn the popup through in-session intent but
    // never through a return visit — erring towards not nagging.
    return 0;
  }
}

function touchLastSeen() {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  } catch {
    // Storage blocked — sessions just won't accumulate.
  }
}
