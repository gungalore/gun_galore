import type { Metadata, Viewport } from 'next';
import { av } from '@/lib/asset-version';
import { fontDisplay, fontBody } from './fonts';
import { BRAND_NAME, BRAND_BLURB, SITE_URL } from '@/lib/brand';
import { Suspense } from 'react';
import { AuthProvider } from '../lib/auth';
import { ThemeProvider } from '@/components/theme-provider';
import { PublicNav, PublicFooter } from '@/components/public-chrome';
import { SiteFooter } from '@/components/site-footer';
import { AddedToCartDrawer } from '@/components/added-to-cart-drawer';
import { InstallPrompt } from '@/components/install-prompt';
import { AvatarLightbox } from '@/components/avatar-lightbox';
import { SwKillSwitch } from '@/components/sw-killswitch';
import { AppShell } from '@/components/shell/app-shell';
import { ConnectionStatusBanner } from '@/components/connection-status-banner';
import { SwUpdateBanner } from '@/components/sw-update-banner';
import { PageViewTracker } from '@/components/page-view-tracker';
import { PushFirstLaunchPrompt } from '@/components/push-first-launch-prompt';
import { ProfileSetupPrompt } from '@/components/profile-setup-prompt';
import { ProfileCompleteNudge } from '@/components/profile-complete-nudge';
import { WishlistProvider } from '@/lib/use-wishlist';
import { WelcomeBanner } from '@/components/welcome-banner';
import { TrustGuaranteeModal } from '@/components/trust-guarantee-modal';
import './globals.css';

// Inline script that runs BEFORE first paint and:
//   1. Sets `data-standalone="true"` on <html> whenever the page is
//      running as an installed PWA. Two signals because no single
//      API covers all browsers (Safari iOS still uses the legacy
//      `navigator.standalone`).
//   2. In standalone mode ONLY, rewrites the viewport meta tag to
//      lock pinch-zoom + double-tap-zoom (`maximum-scale=1,
//      user-scalable=no`). Browser-mobile users keep zoom for
//      accessibility â€” only the installed app feels like a static
//      native window.
//
// Critical that this runs before paint â€” without it the top nav
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
// after a deploy (new build â†’ new hashes â†’ old hashes 404). Without
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
// React hydrates â€” a useEffect listener would mount too late and miss it, so
// the install button would never appear. This inline script registers the
// listener at first paint, stashes the (preventDefault'd) event on
// window.__ggInstallEvent, and dispatches `gg:install-available` so the React
// install UI (lib/use-install-prompt.ts) can pick it up whenever it mounts.
// appinstalled clears the stash + flags installed. See useInstallPrompt().
const INSTALL_CAPTURE_SCRIPT = `(function(){try{window.__ggInstallEvent=window.__ggInstallEvent||null;window.__ggInstalled=window.__ggInstalled||false;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__ggInstallEvent=e;try{window.dispatchEvent(new Event('gg:install-available'));}catch(_){}});window.addEventListener('appinstalled',function(){window.__ggInstallEvent=null;window.__ggInstalled=true;try{window.dispatchEvent(new Event('gg:installed'));}catch(_){}});}catch(_){}})();`;

// Pre-paint theme detection â€” sets <html data-theme="light|dark"> before React
// hydrates so CSS [data-theme] rules apply on the very first frame. Without
// this, the page flashes the OS default (usually light) before the client-side
// useTheme() hook reads localStorage and applies the stored preference.
//
// Reads localStorage 'gg-theme' (light|dark|system). Falls back to
// prefers-color-scheme when 'system'. Writes data-theme to <html>.
// Does NOT write to localStorage â€” that is the client hook's job.
const THEME_DETECT_SCRIPT = `(function(){try{var KEY='gg-theme';var stored=localStorage&&localStorage.getItem(KEY);var pref=stored==='light'||stored==='dark'?stored:'system';var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var theme=pref==='system'? (dark?'dark':'light') : pref;document.documentElement.dataset.theme=theme;}catch(_){}})();`;

// Canonical origin now lives in lib/brand.ts so the manifest and this file
// cannot disagree â€” see the note there.

