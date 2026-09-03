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
export type ListingSegment = 'PENDING_REVIEW' | 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED' | 'ALL';

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
