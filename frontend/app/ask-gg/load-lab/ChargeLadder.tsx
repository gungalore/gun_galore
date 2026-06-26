'use client';

// ChargeLadder — one horizontal bar per ladder rung, width ∝ velocity,
// colour by pctOfMax pressure:
//   <95%      → muted red (safe headroom)
//   95–100%   → warning (approaching max)
//   ≥100%     → solid red + a warning glyph (at/over max)
// Clicking a rung calls onPick(chargeGr) so the operator can load that
// charge straight into the form. Pure CSS-var styling.

import type { LoadLabLadderRung } from '@/lib/load-lab-types';
import { num } from '@/lib/load-lab-format';

function rungColor(pctOfMax: number): string {
  if (pctOfMax >= 100) return 'var(--red)';
  if (pctOfMax >= 95) return 'var(--warning)';
  return 'rgba(200,16,46,0.45)';
}

export function ChargeLadder({
  ladder,
  onPick,
}: {
  ladder: LoadLabLadderRung[];
  onPick: (chargeGr: number) => void;
}) {
  if (!ladder || ladder.length === 0) return null;

  const maxV = Math.max(...ladder.map((r) => r.vMuzzleFps), 1);

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
          marginBottom: 12,
        }}
      >
        Charge ladder
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ladder.map((rung) => {
          const widthPct = Math.max(6, (rung.vMuzzleFps / maxV) * 100);
          const over = rung.pctOfMax >= 100;
          const near = rung.pctOfMax >= 95;
          return (
            <button
              key={rung.chargeGr}
              type="button"
              onClick={() => onPick(rung.chargeGr)}
              title={`Load ${num(rung.chargeGr, 1)} gr — ${num(rung.vMuzzleFps)} fps, ${num(rung.pctOfMax)}% of max pressure`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '2px 0',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              {/* Charge label — fixed-width gutter */}
              <span
                style={{
                  flexShrink: 0,
                  width: 62,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {num(rung.chargeGr, 1)} gr
              </span>
              {/* Bar track */}
              <span
                style={{
                  flex: 1,
                  height: 18,
                  background: 'var(--bg-inset)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'block',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${widthPct}%`,
                    background: rungColor(rung.pctOfMax),
                    borderRadius: 4,
                    transition: 'width 200ms ease-out',
                  }}
                />
              </span>
              {/* Velocity + pressure % readout */}
              <span
                style={{
                  flexShrink: 0,
                  width: 116,
                  textAlign: 'right',
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 5,
                }}
              >
                {over && (
                  <span aria-hidden style={{ color: 'var(--red)' }}>
                    ⚠
                  </span>
                )}
                <span>
                  {num(rung.vMuzzleFps)} fps ·{' '}
                  <span
                    style={{
                      color: over
                        ? 'var(--red)'
                        : near
                          ? 'var(--warning)'
                          : 'var(--text-tertiary)',
                      fontWeight: near ? 600 : 400,
                    }}
                  >
                    {num(rung.pctOfMax)}%
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
