import { deskFetch } from './desk-auth';

/**
 * THE DESK — global search.
 *
 * 🚨 EVERY PIECE OF THIS EXISTED AND NOTHING JOINED THEM UP. `SearchPalette`
 * is a finished component in components/desk/dialogs.tsx — grouped results,
 * arrow-key cursor, Enter to open — mounted nowhere. `GET /admin/search` is a
 * finished endpoint whose own comment says it "powers the type-ahead in the
 * admin layout header", called by nothing. The shell draws a search button
 * whenever `onSearch` is supplied, and the Pile supplied `() => undefined`,
 * which is a function, which is truthy — so the button rendered and swallowed
 * every press.
 *
 * The comment above that handler said "no search endpoint exists". It is the
 * reason nobody looked. This is the fourth time on this rebuild that a thing
 * was built, described as missing, and left disconnected — so the note is
 * worth more than the fix: A CLAIM THAT SOMETHING DOES NOT EXIST IS A CLAIM,
 * AND IT ROTS LIKE ANY OTHER.
 *
 * ⚠️ THIS CLOSES FOUR CUTOVER GAPS AT ONCE, all of the same shape: "an
 * arbitrary listing / transaction / order cannot be reached". They were four
 * entries because the map is organised by legacy page, but they were always
 * one missing feature.
 */

/** Below this the server returns empty sets, so the client must not ask. */
export const SEARCH_MIN_CHARS = 2;

export interface SearchUserWire {
  id: string;
  username: string | null;
  email: string;
  sellerTier: string | null;
  isBanned: boolean;
  accountClosedAt: string | null;
  /**
   * ⚠️ A CLOSURE RELEASES username, email AND phone BACK INTO THE UNIQUENESS
   * NAMESPACE, so the live columns stop matching a closed member the moment
   * they leave. The server searches the closure snapshot too, deliberately —
   * operator, 2026-08-22: "if a user commited a crime or something they cant
   * just vanish by deleting and wiping evidence." Preserved-and-unfindable is
   * the same as not kept, so the palette must render these rows by who they
   * WERE, not as closed+cmsq…@accounts.invalid.
   */
  closure: {
    closedUsername: string | null;
    closedEmail: string | null;
    closedFirstName: string | null;
    closedLastName: string | null;
    closedAt: string;
  } | null;
}

export interface SearchListingWire {
  id: string;
  referenceNumber: string | null;
  title: string;
  status: string;
  listingType: string;
  /** ZAR cents. */
  price: number | null;
  seller: { username: string | null } | null;
}

export interface SearchTransactionWire {
  id: string;
  paymentStatus: string;
  /** ZAR cents. */
  buyerTotal: number;
  createdAt: string;
  listing: { title: string; referenceNumber: string | null } | null;
}

export interface SearchOrderWire {
  id: string;
  orderReference: string | null;
  status: string;
  /** ZAR cents. */
  buyerTotal: number;
  createdAt: string;
  buyer: { username: string | null } | null;
  _count: { transactions: number };
}

export interface SearchWire {
  users: SearchUserWire[];
  listings: SearchListingWire[];
  transactions: SearchTransactionWire[];
  orders: SearchOrderWire[];
}

const EMPTY: SearchWire = { users: [], listings: [], transactions: [], orders: [] };

export function emptySearch(): SearchWire {
  return { users: [], listings: [], transactions: [], orders: [] };
}

export function fetchDeskSearch(q: string): Promise<SearchWire> {
  const trimmed = q.trim();
  if (trimmed.length < SEARCH_MIN_CHARS) return Promise.resolve(EMPTY);
  return deskFetch(`/admin/search?q=${encodeURIComponent(trimmed)}`);
}

export function searchIsEmpty(w: SearchWire): boolean {
  return (
    w.users.length === 0 &&
    w.listings.length === 0 &&
    w.transactions.length === 0 &&
    w.orders.length === 0
  );
}

/* ── How a row reads ──────────────────────────────────────────────────── */

/**
 * The name to print for a member.
 *
 * ⚠️ USERNAME ONLY — NEVER THE EMAIL, even though the email is what the
 * operator may have typed to find them. The project rule is that a real name
 * or address never appears on a surface that merely LISTS people; the Member
 * drawer puts identity behind a deliberate reveal, and Trust and safety
 * dropped the email the legacy page printed under every username for the same
 * reason. A palette is a list. Opening the row is the reveal.
 *
 * A closed account still has to say who it was, or the evidence the closure
 * snapshot exists to preserve is unreachable in practice.
 */
export function memberLabel(u: SearchUserWire): string {
  if (u.closure) {
    return u.closure.closedUsername ?? 'closed account';
  }
  return u.username ?? 'no username';
}

/** The one-line context under a member: their state, worst thing first. */
export function memberContext(u: SearchUserWire): string {
  const bits: string[] = [];
  // Closed outranks banned: a closed account cannot be acted on, so leading
  // with "banned" would offer a decision that is no longer available.
  if (u.closure || u.accountClosedAt) bits.push('account closed');
  else if (u.isBanned) bits.push('banned');
  if (u.sellerTier) bits.push(`${u.sellerTier.toLowerCase()} seller`);
  return bits.join(' · ');
}

/**
 * ⚠️ REFERENCE, NOT ID, WHEREVER ONE EXISTS. The mono column is what the
 * operator matches against the thing in their other hand — an email, a bank
 * memo, a SAPS query — and a cuid appears on none of those. Falling back to a
 * shortened id keeps the column aligned without pretending it is quotable.
 */
export function shortRef(reference: string | null | undefined, id: string): string {
  const r = (reference ?? '').trim();
  if (r) return r;
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/**
 * An order line count, in words that say what it means.
 *
 * A cart with three sellers is three transactions under one order, and the
 * palette must not show three near-identical rows for it — the order row is
 * the one that opens, and this says why it is one row.
 */
export function orderContext(o: SearchOrderWire): string {
  const n = o._count.transactions;
  const lines = n === 1 ? '1 line' : `${n} lines`;
  return `${o.status.replace(/_/g, ' ').toLowerCase()} · ${lines}`;
}

/* ── Where a result goes ──────────────────────────────────────────────── */

/**
 * The deep link a result opens.
 *
 * ⚠️ NAVIGATION, NOT A DRAWER MOUNTED IN THE SHELL. Every one of these
 * drawers already exists on the page that owns the object, with that page's
 * reload, error and confirm behaviour around it. Mounting a second copy in
 * the shell would double every one of those, and the two would drift. The
 * page owning the object opens it, which also makes every result a URL an
 * operator can paste to a colleague.
 *
 * ⚠️ AN ORDER AND A TRANSACTION ARE DIFFERENT PARAMS, on purpose. `?order=`
 * resolves through fetchOrderCard, which wants an ORDER id and finds the
 * first line; a raw transaction has no cart parent to resolve and opens the
 * drawer directly on the line, which is the null-parent case OrderDrawer
 * already documents for a payout row. Passing a transaction id to `?order=`
 * would 404 against an order that does not exist.
 */
export function searchHref(
  kind: 'member' | 'listing' | 'order' | 'transaction',
  id: string,
): string {
  switch (kind) {
    case 'member':
      return `/admin/desk/people?member=${encodeURIComponent(id)}`;
    case 'listing':
      return `/admin/desk?listing=${encodeURIComponent(id)}`;
    case 'order':
      return `/admin/desk/ledger?order=${encodeURIComponent(id)}`;
    case 'transaction':
      return `/admin/desk/ledger?txn=${encodeURIComponent(id)}`;
  }
}
