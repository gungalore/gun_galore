/**
 * THE DESK — Pulse.
 *
 * Every number here comes from AdminAnalyticsService, which already backs the
 * legacy analytics page. Nothing is recomputed on the client: two surfaces
 * deriving "conversion" from raw rows is how two surfaces end up disagreeing
 * about it in a meeting.
 */
import { deskFetch, deskFetchRaw } from './desk-auth';

/**
 * ⚠️ THE SERVER'S PERIOD VOCABULARY, NOT OURS. resolvePeriod() on the admin
 * analytics controller accepts '7d' | '30d' | '90d' | '365d' | 'all' and
 * SILENTLY FALLS BACK TO ITS DEFAULT on anything else — so sending '30'
 * returns a real, plausible-looking chart for the wrong window, with no
 * error anywhere. The suffix is load-bearing.
 */
export type Period = '7d' | '30d' | '90d' | '365d' | 'all';

/**
 * ⚠️ THIS TYPE USED TO STOP AT '90d' WHILE THE COMMENT ABOVE IT LISTED ALL
 * FIVE THE SERVER ACCEPTS. The map recorded "the legacy switcher offers 7d,
 * 30d, 90d, 365d and all time; Pulse offers the first three" as a gap needing
 * work — and the work was two entries in a union, because the fetchers already
 * pass the value straight through. A year-on-year or all-time read had nowhere
 * to happen for want of a type.
 */
export const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: 'A year' },
  { value: 'all', label: 'All time' },
];

/**
 * How the time series is grouped.
 *
 * ⚠️ THE SERVER SILENTLY FALLS BACK TO 'day' on anything it does not know,
 * exactly as it does for period — so a typo here returns a real, plausible
 * chart at the wrong resolution with no error anywhere.
 */
export type Bucket = 'day' | 'week' | 'month';

export const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

/**
 * The bucket that suits a window, used when the operator has not chosen one.
 *
 * 365 daily points on a sparkline is a smear, and 'all' is worse; a year read
 * weekly and all-time read monthly is the same data at a resolution a person
 * can see. Choosing explicitly always wins — this only supplies the default.
 */
export function defaultBucket(p: Period): Bucket {
  if (p === 'all') return 'month';
  if (p === '365d') return 'week';
  return 'day';
}

export interface OverviewKpis {
  gmvCents: number;
  gmvCentsPrev: number;
  revenueCents: number;
  revenueCentsPrev: number;
  txCount: number;
  txCountPrev: number;
  /** ⚠️ Null means the period had nothing to measure — NOT zero. An average
   *  over no orders and a rate over a zero denominator are both undefined;
   *  they used to arrive as 0 and render as "R0" / "0.0%", which is the Desk
   *  claiming a finding it never worked out. Null renders as an em dash. */
  aovCents: number | null;
  aovCentsPrev: number | null;
  refundRate: number | null;
  refundRatePrev: number | null;
  disputeRate: number;
  disputeRatePrev: number;
}

export interface SeriesPoint {
  /** ISO date — the start of the day/week/month bucket. */
  bucket: string;
  gmvCents: number;
  revenueCents: number;
  txCount: number;
}

export interface ByListingType {
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
  count: number;
  gmvCents: number;
}

export interface ByCategory {
  categoryName: string;
  count: number;
  gmvCents: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  users: number;
}

const q = (p: Period) => `?period=${p}`;

export const fetchOverview = (p: Period) => deskFetch<OverviewKpis>(`/admin/analytics/overview${q(p)}`);
export const fetchSeries = (p: Period, b?: Bucket) =>
  deskFetch<SeriesPoint[]>(
    `/admin/analytics/time-series${q(p)}&bucket=${b ?? defaultBucket(p)}`,
  );
export const fetchByType = (p: Period) => deskFetch<ByListingType[]>(`/admin/analytics/by-listing-type${q(p)}`);
export const fetchByCategory = (p: Period) => deskFetch<ByCategory[]>(`/admin/analytics/by-category${q(p)}`);
export const fetchFunnel = (p: Period) => deskFetch<FunnelStage[]>(`/admin/analytics/insights/funnel${q(p)}`);

/** A percentage change, as the ink-only delta the tiles render. */
export function delta(
  now: number | null,
  prev: number | null,
): { label: string; direction: 'up' | 'down' } | null {
  // No change to show against a period that was never measured — and none from
  // one, either. Returning a percentage here would invent a trend out of an
  // absence.
  if (now === null || prev === null) return null;
  if (!prev) return null;
  const pct = ((now - prev) / prev) * 100;
  return {
    label: `${Math.abs(pct).toFixed(pct >= 10 || pct <= -10 ? 0 : 1)}%`,
    direction: pct >= 0 ? 'up' : 'down',
  };
}

