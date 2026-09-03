/**
 * THE DESK — People.
 *
 * ⚠️ LISTS SHOW USERNAMES. A real name, an ID number or a bank detail appears
 * only inside an expanded verification or the member drawer — the places the
 * operator has deliberately opened to make a decision that needs them. A
 * scrollable list of 1,284 real names is a privacy surface nobody asked for
 * and the fastest way to leak one onto a shared screen.
 *
 * ⚠️ SEARCHING BY A REAL NAME IS FINE; RENDERING ONE IS NOT. The backend
 * matches `search` against email, firstName, lastName AND username, so an
 * operator holding a support email can find the member — but `PersonRow`
 * below deliberately does not carry firstName, lastName or email, so the
 * result of that search is still a list of handles. The typed query is the
 * operator's own words in their own field; the rendered row is the leak.
 *
 * ⚠️ TWO DIFFERENT POPULATIONS LIVE ON THIS BOARD AND THEY ARE NOT THE SAME
 * SHAPE. `PersonRow` is a member of the marketplace. `DealerRow` is an entry
 * in the SAPS-licensed dealer directory — a business, from a different table,
 * with its own lifecycle, that checkout offers to buyers when shipping is
 * DEALER_TRANSFER. Blurring them is how a firearm gets routed to the wrong
 * counter, so nothing below is shared between the two beyond the search box.
 */
import { DeskFetchError, deskFetch } from './desk-auth';

export type Segment = 'everyone' | 'verifying' | 'banned' | 'closed' | 'dealers';

/**
 * Maps a Desk segment onto the filter AdminService.getUsers already accepts.
 *
 * 🚨 EVERY VALUE BELOW MUST BE A BRANCH getUsers ACTUALLY HAS. Its filter
 * block is an if-ladder that ends `return {}` — an unrecognised name is not
 * rejected, it silently matches EVERY member. A chip wired to one renders the
 * whole directory under a label that says otherwise, and the header prints
 * "1,284 in <that label>" over it. There is no 400 and nothing in the network
 * tab looks wrong.
 *
 * ⚠️ THAT IS WHY THERE IS NO 'Sellers' SEGMENT. One shipped here reading
 * `filter=sellers`, which getUsers has never had, so the chip was the Everyone
 * list wearing a different name. It is removed rather than corrected because
 * there is no server-side definition to correct it to: sellerTier defaults to
 * NEW on every registered member, so it cannot mean "not NEW", and the only
 * definition in the codebase — ≥1 listing, from the broadcast segments — is a
 * relation filter getUsers does not do. Whoever wants the segment back: add
 * the branch to AdminService.getUsers FIRST, then the chip.
 */
export const SEGMENT_FILTER: Record<Segment, string | undefined> = {
  everyone: undefined,
  // The narrower >24h view is 'kyc-stalled'; 'kyc-outstanding' is everyone
  // awaiting a decision, which is what the operator wants to work through.
  verifying: 'kyc-outstanding',
  banned: 'banned',
  // ⚠️ CLOSED IS NOT A KIND OF BANNED. accountClosedAt is a member who left:
  // the profile is off the public side and the handle is released, but every
  // transaction, rating and complaint stays attached. It is kept findable
  // because the whole point of the closure record is that an admin answering
  // a police request can still reach it — never because it is an attention
  // state. Nothing in this segment is drawn in bad-red.
  closed: 'closed',
  dealers: 'dealers',
};

export interface PersonRow {
  id: string;
  username: string | null;
  kycStatus: string | null;
  sellerTier: string | null;
  isBanned: boolean;
  /** ⚠️ Non-null means the member closed the account. NOT a ban. */
  accountClosedAt: string | null;
  createdAt: string;
  kycRequiredAt: string | null;
}

