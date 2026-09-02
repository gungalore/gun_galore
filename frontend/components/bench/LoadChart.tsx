'use client';

/**
 * THE BENCH — charge against velocity.
 *
 * Two points and the line between them. That is the whole chart, and the
 * caption says so out loud: a load is a start charge and a max charge, and
 * everything between them is the reloader's own work-up, not a curve anyone
 * measured. Drawing a smooth interpolation here would imply data that does
 * not exist.
 *
 * ⚠️ THE SCALE MATHS IS PORTED VERBATIM from the design prototype's
 * `chartFor()` (`Main.dc.html`) — the margins, the 0.6-step head-room, the
 * grain padding and the label offsets. Re-deriving any of it by eye moves
 * the grid off the numbers.
 */

import type { CSSProperties } from 'react';
import type { LoadChartProps } from '@/components/bench/contract';
import { MS } from '@/lib/bench/geometry';

/**
 * ⚠️ THE ONE LITERAL COLOUR IN THE MODULE, AND IT IS DELIBERATE. This is the
 * prototype's series blue, named as a literal by SPEC-BUILD.md §5.2. It is a
 * data colour, not part of the palette: globals.css has no token for it, and
 * inventing one would put a second blue into a red-and-gold system. Nothing
 * else in The Bench may use a raw hex.
 */
const SERIES = '#2a78d6';

/* The prototype's frame. Read as: 340×220 with a 44px gutter for the
   velocity labels, 30px below for the grain labels. */
const W = 340;
const H = 220;
const L = 44;
const R = 14;
const T = 18;
const B = 30;
const PW = W - L - R;
const PH = H - T - B;

const headRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 12,
  marginBottom: 4,
};

const headLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const tick: CSSProperties = { fill: 'var(--text-tertiary)' };
const axis: CSSProperties = { fill: 'var(--text-faint)' };

export default function LoadChart({
  units,
  startGr,
  startFps,
  maxGr,
  maxFps,
  animate = true,
}: LoadChartProps) {
  const imperial = units === 'imperial';

  // Velocities arrive in fps because that is the unit they were recorded in;
  // the metric reader sees m/s, so the AXIS is converted, not just a label.
  const v0 = startFps === null ? null : imperial ? startFps : Math.round(startFps * MS);
  const v1 = maxFps === null ? null : imperial ? maxFps : Math.round(maxFps * MS);
  const known = [v0, v1].filter((v): v is number => v !== null);

  const caption = 'the line joins the start and max points only';

  // No velocity at either end means there is no y-axis to build. Say so
  // rather than drawing an empty frame the eye will try to read.
  if (known.length === 0) {
    return (
      <div style={{ padding: '16px 20px' }}>
        <div style={headRow}>
          <div style={headLabel}>Charge vs velocity</div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '24px 0' }}>
          No velocities for this load.
        </div>
      </div>
    );
  }

  const step = imperial ? 100 : 40;
  const ymin = Math.floor((Math.min(...known) - step * 0.6) / step) * step;
  const ymax = Math.ceil((Math.max(...known) + step * 0.6) / step) * step;
  const xmin = Math.floor(startGr - 1);
  const xmax = Math.ceil(maxGr + 1);

  const X = (x: number) => L + ((x - xmin) / (xmax - xmin)) * PW;
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * PH;

  const grid: { y: number; ty: number; label: string }[] = [];
  for (let y = ymin; y <= ymax; y += step) {
    // ty is the baseline for the label: 3.5px below the line centres the cap
    // height on it.
    grid.push({ y: Y(y), ty: Y(y) + 3.5, label: String(y) });
  }

  // Two-grain steps once the charge window is wide, so the labels never
  // collide at the bottom of a 340px frame.
  const xstep = xmax - xmin > 8 ? 2 : 1;
  const xs: { x: number; label: string }[] = [];
  for (let x = xmin; x <= xmax; x += xstep) {
    xs.push({ x: X(x), label: String(x) });
  }

  const start = v0 === null ? null : { x: X(startGr), y: Y(v0), ly: Y(v0) + 18, label: 'start' };
  const max = v1 === null ? null : { x: X(maxGr), y: Y(v1), ly: Y(v1) - 12, label: 'max' };
  const points = [start, max].filter((p): p is NonNullable<typeof p> => p !== null);

  const unit = imperial ? 'fps' : 'm/s';
  const drawn = start !== null && max !== null;

  const summary = [
    v0 !== null ? `start ${startGr} gr at ${v0} ${unit}` : null,
    v1 !== null ? `max ${maxGr} gr at ${v1} ${unit}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={headRow}>
        <div style={headLabel}>Charge vs velocity</div>
        {/* Only true once both points exist; with one point there is no line
            to describe. */}
        {drawn && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{caption}</div>}
      </div>

      <svg
        className="num"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Charge against velocity — ${summary}.`}
        // The font is set on the root so every <text> inherits it: var() is
        // reliable in a style block, less so as a presentation attribute.
        style={{ display: 'block', width: '100%', height: 'auto', fontFamily: 'var(--font-sans)' }}
      >
        {grid.map((g) => (
          <g key={g.label}>
            <line
              x1={L}
              x2={W - R}
              y1={g.y.toFixed(1)}
              y2={g.y.toFixed(1)}
              strokeWidth={1}
              style={{ stroke: 'var(--border-divider)' }}
            />
            <text x={L - 8} y={g.ty.toFixed(1)} textAnchor="end" fontSize={10.5} style={tick}>
              {g.label}
            </text>
          </g>
        ))}

        {xs.map((x) => (
          <text
            key={x.label}
            x={x.x.toFixed(1)}
            y={H - B + 16}
            textAnchor="middle"
            fontSize={10.5}
            style={tick}
          >
            {x.label}
          </text>
        ))}

        <text x={W - R} y={216} textAnchor="end" fontSize={10} style={axis}>
          charge, gr
        </text>
        <text x={L - 8} y={12} textAnchor="end" fontSize={10} style={axis}>
          {unit}
        </text>

        {drawn && (
          // .draw is the stroke-dashoffset wipe; without it the line is
          // simply already there.
          <line
            className={animate ? 'draw' : undefined}
            x1={start.x.toFixed(1)}
            y1={start.y.toFixed(1)}
            x2={max.x.toFixed(1)}
            y2={max.y.toFixed(1)}
            stroke={SERIES}
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {points.map((p) => (
          <circle
            key={`m-${p.label}`}
            className={animate ? 'late' : undefined}
            cx={p.x.toFixed(1)}
            cy={p.y.toFixed(1)}
            r={4.5}
            fill={SERIES}
            strokeWidth={2}
            // The ring is the card's own background, so the marker reads as
            // sitting on top of the grid rather than crossed by it.
            style={{ stroke: 'var(--bg-card)' }}
          />
        ))}

        {points.map((p) => (
          <text
            key={`t-${p.label}`}
            className={animate ? 'late' : undefined}
            x={p.x.toFixed(1)}
            y={p.ly.toFixed(1)}
            textAnchor="middle"
            fontSize={11}
            fontWeight={500}
            style={{ fill: 'var(--text-secondary)' }}
          >
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
