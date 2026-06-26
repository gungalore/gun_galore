'use client';

// SafetyOverlay — persistent advisory banner at the TOP of every Load Lab
// result. Default state: bg-inset + warning border, "estimate only" copy.
// When the load is near or over the pressure ceiling it escalates to a red
// border + a "do not use this charge" message. Always present — this is an
// advisory-only tool and the disclaimer is non-negotiable.

import type { LoadLabResult } from '@/lib/load-lab-types';

export function SafetyOverlay({ safety }: { safety: LoadLabResult['safety'] }) {
  const danger = safety.nearMax || safety.overPressure;

  return (
    <div
      role="alert"
      style={{
        background: 'var(--bg-inset)',
        border: `0.5px solid ${danger ? 'var(--red)' : 'var(--warning)'}`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          fontSize: 16,
          lineHeight: 1.3,
          color: danger ? 'var(--red)' : 'var(--warning)',
        }}
      >
        {danger ? '⚠' : 'ℹ'}
      </span>
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.4,
          color: danger ? 'var(--red)' : 'var(--text-secondary)',
          fontWeight: danger ? 600 : 400,
        }}
      >
        {danger
          ? 'Near/over maximum pressure — do not use this charge.'
          : 'Estimate only — the predicted pressure can read LOW for some powders, so it is not a “safe” verdict. Start low, work up, and verify every charge against a published load manual.'}
      </span>
    </div>
  );
}