export interface PeoplePage {
  users: PersonRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * ⚠️ THE LIST IS ONE PAGE OF MANY, AND SAYING SO IS NOT OPTIONAL.
 *
 * The old People board asked for 50 rows and rendered them under a heading
 * that read "1,284 in everyone" — so the 1,234 rows it did not fetch were
 * invisible AND accounted for. Searching a common surname and reading "no
 * such member" off the fiftieth row is a wrong answer the surface had no way
 * of admitting to. Every caller now pages, and the footer states the window.
 */
export const PEOPLE_PAGE_SIZE = 50;

export function fetchPeople(segment: Segment, search: string, page = 1): Promise<PeoplePage> {
  const params = new URLSearchParams();
  const filter = SEGMENT_FILTER[segment];
  if (filter) params.set('filter', filter);
  if (search) params.set('search', search);
  params.set('page', String(Math.max(1, Math.floor(page))));
  params.set('limit', String(PEOPLE_PAGE_SIZE));
  return deskFetch<PeoplePage>(`/admin/users?${params.toString()}`);
}

export interface PageWindow {
  /** 1-based index of the first row on screen; 0 when there are none. */
  first: number;
  last: number;
  hasPrev: boolean;
  hasNext: boolean;
  /**
   * The requested page is past the end of a non-empty list.
   *
   * ⚠️ CALLERS MUST BRANCH ON THIS BEFORE PRINTING A RANGE. A page beyond the
   * end used to compute first > last and render as "61–50 of 50" — a range
   * that counts backwards, printed under a table saying it was empty. It is
   * reachable two ways with no adversary: a stale bookmark carrying ?page=4,
   * and a list that shrinks between loads while somebody is reading it.
   */
  beyondEnd: boolean;
}

/** The arithmetic behind "51–100 of 1,284", kept out of the JSX. */
export function pageWindow(total: number, page: number, size = PEOPLE_PAGE_SIZE): PageWindow {
  const safePage = Math.max(1, Math.floor(page));
  const lastPage = total === 0 ? 1 : Math.ceil(total / size);
  // Past the end of a non-empty list: report nothing on screen rather than a
  // range that counts backwards. hasPrev stays true — the operator has to be
  // able to get back to a page that exists.
  if (total > 0 && safePage > lastPage) {
    return { first: 0, last: 0, hasPrev: true, hasNext: false, beyondEnd: true };
  }
  const first = total === 0 ? 0 : (safePage - 1) * size + 1;
  const last = Math.min(total, safePage * size);
  return { first, last, hasPrev: safePage > 1, hasNext: last < total, beyondEnd: false };
}

/**
 * Approve or reject a seller.
 *
 * ⚠️ ONLY UNDER_REVIEW IS ACCEPTED SERVER-SIDE. reviewKyc rejects any other
 * status, so a row surfaced from the broader 'kyc-outstanding' filter may not
 * be actionable — the UI has to say so rather than offering a button that 400s.
 *
 * ⚠️ SUPERSEDED, AND NOT THE ONE TO REACH FOR. The verification decision now
 * happens inside the Member drawer, against `reviewMemberKyc` in
 * lib/desk-member.ts, which shows the identity document and the face-match the
 * decision rests on. That twin also types `reason` as REQUIRED, because
 * AdminService.reviewKyc refuses a reason under five characters in both
 * directions — an approve with none 400s exactly as hard as a reject does. The
 * optional `reason` below is the older, laxer shape; a new caller wants the
 * drawer's.
 */
export function reviewKyc(userId: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}/kyc-review`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });
}

/** "22m" · "5d" — how long this person has been waiting. */
export function waitedFor(since: string | null): string {
  if (!since) return '—';
  const mins = (Date.now() - new Date(since).getTime()) / 60000;
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

/** Initials for the avatar, from the username — never from a real name. */
export function initials(username: string | null): string {
  if (!username) return '··';
  return username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
}

/* ────────────────────────────────────────────────────────────────────────
 * The SAPS dealer directory
 *
 * A different table, a different lifecycle and a different question. A member
 * is approved to SELL; a dealer is verified to RECEIVE — checkout offers an
 * active dealer's address to a buyer choosing DEALER_TRANSFER, and a firearm
 * is then driven to it. So the two hazards here are not the member hazards:
 * activating an entry whose address came out of an OCR read wrong sends a
 * rifle to the wrong street, and deactivating the only dealer in a province
 * quietly removes the checkout option for everyone in it.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Which slice of the directory is on screen.
 *
 * ⚠️ 'members' IS NOT PART OF THE DIRECTORY. It is the member list filtered to
 * sellerTier = DEALER — the old /admin/users?filter=dealers view — parked
 * under the same segment because "show me the dealers" means both things to
 * an operator and neither is worth its own chip on the top row. Everything
 * else here reads the Dealer table.
 */
export type DealerView = 'active' | 'pending' | 'auto' | 'all' | 'members';

export interface DealerRow {
  id: string;
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isVerified: boolean;
  /** 'MANUAL' when an admin typed it, 'AUTO_VERIFICATION' when OCR found it. */
  source: string;
  /** What the SAP 534 photo actually read, before anyone corrected it. */
  rawAddress: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  _count: { transactions: number };
  /** Most recent transfer that referenced this dealer, newest first, max one. */
  transactions?: { id: string }[];
}

export interface DealerDirectory {
  rows: DealerRow[];
  count: number;
  /** Awaiting review across the whole directory, whatever view is showing. */
  pendingCount: number;
}

/**
 * ⚠️ THE DIRECTORY IS NOT PAGED — SERVER-SIDE take IS 200, FLAT.
 *
 * The legacy page had the same cap and never said so. It is a real ceiling: a
 * directory that grows past 200 entries silently stops showing the tail, and
 * the only way past it is the search box. Stated here so the next person adds
 * paging to the endpoint rather than discovering the cliff from a support
 * ticket about a dealer that "isn't in the system".
 */
export const DEALER_LIST_CAP = 200;

export function fetchDealers(view: DealerView, search: string): Promise<DealerDirectory> {
  const params = new URLSearchParams();
  // Mirrors the four legacy filter tabs exactly. 'pending' ignores the active
  // filter server-side, because everything awaiting review is inactive by
  // design and a pending queue that hid its own rows would be empty forever.
  if (view === 'pending') params.set('pending', 'true');
  if (view === 'auto') {
    params.set('source', 'AUTO_VERIFICATION');
    params.set('includeInactive', 'true');
  }
  if (view === 'all') params.set('includeInactive', 'true');
  if (search) params.set('search', search);
  return deskFetch<DealerDirectory>(`/admin/dealers?${params.toString()}`);
}

/** The nine, in the order the Province enum declares them. */
export const PROVINCES = [
  'EASTERN_CAPE',
  'FREE_STATE',
  'GAUTENG',
  'KWAZULU_NATAL',
  'LIMPOPO',
  'MPUMALANGA',
  'NORTHERN_CAPE',
  'NORTH_WEST',
  'WESTERN_CAPE',
] as const;

export type ProvinceCode = (typeof PROVINCES)[number];

export function provinceLabel(code: string | null): string {
  if (!code) return '—';
  return code.replace(/_/g, ' ');
}

/**
 * The fields an operator can set on a dealer.
 *
 * Deliberately the same shape for create, edit and review: the review flow
 * IS an edit that happens to also flip isVerified, and giving it a narrower
 * form is what would force an operator to activate an entry they could not
 * correct.
 */
export interface DealerDetails {
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string;
  email: string;
}

export function dealerDetailsOf(dealer: DealerRow): DealerDetails {
  return {
    name: dealer.name ?? '',
    licenceNumber: dealer.licenceNumber ?? '',
    address: dealer.address ?? '',
    suburb: dealer.suburb ?? '',
    city: dealer.city ?? '',
    province: dealer.province ?? 'GAUTENG',
    postalCode: dealer.postalCode ?? '',
    phone: dealer.phone ?? '',
    email: dealer.email ?? '',
  };
}

export function emptyDealerDetails(): DealerDetails {
  return {
    name: '',
    licenceNumber: '',
    address: '',
    suburb: '',
    city: '',
    province: 'GAUTENG',
    postalCode: '',
    phone: '',
    email: '',
  };
}

/** Trimmed, with the two optional fields nulled rather than sent as "". */
function detailsBody(details: DealerDetails): Record<string, unknown> {
  return {
    name: details.name.trim(),
    licenceNumber: details.licenceNumber.trim(),
    address: details.address.trim(),
    suburb: details.suburb.trim(),
    city: details.city.trim(),
    province: details.province,
    postalCode: details.postalCode.trim(),
    phone: details.phone.trim() || null,
    email: details.email.trim() || null,
  };
}

/**
 * Which required field is still missing.
 *
 * ⚠️ THE ADDRESS IS THE PRODUCT HERE. Everything else on a dealer row is
 * bookkeeping; the address is what a buyer is shown at checkout and what a
 * courier drives to. An auto-registered entry arrives with whatever the OCR
 * made of a photographed SAP 534, which is routinely a street line and
 * nothing else — so activating one without completing it is the failure this
 * check exists to make impossible to do by accident.
 */
export function missingDealerFields(details: DealerDetails): string[] {
  const missing: string[] = [];
  if (!details.name.trim()) missing.push('Dealer name');
  if (!details.licenceNumber.trim()) missing.push('SAPS licence number');
  if (!details.address.trim()) missing.push('Street address');
  if (!details.suburb.trim()) missing.push('Suburb');
  if (!details.city.trim()) missing.push('City');
  const postal = details.postalCode.trim();
  if (!postal) missing.push('Postal code');
  else if (!/^\d{4}$/.test(postal)) missing.push('Postal code must be four digits');
  return missing;
}

/** True when the OCR read something other than the address now on file. */
export function ocrDiffers(dealer: DealerRow): boolean {
  return Boolean(dealer.rawAddress && dealer.rawAddress !== dealer.address);
}

/** "Sandton, Johannesburg, Gauteng" — whatever of it exists. */
export function dealerLocation(dealer: DealerRow): string {
  const bits = [dealer.suburb, dealer.city, provinceLabelOrNull(dealer.province), dealer.postalCode]
    .filter((b): b is string => Boolean(b && b.trim()));
  return bits.length > 0 ? bits.join(', ') : '—';
}

/**
 * The whole address, street first.
 *
 * ⚠️ THE STREET LINE BELONGS ON THE ROW. The rest of this file argues that the
 * address is the product here — it is what a buyer is shown at checkout and
 * what a courier drives to — and a row that printed only "Sandton,
 * Johannesburg" made the operator open a dialog to see the one field the
 * decision is about. The legacy card led with it; so does this.
 */
export function dealerFullAddress(dealer: DealerRow): string {
  const street = (dealer.address ?? '').trim();
  const rest = dealerLocation(dealer);
  if (!street) return rest;
  return rest === '—' ? street : `${street}, ${rest}`;
}

/**
 * "First seen 4 Aug 2026 · Last seen 28 Aug 2026", for auto-registered entries.
 *
 * ⚠️ THIS IS HOW STALE A PENDING ENTRY IS, AND THE REVIEW QUEUE IS WHERE THAT
 * MATTERS. An entry first seen in March and not seen since is a dealer who may
 * have moved; one seen last week is live. The dates come back on every row and
 * were being fetched and dropped. Returns null for hand-typed entries, which
 * have no sighting to report.
 */
export function dealerSeen(dealer: DealerRow): string | null {
  if (!isAutoRegistered(dealer)) return null;
  const fmt = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  return `First seen ${fmt(dealer.firstSeenAt)} · last seen ${fmt(dealer.lastSeenAt)}`;
}

function provinceLabelOrNull(code: string | null): string | null {
  return code ? code.replace(/_/g, ' ') : null;
}

export type DealerStanding = { label: string; kind: 'warn' | 'neutral' | 'ok' } | null;

/**
 * The one tag a dealer row is allowed to wear.
 *
 * ⚠️ ACTIVE AND VERIFIED WEARS NOTHING. Colour on this surface is reserved
 * for state that wants the operator, and a directory where four hundred rows
 * are green is a directory where the eleven amber ones disappear. The
 * healthy case is the absence of a tag.
 */
export function dealerStanding(dealer: DealerRow): DealerStanding {
  if (!dealer.isVerified) return { label: 'Pending review', kind: 'warn' };
  if (!dealer.isActive) return { label: 'Inactive', kind: 'neutral' };
  return null;
}

export function isAutoRegistered(dealer: DealerRow): boolean {
  return dealer.source === 'AUTO_VERIFICATION';
}

/* ────────────────────────────────────────────────────────────────────────
 * Dealer transitions
 *
 * Every one of them is a PATCH that the backend refuses without a reason, and
 * every one changes what a buyer is offered at checkout. There is no undo
 * window on any of them — not because they are irreversible (they are: the
 * opposite transition is one press away) but because a ten-second client
 * delay on a directory the checkout reads live would mean the pile and the
 * shop disagreed for ten seconds about where a firearm may be sent.
 * ──────────────────────────────────────────────────────────────────────── */

/** The backend floor for a dealer edit — AdminDealersService.update. */
export const MIN_DEALER_REASON = 3;

/**
 * ⚠️ A SEPARATE LADDER FROM THE MEMBER REASONS IN desk-member.ts, AND IT HAS
 * TO BE. Those are counted: a member reason carries a strike and three of
 * them is a selling ban, so the ticklist there is a taxonomy. These are an
 * audit line on a business record with a three-character floor, and the
 * reader is a person reconstructing why a dealer went live. Merging the two
 * lists would put "Abuse or threats" in front of a directory edit.
 */
export interface DealerReasonChoice {
  value: string;
  consequence?: string;
}

export const DEALER_VERIFY_REASONS: DealerReasonChoice[] = [
  { value: 'Licence confirmed against the SAPS certificate' },
  { value: 'Licence confirmed by phone with the dealer' },
  { value: 'Known dealer, already on the network' },
  { value: 'Address corrected from the transfer paperwork' },
];

export const DEALER_DEACTIVATE_REASONS: DealerReasonChoice[] = [
  { value: 'Licence expired or suspended', consequence: 'Buyers stop being offered this dealer' },
  { value: 'Dealer closed or moved' },
  { value: 'Dealer asked to be removed' },
  { value: 'Duplicate of another entry' },
  { value: 'Details could not be verified' },
];

export const DEALER_ACTIVATE_REASONS: DealerReasonChoice[] = [
  { value: 'Licence re-confirmed and current' },
  { value: 'Dealer trading again at this address' },
  { value: 'Deactivated in error' },
];

export const DEALER_EDIT_REASONS: DealerReasonChoice[] = [
  { value: 'Address corrected' },
  { value: 'Contact details updated' },
  { value: 'Licence number corrected' },
  { value: 'Name corrected' },
];

/**
 * The string that lands on the audit row.
 *
 * The chosen line first, the operator's own words after it, so a later reader
 * sees the recorded category before the prose. The twin of this function in
 * desk-member.ts is kept separate on purpose — see the note above.
 */
export function composeDealerReason(choice: string, note: string): string {
  const extra = note.trim();
  return extra ? `${choice} — ${extra}` : choice;
}

/**
 * Review an auto-registered entry: mark it verified, and say whether it goes
 * live at checkout in the same act.
 *
 * ⚠️ VERIFIED AND ACTIVE ARE TWO FLAGS AND THE OPERATOR SETS BOTH. The legacy
 * form defaulted "active" on and buried the checkbox under the address
 * fields, so "review" and "put in front of buyers" were one press. They are
 * separable here because the honest answer to "is this a real licence" is
 * sometimes yes while the answer to "should a firearm be driven there
 * tomorrow" is not yet.
 */
export function reviewDealer(
  dealerId: string,
  details: DealerDetails,
  activate: boolean,
  reason: string,
): Promise<DealerRow> {
  return deskFetch<DealerRow>(`/admin/dealers/${encodeURIComponent(dealerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...detailsBody(details),
      isVerified: true,
      isActive: activate,
      reason,
    }),
  });
}

