'use client';

/**
 * THE DESK — Pulse. The numbers, and nothing that needs acting on.
 *
 * ⚠️ THIS IS THE ONE SURFACE WITH NO ACTIONS ON IT, DELIBERATELY. Everything
 * that needs the operator is a card on the Desk. If a number here is alarming,
 * the answer is a card, not a button next to the chart — otherwise work starts
 * living in two places and the pile stops being the whole truth.
 *
 * ⚠️ ONE HUE. Every series is ink at a different opacity; the four state
 * colours never appear in a chart. A green bar and a red bar would be using
 * the vocabulary the cards use for "this needs you" to mean "this went up",
 * which is how colour stops meaning anything on the rest of the surface.
 */
import * as React from 'react';
import {
  BarList,
  ChartCard,
  Chip,
  DeskShell,
  FailedRegion,
  Funnel,
  Kpi,
  Kv,
  LineChart,
  SkeletonPile,
  Split,
  useIsPhone,
} from '../../../../components/desk';
import {
  DISPATCH_BUCKET_LABEL,
  delta,
  fetchByCategory,
  fetchByType,
  fetchCrossSellDemand,
  fetchDispatchSla,
  fetchFunnel,
  fetchKycFunnel,
  fetchOverview,
  fetchRefundRisk,
  fetchSeries,
  rand,
  splitTypes,
  type ByCategory,
  type ByListingType,
  type DemandRow,
  type DispatchBucket,
  type FunnelStage,
  type KycStage,
  type OverviewKpis,
  BUCKETS,
  PERIODS,
  defaultBucket,
  type Bucket,
  type Period,
  type RefundRiskRow,
  type SeriesPoint,
} from '../../../../lib/desk-pulse';
import { describeFailure } from '../../../../lib/desk-auth';


interface PulseData {
  overview: OverviewKpis;
  series: SeriesPoint[];
  types: ByListingType[];
  categories: ByCategory[];
  funnel: FunnelStage[];
}

/**
 * ⚠️ THE STANDING BLOCK IS NOT PERIOD-SCOPED, AND IT LOADS SEPARATELY BECAUSE
 * OF IT. Cross-sell demand is a running tally, and the three operational
 * counts are current-state reads over the whole table — none of the four
 * endpoints accepts a period and none is sent one. Loading them alongside the
 * windowed charts would re-fetch four unchanged answers every time the chip
 * moves, and worse, would sit them under a heading that says "30 days".
 */
interface StandingData {
  demand: DemandRow[];
  kyc: KycStage[];
  sla: DispatchBucket[];
  risk: RefundRiskRow[];
}

