import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

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
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  // Manual auth check + redirect — `auth.protect()` rewrites to a
  // Clerk handshake URL when the dev_browser cookie is missing, and
  // that URL has no page so users see a 404 instead of being sent to
  // sign-in. Doing the check ourselves and returning a real redirect
  // is the more reliable behaviour.
  const { userId } = await auth();
  if (!userId) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('redirect_url', request.url);
    return Response.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
