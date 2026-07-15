import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)', // OAuth (Google) redirect target — finishes the flow client-side
  '/marketplace(.*)',
  '/listings(.*)',
  '/auctions(.*)',
  '/about(.*)',
  '/buy-and-sell(.*)',
  '/welcome(.*)',
  '/sellers(.*)', // public seller profiles
  '/category(.*)', // public category landing/browse pages
  '/wanted(.*)',   // Wanted board — public browse/detail (SEO + anonymous
                   // browsing like /listings); posting/responding is gated
                   // in-page + server-side on the API.
  '/brand(.*)',    // P5.7 — public brand index (/brands) + brand landing
                   // pages (/brand/[slug]); SEO surfaces, must be crawlable
                   // without auth (mirrors /category above).
  '/faq',          // public help/FAQ page
  '/how-selling-works', // public "how selling works" explainer (linked from sell flow)
  '/sitemap.xml',  // SEO — must be crawlable without auth (.xml isn't
  '/robots.txt',   // excluded by the matcher, so it hits this middleware)
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
  '/firearms-compliance',
  '/cookies',
  '/legal',              // index of all legal docs + ECT § 43 disclosures
  '/a/(.*)',             // SMS-link action pages — token in the URL IS the
                         // auth credential. Each /a/<token> page resolves
                         // server-side via /api/actions/:token and shows a
                         // scoped UI for one single action. Never requires
                         // a Clerk session.
  '/coming-soon',        // pre-launch holding page
  '/preview',            // bypass-cookie setter for the coming-soon gate
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
        url.pathname === '/kyc/verify') &&
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
    // Build the redirect URL from forwarded headers so we send the
    // user to https://gungalore.co.za/sign-in, not localhost:3000/sign-in.
    // request.url reflects the localhost socket Next.js is listening on,
    // not the public hostname that nginx is proxying for.
    const host = request.headers.get('host') || 'gungalore.co.za';
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const publicBase = `${proto}://${host}`;
    const currentPath =
      request.nextUrl.pathname + request.nextUrl.search;

    const signInUrl = new URL('/sign-in', publicBase);
    signInUrl.searchParams.set(
      'redirect_url',
      `${publicBase}${currentPath}`,
    );
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

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
