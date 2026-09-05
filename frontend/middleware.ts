import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  // The phone's half of the desktop QR handoff. ⚠️ IT MUST BE PUBLIC: the
  // whole point is that the phone is NOT signed in, and the ?t= token is what
  // authorises it. See app/scan/handoff/page.tsx.
  '/scan/handoff(.*)',
  // A CHARACTER WITNESS completing a statement. ⚠️ IT MUST BE PUBLIC, and for
  // a stronger reason than the handoff above: this person is not our member
  // and never will be. They received an SMS from somebody applying for a
  // firearm licence. A 307 to sign-in here does not read as "please log in",
  // it reads as a suspicious link — and they simply close it.
  //
  // The token in the path is the credential, and a code sent to the number the
  // applicant nominated is the second half of it. See
  // backend/src/motivations/motivation-witness.service.ts.
  '/witness(.*)',
  // The previous owner opening a consent link. Same reasoning as /witness:
  // they are not a member and cannot be sent to a sign-in page.
  '/consent(.*)',
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)', // OAuth (Google) redirect target — finishes the flow client-side
  '/marketplace(.*)',
  '/listings(.*)',
  '/deals(.*)',     // RETIRED 2026-09-02 — Daily Deals was removed. Kept
                   // public, like /load-lab and /competitions, so a bookmarked
                   // or indexed deal link 404s honestly instead of bouncing a
                   // signed-out visitor to a sign-in form for a page that no
                   // longer exists.
  '/auctions(.*)',
  '/about(.*)',
  '/buy-and-sell(.*)',
  '/welcome(.*)',
  '/sellers(.*)', // public seller profiles
  '/category(.*)', // public category landing/browse pages
  '/wanted(.*)',   // Wanted module REMOVED 2026-07-19 — keep public so the
                   // dead URLs 404 instead of 307ing to sign-in (same
                   // precedent as /competitions).
  '/raffle(.*)',   // RETIRED 2026-08-26 with the PRO membership. Kept public
                   // so dead URLs 404 rather than 307ing to sign-in.
  '/brand(.*)',    // P5.7 — public brand index (/brands) + brand landing
                   // pages (/brand/[slug]); SEO surfaces, must be crawlable
                   // without auth (mirrors /category above).
  '/faq',          // public help/FAQ page
  '/how-selling-works', // public "how selling works" explainer (linked from sell flow)
  '/condition-guide', // public grading rubric — linked from the sell form and
                   // every listing's condition chip, and it is the definition
                   // buyers are held to, so it must be readable signed-out
                   // (and crawlable) rather than 307ing to sign-in.
  '/how-payments-work', // public "how payments work" explainer
  '/contact',      // public contact page
  '/support',      // public support page
  '/complaints',   // public complaints-handling page
  '/paia',         // public PAIA manual / access-to-information page
  '/regulated-categories', // public statutory schedule naming the particular
                   // legislation we keep regulated-category records under.
                   // MUST be reachable signed-out: POPIA s 18(1)(f) requires
                   // the data subject to be told the particular law, and PAIA
                   // s 51 requires the manual to be complete and free to ANY
                   // requester — a journalist, a regulator or a non-account
                   // holder cannot read the members-only annex. The page
                   // itself carries robots noindex/nofollow and is NOT in
                   // app/sitemap.ts, so it is reachable without being indexed.
  '/fees',         // public fees schedule
  '/sitemap.xml',  // SEO — must be crawlable without auth (.xml isn't
  '/robots.txt',   // excluded by the matcher, so it hits this middleware)
  '/.well-known/(.*)', // static well-known files (e.g. security.txt) — must
                       // be reachable without auth for crawlers/researchers
  '/security.txt', // security-contact file at the site root
  '/admin(.*)',   // admin uses its own JWT auth, not Clerk
  '/offline',     // PWA offline fallback — must be reachable without auth
                  // because the service worker serves it whenever the
                  // network is unreachable, including for signed-out users.
  '/sw.js',       // compiled service worker — must be reachable without
                  // Clerk's protect-rewrite interfering with the install.
  '/terms',              // legal pages — must be reachable from sign-up
  '/privacy',            // checkbox links (and from anywhere) without auth
  '/aml-policy',
  '/acceptable-use',
  '/refund-policy',
  // '/firearms-compliance' REMOVED — the Regulated Items Annex is
  // members-only now and lives at /members/regulated-items. The old path
  // still exists as a 308 for indexed/bookmarked links, but it is gated so
  // an anonymous follower lands on /sign-in rather than the document.
  '/cookies',
  '/legal',              // index of all legal docs + ECT § 43 disclosures
  '/a/(.*)',             // SMS-link action pages — token in the URL IS the
                         // auth credential. Each /a/<token> page resolves
                         // server-side via /api/actions/:token and shows a
                         // scoped UI for one single action. Never requires
                         // a Clerk session.
  '/coming-soon',        // pre-launch holding page
  '/preview',            // bypass-cookie setter for the coming-soon gate
  '/competitions(.*)',   // RETIRED route (feature removed). Kept public so
                         // dead / previously-indexed competition URLs serve a
                         // clean 404 instead of being 307-redirected to sign-in
                         // by Clerk.
  // RETIRED 2026-08-26 with their modules. Same precedent as /competitions:
  // public means a dead URL serves an honest 404 instead of a login form.
  '/subscribe',                          // PRO membership purchase path
  '/my/swaps',                           // Swop / Trade
  '/featured(.*)',                       // Featured homepage slots
  '/experiences-cancellation-policy',    // Hunting Packages legal page — note
                                         // this was NEVER in the matcher,
                                         // unlike every sibling legal page.
  '/load-lab(.*)',      // RETIRED 2026-09-02 — Load Lab was replaced by The
                        // Bench at /bench. Kept public so a bookmarked or
                        // indexed link 404s honestly rather than prompting a
                        // sign-in for a page that no longer exists.
  '/ask-gg(.*)',         // RETIRED 2026-08-26 — the Ask Boet assistant was
                         // removed. Same precedent as /competitions: the page
                         // was signed-in-only, so without this entry Clerk
                         // 307s the dead URL to sign-in and a signed-in user
                         // gets a 404 while a signed-out one gets a login
                         // form. Public = an honest 404 for both.
                         // NOTE: unrelated to the backend's /ask-gg API
                         // prefix, which is a different origin and still
                         // serves POST /ask-gg/identify-listing for the
                         // create-listing photo helper.
]);