export function rand(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
}

/**
 * Buy Now against Auction, and the offers add-on share of each.
 *
 * ⚠️ TAKE_A_SHOT IS NOT A THIRD MODE. The enum value still exists and still
 * appears on pre-cutover rows, but it is no longer selectable when a listing
 * is created — offers are an add-on available on either real mode. Charting
 * the enum as a third bar would put a selling mode on screen that a seller
 * cannot choose, so legacy rows are reported separately and named as legacy.
 */
export function splitTypes(rows: ByListingType[]) {
  const find = (t: ByListingType['listingType']) => rows.find((r) => r.listingType === t);
  const buyNow = find('BUY_NOW')?.count ?? 0;
  const auction = find('AUCTION')?.count ?? 0;
  const legacyOffers = find('TAKE_A_SHOT')?.count ?? 0;
  return { buyNow, auction, legacyOffers, total: buyNow + auction };
}

/* ── Cross-sell demand ─────────────────────────────────────────────────
 *
 * What survives of /admin/categories.
 *
 * ⚠️ THE EDITING DOES NOT COME WITH IT, AND THAT IS THE DECISION, NOT AN
 * OMISSION. The category tree carries isFirearm and requiresLicence, and
 * those two booleans decide which categories sit behind the members-only
 * gate. A dropdown in a browser leaves no diff, no review and no answer to
 * "who un-gated ammunition on a Tuesday" — so the tree changes in code, with
 * a commit and a reason. What an operator actually READ that page for is
 * below: which complementary stock buyers went looking for and did not find.
 */

export interface DemandRow {
  fromCategoryId: string;
  fromCategoryName: string;
  /** Normalised calibre, or empty where the miss was not calibre-specific. */
  calibre: string;
  count: number;
  lastSeenAt: string;
}

/**
 * ⚠️ NOT SCOPED TO THE PULSE PERIOD, AND THE BLOCK MUST SAY SO. CrossSellMiss
 * is a running tally — one row per category+calibre with a count that only
 * goes up — so the endpoint takes no period and none is sent. Rendering it
 * under a "last 30 days" heading would put an all-time number on a
 * period-scoped surface and nobody would ever catch it.
 */
export const fetchCrossSellDemand = () =>
  deskFetch<DemandRow[]>('/admin/categories/cross-sell-demand');

/* ── Operational health ────────────────────────────────────────────────
 *
 * The three blocks of /admin/analytics/health. All three are current-state
 * counts over the whole table, not windowed reads: the period chip does not
 * apply to them and the cards carry that in their own sub-line.
 */

export interface KycStage {
  stage: string;
  count: number;
}

export interface DispatchBucket {
  /** 'under-24h' | '24-48h' | '48-72h' | 'pending' | 'breached' */
  bucket: string;
  count: number;
}

/**
 * ⚠️ THE WIRE CARRIES email AND THIS TYPE DELIBERATELY DOES NOT.
 * refundRiskSellers() selects u.email, and the legacy page printed it in a
 * scrollable table. A seller who refunds a lot is a number on a chart here,
 * not a name and an address on a shared screen — so the field is left off
 * the type, which makes rendering it a compile error rather than a habit.
 */
export interface RefundRiskRow {
  sellerId: string;
  username: string | null;
  totalSales: number;
  refundCount: number;
  refundRate: number;
  /** Percentage points above the marketplace baseline. */
  ppDifference: number;
}

export const fetchKycFunnel = () => deskFetch<KycStage[]>('/admin/analytics/kyc-funnel');
export const fetchDispatchSla = () => deskFetch<DispatchBucket[]>('/admin/analytics/dispatch-sla');
export const fetchRefundRisk = () => deskFetch<RefundRiskRow[]>('/admin/analytics/refund-risk');

/** The bucket keys the SQL emits, in the order an operator reads them. */
export const DISPATCH_BUCKET_LABEL: Record<string, string> = {
  'under-24h': 'Under 24h',
  '24-48h': '24 to 48h',
  '48-72h': '48 to 72h',
  pending: 'Still pending',
  breached: 'Breached, over 72h',
};

/* ── The four reads the cutover map listed as lost ────────────────────── */

