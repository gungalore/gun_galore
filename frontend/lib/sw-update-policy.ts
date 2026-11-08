// Which routes may take an automatic service-worker update while the tab is
// hidden.
//
// ── WHY THIS LIST EXISTS ───────────────────────────────────────────────────
// The worker ships with `skipWaiting: false` (app/sw.ts) so a new build parks
// instead of seizing an open page: the old page would then ask for a chunk the
// new build replaced and get a 404 — a dead shell in an installed PWA.
//
// The banner already lets the user choose the moment. This module lets the PAGE
// choose a safe moment on its own: when the tab goes to the background, nobody
// is reading it, so activating the parked worker and reloading costs nothing —
// unless the page is holding work that a reload would destroy.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
// Default ALLOW. Only routes that hold unsaved or in-flight state are listed
// here, because a new form route that is missed would only mean "the banner
// shows again", while an allow-list would silently stop auto-applying the day
// someone adds a route and forgets to register it.
//
// ⚠️ ADD A ROUTE HERE WHEN IT GAINS A FORM. The cost of forgetting is a seller
// losing a half-typed listing because they checked WhatsApp and came back to a
// reloaded page. That is the one failure mode this whole feature must not have.
//
// ⚠️ AND IT IS NOT ONLY "FORMS". /scan is a live camera pipeline, /checkout is
// a payment redirect, /a and /witness hold one-time action tokens whose pages
// are completed by a tap. A reload mid-flow there is not cosmetic.

/**
 * Path prefixes where a background reload would discard work in progress.
 * Matched against `usePathname()`, which never carries a query or hash.
 */
const DENY_PATTERNS: readonly RegExp[] = [
  // Money: a hosted-gateway redirect or a payment step in flight.
  /^\/checkout(?:\/|$)/,

  // The sell form. The draft survives (it is persisted), but the photo
  // selection and the field the seller is mid-way through do not.
  /^\/listings\/new(?:\/|$)/,
  /^\/listings\/[^/]+\/edit(?:\/|$)/,

  // Licence Centre wizard — autosaves a draft, but a reload costs the step.
  /^\/licence-centre(?:\/|$)/,

  // Valuations.
  /^\/value(?:\/|$)/,

  // Document scanner: camera stream, capture buffer and enhancement pass.
  /^\/scan(?:\/|$)/,

  // Auth — a one-time code half-typed.
  /^\/sign-in(?:\/|$)/,
  /^\/sign-up(?:\/|$)/,
  /^\/verify-email(?:\/|$)/,
  /^\/verify-phone(?:\/|$)/,
  /^\/forgot-password(?:\/|$)/,
  /^\/reset-password(?:\/|$)/,

  // One-time token pages that are COMPLETED by a tap on them: the seller's
  // accept/decline reason, the witness signature, the token-gated view.
  /^\/a\/[^/]+/,
  /^\/witness\/[^/]+/,
  /^\/v\/[^/]+/,

  // Consent + identity hand-off.
  /^\/consent(?:\/|$)/,
  /^\/kyc(?:\/|$)/,

  // The operator's own long-lived surface.
  /^\/admin(?:\/|$)/,

  // Composers and settings forms.
  /^\/messages(?:\/|$)/,
  /^\/settings(?:\/|$)/,
  /^\/profile(?:\/|$)/,
  /^\/account(?:\/|$)/,
  /^\/report-a-bug(?:\/|$)/,
  /^\/dealer-portal(?:\/|$)/,
  /^\/documents(?:\/|$)/,

  // A draft listing preview — the seller is reviewing unsaved input.
  /^\/preview(?:\/|$)/,
];

/**
 * True when a background reload on this path cannot destroy unsaved work.
 *
 * Unknown paths are safe by default (see the module header). A `pathname` that
 * is missing or malformed is ALSO treated as unsafe — that only happens in a
 * non-browser context, and refusing to auto-reload is always the safe answer.
 */
export function isAutoApplySafePath(pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  // `usePathname()` never carries a query or hash, but this function is also
  // called with whatever a caller has; strip them so `/listings/new?step=2`
  // is denied by the same rule as `/listings/new`.
  const path = pathname.split(/[?#]/, 1)[0];
  return !DENY_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * How recently an input event makes a background reload unsafe.
 *
 * A route can be perfectly safe and the user still be mid-sentence: the offer
 * panel on a listing, a question, a search refinement. This is the cheap
 * second net — if anything received keyboard input in the last half-minute, the
 * hide is skipped and the next one (or the banner) applies the update instead.
 */
export const RECENT_INPUT_MS = 30_000;

/** True when the last input event is recent enough to block an auto-reload. */
export function typedRecently(
  lastInputAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (typeof lastInputAt !== 'number' || !Number.isFinite(lastInputAt)) {
    return false;
  }
  const age = now - lastInputAt;
  // A timestamp in the future (clock change, bad test) must not block forever.
  return age >= 0 && age < RECENT_INPUT_MS;
}

/**
 * The whole decision, in one pure predicate so it can be tested without a
 * service worker, a DOM or a browser.
 *
 * Every clause is a reason NOT to reload somebody's page behind their back:
 *   • already applied     — the SKIP_WAITING post is latched; do it once.
 *   • not hidden          — the member is looking at the page.
 *   • unsafe route        — see DENY_PATTERNS.
 *   • recent input        — they may be mid-sentence even on a safe route.
 */
export function shouldAutoApplyOnHide(input: {
  pathname: string | null | undefined;
  visibility: string;
  lastInputAt: number | null | undefined;
  alreadyApplied: boolean;
  now?: number;
}): boolean {
  if (input.alreadyApplied) return false;
  if (input.visibility !== 'hidden') return false;
  if (!isAutoApplySafePath(input.pathname)) return false;
  if (typedRecently(input.lastInputAt, input.now ?? Date.now())) return false;
  return true;
}
