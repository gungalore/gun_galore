'use client';

// PressureVelocityChart — dual-axis internal-ballistics chart. Pressure
// (left axis, red) and velocity (right axis, blue) plotted against barrel
// time (ms), from internal.curve. A dashed horizontal line marks the
// pressure ceiling (safety.pressureCeilingBar). Pure SVG, CSS-var themed,
// built on the same geometry as the admin TimeSeriesChart.

import type { LoadLabCurvePoint } from '@/lib/load-lab-types';
import { num } from '@/lib/load-lab-format';

const VELOCITY_BLUE = '#3b82f6';

export function PressureVelocityChart({
  curve,
  pressureCeilingBar,
}: {
  curve: LoadLabCurvePoint[];
  pressureCeilingBar: number;
}) {
  if (!curve || curve.length < 2) {
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
        Not enough curve data to plot.
      </div>
    );
  }

  const W = 720;
  const H = 280;
  const padX = 52;
  const padY = 24;

  const tMin = curve[0].tMs;
  const tMax = curve[curve.length - 1].tMs;
  const tSpan = tMax - tMin || 1;

  // Pressure axis includes the ceiling so the dashed "max" line is always
  // on-canvas even when the actual peak is below it.
  const maxPressure = Math.max(
    ...curve.map((c) => c.pressureBar),
    pressureCeilingBar,
    1,
  );
  const maxVelocity = Math.max(...curve.map((c) => c.velocityFps), 1);

  const xScale = (t: number) => padX + ((t - tMin) / tSpan) * (W - 2 * padX);
  const pScale = (p: number) => H - padY - (p / maxPressure) * (H - 2 * padY);
  const vScale = (v: number) => H - padY - (v / maxVelocity) * (H - 2 * padY);

  const pPath = curve
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xScale(c.tMs)} ${pScale(c.pressureBar)}`)
    .join(' ');
  const vPath = curve
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xScale(c.tMs)} ${vScale(c.velocityFps)}`)
    .join(' ');

  const ceilingY = pScale(pressureCeilingBar);

  // 5 horizontal grid rows, labelled left (bar) + right (fps).
  const rows = [0, 0.25, 0.5, 0.75, 1];

  // X labels: first / middle / last time.
  const xLabels = [0, Math.floor((curve.length - 1) / 2), curve.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => ({ x: xScale(curve[i].tMs), t: curve[i].tMs }));

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
          Pressure &amp; velocity vs time
        </span>
        <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
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
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--red)',
              }}
            />
            Pressure (bar)
          </span>
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
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: VELOCITY_BLUE,
              }}
            />
            Velocity (fps)
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid rows + dual-axis labels */}
        {rows.map((f, idx) => {
          const y = H - padY - f * (H - 2 * padY);
          return (
            <g key={idx}>
              <line
                x1={padX}
                x2={W - padX}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={idx === 0 ? '0' : '2,3'}
                strokeWidth={0.5}
              />
              <text
                x={padX - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--red)"
              >
                {num(maxPressure * f)}
              </text>
              <text
                x={W - padX + 6}
                y={y + 3}
                textAnchor="start"
                fontSize={9}
                fill={VELOCITY_BLUE}
              >
                {num(maxVelocity * f)}
              </text>
            </g>
          );
        })}

        {/* X-axis time labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={H - 6}
            textAnchor="middle"
            fontSize={9}
            fill="var(--text-tertiary)"
          >
            {num(l.t, 2)} ms
          </text>
        ))}

        {/* Pressure ceiling — dashed line + "max" label */}
        <line
          x1={padX}
          x2={W - padX}
          y1={ceilingY}
          y2={ceilingY}
          stroke="var(--red)"
          strokeWidth={1}
          strokeDasharray="5,4"
          opacity={0.7}
        />
        <text
          x={W - padX}
          y={ceilingY - 4}
          textAnchor="end"
          fontSize={9}
          fill="var(--red)"
          opacity={0.85}
        >
          max
        </text>

        {/* Velocity line (blue) */}
        <path
          d={vPath}
          fill="none"
          stroke={VELOCITY_BLUE}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Pressure line (red, on top) */}
        <path
          d={pPath}
          fill="none"
          stroke="var(--red)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
