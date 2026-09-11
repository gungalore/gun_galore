/**
 * WHICH STAND-IN A FAILED NAVIGATION GETS — the shop's, the Desk's, or none.
 *
 * 🚨 THIS FILE IS COMPILED INTO THE SERVICE WORKER. app/sw.ts imports it, so
 * it may touch nothing that only exists in a window: no `document`, no
 * `localStorage`, no `next/*`. The half of Phase 9 that reads the browser
 * lives in lib/desk-offline-device.ts, which the service worker never sees.
 *
 * ⚠️ IT HOLDS THE SHOP'S RULE AS WELL AS THE DESK'S, AND THAT IS THE POINT.
 * They are not two rules, they are one partition of the same space: the shop
 * matcher's `!startsWith('/admin')` is now what keeps the cream storefront
 * page off a near-black control room, and the Desk matcher's `/admin` test is
 * what keeps the Desk page off the shop. Written in two files they drift, and
 * the drift is silent — the loser is a page nobody sees until the day the
 * network is already gone. app/sw.ts's own header records the same failure in
 * its other half: the auth list is written twice there and is ALREADY one
 * entry out of step (`/kyc` is in the fallback carve-out and not in the
 * NetworkOnly matcher).
 *
 * ⚠️ AND NOTHING UNDER app/ IS COLLECTED BY VITEST. `include` is
 * ['lib/**\/*.spec.ts', 'components/**\/*.spec.tsx'] — a rule written inside
 * app/sw.ts can never be tested, which is why the decidable part of the
 * service worker's behaviour lives here and app/sw.ts is a thin adapter over
 * it. See lib/desk-offline.spec.ts.
 */

/** The Desk's stand-in document. See app/admin/offline/page.tsx. */
export const DESK_OFFLINE_URL = '/admin/offline';

/** The shop's stand-in document. See app/offline/page.tsx. */
export const SHOP_OFFLINE_URL = '/offline';

/**
 * ⚠️ ONE DEFINITION OF "ADMIN", USED THREE TIMES BELOW AND ONCE IN THE HEALTH
 * BOARD. A bare prefix, which also catches a hypothetical `/admin-anything` —
 * the same test app/sw.ts's NetworkOnly rule already makes. Two slightly
 * different definitions is how a path ends up network-only with no stand-in:
 * the stricter form (`=== '/admin' || startsWith('/admin/')`) leaves exactly
 * that hole, and it leaves it in the direction nobody checks.
 */
export const ADMIN_PREFIX = '/admin';

/** Is this path the Desk's, by the same test the service worker makes? */
export function isAdminPath(pathname: string): boolean {
  return pathname.startsWith(ADMIN_PREFIX);
}

/**
 * Paths the SHOP refuses to stand in for, and why each one is on the list.
 *
 * ⚠️ THESE ARE TWO DIFFERENT REASONS WEARING ONE LIST.
 *
 *   • `/admin` — served its OWN document now (see below). Before Phase 9 it
 *     was here because an admin failure had to be visible; it is still here,
 *     for the narrower reason that the storefront's cream page is the wrong
 *     product for the Desk.
 *
 *   • `/a/`, `/checkout`, `/preview` — single-use tokens and money. A stand-in
 *     page invites a retry against a request that may already have been spent.
 *
 *   • `/kyc` — hands off to the hosted identity session and needs the network
 *     for it. A stand-in misleads a seller who DOES have signal but hit a blip
 *     mid-capture into waiting instead of retrying. Same argument as the
 *     retired Ask Boet chat, which is why that entry is gone and this one is
 *     not.
 *
 *   • the five auth routes — the API has to be reachable for any of them to do
 *     anything, so a page that says "you are offline" over a sign-in form is a
 *     form somebody will fill in.
 *
 * ⚠️ THE AUTH ROUTES ARE NAMED TWICE IN THIS REPO — here and in app/sw.ts's
 * NetworkOnly matcher, for two different reasons (never cache them / never
 * stand in for them). Adding a sixth auth route means adding it to BOTH.
 */
