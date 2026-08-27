import { safeJson } from './safe-json';

// ─── /users/me client ────────────────────────────────────────────────
//
// The first shared client for the /users/me routes. Everything on
// app/settings/page.tsx still goes through that page's own `authed()`
// helper; only the account-closure calls live here, because they are the
// two calls in the app where getting the response shape wrong is
// destructive rather than cosmetic.
//
// Same four properties as licence-centre-api.ts, for the same reasons:
// the token is fetched INSIDE request() so a long session never sends an
// expired one, every body goes through safeJson, errors carry their
// status, and the caller gets a typed error rather than a string.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type TokenGetter = () => Promise<string | null>;

export class UsersApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ─── Closure reasons ─────────────────────────────────────────────────

/**
 * The ticklist from the build plan §5.2. A code goes on the wire, the
 * label stays here.
 *
 * ⚠️ THIS LIST MUST MIRROR THE BACKEND'S ACCEPTED SET EXACTLY. The same
 * trap already bit the offer-reject ticklist: the frontend grew a reason
 * the server did not know and every submit came back 400 with a
 * validation message the member could do nothing about. If a code is
 * added on either side it is added on both, in the same commit.
 *
 * ⚠️ NO FREE-TEXT BOX, AND "Other" DOES NOT OPEN ONE. AccountClosure.reason
 * is part of an accountability record that admins and, eventually, a
 * law-enforcement request will read. A typed sentence there is
 * unstructured, unsearchable, and an invitation to put personal details
 * or an accusation about another member into a row nobody moderates.
 */
export const ACCOUNT_CLOSURE_REASONS = [
  ['NOT_USING', 'I am not using All Outdoor'],
  ['DID_NOT_FIND', 'I did not find what I was looking for'],
  ['BAD_EXPERIENCE', 'I had a bad experience'],
  ['PRIVACY', 'I am worried about my privacy'],
  ['DIFFERENT_ACCOUNT', 'I am opening a different account'],
  ['OTHER', 'Other'],
] as const;

export type AccountClosureReason = (typeof ACCOUNT_CLOSURE_REASONS)[number][0];

/** Is this a reason the ticklist actually offers? Free text is not. */
export function isClosureReason(v: unknown): v is AccountClosureReason {
  return ACCOUNT_CLOSURE_REASONS.some(([code]) => code === v);
}

/**
 * The confirmation gate.
 *
 * ⚠️ THE LITERAL WORD, NOT A CASE-INSENSITIVE MATCH. The point of the gate
 * is that it cannot be passed by reflex — lower-casing it turns "close"
 * (which is also the word on the button they just pressed) into a valid
 * confirmation. Whitespace is trimmed because a phone keyboard appends a
 * space after autocomplete and that is not the member changing their mind.
 */
export function confirmAccepted(typed: string): boolean {
  return typed.trim() === 'CLOSE';
}

// ─── Closure eligibility ─────────────────────────────────────────────

/**
 * One open item standing between the member and a closed account, or one
 * thing they should know about before closing.
 *
 * `message` is rendered as-is: the server is the only side that knows
 * whether it is one open offer or four, and which case number the
 * complaint has.
 */
export interface ClosureBlocker {
  code: string;
  message: string;
  /** Where the member goes to finish it. Null renders as plain text. */
  href: string | null;
}

export interface ClosureEligibility {
  eligible: boolean;
  /**
   * isBanned or sellingBannedAt. Renders the §5.4 support screen.
   *
   * ⚠️ NOT the same thing as `alreadyClosed`. A closure is not an
   * enforcement action and must never be described as one.
   */
  restricted: boolean;
  /** accountClosedAt is already set — nothing left to do here. */
  alreadyClosed: boolean;
  blockers: ClosureBlocker[];
  /** Told, not enforced — e.g. an active subscription that will end. */
  warnings: ClosureBlocker[];
}

/**
 * Fallback destinations, used only when the server does not name one.
 *
 * The server knows the ids and should send an `href` per blocker; these
 * are the section landing pages so that an item never renders as a dead
 * end. An unknown code deliberately maps to nothing rather than to a
 * guess — sending someone to the wrong page to fix the wrong thing is
 * worse than sending them nowhere.
 */
const BLOCKER_HREF: Record<string, string> = {
  // ⚠️ THESE KEYS ARE COPIED OFF AccountClosureService.canClose, NOT INVENTED
  // HERE. The first cut of this map guessed at FUNDS_HELD / UNDELIVERED_ORDER
  // / CHECKOUT_PENDING / OPEN_OFFER; the service emits FUNDS_IN_FLIGHT /
  // UNDELIVERED / MID_CHECKOUT / OPEN_OFFERS. Nothing broke only because the
  // service also sends its own href on every blocker — the day one of them
  // stops, the member reads "you have 2 open offers" with no way to reach
  // them. Same trap as OFFER_REJECT_REASONS: a list on one side only.
  FUNDS_IN_FLIGHT: '/my/orders',
  PAYOUT_DUE: '/my/earnings',
  UNDELIVERED: '/shipping',
  FIREARM_TRANSFER: '/shipping',
  OPEN_COMPLAINT: '/complaints',
  LIVE_AUCTION: '/my/listings',
  MID_CHECKOUT: '/my/listings',
  OPEN_OFFERS: '/my/offers',
  // Named in ACCOUNT-CLOSURE.md §6 but not yet emitted by canClose. Listed so
  // that adding the predicate server-side does not silently ship a linkless
  // blocker; harmless while nothing sends them.
  PAYOUT_HELD: '/my/earnings',
  OPEN_ORDER: '/my/orders',
};

