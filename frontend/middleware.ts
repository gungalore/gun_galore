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
  '/ballistics(.*)', // standalone PAID Ballistic Calculator PWA. Demo mode
                     // (locked profile, 200 m range cap, 1 demo bullet
                     // lookup) is reachable signed-out; purchase + saving
                     // profiles require a Clerk session, gated at the API
                     // layer, not the route layer.
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

// Hostname for the standalone PAID Ballistic Calculator PWA. Set at
// the DNS + nginx layer to point at the same Next.js process as the
// marketplace; middleware detects it and rewrites '/' to '/ballistics'
// so the subdomain root lands on the calculator landing page instead
// of the marketplace homepage. Same codebase, same deploy, but a
// completely separate product surface.
const BALLISTICS_HOST = 'ballistics.gungalore.co.za';

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
  // ── Subdomain rewrite: ballistics.gungalore.co.za ──────────────────
  //
  // The standalone Ballistic Calculator PWA lives at /ballistics in
  // the same Next.js process as the marketplace. We detect the host
  // and (a) rewrite '/' to '/ballistics' so the subdomain root lands
  // on the calculator's landing page, (b) tag every request with
  // an x-ballistics-host header so server components can switch on it
  // to render the ballistics-only chrome (no marketplace nav, no
  // bottom tab bar, scoped instrument palette). Subpaths under
  // /ballistics on the marketplace domain still work — same routes,
  // just exposed under both hosts for backwards compatibility.
  const hostHeader = request.headers.get('host') ?? '';
  const isBallisticsHost = hostHeader.split(':')[0] === BALLISTICS_HOST;
  if (isBallisticsHost) {
    // Rewrite the subdomain root to /ballistics.
    if (
      request.nextUrl.pathname === '/' ||
      request.nextUrl.pathname === ''
    ) {
      const rewritten = request.nextUrl.clone();
      rewritten.pathname = '/ballistics';
      const res = NextResponse.rewrite(rewritten);
      res.headers.set('x-ballistics-host', '1');
      return res;
    }
    // Any other path under the ballistics subdomain that ISN'T already
    // under /ballistics is rewritten in too (so signed-in users can hit
    // /sign-in on the subdomain and stay there).
    if (
      !request.nextUrl.pathname.startsWith('/ballistics') &&
      !request.nextUrl.pathname.startsWith('/api') &&
      !request.nextUrl.pathname.startsWith('/sign-in') &&
      !request.nextUrl.pathname.startsWith('/sign-up') &&
      !request.nextUrl.pathname.startsWith('/sso-callback') &&
      !request.nextUrl.pathname.startsWith('/_next') &&
      !request.nextUrl.pathname.startsWith('/sw.js') &&
      !request.nextUrl.pathname.startsWith('/offline')
    ) {
      const rewritten = request.nextUrl.clone();
      rewritten.pathname = `/ballistics${rewritten.pathname}`;
      const res = NextResponse.rewrite(rewritten);
      res.headers.set('x-ballistics-host', '1');
      return res;
    }
    // Pass through but tag the header so layout knows the shell.
    const res = NextResponse.next();
    res.headers.set('x-ballistics-host', '1');
    // Don't return here — Clerk middleware below still needs to run.
  }

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
    const isCheckoutWithToken =
      url.pathname.startsWith('/checkout/') && url.searchParams.has('t');
    const cookieVal = request.cookies.get(COMING_SOON_COOKIE)?.value;
    const hasBypassCookie =
      !!cookieVal &&
      !!process.env.COMING_SOON_BYPASS_SECRET &&
      cookieVal === process.env.COMING_SOON_BYPASS_SECRET;

    // The ballistics subdomain is its own product launch surface — it
    // ships independent of the marketplace coming-soon gate. If somebody
    // hits ballistics.gungalore.co.za while the gate is still ON for
    // the marketplace, they should see the calculator landing, not the
    // marketplace holding page.
    const allowed =
      isComingSoonBypassRoute(request) ||
      isCheckoutWithToken ||
      hasBypassCookie ||
      isBallisticsHost;

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