const SHOP_FALLBACK_EXCLUDES = [
  ADMIN_PREFIX,
  '/a/',
  '/checkout',
  '/preview',
  '/kyc',
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
] as const;

/**
 * Does the DESK's stand-in document answer this failed request?
 *
 * 🚨 THIS REVERSES A CONSIDERED DECISION, and the reversal is only safe
 * because of what the document is. app/sw.ts used to say admin pages "never
 * fall back (they must error visibly so the operator knows the backend is
 * down, not show a stale page)" — and that reasoning is correct about a
 * CACHED BOARD. A cached "0 things need you" is the worst thing this panel
 * could render: a number the operator acts on that stopped being true.
 *
 * What is precached instead carries no figure at all. `/api/*` stays
 * network-only permanently, so not one byte of DATA is cached; the Desk's JS
 * chunks are already in the precache, so the page paints instantly without
 * any of it. The failure is still visible — it is the whole page — it simply
 * says so in the Desk's own skin instead of the browser's.
 *
 * Documents only. A fallback plugin is attached to EVERY runtime strategy, not
 * just the navigation one (serwist pushes it onto each handler in
 * `runtimeCaching`), so without this test a failed /admin image or a failed
 * /admin fetch would each be answered with a page of HTML.
 */
export function deskOfflineFallbackApplies(
  destination: string,
  pathname: string,
): boolean {
  if (destination !== 'document') return false;
  return isAdminPath(pathname);
}

/**
 * Does the SHOP's stand-in document answer this failed request?
 *
 * ⚠️ TOGETHER WITH THE DESK MATCHER THIS IS A PARTITION, NOT TWO FILTERS.
 * Every document request that fails gets exactly one of the two pages, or —
 * for the token, money, identity and auth paths above — none at all, which is
 * itself a decision rather than a gap. Both halves test `/admin` through
 * ADMIN_PREFIX, so a document cannot be network-only-with-no-stand-in on one
 * reading and covered on the other.
 */
export function shopOfflineFallbackApplies(
  destination: string,
  pathname: string,
): boolean {
  if (destination !== 'document') return false;
  return !SHOP_FALLBACK_EXCLUDES.some((p) => pathname.startsWith(p));
}

/** A precache manifest entry, as @serwist/next injects it. */
type ManifestEntry = string | { url: string; revision?: string | null };

/**
 * The build id, read out of the precache manifest Next just produced.
 *
 * 🚨 A PRECACHED HTML DOCUMENT NEEDS A REVISION THAT MOVES, AND A CONSTANT ONE
 * IS A BUG WITH A LONG FUSE. Serwist keys a precached entry by url + revision;
 * an entry whose revision never changes is never re-fetched, so the Desk's
 * stand-in page would go on serving the HTML of whichever build first
 * installed it — script tags pointing at chunk filenames that were deleted two
 * deploys ago. That is the same class of failure as the RSC poisoning the
 * first NetworkOnly rule in app/sw.ts exists to stop, except it surfaces only
 * when the operator is already offline.
 *
 * `/_next/static/<buildId>/_buildManifest.js` is in the injected manifest on
 * every build (verified by parsing the 230 entries of a built public/sw.js,
 * not by reading serwist's documentation), and `<buildId>` is new on every
 * build whose output differs. So it is exactly the stamp wanted: it moves when
 * the HTML would differ and stands still when it would not.
 *
 * ⚠️ RETURNS null RATHER THAN GUESSING. If Next ever stops emitting that
 * entry, the caller omits the precache entry altogether — the Desk goes back
 * to the browser's own error page, which is where it was before Phase 9. The
 * alternative, inventing a stamp, trades a missing page for a permanently
 * stale one, and the stale one cannot be noticed from outside. The Health
 * board's "Offline stand-in" row is what makes the missing one noticeable.
 */
