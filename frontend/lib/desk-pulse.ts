/**
 * THE DESK — Pulse.
 *
 * Every number here comes from AdminAnalyticsService, which already backs the
 * legacy analytics page. Nothing is recomputed on the client: two surfaces
 * deriving "conversion" from raw rows is how two surfaces end up disagreeing
 * about it in a meeting.
 */
import { deskFetch } from './desk-auth';

/**
 * ⚠️ THE SERVER'S PERIOD VOCABULARY, NOT OURS. resolvePeriod() on the admin
 * analytics controller accepts '7d' | '30d' | '90d' | '365d' | 'all' and
 * SILENTLY FALLS BACK TO ITS DEFAULT on anything else — so sending '30'
 * returns a real, plausible-looking chart for the wrong window, with no
 * error anywhere. The suffix is load-bearing.
 */
export type Period = '7d' | '30d' | '90d';

export interface OverviewKpis {
  gmvCents: number;
  gmvCentsPrev: number;
  revenueCents: number;
  revenueCentsPrev: number;
  txCount: number;
  txCountPrev: number;
  aovCents: number;
  aovCentsPrev: number;
  refundRate: number;
  refundRatePrev: number;
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
export const fetchSeries = (p: Period) => deskFetch<SeriesPoint[]>(`/admin/analytics/time-series${q(p)}`);
export const fetchByType = (p: Period) => deskFetch<ByListingType[]>(`/admin/analytics/by-listing-type${q(p)}`);
export const fetchByCategory = (p: Period) => deskFetch<ByCategory[]>(`/admin/analytics/by-category${q(p)}`);
export const fetchFunnel = (p: Period) => deskFetch<FunnelStage[]>(`/admin/analytics/insights/funnel${q(p)}`);

/** A percentage change, as the ink-only delta the tiles render. */
export function delta(now: number, prev: number): { label: string; direction: 'up' | 'down' } | null {
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
