/**
 * WHICH REQUESTS THE SERVICE WORKER MAY NEVER CACHE — and what to throw away
 * when a member signs out.
 *
 * 🚨 THIS FILE IS COMPILED INTO THE SERVICE WORKER (app/sw.ts imports it) AND
 * INTO THE BROWSER (lib/auth.tsx calls the sign-out purge). So it may touch
 * nothing that only exists in a window at module scope: no `document`, no
 * `localStorage`, no `next/*`. The one browser global it reads, `caches`, is
 * read inside a function and guarded.
 *
 * ⚠️ NOTHING UNDER app/ IS COLLECTED BY VITEST. `include` is
 * ['lib/**\/*.spec.ts', 'components/**\/*.spec.tsx'] — a rule written inside
 * app/sw.ts can never be tested, which is why the decidable parts of the
 * worker's cache policy live here. See lib/sw-caching.spec.ts.
 *
 * ─── THE FAILURE THIS PREVENTS ───────────────────────────────────────────
 *
 * `${origin}/account` is the same URL whether it is rendering YOUR account or
 * a signed-out "please sign in" bounce. A URL-keyed cache cannot tell those
 * apart. serwist's defaultCache ends with a generic same-origin NetworkFirst
 * rule that matches documents, so the OLD worker cached member HTML for 24h
 * and replayed it to the next person who opened the installed app on that
 * device — including somebody who had just signed out. There is no way to make
 * that cache "correct" by response header: Cache-Control is advisory to
 * NetworkFirst, and the worker never asked.
 *
 * The rule is therefore blunt and absolute: documents, and every route that
 * can contain a member's own data or a single-use credential, go to the network
 * and nothing else. A failed navigation still gets the /offline stand-in
 * (lib/sw-offline.ts) — that is a synthetic page, not a cached one.
 */

import type {
  RouteMatchCallbackOptions,
  RuntimeCaching,
} from 'serwist';
import { routeGate } from './route-gate';

/** The shape this module needs off a request, so a spec can pass plain data. */
export interface RequestShape {
  mode?: string;
  destination?: string;
  pathname: string;
}

/**
 * Paths that must never be cached but are NOT classified member-only by
 * lib/route-gate.ts.
 *
 * Two different reasons wear this list:
 *
 *   • `/gate` — the age declaration is per-device state held in a cookie. A
 *     cached copy of the page is harmless in itself, but it is the one document
 *     every undeclared visitor sees, and serving yesterday's copy of it after a
 *     text change is a bug with no upside.
 *   • `/sign-in`, `/sign-up`, the auth routes — a cached sign-in page posts to
 *     a session that has moved on, and a cached verify page shows a code entry
 *     for an account already created. app/sw.ts names these too, for the
 *     "never serve offline" half of the same decision.
 *   • `/kyc`, `/checkout` — money and identity. route-gate already calls both
 *     member-only; they are named here because this list is read WITHOUT a
 *     session, and an over-broad exemption shipped accidentally would be a
 *     silent leak rather than a visible bounce.
 *   • token-bearing pages — `/a`, `/t`, `/v`, `/witness`, `/consent`,
 *     `/dealer-portal`, `/licence-centre/print/book`, `/scan`. The token in the
 *     URL IS the credential; a cached response can be handed to a second
 *     person on the same device (or rerun by the same person after it was
 *     consumed), which is the whole point of a single-use link.
 *
 * ⚠️ `/offline` IS DELIBERATELY ABSENT, and must stay absent: it is precached
 * so a failed navigation has something to render when there is no network.
 * Serving a cached page is exactly wrong for the list above and exactly right
 * for this one entry.
 */
const PRIVATE_PATH_PREFIXES = [
  '/gate',
  '/kyc',
  '/checkout',
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/a',
  '/t',
  '/v',
  '/witness',
  '/consent',
  '/dealer-portal',
  '/licence-centre/print/book',
  '/scan',
  '/api',
] as const;

/** Exact or slash-delimited prefix — never a bare `startsWith`. */
function onPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Is this request a document navigation?
 *
 * `mode === 'navigate'` is the spec's signal for a top-level navigation;
 * `destination === 'document'` is the second half because a few engines omit
 * one or the other on a request that was reconstructed by the fetch pipeline.
 */
export function isDocumentRequest(request: {
  mode?: string;
  destination?: string;
}): boolean {
  return request.mode === 'navigate' || request.destination === 'document';
}

