import { NextResponse, type NextRequest } from 'next/server';
// ⚠️ THE NARROW SUBPATH, NOT 'jose'. The package index pulls in the JWE
// decrypt path, which reaches for CompressionStream — a Node API the Edge
// runtime does not have — and every build printed two warnings about code we
// never call. We verify a JWS; this is the only entry point we need.
import { jwtVerify } from 'jose/jwt/verify';
import { routeMatcher } from './lib/route-matcher';
import { isSessionFreeKycLanding } from './lib/kyc-return';
import { routeGate } from './lib/route-gate';

// ─────────────────────────────────────────────────────────────────────
// THE 18+ GATE (2026-11). Read lib/route-gate.ts first.
//
// Content is no longer split into "public storefront" and "members-only".
// Every content page sits behind a one-tap age declaration; a signed-in
// account is required only for actions (buy/bid/motivate) and private data.
// A declared visitor and a member see the same catalogue.
//
// This middleware is the UX half: un-declared visitors are redirected to
// /gate. The BACKEND is the enforcement half — ContentAccessGuard 404s any
// content API call from a caller carrying neither a session nor a valid
// declaration. Neither half branches on user-agent.
// ─────────────────────────────────────────────────────────────────────

const createRouteMatcher = (patterns: string[]) => {
  const match = routeMatcher(patterns);
  return (req: NextRequest) => match(req.nextUrl.pathname);
};

/** Must match ACCESS_COOKIE / REFRESH_COOKIE in the backend. */
const ACCESS_COOKIE = 'ao_at';
const REFRESH_COOKIE = 'ao_rt';
/** Must match CATALOGUE_COOKIE in backend/src/auth/catalogue-access.ts. */
const CATALOGUE_COOKIE = 'ao_cat';
/** Must match CATALOGUE_AUDIENCE + the purpose claim there. */
const CATALOGUE_AUDIENCE = 'catalogue-gate';

let cachedKey: Uint8Array | null = null;
function memberSecret(): Uint8Array {
  if (!cachedKey) {
    cachedKey = new TextEncoder().encode(
      process.env.JWT_MEMBER_SECRET ??
        'dev-only-member-secret-NOT-for-production',
    );
  }
  return cachedKey;
}

/**
 * Is there a signed-in member behind this request?
 *
 * ⚠️ THIS IS A RENDER DECISION, NOT THE GATE. The backend re-verifies on every
 * API call and decides what data comes back; this only decides whether to show
 * a page or bounce to sign-in. That is why an EXPIRED access token with a
 * refresh cookie still counts: the access token lives fifteen minutes, and
 * bouncing a member to sign-in every quarter of an hour — when their session
 * is perfectly good and the client is about to refresh it — would be a bug
 * nobody could reproduce on a fresh login.
 *
 * A forged refresh cookie buys nothing: the page renders, every API call 401s,
 * and the public/members split is enforced server-side regardless.
 */
async function hasSession(request: NextRequest): Promise<boolean> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    try {
      await jwtVerify(access, memberSecret());
      return true;
    } catch {
      // Expired or malformed — fall through to the refresh cookie.
    }
  }
  return !!request.cookies.get(REFRESH_COOKIE)?.value;
}

/**
 * Did this visitor accept the 18+ gate?
 *
 * ⚠️ THIS COOKIE IS NOT A SESSION and must never be treated as one. The token
 * carries no `sub`; the backend verifies the same audience/purpose before it
 * lets the declaration open anything. A tampered or expired declaration is
 * simply "not declared" — the visitor sees the gate, never a 401.
 */
async function hasCatalogueDeclaration(request: NextRequest): Promise<boolean> {
  const value = request.cookies.get(CATALOGUE_COOKIE)?.value;
  if (!value) return false;
  try {
    const { payload } = await jwtVerify(value, memberSecret(), {
      audience: CATALOGUE_AUDIENCE,
    });
    return payload.purpose === CATALOGUE_AUDIENCE && payload.v === 1;
  } catch {
    return false;
  }
}

/**
 * The origin a redirect is built on.
 *
 * Pinned to NEXT_PUBLIC_APP_URL, never the inbound Host header, so a spoofed
 * Host cannot turn the gate/sign-in bounce into an open redirect. Local
 * development falls back to the browser's own host so a stale tunnel hostname
 * in .env doesn't break local flows.
 */
