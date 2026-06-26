'use client';

// DownrangeChart — bullet drop (cm) vs range (m), from external.rows.
// Three shaded vertical bands flag the velocity regime: supersonic (blue),
// transonic (warning), subsonic (red), split at supersonicRangeM /
// transonicRangeM. Geometry adapted from hunt-ballistics TrajectoryChart,
// remapped to the tokens that exist here (no accent/danger tokens). Drop is
// plotted downward (positive cm = below line of sight). Zero-crossing +
// max-ordinate markers drawn when present. Pure SVG, CSS-var themed.

import type { LoadLabExternalRow } from '@/lib/load-lab-types';
import { num } from '@/lib/load-lab-format';

const SUPERSONIC_BLUE = '#3b82f6';

export function DownrangeChart({
  rows,
  supersonicRangeM,
  transonicRangeM,
}: {
  rows: LoadLabExternalRow[];
  supersonicRangeM: number;
  transonicRangeM: number;
}) {
  if (!rows || rows.length < 2) {
    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 8,
          border: '0.5px dashed var(--border)',
          background: 'var(--bg-card)',
          fontSize: 12,
          color: 'var(--text-tertiary)',
          textAlign: 'center',
        }}
      >
        Not enough trajectory data to plot.
      </div>
    );
  }

  const W = 720;
  const H = 280;
  const padX = 48;
  const padTop = 18;
  const padBottom = 28;

  const maxRange = Math.max(...rows.map((r) => r.rangeM), 1);
  // Drop is positive downward. Include 0 so the line of sight sits on-axis.
  const drops = rows.map((r) => r.dropCm);
  const dMax = Math.max(0, ...drops);
  const dMin = Math.min(0, ...drops);
  const dSpan = dMax - dMin || 1;

  const xScale = (range: number) => padX + (range / maxRange) * (W - 2 * padX);
  // Higher drop (more below LOS) → lower on screen.
  const yScale = (drop: number) =>
    padTop + ((drop - dMin) / dSpan) * (H - padTop - padBottom);

  const losY = yScale(0);

  const path = rows
    .map((r, i) => `${i === 0 ? 'M' : 'L'} ${xScale(r.rangeM)} ${yScale(r.dropCm)}`)
    .join(' ');

  // Velocity-regime bands, clamped to the plotted range.
  const sup = Math.min(supersonicRangeM, maxRange);
  const trans = Math.min(transonicRangeM, maxRange);
  const bands: { from: number; to: number; fill: string; alpha: number }[] = [
    { from: 0, to: sup, fill: SUPERSONIC_BLUE, alpha: 0.06 },
    { from: sup, to: trans, fill: 'var(--warning)', alpha: 0.07 },
    { from: trans, to: maxRange, fill: 'var(--red)', alpha: 0.06 },
  ].filter((b) => b.to > b.from);

  // Zero crossings — sign changes of drop along the curve (interpolated).
  const zeros: number[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1];
    const b = rows[i];
    if ((a.dropCm <= 0 && b.dropCm > 0) || (a.dropCm >= 0 && b.dropCm < 0)) {
      const t = a.dropCm / (a.dropCm - b.dropCm);
      zeros.push(a.rangeM + t * (b.rangeM - a.rangeM));
    }
  }

  // Max ordinate — highest point above the line of sight (min dropCm).
  const maxOrd = rows.reduce(
    (best, r) => (r.dropCm < best.dropCm ? r : best),
    rows[0],
  );

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxRange));

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--text-tertiary)',
            fontWeight: 600,
          }}
        >
          Drop vs range
        </span>
        <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
          <BandLegend color={SUPERSONIC_BLUE} label="Supersonic" />
          <BandLegend color="var(--warning)" label="Transonic" />
          <BandLegend color="var(--red)" label="Subsonic" />
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Velocity-regime bands */}
        {bands.map((b, i) => (
          <rect
            key={i}
            x={xScale(b.from)}
            y={padTop}
            width={xScale(b.to) - xScale(b.from)}
            height={H - padTop - padBottom}
            fill={b.fill}
            opacity={b.alpha}
          />
        ))}

        {/* Line of sight (drop = 0) */}
        <line
          x1={padX}
          x2={W - padX}
          y1={losY}
          y2={losY}
          stroke="var(--text-tertiary)"
          strokeWidth={0.5}
          strokeDasharray="3,3"
          opacity={0.7}
        />

        {/* X-axis range ticks */}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={xScale(t)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            fontSize={9}
            fill="var(--text-tertiary)"
          >
            {num(t)} m
          </text>
        ))}

        {/* Drop curve */}
        <path
          d={path}
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Max ordinate marker */}
        {maxOrd.dropCm < -0.5 && (
          <circle
            cx={xScale(maxOrd.rangeM)}
            cy={yScale(maxOrd.dropCm)}
            r={3}
            fill="var(--warning)"
          >
            <title>
              Max ordinate — {num(-maxOrd.dropCm, 1)} cm high at {num(maxOrd.rangeM)} m
            </title>
          </circle>
        )}

        {/* Zero crossings */}
        {zeros.map((z, i) => (
          <circle key={i} cx={xScale(z)} cy={losY} r={2.5} fill="var(--text-primary)">
            <title>Zero at {num(z)} m</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function BandLegend({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color: 'var(--text-secondary)',
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          opacity: 0.45,
        }}
      />
      {label}
    </span>
  );
}