/**
 * Can this pathname contain a member's own data, or a single-use credential?
 *
 * The member-only list comes from lib/route-gate.ts so there is ONE table of
 * private routes in the repo: adding a member surface there automatically
 * makes it uncacheable here. The extra entries are the paths that route-gate
 * classifies as gate-exempt or content but the cache still must not touch
 * (auth, money, tokens) — see PRIVATE_PATH_PREFIXES.
 */
export function isPrivatePath(pathname: string): boolean {
  const path = pathname || '/';
  if (routeGate(path) === 'member-only') return true;
  return PRIVATE_PATH_PREFIXES.some((prefix) => onPath(path, prefix));
}

/** The single predicate both runtime rules and the matcher wrapper use. */
export function mustAlwaysUseNetwork(request: RequestShape): boolean {
  return isDocumentRequest(request) || isPrivatePath(request.pathname);
}

function matcherMatches(
  matcher: RuntimeCaching['matcher'],
  options: RouteMatchCallbackOptions,
): boolean {
  if (matcher instanceof RegExp) return matcher.test(options.url.href);
  if (typeof matcher === 'string') return matcher === options.url.href;
  return Boolean(matcher(options));
}

/**
 * Wraps every serwist runtime-cache matcher so none of them can match a
 * document or a private path — even if the rule list is ever reordered, or a
 * later serwist default grows a matcher nobody anticipated.
 *
 * ⚠️ WHY WRAP RATHER THAN DELETE THE DANGEROUS DEFAULT ENTRIES. serwist 9's
 * `defaultCache` is a plain array (this version's API has no options object;
 * `pageCaptures`/`runtimeCaching` overrides are not available here), and the
 * entries carry no public cache-name field to filter on. Matching on the
 * shipped matcher code in a spec would be brittle; wrapping the matcher makes
 * the invariant unconditional and is what lib/sw-caching.spec.ts pins.
 *
 * The first NetworkOnly rule in app/sw.ts already catches documents, so this
 * is defence in depth: it holds even for a request the first rule does not
 * recognise, and it means `defaultCache`'s generic same-origin NetworkFirst
 * (cache `others`) can never be the thing that stored member HTML.
 */
export function excludeUncacheableRequests(
  entries: RuntimeCaching[],
): RuntimeCaching[] {
  return entries.map((entry) => ({
    ...entry,
    matcher: (options: RouteMatchCallbackOptions) =>
      !mustAlwaysUseNetwork({
        mode: options.request.mode,
        destination: options.request.destination,
        pathname: options.url.pathname,
      }) && matcherMatches(entry.matcher, options),
  }));
}

/**
 * The runtime caches that can hold page data, by the cache-name segment the
 * serwist strategies are given.
 *
 * serwist names a cache `<prefix>-<name>-<scope>` (`serwist-pages-https://…`),
 * so the segment match below covers every deployment scope. The precache is
 * deliberately excluded: it holds the app shell and /offline, and deleting it
 * on sign-out would leave the installed app unable to render anything offline
 * until the next deploy.
 */
const PRIVATE_CACHE_SEGMENTS = [
  'pages-rsc-prefetch',
  'pages-rsc',
  'pages',
  'others',
  'apis',
  'next-data',
  'static-data-assets',
  'cross-origin',
] as const;

/**
 * Which Cache Storage names to delete when a member signs out.
 *
 * ⚠️ THIS IS THE SECOND HALF OF THE FIX, NOT A TIDY-UP. The worker no longer
 * caches documents, but caches written by an OLDER deployed worker (or by the
 * pre-fix code) are still on the device. A member who signs out on a shared
 * phone must not leave yesterday's `/account` — or a page-data RSC payload that
 * names their orders — for the next person. Purging is best-effort and must
 * never block the sign-out itself.
 */
export function cacheNamesToPurgeOnSignOut(
  names: readonly string[],
): string[] {
  return names.filter((name) => {
    // The offline precache is not private and must survive.
    if (name.includes('-precache-')) return false;
    return PRIVATE_CACHE_SEGMENTS.some(
      (segment) =>
        name.includes(`-${segment}-`) || name.endsWith(`-${segment}`),
    );
  });
}

/**
 * Delete the private runtime caches, if this browser has Cache Storage.
 *
 * Always resolves: a private-mode/denied-CacheStorage browser has no caches to
 * purge, and a failed purge must not stop the member signing out.
 */
export async function purgePrivateServiceWorkerCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const doomed = cacheNamesToPurgeOnSignOut(await caches.keys());
    await Promise.all(doomed.map((name) => caches.delete(name)));
  } catch {
    /* Cache Storage unavailable — there is nothing the worker could have kept. */
  }
}