function publicBase(request: NextRequest): string {
  const configuredBase =
    process.env.NEXT_PUBLIC_APP_URL || 'https://alloutdoor.co.za';
  const host = request.headers.get('host') ?? '';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return process.env.NODE_ENV !== 'production' && isLocalHost
    ? `http://${host}`
    : configuredBase;
}

/** A relative, same-origin next target — never an open redirect. */
function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.length > 2000) return '/';
  return value;
}

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
  '/licence-centre/print/book/(.*)',
  '/api/(.*)',
  '/admin(.*)',
  '/coming-soon',
  '/preview',
]);

const COMING_SOON_COOKIE = 'gg-preview';

export default async function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // ── Coming-soon gate (runs BEFORE the age gate) ───────────────────
  //
  // Unchanged from before: when COMING_SOON_GATE=on, everything except the
  // always-allowed routes and token-authed pages is rewritten to
  // /coming-soon with X-Robots-Tag: noindex. The preview cookie bypasses.
  if (process.env.COMING_SOON_GATE === 'on') {
    const isTokenAuthedPage =
      url.pathname === '/checkout/complete' ||
      isSessionFreeKycLanding(url.pathname, url.searchParams) ||
      ((url.pathname.startsWith('/checkout/') ||
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
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return res;
    }
  }

  // ── Credential flows bypass BOTH walls ─────────────────────────────
  //
  // /checkout/complete — the gateway return URL, no token and possibly no
  // session (SMS-token buyers; iOS can return in a different browser context).
  // /kyc/verify?returned=1 — Didit's return landing, also session-free.
  // /checkout/<id>?t=<token> — the SMS pay link; the token is the credential.
  // Bouncing any of these to the gate or to sign-in dead-ends the flow.
  if (
    url.pathname === '/checkout/complete' ||
    isSessionFreeKycLanding(url.pathname, url.searchParams) ||
    (url.pathname.startsWith('/checkout/') && url.searchParams.has('t'))
  ) {
    return;
  }

  const kind = routeGate(url.pathname);
  if (kind === 'gate-exempt') return;

  const session = await hasSession(request);

  if (kind === 'member-only') {
    if (session) return;
    // A declared visitor is NOT signed in. Private data and actions need the
    // account, so send them straight to sign-in with a return path — the same
    // behaviour as before the gate existed.
    const signInUrl = new URL('/sign-in', publicBase(request));
    const currentPath = url.pathname + url.search;
    signInUrl.searchParams.set('redirect_url', currentPath);
    return NextResponse.redirect(signInUrl);
  }

  // ── Content ───────────────────────────────────────────────────────
  if (session) return;
  if (await hasCatalogueDeclaration(request)) return;

  // Neither a member nor a declared 18+ visitor. The URL is preserved so the
  // gate page can send them straight to what they clicked after accepting.
  const next = safeNextPath(url.pathname + url.search);
  const gateUrl = new URL('/gate', publicBase(request));
  gateUrl.searchParams.set('next', next);
  return NextResponse.redirect(gateUrl);
}

// ⚠️ wasm AND ort ARE IN THE EXCLUSION LIST FOR A REASON. Without them the
// on-device model's runtime and weights go through this middleware, which 307s
// an unauthenticated request to sign-in. ORT then receives an HTML redirect
// body where it expected a binary and fails with "expected magic word 00 61 73
// 6d, found 3c 21 44 4f" — that is `<!DO`, the first bytes of the sign-in page.
// Both phones reported the detector as unavailable and it read as a broken
// model rather than as a 307.
//
// Any future binary asset served from public/ needs its extension here too.
//
// ⚠️ AND mjs, SINCE ORT WEB 1.19+. The runtime no longer ships a plain .wasm:
// it loads `ort-wasm-simd-threaded.mjs` from wasmPaths first and that glue
// fetches the .wasm. `js(?!on)` does not match `.mjs` — the alternation must
// start right after the dot — so without `mjs` here the glue is 307'd to
// sign-in on a signed-out phone (the handoff page), and the model fails with a
// JavaScript syntax error on `<!DOCTYPE` instead of the magic-word message.
// Same trap, one extension over.
// ⚠️ AND onnx, FOR THE NEW SCANNER (2026-09-06).
// ⚠️ AND mp4/webm, FOR THE HERO VIDEO (2026-10-29).
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|m?js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest|mp4|webm|wasm|ort|onnx)).*)',
    '/(api|trpc)(.*)',
  ],
};