/** Codes that mean "an admin has to do this", not "finish this first". */
const RESTRICTION_CODES = new Set([
  'ACCOUNT_RESTRICTED',
  'BANNED',
  'IS_BANNED',
  'SELLING_BANNED',
]);

/**
 * ⚠️ HOW THE SERVER ACTUALLY SAYS "already closed": not a top-level flag, but
 * a blocker with this code and canClose:false (AccountClosureService.canClose).
 * Reading only `accountClosedAt`/`closed` — neither of which that route
 * returns — put a member whose Clerk deletion had failed on the §5.3 screen,
 * told that "some things on your account are still open", with the single
 * open item being the sentence "This account is already closed."
 */
const ALREADY_CLOSED_CODE = 'ALREADY_CLOSED';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function normaliseBlocker(raw: unknown): ClosureBlocker | null {
  // A bare string is treated as a message with no code, so a server that
  // sends prose still renders something the member can act on.
  if (typeof raw === 'string') {
    return raw.trim() ? { code: '', message: raw, href: null } : null;
  }
  const r = asRecord(raw);
  if (!r) return null;
  const code = typeof r.code === 'string' ? r.code : '';
  const message =
    typeof r.message === 'string' && r.message.trim()
      ? r.message
      : typeof r.label === 'string' && r.label.trim()
        ? r.label
        : '';
  if (!message) return null;
  const href =
    typeof r.href === 'string' && r.href.trim()
      ? r.href
      : (BLOCKER_HREF[code] ?? null);
  return { code, message, href };
}

function normaliseList(raw: unknown): ClosureBlocker[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normaliseBlocker)
    .filter((b): b is ClosureBlocker => b !== null);
}

/**
 * Turn whatever /users/me/closure-eligibility answered into the shape the
 * screens read.
 *
 * ⚠️ FAILS CLOSED. Anything this function does not positively recognise as
 * "eligible, no blockers" comes back `eligible: false`. The closure and
 * the screen that triggers it are being built by two people at once, and
 * an optimistic default here means a shape mismatch renders the
 * irreversible screen over an empty blocker list — the member reads
 * "nothing is outstanding" off a payload we failed to parse.
 *
 * The cost of failing closed is a member who is told to contact support
 * about an account that could have closed itself. That is recoverable.
 */
export function normaliseEligibility(raw: unknown): ClosureEligibility {
  const r = asRecord(raw) ?? {};
  const blockers = normaliseList(r.blockers);
  const warnings = normaliseList(r.warnings);

  const restricted =
    r.restricted === true ||
    r.banned === true ||
    blockers.some((b) => RESTRICTION_CODES.has(b.code));

  const alreadyClosed =
    r.closed === true ||
    r.accountClosedAt != null ||
    blockers.some((b) => b.code === ALREADY_CLOSED_CODE);

  // `canClose` as well as `eligible`: the service method behind this route
  // is named canClose() and the route may well spread its return value.
  const said = r.eligible === true || r.canClose === true;

  return {
    eligible: said && !restricted && !alreadyClosed && blockers.length === 0,
    restricted,
    alreadyClosed,
    // A restriction, and an account that has already closed, each get their
    // own screen — so neither may also appear in the open-items list
    // underneath one of them.
    blockers: blockers.filter(
      (b) =>
        b.code !== ALREADY_CLOSED_CODE &&
        !(restricted && RESTRICTION_CODES.has(b.code)),
    ),
    warnings,
  };
}

// ─── Requests ────────────────────────────────────────────────────────

async function request<T>(
  getToken: TokenGetter,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await safeJson<{ message?: string | string[] }>(res, {});
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : (body.message ?? 'Something went wrong. Please try again in a moment.');
    throw new UsersApiError(message, res.status);
  }
  return safeJson<T>(res, null as T);
}

export async function fetchClosureEligibility(
  getToken: TokenGetter,
): Promise<ClosureEligibility> {
  return normaliseEligibility(
    await request<unknown>(getToken, '/users/me/closure-eligibility'),
  );
}

/**
 * POST /users/me/close.
 *
 * ⚠️ THE CALLER MUST NOT RETRY THIS ON A TIMEOUT. The closure is one
 * transaction followed by a Clerk delete, and the session it was made
 * with stops being valid partway through — a retry answers 401 on an
 * account that closed perfectly well.
 */
export async function closeAccount(
  getToken: TokenGetter,
  reason: AccountClosureReason,
): Promise<void> {
  await request<unknown>(getToken, '/users/me/close', {
    method: 'POST',
    body: JSON.stringify({ reason, confirm: 'CLOSE' }),
  });
}