// Routes that ALWAYS pass through the coming-soon gate, even without
// the preview cookie:
//   /a/*          — SMS-link recipients (token in URL = auth)
//   /api/*        — backend endpoints (must work for SMS flows + admin
//                   API; backend has its own guards)
//   /admin*       — admin uses separate JWT auth; the admin login screen
//                   must be reachable to grant bypass to the dashboard
//   /coming-soon  — the holding page itself (avoids rewrite loop)
//   /preview      — the cookie-setting route
const isComingSoonBypassRoute = createRouteMatcher([
  '/a/(.*)',
  '/api/(.*)',
  '/admin(.*)',
  '/coming-soon',
  '/preview',
]);

const COMING_SOON_COOKIE = 'gg-preview';

export default clerkMiddleware(async (auth, request) => {
  // ── No middleware-level admin auth gate ────────────────────────────
  //
  // Cookie-based gating proved unreliable across browsers (some configs
  // silently drop the admin session cookie regardless of attrs). Admin
  // pages are now client components that read a JWT from localStorage
  // via lib/admin-auth and bounce themselves to /admin/login if it's
  // missing. Middleware just gets out of the way.

  // ── Coming-soon gate (runs BEFORE Clerk auth) ─────────────────────
  //
  // Three conditions let a request through to the real site:
  //   1) Gate is off (COMING_SOON_GATE !== 'on')
  //   2) Path is always-allowed (SMS links, API, admin, etc.)
  //   3) Visitor has the bypass cookie matching the server secret
  //
  // SMS-link checkout (/checkout/...?t=<token>) is also always-allowed
  // because buyers paying via SMS link have no other auth.
  //
  // Otherwise: rewrite to /coming-soon. We use rewrite (not redirect)
  // so the URL the user typed stays in the address bar.
  if (process.env.COMING_SOON_GATE === 'on') {
    const url = request.nextUrl;
    // Token-authed pages (SMS one-tap): /checkout/*?t= and /kyc/verify?t=
    // are authorised by the action token in the URL, not Clerk — let them
    // through the coming-soon gate the same way.
    //
    // /checkout/complete is allowed UNCONDITIONALLY: it's where the
    // payment gateway redirects the buyer after paying, and that return
    // URL carries NO token or session (the txId rides back via
    // localStorage / the webhook). Gating it would swallow the
    // post-payment verification for any buyer without the preview
    // cookie. The page itself is harmless — it only calls the public,
    // amount-bound verify-result API.
    const isTokenAuthedPage =
      url.pathname === '/checkout/complete' ||
      ((url.pathname.startsWith('/checkout/') ||
        url.pathname === '/kyc/verify' ||
        // ⚠️ THE HANDOFF NEEDS BOTH LISTS. Public-route alone gets the phone
        // past Clerk and then straight into a rewrite to /coming-soon, which
        // reads as the QR code being broken. Same trap the KYC verify page
        // sat in.
        url.pathname === '/scan/handoff') &&
        url.searchParams.has('t'));
    const cookieVal = request.cookies.get(COMING_SOON_COOKIE)?.value;
    const hasBypassCookie =
      !!cookieVal &&
      !!process.env.COMING_SOON_BYPASS_SECRET &&
      cookieVal === process.env.COMING_SOON_BYPASS_SECRET;

    const allowed =
      isComingSoonBypassRoute(request) || isTokenAuthedPage || hasBypassCookie;

    if (!allowed) {
      const res = NextResponse.rewrite(new URL('/coming-soon', request.url));
      // M31 — prevent Googlebot indexing the coming-soon page as the
      // homepage. Without this, every gated route currently returns
      // 200 + content with no robots directive, so the search index
      // will record "Coming Soon" as the canonical site for every URL
      // — only repaired after a post-launch recrawl.
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return res;
    }
  }

  if (isPublicRoute(request)) return;

  // SMS-link token pages: /checkout/*?t= (buyer pays) and /kyc/verify?t=
  // (seller verifies identity) are auth'd by the action token, not Clerk.
  // The page + the backend's ClerkOrTokenGuard / KycOrTokenGuard handle
  // the token. We just bypass Clerk middleware here so an unauthenticated
  // tap-from-SMS doesn't get bounced to the sign-in page.
  //
  // /checkout/complete bypasses Clerk unconditionally: the payment
  // gateway redirects the buyer here with no token and possibly no
  // session (SMS-token buyers are never signed in; on iOS the return
  // can land in a separate browser context). Bouncing them to sign-in
  // would skip payment verification entirely. The page only calls the
  // public verify-result API, which binds on txId + amount server-side.
  if (
    request.nextUrl.pathname === '/checkout/complete' ||
    ((request.nextUrl.pathname.startsWith('/checkout/') ||
      request.nextUrl.pathname === '/kyc/verify') &&
      request.nextUrl.searchParams.has('t'))
  ) {
    return;
  }

  // Manual auth check + redirect — `auth.protect()` rewrites to a
  // Clerk handshake URL when the dev_browser cookie is missing, and
  // that URL has no page so users see a 404 instead of being sent to
  // sign-in. Doing the check ourselves and returning a real redirect
  // is the more reliable behaviour.
  const { userId } = await auth();
  if (!userId) {
    // Pin the redirect base to a CONFIGURED public URL rather than the
    // inbound Host header — a spoofed Host must never be able to turn this
    // sign-in bounce into an off-site (open) redirect. request.url reflects
    // the localhost socket Next.js listens on, not the public hostname, so we
    // can't use it either.
    const publicBase =
      process.env.NEXT_PUBLIC_APP_URL || 'https://gungalore.co.za';
    const currentPath =
      request.nextUrl.pathname + request.nextUrl.search;

    const signInUrl = new URL('/sign-in', publicBase);
    // Relative redirect target only — never embed a host (defence-in-depth
    // with the sign-in/sign-up forms, which also reject non-relative values).
    signInUrl.searchParams.set('redirect_url', currentPath);
    // MUST be NextResponse.redirect, NOT Response.redirect. A bare
    // Web-API Response.redirect() returns a response with an IMMUTABLE
    // headers guard; clerkMiddleware then tries to attach its
    // x-clerk-auth-* headers to it and throws `TypeError: immutable`,
    // which surfaces as a 500 Internal Server Error on every protected
    // route for signed-out visitors (e.g. tapping Ask GG after the
    // Clerk session lapses). NextResponse.redirect returns mutable
    // headers so Clerk can decorate the response cleanly.
    return NextResponse.redirect(signInUrl);
  }
});

// ⚠️ wasm AND ort ARE IN THE EXCLUSION LIST FOR A REASON. Without them the
// on-device model's runtime and weights go through Clerk's middleware, which
// 307s an unauthenticated request to sign-in. ORT then receives an HTML
// redirect body where it expected a binary and fails with
// "expected magic word 00 61 73 6d, found 3c 21 44 4f" — that is `<!DO`, the
// first bytes of the sign-in page. Both phones reported the detector as
// unavailable and it read as a broken model rather than as a 307.
//
// Any future binary asset served from public/ needs its extension here too.
//
// ⚠️ AND mjs, SINCE ORT WEB 1.19+. The runtime no longer ships a plain
// .wasm: it loads `ort-wasm-simd-threaded.mjs` from wasmPaths first and that
// glue fetches the .wasm. `js(?!on)` does not match `.mjs` — the alternation
// must start right after the dot — so without `mjs` here the glue is 307'd
// to sign-in on a signed-out phone (the handoff page), and the model fails
// with a JavaScript syntax error on `<!DOCTYPE` instead of the magic-word
// message above. Same trap, one extension over.
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|m?js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest|wasm|ort)).*)',
    '/(api|trpc)(.*)',
  ],
};