/**
 * Take a dealer out of checkout, or put it back.
 *
 * ⚠️ SOFT ONLY, AND NOTHING IS DELETED. Transactions reference dealers
 * historically; the flag decides whether checkout offers this address to the
 * NEXT buyer and changes nothing about a transfer already in flight.
 */
export function setDealerActive(
  dealerId: string,
  active: boolean,
  reason: string,
): Promise<DealerRow> {
  return deskFetch<DealerRow>(`/admin/dealers/${encodeURIComponent(dealerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: active, reason }),
  });
}

/** Correct a dealer's details without touching either flag. */
export function saveDealerDetails(
  dealerId: string,
  details: DealerDetails,
  reason: string,
): Promise<DealerRow> {
  return deskFetch<DealerRow>(`/admin/dealers/${encodeURIComponent(dealerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...detailsBody(details), reason }),
  });
}

/**
 * Add a dealer by hand.
 *
 * ⚠️ NO REASON FIELD, AND THAT IS THE BACKEND'S CHOICE, NOT AN OVERSIGHT.
 * AdminDealersService.create writes its own audit line ("Added new dealer
 * <name> (<licence>)") because the act is self-describing; update cannot,
 * which is why every other call here carries one.
 *
 * ⚠️ A HAND-TYPED ENTRY LANDS ACTIVE AND VERIFIED — the Prisma defaults —
 * so this is the one path that puts an address in front of buyers without
 * passing through the review queue. The confirm has to say so.
 */