export function precacheBuildId(
  entries: readonly ManifestEntry[] | undefined,
): string | null {
  for (const entry of entries ?? []) {
    const url = typeof entry === 'string' ? entry : entry?.url;
    if (typeof url !== 'string') continue;
    const m = /^\/_next\/static\/([^/]+)\/_buildManifest\.js(?:[?#]|$)/.exec(url);
    // ⚠️ THE NEAR MISS IS THE DANGEROUS ONE. `/_next/static/chunks/…` is the
    // fixed directory every code chunk lives in, and its name is a valid
    // capture for this pattern — so a file called _buildManifest.js landing
    // there would yield the literal string "chunks" as the stamp. That is a
    // constant, which is the exact failure this function exists to avoid, and
    // it would look like a working build id in every log. The three fixed
    // segment names are refused by name; a real build id is never one of them.
    if (m && !FIXED_STATIC_SEGMENTS.has(m[1])) return m[1];
  }
  return null;
}

/** Next's fixed subdirectories under /_next/static. Never a build id. */
const FIXED_STATIC_SEGMENTS = new Set(['chunks', 'css', 'media']);

/**
 * The one extra precache entry Phase 9 adds, or null if it cannot be stamped.
 *
 * 🚨 WITHOUT THIS ENTRY THE WHOLE FEATURE IS DECORATION, and that is not a
 * theory — it is the state the SHOP has shipped in. A serwist fallback is
 * resolved ONLY through `matchPrecache()`: no precache key means `undefined`
 * means the original error is rethrown and the browser draws its own network
 * page. `globPublicPatterns` globs public/ and nothing else, and App Router
 * HTML is not in public/, so `/offline` has never been in the precache. The
 * built public/sw.js carries 230 entries; `/offline` is not one of them, only
 * its JS chunk is. app/offline/page.tsx's own comment — "This page is also
 * precached at install time so it's always available" — has been false since
 * it was written.
 *
 * ⚠️ PHASE 9 DOES NOT FIX THAT FOR THE SHOP. Adding `/offline` here would
 * switch on a storefront page that has never once been served, on every
 * visitor's phone, as a side effect of an admin change. It is a separate
 * decision and a separate commit.
 */
export function deskOfflinePrecacheEntry(
  entries: readonly ManifestEntry[] | undefined,
): { url: string; revision: string } | null {
  const revision = precacheBuildId(entries);
  return revision === null ? null : { url: DESK_OFFLINE_URL, revision };
}

// ─── The install-time blast radius ──────────────────────────────────────────

/**
 * Is a failed precache fetch for THIS ONE url, during THIS ONE event, the
 * failure the service worker is allowed to swallow?
 *
 * 🚨 A PRECACHE INSTALL IS ALL-OR-NOTHING, AND `/admin/offline` IS THE ONLY
 * ENTRY IN IT THAT IS A RENDERED ROUTE. Every other url in the injected
 * manifest is a file on disk — in the build this was measured against, 232
 * entries: 169 build artefacts under `/_next/static/` and 63 globbed out of
 * `public/`, all served by the same node process that just served the page
 * doing the installing. This one is an App Router HTML document under a path an edge rule can plausibly be pointed
 * at — an IP allowlist on /admin, a Cloudflare access policy, a middleware
 * change, a deploy where the route 404s. serwist's PrecacheStrategy throws
 * `bad-precaching-response` on any status >= 400 and rethrows a network
 * failure (see node_modules/serwist/src/lib/strategies/PrecacheStrategy.ts,
 * `_handleInstall`, whose own comment says the throw is meant "to do if *any*
 * of the responses aren't safe to cache"), `Serwist.handleInstall` awaits them
 * all inside `event.waitUntil`, and an install that rejects means NO service
 * worker — for shoppers, not just the operator. A Desk-only stand-in page was
 * gating the storefront's PWA.
 *
 * So the rescue is scoped to one url and one event type, and both halves are
 * load-bearing:
 *
 *   • ⚠️ NOT "any precache entry may fail". A rescue that matched every url
 *     would let a missing JS chunk install silently, and the whole point of
 *     the all-or-nothing rule is that a precache holding three quarters of a
 *     build is worse than no precache at all.
 *   • ⚠️ NOT "any event". Outside install, the same strategy answers a
 *     precache MISS on a real navigation (`_handleFetch`). Rescuing there
 *     would hand a document request a body-less 204 — a blank white page
 *     where the browser's own error page belongs, which is strictly worse
 *     than what this feature replaced.
 *
 * The trade is written down in app/sw.ts and reported by the Health board's
 * "Offline stand-in" row: when this fires, the worker installs WITHOUT the
 * stand-in and nothing in the worker says so.
 */
export function deskStandInInstallFailureIsTolerated(
  eventType: string | undefined,
  requestUrl: string,
): boolean {
  return eventType === 'install' && isDeskStandInUrl(requestUrl);
}

/**
 * Is this url the Desk's stand-in document, exactly?
 *
 * ⚠️ EXACT PATHNAME, NOT A PREFIX — the one place in this file that is not
 * allowed to use `isAdminPath`. The precache rescue above is a licence to lose
 * an entry silently; handing that licence to everything under /admin would
 * cover any admin url that ever entered the manifest.
 *
 * ⚠️ SEARCH AND HASH IGNORED ON PURPOSE. serwist requests the manifest url
 * itself at install (the `?__WB_REVISION__=` suffix is on the CACHE KEY, not
 * on the request — see `Serwist.handleInstall`), so today there is nothing to
 * ignore; parsing rather than comparing strings is what keeps that true if the
 * request ever carries one.
 */
export function isDeskStandInUrl(url: string): boolean {
  try {
    return new URL(url, 'https://example.invalid').pathname === DESK_OFFLINE_URL;
  } catch {
    return false;
  }
}

// ─── "Last good read", and why React must not be able to take it back ───────

/**
 * The custom property the stand-in page's remembered timestamp travels in.
 *
 * 🚨 IT TRAVELS AS A CSS VARIABLE ON <html> BECAUSE THE OBVIOUS ROUTE — an
 * inline script writing `textContent` — IS UNDONE A FEW HUNDRED MILLISECONDS
 * LATER BY HYDRATION. The page server-renders an em dash into the element;
 * the pre-paint script replaces it with "3 Sep 09:14"; react then hydrates,
 * finds `props.children` ("—") against a DOM text node that no longer matches,
 * and — react-dom 19.2.6, react-dom-client line 5322 — skips the match only if
 * `suppressHydrationWarning` is true, otherwise calls `throwOnHydrationMismatch`,
 * which discards the server markup for that subtree and re-renders it from the
 * JSX. The em dash comes back and stays. The one number on the page could
 * never show a value.
 *
 * A pseudo-element's content is not in the DOM, so hydration has nothing to
 * revert; the variable is set on `document.documentElement`, which is the
 * element app/layout.tsx's own pre-paint script already writes to
 * (`data-standalone`) and the one react renders with no `style` prop of its
 * own, so it is not re-created by a client re-render of the page's subtree.
 *
 * ⚠️ THE NARROW VERSION: this survives the hydration mismatch path and a
 * re-render of the page body. It is NOT a claim that nothing can clear it — a
 * script that sets `style` on <html>, or a future root layout that renders a
 * `style` prop there, would. Neither exists today.
 */
export const LAST_GOOD_READ_CSS_VAR = '--dk-last-read';

/**
 * What a rendered Africa/Johannesburg date-and-time is allowed to contain.
 *
 * 🚨 THIS IS A CSS-STRING BOUNDARY, NOT A TIDINESS CHECK. The value is read
 * out of localStorage, which any script on this origin can write, and it ends
 * up inside `"…"` in a custom property. A stored value carrying a quote would
 * close the string and make the declaration unparseable — and per
 * CLAUDE.md's own rule, an invalid `var()` substitution takes the WHOLE
 * declaration with it, so `content` falls back to its initial value `normal`,
 * which on ::after means no pseudo-element at all. Not a wrong figure: a row
 * with nothing in it, including the dash.
 *
 * ⚠️ NBSP AND NARROW-NBSP ARE IN THE CLASS DELIBERATELY. ICU emits U+00A0 and
 * U+202F as separators in some locale/version combinations, and the browser
 * doing the formatting is not the one this list was written against. A class
 * that allowed only ASCII space would silently refuse a perfectly good
 * timestamp on whichever engine formats it that way.
 *
 * ⚠️ AND THEY ARE WRITTEN AS ESCAPES, NOT TYPED — doubled, so they
 * survive JSON.stringify into the inline script as escapes too. A raw NBSP is
 * invisible in a diff and would be invisible again in the shipped HTML, where
 * anything that normalises whitespace could eat it and blank the row on the
 * engines that need it. RegExp reads \u00a0 back as the character at both hops.
 *
 * Kept as a pattern STRING rather than a RegExp because the same one line is
 * both compiled here and serialised into the inline script below — written
 * twice they drift, and the drift shows up as a row that is blank on one
 * browser only.
 */
export const LAST_GOOD_READ_PATTERN = '^[A-Za-z0-9 \\u00a0\\u202f:,.-]+$';

/**
 * The custom-property value for a rendered timestamp, or null to leave the
 * dash alone. Exported for the spec; the inline script applies the same test.
 */
export function lastGoodReadCssValue(rendered: string): string | null {
  return new RegExp(LAST_GOOD_READ_PATTERN).test(rendered) ? `"${rendered}"` : null;
}

/**
 * The stand-in page's whole inline script, built here so it can be executed by
 * a spec.
 *
 * ⚠️ IT IS A STRING PRODUCER, NOT WINDOW CODE. This module is compiled INTO
 * the service worker (see the file header), so nothing here may touch a
 * `window` — and nothing here does: the browser objects appear only inside the
 * source text this function returns, and the service worker never calls it.
 *
 * ⚠️ EVERY BROWSER OBJECT IS REACHED THROUGH `window.` OR `document`, so the
 * spec can execute the source with `new Function('window','document', src)`
 * and hand it fakes. `setTimeout` used to be bare; it is `window.setTimeout`
 * for that reason alone.
 *
 * ⚠️ THE WHOLE READ IS INSIDE ONE try. Reading the `localStorage` PROPERTY
 * throws when site data is blocked — it does not return null — and an uncaught
 * throw here would kill the `online` listener below it, turning a missing
 * timestamp into a page that never reloads itself when the signal comes back.
 *
 * ⚠️ IT RELOADS TO /admin/desk, NOT location.href. This document is served in
 * place of whatever /admin url failed, but the operator may equally have hit
 * /admin/offline directly, and reloading THAT re-serves this page from the
 * precache forever.
 */
export function deskOfflineInlineScript(storageKey: string): string {
  return `(function(){
  try{
    var v = window.localStorage.getItem(${JSON.stringify(storageKey)});
    if(v){
      var d = new Date(v);
      if(!isNaN(d.getTime())){
        var t = d.toLocaleString('en-ZA',{
          timeZone:'Africa/Johannesburg',day:'numeric',month:'short',
          hour:'2-digit',minute:'2-digit',hour12:false
        });
        if(new RegExp(${JSON.stringify(LAST_GOOD_READ_PATTERN)}).test(t)){
          document.documentElement.style.setProperty(${JSON.stringify(
            LAST_GOOD_READ_CSS_VAR,
          )}, '"'+t+'"');
        }
      }
    }
  }catch(e){}
  window.addEventListener('online',function(){
    window.setTimeout(function(){ window.location.replace('/admin/desk'); },400);
  });
})();`;
}