export default function PulsePage() {
  const [period, setPeriod] = React.useState<Period>('30d');
  /**
   * Null means "whatever suits the window" — see defaultBucket. Choosing
   * explicitly pins it, so switching to All time does not silently undo a
   * deliberate Daily.
   */
  const [bucket, setBucket] = React.useState<Bucket | null>(null);
  const activeBucket = bucket ?? defaultBucket(period);
  const [data, setData] = React.useState<PulseData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [standing, setStanding] = React.useState<StandingData | null>(null);
  const [standingError, setStandingError] = React.useState<string | null>(null);
  const phone = useIsPhone();

  /**
   * ⚠️ THE LAST CHIP PRESSED WINS, AND IT HAS TO BE SAID IN CODE. Five reads
   * go out per period and 90 days costs more than 7, so pressing 90 then 7
   * can land the 90-day answer second and paint it under a heading that says
   * "Last 7 days". Every number would be real, nothing would error, and the
   * operator would read the wrong window — the same failure mode this
   * module's header warns about for a malformed period suffix, arriving by a
   * different door.
   */
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++generation.current;
    try {
      // One period, five requests, in parallel. They are independent reads;
      // serialising them would make the whole page wait for the slowest.
      const [overview, series, types, categories, funnel] = await Promise.all([
        fetchOverview(period),
        fetchSeries(period, activeBucket),
        fetchByType(period),
        fetchByCategory(period),
        fetchFunnel(period),
      ]);
      if (mine !== generation.current) return;
      setData({ overview, series, types, categories, funnel });
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(describeFailure(err));
    }
    // ⚠️ activeBucket IS A DEPENDENCY. Without it the bucket chips light up
    // and fetch nothing — the chart keeps the old resolution under a control
    // that says otherwise, which is worse than having no control at all.
  }, [period, activeBucket]);

  const loadStanding = React.useCallback(async () => {
    try {
      const [demand, kyc, sla, risk] = await Promise.all([
        fetchCrossSellDemand(),
        fetchKycFunnel(),
        fetchDispatchSla(),
        fetchRefundRisk(),
      ]);
      setStanding({ demand, kyc, sla, risk });
      setStandingError(null);
    } catch (err) {
      setStandingError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // No period in the dependency list, deliberately — see StandingData.
  React.useEffect(() => {
    void loadStanding();
  }, [loadStanding]);

  const split = data ? splitTypes(data.types) : null;

  return (
    <DeskShell active="pulse" title="Pulse" sub={PERIODS.find((p) => p.value === period)?.label ?? period}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Pulse</span>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>SAST · paid orders</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PERIODS.map((p) => (
            <Chip key={p.value} active={period === p.value} onClick={() => setPeriod(p.value)}>
              {p.label}
            </Chip>
          ))}
        </div>
        {/* ⚠️ THE BUCKET IS A SEPARATE ROW, NOT MORE PERIOD CHIPS. They read
            as one control otherwise, and picking "Weekly" would look like
            picking a window. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BUCKETS.map((b) => (
            <Chip
              key={b.value}
              active={activeBucket === b.value}
              onClick={() => setBucket((cur) => (cur === b.value ? null : b.value))}
            >
              {b.label}
            </Chip>
          ))}
        </div>
      </div>

      {error ? (
        <FailedRegion title="Couldn't load the numbers" detail={error} onRetry={() => void load()} />
      ) : !data ? (
        <SkeletonPile count={2} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            <KpiTile label="Sales" value={rand(data.overview.gmvCents)} now={data.overview.gmvCents} prev={data.overview.gmvCentsPrev} period={period} />
            <KpiTile label="Orders" value={String(data.overview.txCount)} now={data.overview.txCount} prev={data.overview.txCountPrev} period={period} />
            <KpiTile label="Revenue" value={rand(data.overview.revenueCents)} now={data.overview.revenueCents} prev={data.overview.revenueCentsPrev} period={period} />
            <KpiTile label="Refund rate" value={`${(data.overview.refundRate * 100).toFixed(1)}%`} now={data.overview.refundRate} prev={data.overview.refundRatePrev} period={period} />
            {/* Avg order drops on the phone: four tiles fit two-up, five do not. */}
            {phone ? null : (
              <KpiTile label="Avg order" value={rand(data.overview.aovCents)} now={data.overview.aovCents} prev={data.overview.aovCentsPrev} period={period} />
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: phone ? '1fr' : '2fr 1fr',
              gap: 10,
              alignItems: 'start',
            }}
          >
            <ChartCard label={`Daily sales · ${period.replace("d", "")} days`}>
              <LineChart
                points={data.series.map((s) => ({
                  label: new Date(s.bucket).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
                  value: s.gmvCents / 100,
                }))}
                height={phone ? 160 : 200}
                formatValue={(v) => `R${Math.round(v / 1000)}k`}
              />
            </ChartCard>

            <ChartCard label="Listing types">
              {split && split.total > 0 ? (
                <>
                  <Split
                    a={{ label: 'Buy Now', value: split.buyNow }}
                    b={{ label: 'Auction', value: split.auction }}
                  />
                  <div>
                    <Kv k="Buy Now" v={`${split.buyNow} orders`} />
                    <Kv k="Auction" v={`${split.auction} orders`} last={split.legacyOffers === 0} />
                    {/* ⚠️ Named as legacy, not charted as a third mode. The
                        enum survives on pre-cutover rows; a seller cannot
                        choose it today. */}
                    {split.legacyOffers > 0 ? (
                      <Kv k="Legacy Take a Shot rows" v={`${split.legacyOffers}`} last />
                    ) : null}
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                    Offers are an add-on on either type, never a third mode.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
                  No paid orders in this period
                </span>
              )}
            </ChartCard>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: phone ? '1fr' : 'repeat(2, minmax(0, 1fr))',
              gap: 10,
              alignItems: 'start',
            }}
          >
            <ChartCard label={`Drop-off · ${period.replace("d", "")} days`}>
              {data.funnel.length ? (
                <Funnel steps={data.funnel.map((f) => ({ label: f.label, value: f.count }))} />
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>No funnel data</span>
              )}
            </ChartCard>

            <ChartCard label="Top categories">
              {data.categories.length ? (
                <BarList
                  rows={data.categories.slice(0, 6).map((c) => ({
                    label: c.categoryName,
                    value: c.count,
                  }))}
                />
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>No categories sold</span>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {/* ────────────────────────────────────────────────────────────────
          STANDING — everything the period chip does not touch.

          ⚠️ SEPARATED BY A HEADING THAT SAYS SO, NOT BY A GAP. Four
          all-time numbers sitting under a surface titled "Last 30 days" is
          the quietest kind of wrong: every figure is real, the page never
          errors, and the operator reads them as this month for a year.
          ──────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 2px 2px' }}>
        <span
          className="dk-mono"
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--dk-ink-3)',
            whiteSpace: 'nowrap',
          }}
        >
          Standing
        </span>
        <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          running totals and current state — the period above does not apply
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--dk-line)' }} />
      </div>

      {standingError ? (
        <FailedRegion
          title="Couldn't load the standing counts"
          detail={standingError}
          onRetry={() => void loadStanding()}
          scopeNote="the period charts above are unaffected"
        />
      ) : !standing ? (
        <SkeletonPile count={2} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: phone ? '1fr' : '2fr 1fr',
              gap: 10,
              alignItems: 'start',
            }}
          >
            {/* ⚠️ READ-ONLY BY DECISION. This is all that carries over from
                /admin/categories: the tree itself changes in code, because
                isFirearm and requiresLicence decide what sits behind the
                members-only gate and a web form leaves no diff to review. */}
            <ChartCard label="Unmet cross-sell demand">
              {standing.demand.length ? (
                <>
                  <BarList
                    rows={standing.demand.slice(0, 8).map((d) => ({
                      // ⚠️ KEYED ON THE PAIR, NOT THE WORDS. Every category
                      // that has since been deleted comes back named
                      // "(removed category)", so two calibre-less misses can
                      // print identical labels — and the Winkel rebuild
                      // deleted categories.
                      id: `${d.fromCategoryId}-${d.calibre}`,
                      label: d.calibre ? `${d.fromCategoryName} · ${d.calibre}` : d.fromCategoryName,
                      value: d.count,
                    }))}
                    formatValue={(v) => `${v}×`}
                  />
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                    Buyers looked for a complementary item here and found none listed. A running
                    tally since the counter was added, not a monthly figure — recruit this stock to
                    catch the sale. The category tree itself is edited in code.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
                  No unmet cross-sell lookups recorded.
                </span>
              )}
            </ChartCard>

            <ChartCard label="KYC drop-off">
              {standing.kyc.length ? (
                <>
                  <Funnel steps={standing.kyc.map((s) => ({ label: s.stage, value: s.count }))} />
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                    Everyone who has ever reached each stage. A big fall between two adjacent rows
                    is where the verification journey is breaking.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>No KYC data</span>
              )}
            </ChartCard>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: phone ? '1fr' : 'repeat(2, minmax(0, 1fr))',
              gap: 10,
              alignItems: 'start',
            }}
          >
            <ChartCard label="Dispatch, paid to handed over">
              {standing.sla.some((b) => b.count > 0) ? (
                <>
                  {/* The share of the whole, not only the count. A bucket of
                      12 means nothing until you know whether the total is 20
                      or 2,000, and the legacy chart printed both. */}
                  <BarList
                    rows={standing.sla.map((b) => ({
                      id: b.bucket,
                      label: DISPATCH_BUCKET_LABEL[b.bucket] ?? b.bucket,
                      value: b.count,
                    }))}
                    formatValue={(v) => {
                      const total = standing.sla.reduce((s, b) => s + b.count, 0);
                      return total ? `${v} · ${((v / total) * 100).toFixed(0)}%` : String(v);
                    }}
                  />
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                    Couriered and dealer-transfer orders only. Over 72 hours is a breach and the
                    auto-refund cron acts on it.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
                  No dispatched orders to measure.
                </span>
              )}
            </ChartCard>

            {/* 🚨 USERNAMES ONLY. The endpoint returns an email per seller and
                the legacy table printed it; RefundRiskRow leaves the field off
                the type so it cannot reappear by accident. */}
            <ChartCard label="Refund-risk sellers">
              {standing.risk.length ? (
                <>
                  <div>
                    {standing.risk.slice(0, 8).map((r, i, arr) => (
                      <Kv
                        key={r.sellerId}
                        k={r.username ?? 'no username'}
                        // ⚠️ ppDifference IS WHY THE ROW IS HERE. A rate on its
                        // own is unreadable without the baseline, which this
                        // card never shows — the legacy table printed the gap
                        // and dropping it left a number nobody could judge.
                        v={`${(r.refundRate * 100).toFixed(0)}% · ${r.refundCount}/${r.totalSales} · +${r.ppDifference.toFixed(1)}pp`}
                        last={i === arr.length - 1}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                    Refund rate at least twice the marketplace baseline, minimum three sales; the pp
                    figure is how far above that baseline they sit. Search the username on People to
                    open the member — this surface carries no actions. A number to look into, not a
                    verdict.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
                  No seller is running at twice the baseline.
                </span>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </DeskShell>
  );
}

function KpiTile({
  label,
  value,
  now,
  prev,
  period,
}: {
  label: string;
  value: string;
  now: number;
  prev: number;
  period: Period;
}) {
  const d = delta(now, prev);
  return (
    <Kpi
      label={label}
      value={value}
      delta={d?.label}
      deltaDirection={d?.direction}
      deltaContext={d ? `vs prior ${period.replace("d", "")} days` : undefined}
    />
  );
}
