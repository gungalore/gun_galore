/**
 * Google Analytics 4 — measurement-ID gating helpers.
 *
 * The measurement ID is read from the SERVER environment (`GA_MEASUREMENT_ID`,
 * deliberately not a NEXT_PUBLIC_ variable so the property can be switched or
 * added later by editing the production env and restarting the frontend,
 * without a rebuild). Everything stays inert when the variable is absent or
 * still a placeholder, which is what lets the deploy land before the GA
 * property exists.
 */

/** True for a value that looks like a GA4 web-stream id (G-XXXXXXXXXX). */
export function isGaMeasurementId(value: string | undefined | null): boolean {
  return typeof value === 'string' && /^G-[A-Z0-9]{6,20}$/.test(value.trim());
}

/**
 * Should this pathname send a GA page_view?
 *
 * The Desk (`/admin`) is internal operator tooling and is excluded on purpose;
 * SMS action links (`/a/<token>`) are excluded because the token in the URL is
 * a credential and must never be shipped to a third party; API routes are not
 * page views. Everything else on the public site is tracked (the site itself
 * sits behind the 18+ gate, so the only pre-gate page a visitor can see is
 * `/gate`).
 */
export function shouldTrackGaPage(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (!pathname.startsWith('/')) return false;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  if (pathname === '/a' || pathname.startsWith('/a/')) return false;
  if (pathname.startsWith('/api/')) return false;
  return true;
}
