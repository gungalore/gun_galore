import { deskFetch } from './desk-auth';
import { STATUS_LABEL, type ListingStatusWire } from './desk-listing';

/**
 * THE DESK — browsing listings.
 *
 * ⚠️ desk-listingS, PLURAL — the REGISTER. desk-listing (singular) is one
 * listing's dossier and its decisions. Same one-character split as
 * desk-order / desk-orders, and for the same reason: a board asking for a
 * page of rows and a drawer asking for one dossier want different shapes, and
 * merging them produces a type that is half-null on every surface.
 *
 * 🚨 REACH WAS NEVER THE GAP HERE — BROWSE WAS. Global search already opens
 * any listing by id, reference, make or model, and the Listing drawer has
 * always accepted an arbitrary id. What had no home was the operator who does
 * NOT know which listing they want: "show me everything pending", "what has
 * this seller got live". The PENDING_REVIEW queue is a card type on the pile,
 * which serves the daily loop and is not a register.
 */

/** The statuses worth a chip, plus the pseudo-segment for everything. */
export type ListingSegment =
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'SOLD'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'ALL'
  | 'DEAD';

export const LISTING_SEGMENTS: { value: ListingSegment; label: string }[] = [
  // ⚠️ PENDING_REVIEW FIRST AND DEFAULT, because it is the only segment with
  // a decision waiting in it, and because it is what the server returns when
  // no status is asked for — a board whose default disagreed with the API's
  // default would show a different list on first paint than on refresh.
  { value: 'PENDING_REVIEW', label: 'Awaiting review' },
  { value: 'ACTIVE', label: 'Live' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'CANCELLED', label: 'Taken down' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'ALL', label: 'Everything' },
  // ⚠️ NOT A STATUS — A RANKING. Dead stock is ACTIVE listings ordered by
  // age x price, which is a different endpoint (/admin/freshness-graveyard)
  // and not something getListings can express. It sits among the status chips
  // because that is where an operator looks for "show me listings like X",
  // and the register says on its face that this one is sorted, not filtered.
  { value: 'DEAD', label: 'Dead stock' },
];

export function segmentLabel(s: ListingSegment): string {
  return LISTING_SEGMENTS.find((x) => x.value === s)?.label ?? s;
}

/** The label a row's own status renders as — shared with the drawer. */
export function statusLabel(s: ListingStatusWire): string {
  return STATUS_LABEL[s] ?? s;
}

export interface ListingRow {
  id: string;
  referenceNumber: string | null;
  title: string;
  status: ListingStatusWire;
  listingType: string;
  /** ZAR cents. Null on a swap or a price-less type. */
  price: number | null;
  createdAt: string;
  seller: { id: string; username: string | null } | null;
  category: { name: string; isFirearm: boolean } | null;
  images: { url: string }[];
}

export interface ListingPage {
  rows: ListingRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * ⚠️ THE WIRE CALLS THE ARRAY `listings`, NOT `rows`. getListings returns
 * { listings, total, page, limit } and this is the only place that shape is
 * translated. Typing it as `rows` here would produce an empty register with a
 * correct-looking total beside it — the same failure the alerts inbox shipped
 * once, and the reason this reads defensively rather than trustingly.
 */
interface ListingPageWire {
  listings?: ListingRow[];
  rows?: ListingRow[];
  total?: number;
  page?: number;
  limit?: number;
}

export const LISTINGS_PAGE_SIZE = 30;

export async function fetchListingPage(
  segment: ListingSegment,
  search: string,
  page = 1,
): Promise<ListingPage> {
  const p = new URLSearchParams();
  p.set('status', segment);
  p.set('page', String(page));
  p.set('limit', String(LISTINGS_PAGE_SIZE));
  const q = search.trim();
  // The server ignores a search under two characters; sending it anyway would
  // be a request whose result does not match the box the operator is typing in.
  if (q.length >= 2) p.set('search', q);

  const res = await deskFetch<ListingPageWire>(`/admin/listings?${p.toString()}`);
  const rows = res?.listings ?? res?.rows ?? [];
  return {
    rows,
    total: typeof res?.total === 'number' ? res.total : rows.length,
    page: res?.page ?? page,
    limit: res?.limit ?? LISTINGS_PAGE_SIZE,
  };
}

/* ── Dead stock ───────────────────────────────────────────────────────── */

/**
 * The freshness graveyard: ACTIVE listings with no bids, offers or watchers,
 * ranked by age x price.
 *
 * 🚨 THE DESK ONLY EVER SHOWED THE TOP FIVE. desk.service.ts emits a
 * stale_listing card for the worst five, which is right for a pile — a
 * worklist is not a report — but it left the other end of a long tail
 * unreachable, and the legacy page ranked every one of them.
 *
 * ⚠️ sellerEmail IS ON THE WIRE AND IS NOT DECLARED HERE. The endpoint
 * selects it and the legacy report printed it under every row. The Desk rule
 * is username only, and the Order drawer's note is the precedent: the data
 * module does not declare the field, so no row component can render it by
 * reaching for something that happens to be in the response.
 *
 * ⚠️ staleScore IS ALSO NOT DECLARED. It is age x price in rands — a ranking
 * number with no meaning to a person, and "412 000" beside a rifle reads as
 * money. It orders the list server-side and stays behind the glass, which is
 * the same call the pile card already makes.
 */
interface DeadStockWire {
  id: string;
  referenceNumber: string | null;
  title: string;
  priceCents: number | null;
  ageDays: number;
  sellerId: string;
  sellerUsername: string | null;
  categoryName: string;
  listingType: string;
}

export interface DeadStockRow extends ListingRow {
  /** Whole days live with nothing happening — the reason the row is here. */
  ageDays: number;
}

export async function fetchDeadStock(limit = 100): Promise<DeadStockRow[]> {
  const rows = await deskFetch<DeadStockWire[] | { rows?: DeadStockWire[] }>(
    `/admin/freshness-graveyard?limit=${limit}`,
  );
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  return list.map((r) => ({
    id: r.id,
    referenceNumber: r.referenceNumber,
    title: r.title,
    // Every row here is ACTIVE by definition — that is what makes it dead
    // stock rather than history — so the tag is correct without being sent.
    status: 'ACTIVE',
    listingType: r.listingType,
    price: r.priceCents,
    // The endpoint returns age, not a created date. Deriving a fake createdAt
    // from it would put a precise-looking timestamp on an approximation.
    createdAt: '',
    ageDays: Math.round(r.ageDays),
    seller: { id: r.sellerId, username: r.sellerUsername },
    category: { name: r.categoryName, isFirearm: false },
    images: [],
  }));
}
