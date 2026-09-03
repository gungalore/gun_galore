'use client';

/**
 * THE DESK — the charts: Line, BarList, Funnel, Split.
 *
 * ⚠️ HAND-ROLLED SVG, AND NO CHART LIBRARY. Not stubbornness: every charting
 * library ships a palette, and a palette is exactly what this surface cannot
 * have. Colour here means "something needs you", so a chart that colours its
 * series green and amber is telling the operator a lie in the same vocabulary
 * the cards use for a breached SLA.
 *
 * ⚠️ ONE HUE, VARIED BY OPACITY. Every series is --dk-ink at a different
 * opacity, the grid is a hairline, and the axis text is ink-4 mono. If a
 * chart genuinely needs two things told apart, they are told apart by
 * position or label, not by hue.
 */
import * as React from 'react';
import { Label } from './numbers';

/* ────────────────────────────────────────────────────────────────────────
 * Line — daily sales
 * ──────────────────────────────────────────────────────────────────────── */

export interface LinePoint {
  /** Axis label, e.g. "1 Aug". Only the first, middle and last are drawn. */
  label: string;
  value: number;
}

export function LineChart({
  points,
  height = 180,
  formatValue = (v: number) => String(v),
}: {
  points: LinePoint[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  if (points.length < 2) return <ChartEmpty>No paid orders in this period</ChartEmpty>;

  const W = 640;
  const H = height;
  // 30px of right padding so the last axis label is not clipped by the frame,
  // and 34 at the bottom for the dates.
  const PAD = { l: 44, r: 30, t: 12, b: 26 };
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const x = (i: number) => PAD.l + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${PAD.t + plotH} L${x(0)},${PAD.t + plotH} Z`;
  const last = points[points.length - 1];

  const ticks = [0, 0.5, 1];
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Daily sales">
      {ticks.map((t) => {
        const yy = PAD.t + plotH - t * plotH;
        return (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke="var(--dk-line)" strokeWidth="1" />
            <text
              x={PAD.l - 8}
              y={yy + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--dk-ink-4)"
              className="dk-mono"
            >
              {formatValue(Math.round(max * t))}
            </text>
          </g>
        );
      })}
      <path d={area} fill="var(--dk-ink)" fillOpacity="0.06" />
      <path d={line} fill="none" stroke="var(--dk-ink)" strokeWidth="1.6" strokeLinejoin="round" />
      {/* The endpoint dot: the operator's eye goes to "where are we now". */}
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="3.5" fill="var(--dk-ink)" />
      {labelIdx.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={H - 8}
          textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
          fontSize="10"
          fill="var(--dk-ink-4)"
          className="dk-mono"
        >
          {points[i].label}
        </text>
      ))}
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * BarList — top categories
 * ──────────────────────────────────────────────────────────────────────── */

export function BarList({
  rows,
  formatValue = (v: number) => String(v),
}: {
  /**
   * ⚠️ `id` EXISTS BECAUSE A LABEL IS NOT AN IDENTITY. Two rows can print the
   * same words — the cross-sell demand feed names every deleted category
   * "(removed category)" — and keying React on the label then collapses them
   * into one row that flickers between two values. Pass `id` wherever the
   * caller has a real key; the label is only the fallback.
   */
  rows: { label: string; value: number; secondary?: number; id?: string }[];
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.secondary ?? 0))) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r, i) => (
        <div key={r.id ?? `${r.label}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{r.label}</span>
            <span style={{ flex: 1 }} />
            <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
              {formatValue(r.value)}
            </span>
          </span>
          <span
            style={{
              height: 6,
              borderRadius: 'var(--dk-radius-pill)',
              background: 'var(--dk-inset)',
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            <span style={{ width: `${(r.value / max) * 100}%`, background: 'var(--dk-ink)' }} />
          </span>
          {r.secondary !== undefined ? (
            <span
              style={{
                height: 6,
                borderRadius: 'var(--dk-radius-pill)',
                background: 'var(--dk-inset)',
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              {/* The second series is the same ink at 45% — a comparison, not
                  a different meaning. */}
              <span
                style={{
                  width: `${(r.secondary / max) * 100}%`,
                  background: 'var(--dk-ink)',
                  opacity: 0.45,
                }}
              />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Funnel — the drop-off
 * ──────────────────────────────────────────────────────────────────────── */

export function Funnel({
  steps,
}: {
  steps: { label: string; value: number }[];
}) {
  const first = steps[0]?.value || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].value;
        const drop = prev ? Math.round(((s.value - prev) / prev) * 100) : null;
        return (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{s.label}</span>
              <span style={{ flex: 1 }} />
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink)' }}>
                {s.value.toLocaleString('en-ZA')}
              </span>
              {drop !== null ? (
                <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                  {drop}%
                </span>
              ) : null}
            </span>
            <span
              style={{
                height: 22,
                borderRadius: 6,
                background: 'var(--dk-inset)',
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <span
                style={{
                  width: `${(s.value / first) * 100}%`,
                  background: 'var(--dk-ink)',
                  // Steps of 14%: further down the funnel is quieter, which
                  // is also how the operator reads it.
                  opacity: 1 - i * 0.14,
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Split — two shares of one thing
 * ──────────────────────────────────────────────────────────────────────── */

export function Split({
  a,
  b,
}: {
  a: { label: string; value: number };
  b: { label: string; value: number };
}) {
  const total = a.value + b.value || 1;
  const aPct = Math.round((a.value / total) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ height: 14, borderRadius: 'var(--dk-radius-pill)', overflow: 'hidden', display: 'flex' }}>
        <span style={{ width: `${aPct}%`, background: 'var(--dk-ink)' }} />
        <span style={{ flex: 1, background: 'var(--dk-ink)', opacity: 0.4 }} />
      </span>
      <span style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--dk-ink-2)' }}>
        <span>{`${a.label} ${aPct}%`}</span>
        <span>{`${b.label} ${100 - aPct}%`}</span>
      </span>
    </div>
  );
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 120,
        fontSize: 12.5,
        color: 'var(--dk-ink-3)',
      }}
    >
      {children}
    </div>
  );
}

/** A titled chart block, so Pulse does not re-declare the frame five times. */
export function ChartCard({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '14px 16px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>{label}</Label>
        <span style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}