export function createDealer(details: DealerDetails): Promise<DealerRow> {
  return deskFetch<DealerRow>('/admin/dealers', {
    method: 'POST',
    body: JSON.stringify(detailsBody(details)),
  });
}

/**
 * What the server said when it refused a dealer write, verbatim.
 *
 * `describeFailure` in desk-auth prefixes "GET", which is right for a region
 * that failed to load and wrong for a PATCH that was refused — and the
 * refusals here are the backend explaining a guard ("A dealer with licence
 * number 1234567 already exists.", "A reason of ≥3 chars is required"). That
 * sentence is the whole message, so it is not paraphrased.
 */
export function describeDealerFailure(err: unknown): string {
  if (err instanceof DeskFetchError) {
    return `${err.path}\n${err.message}${err.body ? `\n\n${err.body}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ── The bulk sweep ───────────────────────────────────────────────────── */

/**
 * Ban a selection of members in one call.
 *
 * 🚨 THIS WAS LEFT OUT DELIBERATELY, NOT LEFT UNDONE, and the reason is worth
 * keeping: the legacy sweep is safe only because its checkbox column greys out
 * already-banned and closed accounts, and the Desk's row is a single button
 * that opens the Member drawer — so a checkbox column meant rebuilding the row,
 * and a confirm would otherwise name a count it could not vouch for.
 *
 * The cutover note left the spec for whoever built it, and this follows it:
 * PersonRow carries accountClosedAt for exactly that greying-out, the server
 * caps a call at 50 and skips closed accounts ITSELF, and THE CONFIRM MUST
 * NAME THE ELIGIBLE COUNT, NOT THE SELECTED ONE.
 *
 * ⚠️ A CLOSED ACCOUNT IS NOT MISCONDUCT. The server skips them because every
 * gate already refuses a closed account, so the ban buys nothing and the audit
 * row is the only thing it leaves behind — where a later reader takes it for
 * misconduct by someone who simply left. Banning one individually is still
 * allowed: that is a deliberate act on one person, not a sweep.
 */
export const BULK_BAN_CAP = 50;
export const BULK_BAN_MIN_REASON = 5;

export interface BulkBanResult {
  processed: number;
  skipped: number;
  results: { userId: string; outcome: 'ok' | 'skipped'; message?: string }[];
}

export function bulkBanUsers(userIds: string[], reason: string): Promise<BulkBanResult> {
  return deskFetch('/admin/users/bulk-ban', {
    method: 'POST',
    body: JSON.stringify({ userIds, reason }),
  });
}

/**
 * Can this row be swept?
 *
 * ⚠️ ALREADY-BANNED IS EXCLUDED TOO, and not only because it is pointless.
 * Re-banning stamps a second USER_BAN audit row for one act, so a sweep run
 * twice reads afterwards as two separate offences.
 */
export function isSweepable(p: PersonRow): boolean {
  return !p.isBanned && !p.accountClosedAt;
}

/** Why a row cannot be swept, for the checkbox's title. */
export function unsweepableReason(p: PersonRow): string | null {
  if (p.accountClosedAt) return 'Account closed — a member leaving is not misconduct';
  if (p.isBanned) return 'Already banned';
  return null;
}

/**
 * The sentence the confirm shows.
 *
 * 🚨 IT NAMES THE ELIGIBLE COUNT AND THE SKIPPED ONE SEPARATELY. "Ban 12
 * members" over a selection where four are closed is a promise the call will
 * not keep, and the operator finds out afterwards from a tally — if they read
 * it. Saying "8 of the 12 selected" before the press is the whole point of
 * this control having been held back until it could.
 */
export function describeSweep(selected: PersonRow[]): {
  eligible: PersonRow[];
  skipped: PersonRow[];
  sentence: string;
} {
  const eligible = selected.filter(isSweepable);
  const skipped = selected.filter((p) => !isSweepable(p));
  const n = eligible.length;
  const noun = n === 1 ? 'member' : 'members';
  if (skipped.length === 0) {
    return { eligible, skipped, sentence: `Ban ${n} ${noun}.` };
  }
  return {
    eligible,
    skipped,
    sentence: `Ban ${n} of the ${selected.length} selected — ${skipped.length} already banned or closed, and those are left alone.`,
  };
}
