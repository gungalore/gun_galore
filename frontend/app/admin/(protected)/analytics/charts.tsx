// Pure-SVG charts for the admin analytics page. Hand-rolled to avoid
// pulling Recharts / Chart.js into the bundle for a single dashboard.
// All three components are server-renderable — they take primitive
// arrays and produce SVG. Hover tooltips use plain CSS title attributes
// (browser-native, accessible, no JS needed).

import { ReactNode } from 'react';

function formatRand(cents: number, compact = false): string {
  const rand = cents / 100;
  if (compact && rand >= 1_000_000) return `R${(rand / 1_000_000).toFixed(1)}M`;
  if (compact && rand >= 10_000) return `R${(rand / 1_000).toFixed(0)}k`;
  if (compact && rand >= 1_000) return `R${(rand / 1_000).toFixed(1)}k`;
  return `R${rand.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// ─── Line chart: GMV + revenue over time ────────────────────────────
// Two-series line chart. GMV on the primary axis (red), platform
// revenue on the same axis (blue). Empty state shows a friendly
// message instead of an empty SVG.
export function TimeSeriesChart({
  points,
  bucket,
}: {
  points: { bucket: string; gmvCents: number; revenueCents: number; txCount: number }[];
  bucket: 'day' | 'week' | 'month';
}) {
  if (points.length === 0) {
    return (
      <EmptyChartCard message="No completed sales in this period yet — once a transaction reaches RELEASED, it'll show up here." />
    );
  }

  const W = 720;
  const H = 280;
  const padX = 48;
  const padY = 24;

  const maxGmv = Math.max(...points.map((p) => p.gmvCents), 1);
  const xStep = points.length > 1 ? (W - 2 * padX) / (points.length - 1) : 0;
  const yScale = (v: number) => H - padY - (v / maxGmv) * (H - 2 * padY);
  const xScale = (i: number) => padX + i * xStep;

  const gmvPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.gmvCents)}`)
    .join(' ');
  const revPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.revenueCents)}`)
    .join(' ');

  // Light-touch x-axis labels: first, middle, last (anything more would
  // overlap on day-bucket views with 30+ points).
  const labels = [0, Math.floor(points.length / 2), points.length - 1]
    .filter((i, idx, arr) => arr.indexOf(i) === idx)
    .map((i) => ({ i, label: formatBucket(points[i].bucket, bucket) }));

  // Y-axis ticks — 4 evenly-spaced lines.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    v: maxGmv * p,
    y: yScale(maxGmv * p),
  }));

  return (
    <ChartCard
      title="Sales over time"
      subtitle={`GMV and platform revenue per ${bucket} (RELEASED transactions only)`}
      legend={[
        { label: 'GMV', color: 'var(--red)' },
        { label: 'Platform revenue', color: '#3b82f6' },
      ]}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Y-axis grid lines + labels */}
        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line
              x1={padX}
              x2={W - padX}
              y1={t.y}
              y2={t.y}
              stroke="var(--border)"
              strokeDasharray={idx === 0 ? '0' : '2,3'}
              strokeWidth={0.5}
            />
            <text
              x={padX - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--text-tertiary)"
            >
              {formatRand(t.v, true)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {labels.map((l) => (
          <text
            key={l.i}
            x={xScale(l.i)}
            y={H - 6}
            textAnchor="middle"
            fontSize={9}
            fill="var(--text-tertiary)"
          >
            {l.label}
          </text>
        ))}

        {/* Revenue line (blue) */}
        <path
          d={revPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* GMV line (red, on top) */}
        <path
          d={gmvPath}
          fill="none"
          stroke="var(--red)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dot at every data point with a native title tooltip. */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={xScale(i)}
              cy={yScale(p.gmvCents)}
              r={3}
              fill="var(--red)"
            >
              <title>
                {formatBucket(p.bucket, bucket)} — {formatRand(p.gmvCents)} GMV / {formatRand(p.revenueCents)} revenue / {p.txCount} sale{p.txCount === 1 ? '' : 's'}
              </title>
            </circle>
            <circle
              cx={xScale(i)}
              cy={yScale(p.revenueCents)}
              r={2}
              fill="#3b82f6"
            />
          </g>
        ))}
      </svg>
    </ChartCard>
  );
}

// ─── Horizontal bar chart: sales by category ────────────────────────
export function CategoryBarChart({
  rows,
}: {
  rows: { categoryName: string; count: number; gmvCents: number }[];
}) {
  if (rows.length === 0) {
    return <EmptyChartCard message="No category breakdown — needs at least one RELEASED sale." />;
  }
  const max = Math.max(...rows.map((r) => r.gmvCents), 1);

  return (
    <ChartCard
      title="Sales by category"
      subtitle="Top 10 categories by GMV in the selected period"
    >
      <div className="space-y-2">
        {rows.map((r) => {
          const pct = (r.gmvCents / max) * 100;
          return (
            <div key={r.categoryName}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: 'var(--text-secondary)' }}>
                  {r.categoryName}
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {formatRand(r.gmvCents)} · {r.count} sale{r.count === 1 ? '' : 's'}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-inset)' }}
              >
                <div
                  className="h-full"
                  style={{
                    background: 'var(--red)',
                    width: `${pct}%`,
                    transition: 'width 200ms ease-out',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// ─── Donut: listing type split ───────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  BUY_NOW: 'var(--red)',
  AUCTION: '#3b82f6',
  TAKE_A_SHOT: '#f59e0b',
};

const TYPE_LABELS: Record<string, string> = {
  BUY_NOW: 'Buy Now',
  AUCTION: 'Auction',
  TAKE_A_SHOT: 'Take a Shot',
};

export function ListingTypeDonut({
  rows,
}: {
  rows: { listingType: string; count: number; gmvCents: number }[];
}) {
  if (rows.length === 0) {
    return <EmptyChartCard message="No type breakdown — needs at least one RELEASED sale." />;
  }
  const total = rows.reduce((s, r) => s + r.gmvCents, 0);
  if (total === 0) {
    return <EmptyChartCard message="No GMV in this period." />;
  }

  const R = 70;
  const r = 45; // inner radius (donut hole)
  const cx = 90;
  const cy = 90;

  let angleAcc = -Math.PI / 2; // start at 12 o'clock
  const slices = rows.map((row) => {
    const sliceAngle = (row.gmvCents / total) * 2 * Math.PI;
    const start = angleAcc;
    const end = angleAcc + sliceAngle;
    angleAcc = end;
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const x1 = cx + R * Math.cos(start);
    const y1 = cy + R * Math.sin(start);
    const x2 = cx + R * Math.cos(end);
    const y2 = cy + R * Math.sin(end);
    const xi1 = cx + r * Math.cos(end);
    const yi1 = cy + r * Math.sin(end);
    const xi2 = cx + r * Math.cos(start);
    const yi2 = cy + r * Math.sin(start);

    const path = [
      `M ${x1} ${y1}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${r} ${r} 0 ${largeArc} 0 ${xi2} ${yi2}`,
      'Z',
    ].join(' ');

    return {
      path,
      color: TYPE_COLORS[row.listingType] ?? 'var(--text-tertiary)',
      label: TYPE_LABELS[row.listingType] ?? row.listingType,
      count: row.count,
      gmvCents: row.gmvCents,
      pct: (row.gmvCents / total) * 100,
    };
  });

  return (
    <ChartCard
      title="Listing type split"
      subtitle="Share of GMV by sale mode"
    >
      <div className="flex items-center gap-4 flex-wrap">
        <svg viewBox="0 0 180 180" width="180" height="180">
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color}>
              <title>
                {s.label} — {formatRand(s.gmvCents)} ({s.pct.toFixed(1)}%) · {s.count} sale{s.count === 1 ? '' : 's'}
              </title>
            </path>
          ))}
          <text
            x={90}
            y={88}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-tertiary)"
          >
            Total GMV
          </text>
          <text
            x={90}
            y={104}
            textAnchor="middle"
            fontSize={13}
            fontWeight={500}
            fill="var(--text-primary)"
          >
            {formatRand(total, true)}
          </text>
        </svg>
        <div className="flex flex-col gap-1.5 text-xs">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-[2px]"
                style={{ background: s.color }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {s.pct.toFixed(1)}% · {formatRand(s.gmvCents)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────
//
// Headline metric with optional Δ vs prev period. Up arrow green, down
// arrow red (we flip for refund/dispute rate where "down" is good —
// caller passes `goodDirection: 'down'`).
export function KpiCard({
  label,
  value,
  prev,
  formatter,
  goodDirection = 'up',
  hint,
}: {
  label: string;
  value: number;
  prev: number;
  formatter: (n: number) => string;
  goodDirection?: 'up' | 'down';
  hint?: string;
}) {
  let deltaPct: number | null = null;
  if (prev > 0) {
    deltaPct = ((value - prev) / prev) * 100;
  } else if (prev === 0 && value > 0) {
    deltaPct = null; // ∞ — show "+ new" instead
  }

  const isUp = deltaPct !== null && deltaPct > 0;
  const isDown = deltaPct !== null && deltaPct < 0;
  const positive =
    (goodDirection === 'up' && isUp) || (goodDirection === 'down' && isDown);
  const negative =
    (goodDirection === 'up' && isDown) || (goodDirection === 'down' && isUp);

  const deltaColor = positive ? '#22c55e' : negative ? 'var(--red)' : 'var(--text-tertiary)';

  return (
    <div
      className="rounded-[8px] p-5"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p
        className="text-2xl font-medium mt-1"
        style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
      >
        {formatter(value)}
      </p>
      <p className="text-xs mt-2" style={{ color: deltaColor }}>
        {deltaPct === null && prev === 0 && value > 0 ? (
          '↑ new'
        ) : deltaPct === null ? (
          '—'
        ) : (
          <>
            {isUp ? '↑' : isDown ? '↓' : '→'} {Math.abs(deltaPct).toFixed(1)}%
            <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>
              vs prev
            </span>
          </>
        )}
      </p>
      {hint && (
        <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ─── Internal: chart frame ──────────────────────────────────────────
function ChartCard({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-[8px] p-5"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </p>
          {subtitle && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {legend && (
          <div className="flex gap-3 text-xs">
            {legend.map((l) => (
              <span
                key={l.label}
                className="flex items-center gap-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: l.color }}
                />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyChartCard({ message }: { message: string }) {
  return (
    <div
      className="rounded-[8px] p-6 text-center"
      style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
    >
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {message}
      </p>
    </div>
  );
}

// ─── Bucket → label formatter ───────────────────────────────────────
function formatBucket(iso: string, bucket: 'day' | 'week' | 'month'): string {
  const d = new Date(iso);
  if (bucket === 'month') {
    return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
  }
  if (bucket === 'week') {
    return `${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`;
  }
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}
