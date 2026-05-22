import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)', // OAuth (Google) redirect target — finishes the flow client-side
  '/marketplace(.*)',
  '/listings(.*)',
  '/competitions(.*)',
  '/auctions(.*)',
  '/about(.*)',
  '/buy-and-sell(.*)',
  '/welcome(.*)',
  '/sellers(.*)', // public seller profiles
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
    const isCheckoutWithToken =
      url.pathname.startsWith('/checkout/') && url.searchParams.has('t');
    const cookieVal = request.cookies.get(COMING_SOON_COOKIE)?.value;
    const hasBypassCookie =
      !!cookieVal &&
      !!process.env.COMING_SOON_BYPASS_SECRET &&
      cookieVal === process.env.COMING_SOON_BYPASS_SECRET;

    const allowed =
      isComingSoonBypassRoute(request) || isCheckoutWithToken || hasBypassCookie;

    if (!allowed) {
      return NextResponse.rewrite(new URL('/coming-soon', request.url));
    }
  }

  if (isPublicRoute(request)) return;

  // SMS-link checkout: /checkout/* requests carrying ?t=<token> are
  // auth'd by the action token, not Clerk. The page + the
  // backend's ClerkOrTokenGuard handle the token. We just need to
  // bypass Clerk middleware here so an unauthenticated tap-from-SMS
  // doesn't get bounced to the sign-in page.
  if (
    request.nextUrl.pathname.startsWith('/checkout/') &&
    request.nextUrl.searchParams.has('t')
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
    return Response.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