/**
 * 🚨 ALL FOUR ENDPOINTS EXISTED THE WHOLE TIME. The map recorded top makes and
 * models, time to sale, search intel and the dormant segment as "no Desk
 * equivalent" — and every one of them is a GET that has been serving since the
 * legacy page was written. Nothing had to be computed; they had to be asked
 * for. Same shape as the period gap on this module, which was a union that
 * stopped two entries early.
 */

export interface TopMakeModel {
  make: string;
  model: string;
  count: number;
  gmvCents: number;
  avgPriceCents: number;
}

export const fetchTopMakeModel = (p: Period) =>
  deskFetch<TopMakeModel[]>(`/admin/analytics/top-make-model${q(p)}`);

export interface TimeToSaleRow {
  categoryName: string;
  /** Already rounded to one decimal by the server. */
  medianDays: number;
  sold: number;
}

export const fetchTimeToSale = (p: Period) =>
  deskFetch<TimeToSaleRow[]>(`/admin/analytics/time-to-sale${q(p)}`);

export interface SearchTerm {
  term: string;
  count: number;
  maxResults?: number;
}

export interface SearchIntel {
  topTerms: SearchTerm[];
  zeroResult: SearchTerm[];
}

export const fetchSearchIntel = (p: Period) =>
  deskFetch<SearchIntel>(`/admin/analytics/insights/search${q(p)}`);

/**
 * ⚠️ NO PERIOD, AND THE CARD MUST SAY SO. dormantSegment() counts against a
 * fixed 14-day window in the service, so it does NOT move when the period
 * chips move. Rendering it inside a period-scoped board without a word would
 * make it read as "dormant in the last 7 days", which is a different and
 * much smaller number.
 */
export interface DormantSegment {
  total: number;
  smsReachable: number;
}

export const fetchDormant = () =>
  deskFetch<DormantSegment>('/admin/analytics/insights/dormant');

/**
 * A day-of-week x hour grid.
 *
 * ⚠️ SPARSE. The server returns only cells that HAVE activity, so a missing
 * (dow, hour) is a real zero — but an absent cell and a measured zero must
 * still render the same way here, because the query counts rows and cannot
 * distinguish "nothing sold" from "nothing recorded".
 */
export interface HeatCell {
  dow: number;
  hour: number;
  count: number;
}

export const fetchSalesHeatmap = (p: Period) =>
  deskFetch<HeatCell[]>(`/admin/analytics/insights/sales-heatmap${q(p)}`);

export const fetchActivityHeatmap = (p: Period) =>
  deskFetch<HeatCell[]>(`/admin/analytics/insights/activity-heatmap${q(p)}`);

/** Sunday-first, matching Postgres EXTRACT(DOW). */
export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Index a sparse cell list for O(1) lookup while drawing the grid.
 *
 * ⚠️ THE KEY IS dow*24+hour, NOT a string concat of the two. "1" + "12" and
 * "11" + "2" both make "112"; a grid built on that would silently merge two
 * unrelated cells and paint a Monday lunchtime figure onto a Thursday.
 */
export function heatIndex(cells: HeatCell[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cells) m.set(c.dow * 24 + c.hour, c.count);
  return m;
}

export function heatPeak(cells: HeatCell[]): number {
  return cells.reduce((max, c) => (c.count > max ? c.count : max), 0);
}

/* ── Export ───────────────────────────────────────────────────────────── */

/**
 * Download the series as a spreadsheet.
 *
 * 🚨 A PLAIN <a href> CANNOT DO THIS. The admin API is bearer-authenticated,
 * and a link navigation sends no Authorization header — so the browser would
 * follow it, receive a 401, and land the operator on a JSON error page having
 * lost the board they were on. The file has to be fetched with the token,
 * turned into a blob and handed to a synthetic link.
 *
 * ⚠️ AND THE OBJECT URL IS REVOKED. Every export otherwise pins a copy of the
 * file in the tab for as long as it lives — harmless for one, not for an
 * operator who exports a dozen windows while comparing them.
 *
 * ⚠️ THE FILENAME COMES FROM Content-Disposition when the server sends one, so
 * the name is decided in one place. The fallback exists because a proxy that
 * strips the header should not produce a download called "download".
 */
export async function downloadSeriesCsv(p: Period, b: Bucket): Promise<void> {
  const res = await deskFetchRaw(`/admin/analytics/export.csv?period=${p}&bucket=${b}`);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = named ?? `all-outdoor-analytics-${p}-${b}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
