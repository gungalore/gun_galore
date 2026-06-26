'use client';

// MetricCard — compact metric tile for the Load Lab result surface.
// Small uppercase tertiary label on top, a 22px value below, optional
// sub-line and an optional chip (e.g. the "% of max" pressure chip).
// Pure CSS-variable styling, matches the admin/ask-gg aesthetic.

import type { ReactNode } from 'react';

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Optional muted line under the value (units, context). */
  sub?: ReactNode;
  /** Optional chip rendered top-right (e.g. a pressure %-of-max badge). */
  chip?: { text: string; tone?: 'neutral' | 'warning' | 'danger' };
}

function chipStyle(tone: 'neutral' | 'warning' | 'danger'): React.CSSProperties {
  if (tone === 'danger') {
    return {
      background: 'rgba(200,16,46,0.12)',
      border: '0.5px solid var(--red)',
      color: 'var(--red)',
    };
  }
  if (tone === 'warning') {
    return {
      background: 'rgba(245,158,11,0.12)',
      border: '0.5px solid var(--warning)',
      color: 'var(--warning)',
    };
  }
  return {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-tertiary)',
  };
}

export function MetricCard({ label, value, sub, chip }: MetricCardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
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
          {label}
        </span>
        {chip && (
          <span
            style={{
              ...chipStyle(chip.tone ?? 'neutral'),
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {chip.text}
          </span>
        )}
      </div>
      <span
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}