// The single sentence a crawler, a WhatsApp unfurl and a Google result all
// read first. STORE framing, public catalogue only: this is the site's own
// description of itself, and it must match what a signed-out visitor can
// actually browse. Regulated categories are members-only and are deliberately
// not advertised here. Uses BRAND_BLURB from lib/brand.ts which aligns
// with the AO Brand Pack v1.2 tagline.
const PUBLIC_DESCRIPTION = BRAND_BLURB;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND_NAME} â€” New & Secondhand Outdoor Gear`,
    template: `%s â€” ${BRAND_NAME}`,
  },
  description:
    PUBLIC_DESCRIPTION,
  // AUDIT M29 â€” Open Graph + Twitter Card metadata. Without this,
  // every link shared on WhatsApp / Facebook / X unfurls blank, which
  // for a share-driven SA marketplace suppresses organic referral.
  // Listing pages can override openGraph.images per-listing with the
  // first Cloudinary photo via their own generateMetadata().
  //
  // The share card is /og-default.jpg â€” a 1200x630 crop of the same
  // outdoor hero the homepage uses. It replaced /icon-512.png, which was
  // a 512x512 square: WhatsApp and Facebook render a square that small as
  // a thumbnail chip, so every non-listing share unfurled as a tiny logo
  // instead of a card. 1200x630 (1.91:1) is the size both platforms
  // expand to a full-width image. JPEG on purpose â€” a PNG of the same
  // photo runs >1 MB and WhatsApp silently drops oversized previews.
  openGraph: {
    type: 'website',
    locale: 'en_ZA',
    siteName: BRAND_NAME,
    title: `${BRAND_NAME} â€” New & Secondhand Outdoor Gear`,
    description:
      PUBLIC_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: av('/og/open-graph-dark-1200x630.png'),
        width: 1200,
        height: 630,
        alt: `${BRAND_NAME} â€” ${BRAND_BLURB}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND_NAME} â€” New & Secondhand Outdoor Gear`,
    description:
      PUBLIC_DESCRIPTION,
    // summary_large_image needs a landscape image or X falls back to the
    // small card â€” same 1200x630 asset as Open Graph.
    images: [av('/og/open-graph-dark-1200x630.png')],
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
  // Icon family â€” Next emits the corresponding <link> tags into <head>.
  // favicon.ico in app/ is auto-picked up; explicit PNGs here give
  // browsers + iOS proper sized assets to choose from.
  icons: {
    icon: [
      // Cloudflare caches /public for 30 days, so these carry a version â€”
      // see lib/asset-version.ts. `shortcut` pins favicon.ico too, which
      // Next's file convention would otherwise emit unversioned.
      // âš ï¸ THE SVG FIRST, AND DECLARED BY HAND. app/icon.svg is served by the
      // file convention but Next did not emit a <link> for it once
      // app/favicon.ico existed alongside â€” so the theme-aware favicon was
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
  // Browser-mobile users can pinch-zoom (accessibility â€” WCAG 1.4.4).
  // The inline pre-paint script in layout.tsx overrides this to
  // `maximum-scale=1, user-scalable=no` when the page is running as
  // an installed PWA, so the standalone app feels like a static
  // native window. See STANDALONE_DETECT_SCRIPT.
  maximumScale: 5,
  // viewport-fit=cover lets `env(safe-area-inset-*)` resolve to the
  // real notch / home-indicator insets on iOS. Without this, iOS Safari
  // returns 0 for the safe-area-inset values even on notch phones.
  viewportFit: 'cover',
  // Light and dark arms match globals.css --bg and manifest.ts colours.
  // Dark: #131110 (warm near-black, dark theme canvas).
  // Light: #F7F6F3 (warm off-white, brand pack stone-50).
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#131110' },
    { media: '(prefers-color-scheme: light)', color: '#F7F6F3' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      {/* ThemeProvider sets data-theme on <html> via useTheme(). The pre-paint
          script in <head> sets the initial value so CSS rules apply before
          hydration â€” this component just keeps it in sync on the client. */}
      <ThemeProvider>
      {/* WishlistProvider hydrates the user's saved-listing IDs once
          on sign-in (Set<string>) and makes the toggle helper
          available to every heart icon in the app. Mounted inside
          AuthProvider because the hook depends on useAuth/useUser. */}
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
          {/* Pre-paint standalone-mode detection â€” sets
              <html data-standalone="true"> when the app is running as
              an installed PWA so CSS gated on that attribute applies
              on the very first frame. Without this the top nav would
              flash for one frame in the installed app before React's
              useStandalone() hook hydrates. */}
          <script
            dangerouslySetInnerHTML={{ __html: STANDALONE_DETECT_SCRIPT }}
          />
          {/* Auto-reload on Next.js chunk-load errors â€” covers the
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
          {/* Pre-paint theme detection â€” sets <html data-theme="light|dark">
               before React hydrates so CSS [data-theme] rules apply on the
               first frame. Without this the page flashes the OS default
               (usually light) before useTheme() reads localStorage. */}
          <script
            dangerouslySetInnerHTML={{ __html: THEME_DETECT_SCRIPT }}
          />
          {/* Google Maps Places API — loads the Places library for the
               location autocomplete in the post composer and sell form.
               Key is restricted to gungalore.co.za + localhost in Google
               Cloud console. Only loads when the key is present. */}
          {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && (
            <script
              src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`}
              async
              defer
            />
          )}
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
              iOS shows a white-flash before our React renders â€” with
              them, iOS shows our branded splash with the centred logo
              until the app boots.

              Regenerated on the Winkel ground 2026-08-27. They used to
              carry the old dark #0f0f0f, so an installed iOS PWA flashed
              near-black and then painted a white app. Verified after
              regeneration: the corner pixel is (246,245,241) = --bg
              exactly, and the dark-ink mark reads at (4,4,2). */}
          {APPLE_SPLASH_LINKS.map((s) => (
            <link
              key={s.href}
              rel="apple-touch-startup-image"
              href={s.href}
              media={s.media}
            />
          ))}
          {/* Dark-mode splash screens â€” same sizes as APPLE_SPLASH_LINKS but
              with (prefers-color-scheme: dark) in the media query. iOS picks
              these when the user's OS is in dark mode. */}
          {APPLE_SPLASH_DARK_LINKS.map((s) => (
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
          <WishlistProvider>
          {/* PublicNav + PublicFooter hide themselves on /admin/*
              (the admin layout owns its own chrome) so the public
              Nav and ECT Â§ 43 footer only render on the buyer/
              seller-facing pages. */}
          {/* SW kill switch â€” when NEXT_PUBLIC_DISABLE_PWA=true,
              unregisters any cached service worker on the user's
              browser and clears its caches. Runs as the page loads
              so a single visit cleans up after a shipped-broken SW.
              No-op when the env var is unset. */}
          <SwKillSwitch />
          {/* Online/offline + SW-update banners â€” self-gate (render
              null when nothing's to show) so they cost a single
              effect-mount when there's no event. */}
          <ConnectionStatusBanner />
          <PageViewTracker />
          <SwUpdateBanner />
          <PublicNav />
          {/* âš ï¸ MobileSearchBar WAS MOUNTED HERE AND IS NOW PART OF THE SHELL.
              It was the installed app's entire header â€” a sticky search field
              plus the cart, standalone-only â€” living as a <body> sibling. Two
              problems under the app shell: as a body sibling it has no
              scrolling ancestor once the pane owns scroll, and its cart was
              load-bearing (the tab bar has no cart slot). Both moved into
              components/shell/shell-header.tsx, which is where the design puts
              them. The file is gone; do not re-mount it. */}
          {/* NOTE on View Transitions: React 19.2.6 stable doesn't
              expose `unstable_ViewTransition` yet â€” only the React
              experimental channel does. We've left
              `experimental.viewTransition: true` in next.config.mjs
              and kept the
              `html[data-standalone='true']::view-transition-old/new`
              keyframes in globals.css so that as soon as React
              stabilises the export OR Next.js starts auto-wiring it
              behind the flag, the slide-on-route-change activates
              with zero further changes. Until then routes navigate
              with a hard cut (existing behaviour). */}
          {/* The mobile app shell. On desktop and mobile web it is
              `display: contents` â€” not a box, no layout effect at all â€” so
              this wraps every page without changing how any of them lay out.
              In the installed PWA it becomes the locked flex column that owns
              the header, the scrolling pane and the tab bar. */}
          <AppShell>
            {children}
            <PublicFooter>
              <SiteFooter />
            </PublicFooter>
          </AppShell>
          {/* âš ï¸ THE STICKY FEATURED STRIP WAS REMOVED FROM HERE.
              It hugged the bottom tab bar on every shopping surface in
              standalone mode and reserved 110px of body padding for itself â€”
              which, with the tab bar's own 60px, spoke for 21% of an iPhone
              13's screen before any product had loaded.

              Featured placement moved into the results grid as an in-feed
              card, and was then removed entirely with the Featured module on
              2026-08-26. app/globals.css no longer reserves the 110px, and
              body[data-has-sticky-strip] is gone with it. */}
          {/* âš ï¸ THE BOTTOM TAB BAR MOVED INTO <AppShell>. In the installed app
              the shell is a locked flex column and the bar has to be a real
              flex sibling of the scrolling pane â€” mounted out here as a body
              sibling it could only ever be position:fixed, which takes it out
              of the flow the shell measures against. See
              components/shell/app-shell.tsx. */}
          {/* Floating "Install ALL Outdoor" CTA â€” listens for
              beforeinstallprompt on Android/desktop, shows an iOS
              "Share â†’ Add to Home Screen" hint on iOS Safari. 14-day
              dismissal stored in localStorage. Already standalone-
              aware so it hides itself once the app is installed. */}
          <InstallPrompt />
          {/* Site-wide click-to-enlarge for user profile photos. */}
          <AvatarLightbox />
          {/* UX-4 â€” added-to-cart confirmation drawer + cross-sell rail.
              Global listener; opens on the AddToCartButton's add event. */}
          <AddedToCartDrawer />
          {/* First-launch push opt-in card â€” only shows in installed
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
          {/* Persistent bottom-left reminder bubble â€” unlike ProfileSetupPrompt
              this has no signup-age limit and reappears every browser session
              (sessionStorage dismiss, not localStorage) for as long as the
              profile stays under 100%. Self-gates the same way. */}
          <ProfileCompleteNudge />
          {/* SMS-arrival welcome banner â€” self-gates: renders only when the
              URL carries an active campaign key (?c=KEY), once per session. */}
          <WelcomeBanner />
          {/* Safe Trade Guarantee pop-up â€” self-gates on the URL query
              param (?why=alloutdoor / ?guarantee=true) and renders null
              otherwise. Attach the param to any URL to open it. */}
          <TrustGuaranteeModal />
          </WishlistProvider>
        </body>
      </html>
      </ThemeProvider>
    </AuthProvider>
  );
}

// iOS startup-image link table â€” generated by pwa-asset-generator and
// pasted here. Each entry matches one device size/orientation via the
// media attribute. iOS chooses whichever matches.
//
// Regenerate with:
//   cd frontend && npx pwa-asset-generator public/brand/emblem-light-transparent-dark.svg public/splash \
//     --background "#F7F6F3" --splash-only --portrait-only \
//     --opaque false --padding "30%" --quality 90 --type jpeg
//
// âš ï¸ BOTH OF THOSE ARGUMENTS FLIPPED WITH THE THEME, AND THEY FLIP TOGETHER.
// The ground is now the Winkel page colour, so the mark must be the DARK-INK
// one â€” feeding the emblem-light-transparent.svg to a light background produces a
// splash with an invisible logo, and nothing errors.
// âš ï¸ Replaced IN PLACE under names that never change, and Cloudflare holds
// /public for 30 days: bump ASSET_VERSION whenever you regenerate, or the edge
// keeps serving the old ground for a month.
// Then paste the printed <link> list into this array (drop the
// `public/` prefix on hrefs since /public is served at root).
const APPLE_SPLASH_LINKS: Array<{ href: string; media: string }> = [
  // Added 2026-08-27 â€” the generator emits these three sizes now and did not
  // before, so 1032x1376 / 834x1210 iPads and 360x780 phones fell back to a
  // plain flash instead of a branded splash.
  { href: av('/splash/apple-splash-2064-2752.jpeg'), media: '(device-width: 1032px) and (device-height: 1376px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1668-2420.jpeg'), media: '(device-width: 834px) and (device-height: 1210px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
  { href: av('/splash/apple-splash-1080-2340.jpeg'), media: '(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
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

// Dark-mode splash links â€” same sizes as APPLE_SPLASH_LINKS but with
// (prefers-color-scheme: dark) added to each media query. iOS picks the
// matching entry when the user's OS is in dark mode.
const APPLE_SPLASH_DARK_LINKS: Array<{ href: string; media: string }> = [
  { href: av('/splash-dark/apple-splash-2064-2752.jpeg'), media: '(device-width: 1032px) and (device-height: 1376px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1668-2420.jpeg'), media: '(device-width: 834px) and (device-height: 1210px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1080-2340.jpeg'), media: '(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-2048-2732.jpeg'), media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1668-2388.jpeg'), media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1536-2048.jpeg'), media: '(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1640-2360.jpeg'), media: '(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1668-2224.jpeg'), media: '(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1620-2160.jpeg'), media: '(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1488-2266.jpeg'), media: '(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1320-2868.jpeg'), media: '(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1206-2622.jpeg'), media: '(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1260-2736.jpeg'), media: '(device-width: 420px) and (device-height: 912px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1290-2796.jpeg'), media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1179-2556.jpeg'), media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1170-2532.jpeg'), media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1284-2778.jpeg'), media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1125-2436.jpeg'), media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1242-2688.jpeg'), media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-828-1792.jpeg'), media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-1242-2208.jpeg'), media: '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-750-1334.jpeg'), media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
  { href: av('/splash-dark/apple-splash-640-1136.jpeg'), media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait) and (prefers-color-scheme: dark)' },
];
