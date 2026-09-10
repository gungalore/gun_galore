/**
 * Route matching for `middleware.ts`.
 *
 * ⚠️ THIS IS THE HIGHEST-RISK LOGIC IN THE AUTH CHANGE, which is why it lives
 * here with a spec rather than inline in the middleware. The ~90-entry public
 * route list it feeds decides which pages a signed-out visitor can see, and
 * Meta restricted this site twice over regulated goods being publicly
 * reachable. A pattern that matches too little 307s a public page to sign-in
 * and someone notices within the hour; a pattern that matches too much makes a
 * members-only page public and nobody notices at all.
 *
 * The semantics deliberately reproduce Clerk's `createRouteMatcher`, because
 * every pattern in that list was authored against it:
 *
 *   - `(.*)` is the only wildcard, and matches anything including nothing.
 *   - Every other character is LITERAL. `.` matches a dot, not any character —
 *     without that, `/sw.js` would also make `/swXjs` public.
 *   - Matching is against the pathname only, anchored at both ends.
 */
export function routeMatcher(patterns: string[]): (pathname: string) => boolean {
  const res = patterns.map(
    (p) =>
      new RegExp(
        '^' +
          p
            // Escape EVERYTHING regex-significant, wildcards included...
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            // ...then put back the one construct the patterns use.
            .replace(/\\\(\\\.\\\*\\\)/g, '(.*)') +
          '$',
      ),
  );
  return (pathname: string) => res.some((re) => re.test(pathname));
}
