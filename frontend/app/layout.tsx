import type { Metadata, Viewport } from 'next';
import { av } from '@/lib/asset-version';
import { fontDisplay, fontBody } from './fonts';
import { BRAND_NAME, BRAND_BLURB, SITE_URL } from '@/lib/brand';
import { Suspense } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { PublicNav, PublicFooter } from '@/components/public-chrome';
import { SiteFooter } from '@/components/site-footer';
import { AddedToCartDrawer } from '@/components/added-to-cart-drawer';
import { InstallPrompt } from '@/components/install-prompt';
import { AvatarLightbox } from '@/components/avatar-lightbox';
import { SwKillSwitch } from '@/components/sw-killswitch';
import { BottomTabBar } from '@/components/bottom-tab-bar';
import { MobileSearchBar } from '@/components/mobile-search-bar';
import { ConnectionStatusBanner } from '@/components/connection-status-banner';
import { SwUpdateBanner } from '@/components/sw-update-banner';
import { PageViewTracker } from '@/components/page-view-tracker';
import { PushFirstLaunchPrompt } from '@/components/push-first-launch-prompt';
import { ProfileSetupPrompt } from '@/components/profile-setup-prompt';
import { WishlistProvider } from '@/lib/use-wishlist';
import ConsentSync from '@/components/consent-sync';
import { WelcomeBanner } from '@/components/welcome-banner';
import './globals.css';

// Inline script that runs BEFORE first paint and:
//   1. Sets `data-standalone="true"` on <html> whenever the page is
//      running as an installed PWA. Two signals because no single
//      API covers all browsers (Safari iOS still uses the legacy
//      `navigator.standalone`).
//   2. In standalone mode ONLY, rewrites the viewport meta tag to
//      lock pinch-zoom + double-tap-zoom (`maximum-scale=1,
//      user-scalable=no`). Browser-mobile users keep zoom for
//      accessibility — only the installed app feels like a static
//      native window.
//
// Critical that this runs before paint — without it the top nav
// (hidden via `html[data-standalone='true'] [data-public-nav]`)
// flashes for one frame on launch, and the viewport rewrite would
// arrive after the OS has already cached the initial zoomable layout.
//
// Listens for display-mode changes so toggling between window modes
// (rare but possible on Chrome desktop) updates both the attribute
// AND the viewport rule consistently.
const STANDALONE_DETECT_SCRIPT = `(function(){var BROWSER='width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover';var LOCKED='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';function applyVP(s){var v=document.querySelector('meta[name=viewport]');if(!v){v=document.createElement('meta');v.setAttribute('name','viewport');document.head.appendChild(v);}v.setAttribute('content',s?LOCKED:BROWSER);}try{var m=window.matchMedia&&window.matchMedia('(display-mode: standalone)');var s=(m&&m.matches)||window.navigator.standalone===true;if(s){document.documentElement.dataset.standalone='true';}applyVP(s);if(m&&m.addEventListener){m.addEventListener('change',function(e){var ns=e.matches||window.navigator.standalone===true;if(ns){document.documentElement.dataset.standalone='true';}else{delete document.documentElement.dataset.standalone;}applyVP(ns);});}}catch(_){}})();`;

// Chunk-load-error self-healer. Runs once on first paint and watches
// for Next.js chunk-load failures, which happen when the SW served
// a cached HTML referencing JS chunk hashes that no longer exist
// after a deploy (new build → new hashes → old hashes 404). Without
// this the user sees a white screen and has to close+open the PWA
// multiple times before the cached HTML naturally revalidates.
//
// On detecting a ChunkLoadError we mark a sessionStorage flag (to
// avoid reload loops) and force window.location.reload(). The
// freshly-fetched HTML references the new chunk hashes and the page
// recovers in one tap instead of three.
//
// Why inline before paint: needs to be registered before any chunk
// has a chance to fail. A React useEffect would run too late.
const CHUNK_HEAL_SCRIPT = `(function(){try{var KEY='gg-chunk-reload-at';var seen=window.sessionStorage&&window.sessionStorage.getItem(KEY);var now=Date.now();if(seen&&(now-parseInt(seen,10))<10000){return;}function looksLikeChunkErr(e){var msg=(e&&(e.message||e.reason&&(e.reason.message||e.reason)+''))||'';return /Loading chunk [\\d_]+ failed|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);}function reload(){try{window.sessionStorage.setItem(KEY,String(Date.now()));}catch(_){}window.location.reload();}window.addEventListener('error',function(e){if(looksLikeChunkErr(e)){reload();}},true);window.addEventListener('unhandledrejection',function(e){if(looksLikeChunkErr(e)){reload();}});}catch(_){}})();`;

