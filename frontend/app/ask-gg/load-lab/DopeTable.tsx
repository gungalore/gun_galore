'use client';

// DopeTable — Competition-mode DOPE card. Range / drop (cm) / MIL / MOA /
// velocity / energy per row from external.rows. Wrapped in overflow-x-auto
// so it scrolls on mobile without breaking the layout. Header cells are
// small uppercase tertiary labels; numbers are tabular + right-aligned.

import type { LoadLabExternalRow } from '@/lib/load-lab-types';
import { num } from '@/lib/load-lab-format';

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'right',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--text-tertiary)',
  fontWeight: 600,
  borderBottom: '0.5px solid var(--border)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'right',
  fontSize: 12,
  color: 'var(--text-secondary)',
  borderBottom: '0.5px solid var(--border)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

export function DopeTable({ rows }: { rows: LoadLabExternalRow[] }) {
  if (!rows || rows.length === 0) return null;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-tertiary)',
          fontWeight: 600,
          display: 'block',
          marginBottom: 10,
        }}
      >
        DOPE table
      </span>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: 480,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left' }}>Range</th>
              <th style={thStyle}>Drop (cm)</th>
              <th style={thStyle}>MIL</th>
              <th style={thStyle}>MOA</th>
              <th style={thStyle}>Velocity</th>
              <th style={thStyle}>Energy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rangeM}>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: 'left',
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                  }}
                >
                  {num(r.rangeM)} m
                </td>
                <td style={tdStyle}>{num(r.dropCm, 1)}</td>
                <td style={tdStyle}>{num(r.dropMil, 1)}</td>
                <td style={tdStyle}>{num(r.dropMoa, 1)}</td>
                <td style={tdStyle}>{num(r.velocityFps)} fps</td>
                <td style={tdStyle}>{num(r.energyJoules)} J</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