// PWA-install event capture. Chrome can fire `beforeinstallprompt` BEFORE
// React hydrates — a useEffect listener would mount too late and miss it, so
// the install button would never appear. This inline script registers the
// listener at first paint, stashes the (preventDefault'd) event on
// window.__ggInstallEvent, and dispatches `gg:install-available` so the React
// install UI (lib/use-install-prompt.ts) can pick it up whenever it mounts.
// appinstalled clears the stash + flags installed. See useInstallPrompt().
const INSTALL_CAPTURE_SCRIPT = `(function(){try{window.__ggInstallEvent=window.__ggInstallEvent||null;window.__ggInstalled=window.__ggInstalled||false;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__ggInstallEvent=e;try{window.dispatchEvent(new Event('gg:install-available'));}catch(_){}});window.addEventListener('appinstalled',function(){window.__ggInstallEvent=null;window.__ggInstalled=true;try{window.dispatchEvent(new Event('gg:installed'));}catch(_){}});}catch(_){}})();`;

// Canonical origin now lives in lib/brand.ts so the manifest and this file
// cannot disagree — see the note there.

// The single sentence a crawler, a WhatsApp unfurl and a Google result all
// read first. STORE framing, public catalogue only: this is the site's own
// description of itself, and it must match what a signed-out visitor can
// actually browse. Regulated categories are members-only and are deliberately
// not advertised here.
const PUBLIC_DESCRIPTION =
  `${BRAND_BLURB} — camping, overlanding, fishing and outdoor clothing. New and secondhand, couriered to your door.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND_NAME} — New & Secondhand Outdoor Gear`,
    template: `%s — ${BRAND_NAME}`,
  },
  description:
    PUBLIC_DESCRIPTION,
  // AUDIT M29 — Open Graph + Twitter Card metadata. Without this,
  // every link shared on WhatsApp / Facebook / X unfurls blank, which
  // for a share-driven SA marketplace suppresses organic referral.
  // Listing pages can override openGraph.images per-listing with the
  // first Cloudinary photo via their own generateMetadata().
  //
  // The share card is /og-default.jpg — a 1200x630 crop of the same
  // outdoor hero the homepage uses. It replaced /icon-512.png, which was
  // a 512x512 square: WhatsApp and Facebook render a square that small as
  // a thumbnail chip, so every non-listing share unfurled as a tiny logo
  // instead of a card. 1200x630 (1.91:1) is the size both platforms
  // expand to a full-width image. JPEG on purpose — a PNG of the same
  // photo runs >1 MB and WhatsApp silently drops oversized previews.
  openGraph: {
    type: 'website',
    locale: 'en_ZA',
    siteName: BRAND_NAME,
    title: `${BRAND_NAME} — New & Secondhand Outdoor Gear`,
    description:
      PUBLIC_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: av('/og-default.jpg'),
        width: 1200,
        height: 630,
        alt: `${BRAND_NAME} — ${BRAND_BLURB}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND_NAME} — New & Secondhand Outdoor Gear`,
    description:
      PUBLIC_DESCRIPTION,
    // summary_large_image needs a landscape image or X falls back to the
    // small card — same 1200x630 asset as Open Graph.
    images: [av('/og-default.jpg')],
  },
  alternates: {
    canonical: SITE_URL,
  },
  // PWA / iOS install hints. The manifest itself is generated by
  // app/manifest.ts and Next auto-links it; these tags add the
  // iOS-specific equivalents Safari needs to honour "Add to Home
  // Screen" properly (Safari ignores the web manifest's display
  // mode and uses apple-mobile-web-app-capable instead).
  appleWebApp: {
    capable: true,
    title: BRAND_NAME,
    statusBarStyle: 'black-translucent',
  },
  applicationName: BRAND_NAME,
  formatDetection: {
    telephone: false,
  },
  // Icon family — Next emits the corresponding <link> tags into <head>.
  // favicon.ico in app/ is auto-picked up; explicit PNGs here give
  // browsers + iOS proper sized assets to choose from.
  icons: {
    icon: [
      // Cloudflare caches /public for 30 days, so these carry a version —
      // see lib/asset-version.ts. `shortcut` pins favicon.ico too, which
      // Next's file convention would otherwise emit unversioned.
      // ⚠️ THE SVG FIRST, AND DECLARED BY HAND. app/icon.svg is served by the
      // file convention but Next did not emit a <link> for it once
      // app/favicon.ico existed alongside — so the theme-aware favicon was
      // sitting there reachable and never used. Chrome and Firefox prefer an
      // SVG icon when offered one; everything else falls through to the .ico.
      //
      // That SVG is the only icon that flips its ink with the browser's colour
      // scheme, which a transparent favicon needs: white vanishes on a light
      // tab strip and near-black vanishes on a dark one.
      { url: av('/icon.svg'), type: 'image/svg+xml' },
      { url: av('/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { url: av('/icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
    shortcut: av('/favicon.ico'),
    apple: av('/apple-icon-180.png'),
  },
};

// Viewport + theme-color must live in the Viewport export (Next 14+
// moved them out of Metadata). themeColor is what colours the Android
// status bar + the Chrome tab bar when the PWA is installed.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Browser-mobile users can pinch-zoom (accessibility — WCAG 1.4.4).
  // The inline pre-paint script in layout.tsx overrides this to
  // `maximum-scale=1, user-scalable=no` when the page is running as
  // an installed PWA, so the standalone app feels like a static
  // native window. See STANDALONE_DETECT_SCRIPT.
  maximumScale: 5,
  // viewport-fit=cover lets `env(safe-area-inset-*)` resolve to the
  // real notch / home-indicator insets on iOS. Without this, iOS Safari
  // returns 0 for the safe-area-inset values even on notch phones.
  viewportFit: 'cover',
  // Both entries are the Winkel page colour (--bg). The site ships ONE
  // theme, so the two media arms are deliberately identical rather than
  // absent — a missing light arm lets Chrome pick its own tab colour.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#F6F5F1' },
    { media: '(prefers-color-scheme: light)', color: '#F6F5F1' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      {/* WishlistProvider hydrates the user's saved-listing IDs once
          on sign-in (Set<string>) and makes the toggle helper
          available to every heart icon in the app. Mounted inside
          ClerkProvider because the hook depends on useAuth/useUser. */}
      <html
        lang="en-ZA"
        className={`${fontDisplay.variable} ${fontBody.variable}`}
      >
        <head>
          {/* Defense-in-depth fallback for the HTTP Referrer-Policy
              header set in next.config.mjs. Some older browsers and
              intermediaries strip or ignore the header; the meta tag
              guarantees the policy is applied so URLs carrying action
              tokens are never leaked in the Referer on cross-origin
              navigation. */}
          <meta name="referrer" content="strict-origin-when-cross-origin" />
          {/* Pre-paint standalone-mode detection — sets
              <html data-standalone="true"> when the app is running as
              an installed PWA so CSS gated on that attribute applies
              on the very first frame. Without this the top nav would
              flash for one frame in the installed app before React's
              useStandalone() hook hydrates. */}
          <script
            dangerouslySetInnerHTML={{ __html: STANDALONE_DETECT_SCRIPT }}
          />
          {/* Auto-reload on Next.js chunk-load errors — covers the
              white-screen window when a new deploy lands and the SW-
              cached HTML references stale chunk hashes. One reload
              fetches fresh HTML + chunks; sessionStorage gate stops
              reload loops if the cause is something else. */}
          <script
            dangerouslySetInnerHTML={{ __html: CHUNK_HEAL_SCRIPT }}
          />
          {/* Capture beforeinstallprompt at first paint so the install UI
              never misses it to a hydration race. See useInstallPrompt(). */}
          <script
            dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }}
          />
          {/* Preload the homepage hero image so it kicks off in
              parallel with the JS bundle. Lighthouse mobile flagged
              the original hero.png (1.2 MB) as the LCP element with
              an LCP of 9.9s; switching to WebP (~29 KB) plus this
              preload drops LCP under 2.5s. Safe to preload on every
              route because the file is tiny + cached after first hit;
              non-homepage routes pay a one-time ~30 KB hit and warm
              the cache for the inevitable hero-page visit. */}
          {/* Preload the hero LCP image (the outdoor golden-hour photo).
              WebP is what modern browsers fetch via the .hero-bg image-set;
              keep this href in sync with that url(). */}
          <link
            rel="preload"
            as="image"
            href={av('/hero-outdoor.webp')}
            type="image/webp"
          />
          {/* iOS apple-touch-startup-image splash screens. iOS picks
              the right image via the media-attribute device match
              (portrait orientation + device-width + device-pixel-
              -ratio). Without these, launching the installed PWA on
              iOS shows a white-flash before our React renders — with
              them, iOS shows our branded splash with the centred logo
              until the app boots.

              ⚠️ STALE AGAINST THE WINKEL THEME. These PNGs still carry
              the old dark #0f0f0f ground, so an installed iOS PWA
              flashes dark before painting the white app. Harmless but
              wrong; regenerate with pwa-asset-generator from
              public/logo-mark.svg with --background "#F6F5F1" and drop
              the new files in public/. Deliberately not done inline
              because it rewrites ~20 binary assets. */}
          {APPLE_SPLASH_LINKS.map((s) => (
            <link
              key={s.href}
              rel="apple-touch-startup-image"
              href={s.href}
              media={s.media}
            />
          ))}
        </head>
        <body className="antialiased">
          {/* Flushes any pending sign-up consent to the backend once the
              session is live (POPIA record). No-op when signed out. */}
          <ConsentSync />
          <WishlistProvider>
          {/* PublicNav + PublicFooter hide themselves on /admin/*
              (the admin layout owns its own chrome) so the public
              Nav and ECT § 43 footer only render on the buyer/
              seller-facing pages. */}
          {/* SW kill switch — when NEXT_PUBLIC_DISABLE_PWA=true,
              unregisters any cached service worker on the user's
              browser and clears its caches. Runs as the page loads
              so a single visit cleans up after a shipped-broken SW.
              No-op when the env var is unset. */}
          <SwKillSwitch />
          {/* Online/offline + SW-update banners — self-gate (render
              null when nothing's to show) so they cost a single
              effect-mount when there's no event. */}
          <ConnectionStatusBanner />
          <PageViewTracker />
          <SwUpdateBanner />
          <PublicNav />
          {/* Search affordance for standalone-PWA users on the Browse
              screen — the top nav (with its search input) is hidden
              in standalone mode, so this fills the gap. Self-gates on
              both display-mode + pathname, no-op everywhere else. */}
          <MobileSearchBar />
          {/* NOTE on View Transitions: React 19.2.6 stable doesn't
              expose `unstable_ViewTransition` yet — only the React
              experimental channel does. We've left
              `experimental.viewTransition: true` in next.config.mjs
              and kept the
              `html[data-standalone='true']::view-transition-old/new`
              keyframes in globals.css so that as soon as React
              stabilises the export OR Next.js starts auto-wiring it
              behind the flag, the slide-on-route-change activates
              with zero further changes. Until then routes navigate
              with a hard cut (existing behaviour). */}
          {children}
          <PublicFooter>
            <SiteFooter />
          </PublicFooter>
          {/* ⚠️ THE STICKY FEATURED STRIP WAS REMOVED FROM HERE.
              It hugged the bottom tab bar on every shopping surface in
              standalone mode and reserved 110px of body padding for itself —
              which, with the tab bar's own 60px, spoke for 21% of an iPhone
              13's screen before any product had loaded.

              Featured placement did not go away; it moved into the results
              grid as <FeaturedInFeedCard />, where it is read as stock rather
              than as a banner. See that component for the full argument.
              app/globals.css no longer reserves the 110px, and
              body[data-has-sticky-strip] is gone with it. */}
          {/* Bottom tab bar — installed-PWA users only. Renders null
              in browser-mobile mode so server HTML stays identical
              and the existing hamburger drawer in nav.tsx is what
              browser-mobile users see.
              Wrapped in Suspense because it reads useSearchParams()
              for the active-tab matcher; without the boundary, Next
              fails to prerender static pages that don't otherwise
              use search params (e.g. /admin/featured/banned). */}
          <Suspense fallback={null}>
            <BottomTabBar />
          </Suspense>
          {/* Floating "Install All Outdoor" CTA — listens for
              beforeinstallprompt on Android/desktop, shows an iOS
              "Share → Add to Home Screen" hint on iOS Safari. 14-day
              dismissal stored in localStorage. Already standalone-
              aware so it hides itself once the app is installed. */}
          <InstallPrompt />
          {/* Site-wide click-to-enlarge for user profile photos. */}
          <AvatarLightbox />
          {/* UX-4 — added-to-cart confirmation drawer + cross-sell rail.
              Global listener; opens on the AddToCartButton's add event. */}
          <AddedToCartDrawer />
          {/* First-launch push opt-in card — only shows in installed
              PWA mode, only when push isn't already enabled, only
              outside the 30-day snooze window. Self-hides under any
              condition. Matches the iOS/Android-native pattern where
              an installed app asks for notifications on first launch. */}
          <PushFirstLaunchPrompt />
          {/* One-time post-signup "finish your profile" welcome dialog.
              Self-gates: signed-in + profile <100% + freshly-created
              account + not snoozed + off auth/KYC/create-listing/admin
              routes + once per session. Shows a progress bar off the
              profileCompleteness value already in /users/me and points
              to /profile/edit. Fully dismissible (unlike the create-
              listing hard-wall modal). */}
          <ProfileSetupPrompt />
          {/* SMS-arrival welcome banner — self-gates: renders only when the
              URL carries an active campaign key (?c=KEY), once per session. */}
          <WelcomeBanner />
          </WishlistProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

// iOS startup-image link table — generated by pwa-asset-generator and
// pasted here. Each entry matches one device size/orientation via the
// media attribute. iOS chooses whichever matches.
//
// Regenerate with:
//   cd frontend && npx pwa-asset-generator public/logo-mark.svg public/splash \
//     --background "#0f0f0f" --splash-only --portrait-only \
//     --opaque false --padding "30%" --quality 90 --type jpeg
// Then paste the printed <link> list into this array (drop the
// `public/` prefix on hrefs since /public is served at root).
const APPLE_SPLASH_LINKS: Array<{ href: string; media: string }> = [
  { href: av('/splash/apple-splash-2048-2732.jpeg'), media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1668-2388.jpeg'), media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1536-2048.jpeg'), media: '(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1640-2360.jpeg'), media: '(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1668-2224.jpeg'), media: '(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1620-2160.jpeg'), media: '(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1488-2266.jpeg'), media: '(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1320-2868.jpeg'), media: '(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1206-2622.jpeg'), media: '(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1260-2736.jpeg'), media: '(device-width: 420px) and (device-height: 912px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1290-2796.jpeg'), media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1179-2556.jpeg'), media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1170-2532.jpeg'), media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1284-2778.jpeg'), media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1125-2436.jpeg'), media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1242-2688.jpeg'), media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-828-1792.jpeg'), media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1242-2208.jpeg'), media: '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-750-1334.jpeg'), media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-640-1136.jpeg'), media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
];
